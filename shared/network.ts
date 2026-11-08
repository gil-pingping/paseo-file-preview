import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const LOOPBACK = "127.0.0.1";

export function parseIPv4(ip: string): number | null {
  const parts = ip.trim().replace(/^::ffff:/i, "").split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

export interface Cidr {
  network: number;
  bits: number;
}

export function parseCidr(text: string): Cidr | null {
  const [base, bitsText, extra] = text.trim().split("/");
  if (extra !== undefined || bitsText === undefined || !/^\d{1,2}$/.test(bitsText)) return null;
  const bits = Number(bitsText);
  const ip = parseIPv4(base);
  if (ip === null || bits > 32) return null;
  return { network: ip - (ip % 2 ** (32 - bits)), bits };
}

export function inCidr(ip: number, cidr: Cidr): boolean {
  const block = 2 ** (32 - cidr.bits);
  return ip - (ip % block) === cidr.network;
}

// Addresses a home or office LAN, a VPN, or a tailnet uses. Public and wildcard addresses are refused.
const PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"].map((c) => parseCidr(c)!);
// Wider than this would let most of a private range in; require a specific subnet.
const MIN_PREFIX = 16;

export function isPrivateIPv4(text: string): boolean {
  const ip = parseIPv4(text);
  return ip !== null && PRIVATE_RANGES.some((range) => inCidr(ip, range));
}

export function isAllowedNetwork(text: string): boolean {
  const cidr = parseCidr(text);
  return cidr !== null && cidr.bits >= MIN_PREFIX && PRIVATE_RANGES.some((range) => inCidr(cidr.network, range));
}

export const networkSettings = defineSettings({
  id: "network",
  scope: "host",
  version: 1,
  schema: z
    .object({
      // Off by default: the server stays on 127.0.0.1 and only the daemon's own computer can open previews.
      enabled: z.boolean().default(false),
      bindHost: z
        .string()
        .trim()
        .refine((v) => v === "" || isPrivateIPv4(v), "Use a private IPv4 address of this computer (10.x, 172.16-31.x, 192.168.x, 100.64-127.x)")
        .default(""),
      allowedNetworks: z
        .array(z.string().trim())
        .refine((list) => list.every(isAllowedNetwork), `Use private IPv4 CIDRs no wider than /${MIN_PREFIX}, e.g. 192.168.0.0/24`)
        .default([]),
    })
    .refine((v) => !v.enabled || (v.bindHost !== "" && v.allowedNetworks.length > 0), {
      message: "Turning LAN access on needs a bind address and at least one allowed network",
    }),
});

export type NetworkValues = z.output<typeof networkSettings.schema>;

export interface NetworkConfig {
  host: string;
  allow: Cidr[];
}

/** LAN access is on only when it is switched on and has a bind address and an allowed network. */
export function resolveNetwork(values: NetworkValues | null): NetworkConfig {
  if (!values || !values.enabled || values.bindHost === "" || values.allowedNetworks.length === 0)
    return { host: LOOPBACK, allow: [] };
  const own = parseCidr(`${values.bindHost}/32`)!;
  return { host: values.bindHost, allow: [own, ...values.allowedNetworks.map((c) => parseCidr(c)!)] };
}

export function clientAllowed(config: NetworkConfig, remote: string): boolean {
  if (config.host === LOOPBACK) return true;
  const ip = parseIPv4(remote);
  return ip !== null && config.allow.some((cidr) => inCidr(ip, cidr));
}

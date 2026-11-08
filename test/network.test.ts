import assert from "node:assert/strict";
import { test } from "node:test";

const { clientAllowed, inCidr, isAllowedNetwork, isPrivateIPv4, networkSettings, parseCidr, parseIPv4, resolveNetwork } =
  await import("../shared/network.ts");

test("parseIPv4 accepts dotted quads and IPv4-mapped IPv6, rejects the rest", () => {
  assert.equal(parseIPv4("192.168.0.31"), 3232235551);
  assert.equal(parseIPv4("::ffff:192.168.0.31"), 3232235551);
  assert.equal(parseIPv4("256.0.0.1"), null);
  assert.equal(parseIPv4("192.168.0"), null);
  assert.equal(parseIPv4("192.168.0.1.5"), null);
  assert.equal(parseIPv4("fe80::1"), null);
  assert.equal(parseIPv4(""), null);
});

test("parseCidr normalizes the network and inCidr matches members only", () => {
  const cidr = parseCidr("192.168.0.77/24")!;
  assert.deepEqual(cidr, parseCidr("192.168.0.0/24"));
  assert.equal(inCidr(parseIPv4("192.168.0.200")!, cidr), true);
  assert.equal(inCidr(parseIPv4("192.168.1.1")!, cidr), false);
  assert.equal(parseCidr("192.168.0.0"), null);
  assert.equal(parseCidr("192.168.0.0/33"), null);
  assert.equal(parseCidr("192.168.0.0/24/1"), null);
});

test("only private addresses and specific private subnets are accepted", () => {
  for (const ok of ["10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.0.31", "100.100.1.1"]) assert.equal(isPrivateIPv4(ok), true, ok);
  for (const bad of ["0.0.0.0", "127.0.0.1", "8.8.8.8", "172.32.0.1", "255.255.255.255"]) assert.equal(isPrivateIPv4(bad), false, bad);
  assert.equal(isAllowedNetwork("192.168.0.0/24"), true);
  assert.equal(isAllowedNetwork("10.20.0.0/16"), true);
  assert.equal(isAllowedNetwork("10.0.0.0/8"), false);
  assert.equal(isAllowedNetwork("0.0.0.0/0"), false);
  assert.equal(isAllowedNetwork("8.8.8.0/24"), false);
});

test("settings schema rejects wildcard and public bind addresses and wide networks", () => {
  const parse = (v: unknown) => networkSettings.schema.safeParse(v).success;
  assert.equal(parse({}), true);
  assert.deepEqual(networkSettings.schema.parse({}), { enabled: false, bindHost: "", allowedNetworks: [] });
  assert.equal(parse({ bindHost: "", allowedNetworks: [] }), true);
  assert.equal(parse({ bindHost: "192.168.0.31", allowedNetworks: ["192.168.0.0/24"] }), true);
  assert.equal(parse({ bindHost: "0.0.0.0", allowedNetworks: ["192.168.0.0/24"] }), false);
  assert.equal(parse({ bindHost: "203.0.113.5", allowedNetworks: ["192.168.0.0/24"] }), false);
  assert.equal(parse({ bindHost: "192.168.0.31", allowedNetworks: ["0.0.0.0/0"] }), false);
  assert.equal(parse({ enabled: true, bindHost: "", allowedNetworks: ["192.168.0.0/24"] }), false);
  assert.equal(parse({ enabled: true, bindHost: "192.168.0.31", allowedNetworks: [] }), false);
  assert.equal(parse({ enabled: false, bindHost: "192.168.0.31", allowedNetworks: [] }), true);
});

test("LAN access needs the switch and both fields; otherwise the server stays on loopback", () => {
  const lan = { bindHost: "192.168.0.31", allowedNetworks: ["192.168.0.0/24"] };
  assert.deepEqual(resolveNetwork(null), { host: "127.0.0.1", allow: [] });
  assert.equal(resolveNetwork({ enabled: false, ...lan }).host, "127.0.0.1");
  assert.equal(resolveNetwork({ enabled: true, bindHost: "192.168.0.31", allowedNetworks: [] }).host, "127.0.0.1");
  assert.equal(resolveNetwork({ enabled: true, ...lan }).host, "192.168.0.31");
});

test("clientAllowed admits the bind host and allowed networks only", () => {
  const lan = resolveNetwork({ enabled: true, bindHost: "192.168.0.31", allowedNetworks: ["192.168.0.0/24"] });
  assert.equal(clientAllowed(lan, "192.168.0.31"), true);
  assert.equal(clientAllowed(lan, "::ffff:192.168.0.50"), true);
  assert.equal(clientAllowed(lan, "192.168.1.50"), false);
  assert.equal(clientAllowed(lan, "10.0.0.5"), false);
  assert.equal(clientAllowed(lan, "fe80::1"), false);
  assert.equal(clientAllowed(resolveNetwork(null), "127.0.0.1"), true);
});

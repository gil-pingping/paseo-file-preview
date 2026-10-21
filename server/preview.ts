import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream";
import type { PreviewKind } from "../shared/preview.ts";
import { mediaHtml, viewerHtml } from "./viewer.ts";

export const KINDS: Record<string, PreviewKind> = {
  ".pdf": "pdf",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
  ".avif": "image", ".bmp": "image", ".svg": "image", ".ico": "image",
  ".mp4": "video", ".m4v": "video", ".mov": "video", ".webm": "video",
  ".mp3": "audio", ".m4a": "audio", ".wav": "audio", ".ogg": "audio", ".flac": "audio",
  ".html": "html", ".htm": "html",
};
// Only these extensions are served; anything else (.env, keys, source) is refused.
export const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  // Subresources of previewed HTML (reports often load sibling scripts). The per-workspace token
  // limits a page to its own workspace's files.
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};
const PDFJS_MIME: Record<string, string> = {
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
};
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "venv", "__pycache__", "Library", "Pods", "DerivedData", "target"]);
const SCAN_ENTRY_LIMIT = 200_000;
const MAX_RESULTS = 5_000;
// Workspace files may be untrusted (cloned repos). Their scripts run in an opaque origin so they
// cannot read other files, and cannot reach other localhost services or submit forms.
const FILE_CSP =
  "sandbox allow-scripts allow-popups allow-modals allow-downloads; " +
  "default-src 'self' data: blob: https: 'unsafe-inline'; form-action 'none'";

/** Paseo API subset the handlers need; the plugin context's `paseo` satisfies it. */
export interface WorkspaceLookup {
  workspaces: { ref(id: string): { refresh(): Promise<{ workspaceDirectory?: string | null } | null> } };
}

// One token per workspace root: a previewed page learns only its own workspace's token.
const rootByToken = new Map<string, string>();
const tokenByRoot = new Map<string, string>();
let server: Server | null = null;
let starting: Promise<number> | null = null;
let port = 0;
let pdfjsRoot = "";

export function isInside(root: string, target: string): boolean {
  if (!target) return false;
  const rel = path.relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

/** Returns the byte range, null for no/invalid header, or "unsatisfiable" for a 416. */
export function parseRange(header: string | undefined, size: number): [number, number] | "unsatisfiable" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = Math.min(m[1] && m[2] ? Number(m[2]) : size - 1, size - 1);
  if (!m[1] && Number(m[2]) === 0) return "unsatisfiable";
  return start <= end ? [start, end] : "unsatisfiable";
}

/** Absolute file path → URL path segments, so relative links inside HTML resolve to siblings. */
export function toUrlPath(file: string): string {
  return file.split(path.sep).map(encodeURIComponent).join("/").replace(/^\//, "");
}

export function fromUrlPath(urlPath: string): string {
  const file = urlPath.split("/").map(decodeURIComponent).join(path.sep);
  return path.sep === "/" ? "/" + file : file;
}

// ponytail: the daemon evals a bundle (no import.meta.url/__dirname), so locate our install
// from the daemon config. Switch if the plugin API ever exposes its own directory.
export function pluginDir(): string {
  if (process.env.FILE_PREVIEW_DIR) return process.env.FILE_PREVIEW_DIR;
  const home = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
  const config = JSON.parse(readFileSync(path.join(home, "config.json"), "utf8"));
  const dir = config?.plugins?.["file-preview"]?.path;
  if (typeof dir !== "string") throw new Error("file-preview: plugin path missing from Paseo config.json");
  return dir;
}

/** pdfjs-dist location, walking up from the plugin directory like Node resolution (npm hoists). */
export function findPdfjsRoot(dir?: string): string {
  if (process.env.FILE_PREVIEW_PDFJS_ROOT) return process.env.FILE_PREVIEW_PDFJS_ROOT;
  for (let current = path.resolve(dir ?? pluginDir()); ; current = path.dirname(current)) {
    const candidate = path.join(current, "node_modules", "pdfjs-dist");
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(current) === current) break;
  }
  throw new Error("file-preview: pdfjs-dist is not installed; run `npm ci --omit=dev` in the plugin directory");
}

/** A workspace-relative "/" path → its real path, rejecting anything outside the workspace. */
export async function resolveWorkspaceFile(workspaceId: string, relative: string, paseo: WorkspaceLookup) {
  const root = await workspaceRoot(workspaceId, paseo);
  const file = await realpath(path.join(root, ...relative.split("/")));
  if (!isInside(root, file)) throw new Error("File is outside the workspace");
  return { root, file };
}

/** pdf.js install directory, or "" when pdfjs-dist is missing. */
export function pdfjsDir(): string {
  try {
    pdfjsRoot ||= findPdfjsRoot();
  } catch (error) {
    console.warn(String(error));
  }
  return pdfjsRoot;
}

async function workspaceRoot(workspaceId: string, paseo: WorkspaceLookup): Promise<string> {
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new Error(`Workspace ${workspaceId} has no directory`);
  return realpath(workspace.workspaceDirectory);
}

export async function listPreviews({ workspaceId }: { workspaceId: string }, { paseo }: { paseo: WorkspaceLookup }) {
  const root = await workspaceRoot(workspaceId, paseo);
  const found: { path: string; kind: PreviewKind; mtime: number; size: number }[] = [];
  const stack = [root];
  let visited = 0;
  while (stack.length > 0 && visited < SCAN_ENTRY_LIMIT) {
    const dir = stack.pop()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    visited += entries.length;
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(file);
        continue;
      }
      const kind = entry.isFile() ? KINDS[path.extname(entry.name).toLowerCase()] : undefined;
      if (!kind) continue;
      const info = await stat(file).catch(() => null);
      if (info) {
        found.push({ path: path.relative(root, file).split(path.sep).join("/"), kind, mtime: info.mtimeMs, size: info.size });
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return { files: found.slice(0, MAX_RESULTS), total: found.length, truncated: stack.length > 0 };
}

export async function openPreview(
  { workspaceId, path: relative }: { workspaceId: string; path: string },
  { paseo }: { paseo: WorkspaceLookup },
) {
  const { root, file } = await resolveWorkspaceFile(workspaceId, relative, paseo);
  let token = tokenByRoot.get(root);
  if (!token) {
    token = randomBytes(16).toString("hex");
    tokenByRoot.set(root, token);
    rootByToken.set(token, root);
  }
  const listening = await ensureServer();
  // Paseo's browser tab renders HTML directly but shows a blank page for a bare image, video, audio,
  // or PDF document, so those open inside a wrapper page.
  const kind = KINDS[path.extname(file).toLowerCase()];
  const route = kind && kind !== "html" ? "view" : "f";
  return { url: `http://127.0.0.1:${listening}/${token}/${route}/${toUrlPath(file)}` };
}

export function stopServer(): void {
  server?.close();
  server?.closeAllConnections();
  server = null;
  starting = null;
}

function ensureServer(): Promise<number> {
  starting ??= new Promise<number>((resolve, reject) => {
    // Without pdf.js, images/video/HTML still work; the PDF viewer reports the missing install.
    pdfjsDir();
    const s = createServer((req, res) => {
      handle(req, res).catch((error) => send(res, error instanceof URIError ? 400 : 500, "error"));
    });
    s.once("error", (error) => {
      starting = null;
      reject(error);
    });
    s.listen(0, "127.0.0.1", () => {
      server = s;
      port = (s.address() as { port: number }).port;
      resolve(port);
    });
  });
  return starting;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Host check blocks DNS rebinding; the token blocks other local pages guessing URLs.
  if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, "forbidden");
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
  const { pathname } = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const [, token = "", route, ...rest] = pathname.split("/");
  const root = rootByToken.get(token);
  if (!root) return send(res, 404, "not found");
  const tail = rest.join("/");

  // Lets the client check whether it can reach this server (same machine) before opening a tab.
  if (route === "ping") {
    res.writeHead(204, { "cache-control": "no-store", "access-control-allow-origin": "*" });
    return void res.end();
  }
  if (route === "view" || route === "f") {
    // ponytail: realpath then open is a TOCTOU window; a local process that can swap files
    // inside the workspace already has the access this would grant.
    const target = await realpath(fromUrlPath(tail)).catch(() => "");
    if (!isInside(root, target)) return send(res, 403, "forbidden");
    if (route === "view") {
      const kind = KINDS[path.extname(target).toLowerCase()];
      if (!kind || kind === "html") return send(res, 403, "forbidden");
      const fileUrl = `/${token}/f/${toUrlPath(target)}`;
      if (kind !== "pdf") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "content-security-policy":
            "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'",
        });
        res.end(mediaHtml(fileUrl, path.basename(target), kind));
        return;
      }
      const nonce = randomBytes(16).toString("base64");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          `default-src 'none'; script-src 'self' 'nonce-${nonce}'; worker-src 'self'; connect-src 'self'; ` +
          "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; " +
          "form-action 'none'; base-uri 'none'",
      });
      res.end(viewerHtml(`/${token}`, fileUrl, path.basename(target), nonce));
      return;
    }
    const type = MIME[path.extname(target).toLowerCase()];
    if (!type) return send(res, 403, "forbidden");
    return sendFile(req, res, target, type, { "content-security-policy": FILE_CSP });
  }
  if (route === "pdfjs") {
    if (!pdfjsRoot) return send(res, 404, "pdfjs-dist is not installed");
    const target = path.join(pdfjsRoot, ...tail.split("/").map(decodeURIComponent));
    const type = PDFJS_MIME[path.extname(target)];
    if (!type || !isInside(pdfjsRoot, target)) return send(res, 404, "not found");
    return sendFile(req, res, target, type, { "cache-control": "max-age=86400" });
  }
  send(res, 404, "not found");
}

async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  type: string,
  extra: Record<string, string>,
): Promise<void> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return send(res, 404, "not found");
  const headers = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    ...extra,
  };
  const range = parseRange(req.headers.range, info.size);
  if (range === "unsatisfiable") {
    res.writeHead(416, { ...headers, "content-range": `bytes */${info.size}` });
    return void res.end();
  }
  const [start, end] = range ?? [0, info.size - 1];
  res.writeHead(range ? 206 : 200, {
    ...headers,
    "content-length": Math.max(0, end - start + 1),
    ...(range ? { "content-range": `bytes ${start}-${end}/${info.size}` } : {}),
  });
  if (req.method === "HEAD" || info.size === 0) return void res.end();
  // pipeline destroys the file stream when the client aborts (video seeks do this constantly).
  pipeline(createReadStream(file, { start, end }), res, () => {});
}

function send(res: ServerResponse, status: number, body: string): void {
  if (!res.headersSent) res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

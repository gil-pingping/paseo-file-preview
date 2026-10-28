import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { KINDS, MIME, pdfjsDir, pluginDir, resolveWorkspaceFile, type WorkspaceLookup } from "./preview.ts";

// In-panel viewing for clients that cannot reach the daemon host's 127.0.0.1 (mobile app, remote
// desktop). Plugin RPC is the only channel that crosses the relay, so file bytes travel through it.

const IMAGE_CHUNK = 384 * 1024; // multiple of 3: base64 chunks concatenate into valid base64
const IMAGE_LIMIT = 20 * 1024 * 1024;
const PDF_LIMIT = 200 * 1024 * 1024;
const PAGE_WIDTH = { min: 320, max: 1800 };

type Ctx = { paseo: WorkspaceLookup };

export async function readImage({ workspaceId, path: relative, offset }: { workspaceId: string; path: string; offset: number }, { paseo }: Ctx) {
  const { file } = await resolveWorkspaceFile(workspaceId, relative, paseo);
  const ext = path.extname(file).toLowerCase();
  if (KINDS[ext] !== "image") throw new Error("Not an image");
  const { size } = await stat(file);
  if (size > IMAGE_LIMIT) throw new Error(`Image is larger than ${IMAGE_LIMIT / 1024 / 1024} MB`);
  if (offset % IMAGE_CHUNK !== 0 || offset > size) throw new Error("Bad offset");
  const length = Math.min(IMAGE_CHUNK, size - offset);
  const handle = await open(file);
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    return { base64: buffer.toString("base64"), size, mime: MIME[ext], next: offset + length, done: offset + length >= size };
  } finally {
    await handle.close();
  }
}

export async function pdfInfo({ workspaceId, path: relative }: { workspaceId: string; path: string }, { paseo }: Ctx) {
  const file = await pdfFile(workspaceId, relative, paseo);
  return (await render({ op: "info", file })) as { pages: number };
}

export async function pdfPage(
  { workspaceId, path: relative, page, width }: { workspaceId: string; path: string; page: number; width: number },
  { paseo }: Ctx,
) {
  const file = await pdfFile(workspaceId, relative, paseo);
  const target = Math.min(Math.max(Math.round(width), PAGE_WIDTH.min), PAGE_WIDTH.max);
  return (await render({ op: "page", file, page, width: target })) as { base64: string; width: number; height: number };
}

async function pdfFile(workspaceId: string, relative: string, paseo: WorkspaceLookup): Promise<string> {
  const { file } = await resolveWorkspaceFile(workspaceId, relative, paseo);
  if (KINDS[path.extname(file).toLowerCase()] !== "pdf") throw new Error("Not a PDF");
  if ((await stat(file)).size > PDF_LIMIT) throw new Error(`PDF is larger than ${PDF_LIMIT / 1024 / 1024} MB`);
  return file;
}

// PDF rendering runs in server/pdf-worker.mjs under the system `node`: Paseo Desktop's plugin
// runtime cannot load the native canvas addon that pdf.js needs. Installing this plugin already
// requires npm on the daemon host, so `node` is there too.
let worker: ChildProcessWithoutNullStreams | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { child: ChildProcessWithoutNullStreams; resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function startWorker(): ChildProcessWithoutNullStreams {
  const root = pdfjsDir();
  if (!root) throw new Error("The PDF viewer (pdfjs-dist) is not installed on the daemon host");
  const child = spawn(process.env.FILE_PREVIEW_NODE ?? "node", [path.join(pluginDir(), "server", "pdf-worker.mjs"), root], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32", // own process group, so killWorker reaches a shim's child
  });
  const fail = (error: Error) => failWorker(child, error);
  child.on("error", (error) =>
    fail(new Error(/ENOENT/.test(String(error)) ? "PDF rendering needs Node.js (`node`) on the daemon host" : String(error))),
  );
  child.on("exit", (code) => fail(new Error(`PDF renderer exited (${code})`)));
  child.stdin.on("error", () => {}); // a dead worker's EPIPE; the exit handler reports the failure
  child.stderr.on("data", (chunk) => console.warn(`[pdf-worker] ${String(chunk).trim()}`));
  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      return; // a reply cut short when the worker was killed; the exit handler rejects its request
    }
    const { id, error, ...result } = reply;
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (error) call.reject(new Error(error));
    else call.resolve(result);
  });
  return child;
}

/** Signals the worker's process group: a version-manager shim (Volta) may run the real node as its child. */
function killWorker(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, signal);
  } catch {
    child.kill(signal);
  }
}

/** Rejects the requests sent to `child` and forgets it, so the next request starts a fresh worker. */
function failWorker(child: ChildProcessWithoutNullStreams, error: Error): void {
  for (const [id, call] of pending) {
    if (call.child !== child) continue;
    pending.delete(id);
    call.reject(error);
  }
  if (worker === child) worker = null;
}

function render(request: Record<string, unknown>): Promise<unknown> {
  worker ??= startWorker();
  const child = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // pdf.js cannot cancel a parse or render once it holds the worker's event loop, so a stuck
      // worker would keep its CPU and memory forever. Kill it; queued requests fail with this one.
      failWorker(child, new Error("PDF rendering timed out"));
      killWorker(child, "SIGKILL");
    }, Number(process.env.FILE_PREVIEW_RENDER_TIMEOUT_MS) || 60_000);
    pending.set(id, {
      child,
      resolve: (value) => (clearTimeout(timer), resolve(value)),
      reject: (error) => (clearTimeout(timer), reject(error)),
    });
    child.stdin.write(JSON.stringify({ id, ...request }) + "\n");
  });
}

export function closePdfs(): void {
  worker?.stdin.end();
  if (worker) killWorker(worker, "SIGTERM");
  worker = null;
}

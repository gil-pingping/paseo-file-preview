// PDF page renderer, run with the system `node` as a child of the plugin.
// Paseo Desktop's plugin runtime (a hardened, signed Electron helper on macOS) refuses to load
// third-party native addons, and pdf.js needs @napi-rs/canvas to rasterize pages in Node.
//
// Protocol: one JSON request per stdin line, one JSON response per stdout line.
//   { id, op: "info", file }                 -> { id, pages }
//   { id, op: "page", file, page, width }     -> { id, base64, width, height }
//   any failure                               -> { id, error }
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// stdout carries the protocol; keep library warnings off it.
console.log = console.info = console.warn = (...args) => process.stderr.write(args.join(" ") + "\n");

const pdfjsRoot = process.argv[2];
const pdfjs = await import(pathToFileURL(path.join(pdfjsRoot, "legacy", "build", "pdf.mjs")).href);
const OPEN_DOCS = 3;
const docs = new Map();

async function openPdf(file) {
  const { mtimeMs } = await stat(file);
  const key = `${file}:${mtimeMs}`;
  let doc = docs.get(key);
  if (doc) {
    docs.delete(key); // refresh LRU position
  } else {
    const task = pdfjs.getDocument({
      data: new Uint8Array(await readFile(file)),
      cMapUrl: path.join(pdfjsRoot, "cmaps") + path.sep,
      cMapPacked: true,
      standardFontDataUrl: path.join(pdfjsRoot, "standard_fonts") + path.sep,
      isEvalSupported: false,
      verbosity: 0,
    });
    task.onPassword = () => task.destroy();
    doc = task.promise.catch((error) => {
      docs.delete(key);
      throw new Error(/password|destroy/i.test(String(error)) ? "This PDF is password protected" : `Could not open PDF: ${error}`);
    });
  }
  docs.set(key, doc);
  while (docs.size > OPEN_DOCS) {
    const [oldest, oldDoc] = docs.entries().next().value;
    docs.delete(oldest);
    oldDoc.then((d) => d.destroy()).catch(() => {});
  }
  return doc;
}

async function handle({ op, file, page, width }) {
  const doc = await openPdf(file);
  if (op === "info") return { pages: doc.numPages };
  if (page > doc.numPages) throw new Error("No such page");
  const pdfPage = await doc.getPage(page);
  try {
    const viewport = pdfPage.getViewport({ scale: width / pdfPage.getViewport({ scale: 1 }).width });
    const { canvas, context } = doc.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    const jpeg = canvas.toBuffer("image/jpeg", 85);
    return { base64: jpeg.toString("base64"), width: canvas.width, height: canvas.height };
  } finally {
    pdfPage.cleanup();
  }
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let id = null;
  try {
    const request = JSON.parse(line);
    id = request.id;
    process.stdout.write(JSON.stringify({ id, ...(await handle(request)) }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ id, error: error instanceof Error ? error.message : String(error) }) + "\n");
  }
});
process.stdin.on("end", () => process.exit(0));

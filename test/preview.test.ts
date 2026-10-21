import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, utimes, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.FILE_PREVIEW_PDFJS_ROOT = path.resolve("node_modules/pdfjs-dist");
process.env.FILE_PREVIEW_DIR = path.resolve(".");
const { findPdfjsRoot, fromUrlPath, isInside, listPreviews, openPreview, parseRange, stopServer, toUrlPath } =
  await import("../server/preview.ts");

test("RPC contracts load (Paseo rejects names that are not lowercase)", async () => {
  const contracts = await import("../shared/preview.ts");
  const names = Object.values(contracts).flatMap((c) => (c && typeof c === "object" && "name" in c ? [c.name] : []));
  assert.deepEqual(names.sort(), ["preview.list", "preview.open", "preview.pdf-info", "preview.pdf-page", "preview.read-image"]);
});

test("UI strings follow the locale: Korean for ko, English otherwise", async () => {
  const { strings } = await import("../shared/i18n.ts");
  assert.equal(strings("ko-KR").panelTitle, "미리보기");
  assert.equal(strings("en-US").panelTitle, "Preview");
  assert.equal(strings("ja-JP").panelTitle, "Preview");
});

test("isInside rejects root itself, siblings, and traversal", () => {
  assert.equal(isInside("/a/b", "/a/b/c.pdf"), true);
  assert.equal(isInside("/a/b", "/a/b/..cache/c.pdf"), true);
  assert.equal(isInside("/a/b", "/a/b"), false);
  assert.equal(isInside("/a/b", "/a/bc/x.pdf"), false);
  assert.equal(isInside("/a/b", "/a/b/../c.pdf"), false);
  assert.equal(isInside("/a/b", ""), false);
});

test("parseRange handles open, suffix, clamped, and unsatisfiable ranges", () => {
  assert.deepEqual(parseRange("bytes=0-", 10), [0, 9]);
  assert.deepEqual(parseRange("bytes=2-4", 10), [2, 4]);
  assert.deepEqual(parseRange("bytes=-3", 10), [7, 9]);
  assert.deepEqual(parseRange("bytes=5-99", 10), [5, 9]);
  assert.equal(parseRange("bytes=20-", 10), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", 10), "unsatisfiable");
  assert.equal(parseRange("items=0-1", 10), null);
  assert.equal(parseRange(undefined, 10), null);
});

test("URL paths round-trip names with spaces, #, %, ?, and Korean", () => {
  const file = "/tmp/한글 폴더/img #1 100%?.png";
  assert.equal(toUrlPath(file).includes("#"), false);
  assert.equal(fromUrlPath(toUrlPath(file)), file);
});

test("findPdfjsRoot walks up from the plugin directory like Node resolution", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "file-preview-root-"));
  const hoisted = path.join(tmp, "node_modules", "pdfjs-dist");
  await mkdir(path.join(tmp, "node_modules", "file-preview"), { recursive: true });
  await mkdir(hoisted, { recursive: true });
  await writeFile(path.join(hoisted, "package.json"), "{}");
  const saved = process.env.FILE_PREVIEW_PDFJS_ROOT;
  delete process.env.FILE_PREVIEW_PDFJS_ROOT;
  try {
    assert.equal(findPdfjsRoot(path.join(tmp, "node_modules", "file-preview")), hoisted);
  } finally {
    process.env.FILE_PREVIEW_PDFJS_ROOT = saved;
  }
});

function get(url: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request(url, { headers, method }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Stand-in for the plugin context's Paseo API: workspace ID → directory. */
function fakePaseo(directories: Record<string, string>) {
  return {
    paseo: {
      workspaces: {
        ref: (id: string) => ({ refresh: async () => (directories[id] ? { workspaceDirectory: directories[id] } : null) }),
      },
    },
  };
}

test("server lists, opens, and serves only workspace files", async (t) => {
  t.after(stopServer);
  const tmp = await mkdtemp(path.join(tmpdir(), "file-preview-"));
  const root = path.join(tmp, "ws");
  const other = path.join(tmp, "other");
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await mkdir(path.join(root, "site"), { recursive: true });
  await mkdir(other);
  await writeFile(path.join(root, "old.pdf"), "%PDF-old");
  await writeFile(path.join(root, "new #1.png"), "0123456789");
  await writeFile(path.join(root, "site", "index.html"), "<link href=style.css>");
  await writeFile(path.join(root, "site", "style.css"), "body{}");
  await writeFile(path.join(root, ".env"), "SECRET=1");
  await writeFile(path.join(root, "note.txt"), "not listed");
  await writeFile(path.join(root, ".hidden.png"), "skip");
  await writeFile(path.join(root, "node_modules", "dep.png"), "skip");
  await writeFile(path.join(other, "other.png"), "other");
  await writeFile(path.join(tmp, "secret.png"), "secret");
  await symlink(path.join(tmp, "secret.png"), path.join(root, "link.png"));
  await utimes(path.join(root, "old.pdf"), new Date(2000, 0, 1), new Date(2000, 0, 1));
  const ctx = fakePaseo({ ws: root, other });

  const list = await listPreviews({ workspaceId: "ws" }, ctx);
  assert.deepEqual(list.files.map((f) => `${f.kind}:${f.path}`).sort(), [
    "html:site/index.html",
    "image:new #1.png",
    "pdf:old.pdf",
  ]);
  assert.equal(list.files.at(-1)?.path, "old.pdf", "sorted newest first");

  await assert.rejects(listPreviews({ workspaceId: "missing" }, ctx));
  await assert.rejects(openPreview({ workspaceId: "ws", path: "../secret.png" }, ctx));
  await assert.rejects(openPreview({ workspaceId: "ws", path: "link.png" }, ctx));

  // Concurrent opens share one server.
  const [a, b] = await Promise.all([
    openPreview({ workspaceId: "ws", path: "new #1.png" }, ctx),
    openPreview({ workspaceId: "ws", path: "old.pdf" }, ctx),
  ]);
  assert.equal(new URL(a.url).port, new URL(b.url).port);

  const viewUrl = b.url;
  assert.match(viewUrl, /\/view\//);
  const view = await get(viewUrl);
  assert.equal(view.status, 200);
  assert.ok(view.body.includes(new URL(viewUrl.replace("/view/", "/f/")).pathname), "viewer points at the raw file");
  assert.match(String(view.headers["content-security-policy"]), /script-src 'self' 'nonce-/);

  // Images open in a wrapper page (a bare image document is blank in Paseo's browser tab).
  assert.match(a.url, /\/view\//);
  const imagePage = await get(a.url);
  assert.equal(imagePage.status, 200);
  assert.match(imagePage.body, /<img src="[^"]*\/f\/[^"]*new%20%231\.png"/);
  assert.match(String(imagePage.headers["content-security-policy"]), /default-src 'none'; img-src 'self'/);
  const pngUrl = a.url.replace("/view/", "/f/");
  const png = await get(pngUrl);
  assert.equal(png.body, "0123456789");
  assert.match(String(png.headers["content-security-policy"]), /^sandbox .*form-action 'none'/);
  assert.equal(png.headers["x-content-type-options"], "nosniff");
  assert.equal(png.headers["referrer-policy"], "no-referrer");
  const partial = await get(pngUrl, { range: "bytes=2-4" });
  assert.equal(partial.status, 206);
  assert.equal(partial.body, "234");
  assert.equal((await get(pngUrl, { range: "bytes=99-" })).status, 416);
  const head = await get(pngUrl, {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-length"], "10");

  const { url: htmlUrl } = await openPreview({ workspaceId: "ws", path: "site/index.html" }, ctx);
  assert.match(htmlUrl, /\/f\//, "HTML opens directly");
  assert.equal((await get(new URL("style.css", htmlUrl).href)).body, "body{}", "relative assets resolve");

  const origin = new URL(pngUrl).origin;
  const token = new URL(pngUrl).pathname.split("/")[1];
  const fileUrl = (file: string, t = token) => `${origin}/${t}/f/${toUrlPath(file)}`;
  assert.equal((await get(fileUrl(path.join(root, ".env")))).status, 403, "unlisted extensions are refused");
  assert.equal((await get(fileUrl(path.join(tmp, "secret.png")))).status, 403);
  assert.equal((await get(fileUrl(path.join(root, "link.png")))).status, 403);
  assert.equal((await get(pngUrl, { host: "evil.example:80" })).status, 403);
  assert.equal((await get(fileUrl(path.join(root, "old.pdf"), "wrongtoken"))).status, 404);
  assert.equal((await get(`${origin}/${token}/pdfjs/build/pdf.min.mjs`)).status, 200);
  assert.equal((await get(`${origin}/${token}/pdfjs/%2E%2E/package.json`)).status, 404);
  assert.equal((await get(pngUrl, {}, "POST")).status, 405);
  assert.equal((await get(`${origin}/${token}/f/%E0%A4%A`)).status, 400);
  assert.equal((await get(`${origin}/${token}/view/${toUrlPath(path.join(root, ".env"))}`)).status, 403, "wrapper refuses unlisted types");
  assert.equal((await get(htmlUrl.replace("/f/", "/view/"))).status, 403, "wrapper refuses HTML");

  // Each workspace gets its own token; one workspace's token cannot reach another's files.
  const { url: otherUrl } = await openPreview({ workspaceId: "other", path: "other.png" }, ctx);
  const otherToken = new URL(otherUrl).pathname.split("/")[1];
  assert.notEqual(otherToken, token);
  assert.equal((await get(otherUrl.replace("/view/", "/f/"))).body, "other");
  assert.equal((await get(fileUrl(path.join(other, "other.png")))).status, 403);
  assert.equal((await get(fileUrl(path.join(root, "new #1.png"), otherToken))).status, 403);
});

test("remote viewing: image chunks reassemble, PDF pages render, other files are refused", async (t) => {
  const { readImage, pdfInfo, pdfPage, closePdfs } = await import("../server/remote.ts");
  t.after(closePdfs);
  const tmp = await mkdtemp(path.join(tmpdir(), "file-preview-remote-"));
  // A 1 MB "image" spans three 384 KB chunks.
  const bytes = Buffer.alloc(1024 * 1024, 7);
  await writeFile(path.join(tmp, "big.png"), bytes);
  await writeFile(path.join(tmp, "notes.txt"), "secret");
  const ctx = fakePaseo({ ws: tmp });

  let base64 = "";
  for (let offset = 0, n = 0; ; n++) {
    const chunk = await readImage({ workspaceId: "ws", path: "big.png", offset }, ctx);
    assert.equal(chunk.mime, "image/png");
    base64 += chunk.base64;
    if (chunk.done) {
      assert.equal(n, 2, "three chunks");
      break;
    }
    offset = chunk.next;
  }
  assert.ok(Buffer.from(base64, "base64").equals(bytes), "chunks concatenate to the original bytes");
  await assert.rejects(readImage({ workspaceId: "ws", path: "notes.txt", offset: 0 }, ctx), /Not an image/);
  await assert.rejects(readImage({ workspaceId: "ws", path: "big.png", offset: 5 }, ctx), /Bad offset/);
  await assert.rejects(readImage({ workspaceId: "ws", path: "../../etc/hosts", offset: 0 }, ctx));

  await writeFile(path.join(tmp, "doc.pdf"), minimalPdf());
  const info = await pdfInfo({ workspaceId: "ws", path: "doc.pdf" }, ctx);
  assert.ok(info.pages >= 1);
  const page = await pdfPage({ workspaceId: "ws", path: "doc.pdf", page: 1, width: 600 }, ctx);
  assert.equal(page.width, 600);
  assert.ok(Buffer.from(page.base64, "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), "JPEG bytes");
  await assert.rejects(pdfPage({ workspaceId: "ws", path: "doc.pdf", page: 99, width: 600 }, ctx), /No such page/);
  await assert.rejects(pdfInfo({ workspaceId: "ws", path: "big.png" }, ctx), /Not a PDF/);
});

test("ping answers under a valid token only", async (t) => {
  t.after(stopServer);
  const tmp = await mkdtemp(path.join(tmpdir(), "file-preview-ping-"));
  await writeFile(path.join(tmp, "a.png"), "x");
  const { url } = await openPreview({ workspaceId: "ws", path: "a.png" }, fakePaseo({ ws: tmp }));
  const base = url.split("/").slice(0, 4).join("/");
  assert.equal((await get(`${base}/ping`)).status, 204);
  assert.equal((await get(`${new URL(url).origin}/nope/ping`)).status, 404);
});

/** Smallest valid one-page PDF, built with correct xref offsets. */
function minimalPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 4 0 R >>",
    "<< /Length 35 >>\nstream\n0 0 1 rg 20 20 160 260 re f\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((obj, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("pdf worker answers in-flight requests after stdin closes", async () => {
  const { spawn } = await import("node:child_process");
  const tmp = await mkdtemp(path.join(tmpdir(), "file-preview-worker-"));
  const file = path.join(tmp, "doc.pdf");
  await writeFile(file, minimalPdf());
  const child = spawn("node", ["server/pdf-worker.mjs", path.resolve("node_modules/pdfjs-dist")]);
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stdin.end(
    [{ id: 1, op: "info", file }, { id: 2, op: "page", file, page: 1, width: 400 }].map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  const code = await new Promise((resolve) => child.on("exit", resolve));
  const replies = out.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(code, 0);
  assert.deepEqual(replies.map((r) => r.id).sort(), [1, 2]);
  assert.equal(replies.find((r) => r.id === 2).width, 400);
});

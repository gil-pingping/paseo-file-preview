import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, utimes, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.FILE_PREVIEW_PDFJS_ROOT = path.resolve("node_modules/pdfjs-dist");
const { findPdfjsRoot, fromUrlPath, isInside, listPreviews, openPreview, parseRange, stopServer, toUrlPath } =
  await import("../server/preview.ts");

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

  const pngUrl = a.url;
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

  // Each workspace gets its own token; one workspace's token cannot reach another's files.
  const { url: otherUrl } = await openPreview({ workspaceId: "other", path: "other.png" }, ctx);
  const otherToken = new URL(otherUrl).pathname.split("/")[1];
  assert.notEqual(otherToken, token);
  assert.equal((await get(otherUrl)).body, "other");
  assert.equal((await get(fileUrl(path.join(other, "other.png")))).status, 403);
  assert.equal((await get(fileUrl(path.join(root, "new #1.png"), otherToken))).status, 403);
});

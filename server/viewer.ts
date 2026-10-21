// PDF viewer page. Paseo's in-app browser shows Chromium's built-in PDF viewer as a blank
// page, so PDFs render through pdf.js instead. `base` is the token-scoped URL prefix.
export function viewerHtml(base: string, fileUrl: string, title: string, nonce: string): string {
  return `<!doctype html>
<html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${base}/pdfjs/web/pdf_viewer.css">
<style>
  :root { color-scheme: dark; font: 13px -apple-system, BlinkMacSystemFont, sans-serif; }
  body { margin: 0; background: #3b3b3b; color: #eee; }
  #bar { position: fixed; inset: 0 0 auto 0; height: 36px; display: flex; gap: 6px; align-items: center;
         padding: 0 8px; background: #262626; border-bottom: 1px solid #111; z-index: 10; }
  #bar button, #bar input { background: #3a3a3a; color: #eee; border: 1px solid #555; border-radius: 4px; height: 24px; }
  #bar button { min-width: 28px; cursor: pointer; }
  #bar input { padding: 0 6px; }
  #page { width: 44px; text-align: right; }
  #query { width: 180px; margin-left: auto; }
  #status { min-width: 70px; color: #aaa; }
  #c { position: absolute; inset: 37px 0 0 0; overflow: auto; }
  #msg { position: fixed; inset: 37px 0 0 0; display: none; place-items: center; text-align: center; padding: 24px; }
  #msg form { display: flex; gap: 6px; justify-content: center; margin-top: 10px; }
</style>
<div id="bar">
  <button id="prev">↑</button><button id="next">↓</button>
  <input id="page" inputmode="numeric"> <span id="count">/ –</span>
  <button id="out">−</button><button id="in">+</button>
  <button id="fit">↔</button>
  <input id="query" type="search">
  <span id="status"></span>
</div>
<div id="c"><div id="v" class="pdfViewer"></div></div>
<div id="msg"></div>
<script type="module" nonce="${nonce}">
const $ = (id) => document.getElementById(id);
const T = navigator.language.toLowerCase().startsWith("ko")
  ? { prev: "이전 페이지", next: "다음 페이지", page: "페이지", out: "축소 (⌘-)", in: "확대 (⌘+)", fit: "폭 맞춤 (⌘0)",
      search: "검색 (⌘F)", noMatch: "결과 없음", locked: "암호로 보호된 PDF입니다.", wrong: "암호가 틀렸습니다.",
      password: "암호", unlock: "열기", failed: "PDF를 열 수 없습니다.", noViewer: "PDF 뷰어(pdfjs-dist)가 설치되지 않았습니다." }
  : { prev: "Previous page", next: "Next page", page: "Page", out: "Zoom out (⌘-)", in: "Zoom in (⌘+)", fit: "Fit width (⌘0)",
      search: "Search (⌘F)", noMatch: "No matches", locked: "This PDF is password protected.", wrong: "Incorrect password.",
      password: "Password", unlock: "Open", failed: "Could not open this PDF.", noViewer: "The PDF viewer (pdfjs-dist) is not installed." };
document.documentElement.lang = navigator.language;
for (const id of ["prev", "next", "out", "in", "fit"]) $(id).title = $(id).ariaLabel = T[id];
$("page").ariaLabel = T.page;
$("query").placeholder = $("query").ariaLabel = T.search;
const showMessage = (text, detail) => {
  const box = $("msg");
  box.replaceChildren(text);
  if (detail) box.append(document.createElement("br"), Object.assign(document.createElement("small"), { textContent: detail }));
  box.style.display = "grid";
};
try {
  const pdfjsLib = await import(${JSON.stringify(`${base}/pdfjs/build/pdf.min.mjs`)}).catch(() => {
    throw new Error(T.noViewer);
  });
  pdfjsLib.GlobalWorkerOptions.workerSrc = ${JSON.stringify(`${base}/pdfjs/build/pdf.worker.min.mjs`)};
  globalThis.pdfjsLib = pdfjsLib;
  const { EventBus, PDFFindController, PDFLinkService, PDFViewer } = await import(${JSON.stringify(`${base}/pdfjs/web/pdf_viewer.mjs`)});

  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const findController = new PDFFindController({ eventBus, linkService });
  const viewer = new PDFViewer({ container: $("c"), viewer: $("v"), eventBus, linkService, findController });
  linkService.setViewer(viewer);

  let fitWidth = true;
  const fit = () => { fitWidth = true; viewer.currentScaleValue = "page-width"; };
  eventBus.on("pagesinit", () => { fit(); $("page").value = viewer.currentPageNumber; });
  addEventListener("resize", () => { if (fitWidth) fit(); });
  eventBus.on("pagechanging", ({ pageNumber }) => { $("page").value = pageNumber; });
  $("prev").onclick = () => viewer.previousPage();
  $("next").onclick = () => viewer.nextPage();
  $("page").onchange = () => { viewer.currentPageNumber = Math.min(Math.max(1, Number($("page").value) || 1), viewer.pagesCount); };
  $("in").onclick = () => { fitWidth = false; viewer.increaseScale(); };
  $("out").onclick = () => { fitWidth = false; viewer.decreaseScale(); };
  $("fit").onclick = fit;

  const find = (type, findPrevious = false) => eventBus.dispatch("find", {
    source: null, type, query: $("query").value, caseSensitive: false, entireWord: false,
    highlightAll: true, findPrevious, matchDiacritics: false,
  });
  $("query").oninput = () => find("");
  $("query").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); find("again", e.shiftKey); } };
  const showMatches = ({ state, matchesCount }) => {
    if (!$("query").value) $("status").textContent = "";
    else if (state === 1) $("status").textContent = T.noMatch;
    else if (matchesCount?.total) $("status").textContent = matchesCount.current + " / " + matchesCount.total;
  };
  eventBus.on("updatefindcontrolstate", showMatches);
  eventBus.on("updatefindmatchescount", ({ matchesCount }) => showMatches({ state: 0, matchesCount }));

  addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === "f") { e.preventDefault(); $("query").focus(); $("query").select(); }
    else if (e.key === "=" || e.key === "+") { e.preventDefault(); $("in").click(); }
    else if (e.key === "-") { e.preventDefault(); $("out").click(); }
    else if (e.key === "0") { e.preventDefault(); fit(); }
  });

  const task = pdfjsLib.getDocument({
    url: ${JSON.stringify(fileUrl)},
    cMapUrl: ${JSON.stringify(`${base}/pdfjs/cmaps/`)},
    cMapPacked: true,
    standardFontDataUrl: ${JSON.stringify(`${base}/pdfjs/standard_fonts/`)},
    isEvalSupported: false,
  });
  task.onPassword = (update, reason) => {
    showMessage(reason === 2 ? T.wrong : T.locked);
    const form = document.createElement("form");
    const input = Object.assign(document.createElement("input"), { type: "password" });
    input.setAttribute("aria-label", T.password);
    form.append(input, Object.assign(document.createElement("button"), { textContent: T.unlock }));
    form.onsubmit = (e) => {
      e.preventDefault();
      $("msg").style.display = "none";
      update(input.value);
    };
    $("msg").append(form);
    input.focus();
  };
  const doc = await task.promise;
  $("count").textContent = "/ " + doc.numPages;
  viewer.setDocument(doc);
  linkService.setDocument(doc);
} catch (error) {
  showMessage(T.failed, String(error?.message ?? error));
}
</script>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Wrapper page for a bare image, video, or audio file; it needs no script. */
export function mediaHtml(fileUrl: string, title: string, kind: "image" | "video" | "audio"): string {
  const src = escapeHtml(fileUrl);
  const element =
    kind === "image"
      ? `<img src="${src}" alt="${escapeHtml(title)}">`
      : kind === "video"
        ? `<video src="${src}" controls preload="metadata"></video>`
        : `<audio src="${src}" controls preload="metadata"></audio>`;
  return `<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; background: #1e1e1e; }
  body { display: flex; align-items: center; justify-content: center; }
  img, video { max-width: 100%; max-height: 100%; object-fit: contain; }
  audio { width: min(640px, 90%); }
</style>
${element}
`;
}

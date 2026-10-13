# Paseo file preview

Preview PDFs, images, video, audio, and HTML from a Paseo workspace. Paseo's file panel shows "binary preview unavailable" for these files ([getpaseo/paseo#3720](https://github.com/getpaseo/paseo/issues/3720)). This plugin adds a **Preview** panel that lists them newest first. Selecting one opens it in a Paseo browser tab.

- **PDF:** a bundled [pdf.js](https://mozilla.github.io/pdf.js/) viewer with page navigation, zoom, fit to width, full-text search (`⌘F`), and password prompts. Korean, Chinese, and Japanese PDFs render with the bundled CMaps. Paseo's in-app browser shows Chromium's own PDF viewer as a blank page, so pdf.js is required.
- **Images, video, audio, HTML:** served to the browser directly, with HTTP Range support so video can seek. Relative links inside HTML resolve to sibling files.

## Install

Requires Paseo 0.11.1 or newer, plugins enabled on the daemon host, and npm on that host to install pdf.js. Plugins run trusted code on the daemon host; review the source before installing.

```bash
paseo plugin add git:gil-pingping/paseo-file-preview
paseo plugin ls file-preview
```

Then open the right-hand panel's `+` menu in a workspace and choose **Preview** (미리보기).

## How it works

- `preview.list` scans the workspace directory, skipping hidden entries, symlinks, and build folders (`node_modules`, `dist`, `build`, `venv`, `target`, and similar). It returns the 5,000 most recently modified previewable files, and scans up to 50,000.
- `preview.open` starts a Node HTTP server on `127.0.0.1` with a random port and a random 128-bit URL token, then returns a URL that the panel opens with Paseo's `openBrowser`. URLs are created when you select a file, so they stay valid after a plugin reload.

## Security

Workspace files can be untrusted, for example in cloned repositories or downloaded PDFs.

- The server answers only requests whose `Host` is `127.0.0.1:<port>`, which blocks DNS rebinding, and only under the secret token.
- It serves a file only if its real path, after resolving symlinks, is inside a workspace opened from the panel.
- Workspace files are served with `Content-Security-Policy: sandbox` (no `allow-same-origin`) and `X-Content-Type-Options: nosniff`. Scripts in a previewed HTML or SVG file run in an opaque origin and cannot read other files from the server.
- pdf.js runs with `isEvalSupported: false`.

## Limits

- The daemon and the browser must be on the same computer. Remote daemons are not supported.
- Paseo plugin panels cannot embed web pages, so previews open in a separate browser tab, not inside the file tab.
- Opens the in-app browser on Paseo Desktop and the system browser on other clients.
- Office documents are not supported. HTML that loads JavaScript modules or fetches its own files fails inside the sandbox.
- Tested on macOS with Paseo 0.11.1. Windows paths are handled but untested.

## Develop

```bash
npm ci
npm run typecheck
npm test
paseo plugin install "$PWD"   # local development install
```

Server code lives in [`server/`](server), the panel in [`client/panel.tsx`](client/panel.tsx), and RPC contracts in [`shared/preview.ts`](shared/preview.ts). See [`OVERVIEW.md`](OVERVIEW.md) for the in-app description.

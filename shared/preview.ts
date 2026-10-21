import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const previewKinds = ["pdf", "image", "video", "audio", "html"] as const;
export type PreviewKind = (typeof previewKinds)[number];

export const listPreviewsRpc = defineRpc({
  name: "preview.list",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({
    // `path` is relative to the workspace and always uses "/".
    files: z.array(
      z.object({ path: z.string(), kind: z.enum(previewKinds), mtime: z.number(), size: z.number() }),
    ),
    total: z.number(),
    truncated: z.boolean(),
  }),
});

// Resolve the URL at click time: the local server's port and token change when the plugin reloads.
export const openPreviewRpc = defineRpc({
  name: "preview.open",
  input: z.object({ workspaceId: z.string(), path: z.string() }),
  output: z.object({ url: z.string() }),
});

// In-panel viewing for clients that cannot reach the daemon host's 127.0.0.1 (mobile, remote).
// Plugin RPC is the only channel that crosses the relay, so bytes travel through it.

/** Image bytes in chunks; chunk size is a multiple of 3 so base64 pieces concatenate cleanly. */
export const readImageRpc = defineRpc({
  name: "preview.read-image",
  input: z.object({ workspaceId: z.string(), path: z.string(), offset: z.number().int().min(0) }),
  output: z.object({ base64: z.string(), size: z.number(), mime: z.string(), next: z.number(), done: z.boolean() }),
});

export const pdfInfoRpc = defineRpc({
  name: "preview.pdf-info",
  input: z.object({ workspaceId: z.string(), path: z.string() }),
  output: z.object({ pages: z.number() }),
});

/** One PDF page rendered to JPEG on the daemon host. */
export const pdfPageRpc = defineRpc({
  name: "preview.pdf-page",
  input: z.object({ workspaceId: z.string(), path: z.string(), page: z.number().int().min(1), width: z.number() }),
  output: z.object({ base64: z.string(), width: z.number(), height: z.number() }),
});

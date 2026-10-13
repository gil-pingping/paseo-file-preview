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

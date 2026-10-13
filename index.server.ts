import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listPreviews, openPreview, stopServer } from "./server/preview";
import { listPreviewsRpc, openPreviewRpc } from "./shared/preview";

export default function contribute(server: PluginServerContext) {
  server.handle(listPreviewsRpc, listPreviews);
  server.handle(openPreviewRpc, openPreview);
  return stopServer;
}

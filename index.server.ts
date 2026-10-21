import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listPreviews, openPreview, stopServer } from "./server/preview";
import { closePdfs, pdfInfo, pdfPage, readImage } from "./server/remote";
import { listPreviewsRpc, openPreviewRpc, pdfInfoRpc, pdfPageRpc, readImageRpc } from "./shared/preview";

export default function contribute(server: PluginServerContext) {
  server.handle(listPreviewsRpc, listPreviews);
  server.handle(openPreviewRpc, openPreview);
  server.handle(readImageRpc, readImage);
  server.handle(pdfInfoRpc, pdfInfo);
  server.handle(pdfPageRpc, pdfPage);
  return () => {
    stopServer();
    closePdfs();
  };
}

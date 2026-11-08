import type { PluginServerContext } from "@getpaseo/plugin/server";
import { configureNetwork, listPreviews, openPreview, stopServer } from "./server/preview";
import { networkSettings } from "./shared/network";
import { closePdfs, pdfInfo, pdfPage, readImage } from "./server/remote";
import { listPreviewsRpc, openPreviewRpc, pdfInfoRpc, pdfPageRpc, readImageRpc } from "./shared/preview";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(networkSettings);
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) =>
    configureNetwork(state.status === "ready" ? state.values : null);
  void settings.read().then(apply);
  const unsubscribe = settings.subscribe(apply);
  server.handle(listPreviewsRpc, listPreviews);
  server.handle(openPreviewRpc, openPreview);
  server.handle(readImageRpc, readImage);
  server.handle(pdfInfoRpc, pdfInfo);
  server.handle(pdfPageRpc, pdfPage);
  return () => {
    unsubscribe();
    stopServer();
    closePdfs();
  };
}

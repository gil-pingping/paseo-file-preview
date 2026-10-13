import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PreviewPanel } from "./client/panel";
import { strings } from "./shared/i18n";

export default function contribute(client: PluginClientContext) {
  return client.addWorkspacePanel({
    id: "preview",
    title: strings().panelTitle,
    icon: "Eye",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: PreviewPanel,
  });
}

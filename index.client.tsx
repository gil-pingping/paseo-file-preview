import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PreviewPanel } from "./client/panel";
import { NetworkSettings } from "./client/settings";
import { strings } from "./shared/i18n";

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: "network",
    title: strings().lanTitle,
    icon: "Network",
    Component: NetworkSettings,
  });
  const removePanel = client.addWorkspacePanel({
    id: "preview",
    title: strings().panelTitle,
    icon: "Eye",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: PreviewPanel,
  });
  return () => {
    removePanel();
    removeSettings();
  };
}

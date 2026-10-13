import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PreviewPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  return client.addWorkspacePanel({
    id: "preview",
    title: "미리보기",
    icon: "Eye",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: PreviewPanel,
  });
}

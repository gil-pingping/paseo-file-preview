import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { strings } from "../shared/i18n";
import { listPreviewsRpc, openPreviewRpc, previewKinds, type PreviewKind } from "../shared/preview";
import { InlineViewer } from "./inline-viewer";
import { openExternal } from "./web";

const t = strings();
const NO_FILES: never[] = [];
type InlineFile = { path: string; kind: "pdf" | "image" };
const inline = (path: string, kind: PreviewKind): InlineFile | null =>
  kind === "pdf" || kind === "image" ? { path, kind } : null;

/** True when this client can reach the preview server, i.e. it runs on the daemon's computer. */
async function reachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    // url is http://127.0.0.1:<port>/<token>/...; ping lives under the same token.
    await fetch(`${url.split("/").slice(0, 4).join("/")}/ping`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function PreviewPanel({ workspaceId, theme, navigation }: PluginWorkspacePanelProps) {
  // Rescan when the workspace moves; the server resolves the directory from the ID itself.
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const listPreviews = useRpc(listPreviewsRpc);
  const openPreview = useRpc(openPreviewRpc);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<PreviewKind | null>(null);
  const [viewing, setViewing] = useState<InlineFile | null>(null);
  const query = useQuery({
    queryKey: ["file-preview", workspaceId, directory],
    queryFn: () => listPreviews({ workspaceId }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  // Same computer: open a browser tab (full pdf.js viewer, video, HTML). Otherwise (mobile app,
  // remote desktop) show PDFs and images inside the panel over RPC.
  const open = useMutation({
    mutationFn: async ({ path, kind }: { path: string; kind: PreviewKind }) => {
      const { url } = await openPreview({ workspaceId, path });
      if (await reachable(url)) {
        if (navigation?.openBrowser) navigation.openBrowser({ url, workspaceId });
        else await openExternal(url);
        return;
      }
      const file = inline(path, kind);
      if (!file) throw new Error(t.remoteUnsupported);
      setViewing(file);
    },
  });

  const all = query.data?.files ?? NO_FILES;
  const counts = useMemo(() => {
    const result: Partial<Record<PreviewKind, number>> = {};
    for (const file of all) result[file.kind] = (result[file.kind] ?? 0) + 1;
    return result;
  }, [all]);
  const files = useMemo(() => {
    const needle = filter.trim().normalize("NFC").toLowerCase();
    return all.filter(
      (file) => (!kind || file.kind === kind) && file.path.normalize("NFC").toLowerCase().includes(needle),
    );
  }, [all, filter, kind]);

  const { colors } = theme;
  if (viewing) {
    return (
      <InlineViewer
        workspaceId={workspaceId}
        path={viewing.path}
        kind={viewing.kind}
        colors={colors}
        onBack={() => setViewing(null)}
      />
    );
  }
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.border,
        backgroundColor: active ? colors.accent : "transparent",
      }}
    >
      <Text style={{ fontSize: 11, color: active ? colors.accentForeground : colors.foregroundMuted }}>{label}</Text>
    </Pressable>
  );
  const notice = (text: string) => (
    <Text style={{ color: colors.foregroundMuted, paddingHorizontal: 8, paddingBottom: 4, fontSize: 11 }}>{text}</Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <View style={{ flexDirection: "row", gap: 8, padding: 8, paddingBottom: 4 }}>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder={t.filterPlaceholder}
          placeholderTextColor={colors.foregroundMuted}
          accessibilityLabel={t.filterPlaceholder}
          style={{
            flex: 1,
            color: colors.foreground,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={t.refresh} onPress={() => query.refetch()}>
          <Text style={{ color: colors.foregroundMuted, padding: 4 }}>{query.isFetching ? "…" : "↻"}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, paddingHorizontal: 8, paddingBottom: 6 }}>
        {chip(`${t.all} ${all.length}`, kind === null, () => setKind(null))}
        {previewKinds
          .filter((k) => counts[k])
          .map((k) => chip(`${t.kinds[k]} ${counts[k]}`, kind === k, () => setKind(kind === k ? null : k)))}
      </View>
      {query.isError ? notice(`${t.listFailed}: ${String(query.error)}`) : null}
      {open.isError ? notice(`${t.openFailed}: ${open.error instanceof Error ? open.error.message : String(open.error)}`) : null}
      {query.data && query.data.total > all.length ? notice(t.truncated(all.length, query.data.total)) : null}
      <FlatList
        data={files}
        keyExtractor={(file) => file.path}
        ListEmptyComponent={notice(query.isLoading ? t.loading : t.empty)}
        ListFooterComponent={files.length > 0 ? notice(t.viewHint) : null}
        renderItem={({ item }) => {
          const slash = item.path.lastIndexOf("/");
          return (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t.open(t.kinds[item.kind], item.path)}
              onPress={() => {
                if (!open.isPending) open.mutate({ path: item.path, kind: item.kind });
              }}
              onLongPress={() => setViewing(inline(item.path, item.kind))}
              style={({ pressed }) => ({
                paddingHorizontal: 8,
                paddingVertical: 6,
                backgroundColor: pressed ? colors.surface2 : "transparent",
              })}
            >
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Text style={{ fontSize: 10, color: colors.foregroundMuted, width: 38 }}>{t.kinds[item.kind]}</Text>
                <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground }}>
                  {item.path.slice(slash + 1)}
                </Text>
              </View>
              <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, marginLeft: 44 }}>
                {formatDate(item.mtime)} · {formatSize(item.size)}
                {slash > 0 ? ` · ${item.path.slice(0, slash)}` : ""}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

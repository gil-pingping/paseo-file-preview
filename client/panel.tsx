import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { listPreviewsRpc, openPreviewRpc, previewKinds, type PreviewKind } from "../shared/preview";
import { openExternal } from "./web";

const KIND_LABELS: Record<PreviewKind, string> = {
  pdf: "PDF",
  image: "이미지",
  video: "영상",
  audio: "오디오",
  html: "HTML",
};

const NO_FILES: never[] = [];

export function PreviewPanel({ workspaceId, theme, navigation }: PluginWorkspacePanelProps) {
  // Rescan when the workspace moves; the server resolves the directory from the ID itself.
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const listPreviews = useRpc(listPreviewsRpc);
  const openPreview = useRpc(openPreviewRpc);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<PreviewKind | null>(null);
  const query = useQuery({
    queryKey: ["file-preview", workspaceId, directory],
    queryFn: () => listPreviews({ workspaceId }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const open = useMutation({
    mutationFn: (path: string) => openPreview({ workspaceId, path }),
    onSuccess: ({ url }) => {
      if (navigation?.openBrowser) navigation.openBrowser({ url, workspaceId });
      else void openExternal(url);
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
          placeholder="파일 이름 필터"
          placeholderTextColor={colors.foregroundMuted}
          accessibilityLabel="파일 이름 필터"
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
        <Pressable accessibilityRole="button" accessibilityLabel="새로고침" onPress={() => query.refetch()}>
          <Text style={{ color: colors.foregroundMuted, padding: 4 }}>{query.isFetching ? "…" : "↻"}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, paddingHorizontal: 8, paddingBottom: 6 }}>
        {chip(`전체 ${all.length}`, kind === null, () => setKind(null))}
        {previewKinds
          .filter((k) => counts[k])
          .map((k) => chip(`${KIND_LABELS[k]} ${counts[k]}`, kind === k, () => setKind(kind === k ? null : k)))}
      </View>
      {query.isError ? notice(`목록을 불러오지 못했습니다: ${String(query.error)}`) : null}
      {open.isError ? notice(`열지 못했습니다: ${String(open.error)}`) : null}
      {query.data && query.data.total > all.length ? notice(`최근 수정된 ${all.length}개만 표시 (전체 ${query.data.total}개)`) : null}
      <FlatList
        data={files}
        keyExtractor={(file) => file.path}
        ListEmptyComponent={notice(query.isLoading ? "불러오는 중…" : "미리볼 파일 없음")}
        renderItem={({ item }) => {
          const slash = item.path.lastIndexOf("/");
          return (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${KIND_LABELS[item.kind]} ${item.path} 열기`}
              onPress={() => {
                if (!open.isPending) open.mutate(item.path);
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 8,
                paddingVertical: 6,
                backgroundColor: pressed ? colors.surface2 : "transparent",
              })}
            >
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Text style={{ fontSize: 10, color: colors.foregroundMuted, width: 38 }}>{KIND_LABELS[item.kind]}</Text>
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

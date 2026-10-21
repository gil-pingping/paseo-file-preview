import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Image, PixelRatio, Pressable, ScrollView, Text, View } from "react-native";
import { strings } from "../shared/i18n";
import { pdfInfoRpc, pdfPageRpc, readImageRpc } from "../shared/preview";

const t = strings();
type Colors = PluginWorkspacePanelProps["theme"]["colors"];

/** Shows a PDF or image inside the panel, with bytes fetched over plugin RPC (works remotely). */
export function InlineViewer(props: {
  workspaceId: string;
  path: string;
  kind: "pdf" | "image";
  colors: Colors;
  onBack: () => void;
}) {
  const { colors, path, kind, onBack } = props;
  const [width, setWidth] = useState(0);
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onBack}>
          <Text style={{ color: colors.accent, paddingVertical: 4, paddingRight: 4 }}>‹ {t.back}</Text>
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground }}>
          {path.split("/").pop()}
        </Text>
      </View>
      <View style={{ flex: 1 }} onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
        {width === 0 ? null : kind === "image" ? (
          <ImageView {...props} width={width} />
        ) : (
          <PdfView {...props} width={width} />
        )}
      </View>
    </View>
  );
}

function ImageView({ workspaceId, path, colors, width }: { workspaceId: string; path: string; colors: Colors; width: number }) {
  const readImage = useRpc(readImageRpc);
  const image = useQuery({
    queryKey: ["file-preview", "image", workspaceId, path],
    queryFn: async () => {
      let base64 = "";
      for (let offset = 0; ; ) {
        const chunk = await readImage({ workspaceId, path, offset });
        base64 += chunk.base64;
        if (chunk.done) return `data:${chunk.mime};base64,${base64}`;
        offset = chunk.next;
      }
    },
    staleTime: Infinity,
    gcTime: 60_000,
  });
  const [ratio, setRatio] = useState(1);
  useEffect(() => {
    if (image.data) Image.getSize(image.data, (w, h) => h > 0 && setRatio(w / h), () => {});
  }, [image.data]);

  if (!image.data) return <Status colors={colors} text={image.isError ? String(image.error) : t.loading} />;
  return (
    <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={{ padding: 8 }}>
      <Image source={{ uri: image.data }} resizeMode="contain" style={{ width: width - 16, aspectRatio: ratio }} />
    </ScrollView>
  );
}

function PdfView({ workspaceId, path, colors, width }: { workspaceId: string; path: string; colors: Colors; width: number }) {
  const pdfInfo = useRpc(pdfInfoRpc);
  const info = useQuery({
    queryKey: ["file-preview", "pdf-info", workspaceId, path],
    queryFn: () => pdfInfo({ workspaceId, path }),
    staleTime: 60_000,
  });
  const pages = useMemo(() => Array.from({ length: info.data?.pages ?? 0 }, (_, i) => i + 1), [info.data]);

  if (!info.data) return <Status colors={colors} text={info.isError ? String(info.error) : t.loading} />;
  return (
    <FlatList
      data={pages}
      keyExtractor={String}
      initialNumToRender={2}
      windowSize={5}
      ListHeaderComponent={
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, paddingHorizontal: 8 }}>{t.pages(pages.length)}</Text>
      }
      renderItem={({ item }) => (
        <PdfPage workspaceId={workspaceId} path={path} page={item} width={width - 16} border={colors.border} />
      )}
    />
  );
}

function PdfPage(props: { workspaceId: string; path: string; page: number; width: number; border: string }) {
  const { workspaceId, path, page, width, border } = props;
  const pdfPage = useRpc(pdfPageRpc);
  // Render at device resolution, capped server-side.
  const pixels = Math.round(width * PixelRatio.get());
  const rendered = useQuery({
    queryKey: ["file-preview", "pdf-page", workspaceId, path, page, pixels],
    queryFn: () => pdfPage({ workspaceId, path, page, width: pixels }),
    staleTime: Infinity,
    gcTime: 120_000,
  });
  const ratio = rendered.data ? rendered.data.width / rendered.data.height : 1 / 1.414;
  return (
    <View
      style={{ margin: 8, width, aspectRatio: ratio, backgroundColor: "#ffffff", justifyContent: "center", borderWidth: 1, borderColor: border }}
    >
      {rendered.data ? (
        <Image
          accessibilityLabel={t.page(page)}
          source={{ uri: `data:image/jpeg;base64,${rendered.data.base64}` }}
          style={{ width, aspectRatio: ratio }}
        />
      ) : (
        <Text style={{ color: "#888888", textAlign: "center" }}>
          {rendered.isError ? String(rendered.error) : `${t.page(page)} · ${t.loading}`}
        </Text>
      )}
    </View>
  );
}

function Status({ colors, text }: { colors: Colors; text: string }) {
  return <Text style={{ color: colors.foregroundMuted, padding: 12 }}>{text}</Text>;
}

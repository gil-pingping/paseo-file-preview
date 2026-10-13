// Paseo exposes no locale to plugins, so follow the runtime's Intl locale: Korean or English.
const en = {
  panelTitle: "Preview",
  filterPlaceholder: "Filter by name",
  refresh: "Refresh",
  all: "All",
  kinds: { pdf: "PDF", image: "Image", video: "Video", audio: "Audio", html: "HTML" },
  loading: "Loading…",
  empty: "No previewable files",
  listFailed: "Could not list files",
  openFailed: "Could not open",
  truncated: (shown: number, total: number) => `Showing the ${shown} most recent of ${total} files`,
  open: (kind: string, path: string) => `Open ${kind} ${path}`,
};

const ko: typeof en = {
  panelTitle: "미리보기",
  filterPlaceholder: "파일 이름 필터",
  refresh: "새로고침",
  all: "전체",
  kinds: { pdf: "PDF", image: "이미지", video: "영상", audio: "오디오", html: "HTML" },
  loading: "불러오는 중…",
  empty: "미리볼 파일 없음",
  listFailed: "목록을 불러오지 못했습니다",
  openFailed: "열지 못했습니다",
  truncated: (shown, total) => `최근 수정된 ${shown}개만 표시 (전체 ${total}개)`,
  open: (kind, path) => `${kind} ${path} 열기`,
};

export type Strings = typeof en;

export function strings(locale = runtimeLocale()): Strings {
  return locale.toLowerCase().startsWith("ko") ? ko : en;
}

function runtimeLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en";
  }
}

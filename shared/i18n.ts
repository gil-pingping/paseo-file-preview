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
  back: "Back",
  pages: (n: number) => (n === 1 ? "1 page" : `${n} pages`),
  page: (n: number) => `Page ${n}`,
  remoteUnsupported:
    "This device cannot reach the daemon's computer. Video, audio, and HTML previews need Paseo Desktop on that computer, or LAN access in this plugin's settings.",
  viewHint: "Long-press a PDF or image to view it here.",
  pdfPassword:
    "Password-protected PDFs can't open in the panel. Open the file in Paseo Desktop on the daemon's computer, where the PDF viewer asks for the password.",
  lanTitle: "LAN access",
  lanIntro: "Let other devices on your network open video, audio, and HTML previews. When off, they open only on the daemon's computer.",
  lanToggle: "Allow LAN access",
  lanWarningTitle: "Security warning",
  lanWarning:
    "While this is on, any device in the allowed networks that has a preview link can download the file behind it: PDFs, images, video, audio, and HTML in workspaces you opened in the Preview panel. Turn it on only on a network you trust, and turn it off when you're done.",
  lanHost: "This computer's address",
  lanHostHint: "A private IPv4 address of the daemon's computer. Use one that doesn't change.",
  lanHostPlaceholder: "e.g. 192.168.0.10",
  lanHostInvalid: "Enter a private IPv4 address (10.x, 172.16-31.x, 192.168.x, or 100.64-127.x).",
  lanNetworks: "Allowed networks",
  lanNetworksHint: "Private IPv4 ranges, separated by commas. Ranges wider than /16 aren't allowed.",
  lanNetworksPlaceholder: "e.g. 192.168.0.0/24",
  lanNetworksInvalid: "Enter private IPv4 ranges no wider than /16, such as 192.168.0.0/24.",
  lanMissing: "To turn this on, enter this computer's address and at least one allowed network.",
  lanStatusOn: (host: string) => `On · serving previews at ${host}`,
  lanStatusOff: "Off · previews stay on 127.0.0.1",
  save: "Save",
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
  back: "뒤로",
  pages: (n) => `${n}쪽`,
  page: (n) => `${n}쪽`,
  remoteUnsupported: "이 기기에서는 데몬이 도는 컴퓨터에 직접 연결할 수 없어요. 영상·오디오·HTML은 그 컴퓨터의 Paseo 데스크톱에서 열거나, 이 플러그인 설정에서 LAN 접근을 켜 주세요.",
  viewHint: "PDF·이미지를 길게 누르면 여기서 바로 볼 수 있어요.",
  pdfPassword: "암호가 걸린 PDF는 패널에서 열 수 없어요. 데몬이 도는 컴퓨터의 Paseo 데스크톱에서 열면 암호를 입력할 수 있어요.",
  lanTitle: "LAN 접근",
  lanIntro: "같은 네트워크의 다른 기기에서도 영상·오디오·HTML 미리보기를 열 수 있어요. 끄면 데몬이 도는 컴퓨터에서만 열려요.",
  lanToggle: "LAN 접근 허용",
  lanWarningTitle: "보안 경고",
  lanWarning:
    "켜 두는 동안에는 허용 네트워크의 어느 기기든 미리보기 링크만 있으면 그 파일을 내려받을 수 있어요. 대상은 미리보기 패널에서 연 워크스페이스의 PDF·이미지·영상·오디오·HTML이에요. 믿을 수 있는 네트워크에서만 켜고, 다 쓰면 꺼 주세요.",
  lanHost: "이 컴퓨터의 주소",
  lanHostHint: "데몬이 도는 컴퓨터의 사설 IPv4 주소예요. 바뀌지 않는 주소를 쓰세요.",
  lanHostPlaceholder: "예: 192.168.0.10",
  lanHostInvalid: "사설 IPv4 주소를 입력해 주세요 (10.x, 172.16-31.x, 192.168.x, 100.64-127.x).",
  lanNetworks: "허용 네트워크",
  lanNetworksHint: "사설 IPv4 대역을 쉼표로 구분해 적어 주세요. /16보다 넓은 대역은 쓸 수 없어요.",
  lanNetworksPlaceholder: "예: 192.168.0.0/24",
  lanNetworksInvalid: "/16보다 넓지 않은 사설 IPv4 대역을 입력해 주세요. 예: 192.168.0.0/24",
  lanMissing: "켜려면 이 컴퓨터의 주소와 허용 네트워크를 하나 이상 입력해 주세요.",
  lanStatusOn: (host) => `켜짐 · ${host}에서 미리보기를 제공해요`,
  lanStatusOff: "꺼짐 · 127.0.0.1에서만 미리보기를 제공해요",
  save: "저장",
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

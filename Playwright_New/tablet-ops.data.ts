// ──────────────────────────────────────────────────────────────
//  태블릿 운영 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
//  3화면: 태블릿 기능 설정 / 메시지 관리 / 홀 이벤트 관리
// ──────────────────────────────────────────────────────────────

export const MENU = '태블릿 운영 관리';

export const SCREEN = {
  feature: {
    sub: '태블릿 기능 설정',
    urlPart: '/club/page/live-game',
    guide: '태블릿에서 사용 가능한 기능들을 설정',
    // 섹션명(공백 정규식 매칭용)
    sectionGameRx: /경기\s*진행\s*설정/,
    sectionMsgCols: ['상세 메시지', '수정일시', '작성자', '관리'],
  },
  message: {
    sub: '메시지 관리',
    urlPart: '/club/page/live-message',
    guide: '자주 사용하는 메시지를 등록',
    tabs: ['태블릿 메시지', '셀프모드 메시지', '뒷카트 알림 메시지', '센터 메시지', '분실물'] as const,
    columns: ['제목', '메시지', '관리'],
  },
  holeEvent: {
    sub: '홀 이벤트 관리',
    urlPart: '/club/page/live-hole-event',
    guide: '700 X 480',
    columns: ['코스', '홀 번호', '홀이벤트', '이미지', '이벤트 노출시간', '관리'],
  },
} as const;

// 가공되지 않은 코드/오타 탐지 패턴
export const RAW_CODE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Vue 보간식 {{ }}', re: /\{\{[\s\S]{0,40}?\}\}/ },
  { name: 'undefined', re: /\bundefined\b/ },
  { name: 'NaN', re: /(^|[^A-Za-z])NaN([^A-Za-z]|$)/ },
  { name: '[object Object]', re: /\[object Object\]/ },
  { name: 'JSON 노출', re: /\{\s*"\w+"\s*:/ },
  { name: 'i18n 키 $t(', re: /\$t\(/ },
  { name: 'Vue 디렉티브', re: /\bv-(if|for|bind|model|show)\b/ },
  { name: 'null 값 노출', re: /(^|[^가-힣A-Za-z])null([^A-Za-z]|$)/ },
];

export const TIMEOUT = { load: 15_000, action: 8_000 };

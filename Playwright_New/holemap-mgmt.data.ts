// ──────────────────────────────────────────────────────────────
//  홀맵 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
//  4화면: 홀맵 구역 설정 / 카트패스 진입여부 설정 / 티샷 유의 거리 설정 / 홀맵 미리보기
// ──────────────────────────────────────────────────────────────

export const MENU = '홀맵 관리';

export const SCREEN = {
  zone: {
    sub: '홀맵 구역 설정',
    urlPart: '/club/page/holemap-zone-management',
    guide: '홀맵 구역',
    columns: ['No', '코스', '홀', 'PAR', '야디지', '위험구역', 'OB구역', '패널티구역', '관리'],
    resetBtn: '초기화',
    applyBtn: '적용',
    zoneBtn: '구역관리',
  },
  cartEntrance: {
    sub: '카트패스 진입여부 설정',
    urlPart: '/club/page/holemap-cart-entrance',
    guide: '카트패스',
    courseTabs: ['South', 'West'],
    btnAllAllow: '전체 허용',
    btnAllRestrict: '전체 제한',
    btnHoleSave: '홀별 설정 저장',
  },
  teeshot: {
    sub: '티샷 유의 거리 설정',
    urlPart: '/club/page/holemap-teeshot-distance',
    guide: '티박스',
    courseTab: 'South',
    inputPh: '미입력',
    resetBtn: '초기화',
    saveBtn: '저장',
  },
  preview: {
    sub: '홀맵 미리보기',
    urlPart: '/club/page/holemap-preview',
    guide: '태블릿에 실제로',
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

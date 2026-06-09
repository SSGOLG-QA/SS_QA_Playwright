// ──────────────────────────────────────────────────────────────
//  라운드 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
//  기획서/TC 미참조. 화면 실제 노출값 기반.
// ──────────────────────────────────────────────────────────────

export const MENU = '라운드 관리';

export const SCREEN = {
  visit: {
    sub: '내장 현황',
    urlPart: '/club/page/round-visit',
    guide: '골프장에 방문한 일별 내장객수',          // info-box 부분 문구
    exportBtn: '내보내기',                            // (리뉴얼: 구 '엑셀파일 다운로드')
    columns: ['날짜', '총 내장객', '유효 내장객', '출력률'],
  },
  stats: {
    sub: '내장 통계',
    urlPart: '/club/page/round-visit-statistics',
    guide: '스마트스코어 회원이 내장하여',
    applyBtn: '적용',
    resetBtn: '초기화',
  },
  all: {
    sub: '전체 라운드',
    urlPart: '/club/page/round-all',
    guide: '태블릿에서 전송된 골프장의 모든 라운드',
    searchPlaceholders: ['내장객 입력', '캐디명 입력', '디바이스 입력', '단체팀 입력', '카트번호 입력'],
    columns: ['순번', '코스', '내장객', '진행시간'],
    applyBtn: '적용',
    resetBtn: '초기화',
  },
  cart: {
    sub: '카트 관리',
    urlPart: '/club/page/cart-all',
    guide: '골프장에서 운영 중인 카트를 관리',
    columns: ['카트번호', '라운드 횟수', '상태', '관리'],
    rowDisableBtn: '사용중지',     // 행 액션 → confirm 모달(취소/확인). ⚠ 확인은 파괴적 → 취소만 검증
  },
} as const;

// 가공되지 않은 코드/오타 탐지 패턴 (화면 본문에 노출되면 안 되는 것)
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

// 모달/알럿
export const ALERT = {
  over1Year: '최대 조회 가능 기간은 1년',   // 내장 통계 1년 초과 조회 시
};

export const TIMEOUT = { load: 15_000, action: 8_000 };

// 계정 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
export const MENU = '계정 관리';

export const SCREEN = {
  list: {
    sub: '계정 리스트', urlPart: '/club/page/account-user', guide: '계정',
    searchPh: '이름을 입력해주세요', applyBtn: '적용', rowActionBtn: '권한변경',
    columns: ['No.', '계정 상태', '부서', '이름', 'ID', '연락처', '권한'],
  },
  permission: {
    sub: '계정 권한 관리', urlPart: '/club/page/account-permission', guide: '권한',
    actionBtns: ['권한 그룹 복사', '권한 그룹 추가', '권한 적용'],
    columns: ['권한 명칭', '기능 명칭'],
  },
} as const;

export const TIMEOUT = { load: 15_000, action: 8_000 };

// 캐디 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
export const MENU = '캐디 관리';

export const SCREEN = {
  list: {
    sub: '캐디 리스트', urlPart: '/club/page/caddie-all', guide: '캐디 현황',
    searchPh: '캐디명을 입력하세요.', applyBtn: '적용',
    columns: ['No', '성명', '성별', '휴대폰', '카트번호', '태블릿 No.', '라운드기록'],
  },
  register: {
    sub: '캐디 등록 관리', urlPart: '/club/page/caddie-register', guide: '수정, 삭제',
    columns: ['성명', '구분', '성별', '휴대폰', '자격취득일', '카트번호', '관리'], delBtn: '삭제',
  },
  performance: {
    sub: '캐디 실적', urlPart: '/club/page/caddie-performance', guide: '애사심',
    columns: ['캐디명', '신규회원 추천수', '유효 내장객수', 'SS회원수', 'SS비율'],
  },
} as const;

export const TIMEOUT = { load: 15_000, action: 8_000 };

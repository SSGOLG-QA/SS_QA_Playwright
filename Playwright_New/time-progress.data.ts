// 경기 진행 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
export const MENU = '경기 진행 관리';

export const SCREEN = {
  standard: { sub: '진행시간 표준 설정', urlPart: '/club/page/control-time-standard', guide: '표준적인 진행시간' },
  realtime: {
    sub: '진행시간 실시간', urlPart: '/club/page/control-time-realtime', guide: '모니터',
    searchPh: ['캐디명', '카트번호', '내장객명'], buttons: ['검색', '초기화', '새로고침', '내보내기', '홀별시각보기'],
    columns: ['티업', '캐디', '전반', '후반', '현재', '전체'],
  },
  search: {
    sub: '진행시간 조회', urlPart: '/club/page/control-time-search', guide: '진행시간',
    buttons: ['검색', '초기화', '내보내기'], columns: ['년도', '티업', '캐디', '전반', '후반'],
  },
  stats: {
    sub: '진행시간 통계', urlPart: '/club/page/control-time-statistics', guide: '통계자료',
    buttons: ['통계자료 작성', '초기화', '내보내기'], columns: ['구분', '라운드', '전반', '후반', '평점'],
  },
} as const;

export const TIMEOUT = { load: 15_000, action: 8_000 };

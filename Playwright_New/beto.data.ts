// 배토 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
export const MENU = '배토 관리';

export const SCREEN = {
  record: {
    sub: '배토 기록 조회', urlPart: '/club/page/topdressing-record', guide: '배토기록을 조회',
    applyBtn: '적용', resetBtn: '초기화', viewBtn: '보기',
    columns: ['No.', '캐디', '시작시간', '종료시간', '작업 경로'],
  },
  stats: {
    sub: '배토 통계', urlPart: '/club/page/topdressing-statistics', guide: '',
    applyBtn: '적용', exportBtn: '내보내기', modeBtns: ['작업자', '작업시간', '일별', '월별'],
    columns: ['No.', '날짜', '작업자 수', '작업시간 합계', '평균 작업시간'],
  },
} as const;

export const TIMEOUT = { load: 15_000, action: 8_000 };

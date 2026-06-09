// 고객 평가 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
export const MENU = '고객 평가 관리';

export const SCREEN = {
  reviewList: {
    sub: '후기 리스트', urlPart: '/club/page/review-list', guide: '후기',
    applyBtn: '적용', presets: ['1주일', '1개월', '3개월', '6개월'],
    columns: ['작성일시', '내용', '작성자', '전체평점', '공감', '비공감', '답변상태'],
  },
  reviewStats: {
    sub: '후기 통계', urlPart: '/club/page/review-statistics', guide: '후기',
    searchBtn: '조회', presets: ['일주일', '15일', '1달'],
    columns: ['순서', '날짜', '등록후기수', '전체', '코스', '그린', '서비스', '진행', '식음료'],
  },
  customerEval: {
    sub: '고객 평가', urlPart: '/club/page/customer-eval-poll', guide: '고객 평가 현황',
    columns: ['기간', '평균 평점', '총 평가 수', '평가팀수'],
  },
  caddieEval: {
    sub: '캐디 평가', urlPart: '/club/page/caddie-evaluation', guide: '캐디에 대한 고객',
    columns: ['태블릿 No.', '캐디명', '평균 평점', '총점', '총 평가 수', '평가팀수'],
  },
} as const;

export const TIMEOUT = { load: 15_000, action: 8_000 };

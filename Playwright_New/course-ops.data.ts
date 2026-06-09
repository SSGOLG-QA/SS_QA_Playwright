// 코스 운영 관리 E2E 테스트 데이터 (상수) — 현재 구현(AS-IS) 기준
export const MENU = '코스 운영 관리';

export const SCREEN = {
  pin: {
    sub: '핀 포지션 관리', urlPart: '/club/page/course-analysis-pin-position',
    guide: '핀 위치', columns: ['코스명', '홀', 'PAR', '야디지', '그린', '핀포지션', '선택'],
  },
  pinHistory: {
    sub: '핀 포지션 변경이력', urlPart: '/club/page/course-analysis-pin-history',
    guide: '이력', columns: ['코스명', '홀 번호', '변경일', '변경시간', '이전 핀위치', '변경 핀위치', '작업자'],
  },
  pinAnalysis: {
    sub: '핀 포지션 분석', urlPart: '/club/page/course-analysis-pin',
    guide: '난이도', columns: ['라운드수', '라운드율', '오버파', '순위', 'SC평균'],
  },
  detail: {
    sub: '코스 분석', urlPart: '/club/page/course-analysis-detail', guide: '분석',
  },
  green: {
    sub: '그린 스피드', urlPart: '/club/page/course-analysis-green-speed',
    guide: '그린 스피드', inputPh: '예) 2.6', editBtn: '수정',
  },
  news: {
    sub: '골프장 소식', urlPart: '/club/page/course-analysis-club-news',
    guide: '골프장의 소식', columns: ['순서', '골프장소식', '노출기간', '노출여부', '작성자'],
    addBtn: '등록', delBtn: '삭제',
  },
} as const;

export const TIMEOUT = { load: 15_000, action: 8_000 };

import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, skip, writeReport } from '../lib/reporter';
import { runDeepScreenE2E } from '../lib/course/deepScreenE2E';

// ──────────────────────────────────────────────────────────────
//  정보 관리 > 홀 별 정보 — 전용 심화 E2E(비파괴). 코스 리뉴얼 정보와 동일 표준.
//  실행: npm run course:auth 후 npm run course:hole-e2e
//  커버(사용자 요청): ① 탭 선택(활성 전환/콘텐츠 변화 — 코스구분/홀 등 자동 감지)
//    ② [수정] 화면 내 입력 필드 전수 입력  ③ datepicker 날짜 선택  ④ [X] 버튼 클리어
//    + [신규 등록] 양 경로 · 라디오 · 항목 추가/삭제 · 파일 · [저장] 활성.
//  ⚠ 비파괴: 폼 조작 후 [취소] 폐기. [저장]은 노출·활성만(클릭=영속 → 금지).
// ──────────────────────────────────────────────────────────────

const P = '정보 관리 > 홀 별 정보';
const R = (n: string) => `코스관리_홀별_${n}`;

test('정보 관리 > 홀 별 정보 심화 E2E(탭·신규등록·수정·입력·datepicker·[X], 비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin: Page = await openCourseAdmin(page, context);

  if (!(await gotoCourseMenu(admin, '정보 관리', '홀 별 정보').catch(() => false))) {
    skip({ path: P, tcRef: R('0'), tcId: 'HOLE-00', desc: '진입' }, '진입 실패(하위메뉴 미노출 — 세션 degraded/만료, course:auth)');
    await writeReport('코스관리_홀별정보E2E'); return;
  }
  await admin.waitForTimeout(1_200); await killAlarms(admin);

  await runDeepScreenE2E(admin, {
    P, R, id: 'HOLE', menu: '정보 관리', sub: '홀 별 정보', battKey: 'HL',
    // 코스 구분(West/East/South 등)·차수·홀 라벨 힌트(자동 감지 보강)
    tabHint: /West|East|South|North|In|Out|\d+\s*차|\d+\s*홀|코스|전반|후반/,
  });

  await killAlarms(admin);
  await writeReport('코스관리_홀별정보E2E');
});

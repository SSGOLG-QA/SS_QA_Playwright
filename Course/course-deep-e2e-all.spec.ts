import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport } from '../lib/reporter';
import { runDeepScreensSweep, filterDeepScreens } from '../lib/course/deepScreenE2E';

// ──────────────────────────────────────────────────────────────
//  E2E 심화만 단독 실행하는 "타깃 재실행 도구"(비파괴). ⚠ 정본(기능+E2E 통합)은 course-suite.spec.ts.
//    - 통합 전체 검증(기능+E2E 단일 리포트)은 `npm run course:suite`(기본 통합) 사용.
//    - 이 스펙은 특정 화면의 E2E만 빠르게 재검증할 때 사용(세션 1런 제약 하 부분 배치).
//  실행: npm run course:auth 후 npm run course:deep-e2e-all
//    (특정 화면만: DEEP_SUBS="홀 별 정보,이슈 관리" · 특정 대메뉴만: DEEP_MENUS="정보 관리,작업 관리")
//  각 화면: 진입 → 탭 이동 → [수정] 폼(입력·[X]클리어·datepicker·항목·라디오·저장활성) → 재진입 → [신규 등록] 폼.
//  ⚠ 비파괴: 저장/등록(submit) 절대 클릭 금지. 폼 미제공(읽기전용/데이터 의존) 화면은 helper가 graceful skip.
//  화면 목록·순회 로직은 lib/course/deepScreenE2E.ts(DEEP_SCREENS/runDeepScreensSweep) — course-suite와 공유.
// ──────────────────────────────────────────────────────────────

test('전 메뉴 심화 E2E 확장(리뉴얼 수준 표준, 비파괴)', async ({ page, context }) => {
  test.setTimeout(1_800_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin: Page = await openCourseAdmin(page, context);

  await runDeepScreensSweep(admin, filterDeepScreens());

  await writeReport('코스관리_전메뉴심화E2E');
});

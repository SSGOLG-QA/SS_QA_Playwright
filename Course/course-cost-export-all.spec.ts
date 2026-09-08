import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import {
  verifyCostAggregate, verifyCostByTask, verifyCostByCategory,
  verifyCostByLocation, verifyCostByPeriod,
} from '../lib/course/costExportVerify';
import { renderReport, Check } from '../lib/course/exportVerifyCommon';

// ──────────────────────────────────────────────────────────────
//  비용 내보내기 정합성 — 전체(5화면) 단일 로그인 순차 검증(비파괴).
//   openCourseAdmin 1회 → 비용집계·작업별·분류별·위치별·기간별 순차 자동 다운로드 대조.
//   실행: npm run course:auth 후
//   npx playwright test --config=Course/playwright.config.ts --project=course Course/course-cost-export-all.spec.ts --no-deps
// ──────────────────────────────────────────────────────────────

test('비용 내보내기 정합성 전체(5화면, 단일 로그인, 비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  const admin: Page = await openCourseAdmin(page, context);
  const all: Check[] = [];
  const perScreen: string[] = [];
  const sections: { label: string; run: (a: Page) => Promise<Check[]> }[] = [
    { label: '비용집계', run: verifyCostAggregate },
    { label: '작업별', run: verifyCostByTask },
    { label: '분류별', run: verifyCostByCategory },
    { label: '위치별', run: verifyCostByLocation },
    { label: '기간별', run: verifyCostByPeriod },
  ];
  for (const s of sections) {
    let cs: Check[] = [];
    try { cs = await s.run(admin); }
    catch (e) { cs = [{ name: `${s.label} 실행`, group: '진입', ok: false, detail: `예외: ${String((e as Error).message).slice(0, 140)}` }]; }
    for (const c of cs) c.group = `${s.label} · ${c.group}`;
    all.push(...cs);
    const p = cs.filter((c) => !c.na && c.ok && !c.review).length; const f = cs.filter((c) => !c.na && !c.ok).length; const r = cs.filter((c) => !c.na && c.ok && c.review).length;
    perScreen.push(`${s.label}: PASS ${p}${r ? ` · 확인 ${r}` : ''}${f ? ` · FAIL ${f}` : ''}`);
  }
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  renderReport(
    'course-cost-export-all',
    '비용 내보내기 정합성 — 전체(5화면)',
    `비용 관리 5화면 · 자동 다운로드 통합 · 단일 로그인 · 킹즈락 · ${ts} · 비파괴`,
    '5화면(비용집계·작업별·분류별·위치별·기간별)의 <b>[내보내기]를 스크립트가 직접 다운로드</b>해 대조. 비용집계·작업별=직접 대조, 분류별·위치별·기간별=<b>화면 롤업 = Σ xlsx 리프</b>(집계). openCourseAdmin 1회 순차. 참고(➖)=판정 제외.',
    all,
    { ts: new Date().toISOString(), perScreen },
  );
  console.log(`\n[화면별] ${perScreen.join(' | ')}`);
});

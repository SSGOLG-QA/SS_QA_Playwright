import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import {
  verifyBudgetSummary, verifyBudgetDetail, verifyBudgetPerf,
  verifyBudgetAnalysis, renderBudgetReport, Check,
} from '../lib/course/budgetExportVerify';

// ──────────────────────────────────────────────────────────────
//  예산 내보내기 정합성 — 전체(5화면) 단일 로그인 순차 검증(비파괴).
//   openCourseAdmin 1회 → 총괄·상세·실적·분석(연간)·분석(월간)을 순차로 자동 다운로드 대조.
//   세션 1런당 1로그인 제약(반복 로그인 마찰) 해소용 통합 진입점. 개별 스펙은 화면별 단독 실행용으로 유지.
//   실행: npm run course:auth 후
//   npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-export-all.spec.ts --no-deps
// ──────────────────────────────────────────────────────────────

test('예산 내보내기 정합성 전체(5화면, 단일 로그인, 비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  const admin: Page = await openCourseAdmin(page, context);
  const all: Check[] = [];
  const perScreen: string[] = [];
  const sections: { label: string; run: (a: Page) => Promise<Check[]> }[] = [
    { label: '총괄', run: verifyBudgetSummary },
    { label: '상세', run: verifyBudgetDetail },
    { label: '실적', run: verifyBudgetPerf },
    { label: '분석', run: verifyBudgetAnalysis },   // 연간+월간 한 번 진입(연속 재진입 레이스 회피)
  ];
  for (const s of sections) {
    let cs: Check[] = [];
    try { cs = await s.run(admin); }
    catch (e) { cs = [{ name: `${s.label} 실행`, group: '진입', ok: false, detail: `예외: ${String((e as Error).message).slice(0, 140)}` }]; }
    for (const c of cs) c.group = `${s.label} · ${c.group}`;   // 화면 라벨 prefix
    all.push(...cs);
    const p = cs.filter((c) => !c.na && c.ok && !c.review).length; const f = cs.filter((c) => !c.na && !c.ok).length; const r = cs.filter((c) => !c.na && c.ok && c.review).length;
    perScreen.push(`${s.label}: PASS ${p}${r ? ` · 확인 ${r}` : ''}${f ? ` · FAIL ${f}` : ''}`);
  }
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  renderBudgetReport(
    'course-budget-export-all',
    '예산 내보내기 정합성 — 전체(5화면)',
    `예산 관리 5화면 · 자동 다운로드 통합 · 단일 로그인 · 킹즈락 · ${ts} · 비파괴`,
    '5화면(총괄 월간+연간 · 상세 · 실적 · 분석 연간 · 분석 월간)의 <b>[내보내기]를 스크립트가 직접 다운로드</b>해 화면·내부불변식·교차로 대조. <b>openCourseAdmin 1회</b>로 순차 진행(세션 1런당 1로그인 준수 · 반복 로그인 마찰 제거). 자동 실패 시 폴백(수동)=🔎. 참고(➖)=판정 제외.',
    all,
    { ts: new Date().toISOString(), perScreen },
  );
  console.log(`\n[화면별] ${perScreen.join(' | ')}`);
});

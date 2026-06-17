import { test } from '../lib/fixtures';
import { runHome, runRoundMgmt, runIA } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetIA } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  통합 검증 (IA + 홈 + 라운드관리) — 단일 진입, 단일 리포트
//  리포트 시트 순서: 요약 → IA 구현여부 → 홈 → 라운드관리 → 미작성TC → SNB有/TC無
//
//  실행: npx playwright test --project=admin-chromium Admin/full-suite.spec.ts --no-deps
// ──────────────────────────────────────────────────────────────
test('통합 검증 (IA + 홈 + 라운드관리)', async ({ admin }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetIA();

  // 홈 (진입 직후 화면)
  await runHome(admin);
  // 라운드관리 (SNB 네비게이션)
  await runRoundMgmt(admin);
  // IA 구현여부 (전 메뉴 순회 — 화면 이동 많아 마지막)
  await runIA(admin);

  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('full-suite'); });

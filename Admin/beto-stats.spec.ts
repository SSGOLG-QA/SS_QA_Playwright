import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { runBetoStats } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 배토 관리 > 배토 통계 - 구조 기반 (2026-06 리뉴얼, /club/page/topdressing-statistics)
//   ⚠ 초기화/적용/내보내기/필터(작업자·작업시간·일별·월별) 전환은 조회(읽기) 동작 → 노출만 검증(비파괴)
//   ※ 구 스펙(레거시 /ss/admin/rounding.html?act=beto_calc · beto-* BEM)은 분석 JSON(실측 DOM) 기준 폐기·재작성
// 실행: npx playwright test --project=admin-chromium Admin/beto-stats.spec.ts --no-deps
test('배토 관리 > 배토 통계 검증 (구조 기반)', async ({ page, context }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  const admin = await openAdmin(page, context);
  if (await gotoMenu(admin, '배토 관리', '배토 통계', { path: '배토 관리 > 배토 통계', tcRef: '배토 관리_배토 통계', tcId: '진입', desc: '배토 통계 진입', failMsg: '메뉴 진입 불가' }))
    await runBetoStats(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('beto-stats'); });

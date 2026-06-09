import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { runCartTrace } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 관제관리 > 카트 이동경로 확인 - 구조 기반 제한 검증 (지도·재생 도구)
//   IA: 관제 관리 하위 — 진입 가능(구현)
//   ⚠ 지도 상호작용·경로재생 제외, 필터·지도·컨트롤 노출만(비파괴)
//   🔴 영문 미한글화·날짜형식(YYYY-MM-DD) → 기획-구현 차이로 기록
// 실행: npx playwright test --project=admin-chromium Admin/cart-trace.spec.ts --no-deps
test('관제관리 > 카트 이동경로 확인 검증 (구조 기반 제한)', async ({ page, context }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  const admin = await openAdmin(page, context);
  if (await gotoMenu(admin, '관제 관리', '카트이동경로 확인', { path: '관제관리 > 카트이동경로 확인', tcRef: '관제 관리_카트이동경로 확인', tcId: '진입', desc: '카트 이동경로 확인 진입', failMsg: '메뉴 진입 불가' }))
    await runCartTrace(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('cart-trace'); });

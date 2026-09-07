import { test } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { verifyMaterialRestock } from '../lib/course/materialRestock';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, skip, writeReport } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────────────────────
//  코스관리 2차 — 자재 "추가 입고" 팝업 자동계산 불변식 검증(비파괴).
//  근거: `2026-09 코스관리_PC 2차` 추가 입고 팝업 TC. 대상: 자재 관리 > 자재 총괄 > [추가 입고].
//  실행: npm run course:auth 후  npm run course:restock
//  비파괴: 팝업 열어 수량·매입가 입력 → 계산값 읽기 → [취소]로 폐기. 저장/[등록]/[입고] 클릭 금지.
//  ⚠ 이 팝업은 baseline 미캡처 → discovery-first(1런에 analysis/_restock-probe_MATRESTOCK.json 덤프로 구조 확정).
// ──────────────────────────────────────────────────────────────────────────────

test('코스관리 2차 — 자재 추가 입고 팝업 자동계산(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  await killAlarms(admin);

  const P = '자재 관리 > 자재 총괄';
  if (!(await gotoCourseMenu(admin, '자재 관리', '자재 총괄').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: '코스관리_자재총괄_0', tcId: 'MATRESTOCK-00', desc: '진입' }, '자재 총괄 진입 실패');
  } else {
    await killAlarms(admin);
    await verifyMaterialRestock(admin, P, '코스관리_자재총괄', 'MATRESTOCK');
  }

  await killAlarms(admin);
  await writeReport('코스관리_자재입고계산');
});

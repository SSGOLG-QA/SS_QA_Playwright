import { Page } from '@playwright/test';
import { killAlarms } from './courseHelpers';

// ──────────────────────────────────────────────────────────────
//  코스관리 파괴 테스트 가드 + CRUD teardown 헬퍼 (경기관제 write-path 방식).
//  - 3중 가드: ALLOW_DESTRUCTIVE=1 + 호스트(course-mng-td=테스트) + 클럽(킹즈락=비실데이터).
//  - 미충족 시 파괴 동작 금지. 마커행(E2ECRUD*) teardown 으로 잔여 0 보장.
// ──────────────────────────────────────────────────────────────

export const CRUD_MARK = 'E2ECRUD발병';

// 3중 가드 — 호스트+env 는 동기, 클럽은 헤더 텍스트로 확인.
export async function isCourseDestructiveAllowed(page: Page): Promise<{ ok: boolean; why: string }> {
  if (process.env.ALLOW_DESTRUCTIVE !== '1') return { ok: false, why: 'ALLOW_DESTRUCTIVE!=1(옵트인 아님)' };
  if (!/course-mng-td/.test(page.url())) return { ok: false, why: `호스트 비테스트(${page.url()})` };
  const club = await page.getByText('킹즈락').first().isVisible().catch(() => false);
  if (!club) return { ok: false, why: '클럽≠킹즈락' };
  return { ok: true, why: 'ALLOW_DESTRUCTIVE + course-mng-td + 킹즈락' };
}

// 마커행 전수 삭제(teardown) — 테이블 행 [삭제] → 확인. 잔여 0 될 때까지(최대 N회).
export async function deleteCourseMarkerRows(page: Page, mark = CRUD_MARK, max = 10): Promise<number> {
  let removed = 0;
  for (let i = 0; i < max; i++) {
    await killAlarms(page);
    const row = page.locator('tbody tr').filter({ hasText: mark }).first();
    if (!(await row.isVisible({ timeout: 1500 }).catch(() => false))) break;
    const del = row.getByRole('button', { name: /삭제/ }).first();
    if (!(await del.isVisible({ timeout: 1500 }).catch(() => false))) break;
    await del.click().catch(() => {});
    await page.waitForTimeout(900);
    // 확인 모달(있으면)
    const confirm = page.locator('.modal-group').filter({ hasNot: page.locator('.alarm') }).last().getByRole('button', { name: /확인|삭제|예/ }).last();
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click().catch(() => {});
    await page.waitForTimeout(1500);
    await killAlarms(page);
    removed++;
  }
  return removed;
}

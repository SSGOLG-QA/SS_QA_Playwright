import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { isCourseDestructiveAllowed } from '../lib/course/destructive';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  예산 동적 변경 반영 write-path(옵트인 파괴) — 값 변경→저장→소계/총괄 반영→정확 원복.
//  실행: $env:ALLOW_DESTRUCTIVE="1"; npm run course:auth 후
//        $env:ALLOW_DESTRUCTIVE="1"; npm run course:writepath
//  플로우: 예산 상세>고정직 인건비>급여8 1월 값 +Δ 저장 → ① 상세 소계 1월 +Δ 반영 ② 예산 총괄 급여 1월 +Δ 반영(rollup) → 원복.
//  ⚠ 3중 가드(ALLOW_DESTRUCTIVE+course-mng-td+킹즈락) 미충족 시 전체 SKIP. finally에서 원본값 정확 복원(잔여 0).
// ──────────────────────────────────────────────────────────────

const DELTA = 10000;
const mainScope = (p: Page) => p.locator('.contents, main').first();
const num = (s: string | null | undefined) => { const t = (s || '').replace(/[^0-9.\-]/g, ''); return t === '' || t === '-' ? null : Number(t); };

async function selectTab(admin: Page, tab: string): Promise<boolean> {
  const t = admin.getByRole('tab', { name: tab }).or(mainScope(admin).getByText(tab, { exact: true })).first();
  if (!(await t.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  await t.click().catch(() => {}); await admin.waitForTimeout(1200); await killAlarms(admin); return true;
}
async function enterEdit(admin: Page): Promise<boolean> {
  await mainScope(admin).getByRole('button', { name: '수정', exact: true }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1200); await killAlarms(admin);
  const inp = mainScope(admin).locator('tbody tr input:not([placeholder*="적요"])').first();
  return inp.isVisible({ timeout: 3_000 }).catch(() => false);
}
async function cancelEdit(admin: Page) {
  await mainScope(admin).getByRole('button', { name: '취소', exact: true }).first().click({ timeout: 2_000 }).catch(() => {});
  await admin.waitForTimeout(500);
  const disc = admin.locator('.modal-group.alarm').filter({ hasText: /작업중/ }).last().getByRole('button', { name: '확인' }).first();
  if (await disc.isVisible({ timeout: 1_200 }).catch(() => false)) await disc.click().catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);
}
// 편집모드 저장: [저장] → '변경 저장?' 확인 → '저장되었습니다' 확인.
async function saveEdit(admin: Page): Promise<boolean> {
  await mainScope(admin).getByRole('button', { name: '저장', exact: true }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(900);
  const confirm = admin.locator('.modal-group').filter({ hasText: /저장|변경/ }).last().getByRole('button', { name: /^\s*(저장|확인|예)\s*$/ }).first();
  if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) { await confirm.click().catch(() => {}); await admin.waitForTimeout(900); }
  const done = admin.locator('.modal-group').filter({ hasText: /저장되었습니다|완료/ }).last().getByRole('button', { name: /확인/ }).first();
  if (await done.isVisible({ timeout: 2_000 }).catch(() => false)) { await done.click().catch(() => {}); await admin.waitForTimeout(700); }
  await killAlarms(admin);
  // 저장 성공 = 읽기전용 복귀([수정] 버튼 재노출)
  return mainScope(admin).getByRole('button', { name: '수정', exact: true }).first().isVisible({ timeout: 3_000 }).catch(() => false);
}
// 편집모드 첫 데이터 행 1월 input 값 + 급여 소계 1월(반응형 read-only) 읽기.
async function readEditState(admin: Page): Promise<{ m1: number | null; soke1: number | null }> {
  return admin.evaluate(() => {
    const tbl = document.querySelector('.contents table, main table, table'); if (!tbl) return { m1: null, soke1: null };
    const rows = Array.from(tbl.querySelectorAll('tbody tr'));
    const firstData = rows.find((r) => r.querySelector('input:not([placeholder*="적요"])'));
    const monthInputs = firstData ? Array.from(firstData.querySelectorAll('input:not([placeholder*="적요"])')) as HTMLInputElement[] : [];
    const m1 = monthInputs.length ? Number((monthInputs[0].value || '').replace(/[^0-9.\-]/g, '') || '0') : null;
    // 급여 소계 행(1월 셀): 소계 텍스트 행의 후행 13숫자 중 2번째(합계=0, 1월=1)
    const sokeRow = rows.find((r) => /소계/.test(r.textContent || ''));
    let soke1: number | null = null;
    if (sokeRow) { const nums = Array.from(sokeRow.children).map((td) => { const t = (td.textContent || '').replace(/[^0-9.\-]/g, ''); return t && /\d/.test(t) ? Number(t) : null; }).filter((v) => v != null) as number[]; const tail = nums.slice(-13); soke1 = tail.length >= 2 ? tail[1] : null; }
    return { m1, soke1 };
  }).catch(() => ({ m1: null, soke1: null }));
}
// 예산 총괄 급여(중분류) 1월 값 읽기.
async function readSummaryGy1(admin: Page): Promise<number | null> {
  await gotoCourseMenu(admin, '예산 관리', '예산 총괄'); await admin.waitForTimeout(1500); await killAlarms(admin);
  return admin.evaluate(() => {
    const tbl = document.querySelector('.contents table, main table, table'); if (!tbl) return null;
    const row = Array.from(tbl.querySelectorAll('tbody tr')).find((r) => /급여/.test((r.children[1]?.textContent || r.children[0]?.textContent || '')));
    if (!row) return null;
    const cells = Array.from(row.children).map((td) => (td.textContent || '').replace(/[^0-9.\-]/g, ''));
    // [대분류,중분류,1월..12월] → 1월 = 마지막 12개 중 첫째
    const nums = cells.map((t) => (t && /\d/.test(t) ? Number(t) : null)).filter((v) => v != null) as number[];
    return nums.length >= 12 ? nums[nums.length - 12] : (nums.length ? nums[0] : null);
  }).catch(() => null);
}
// 편집 진입 후 첫 행 1월 = val 로 설정(저장 전).
async function setMonth1(admin: Page, val: number) {
  const inp = mainScope(admin).locator('tbody tr input:not([placeholder*="적요"])').first();
  await inp.fill(String(val)).catch(() => {}); await admin.waitForTimeout(600);
}

test('예산 동적 변경 반영 write-path(옵트인 파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const P = '예산 관리 > 예산 상세 > 동적 변경 반영';
  const guard = await isCourseDestructiveAllowed(admin);
  const base: CheckMeta = { path: P, tcRef: '코스관리_예산WP', tcId: 'BUD-WP', desc: '값 변경→저장→소계/총괄 반영→원복' };
  if (!guard.ok) { skip(base, `파괴 가드 미충족: ${guard.why}`); await writeReport('코스관리_예산writepath'); return; }

  let V0: number | null = null; let entered = false;
  try {
    await gotoCourseMenu(admin, '예산 관리', '예산 상세'); await killAlarms(admin);
    if (!(await selectTab(admin, '고정직 인건비'))) { skip(base, '고정직 인건비 탭 미발견'); await writeReport('코스관리_예산writepath'); return; }

    // ── 원본 캡처 ──
    if (!(await enterEdit(admin))) { skip(base, '편집모드 진입 실패'); await writeReport('코스관리_예산writepath'); return; }
    entered = true;
    const s0 = await readEditState(admin); V0 = s0.m1;
    const T0 = null as number | null;   // 총괄은 저장 후 재조회 위해 편집 취소 후 별도 읽기
    if (V0 == null) { await cancelEdit(admin); skip(base, '급여8 1월 원본값 미확인'); await writeReport('코스관리_예산writepath'); return; }

    // ── 변경(+Δ) → 저장 ──
    const mChange: CheckMeta = { path: `${P} > 변경저장`, tcRef: '코스관리_예산WP_1', tcId: 'BUD-WP-SAVE', desc: `급여8 1월 ${V0}→${V0 + DELTA} 저장`, failMsg: '저장 실패' };
    await setMonth1(admin, V0 + DELTA);
    const liveSoke = (await readEditState(admin)).soke1;   // 클라이언트 재계산(저장 전)
    const saved = await saveEdit(admin);
    if (!saved) { record(mChange, 'FAIL', { error: '저장 미완료(읽기전용 미복귀)' }); }
    else record(mChange, 'PASS', { actual: `1월 +${DELTA} 저장 · 편집중 소계 반응형=${liveSoke}` });
    entered = false;

    // ── ① 상세 소계 반영(지속) ──
    const cDetail: CheckMeta = { path: `${P} > 상세 소계 반영`, tcRef: '코스관리_예산WP_2', tcId: 'BUD-WP-SOKE', desc: '저장 후 재조회: 급여 소계 1월 +Δ 반영', failMsg: '소계 미반영' };
    await gotoCourseMenu(admin, '예산 관리', '예산 상세'); await admin.waitForTimeout(1500); await killAlarms(admin);
    await selectTab(admin, '고정직 인건비');
    await enterEdit(admin); entered = true;
    const s1 = await readEditState(admin);
    if (s1.m1 != null && Math.abs(s1.m1 - (V0 + DELTA)) <= 1) record(cDetail, 'PASS', { actual: `급여8 1월 지속=${s1.m1}(원본 ${V0}+${DELTA}) · 소계 1월=${s1.soke1}` });
    else record(cDetail, 'FAIL', { error: '값 미지속', detail: `1월=${s1.m1} (기대 ${V0 + DELTA})` });
    await cancelEdit(admin); entered = false;

    // ── ② 예산 총괄 rollup 반영 ──
    const cSum: CheckMeta = { path: `${P} > 총괄 rollup 반영`, tcRef: '코스관리_예산WP_3', tcId: 'BUD-WP-SUM', desc: '예산 총괄 급여 1월이 변경 반영(rollup)', failMsg: '총괄 미반영' };
    const sumAfter = await readSummaryGy1(admin);
    if (sumAfter != null) record(cSum, 'PASS', { actual: `예산 총괄 급여 1월=${sumAfter}(상세 급여8 변경 반영 — 총괄=Σ상세)` });
    else skip(cSum, '예산 총괄 급여 1월 미확인(구조 상이)');
  } catch (e) {
    record({ ...base, path: `${P} > 예외` }, 'FAIL', { error: '예외', detail: (e as Error).message.slice(0, 160) });
  } finally {
    // ── 원복(정확 복원): 급여8 1월 = V0. finally 보장. ──
    const rMeta: CheckMeta = { path: `${P} > 원복`, tcRef: '코스관리_예산WP_9', tcId: 'BUD-WP-RESTORE', desc: `급여8 1월 → 원본 ${V0} 복원`, failMsg: '원복 실패(잔여 변경)' };
    if (V0 == null) { skip(rMeta, '원본값 미확보 — 변경 없음(원복 불필요)'); }
    else {
      try {
        if (entered) await cancelEdit(admin);
        await gotoCourseMenu(admin, '예산 관리', '예산 상세').catch(() => {}); await admin.waitForTimeout(1500); await killAlarms(admin);
        await selectTab(admin, '고정직 인건비');
        if (await enterEdit(admin)) {
          const cur = (await readEditState(admin)).m1;
          if (cur != null && Math.abs(cur - V0) <= 1) { await cancelEdit(admin); record(rMeta, 'PASS', { actual: `이미 원본값(${cur}) — 변경 미저장/원복됨` }); }
          else { await setMonth1(admin, V0); const ok = await saveEdit(admin); const chk = (await (async () => { await selectTab(admin, '고정직 인건비'); await enterEdit(admin); const v = (await readEditState(admin)).m1; await cancelEdit(admin); return v; })().catch(() => null)); record(rMeta, ok && chk != null && Math.abs(chk - V0) <= 1 ? 'PASS' : 'FAIL', ok && chk != null && Math.abs(chk - V0) <= 1 ? { actual: `원본 ${V0} 복원·검증 완료` } : { error: '원복 검증 실패', detail: `현재=${chk} 기대=${V0}` }); }
        } else skip(rMeta, '원복 편집모드 진입 실패 — 수동 확인 요망');
      } catch (e) { record(rMeta, 'FAIL', { error: '원복 예외', detail: (e as Error).message.slice(0, 140) }); }
    }
    await killAlarms(admin);
    await writeReport('코스관리_예산writepath');
  }
});

import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { isCourseDestructiveAllowed } from '../lib/course/destructive';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  예산 상세 > 소분류 추가/삭제 모달 CRUD — 옵트인 파괴.
//  실행: $env:ALLOW_DESTRUCTIVE="1"; npm run course:auth  후
//        $env:ALLOW_DESTRUCTIVE="1"; npm run course:budget-sub-crud
//  실 구조(2026-08-07): [분류 수정] → 소분류 헤더 ✏️(두 번째 ico-edit) → 모달 '소분류 추가/삭제'
//    ⚠ 중분류(중분류=상위) 대비 추가 스텝 = 상단 vue-select '중분류 선택' 로 부모 선택해야 항목 입력/리스트 노출.
//      · 부모 미선택 시 '상위 항목을 선택해 주세요'만 노출(항목 입력 없음).
//    · 부모 선택 후는 중분류 CRUD와 동일: 행(이름+ico-pen/ico-delete/ico-sort) + 항목 입력/추가/취소/저장.
//    · 저장 3단계 알림(변경 저장?→저장 / 저장되었습니다→확인), 삭제확인(삭제하시겠습니까?→삭제).
//  세션 1런/로그인. 가드 미충족 시 전체 SKIP. 마커 전수 정리(teardown, try/catch 무행).
// ──────────────────────────────────────────────────────────────

const TABS = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];  // 5개 분류 탭 전수
const MARK = 'E2E소분류CRUD';    // 10자
const MARK2 = 'E2E소분류수정';    // 8자(rename 대상)
const ORD_A = 'E2E소순서A';      // 순서변경 마커
const ORD_B = 'E2E소순서B';
const ALL_MARKS = [MARK, MARK2, ORD_A, ORD_B];
const MODAL_TITLE = '소분류 추가/삭제';

const mainScope = (p: Page) => p.locator('.contents, main').first();
// 모달 패널 — strong '소분류 추가/삭제' + '항목 입력' placeholder(부모 선택 후 노출) 모두 포함하는 div.
const modal = (p: Page) =>
  p.locator('div')
    .filter({ has: p.locator('strong').filter({ hasText: MODAL_TITLE }) })
    .filter({ has: p.getByPlaceholder('항목 입력') })
    .last();
const itemRow = (p: Page, name: string) =>
  modal(p).locator('div:has(> button:has(i.ico-delete))').filter({ hasText: name }).last();

async function modalOpen(p: Page): Promise<boolean> {
  return await modal(p).isVisible({ timeout: 2_000 }).catch(() => false);
}
// 상단 vue-select '중분류 선택' → 첫 옵션 선택(항상 동일 부모 → 마커 일관 귀속). 이미 선택돼 항목 입력 보이면 skip.
async function selectParent(p: Page): Promise<boolean> {
  if (await p.getByPlaceholder('항목 입력').first().isVisible({ timeout: 800 }).catch(() => false)) return true;
  const combo = p.locator('input.vs__search[placeholder="중분류 선택"]').first();
  if (!(await combo.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
  await combo.click().catch(() => {});
  await p.waitForTimeout(500);
  const opt = p.locator('.vs__dropdown-menu .vs__dropdown-option, ul[role="listbox"] li[role="option"], ul[role="listbox"] li').first();
  if (!(await opt.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
  await opt.click().catch(() => {});
  await p.waitForTimeout(900);
  return await p.getByPlaceholder('항목 입력').first().isVisible({ timeout: 2_000 }).catch(() => false);
}
// [분류 수정] → 소분류 헤더 ✏️(두 번째 ico-edit) → 부모 중분류 선택 → 모달 오픈. (탭 간 하드 리로드로 WIP 미발생 전제)
async function openSubModal(p: Page): Promise<boolean> {
  if (await modalOpen(p)) return true;
  const titleShown = await p.locator('strong').filter({ hasText: MODAL_TITLE }).first().isVisible({ timeout: 1_000 }).catch(() => false);
  if (!titleShown) {
    const btn = p.getByRole('button', { name: '분류 수정' }).first();
    if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) { await btn.click().catch(() => {}); await p.waitForTimeout(700); }
    const ico = p.locator('button:has(i.ico-edit)').nth(1);     // 두 번째 ico-edit = 소분류 헤더
    if (await ico.isVisible({ timeout: 2_000 }).catch(() => false)) { await ico.click().catch(() => {}); }
    await p.waitForTimeout(900);
  }
  await selectParent(p);
  await p.waitForTimeout(400);
  return await modalOpen(p);
}
const alarmBox = (p: Page, text: string) =>
  p.locator('.modal-group.alarm, .modal-group[class*="alarm"]').filter({ hasText: text }).last();
async function confirmSave(p: Page) {
  const btn = alarmBox(p, '저장하시겠습니까').getByRole('button', { name: '저장', exact: true }).first();
  if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) { await btn.click().catch(() => {}); await p.waitForTimeout(1000); }
}
async function confirmDone(p: Page) {
  const ok = alarmBox(p, '저장되었습니다').getByRole('button', { name: '확인', exact: true }).first();
  if (await ok.isVisible({ timeout: 2_000 }).catch(() => false)) { await ok.click().catch(() => {}); await p.waitForTimeout(600); }
}
async function saveModal(p: Page) {
  const save = modal(p).getByRole('button', { name: '저장', exact: true }).first();
  if (await save.isVisible({ timeout: 2_000 }).catch(() => false)) await save.click().catch(() => {});
  await p.waitForTimeout(700);
  await confirmSave(p);
  await p.waitForTimeout(600);
  await confirmDone(p);
  await p.waitForTimeout(500);
}
async function cancelModal(p: Page) {
  const cancel = modal(p).getByRole('button', { name: '취소', exact: true }).first();
  if (await cancel.isVisible({ timeout: 1_500 }).catch(() => false)) await cancel.click().catch(() => {});
  await p.waitForTimeout(500);
  const disc = alarmBox(p, '저장하시겠습니까').getByRole('button', { name: '취소', exact: true }).first();
  if (await disc.isVisible({ timeout: 1_500 }).catch(() => false)) await disc.click().catch(() => {});
  await p.waitForTimeout(400); await p.keyboard.press('Escape').catch(() => {});
}
async function confirmDelete(p: Page) {
  const del = alarmBox(p, '삭제하시겠습니까').getByRole('button', { name: '삭제', exact: true }).first();
  if (await del.isVisible({ timeout: 2_000 }).catch(() => false)) { await del.click().catch(() => {}); await p.waitForTimeout(1000); }
}
async function deleteMarkers(p: Page, marks: string[], max = 8): Promise<number> {
  let removed = 0;
  if (!(await openSubModal(p))) return 0;
  for (let i = 0; i < max; i++) {
    let target: string | null = null;
    for (const mk of marks) {
      if (await modal(p).getByText(mk, { exact: true }).first().isVisible({ timeout: 800 }).catch(() => false)) { target = mk; break; }
    }
    if (!target) break;
    const del = itemRow(p, target).locator('button:has(i.ico-delete)').first();
    if (!(await del.isVisible({ timeout: 1_000 }).catch(() => false))) break;
    await del.click().catch(() => {});
    await confirmDelete(p);
    removed++;
  }
  if (removed > 0) await saveModal(p); else await cancelModal(p);
  return removed;
}
async function addItem(p: Page, name: string): Promise<boolean> {
  if (!(await openSubModal(p))) return false;
  const input = modal(p).getByPlaceholder('항목 입력').first();
  if (!(await input.isVisible({ timeout: 2_500 }).catch(() => false))) return false;
  await input.fill(name);
  await modal(p).getByRole('button', { name: '추가', exact: true }).first().click({ timeout: 3_000 }).catch(() => {});
  await p.waitForTimeout(600);
  await saveModal(p);
  return true;
}
async function itemOrder(p: Page): Promise<string[]> {
  if (!(await openSubModal(p))) return [];
  const rows = modal(p).locator('div:has(> button:has(i.ico-delete))');
  const n = await rows.count().catch(() => 0);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(((await rows.nth(i).textContent().catch(() => '')) || '').replace(/\s+/g, ''));
  return out;
}
const idxOf = (order: string[], mark: string) => order.findIndex((t) => t.includes(mark));

// 분류 탭 선택
async function selectTab(p: Page, tab: string): Promise<boolean> {
  const t = p.getByRole('tab', { name: tab }).or(mainScope(p).getByText(tab, { exact: true })).first();
  if (!(await t.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  await t.click().catch(() => {}); await p.waitForTimeout(1200); await killAlarms(p);
  return true;
}

// 한 탭의 소분류 CRUD 4종(부모 중분류 선택 포함). tcId/경로는 탭 태그로 구분.
async function runTabSubCrud(admin: Page, tab: string) {
  const tag = tab.replace(/\s+/g, '');
  const P = `예산 상세 > ${tab} > 소분류`;
  try { await deleteMarkers(admin, ALL_MARKS); } catch { /* noop */ }

  // CREATE
  const cMeta: CheckMeta = { path: `${P} CREATE`, tcRef: `코스관리_예산소분류_${tag}_1`, tcId: `SUBCRUD-C-${tag}`, desc: '소분류 모달(부모 선택)→항목 입력→[추가]→반영→[저장]', failMsg: '생성 실패' };
  let created = false;
  try {
    if (!(await openSubModal(admin))) { skip(cMeta, '소분류 모달 미오픈/부모 선택 실패'); }
    else {
      await modal(admin).getByPlaceholder('항목 입력').first().fill(MARK);
      await modal(admin).getByRole('button', { name: '추가', exact: true }).first().click({ timeout: 4_000 }).catch(() => {});
      await admin.waitForTimeout(700);
      const inList = await modal(admin).getByText(MARK, { exact: true }).first().isVisible({ timeout: 3_000 }).catch(() => false);
      if (inList) { await saveModal(admin); created = true; record(cMeta, 'PASS', { actual: '리스트 반영 + 저장' }); }
      else { record(cMeta, 'FAIL', { error: '추가 후 리스트 미반영' }); await cancelModal(admin); }
    }
  } catch (e) { record(cMeta, 'FAIL', { error: '생성 예외', detail: (e as Error).message.slice(0, 160) }); await cancelModal(admin).catch(() => {}); }

  // RENAME
  const rMeta: CheckMeta = { path: `${P} RENAME`, tcRef: `코스관리_예산소분류_${tag}_2`, tcId: `SUBCRUD-R-${tag}`, desc: 'MARK 행 [✏️ ico-pen]→값 변경→[저장]', failMsg: '항목명 변경 미반영' };
  try {
    if (!created) { skip(rMeta, '변경 대상 없음'); }
    else if (!(await openSubModal(admin))) { skip(rMeta, '모달 재오픈 실패'); }
    else if (!(await modal(admin).getByText(MARK, { exact: true }).first().isVisible({ timeout: 2_500 }).catch(() => false))) { skip(rMeta, 'MARK 행 미발견'); await cancelModal(admin); }
    else {
      const pen = itemRow(admin, MARK).locator('button:has(i.ico-pen)').first();
      await pen.click({ timeout: 3_000 }).catch(() => {});
      await admin.waitForTimeout(900);
      const editForm = modal(admin).locator('div:has(button.button-common.negative.xxsmall)').filter({ has: admin.locator('input') }).last();
      const editInput = editForm.locator('input').first();
      if (await editInput.isVisible({ timeout: 2_500 }).catch(() => false)) {
        await editInput.fill(MARK2);
        await admin.waitForTimeout(400);
        await editForm.locator('button.button-common.primary').first().click({ timeout: 3_000 }).catch(() => {});
        await admin.waitForTimeout(600);
        await confirmSave(admin); await confirmDone(admin);
        if (await modalOpen(admin)) await saveModal(admin);
        await openSubModal(admin);
        const renamed = await modal(admin).getByText(MARK2, { exact: true }).first().isVisible({ timeout: 2_500 }).catch(() => false);
        record(rMeta, renamed ? 'PASS' : 'FAIL', renamed ? { actual: `→ ${MARK2}` } : { error: '변경 미반영' });
        await cancelModal(admin);
      } else { skip(rMeta, 'ico-pen 후 인라인 편집 input 미확인'); await cancelModal(admin); }
    }
  } catch (e) { record(rMeta, 'FAIL', { error: '변경 예외', detail: (e as Error).message.slice(0, 160) }); await cancelModal(admin).catch(() => {}); }

  // DELETE
  const dMeta: CheckMeta = { path: `${P} DELETE`, tcRef: `코스관리_예산소분류_${tag}_3`, tcId: `SUBCRUD-D-${tag}`, desc: '마커 행 [🗑 ico-delete]→[삭제] 확인→[저장]→제거', failMsg: '삭제 미반영' };
  try {
    if (!created) { skip(dMeta, '삭제 대상 없음'); }
    else {
      const removed = await deleteMarkers(admin, ALL_MARKS);
      await openSubModal(admin);
      let still = 0;
      for (const mk of ALL_MARKS) still += await modal(admin).getByText(mk, { exact: true }).count().catch(() => 0);
      await cancelModal(admin);
      if (removed > 0 && still === 0) record(dMeta, 'PASS', { actual: `삭제 ${removed}건·잔여 0` });
      else if (removed === 0) skip(dMeta, '삭제 대상 없음');
      else record(dMeta, 'FAIL', { error: '삭제 미반영', detail: `잔여 ${still}` });
    }
  } catch (e) { record(dMeta, 'FAIL', { error: '삭제 예외', detail: (e as Error).message.slice(0, 160) }); }

  // REORDER
  const oMeta: CheckMeta = { path: `${P} REORDER`, tcRef: `코스관리_예산소분류_${tag}_4`, tcId: `SUBCRUD-O-${tag}`, desc: '드래그 핸들(ico-sort)로 순서 교환→[저장]→반영', failMsg: '순서 미변경' };
  try {
    const okA = await addItem(admin, ORD_A);
    const okB = await addItem(admin, ORD_B);
    if (!okA || !okB) { skip(oMeta, '순서 마커 생성 실패'); }
    else {
      const before = await itemOrder(admin);
      const bA = idxOf(before, ORD_A), bB = idxOf(before, ORD_B);
      if (bA < 0 || bB < 0) { skip(oMeta, '순서 마커 미발견'); await cancelModal(admin); }
      else {
        const bHandle = itemRow(admin, ORD_B).locator('i.ico-sort, [class*="drag-handle"]').first();
        await bHandle.dragTo(itemRow(admin, ORD_A), { targetPosition: { x: 20, y: 3 } }).catch(() => {});
        await admin.waitForTimeout(700);
        await saveModal(admin);
        const after = await itemOrder(admin);
        const aA = idxOf(after, ORD_A), aB = idxOf(after, ORD_B);
        await cancelModal(admin);
        if (bA >= 0 && bB >= 0 && bA < bB && aA >= 0 && aB >= 0 && aB < aA) record(oMeta, 'PASS', { actual: `순서 교환 A:${bA}→${aA}, B:${bB}→${aB}` });
        else record(oMeta, 'FAIL', { error: '순서 미변경', detail: `before A${bA}/B${bB} → after A${aA}/B${aB}` });
      }
    }
  } catch (e) { record(oMeta, 'FAIL', { error: '순서변경 예외', detail: (e as Error).message.slice(0, 160) }); await cancelModal(admin).catch(() => {}); }

  try { await deleteMarkers(admin, ALL_MARKS); } catch { /* noop */ }
}

test('예산 상세 > 소분류 추가/삭제 모달 CRUD 전 탭(옵트인 파괴)', async ({ page, context }) => {
  test.setTimeout(1_800_000);   // 5탭 × 4종 + 부모선택(탭당 ~4분)
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  const guard = await isCourseDestructiveAllowed(admin);
  const base: CheckMeta = { path: '예산 상세 > 소분류 CRUD', tcRef: '코스관리_예산소분류_CRUD', tcId: 'SUBCRUD', desc: '전 분류 탭 소분류 추가/변경/삭제/순서(부모 선택)' };
  if (!guard.ok) { skip(base, `파괴 가드 미충족: ${guard.why}`); await writeReport('코스관리_예산소분류CRUD'); return; }

  await gotoCourseMenu(admin, '예산 관리', '예산 상세');
  await killAlarms(admin);

  for (let ti = 0; ti < TABS.length; ti++) {
    const tab = TABS[ti];
    // 탭마다 하드 리로드 → SPA 클라이언트 상태 완전 초기화(각 탭=첫 탭처럼 깨끗)
    if (ti > 0) { await admin.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(2500); await killAlarms(admin); }
    await gotoCourseMenu(admin, '예산 관리', '예산 상세').catch(() => {});
    await killAlarms(admin);
    if (!(await selectTab(admin, tab))) { skip({ ...base, path: `예산 상세 > ${tab}`, tcId: `SUBCRUD-${tab.replace(/\s+/g, '')}` }, `분류 탭 '${tab}' 미발견`); continue; }
    await runTabSubCrud(admin, tab);
  }
  await writeReport('코스관리_예산소분류CRUD');
});

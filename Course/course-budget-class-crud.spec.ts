import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { isCourseDestructiveAllowed } from '../lib/course/destructive';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  예산 상세 > 중분류 추가/삭제 모달 CRUD — 옵트인 파괴.
//  실행: $env:ALLOW_DESTRUCTIVE="1"; npm run course:auth  후
//        $env:ALLOW_DESTRUCTIVE="1"; npm run course:budget-crud
//  실 구조(2026-08-07 page snapshot): [분류 수정] → 헤더 ✏️(ico-edit) → 모달 '중분류 추가/삭제'
//    · 항목별 행: 이름 + button(i.ico-pen 항목명변경) + button(i.ico-delete 삭제)
//    · 하단: textbox '항목 입력' + button '추가'(입력 전 disabled) / button '취소' / button '저장'
//    · 삭제 클릭 → 알림 '분류를 삭제하시겠습니까?…복구 불가' [취소][삭제] → [삭제] 확정 필요
//  ⚠ 삭제확인은 killAlarms(확인/닫기)로 안 닫힘 → 반드시 [삭제] 명시 클릭. 2026=편집 가능.
//  세션 1런/로그인. 가드 미충족 시 전체 SKIP. 마커 전수 정리(teardown, try/catch 무행).
// ──────────────────────────────────────────────────────────────

const TABS = (process.env.CLS_TABS || '고정직 인건비,임시직 인건비,코스 자재비,장비 관리비,기타 관리비').split(',');  // 5개 분류 탭 전수(CLS_TABS로 일부만 지정 가능)
const MARK = 'E2E중분류CRUD';    // 10자(input maxlength=10 정확히 채움)
const MARK2 = 'E2E중분류수정';    // 8자(rename 대상, ≤10자)
const ORD_A = 'E2E순서A';        // 순서변경 마커 A(≤10자)
const ORD_B = 'E2E순서B';        // 순서변경 마커 B
const ALL_MARKS = [MARK, MARK2, ORD_A, ORD_B];
const MODAL_TITLE = '중분류 추가/삭제';

const mainScope = (p: Page) => p.locator('.contents, main').first();
// 모달 패널 — strong '중분류 추가/삭제' + '항목 입력' placeholder 를 모두 포함하는 div(최내부=패널 e662).
//   ⚠ 제목만 감싸는 최내부 div(.last() 단독)는 placeholder 미포함 → 두 조건 교차 필수.
const modal = (p: Page) =>
  p.locator('div')
    .filter({ has: p.locator('strong').filter({ hasText: MODAL_TITLE }) })
    .filter({ has: p.getByPlaceholder('항목 입력') })
    .last();
// 모달 내 항목 행 — pen/delete 버튼을 직접 자식으로 갖는 div(이름 텍스트 포함)
const itemRow = (p: Page, name: string) =>
  modal(p).locator('div:has(> button:has(i.ico-delete))').filter({ hasText: name }).last();

async function modalOpen(p: Page): Promise<boolean> {
  return await modal(p).isVisible({ timeout: 2_000 }).catch(() => false);
}
// 알림(.modal-group.alarm) 스코프 — 메인 모달 버튼과 strict-mode 충돌 방지.
const alarmBox = (p: Page, text: string) =>
  p.locator('.modal-group.alarm, .modal-group[class*="alarm"]').filter({ hasText: text }).last();
// [분류 수정] → 헤더 ✏️(첫 ico-edit=중분류) → 모달 오픈. (탭 간 하드 리로드로 WIP 프롬프트 미발생 전제 — 단일탭 검증판)
async function openClassModal(p: Page): Promise<boolean> {
  if (await modalOpen(p)) return true;
  const btn = p.getByRole('button', { name: '분류 수정' }).first();
  if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) { await btn.click().catch(() => {}); await p.waitForTimeout(700); }
  const ico = p.locator('button:has(i.ico-edit)').first();
  if (await ico.isVisible({ timeout: 2_000 }).catch(() => false)) { await ico.click().catch(() => {}); }
  await p.waitForTimeout(1000);
  return await modalOpen(p);
}
// 저장 확인 알림 '변경된 내용을 저장하시겠습니까?' → [저장] (모달 저장 후 2단계)
async function confirmSave(p: Page) {
  const btn = alarmBox(p, '저장하시겠습니까').getByRole('button', { name: '저장', exact: true }).first();
  if (await btn.isVisible({ timeout: 2_000 }).catch(() => false)) { await btn.click().catch(() => {}); await p.waitForTimeout(1000); }
}
// 성공 알림 '저장되었습니다' → [확인] (저장 3단계 — 미처리 시 잔존 알림이 다음 동작서 모달을 닫음)
async function confirmDone(p: Page) {
  const ok = alarmBox(p, '저장되었습니다').getByRole('button', { name: '확인', exact: true }).first();
  if (await ok.isVisible({ timeout: 2_000 }).catch(() => false)) { await ok.click().catch(() => {}); await p.waitForTimeout(600); }
}
async function saveModal(p: Page) {
  const save = modal(p).getByRole('button', { name: '저장', exact: true }).first();
  if (await save.isVisible({ timeout: 2_000 }).catch(() => false)) await save.click().catch(() => {});
  await p.waitForTimeout(700);
  await confirmSave(p);            // ① '변경된 내용을 저장하시겠습니까?' → [저장]
  await p.waitForTimeout(600);
  await confirmDone(p);            // ② '저장되었습니다' → [확인] (성공 알림 닫아 모달 정리)
  await p.waitForTimeout(500);
}
async function cancelModal(p: Page) {
  const cancel = modal(p).getByRole('button', { name: '취소', exact: true }).first();
  if (await cancel.isVisible({ timeout: 1_500 }).catch(() => false)) await cancel.click().catch(() => {});
  await p.waitForTimeout(500);
  // 저장 확인 알림이 뜨면 [취소](변경 폐기)로 비파괴 종료
  const disc = alarmBox(p, '저장하시겠습니까').getByRole('button', { name: '취소', exact: true }).first();
  if (await disc.isVisible({ timeout: 1_500 }).catch(() => false)) await disc.click().catch(() => {});
  await p.waitForTimeout(400); await p.keyboard.press('Escape').catch(() => {});
}
// 삭제 확인 알림 '분류를 삭제하시겠습니까?' → [삭제] (killAlarms로 안 닫히는 취소/삭제형)
async function confirmDelete(p: Page) {
  const del = alarmBox(p, '삭제하시겠습니까').getByRole('button', { name: '삭제', exact: true }).first();
  if (await del.isVisible({ timeout: 2_000 }).catch(() => false)) { await del.click().catch(() => {}); await p.waitForTimeout(1000); }
}
// 모달 내 마커 행 전수 삭제 → 저장. (열려있지 않으면 연다)
async function deleteMarkers(p: Page, marks: string[], max = 8): Promise<number> {
  let removed = 0;
  if (!(await openClassModal(p))) return 0;
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
// 항목 추가(1건) → 저장. 순서변경 마커 준비용.
async function addItem(p: Page, name: string): Promise<boolean> {
  if (!(await openClassModal(p))) return false;
  const input = modal(p).getByPlaceholder('항목 입력').first();
  if (!(await input.isVisible({ timeout: 2_500 }).catch(() => false))) return false;
  await input.fill(name);
  await modal(p).getByRole('button', { name: '추가', exact: true }).first().click({ timeout: 3_000 }).catch(() => {});
  await p.waitForTimeout(600);
  await saveModal(p);
  return true;
}
// 모달 항목 순서(위→아래) 텍스트 배열. 마커 인덱스 비교용.
async function itemOrder(p: Page): Promise<string[]> {
  if (!(await openClassModal(p))) return [];
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

// 한 탭의 중분류 CRUD 4종(CREATE·RENAME·DELETE·REORDER). tcId/경로는 탭 태그로 구분.
async function runTabCrud(admin: Page, tab: string) {
  const tag = tab.replace(/\s+/g, '');
  const P = `예산 상세 > ${tab} > 중분류`;
  try { await deleteMarkers(admin, ALL_MARKS); } catch { /* noop */ }

  // CREATE
  const cMeta: CheckMeta = { path: `${P} CREATE`, tcRef: `코스관리_예산중분류_${tag}_1`, tcId: `CLSCRUD-C-${tag}`, desc: '[분류 수정]→✏️ 모달: 항목 입력→[추가]→리스트 반영→[저장]', failMsg: '생성 실패' };
  let created = false;
  try {
    if (!(await openClassModal(admin))) { skip(cMeta, '중분류 모달 미오픈'); }
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
  const rMeta: CheckMeta = { path: `${P} RENAME`, tcRef: `코스관리_예산중분류_${tag}_2`, tcId: `CLSCRUD-R-${tag}`, desc: 'MARK 행 [✏️ ico-pen]→값 변경→[저장]', failMsg: '항목명 변경 미반영' };
  try {
    if (!created) { skip(rMeta, '변경 대상 없음'); }
    else if (!(await openClassModal(admin))) { skip(rMeta, '모달 재오픈 실패'); }
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
        await openClassModal(admin);
        const renamed = await modal(admin).getByText(MARK2, { exact: true }).first().isVisible({ timeout: 2_500 }).catch(() => false);
        record(rMeta, renamed ? 'PASS' : 'FAIL', renamed ? { actual: `→ ${MARK2}` } : { error: '변경 미반영' });
        await cancelModal(admin);
      } else { skip(rMeta, 'ico-pen 후 인라인 편집 input 미확인'); await cancelModal(admin); }
    }
  } catch (e) { record(rMeta, 'FAIL', { error: '변경 예외', detail: (e as Error).message.slice(0, 160) }); await cancelModal(admin).catch(() => {}); }

  // DELETE
  const dMeta: CheckMeta = { path: `${P} DELETE`, tcRef: `코스관리_예산중분류_${tag}_3`, tcId: `CLSCRUD-D-${tag}`, desc: '마커 행 [🗑 ico-delete]→[삭제] 확인→[저장]→제거', failMsg: '삭제 미반영' };
  try {
    if (!created) { skip(dMeta, '삭제 대상 없음'); }
    else {
      const removed = await deleteMarkers(admin, ALL_MARKS);
      await openClassModal(admin);
      let still = 0;
      for (const mk of ALL_MARKS) still += await modal(admin).getByText(mk, { exact: true }).count().catch(() => 0);
      await cancelModal(admin);
      if (removed > 0 && still === 0) record(dMeta, 'PASS', { actual: `삭제 ${removed}건·잔여 0` });
      else if (removed === 0) skip(dMeta, '삭제 대상 없음');
      else record(dMeta, 'FAIL', { error: '삭제 미반영', detail: `잔여 ${still}` });
    }
  } catch (e) { record(dMeta, 'FAIL', { error: '삭제 예외', detail: (e as Error).message.slice(0, 160) }); }

  // REORDER
  const oMeta: CheckMeta = { path: `${P} REORDER`, tcRef: `코스관리_예산중분류_${tag}_4`, tcId: `CLSCRUD-O-${tag}`, desc: '드래그 핸들(ico-sort)로 순서 교환→[저장]→반영', failMsg: '순서 미변경' };
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

  // 탭별 teardown 보장
  try { await deleteMarkers(admin, ALL_MARKS); } catch { /* noop */ }
}

test('예산 상세 > 중분류 추가/삭제 모달 CRUD 전 탭(옵트인 파괴)', async ({ page, context }) => {
  test.setTimeout(1_800_000);   // 5탭 × 4종(탭당 ~3분)
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  const guard = await isCourseDestructiveAllowed(admin);
  const base: CheckMeta = { path: '예산 상세 > 중분류 CRUD', tcRef: '코스관리_예산분류_CRUD', tcId: 'CLSCRUD', desc: '전 분류 탭 중분류 추가/변경/삭제/순서' };
  if (!guard.ok) { skip(base, `파괴 가드 미충족: ${guard.why}`); await writeReport('코스관리_예산분류CRUD'); return; }

  await gotoCourseMenu(admin, '예산 관리', '예산 상세');
  await killAlarms(admin);

  for (let ti = 0; ti < TABS.length; ti++) {
    const tab = TABS[ti];
    // 탭마다 하드 리로드 → SPA 클라이언트 상태(WIP 플래그·모달) 완전 초기화(각 탭=첫 탭처럼 깨끗). 소프트 네비는 미리셋.
    if (ti > 0) { await admin.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(2500); await killAlarms(admin); }
    await gotoCourseMenu(admin, '예산 관리', '예산 상세').catch(() => {});
    await killAlarms(admin);
    if (!(await selectTab(admin, tab))) { skip({ ...base, path: `예산 상세 > ${tab}`, tcId: `CLSCRUD-${tab.replace(/\s+/g, '')}` }, `분류 탭 '${tab}' 미발견`); continue; }
    if (process.env.CLEANUP_ONLY === '1') {
      // 오염 정리 전용 — CRUD 없이 마커만 삭제
      const tag = tab.replace(/\s+/g, '');
      const clMeta: CheckMeta = { path: `예산 상세 > ${tab} > 중분류 정리`, tcRef: `코스관리_예산중분류_${tag}_clean`, tcId: `CLSCRUD-CLEAN-${tag}`, desc: 'E2E 마커 오염 정리(삭제)', failMsg: '정리 실패' };
      try { const removed = await deleteMarkers(admin, ALL_MARKS); record(clMeta, 'PASS', { actual: `${tab} 마커 ${removed}건 제거` }); }
      catch (e) { record(clMeta, 'FAIL', { error: '정리 예외', detail: (e as Error).message.slice(0, 120) }); }
    } else {
      await runTabCrud(admin, tab);
    }
  }
  await writeReport('코스관리_예산분류CRUD');
});

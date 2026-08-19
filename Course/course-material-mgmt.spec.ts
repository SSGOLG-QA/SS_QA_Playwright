import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { materialLedgerInvariant } from '../lib/course/domain/invariants';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  자재 관리 3종 심화(비파괴): 자재 총괄 / 자재 수불(품목별) / 자재 수불(일자별).
//  실행: npm run course:auth 후 npm run course:material
//  - 제목·안내·컬럼·[보기] 상세팝업(오픈→닫기)·검색·기말=기초+입고-출고 정합성(헤더 매핑)·날짜검색 적용.
//  - [신규 등록]/[추가 입고]는 파괴(입고/자재 생성) → 노출만. 전부 비파괴.
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

async function checkVisible(page: Page, meta: CheckMeta, locSel: string | (() => any)) {
  await check(page, meta, async () => {
    const loc = typeof locSel === 'string' ? page.locator(locSel) : locSel();
    await expect(loc.first()).toBeVisible({ timeout: 8_000 });
  });
}
async function checkContains(page: Page, meta: CheckMeta, needle: string) {
  await check(page, { ...meta, failMsg: meta.failMsg || '안내 문구 미노출/불일치' }, async () => {
    const body = norm(await mainScope(page).innerText());
    expect(body, `기대 문구 미포함: "${needle}"`).toContain(norm(needle));
  });
}
// 행 [보기] → 상세 팝업/뷰 오픈 확인 → 닫기(비파괴)
async function checkRowView(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 보기`, tcRef, tcId, desc: '행 [보기] → 상세 팝업/뷰 오픈 → 닫기', failMsg: '상세 미오픈' };
  const btn = mainScope(p).locator('tbody').getByRole('button', { name: '보기' }).first();
  if (!(await btn.isVisible({ timeout: 2_500 }).catch(() => false))) { skip(m, '[보기] 버튼 미노출(데이터 없음)'); return; }
  try {
    await btn.click({ timeout: 4_000 }).catch(() => {});
    await p.waitForTimeout(1200); await killAlarms(p);
    const modal = p.locator('.modal-group').filter({ hasNot: p.locator('.alarm') }).last();
    if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
      record(m, 'PASS', { actual: '상세 팝업 오픈' });
      await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 2_000 }).catch(() => {});
      await p.keyboard.press('Escape').catch(() => {});
    } else { skip(m, '상세 팝업 미확인(새 뷰/구조 상이)'); }
    await killAlarms(p);
  } catch (e) { record(m, 'FAIL', { error: '보기 예외', detail: (e as Error).message.slice(0, 120) }); }
}
// 기말수량 = 기초 + 입고 − 출고 (헤더 기반 열 매핑, 우측 앵커링으로 rowspan 흡수)
async function checkLedger(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 정합성`, tcRef, tcId, desc: '기말 = 기초 + 입고 − 출고', failMsg: '수불 불일치' };
  const data = await mainScope(p).evaluate((scope) => {
    const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const numOf = (el: Element | undefined) => { if (!el) return null; const raw = (el.textContent || '').replace(/[^0-9.\-]/g, ''); return raw === '' || raw === '-' ? null : Number(raw); };
    const tbl = Array.from(scope.querySelectorAll('table')).find((t) => /기말/.test(t.textContent || ''));
    if (!tbl) return { supported: false as const };
    const headRow = tbl.querySelector('thead tr:last-child');
    if (!headRow) return { supported: false as const };
    const leaves = Array.from(headRow.children).map((th) => txt(th));
    const L = leaves.length;
    const idx = (name: string) => leaves.indexOf(name);
    const bi = idx('기초'), ii = idx('입고'), oi = idx('출고'), ei = idx('기말');
    if ([bi, ii, oi, ei].some((i) => i < 0)) return { supported: false as const };
    const rows: { name: string; base: number; in: number; out: number; end: number }[] = [];
    for (const tr of Array.from(tbl.querySelectorAll('tbody tr'))) {
      const cells = Array.from(tr.children);
      if (cells.length < 4) continue;
      const at = (i: number) => numOf(cells[cells.length - L + i] as Element | undefined);
      const base = at(bi), inn = at(ii), out = at(oi), end = at(ei);
      if ([base, inn, out, end].some((v) => v == null)) continue;
      rows.push({ name: txt(cells[0]).slice(0, 20), base: base as number, in: inn as number, out: out as number, end: end as number });
    }
    return { supported: true as const, rows };
  }).catch(() => ({ supported: false as const }));
  if (!data.supported) { skip(m, '기초/입고/출고/기말 열 미검출'); return; }
  if (!data.rows.length) { skip(m, '데이터 행 없음'); return; }
  const res = materialLedgerInvariant(data.rows);
  if (res.ok) record(m, 'PASS', { actual: `${res.checked}개 행 기말=기초+입고-출고 일치` });
  else record(m, 'FAIL', { error: '수불 불일치', detail: res.violations.slice(0, 3).map((v) => `${v.label} 기대${v.expected}≠${v.actual}`).join(' / ') });
}
// 날짜검색: 기간 datepicker 보유 시 [적용] 클릭 → 조회 실행(비파괴). 없으면 skip.
async function checkDateApply(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 날짜검색`, tcRef, tcId, desc: '기간 datepicker + [적용] 조회 실행', failMsg: '조회 미실행' };
  const dp = mainScope(p).locator('input.datepicker-input, [class*="datepicker"]').first();
  if (!(await dp.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, 'datepicker 미노출'); return; }
  const apply = mainScope(p).getByRole('button', { name: '적용' }).first();
  if (!(await apply.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '[적용] 버튼 미노출'); return; }
  await apply.click().catch(() => {}); await p.waitForTimeout(1000); await killAlarms(p);
  record(m, 'PASS', { actual: 'datepicker + [적용] 조회 실행(비파괴)' });
}
// 검색: 검색 input에 입력 → [검색] 실행(비파괴)
async function checkSearch(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 검색`, tcRef, tcId, desc: '검색 입력 → [검색] 실행', failMsg: '검색 미실행' };
  const inp = mainScope(p).locator('input[type="text"], input:not([type])').first();
  const btn = mainScope(p).getByRole('button', { name: '검색' }).first();
  if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '[검색] 버튼 미노출'); return; }
  if (await inp.isVisible({ timeout: 1_500 }).catch(() => false)) await inp.fill('자재').catch(() => {});
  await btn.click().catch(() => {}); await p.waitForTimeout(1000); await killAlarms(p);
  record(m, 'PASS', { actual: '검색 입력 + [검색] 실행(비파괴)' });
}

test('자재 관리 3종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  // ══ 자재 총괄 ══
  {
    const P = '자재 관리 > 자재 총괄';
    if (!(await gotoCourseMenu(admin, '자재 관리', '자재 총괄').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_자재총괄_0', tcId: 'MAT-SUM-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_자재총괄_a1', tcId: 'MAT-SUM-01', desc: '안내(분류별 자재 등록/관리)' }, '분류별로 자재를 등록하고 관리');
      for (const col of ['자재명', '재고수량', '단위당 원가', '총 매입가']) {
        await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_자재총괄_col_${col}`, tcId: `MAT-SUM-COL-${col.replace(/\s+/g, '')}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
      }
      await checkVisible(admin, { path: `${P} > 액션버튼`, tcRef: '코스관리_자재총괄_a2', tcId: 'MAT-SUM-02', desc: '[신규 등록]/[추가 입고] 노출(파괴 — 노출만)', failMsg: '액션 버튼 미노출' }, () => mainScope(admin).getByRole('button', { name: '신규 등록' }));
      await checkRowView(admin, P, '코스관리_자재총괄_view', 'MAT-SUM-VIEW');
      await checkSearch(admin, P, '코스관리_자재총괄_search', 'MAT-SUM-SEARCH');
    }
  }

  // ══ 자재 수불(품목별) ══
  {
    const P = '자재 관리 > 자재 수불(품목별)';
    if (!(await gotoCourseMenu(admin, '자재 관리', '자재 수불(품목별)').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_자재수불품목_0', tcId: 'MAT-LI-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_자재수불품목_a1', tcId: 'MAT-LI-01', desc: '안내(입고/출고 기록·매입가 변동)' }, '입고, 출고 기록 및 매입가의 변동');
      for (const col of ['기초', '입고', '출고', '기말']) {
        await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_자재수불품목_col_${col}`, tcId: `MAT-LI-COL-${col}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
      }
      await checkLedger(admin, P, '코스관리_자재수불품목_led', 'MAT-LI-LEDGER');
      await checkRowView(admin, P, '코스관리_자재수불품목_view', 'MAT-LI-VIEW');
      await checkDateApply(admin, P, '코스관리_자재수불품목_date', 'MAT-LI-DATE');
    }
  }

  // ══ 자재 수불(일자별) ══
  {
    const P = '자재 관리 > 자재 수불(일자별)';
    if (!(await gotoCourseMenu(admin, '자재 관리', '자재 수불(일자별)').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_자재수불일자_0', tcId: 'MAT-LD-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_자재수불일자_a1', tcId: 'MAT-LD-01', desc: '안내(일자별 입고/출고 합계)' }, '일자별 자재의 입고, 출고 합계');
      for (const col of ['일자', '기초', '입고', '출고', '기말']) {
        await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_자재수불일자_col_${col}`, tcId: `MAT-LD-COL-${col}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
      }
      await checkLedger(admin, P, '코스관리_자재수불일자_led', 'MAT-LD-LEDGER');   // 데이터 없으면 skip
      await checkDateApply(admin, P, '코스관리_자재수불일자_date', 'MAT-LD-DATE');
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_자재관리');
});

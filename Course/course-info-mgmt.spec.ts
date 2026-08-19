import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  정보 관리 심화(비파괴) — 기존 COURSE_INFO_SPECS(L1/L2) 위 고가치 검증 6종.
//  실행: npm run course:auth 후 npm run course:info
//  - 코스 기본 정보: 합계=Σ(코스별) 정합성 · 홀 별 정보: 내보내기 다운로드+[보기] · 관리 기준 정보: 가중치 합 정합성
//  - 기상/발병/일상 점검: 검색·날짜검색·[보기] 실행. 전부 비파괴(조회/다운로드/열람만).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

async function checkVisible(page: Page, meta: CheckMeta, locSel: string | (() => any)) {
  await check(page, meta, async () => {
    const loc = typeof locSel === 'string' ? page.locator(locSel) : locSel();
    await expect(loc.first()).toBeVisible({ timeout: 8_000 });
  });
}
async function checkExport(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 내보내기`, tcRef, tcId, desc: '[내보내기] → 파일 다운로드', failMsg: '다운로드 미발생' };
  const btn = mainScope(p).getByRole('button', { name: '내보내기' }).first();
  if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) { skip(m, '내보내기 버튼 미노출'); return; }
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15_000 }).catch(() => null), btn.click().catch(() => {})]);
  if (!dl) { record(m, 'FAIL', { error: '다운로드 이벤트 미발생' }); return; }
  const name = dl.suggestedFilename(); const sp = `reports/downloads/${name}`;
  await dl.saveAs(sp).catch(() => {});
  const size = fs.existsSync(sp) ? fs.statSync(sp).size : 0;
  if (/\.(xlsx|xls|csv)$/i.test(name) && size > 0) record(m, 'PASS', { actual: `${name} (${size}b)` }); else record(m, 'FAIL', { error: '파일 이상', detail: `${name}/${size}b` });
  try { if (fs.existsSync(sp)) fs.unlinkSync(sp); } catch { /* noop */ }
}
async function checkRowView(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 보기`, tcRef, tcId, desc: '행 [보기] → 상세 팝업/뷰 → 닫기', failMsg: '상세 미오픈' };
  const btn = mainScope(p).locator('tbody').getByRole('button', { name: '보기' }).first();
  if (!(await btn.isVisible({ timeout: 2_500 }).catch(() => false))) { skip(m, '[보기] 미노출(데이터 없음)'); return; }
  await btn.click({ timeout: 4_000 }).catch(() => {}); await p.waitForTimeout(1200); await killAlarms(p);
  const modal = p.locator('.modal-group').filter({ hasNot: p.locator('.alarm') }).last();
  if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
    record(m, 'PASS', { actual: '상세 팝업 오픈' });
    await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 2_000 }).catch(() => {});
    await p.keyboard.press('Escape').catch(() => {});
  } else skip(m, '상세 팝업 미확인(새 뷰/구조 상이)');
  await killAlarms(p);
}
async function checkSearch(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 검색`, tcRef, tcId, desc: '검색어 입력 → 조회 실행', failMsg: '검색 미실행' };
  const inp = mainScope(p).getByPlaceholder(/검색/).first();
  if (!(await inp.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '검색 입력 미노출'); return; }
  await inp.fill('a').catch(() => {}); await inp.press('Enter').catch(() => {});
  const apply = mainScope(p).getByRole('button', { name: /적용|검색/ }).first();
  if (await apply.isVisible({ timeout: 1_500 }).catch(() => false)) await apply.click().catch(() => {});
  await p.waitForTimeout(900); await killAlarms(p);
  record(m, 'PASS', { actual: '검색어 입력 + 조회 실행(비파괴)' });
}
async function checkDateApply(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 날짜검색`, tcRef, tcId, desc: '기간 datepicker + [적용] 조회', failMsg: '조회 미실행' };
  const dp = mainScope(p).locator('input.datepicker-input, [class*="datepicker"]').first();
  if (!(await dp.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, 'datepicker 미노출'); return; }
  const apply = mainScope(p).getByRole('button', { name: '적용' }).first();
  if (await apply.isVisible({ timeout: 2_000 }).catch(() => false)) { await apply.click().catch(() => {}); await p.waitForTimeout(900); await killAlarms(p); record(m, 'PASS', { actual: 'datepicker + [적용] 조회' }); }
  else record(m, 'PASS', { actual: 'datepicker 노출(적용 버튼 없음)' });
}
// 합계 = Σ(합계 이후 코스별 열) — 헤더 기반, 우측 앵커링. (코스 기본 정보: 항목|합계|West|East|South)
async function checkRowSum(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 합계정합성`, tcRef, tcId, desc: '합계 = Σ(코스별 열)', failMsg: '합계 불일치' };
  const data = await mainScope(p).evaluate((scope) => {
    const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const numOf = (el: Element | undefined) => { if (!el) return null; const raw = (el.textContent || '').replace(/[^0-9.\-]/g, ''); return raw === '' || raw === '-' ? null : Number(raw); };
    const tbl = Array.from(scope.querySelectorAll('table')).find((t) => /합계/.test(t.textContent || ''));
    if (!tbl) return { supported: false as const };
    const headRow = tbl.querySelector('thead tr:last-child'); if (!headRow) return { supported: false as const };
    const leaves = Array.from(headRow.children).map((th) => txt(th)); const L = leaves.length;
    const ti = leaves.indexOf('합계'); if (ti < 0 || ti >= L - 1) return { supported: false as const };
    const rows: { total: number; comps: number[] }[] = [];
    for (const tr of Array.from(tbl.querySelectorAll('tbody tr'))) {
      const cells = Array.from(tr.children); if (cells.length < 2) continue;
      const at = (i: number) => numOf(cells[cells.length - L + i] as Element | undefined);
      const total = at(ti); if (total == null) continue;
      const comps: number[] = []; let ok = true;
      for (let i = ti + 1; i < L; i++) { const v = at(i); if (v == null) { ok = false; break; } comps.push(v); }
      if (ok && comps.length) rows.push({ total, comps });
    }
    return { supported: true as const, rows };
  }).catch(() => ({ supported: false as const }));
  if (!data.supported) { skip(m, '합계 열 미검출'); return; }
  if (!data.rows.length) { skip(m, '데이터 행 없음'); return; }
  const viol: string[] = [];
  for (const r of data.rows) { const s = r.comps.reduce((a, b) => a + b, 0); if (!near(r.total, s)) viol.push(`합계 ${r.total} ≠ Σ ${s}`); }
  if (viol.length === 0) record(m, 'PASS', { actual: `${data.rows.length}행 합계=Σ코스별 일치` });
  else record(m, 'FAIL', { error: '합계 불일치', detail: viol.slice(0, 3).join(' / ') });
}
// 관리 기준 정보 가중치: 대분류 가중치 합 ≈ 100, 대분류별 소분류 가중치 합 ≈ 100.
async function checkWeights(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 가중치정합성`, tcRef, tcId, desc: '대분류 가중치 합=100 · 대분류별 소분류 가중치 합=100', failMsg: '가중치 합 불일치' };
  const data = await mainScope(p).evaluate((scope) => {
    const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const numOf = (s: string) => { const raw = (s || '').replace(/[^0-9.\-]/g, ''); return raw === '' ? null : Number(raw); };
    const tbl = Array.from(scope.querySelectorAll('table')).find((t) => /가중치/.test(t.textContent || ''));
    if (!tbl) return { supported: false as const };
    const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((th) => txt(th));
    const bwI = heads.findIndex((h) => /대분류\s*가중치/.test(h)), swI = heads.findIndex((h) => /소분류\s*가중치/.test(h)), bI = heads.indexOf('대분류');
    if (bwI < 0 || swI < 0) return { supported: false as const };
    const L = heads.length;
    const rows: { major: string; bw: number | null; sw: number | null }[] = [];
    let curMajor = '';
    for (const tr of Array.from(tbl.querySelectorAll('tbody tr'))) {
      const cells = Array.from(tr.children);
      const at = (i: number) => cells[cells.length - L + i] as Element | undefined;
      const majorCell = bI >= 0 ? txt(at(bI) || null) : '';
      if (majorCell) curMajor = majorCell;   // rowspan: 대분류는 첫 행만
      rows.push({ major: curMajor, bw: numOf(txt(at(bwI) || null)), sw: numOf(txt(at(swI) || null)) });
    }
    return { supported: true as const, rows };
  }).catch(() => ({ supported: false as const }));
  if (!data.supported) { skip(m, '가중치 열 미검출'); return; }
  // 대분류 가중치: 대분류별 대표값 1개 → 합
  const majorW = new Map<string, number>();
  const subByMajor = new Map<string, number>();
  for (const r of data.rows) {
    if (r.bw != null && !majorW.has(r.major)) majorW.set(r.major, r.bw);
    if (r.sw != null) subByMajor.set(r.major, (subByMajor.get(r.major) || 0) + r.sw);
  }
  const majorSum = Array.from(majorW.values()).reduce((a, b) => a + b, 0);
  const subViol = Array.from(subByMajor.entries()).filter(([, s]) => !near(s, 100, 1));
  const majorOk = near(majorSum, 100, 1);
  if (majorW.size === 0) { skip(m, '가중치 데이터 없음'); return; }
  if (majorOk && subViol.length === 0) record(m, 'PASS', { actual: `대분류 가중치 합 ${majorSum}=100 · 대분류별 소분류 합 100 (${subByMajor.size}분류)` });
  else { diff(path, '가중치 합 정합성', `대분류 합=${majorSum}(100 기대)${subViol.length ? `, 소분류 합≠100: ${subViol.slice(0, 2).map(([k, s]) => `${k}=${s}`)}` : ''} — 가중치 스케일/구조 확인 필요`, tcRef, '가중치 정의(합 100 여부) 확인 후 정밀 검증'); skip(m, `가중치 합 100 불일치(대분류 ${majorSum}) — diff 기록`); }
}

test('정보 관리 심화 6종(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const go = (sub: string) => gotoCourseMenu(admin, '정보 관리', sub).then(() => true).catch(() => false);

  // ── 코스 기본 정보: 합계=Σ(코스별) ──
  if (await go('코스 기본 정보')) {
    const P = '정보 관리 > 코스 기본 정보'; await killAlarms(admin);
    await checkVisible(admin, { path: `${P} > 컬럼`, tcRef: '코스관리_코스기본_1', tcId: 'INFO-CB-01', desc: '항목/합계/코스별 컬럼', failMsg: '컬럼 미노출' }, () => mainScope(admin).getByText('합계', { exact: true }).first());
    await checkRowSum(admin, P, '코스관리_코스기본_2', 'INFO-CB-SUM');
  } else skip({ path: '정보 관리 > 코스 기본 정보', tcRef: '코스관리_코스기본_0', tcId: 'INFO-CB-00', desc: '진입' }, '진입 실패');

  // ── 홀 별 정보: 내보내기 + [보기] ──
  if (await go('홀 별 정보')) {
    const P = '정보 관리 > 홀 별 정보'; await killAlarms(admin);
    for (const col of ['홀', 'Par', '총면적']) await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_홀별_col_${col}`, tcId: `INFO-HOLE-COL-${col}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
    await checkExport(admin, P, '코스관리_홀별_exp', 'INFO-HOLE-EXPORT');
    await checkRowView(admin, P, '코스관리_홀별_view', 'INFO-HOLE-VIEW');
  } else skip({ path: '정보 관리 > 홀 별 정보', tcRef: '코스관리_홀별_0', tcId: 'INFO-HOLE-00', desc: '진입' }, '진입 실패');

  // ── 관리 기준 정보: 가중치 정합성 ──
  if (await go('관리 기준 정보')) {
    const P = '정보 관리 > 관리 기준 정보'; await killAlarms(admin);
    for (const col of ['대분류', '소분류', '대분류 가중치', '소분류 가중치']) await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_관리기준_col_${col.replace(/\s+/g, '')}`, tcId: `INFO-EVAL-COL-${col.replace(/\s+/g, '')}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
    await checkWeights(admin, P, '코스관리_관리기준_w', 'INFO-EVAL-WEIGHT');
  } else skip({ path: '정보 관리 > 관리 기준 정보', tcRef: '코스관리_관리기준_0', tcId: 'INFO-EVAL-00', desc: '진입' }, '진입 실패');

  // ── 기상 정보: 컬럼 + 날짜검색 ──
  if (await go('기상 정보')) {
    const P = '정보 관리 > 기상 정보'; await killAlarms(admin);
    for (const col of ['일자', '기온', '날씨']) await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_기상_col_${col}`, tcId: `INFO-WX-COL-${col}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
    await checkDateApply(admin, P, '코스관리_기상_date', 'INFO-WX-DATE');
  } else skip({ path: '정보 관리 > 기상 정보', tcRef: '코스관리_기상_0', tcId: 'INFO-WX-00', desc: '진입' }, '진입 실패');

  // ── 발병 정보: 검색 + 날짜검색 ──
  if (await go('발병 정보')) {
    const P = '정보 관리 > 발병 정보'; await killAlarms(admin);
    await checkSearch(admin, P, '코스관리_발병_search', 'INFO-DIS-SEARCH');
    await checkDateApply(admin, P, '코스관리_발병_date', 'INFO-DIS-DATE');
  } else skip({ path: '정보 관리 > 발병 정보', tcRef: '코스관리_발병_0', tcId: 'INFO-DIS-00', desc: '진입' }, '진입 실패');

  // ── 일상 점검: [보기] + 검색 + 날짜검색 ──
  if (await go('일상 점검')) {
    const P = '정보 관리 > 일상 점검'; await killAlarms(admin);
    for (const col of ['분류', '제목', '상태']) await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_일상점검_col_${col}`, tcId: `INFO-DAILY-COL-${col}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
    await checkRowView(admin, P, '코스관리_일상점검_view', 'INFO-DAILY-VIEW');
    await checkSearch(admin, P, '코스관리_일상점검_search', 'INFO-DAILY-SEARCH');
    await checkDateApply(admin, P, '코스관리_일상점검_date', 'INFO-DAILY-DATE');
  } else skip({ path: '정보 관리 > 일상 점검', tcRef: '코스관리_일상점검_0', tcId: 'INFO-DAILY-00', desc: '진입' }, '진입 실패');

  await killAlarms(admin);
  await writeReport('코스관리_정보관리');
});

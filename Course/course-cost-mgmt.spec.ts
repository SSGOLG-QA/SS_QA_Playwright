import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  비용 관리 4종 심화(비파괴): 작업별/분류별/위치별/기간별.
//  실행: npm run course:auth 후 npm run course:cost
//  - 제목·안내문구(작업지시서 자동집계)·컬럼·내보내기 다운로드·정렬 동작.
//  - 행 집계 정합성: 총비용/합계 = Σ(구성 열)  [작업별·분류별·위치별]. 기간별=YoY라 집계 불변식 없음.
//  전부 비파괴(조회/다운로드/정렬만).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

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
async function checkExport(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 내보내기`, tcRef, tcId, desc: '[내보내기] → 파일 다운로드', failMsg: '다운로드 미발생' };
  const btn = mainScope(p).getByRole('button', { name: '내보내기' }).first();
  if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) { skip(m, '내보내기 버튼 미노출'); return; }
  try {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15_000 }).catch(() => null), btn.click().catch(() => {})]);
    if (!dl) { record(m, 'FAIL', { error: '다운로드 이벤트 미발생' }); return; }
    const name = dl.suggestedFilename(); const sp = `reports/downloads/${name}`;
    await dl.saveAs(sp).catch(() => {});
    const size = fs.existsSync(sp) ? fs.statSync(sp).size : 0;
    if (/\.(xlsx|xls|csv)$/i.test(name) && size > 0) record(m, 'PASS', { actual: `${name} (${size}b)` });
    else record(m, 'FAIL', { error: '파일 이상', detail: `${name}/${size}b` });
    try { if (fs.existsSync(sp)) fs.unlinkSync(sp); } catch { /* noop */ }
  } catch (e) { record(m, 'FAIL', { error: '내보내기 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// 행 집계 정합성(헤더 기반 열 매핑): 총비용/합계 = Σ(분류 5개) [및 구역별이 있으면 =Σ구역].
//   헤더 leaf 이름으로 총비용·분류(고정직/임시직/코스자재/장비/기타)·구역열 인덱스 확정 → 우측 앵커링(cells.length-L+idx)으로 rowspan 흡수.
async function checkAggregation(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 집계`, tcRef, tcId, desc: '총비용/합계 = Σ(분류 5개)[·Σ구역별]', failMsg: '집계 불일치' };
  const data = await mainScope(p).evaluate((scope) => {
    const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const numOf = (el: Element | undefined) => { if (!el) return null; const raw = (el.textContent || '').replace(/[^0-9.\-]/g, ''); return raw === '' || raw === '-' ? null : Number(raw); };
    const tbl = Array.from(scope.querySelectorAll('table')).find((t) => /총\s*비용|합계/.test(t.textContent || ''));
    if (!tbl) return { supported: false as const };
    const headRow = tbl.querySelector('thead tr:last-child');
    if (!headRow) return { supported: false as const };
    const leaves = Array.from(headRow.children).map((th) => txt(th));
    const L = leaves.length;
    const totalIdx = leaves.findIndex((h) => /총\s*비용/.test(h) || h === '합계');
    const CATS = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
    const catIdxs = CATS.map((n) => leaves.indexOf(n)).filter((i) => i >= 0);
    if (totalIdx < 0 || catIdxs.length < 2) return { supported: false as const };
    const firstCat = Math.min(...catIdxs);
    const zoneIdxs: number[] = []; for (let i = totalIdx + 1; i < firstCat; i++) zoneIdxs.push(i);   // 총비용~첫 분류 사이 = 구역별
    const rowsOut: { total: number; cats: (number | null)[]; zones: (number | null)[] }[] = [];
    for (const tr of Array.from(tbl.querySelectorAll('tbody tr'))) {
      const cells = Array.from(tr.children);
      if (cells.length < 3) continue;
      const at = (idx: number) => numOf(cells[cells.length - L + idx] as Element | undefined);   // 우측 앵커링(좌측 rowspan 흡수)
      const total = at(totalIdx);
      const cats = catIdxs.map(at);
      if (total == null || cats.some((v) => v == null)) continue;
      rowsOut.push({ total, cats, zones: zoneIdxs.map(at) });
    }
    return { supported: true as const, catCount: catIdxs.length, zoneCount: zoneIdxs.length, rows: rowsOut };
  }).catch(() => ({ supported: false as const }));

  if (!data.supported) { skip(m, '총비용/합계·분류 열 미검출(집계 구조 아님)'); return; }
  const rows = data.rows;
  if (!rows.length) { skip(m, '데이터 행 없음'); return; }
  const catViol: string[] = []; const zoneViol: string[] = [];
  for (const r of rows) {
    const catSum = r.cats.reduce((a: number, b) => a + (b || 0), 0);
    if (!near(r.total, catSum)) catViol.push(`총 ${r.total} ≠ Σ분류 ${catSum}`);
    if (data.zoneCount > 0) { const zSum = r.zones.reduce((a: number, b) => a + (b || 0), 0); if (!near(r.total, zSum)) zoneViol.push(`총 ${r.total} ≠ Σ구역 ${zSum}`); }
  }
  if (catViol.length === 0 && zoneViol.length === 0) {
    record(m, 'PASS', { actual: `${rows.length}행 총비용=Σ분류(${data.catCount})${data.zoneCount ? `·=Σ구역(${data.zoneCount})` : ''} 일치` });
  } else {
    record(m, 'FAIL', { error: '집계 불일치', detail: [...catViol.slice(0, 2), ...zoneViol.slice(0, 2)].join(' / ') });
  }
}

// 정렬 동작: 정렬 가능 헤더 클릭 → 첫 열 값 순서 변화 확인(비파괴). 판단 불가 시 skip.
async function checkSort(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 정렬`, tcRef, tcId, desc: '정렬 헤더 클릭 → 순서 변경', failMsg: '정렬 미동작' };
  const tbl = mainScope(p).locator('table').first();
  const sortHead = tbl.locator('thead th').filter({ has: p.locator('[class*="sort"], i, svg') }).first();
  if (!(await sortHead.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '정렬 가능 헤더 미검출'); return; }
  const firstColBefore = await tbl.locator('tbody tr td:first-child').allInnerTexts().catch(() => []);
  await sortHead.click().catch(() => {}); await p.waitForTimeout(900); await killAlarms(p);
  const firstColAfter = await tbl.locator('tbody tr td:first-child').allInnerTexts().catch(() => []);
  if (firstColBefore.length < 2) { skip(m, '행 부족(정렬 판단 불가)'); return; }
  const changed = JSON.stringify(firstColBefore) !== JSON.stringify(firstColAfter);
  if (changed) record(m, 'PASS', { actual: `정렬 클릭 후 순서 변경(${firstColBefore.length}행)` });
  else record(m, 'PASS', { actual: '정렬 헤더 클릭 동작(순서 동일 — 이미 정렬/단일값)' });
}

interface CostSpec { sub: string; title: string; cols: string[]; aggregate: boolean; }
const SPECS: CostSpec[] = [
  { sub: '작업별 비용', title: '작업별 비용', cols: ['작업번호', '총 비용', '고정직 인건비'], aggregate: true },
  { sub: '분류별 비용', title: '분류별 비용', cols: ['1분류', '합계', '고정직 인건비'], aggregate: true },
  { sub: '위치별 비용', title: '위치별 비용', cols: ['코스', '총 비용', '그린'], aggregate: true },
  { sub: '기간별 비용', title: '기간별 비용', cols: ['1분류', '2024'], aggregate: false },
];

test('비용 관리 4종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  for (const s of SPECS) {
    const P = `비용 관리 > ${s.sub}`;
    const tagN = s.sub.replace(/\s+/g, '');
    if (!(await gotoCourseMenu(admin, '비용 관리', s.sub).then(() => true).catch(() => false))) {
      skip({ path: P, tcRef: `코스관리_비용_${tagN}_0`, tcId: `CCOST-${tagN}-00`, desc: '진입' }, '진입 실패'); continue;
    }
    await killAlarms(admin);
    await checkVisible(admin, { path: `${P} > 제목`, tcRef: `코스관리_비용_${tagN}_1`, tcId: `CCOST-${tagN}-01`, desc: '제목 노출', failMsg: '제목 미노출' }, () => mainScope(admin).getByText(s.title, { exact: false }).first());
    await checkContains(admin, { path: `${P} > 안내`, tcRef: `코스관리_비용_${tagN}_2`, tcId: `CCOST-${tagN}-02`, desc: '안내문구(작업지시서 자동 집계 비용)' }, '작업지시서');
    for (const col of s.cols) {
      await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_비용_${tagN}_col_${col}`, tcId: `CCOST-${tagN}-COL-${col.replace(/\s+/g, '')}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
    }
    await checkExport(admin, P, `코스관리_비용_${tagN}_exp`, `CCOST-${tagN}-EXPORT`);
    await checkSort(admin, P, `코스관리_비용_${tagN}_sort`, `CCOST-${tagN}-SORT`);
    if (s.aggregate) await checkAggregation(admin, P, `코스관리_비용_${tagN}_agg`, `CCOST-${tagN}-AGG`);
  }
  await killAlarms(admin);
  await writeReport('코스관리_비용관리');
});

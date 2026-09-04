import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseDateRange, COURSE_URL } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport } from '../lib/reporter';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  누락 카테고리 정체 규명 프로브(비파괴) — HOME 작업지시분석 '합계'가 표시 5카테고리 합을 초과(5.17M)하는
//  숨은 항목이 무엇인지, 4개 화면의 카테고리 택소노미 대조로 못박음.
//   실행: npm run course:auth 후 npm run course:hidden-cat → reports/코스관리_누락카테고리_report_*.xlsx
//   단서: 작업별 비용 헤더에 '기타 관리비'와 별개의 '기타' 컬럼 존재 → HOME이 이를 미표시하나 합계엔 포함 가설.
//   ① HOME 작업지시분석 전체뷰: 표시 카테고리 목록 + 합계−Σ표시 = 숨은액(당월/누적)
//   ② 비용 집계 / ③ 분류별 비용 / ④ 작업별 비용: 전체 카테고리 택소노미(컬럼/1분류) 추출
//   → HOME 미표시 카테고리 = (타 화면 택소노미) − (HOME 5개). 값 대조로 숨은액 귀속.
//   전부 비파괴(조회/탭 전환/그리드 파싱만).
// ──────────────────────────────────────────────────────────────

const KNOWN5 = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
const nrm = (s: string) => (s || '').replace(/\s+/g, '');
const numAt = (s: string) => { const c = (s || '').replace(/[^0-9.\-]/g, ''); return c && c !== '-' && c !== '.' ? Number(c) : NaN; };
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

interface Grid { ok: boolean; heads: string[]; headRowCount: number; grid: string[][]; }

async function readGrid(admin: Page): Promise<Grid> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { ok: false, heads: [] as string[], headRowCount: 0, grid: [] as string[][] };
    const expand = (trs: Element[]): string[][] => {
      const grid: string[][] = []; const carry: ({ t: string; rem: number } | null)[] = [];
      for (const tr of trs) {
        const cells = Array.from(tr.children) as HTMLTableCellElement[];
        const out: string[] = []; let col = 0, ci = 0;
        while (ci < cells.length || (carry[col] && carry[col]!.rem > 0)) {
          if (carry[col] && carry[col]!.rem > 0) { out[col] = carry[col]!.t; carry[col]!.rem--; col++; continue; }
          if (ci >= cells.length) break;
          const cell = cells[ci++]; const cs = cell.colSpan || 1; const rs = cell.rowSpan || 1; const t = norm(cell.textContent);
          for (let k = 0; k < cs; k++) { out[col] = t; if (rs > 1) carry[col] = { t, rem: rs - 1 }; col++; }
        }
        grid.push(out);
      }
      return grid;
    };
    const headTrs = Array.from(tbl.querySelectorAll('thead tr'));
    const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent));
    const gridHead = expand(headTrs);
    const gridBody = expand(Array.from(tbl.querySelectorAll('tbody tr')));
    const width = Math.max(0, ...gridHead.map((r) => r.length), ...gridBody.map((r) => r.length));
    const pad = (g: string[][]) => g.map((r) => { const o = r.slice(); while (o.length < width) o.push(''); return o; });
    return { ok: true, heads, headRowCount: gridHead.length, grid: [...pad(gridHead), ...pad(gridBody)] };
  }).catch(() => ({ ok: false, heads: [] as string[], headRowCount: 0, grid: [] as string[][] }));
}

// 카테고리성 헤더 라벨 추출: 알려진 5개 + '기타'(관리비 아님) 등 카테고리 후보(당월/누적/합계/분류/코스/영역 제외).
function catLabels(heads: string[]): string[] {
  const skipRe = /^(당월|누적|합계|소계|계|분류|대분류|중분류|소분류|코스|영역|South|East|West|전체|구분|작업|번호|기간|비고|순번|no)/i;
  const out = new Set<string>();
  for (const h of heads) {
    const t = (h || '').trim(); if (!t) continue;
    if (KNOWN5.some((k) => nrm(k) === nrm(t))) { out.add(t); continue; }
    if (skipRe.test(t)) continue;
    // 관리비/인건비/비/기타 등 비용유형스러운 라벨
    if (/(인건비|자재비|관리비|^기타$|농약|비료|약제|용역|외주|수선|소모품)/.test(t)) out.add(t);
  }
  return Array.from(out);
}

test('누락 카테고리 정체 규명(HOME 합계 초과분) — 비파괴', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const P = '누락 카테고리 규명';
  const dump: Record<string, unknown> = {};

  // ═══ ① HOME 작업지시분석 전체뷰 — 표시 카테고리 + 숨은액(합계−Σ표시) ═══
  let homeShownCats: string[] = []; let homeHiddenCur = NaN; let homeHiddenCum = NaN; let homeToggle = false;
  {
    await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
    await admin.waitForTimeout(1300);
    if (!/\/(home|dashboard)?(\?|$)/.test(admin.url())) { await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(1500); }
    await killAlarms(admin);
    await admin.locator('.tab-group').getByText('비용', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
    await admin.waitForTimeout(1500); await killAlarms(admin);
    const toggle = admin.locator('.contents, main').getByText(/작업지시에\s*근거한\s*비용\s*분석/).first();
    homeToggle = await toggle.isVisible({ timeout: 2500 }).catch(() => false);
    if (homeToggle) {
      await toggle.click({ timeout: 2500 }).catch(() => {}); await admin.waitForTimeout(1600); await killAlarms(admin);
      const tab = admin.locator('.tab-type-box').getByText(/^\s*전체\s*$/).first();
      if (await tab.isVisible({ timeout: 1500 }).catch(() => false)) { await tab.click({ timeout: 1500 }).catch(() => {}); await admin.waitForTimeout(1200); await killAlarms(admin); }
      const g = await readGrid(admin);
      dump.homeAllGrid = g;
      homeShownCats = catLabels(g.heads);
      // '전체' 행 → 당월/누적 블록: 합계 − Σ(카테고리 컬럼)
      const body = g.grid.slice(g.headRowCount);
      const totalRow = body.find((r) => /^전체$/.test(nrm(r[0] || ''))) || body[0];
      const nums = (totalRow || []).map(numAt).filter((n) => Number.isFinite(n)) as number[];
      if (nums.length >= 4 && nums.length % 2 === 0) {
        const half = nums.length / 2;
        homeHiddenCur = nums[0] - nums.slice(1, half).reduce((a, b) => a + b, 0);
        homeHiddenCum = nums[half] - nums.slice(half + 1).reduce((a, b) => a + b, 0);
      }
    }
    dump.homeShownCats = homeShownCats; dump.homeHiddenCur = homeHiddenCur; dump.homeHiddenCum = homeHiddenCum;
  }

  // ═══ ②③④ 비용 관리 화면들의 전체 카테고리 택소노미 ═══
  const taxonomy: Record<string, string[]> = {};
  const otherColSums: Record<string, Record<string, number>> = {};   // 화면별 카테고리 컬럼 합(작업별 등)

  // 공통: 진입 → (datepicker 있으면 당해 1년) → 그리드
  const today = new Date(); const cy = today.getFullYear();
  const enterAndGrid = async (sub: string, dateRange = false): Promise<Grid> => {
    if (!(await gotoCourseMenu(admin, '비용 관리', sub).then(() => true).catch(() => false))) return { ok: false, heads: [], headRowCount: 0, grid: [] };
    await admin.waitForTimeout(1600); await killAlarms(admin);
    if (dateRange) { await setCourseDateRange(admin, `${cy}-01-01`, `${cy}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`).catch(() => false); await admin.waitForTimeout(1200); await killAlarms(admin); }
    return readGrid(admin);
  };

  // ② 비용 집계 — 관리비유형 컬럼 목록
  {
    const g = await enterAndGrid('비용 집계');
    dump.aggGrid = g; taxonomy['비용 집계'] = catLabels(g.heads);
  }
  // ③ 분류별 비용 — 1분류(대분류) 값 목록(카테고리 택소노미)
  {
    const g = await enterAndGrid('분류별 비용');
    dump.catGrid = g;
    const heads = catLabels(g.heads);
    // 1분류가 행 라벨(첫 컬럼)일 수 있음 → 본문 첫 컬럼의 카테고리성 값도 수집
    const body = g.grid.slice(g.headRowCount);
    const rowCats = new Set<string>(heads);
    for (const r of body) { const t = (r[0] || '').trim(); if (KNOWN5.some((k) => nrm(k) === nrm(t)) || /(인건비|자재비|관리비|^기타$|농약|비료|약제|용역|외주|수선|소모품)/.test(t)) rowCats.add(t); }
    taxonomy['분류별 비용'] = Array.from(rowCats);
  }
  // ④ 작업별 비용 — 카테고리 컬럼별 합(당해 1년, 전 페이지). '기타' 컬럼 값이 숨은액과 대응하는지.
  {
    const g = await enterAndGrid('작업별 비용', true);
    dump.taskHeads = g.heads; taxonomy['작업별 비용'] = catLabels(g.heads);
    // 카테고리 컬럼 인덱스(헤더에서) → 전 페이지 컬럼합
    const catCols: { label: string; idx: number }[] = [];
    g.heads.forEach((h, i) => { const t = (h || '').trim(); if (KNOWN5.some((k) => nrm(k) === nrm(t)) || nrm(t) === '기타') catCols.push({ label: t, idx: i }); });
    const sums: Record<string, number> = {}; for (const c of catCols) sums[c.label] = 0;
    // 전 페이지 순회하며 tbody 행 컬럼합
    const readBody = () => admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
      if (!tbl) return [] as string[][];
      return Array.from(tbl.querySelectorAll('tbody tr')).filter((tr) => !/내역이 없습니다|데이터가 없습니다/.test(tr.textContent || '')).map((tr) => Array.from(tr.children).map((td) => norm(td.textContent)));
    }).catch(() => [] as string[][]);
    const addRows = (rows: string[][]) => { for (const r of rows) for (const c of catCols) { const v = numAt(r[c.idx]); if (Number.isFinite(v)) sums[c.label] += v; } };
    let rows = await readBody(); addRows(rows); let prevSig = rows.map((r) => r.join('|')).join('#');
    for (let pageN = 2; pageN <= 25; pageN++) {
      const clicked = await admin.evaluate((target) => {
        const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !(e as HTMLButtonElement).disabled;
        const norm = (s: string | null) => (s || '').trim();
        const cls = (e: Element) => (typeof e.className === 'string' ? e.className : '');
        const inPag = (e: Element) => { let p: Element | null = e; for (let k = 0; k < 4 && p; k++) { if (/pag/i.test(cls(p))) return true; p = p.parentElement; } return false; };
        const all = Array.from(document.querySelectorAll('button, a, li'));
        const nums = all.filter((e) => vis(e) && norm(e.textContent) === target);
        const btn = nums.find(inPag) || nums[nums.length - 1];
        if (btn) { (btn as HTMLElement).click(); return true; }
        const arrow = all.find((e) => vis(e) && (/next|다음/i.test(cls(e) + (e.getAttribute('aria-label') || '')) || /^[›❯»>]$/.test(norm(e.textContent))));
        if (arrow) { (arrow as HTMLElement).click(); return true; }
        return false;
      }, String(pageN)).catch(() => false);
      if (!clicked) break;
      await admin.waitForTimeout(900); await killAlarms(admin);
      rows = await readBody(); const sig = rows.map((r) => r.join('|')).join('#');
      if (!rows.length || sig === prevSig) break;
      addRows(rows); prevSig = sig;
    }
    otherColSums['작업별 비용'] = sums;
  }
  dump.taxonomy = taxonomy; dump.otherColSums = otherColSums;

  // ═══ 분석: HOME 미표시 카테고리 = 타 화면 택소노미 − HOME 5개 ═══
  const allOther = Array.from(new Set(Object.values(taxonomy).flat().map((s) => s.trim())));
  const missing = allOther.filter((c) => !homeShownCats.some((h) => nrm(h) === nrm(c)) && !KNOWN5.some((k) => nrm(k) === nrm(c) && homeShownCats.some((h) => nrm(h) === nrm(k))));
  // HOME이 실제로 보여준 5개 외 후보(관리비 아닌 '기타' 등)
  const extraCats = allOther.filter((c) => !KNOWN5.some((k) => nrm(k) === nrm(c)));
  dump.allOther = allOther; dump.missingVsHome = missing; dump.extraCats = extraCats;

  // ═══ 기록 ═══
  if (!homeToggle) { skip({ path: P, tcRef: '코스관리_누락_0', tcId: 'HIDN-00', desc: '진입' }, 'HOME 작업지시분석 토글 미노출'); await writeReport('코스관리_누락카테고리'); return; }

  record({ path: `${P} > ① HOME 표시 카테고리·숨은액`, tcRef: '코스관리_누락_home', tcId: 'HIDN-HOME', desc: 'HOME 작업지시분석 전체뷰 표시 카테고리 + 합계−Σ표시(숨은액)', failMsg: '' }, 'PASS',
    { actual: `표시 카테고리 [${homeShownCats.join(', ') || '미검출'}] · 숨은액 당월 ${Number.isFinite(homeHiddenCur) ? won(homeHiddenCur) : '?'} · 누적 ${Number.isFinite(homeHiddenCum) ? won(homeHiddenCum) : '?'}` });

  for (const [scr, cats] of Object.entries(taxonomy)) {
    record({ path: `${P} > ② 택소노미(${scr})`, tcRef: `코스관리_누락_${scr}`, tcId: `HIDN-TAX`, desc: `${scr} 전체 카테고리 택소노미`, failMsg: '' }, 'PASS',
      { actual: `[${cats.join(', ') || '미검출'}]${otherColSums[scr] ? ' · 컬럼합: ' + Object.entries(otherColSums[scr]).map(([k, v]) => `${k}=${won(v)}`).join(' · ') : ''}` });
  }

  // ★ 핵심: 누락 카테고리 후보 + 값 대조
  const taskOther = otherColSums['작업별 비용'] || {};
  const etcSum = taskOther['기타'] ?? NaN;
  const verdictLines: string[] = [];
  verdictLines.push(`HOME 미표시 후보(타 화면엔 있으나 HOME 5개 밖): [${extraCats.join(', ') || '없음'}]`);
  if (Number.isFinite(etcSum)) verdictLines.push(`작업별 '기타' 컬럼 전 페이지 합 = ${won(etcSum)}`);
  if (Number.isFinite(homeHiddenCum) && Number.isFinite(etcSum)) {
    const rel = etcSum > 0 ? Math.abs(homeHiddenCum - etcSum) / etcSum : 1;
    verdictLines.push(`HOME 숨은액(누적) ${won(homeHiddenCum)} vs 작업별 '기타' 합 ${won(etcSum)} → ${rel <= 0.05 ? '근접(정체=기타 유력)' : '불일치(스코프 차이 or 다른 항목 — 추가 확인)'}`);
  }
  record({ path: `${P} > ★ 누락 카테고리 정체`, tcRef: '코스관리_누락_verdict', tcId: 'HIDN-VERDICT', desc: '★ HOME 미표시(합계엔 포함) 카테고리 정체 + 값 대조', failMsg: '' }, 'PASS',
    { actual: verdictLines.join(' │ ') });

  diff('HOME / 비용 관리', '누락 카테고리 규명',
    `HOME 작업지시분석 전체뷰가 합계엔 포함하나 표시 안 하는 항목 후보: [${extraCats.join(', ') || '없음'}]. 숨은액 누적 ${Number.isFinite(homeHiddenCum) ? won(homeHiddenCum) : '?'}·당월 ${Number.isFinite(homeHiddenCur) ? won(homeHiddenCur) : '?'}. 작업별 '기타' 컬럼합 ${Number.isFinite(etcSum) ? won(etcSum) : '?'}. → HOME 표시 로직에 카테고리 컬럼 누락(합계=Σ표시 위배). 개발팀 확인 요망.`,
    '코스관리_누락_note', '누락 카테고리 정체 규명 프로브(비파괴)');

  try {
    const dir = path.join('analysis'); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '코스관리_누락카테고리_프로브.json'), JSON.stringify(dump, null, 2), 'utf8');
  } catch { /* noop */ }

  await killAlarms(admin);
  await writeReport('코스관리_누락카테고리');
});

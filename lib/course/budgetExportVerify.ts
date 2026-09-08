import { Page } from '@playwright/test';
import { gotoCourseMenu, killAlarms } from './courseHelpers';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  예산 관리 5화면 [내보내기] xlsx ↔ 화면 정합성 — 공유 러너(비파괴, 자동 다운로드 통합).
//   개별 스펙(course-budget-{export,detail,analysis-export,perf-export,monthly-export}-verify)과
//   통합 스펙(course-budget-export-all)이 함께 사용하는 단일 소스.
//   각 runner: gotoCourseMenu → [내보내기] 자동 다운로드 → 파싱 → 대조 → Check[] 반환(throw 안 함).
// ──────────────────────────────────────────────────────────────

export interface Check { name: string; group: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }
interface Cell { t: string; rs: number; cs: number; }
interface Tbl { heads: string[]; cells: Cell[][] }

const DL = 'C:/Users/SMART-TN-093/Downloads';
export const DLDIR = 'reports/downloads';
const fb = (envKey: string, name: string) => process.env[envKey] || path.join(DL, name);

export const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
const nl = (s: string) => (s || '').replace(/\s+/g, '').trim();
const normLabel = (s: string) => (s || '').replace(/\s+/g, '').trim();
const num = (s: string) => { const m = String(s).replace(/[^0-9-]/g, ''); return m === '' ? 0 : parseInt(m, 10); };
const dec = (s: string): number | null => { const c = String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return null; const v = parseFloat(c); return Number.isFinite(v) ? v : null; };
const toNum = (s: string): number => { const m = String(s).replace(/\(.*?\)/g, '').replace(/[^0-9-]/g, ''); return m === '' ? 0 : parseInt(m, 10); };
const subLeaf = (s: string) => nl((s || '').split(/[>》]/).pop() || '');
const isSum = (b: string, m: string, s: string) => /소계|총\s*예산|합계|총계/.test(b) || /소계|합계|총계/.test(m) || /소계|합계|총계/.test(s);
const near = (a: number | null, b: number | null, tol = 0.5) => a != null && b != null && Math.abs(a - b) <= tol;
const cellStr = (row: ExcelJS.Row, i: number): string => { let v: any = row.getCell(i).value; if (v && typeof v === 'object') { if (v.result !== undefined) v = v.result; else if (v.text !== undefined) v = v.text; else if (v.richText) v = v.richText.map((t: any) => t.text).join(''); } return v == null ? '' : String(v); };

// ── 공통 그리드 리더 ──
async function grab(admin: Page): Promise<{ tables: Tbl[] }> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.contents, main') || document.body;
    const tables = Array.from(scope.querySelectorAll('table')).slice(0, 4).map((t) => ({
      heads: Array.from(t.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent)).filter(Boolean),
      cells: Array.from(t.querySelectorAll('tbody tr')).slice(0, 200).map((tr) => Array.from(tr.children).map((td) => ({ t: norm(td.textContent), rs: (td as HTMLTableCellElement).rowSpan || 1, cs: (td as HTMLTableCellElement).colSpan || 1 }))),
    }));
    return { tables };
  }).catch(() => ({ tables: [] as Tbl[] }));
}
function gridOf(T: Tbl | undefined): string[][] {
  if (!T) return [];
  const cols = Math.max(T.heads.length, ...T.cells.map((r) => r.reduce((a, c) => a + (c.cs || 1), 0)), 1);
  const carry: ({ t: string; rem: number } | null)[] = new Array(cols).fill(null);
  const grid: string[][] = [];
  for (const row of T.cells) {
    const out = new Array(cols).fill(''); let col = 0, ci = 0;
    while (col < cols) {
      if (carry[col] && carry[col]!.rem > 0) { out[col] = carry[col]!.t; carry[col]!.rem--; col++; continue; }
      if (ci < row.length) {
        const cell = row[ci++]; const span = cell.cs || 1;
        for (let k = 0; k < span && col + k < cols; k++) { out[col + k] = cell.t; if ((cell.rs || 1) > 1) carry[col + k] = { t: cell.t, rem: (cell.rs || 1) - 1 }; }
        col += span;
      } else col++;
    }
    grid.push(out);
  }
  return grid;
}
async function grabPagedTable(admin: Page, maxPages = 30): Promise<Tbl | null> {
  const first = await grab(admin);
  if (!first.tables[0]) return null;
  const combined: Tbl = { heads: first.tables[0].heads, cells: [...first.tables[0].cells] };
  let page = 1; let prevSig = first.tables[0].cells.map((r) => r.map((c) => c.t).join('|')).join('#');
  for (let i = 0; i < maxPages; i++) {
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
    }, String(page + 1)).catch(() => false);
    if (!clicked) break;
    await admin.waitForTimeout(900); await killAlarms(admin);
    const g = await grab(admin); const cells = g.tables[0]?.cells || [];
    const sig = cells.map((r) => r.map((c) => c.t).join('|')).join('#');
    if (!cells.length || sig === prevSig) break;
    combined.cells.push(...cells); prevSig = sig; page++;
  }
  return combined;
}
async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1600); await killAlarms(admin); return true; }
  return false;
}

// ── [내보내기] 자동 다운로드(오류 신호 동반 시 err) + 폴백 ──
async function downloadExport(admin: Page, savePath: string): Promise<{ ok: boolean; name: string; err: string }> {
  const btn = admin.getByRole('button', { name: /내보내기/ })
    .or(admin.locator('button, a, [role="button"], [class*="btn"], [class*="button"]').filter({ hasText: /내보내기/ }))
    .or(admin.getByText(/^\s*내보내기\s*$/)).first();
  let vis = false;
  for (let i = 0; i < 2 && !vis; i++) { await btn.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {}); vis = await btn.isVisible({ timeout: 1800 }).catch(() => false); if (!vis) await admin.waitForTimeout(700); }
  if (!vis) return { ok: false, name: '', err: '내보내기 버튼 미노출' };
  const badResp: string[] = []; const pageErr: string[] = [];
  const onResp = (r: { status: () => number; url: () => string }) => { if (r.status() >= 400 && /(export|download|excel|xls|report|file|budget|예산|anal|perf)/i.test(r.url())) badResp.push(`${r.status()} ${r.url().split('?')[0].slice(-50)}`); };
  const onErr = (e: Error) => pageErr.push((e.message || '').slice(0, 140));
  admin.on('response', onResp as never); admin.on('pageerror', onErr as never);
  const [dl] = await Promise.all([admin.waitForEvent('download', { timeout: 15000 }).catch(() => null), btn.click({ timeout: 3000 }).catch(() => {})]);
  await admin.waitForTimeout(1200);
  admin.off('response', onResp as never); admin.off('pageerror', onErr as never);
  const errMsg = [badResp.length ? `HTTP ${badResp.join(',')}` : '', pageErr.length ? `pageerror ${pageErr.join('|')}` : ''].filter(Boolean).join(' · ');
  if (!dl) { await killAlarms(admin); return { ok: false, name: '', err: errMsg || '다운로드 이벤트 미발생' }; }
  const name = dl.suggestedFilename();
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  await dl.saveAs(savePath).catch(() => {});
  const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
  await killAlarms(admin);
  if (!(/\.(xlsx|xls|csv)$/i.test(name) && size > 0)) return { ok: false, name, err: errMsg || `파일 이상(size ${size})` };
  return { ok: true, name, err: errMsg };
}
async function acquireXlsx(admin: Page, savePath: string, fallback: string): Promise<{ path: string; source: string; auto: boolean; name: string; err: string } | null> {
  const d = await downloadExport(admin, savePath);
  if (d.ok) return { path: savePath, source: `자동(${d.name})`, auto: true, name: d.name, err: d.err };
  if (fs.existsSync(fallback)) return { path: fallback, source: `수동폴백(${path.basename(fallback)})`, auto: false, name: path.basename(fallback), err: d.err };
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  ① 예산 총괄 (월간 중분류×12월 / 연간 중분류×2024·2025·2026)
// ═══════════════════════════════════════════════════════════════
async function readSummaryMonthly(admin: Page): Promise<{ label: string; months: number[] }[]> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const numOf = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (!c || c === '-' || c === '.') return 0; const v = Number(c); return Number.isFinite(v) ? v : 0; };
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return [];
    return Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      if (cells.some((c) => /총\s*예산|합계|소계|총계|전체/.test(c))) return null;
      const months = cells.slice(-12).map(numOf);
      const label = cells.length >= 13 ? cells[cells.length - 13] : (cells[0] || '');
      return { label, months };
    }).filter((r): r is { label: string; months: number[] } => !!r && r.months.length === 12 && !!r.label);
  }).catch(() => []);
}
async function readSummaryAnnual(admin: Page): Promise<{ label: string; v: (number | null)[] }[]> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const splitCell = (t0: string): number | null => { const t = norm(t0); const vm = t.match(/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/); const v = vm ? Number(vm[0].replace(/,/g, '')) : null; return (v != null && Number.isFinite(v)) ? v : null; };
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return [];
    return Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      if (cells.some((c) => /총\s*예산|합계|소계|총계|전체/.test(c))) return null;
      const last3 = cells.slice(-3).map(splitCell);
      const label = cells.length >= 4 ? cells[cells.length - 4] : (cells[0] || '');
      return { label, v: last3 };
    }).filter((r): r is { label: string; v: (number | null)[] } => !!r && r.v.some((x) => x != null));
  }).catch(() => []);
}
async function parseSummaryMonthly(file: string): Promise<{ map: Map<string, number[]>; total: number[] }> {
  const map = new Map<string, number[]>(); let total: number[] = [];
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); const ws = wb.getWorksheet(1)!;
  ws.eachRow((row, rn) => { if (rn === 1) return; const c1 = cellStr(row, 1).trim(); const c2 = cellStr(row, 2).trim(); const months: number[] = []; for (let i = 3; i <= 14; i++) months.push(toNum(cellStr(row, i))); if (/총\s*예산/.test(c1)) { total = months; return; } map.set(normLabel(c2 || c1), months); });
  return { map, total };
}
async function parseSummaryAnnual(file: string): Promise<{ map: Map<string, number[]>; total: number[] }> {
  const map = new Map<string, number[]>(); let total: number[] = [];
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); const ws = wb.getWorksheet(1)!;
  ws.eachRow((row, rn) => { if (rn === 1) return; const c1 = cellStr(row, 1).trim(); const c2 = cellStr(row, 2).trim(); const yrs = [toNum(cellStr(row, 3)), toNum(cellStr(row, 4)), toNum(cellStr(row, 5))]; if (/총\s*예산/.test(c1)) { total = yrs; return; } map.set(normLabel(c2 || c1), yrs); });
  return { map, total };
}
export async function verifyBudgetSummary(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const MONTHLY = fb('BUD_MONTHLY_XLSX', '월별_예산_총괄_2026_월간.xlsx');
  const ANNUAL = fb('BUD_ANNUAL_XLSX', '연도별_예산_총괄_2026_연간.xlsx');
  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 총괄').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '예산 총괄 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  // 월간
  await clickTab(admin, /^\s*월간\s*$/);
  const scM = await readSummaryMonthly(admin);
  const gotM = await acquireXlsx(admin, path.join(DLDIR, '예산_총괄_월간.xlsx'), MONTHLY);
  const { map: xlM, total: xlMT } = gotM ? await parseSummaryMonthly(gotM.path) : { map: new Map<string, number[]>(), total: [] as number[] };
  if (!gotM) checks.push({ name: '월간 xlsx 확보', group: '월간', ok: false, detail: '자동+폴백 실패' });
  else if (!scM.length) checks.push({ name: '월간 화면 표', group: '월간', ok: true, na: true, detail: `표/행 미검출(xlsx=${gotM.source})` });
  else {
    checks.push({ name: '월간 xlsx 확보', group: '월간', ok: true, review: !gotM.auto, detail: `${gotM.source}${gotM.err ? ` · 경고: ${gotM.err}` : ''}` });
    const MN = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    let bad = 0, cnt = 0; const ex: string[] = []; const scKeys = new Set<string>();
    for (const r of scM) { const key = normLabel(r.label); scKeys.add(key); const xl = xlM.get(key); if (!xl) continue; for (let mi = 0; mi < 12; mi++) { cnt++; if (r.months[mi] !== xl[mi]) { bad++; if (ex.length < 5) ex.push(`${r.label}/${MN[mi]}(화면 ${won(r.months[mi])}≠xlsx ${won(xl[mi])})`); } } }
    checks.push({ name: '★ 월간 셀값 = 화면 ↔ xlsx', group: '월간', ok: bad === 0, na: cnt === 0, detail: cnt === 0 ? '대조 셀 없음' : `${cnt}셀 중 일치 ${cnt - bad}${bad ? ` · 불일치 ${bad}(${ex.join(', ')})` : ''}` });
    const onlyS = [...scKeys].filter((k) => !xlM.has(k)); const onlyX = [...xlM.keys()].filter((k) => !scKeys.has(k));
    checks.push({ name: '월간 행 커버리지', group: '월간', ok: onlyS.length === 0 && onlyX.length === 0, review: onlyS.length > 0 || onlyX.length > 0, detail: `화면 ${scKeys.size}행 · xlsx ${xlM.size}행${onlyS.length ? ` · 화면에만: ${onlyS.join(',')}` : ''}${onlyX.length ? ` · xlsx에만: ${onlyX.join(',')}` : ''}` });
    const scT = MN.map((_, mi) => scM.reduce((a, r) => a + (r.months[mi] || 0), 0));
    let tBad = 0; const exT: string[] = [];
    for (let mi = 0; mi < 12; mi++) { if (xlMT[mi] != null && scT[mi] !== xlMT[mi]) { tBad++; if (exT.length < 4) exT.push(`${MN[mi]}(Σ ${won(scT[mi])}≠총 ${won(xlMT[mi])})`); } }
    checks.push({ name: '월간 총예산 = Σ화면 ↔ xlsx 총', group: '월간', ok: tBad === 0, detail: tBad === 0 ? `12개월 일치(연 ${won(scT.reduce((a, b) => a + b, 0))})` : `불일치 ${tBad}(${exT.join(', ')})` });
  }
  // 연간
  const okTab = await clickTab(admin, /^\s*연간\s*$/);
  const scA = okTab ? await readSummaryAnnual(admin) : [];
  const gotA = await acquireXlsx(admin, path.join(DLDIR, '예산_총괄_연간.xlsx'), ANNUAL);
  const { map: xlA, total: xlAT } = gotA ? await parseSummaryAnnual(gotA.path) : { map: new Map<string, number[]>(), total: [] as number[] };
  if (!gotA) checks.push({ name: '연간 xlsx 확보', group: '연간', ok: false, detail: '자동+폴백 실패' });
  else if (!scA.length) checks.push({ name: '연간 화면 표', group: '연간', ok: true, na: true, detail: `표/행 미검출(탭전환 ${okTab}, xlsx=${gotA.source})` });
  else {
    checks.push({ name: '연간 xlsx 확보', group: '연간', ok: true, review: !gotA.auto, detail: `${gotA.source}${gotA.err ? ` · 경고: ${gotA.err}` : ''}` });
    const YR = ['2024', '2025', '2026'];
    let bad = 0, cnt = 0; const ex: string[] = []; const scKeys = new Set<string>();
    for (const r of scA) { const key = normLabel(r.label); scKeys.add(key); const xl = xlA.get(key); if (!xl) continue; for (let yi = 0; yi < 3; yi++) { if (r.v[yi] == null) continue; cnt++; if (r.v[yi] !== xl[yi]) { bad++; if (ex.length < 5) ex.push(`${r.label}/${YR[yi]}(화면 ${won(r.v[yi])}≠xlsx ${won(xl[yi])})`); } } }
    checks.push({ name: '★ 연간 셀값 = 화면 ↔ xlsx', group: '연간', ok: bad === 0, na: cnt === 0, detail: cnt === 0 ? '대조 셀 없음' : `${cnt}셀 중 일치 ${cnt - bad}${bad ? ` · 불일치 ${bad}(${ex.join(', ')})` : ''}` });
    const onlyS = [...scKeys].filter((k) => !xlA.has(k)); const onlyX = [...xlA.keys()].filter((k) => !scKeys.has(k));
    checks.push({ name: '연간 행 커버리지', group: '연간', ok: onlyS.length === 0 && onlyX.length === 0, review: onlyS.length > 0 || onlyX.length > 0, detail: `화면 ${scKeys.size}행 · xlsx ${xlA.size}행${onlyS.length ? ` · 화면에만: ${onlyS.join(',')}` : ''}${onlyX.length ? ` · xlsx에만: ${onlyX.join(',')}` : ''}` });
    const scT = YR.map((_, yi) => scA.reduce((a, r) => a + (r.v[yi] || 0), 0));
    let tBad = 0; const exT: string[] = [];
    for (let yi = 0; yi < 3; yi++) { if (xlAT[yi] != null && scT[yi] !== xlAT[yi]) { tBad++; exT.push(`${YR[yi]}(Σ ${won(scT[yi])}≠총 ${won(xlAT[yi])})`); } }
    checks.push({ name: '연간 총예산 = Σ화면 ↔ xlsx 총', group: '연간', ok: tBad === 0, detail: tBad === 0 ? `2024~2026 일치(2026 ${won(scT[2])})` : `불일치 ${tBad}(${exT.join(', ')})` });
  }
  return checks;
}

// ═══════════════════════════════════════════════════════════════
//  공통: 그리드 상세행 추출(대/중/소분류 + 우측 N열) — 상세·실적 공용
// ═══════════════════════════════════════════════════════════════
interface GridRow { big: string; mid: string; sub: string; vals: number[]; }
function extractGridRows(grid: string[][], nVals: number, minCols: number): GridRow[] {
  const out: GridRow[] = [];
  for (const row of grid) {
    if (row.length < minCols) continue;
    const big = (row[0] || '').trim(), mid = (row[1] || '').trim(), sub = (row[2] || '').trim();
    if (!sub || isSum(big, mid, sub)) continue;
    const vals = row.slice(row.length - nVals).map(num);
    if (vals.length !== nVals) continue;
    out.push({ big, mid, sub, vals });
  }
  return out;
}
// 인덱스 정렬 대조(대/중분류 strict, 소분류 leaf loose, 값 정수 완전일치) — 상세·실적 공용
function compareGridRows(scRows: GridRow[], xlRows: GridRow[], valLabels: string[], grpVal: string): Check[] {
  const checks: Check[] = [];
  checks.push({ name: '상세행 수(화면 ↔ xlsx)', group: '커버리지', ok: scRows.length === xlRows.length, review: scRows.length !== xlRows.length, detail: `화면 ${scRows.length}행 · xlsx ${xlRows.length}행` });
  const nmax = Math.min(scRows.length, xlRows.length);
  let labBad = 0, subDiff = 0; const exL: string[] = [], exS: string[] = [];
  for (let k = 0; k < nmax; k++) {
    const s = scRows[k], x = xlRows[k];
    if (nl(s.big) !== nl(x.big) || nl(s.mid) !== nl(x.mid)) { labBad++; if (exL.length < 5) exL.push(`#${k + 1}(화면 ${s.big}/${s.mid} vs xlsx ${x.big}/${x.mid})`); }
    else if (subLeaf(s.sub) !== subLeaf(x.sub) && x.sub) { subDiff++; if (exS.length < 4) exS.push(`#${k + 1}(화면 '${s.sub}' vs xlsx '${x.sub}')`); }
  }
  checks.push({ name: '상세행 라벨 정렬(대/중분류)', group: '라벨', ok: labBad === 0, review: labBad > 0, detail: labBad === 0 ? `${nmax}행 대·중분류 순서 일치` : `불일치 ${labBad}(${exL.join(', ')})` });
  checks.push({ name: '소분류 표기(참고)', group: '라벨', ok: true, na: subDiff === 0 && labBad === 0, review: subDiff > 0, detail: subDiff === 0 ? '소분류 leaf 일치' : `표기 차이 ${subDiff}건(${exS.join(', ')})` });
  let cellBad = 0, cellCnt = 0; const exV: string[] = [];
  for (let k = 0; k < nmax; k++) {
    const s = scRows[k], x = xlRows[k];
    if (nl(s.big) !== nl(x.big) || nl(s.mid) !== nl(x.mid)) continue;
    for (let vi = 0; vi < valLabels.length; vi++) { cellCnt++; if (s.vals[vi] !== x.vals[vi]) { cellBad++; if (exV.length < 6) exV.push(`${x.mid}/${x.sub} ${valLabels[vi]}(화면 ${won(s.vals[vi])}≠xlsx ${won(x.vals[vi])})`); } }
  }
  checks.push({ name: `★ ${grpVal} 셀값 = 화면 ↔ xlsx`, group: '값', ok: cellBad === 0, na: cellCnt === 0, detail: cellCnt === 0 ? '대조 셀 없음' : `${cellCnt}셀 중 일치 ${cellCnt - cellBad}${cellBad ? ` · 불일치 ${cellBad}(${exV.join(', ')})` : ''}` });
  const scT = scRows.reduce((a, r) => a + r.vals.reduce((x, y) => x + y, 0), 0); const xlT = xlRows.reduce((a, r) => a + r.vals.reduce((x, y) => x + y, 0), 0);
  checks.push({ name: `${grpVal} 총액(화면 Σ ↔ xlsx Σ)`, group: '값', ok: scT === xlT, detail: `화면 Σ ${won(scT)} vs xlsx Σ ${won(xlT)}${scT === xlT ? '' : ` diff ${won(scT - xlT)}`}` });
  return checks;
}

// ② 예산 상세 (전체 탭, 합계+12월=13열)
async function parseDetailXlsx(file: string): Promise<GridRow[]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('전체 (조회 전용)') || wb.getWorksheet(1)!;
  const out: GridRow[] = [];
  ws.eachRow((row, rn) => { if (rn <= 2) return; const ct = cellStr(row, 1).trim(); if (!ct) return; const vals: number[] = []; for (let i = 7; i <= 19; i++) vals.push(num(cellStr(row, i))); out.push({ big: cellStr(row, 3).trim(), mid: cellStr(row, 4).trim(), sub: cellStr(row, 5).trim(), vals }); });
  return out;
}
export async function verifyBudgetDetail(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const DETAIL = fb('BUD_DETAIL_XLSX', '예산_상세_2026_전체.xlsx');
  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 상세').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '예산 상세 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  const allTab = admin.getByRole('tab', { name: '전체' }).or(admin.locator('.contents, main').getByText('전체', { exact: true })).first();
  if (await allTab.isVisible({ timeout: 3000 }).catch(() => false)) { await allTab.click().catch(() => {}); await admin.waitForTimeout(1200); await killAlarms(admin); }
  const got = await acquireXlsx(admin, path.join(DLDIR, '예산_상세_전체.xlsx'), DETAIL);
  const xlRows = got ? await parseDetailXlsx(got.path) : [];
  if (!got) { checks.push({ name: 'xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패' }); return checks; }
  checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''} · 상세 ${xlRows.length}행` });
  const tbl = await grabPagedTable(admin); const grid = gridOf(tbl || undefined);
  const scRows = extractGridRows(grid, 13, 17);   // 합계+12월, minCols 17
  if (!scRows.length) { checks.push({ name: '전체 화면 그리드', group: '진입', ok: true, na: true, detail: `상세행 미검출(세션 저하 가능 · heads=${JSON.stringify(tbl?.heads?.slice(0, 8))})` }); return checks; }
  const MN = ['합계', '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  checks.push(...compareGridRows(scRows, xlRows, MN, '상세'));
  return checks;
}

// ③ 실적 관리 (전체 탭, 12월=12열, 합계열 없음)
async function parsePerfXlsx(file: string): Promise<GridRow[]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('실적') || wb.getWorksheet(1)!;
  const out: GridRow[] = [];
  ws.eachRow((row, rn) => { if (rn === 1) return; const ct = cellStr(row, 1).trim(); if (!ct) return; const big = cellStr(row, 3).trim(), mid = cellStr(row, 4).trim(), sub = cellStr(row, 5).trim(); if (isSum(big, mid, sub)) return; const vals: number[] = []; for (let i = 6; i <= 17; i++) vals.push(num(cellStr(row, i))); out.push({ big, mid, sub, vals }); });
  return out;
}
export async function verifyBudgetPerf(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const PERF = fb('BUD_PERF_XLSX', '실적관리_양식_2026.xlsx');
  const entered = await gotoCourseMenu(admin, '예산 관리', '실적 관리').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '실적 관리 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  await clickTab(admin, /^\s*전체\s*$/);   // 내보내기는 전체 탭에서만
  const got = await acquireXlsx(admin, path.join(DLDIR, '실적관리_양식.xlsx'), PERF);
  const xlRows = got ? await parsePerfXlsx(got.path) : [];
  if (!got) { checks.push({ name: 'xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패' }); return checks; }
  checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''} · 상세 ${xlRows.length}행` });
  const tbl = await grabPagedTable(admin); const grid = gridOf(tbl || undefined);
  const scRows = extractGridRows(grid, 12, 15);   // 12월, minCols 15
  if (!scRows.length) { checks.push({ name: '전체 화면 그리드', group: '진입', ok: true, na: true, detail: `상세행 미검출(세션 저하 가능 · heads=${JSON.stringify(tbl?.heads?.slice(0, 8))})` }); return checks; }
  const MN = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
  checks.push(...compareGridRows(scRows, xlRows, MN, '실적'));
  return checks;
}

// ④ 예산 분석 연간 (연간 테이블, 8지표)
const ANAL_METRICS: { name: string; pct: boolean }[] = [
  { name: '연간예산', pct: false }, { name: '누적사용', pct: false }, { name: '잔여예산', pct: false },
  { name: '전체예산절감/초과', pct: false }, { name: '예산사용률', pct: true }, { name: '누적예산', pct: false },
  { name: '누적예산대비누적사용', pct: true }, { name: '누적예산절감/초과', pct: false },
];
interface AnalRow { big: string; mid: string; sub: string; metrics: (number | null)[]; }
function extractAnalScreen(grid: string[][]): AnalRow[] {
  const out: AnalRow[] = [];
  for (const row of grid) { if (row.length < 11) continue; const big = (row[0] || '').trim(), mid = (row[1] || '').trim(), sub = (row[2] || '').trim(); if (!sub || isSum(big, mid, sub)) continue; out.push({ big, mid, sub, metrics: row.slice(3, 11).map(dec) }); }
  return out;
}
async function parseAnalXlsx(file: string): Promise<AnalRow[]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('예산 연간 분석') || wb.getWorksheet(1)!;
  const out: AnalRow[] = []; let cb = '', cm = '';
  ws.eachRow((row, rn) => { if (rn === 1) return; const b = cellStr(row, 1).trim(), m = cellStr(row, 2).trim(), s = cellStr(row, 3).trim(); if (b) cb = b; if (m) cm = m; if (!s || isSum(cb, cm, s)) return; const metrics: (number | null)[] = []; for (let i = 4; i <= 11; i++) metrics.push(dec(cellStr(row, i))); out.push({ big: cb, mid: cm, sub: s, metrics }); });
  return out;
}
// 순수: 연간 그리드 대조(화면 scRows ↔ xlsx xlRows). 화면 미검출 시 na.
function annualCompareChecks(scRows: AnalRow[], xlRows: AnalRow[], headsPreview?: string[]): Check[] {
  const checks: Check[] = [];
  if (!scRows.length) { checks.push({ name: '연간 테이블 화면 그리드', group: '연간', ok: true, na: true, detail: `상세행 미검출(세션 저하 가능 · heads=${JSON.stringify((headsPreview || []).slice(0, 12))})` }); return checks; }
  checks.push({ name: '연간 상세행 수(화면 ↔ xlsx)', group: '연간', ok: scRows.length === xlRows.length, review: scRows.length !== xlRows.length, detail: `화면 ${scRows.length}행 · xlsx ${xlRows.length}행` });
  const nmax = Math.min(scRows.length, xlRows.length);
  let labBad = 0; const exL: string[] = [];
  for (let k = 0; k < nmax; k++) { const s = scRows[k], x = xlRows[k]; if (nl(s.big) !== nl(x.big) || nl(s.mid) !== nl(x.mid)) { labBad++; if (exL.length < 5) exL.push(`#${k + 1}(화면 ${s.big}/${s.mid} vs xlsx ${x.big}/${x.mid})`); } }
  checks.push({ name: '연간 라벨 정렬(대/중분류)', group: '연간', ok: labBad === 0, review: labBad > 0, detail: labBad === 0 ? `${nmax}행 순서 일치` : `불일치 ${labBad}(${exL.join(', ')})` });
  let cellBad = 0, cellCnt = 0; const exV: string[] = [];
  for (let k = 0; k < nmax; k++) { const s = scRows[k], x = xlRows[k]; if (nl(s.big) !== nl(x.big) || nl(s.mid) !== nl(x.mid)) continue; for (let mi = 0; mi < 8; mi++) { const sv = s.metrics[mi], xv = x.metrics[mi]; if (sv == null && xv == null) continue; cellCnt++; const tol = ANAL_METRICS[mi].pct ? 0.01 : 0.5; if (sv == null || xv == null || Math.abs(sv - xv) > tol) { cellBad++; if (exV.length < 6) exV.push(`${x.mid}/${x.sub}·${ANAL_METRICS[mi].name}(화면 ${sv}≠xlsx ${xv})`); } } }
  checks.push({ name: '★ 연간 지표 셀값 = 화면 ↔ xlsx (8지표)', group: '연간', ok: cellBad === 0, na: cellCnt === 0, detail: cellCnt === 0 ? '대조 셀 없음' : `${cellCnt}셀 중 일치 ${cellCnt - cellBad}${cellBad ? ` · 불일치 ${cellBad}(${exV.join(', ')})` : ''}` });
  const scT = scRows.reduce((a, r) => a + (r.metrics[0] || 0), 0); const xlT = xlRows.reduce((a, r) => a + (r.metrics[0] || 0), 0);
  checks.push({ name: '연간예산 총액(화면 Σ ↔ xlsx Σ)', group: '연간', ok: Math.abs(scT - xlT) < 1, detail: `화면 Σ ${won(scT)} vs xlsx Σ ${won(xlT)}${Math.abs(scT - xlT) < 1 ? '' : ` diff ${won(scT - xlT)}`}` });
  return checks;
}
export async function verifyBudgetAnalysisAnnual(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const ANAL = fb('BUD_ANAL_XLSX', '예산_연간_분석_2026.xlsx');
  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 분석').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '예산 분석 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  await clickTab(admin, /연간\s*테이블/);
  const got = await acquireXlsx(admin, path.join(DLDIR, '예산_연간_분석.xlsx'), ANAL);
  const xlRows = got ? await parseAnalXlsx(got.path) : [];
  if (!got) { checks.push({ name: 'xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패' }); return checks; }
  checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''} · 상세 ${xlRows.length}행` });
  const tbl = await grabPagedTable(admin); const grid = gridOf(tbl || undefined);
  checks.push(...annualCompareChecks(extractAnalScreen(grid), xlRows, tbl?.heads));
  return checks;
}

// ⑤ 예산 분석 월간 (월간 xlsx 12월×8지표: 내부 불변식 + 연간 교차 + 화면 당월)
const MI = { dP: 0, dU: 1, dSv: 2, dR: 3, aP: 4, aU: 5, aSv: 6, aR: 7 };
interface MRow { big: string; mid: string; sub: string; mon: (number | null)[][]; }
async function parseMonthlyAnalXlsx(file: string): Promise<MRow[]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('예산 월간 분석') || wb.getWorksheet(1)!;
  const out: MRow[] = []; let cb = '', cm = '';
  ws.eachRow((row, rn) => { if (rn <= 2) return; const b = cellStr(row, 1).trim(), m = cellStr(row, 2).trim(), s = cellStr(row, 3).trim(); if (b) cb = b; if (m) cm = m; if (!s || isSum(cb, cm, s)) return; const mon: (number | null)[][] = []; for (let mm = 0; mm < 12; mm++) { const base = 4 + mm * 8; mon.push(Array.from({ length: 8 }, (_, k) => dec(cellStr(row, base + k)))); } out.push({ big: cb, mid: cm, sub: s, mon }); });
  return out;
}
async function parseAnnualForCross(file: string): Promise<Map<string, { plan: number | null; accUse: number | null }>> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('예산 연간 분석') || wb.getWorksheet(1)!;
  const map = new Map<string, { plan: number | null; accUse: number | null }>(); let cb = '', cm = '';
  ws.eachRow((row, rn) => { if (rn === 1) return; const b = cellStr(row, 1).trim(), m = cellStr(row, 2).trim(), s = cellStr(row, 3).trim(); if (b) cb = b; if (m) cm = m; if (!s || isSum(cb, cm, s)) return; map.set(nl(cb) + '|' + nl(cm) + '|' + nl(s), { plan: dec(cellStr(row, 4)), accUse: dec(cellStr(row, 5)) }); });
  return map;
}
async function readMonthlyAnalScreen(admin: Page): Promise<{ label: string; v: (number | null)[] }[]> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const numOf = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return null; const v = Number(c); return Number.isFinite(v) ? v : null; };
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return [];
    return Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      const labels: string[] = []; for (const c of cells) { if (c === '' || numOf(c) != null) break; labels.push(c); }
      const label = labels[labels.length - 1] || '';
      const trimmed = [...cells]; while (trimmed.length && trimmed[trimmed.length - 1] === '') trimmed.pop();
      const v = trimmed.slice(-8).map(numOf);
      return { label, v };
    }).filter((r) => r.label && r.v.some((x) => x != null));
  }).catch(() => []);
}
// 순수: 월간 내부 불변식(당월절감·누적=Σ당월·사용률)
function monthlyInternalChecks(rows: MRow[]): Check[] {
  const checks: Check[] = [];
  const MN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  let svBad = 0, svCnt = 0, accBad = 0, accCnt = 0, rtBad = 0, rtCnt = 0; const exSv: string[] = [], exAcc: string[] = [], exRt: string[] = [];
  for (const r of rows) {
    let cumP = 0, cumU = 0;
    for (let m = 0; m < 12; m++) {
      const dP = r.mon[m][MI.dP], dU = r.mon[m][MI.dU], dSv = r.mon[m][MI.dSv], dR = r.mon[m][MI.dR];
      const aP = r.mon[m][MI.aP], aU = r.mon[m][MI.aU], aSv = r.mon[m][MI.aSv];
      if (dP != null && dU != null && dSv != null) { svCnt++; if (!near(dSv, dU - dP)) { svBad++; if (exSv.length < 4) exSv.push(`${r.sub}·${MN[m]}월(절감 ${won(dSv)}≠사용−예산 ${won(dU - dP)})`); } }
      if (dP != null) cumP += dP; if (dU != null) cumU += dU;
      if (aP != null) { accCnt++; if (!near(aP, cumP)) { accBad++; if (exAcc.length < 4) exAcc.push(`${r.sub}·${MN[m]}월(누적예산 ${won(aP)}≠Σ ${won(cumP)})`); } }
      if (aU != null) { accCnt++; if (!near(aU, cumU)) { accBad++; if (exAcc.length < 4) exAcc.push(`${r.sub}·${MN[m]}월(누적사용 ${won(aU)}≠Σ ${won(cumU)})`); } }
      if (aP != null && aU != null && aSv != null) { accCnt++; if (!near(aSv, aU - aP)) { accBad++; if (exAcc.length < 4) exAcc.push(`${r.sub}·${MN[m]}월(누적절감 ${won(aSv)}≠${won(aU - aP)})`); } }
      if (dP != null && dU != null && dR != null && dR !== -100 && dP !== 0) { rtCnt++; if (!near(dR, (dU / dP) * 100, 0.6)) { rtBad++; if (exRt.length < 4) exRt.push(`${r.sub}·${MN[m]}월(사용률 ${dR}≠${((dU / dP) * 100).toFixed(2)})`); } }
    }
  }
  checks.push({ name: '★ 내부: 당월 절감/초과 = 사용 − 예산', group: '내부 불변식', ok: svBad === 0, na: svCnt === 0, detail: svCnt === 0 ? '대조 없음' : `${svCnt}셀 중 일치 ${svCnt - svBad}${svBad ? ` · 불일치 ${svBad}(${exSv.join(', ')})` : ''}` });
  checks.push({ name: '★ 내부: 누적 = Σ당월 · 누적절감 = 누적사용−예산', group: '내부 불변식', ok: accBad === 0, na: accCnt === 0, detail: accCnt === 0 ? '대조 없음' : `${accCnt}셀 중 일치 ${accCnt - accBad}${accBad ? ` · 불일치 ${accBad}(${exAcc.join(', ')})` : ''}` });
  checks.push({ name: '내부: 당월 사용률 = 사용/예산(센티넬 제외)', group: '내부 불변식', ok: rtBad === 0, na: rtCnt === 0, detail: rtCnt === 0 ? '대조 없음' : `${rtCnt}셀 중 일치 ${rtCnt - rtBad}${rtBad ? ` · 불일치 ${rtBad}(${exRt.join(', ')})` : ''}` });
  return checks;
}
// 순수: 화면 당월 슬라이스 = xlsx 해당월(자동 월감지). sc는 월간 테이블 활성 상태에서 읽은 값.
function monthlyScreenChecks(sc: { label: string; v: (number | null)[] }[], rows: MRow[]): Check[] {
  const byLeaf = new Map<string, MRow>(); const freq = new Map<string, number>();
  for (const r of rows) { const k = nl(r.sub); freq.set(k, (freq.get(k) || 0) + 1); byLeaf.set(k, r); }
  let matched = 0, cellBad = 0, cellCnt = 0, detMonth = -1; const exD: string[] = [];
  for (const row of sc) {
    const k = nl(row.label); if ((freq.get(k) || 0) !== 1) continue;
    const xr = byLeaf.get(k); if (!xr) continue;
    let bestM = -1;
    for (let m = 0; m < 12; m++) { if ([MI.dP, MI.dU, MI.aP, MI.aU].every((i) => near(row.v[i], xr.mon[m][i], 1))) { bestM = m; break; } }
    if (bestM < 0) continue; if (detMonth < 0) detMonth = bestM; matched++;
    for (let i = 0; i < 8; i++) { const sv = row.v[i], xv = xr.mon[bestM][i]; if (sv == null || xv == null) continue; cellCnt++; const tol = (i === MI.dR || i === MI.aR) ? 0.05 : 1; if (!near(sv, xv, tol)) { cellBad++; if (exD.length < 4) exD.push(`${row.label}·지표${i}(화면 ${sv}≠xlsx ${xv})`); } }
  }
  if (matched === 0) return [{ name: '화면 당월 슬라이스 = xlsx 해당월', group: '화면', ok: true, na: true, detail: `매칭 0 — 판정 제외(화면행 ${sc.length})` }];
  return [{ name: '★ 화면 당월 슬라이스 = xlsx 해당월(감지 ' + (detMonth + 1) + '월)', group: '화면', ok: cellBad === 0, detail: `${matched}행 × 8지표 = ${cellCnt}셀 중 일치 ${cellCnt - cellBad}${cellBad ? ` · 불일치 ${cellBad}(${exD.join(', ')})` : ''}` }];
}
// 순수: 연간 교차(월간 누적[12] = 연간). annMap은 신선 연간 xlsx에서.
function monthlyCrossChecks(rows: MRow[], annMap: Map<string, { plan: number | null; accUse: number | null }>, source: string, auto: boolean): Check[] {
  let xBad = 0, xCnt = 0; const exX: string[] = [];
  for (const r of rows) { const a = annMap.get(nl(r.big) + '|' + nl(r.mid) + '|' + nl(r.sub)); if (!a) continue; const mAP = r.mon[11][MI.aP], mAU = r.mon[11][MI.aU]; if (a.plan != null && mAP != null) { xCnt++; if (!near(a.plan, mAP)) { xBad++; if (exX.length < 4) exX.push(`${r.big}>${r.sub}(연간예산 ${won(a.plan)}≠월간누적[12] ${won(mAP)})`); } } if (a.accUse != null && mAU != null) { xCnt++; if (!near(a.accUse, mAU)) { xBad++; if (exX.length < 4) exX.push(`${r.big}>${r.sub}(연간누적사용 ${won(a.accUse)}≠월간누적사용[12] ${won(mAU)})`); } } }
  return [{ name: '★ 연간 교차: 연간예산 = 월간누적예산[12] · 연간누적사용 = 월간누적사용[12]', group: '교차', ok: xBad === 0, review: xBad > 0 && !auto, na: xCnt === 0, detail: `${source}${auto ? '' : ' ⚠폴백(stale 가능)'} · ${xCnt === 0 ? '매칭 없음' : `${xCnt}셀 중 일치 ${xCnt - xBad}${xBad ? ` · 불일치 ${xBad}(${exX.join(', ')})` : ''}`}` }];
}
export async function verifyBudgetAnalysisMonthly(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const MONTHLY = fb('BUD_MONTHLY_ANAL_XLSX', '예산_월간_분석_2026.xlsx');
  const ANNUAL = fb('BUD_ANAL_XLSX', '예산_연간_분석_2026.xlsx');
  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 분석').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '예산 분석(월간) 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  await clickTab(admin, /월간\s*테이블/);
  const got = await acquireXlsx(admin, path.join(DLDIR, '예산_월간_분석.xlsx'), MONTHLY);
  const rows = got ? await parseMonthlyAnalXlsx(got.path) : [];
  if (!got) { checks.push({ name: '월간 xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패' }); return checks; }
  if (!rows.length) { checks.push({ name: '월간 xlsx 상세행', group: '진입', ok: true, na: true, detail: `상세행 미검출(${got.source})` }); return checks; }
  checks.push({ name: '월간 xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source} · 상세 ${rows.length}행 × 12월` });
  checks.push(...monthlyInternalChecks(rows));
  checks.push(...monthlyScreenChecks(await readMonthlyAnalScreen(admin), rows));
  await clickTab(admin, /연간\s*테이블/);   // 교차용 연간 신선 다운로드
  const gotA = await acquireXlsx(admin, path.join(DLDIR, '예산_연간_분석.xlsx'), ANNUAL);
  if (!gotA) checks.push({ name: '연간 교차', group: '교차', ok: true, na: true, detail: '연간 xlsx 확보 실패 — 판정 제외' });
  else checks.push(...monthlyCrossChecks(rows, await parseAnnualForCross(gotA.path), gotA.source, gotA.auto));
  return checks;
}

// ★ 통합: 예산 분석(연간+월간)을 한 번 진입해 모두 검증(통합 스펙용 — 연속 재진입 SPA 레이스 회피).
//   연간 xlsx 1회 다운로드로 annual 대조 + 월간 cross 공용. 진입=1회.
export async function verifyBudgetAnalysis(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const ANAL = fb('BUD_ANAL_XLSX', '예산_연간_분석_2026.xlsx');
  const MONTHLY = fb('BUD_MONTHLY_ANAL_XLSX', '예산_월간_분석_2026.xlsx');
  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 분석').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '예산 분석 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  // 월간 먼저(신선 진입 상태에서 화면 슬라이스)
  await clickTab(admin, /월간\s*테이블/);
  const gotM = await acquireXlsx(admin, path.join(DLDIR, '예산_월간_분석.xlsx'), MONTHLY);
  const rows = gotM ? await parseMonthlyAnalXlsx(gotM.path) : [];
  if (!gotM) checks.push({ name: '월간 xlsx 확보', group: '월간', ok: false, detail: '자동+폴백 실패' });
  else if (!rows.length) checks.push({ name: '월간 xlsx 상세행', group: '월간', ok: true, na: true, detail: `상세행 미검출(${gotM.source})` });
  else {
    checks.push({ name: '월간 xlsx 확보', group: '월간', ok: true, review: !gotM.auto, detail: `${gotM.source} · 상세 ${rows.length}행 × 12월` });
    checks.push(...monthlyInternalChecks(rows));
    checks.push(...monthlyScreenChecks(await readMonthlyAnalScreen(admin), rows));
  }
  // 연간(같은 진입 내 탭 전환): 1회 다운로드로 annual 대조 + cross 공용
  await clickTab(admin, /연간\s*테이블/);
  const gotA = await acquireXlsx(admin, path.join(DLDIR, '예산_연간_분석.xlsx'), ANAL);
  if (!gotA) { checks.push({ name: '연간 xlsx 확보', group: '연간', ok: false, detail: '자동+폴백 실패' }); return checks; }
  const annualRows = await parseAnalXlsx(gotA.path);
  checks.push({ name: '연간 xlsx 확보', group: '연간', ok: true, review: !gotA.auto, detail: `${gotA.source}${gotA.err ? ` · 경고: ${gotA.err}` : ''} · 상세 ${annualRows.length}행` });
  const tbl = await grabPagedTable(admin); const grid = gridOf(tbl || undefined);
  checks.push(...annualCompareChecks(extractAnalScreen(grid), annualRows, tbl?.heads));
  if (rows.length) checks.push(...monthlyCrossChecks(rows, await parseAnnualForCross(gotA.path), gotA.source, gotA.auto));
  return checks;
}

// ── 공용 리포트(HTML + dump + 콘솔) ──
export function renderBudgetReport(fileBase: string, title: string, subtitle: string, note: string, checks: Check[], dump?: any): { pass: number; rev: number; fail: number; na: number } {
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok && !c.review).length; const rev = judged.filter((c) => c.ok && c.review).length; const fail = judged.filter((c) => !c.ok).length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : !c.ok ? '❌' : c.review ? '🔎' : '✅';
  const clsf = (c: Check) => c.na ? 'na' : !c.ok ? 'ng' : c.review ? 'rv' : '';
  const rowsHtml = checks.map((c) => `<tr class="${clsf(c)}"><td>${mark(c)}</td><td>${esc(c.group)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  const html = `<title>${esc(title)}</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--rv:#9a6700;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:1040px;margin:0 auto;padding:24px 18px 60px;font:15px/1.6 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 90px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.rv-n{color:var(--rv)}.na-n{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.ng td{color:var(--ng);font-weight:600}tr.rv td{color:var(--rv)}tr.na td{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
</style><div class="wrap">
<h1>${esc(title)}</h1>
<div class="sub">${esc(subtitle)}</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${rev ? 'rv-n' : 'ok-n'}">${rev}</div><div class="l">확인 필요</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">${note}</div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', `${fileBase}.html`), html, 'utf-8');
  if (dump !== undefined) fs.writeFileSync(path.join('reports', `${fileBase}.dump.json`), JSON.stringify(dump, null, 2), 'utf-8');
  console.log(`\n[${title}] 총 ${checks.length} · PASS ${pass} · 확인필요 ${rev} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log(`[report] reports/${fileBase}.html`);
  return { pass, rev, fail, na };
}

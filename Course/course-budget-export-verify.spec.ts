import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  예산 총괄 [내보내기] xlsx ↔ 화면 노출 데이터 정합성 검증 (비파괴).
//   화면(월간 탭: 중분류×1~12월 / 연간 탭: 중분류×2024·2025·2026+YoY)을 읽어
//   [내보내기]로 받은 두 엑셀과 셀 단위 대조.
//   ★ 자동 다운로드 통합형: 각 탭에서 [내보내기]를 스크립트가 직접 눌러 다운로드 캡처 →
//     같은 런·같은 화면 상태의 xlsx와 대조(수동 단계 불요, staleness 원천 제거).
//     자동 다운로드 실패 시 env/기본 경로(수동 다운로드분)로 폴백.
//   실행: npm run course:auth 후
//   npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-export-verify.spec.ts --no-deps
//   env: BUD_MONTHLY_XLSX / BUD_ANNUAL_XLSX 로 폴백 파일 경로 재정의(기본 = 다운로드 폴더).
// ──────────────────────────────────────────────────────────────

const DL = 'C:/Users/SMART-TN-093/Downloads';
const MONTHLY_XLSX = process.env.BUD_MONTHLY_XLSX || path.join(DL, '월별_예산_총괄_2026_월간.xlsx');   // 폴백(수동)
const ANNUAL_XLSX = process.env.BUD_ANNUAL_XLSX || path.join(DL, '연도별_예산_총괄_2026_연간.xlsx');   // 폴백(수동)
const DLDIR = 'reports/downloads';                                                                    // 자동 다운로드 저장처

interface Check { name: string; group: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
const normLabel = (s: string) => (s || '').replace(/\s+/g, '').trim();

// ── 엑셀 셀 파서(수식/리치텍스트 대응) ──
function cellStr(row: ExcelJS.Row, i: number): string {
  let v: any = row.getCell(i).value;
  if (v && typeof v === 'object') {
    if (v.result !== undefined) v = v.result;
    else if (v.text !== undefined) v = v.text;
    else if (v.richText) v = v.richText.map((t: any) => t.text).join('');
  }
  return v == null ? '' : String(v);
}
const toNum = (s: string): number => { const m = String(s).replace(/\(.*?\)/g, '').replace(/[^0-9-]/g, ''); return m === '' ? 0 : parseInt(m, 10); };

// ── 화면 읽기: 월간 탭(중분류 → 12개월) ──
async function readScreenMonthly(admin: Page): Promise<{ label: string; months: number[] }[]> {
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

// ── 화면 읽기: 연간 탭(중분류 → 2024·2025·2026) ── (annual 스펙 splitCell 로직 재사용)
async function readScreenAnnual(admin: Page): Promise<{ label: string; v: (number | null)[] }[]> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const splitCell = (t0: string): number | null => {
      const t = norm(t0);
      const vm = t.match(/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/);
      const v = vm ? Number(vm[0].replace(/,/g, '')) : null;
      return (v != null && Number.isFinite(v)) ? v : null;
    };
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

async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1500); await killAlarms(admin); return true; }
  return false;
}

// ── [내보내기] 클릭 → 다운로드 캡처 → savePath 저장(오류 신호 동반 시 err). checkExport 검증 패턴 이식. ──
async function downloadExport(admin: Page, savePath: string): Promise<{ ok: boolean; name: string; err: string }> {
  const btn = admin.getByRole('button', { name: /내보내기/ })
    .or(admin.locator('button, a, [role="button"], [class*="btn"], [class*="button"]').filter({ hasText: /내보내기/ }))
    .or(admin.getByText(/^\s*내보내기\s*$/)).first();
  let vis = false;
  for (let i = 0; i < 2 && !vis; i++) { await btn.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {}); vis = await btn.isVisible({ timeout: 1800 }).catch(() => false); if (!vis) await admin.waitForTimeout(700); }
  if (!vis) return { ok: false, name: '', err: '내보내기 버튼 미노출' };
  const badResp: string[] = []; const pageErr: string[] = [];
  const onResp = (r: { status: () => number; url: () => string }) => { if (r.status() >= 400 && /(export|download|excel|xls|report|file|budget|예산)/i.test(r.url())) badResp.push(`${r.status()} ${r.url().split('?')[0].slice(-50)}`); };
  const onErr = (e: Error) => pageErr.push((e.message || '').slice(0, 140));
  admin.on('response', onResp as never); admin.on('pageerror', onErr as never);
  const [dl] = await Promise.all([admin.waitForEvent('download', { timeout: 15000 }).catch(() => null), btn.click({ timeout: 3000 }).catch(() => {})]);
  await admin.waitForTimeout(1200);
  admin.off('response', onResp as never); admin.off('pageerror', onErr as never);
  const err = [badResp.length ? `HTTP ${badResp.join(',')}` : '', pageErr.length ? `pageerror ${pageErr.join('|')}` : ''].filter(Boolean).join(' · ');
  if (!dl) { await killAlarms(admin); return { ok: false, name: '', err: err || '다운로드 이벤트 미발생' }; }
  const name = dl.suggestedFilename();
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  await dl.saveAs(savePath).catch(() => {});
  const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
  await killAlarms(admin);
  if (!(/\.(xlsx|xls|csv)$/i.test(name) && size > 0)) return { ok: false, name, err: err || `파일 이상(size ${size})` };
  return { ok: true, name, err };
}
// 자동 다운로드 우선 → 실패 시 폴백(env/기본 경로 수동분)이 존재하면 사용.
async function acquireXlsx(admin: Page, savePath: string, fallback: string): Promise<{ path: string; source: string; auto: boolean; name: string; err: string } | null> {
  const d = await downloadExport(admin, savePath);
  if (d.ok) return { path: savePath, source: `자동(${d.name})`, auto: true, name: d.name, err: d.err };
  if (fs.existsSync(fallback)) return { path: fallback, source: `수동폴백(${path.basename(fallback)})`, auto: false, name: path.basename(fallback), err: d.err };
  return null;
}

// ── xlsx 파서(월간/연간) ──
async function parseMonthly(file: string): Promise<{ map: Map<string, number[]>; total: number[] }> {
  const map = new Map<string, number[]>(); let total: number[] = [];
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); const ws = wb.getWorksheet(1)!;
  ws.eachRow((row, rn) => { if (rn === 1) return; const c1 = cellStr(row, 1).trim(); const c2 = cellStr(row, 2).trim(); const months: number[] = []; for (let i = 3; i <= 14; i++) months.push(toNum(cellStr(row, i)));
    if (/총\s*예산/.test(c1)) { total = months; return; } map.set(normLabel(c2 || c1), months); });
  return { map, total };
}
async function parseAnnual(file: string): Promise<{ map: Map<string, number[]>; total: number[] }> {
  const map = new Map<string, number[]>(); let total: number[] = [];
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); const ws = wb.getWorksheet(1)!;
  ws.eachRow((row, rn) => { if (rn === 1) return; const c1 = cellStr(row, 1).trim(); const c2 = cellStr(row, 2).trim(); const yrs = [toNum(cellStr(row, 3)), toNum(cellStr(row, 4)), toNum(cellStr(row, 5))];
    if (/총\s*예산/.test(c1)) { total = yrs; return; } map.set(normLabel(c2 || c1), yrs); });
  return { map, total };
}

test('예산 총괄 내보내기 xlsx ↔ 화면 데이터 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks: Check[] = [];
  const dump: any = { ts: new Date().toISOString(), fallback: { MONTHLY_XLSX, ANNUAL_XLSX }, acquire: {} };

  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 총괄').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);

  if (!entered) {
    checks.push({ name: '예산 총괄 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' });
  } else {
    // ── 월간 탭 ──
    await clickTab(admin, /^\s*월간\s*$/);
    const scMonthly = await readScreenMonthly(admin);
    dump.screenMonthly = scMonthly;
    // 자동 다운로드(월간) → 파싱
    const gotM = await acquireXlsx(admin, path.join(DLDIR, '예산_총괄_월간.xlsx'), MONTHLY_XLSX);
    dump.acquire.monthly = gotM;
    const { map: xlMonthly, total: xlMonthlyTotal } = gotM ? await parseMonthly(gotM.path) : { map: new Map<string, number[]>(), total: [] as number[] };
    if (!gotM) {
      checks.push({ name: '월간 xlsx 확보(자동 다운로드/폴백)', group: '월간', ok: false, detail: '자동 다운로드 실패 + 폴백 파일 없음 — 대조 불가' });
    } else if (!scMonthly.length) {
      checks.push({ name: '월간 화면 표', group: '월간', ok: true, na: true, detail: `월간 표/행 미검출 — 판정 제외(xlsx=${gotM.source})` });
    } else {
      checks.push({ name: '월간 xlsx 확보', group: '월간', ok: true, review: !gotM.auto, detail: `${gotM.source}${gotM.err ? ` · 경고: ${gotM.err}` : ''}` });
      const MN = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
      let cellBad = 0, cellCnt = 0; const exM: string[] = []; const scKeys = new Set<string>();
      for (const r of scMonthly) {
        const key = normLabel(r.label); scKeys.add(key);
        const xl = xlMonthly.get(key);
        if (!xl) { continue; }   // 아래 커버리지 체크에서 다룸
        for (let mi = 0; mi < 12; mi++) { cellCnt++; if (r.months[mi] !== xl[mi]) { cellBad++; if (exM.length < 5) exM.push(`${r.label}/${MN[mi]}(화면 ${won(r.months[mi])}≠xlsx ${won(xl[mi])})`); } }
      }
      checks.push({ name: '★ 월간 셀값 = 화면 ↔ xlsx', group: '월간', ok: cellBad === 0, na: cellCnt === 0, detail: cellCnt === 0 ? '대조 셀 없음' : `${cellCnt}셀 중 일치 ${cellCnt - cellBad}${cellBad ? ` · 불일치 ${cellBad}(${exM.join(', ')})` : ''}` });
      // 행 커버리지(화면↔xlsx 라벨 집합)
      const onlyScreen = [...scKeys].filter((k) => !xlMonthly.has(k));
      const onlyXlsx = [...xlMonthly.keys()].filter((k) => !scKeys.has(k));
      checks.push({ name: '월간 행 커버리지(화면 ↔ xlsx 중분류)', group: '월간', ok: onlyScreen.length === 0 && onlyXlsx.length === 0, review: onlyScreen.length > 0 || onlyXlsx.length > 0, detail: `화면 ${scKeys.size}행 · xlsx ${xlMonthly.size}행${onlyScreen.length ? ` · 화면에만: ${onlyScreen.join(',')}` : ''}${onlyXlsx.length ? ` · xlsx에만: ${onlyXlsx.join(',')}` : ''}` });
      // 총예산 행 대조(화면 총예산 vs xlsx 총예산)
      const scTotal = MN.map((_, mi) => scMonthly.reduce((a, r) => a + (r.months[mi] || 0), 0));
      let tBad = 0; const exT: string[] = [];
      for (let mi = 0; mi < 12; mi++) { if (xlMonthlyTotal[mi] != null && scTotal[mi] !== xlMonthlyTotal[mi]) { tBad++; if (exT.length < 4) exT.push(`${MN[mi]}(Σ화면 ${won(scTotal[mi])}≠xlsx총 ${won(xlMonthlyTotal[mi])})`); } }
      checks.push({ name: '월간 총예산 = Σ화면중분류 ↔ xlsx 총예산', group: '월간', ok: tBad === 0, detail: tBad === 0 ? `12개월 총예산 일치(연 ${won(scTotal.reduce((a, b) => a + b, 0))})` : `불일치 ${tBad}(${exT.join(', ')})` });
    }

    // ── 연간 탭 ──
    const okTab = await clickTab(admin, /^\s*연간\s*$/);
    const scAnnual = okTab ? await readScreenAnnual(admin) : [];
    dump.screenAnnual = scAnnual;
    // 자동 다운로드(연간) → 파싱
    const gotA = await acquireXlsx(admin, path.join(DLDIR, '예산_총괄_연간.xlsx'), ANNUAL_XLSX);
    dump.acquire.annual = gotA;
    const { map: xlAnnual, total: xlAnnualTotal } = gotA ? await parseAnnual(gotA.path) : { map: new Map<string, number[]>(), total: [] as number[] };
    if (!gotA) {
      checks.push({ name: '연간 xlsx 확보(자동 다운로드/폴백)', group: '연간', ok: false, detail: '자동 다운로드 실패 + 폴백 파일 없음 — 대조 불가' });
    } else if (!scAnnual.length) {
      checks.push({ name: '연간 화면 표', group: '연간', ok: true, na: true, detail: `연간 표/행 미검출 — 판정 제외(탭전환 ${okTab}, xlsx=${gotA.source})` });
    } else {
      checks.push({ name: '연간 xlsx 확보', group: '연간', ok: true, review: !gotA.auto, detail: `${gotA.source}${gotA.err ? ` · 경고: ${gotA.err}` : ''}` });
      const YR = ['2024', '2025', '2026'];
      let cellBad = 0, cellCnt = 0; const exA: string[] = []; const scKeys = new Set<string>();
      for (const r of scAnnual) {
        const key = normLabel(r.label); scKeys.add(key);
        const xl = xlAnnual.get(key);
        if (!xl) continue;
        for (let yi = 0; yi < 3; yi++) { if (r.v[yi] == null) continue; cellCnt++; if (r.v[yi] !== xl[yi]) { cellBad++; if (exA.length < 5) exA.push(`${r.label}/${YR[yi]}(화면 ${won(r.v[yi])}≠xlsx ${won(xl[yi])})`); } }
      }
      checks.push({ name: '★ 연간 셀값 = 화면 ↔ xlsx', group: '연간', ok: cellBad === 0, na: cellCnt === 0, detail: cellCnt === 0 ? '대조 셀 없음' : `${cellCnt}셀 중 일치 ${cellCnt - cellBad}${cellBad ? ` · 불일치 ${cellBad}(${exA.join(', ')})` : ''}` });
      const onlyScreen = [...scKeys].filter((k) => !xlAnnual.has(k));
      const onlyXlsx = [...xlAnnual.keys()].filter((k) => !scKeys.has(k));
      checks.push({ name: '연간 행 커버리지(화면 ↔ xlsx 중분류)', group: '연간', ok: onlyScreen.length === 0 && onlyXlsx.length === 0, review: onlyScreen.length > 0 || onlyXlsx.length > 0, detail: `화면 ${scKeys.size}행 · xlsx ${xlAnnual.size}행${onlyScreen.length ? ` · 화면에만: ${onlyScreen.join(',')}` : ''}${onlyXlsx.length ? ` · xlsx에만: ${onlyXlsx.join(',')}` : ''}` });
      // 총예산 행 대조
      const scTotal = YR.map((_, yi) => scAnnual.reduce((a, r) => a + (r.v[yi] || 0), 0));
      let tBad = 0; const exT: string[] = [];
      for (let yi = 0; yi < 3; yi++) { if (xlAnnualTotal[yi] != null && scTotal[yi] !== xlAnnualTotal[yi]) { tBad++; exT.push(`${YR[yi]}(Σ화면 ${won(scTotal[yi])}≠xlsx총 ${won(xlAnnualTotal[yi])})`); } }
      checks.push({ name: '연간 총예산 = Σ화면중분류 ↔ xlsx 총예산', group: '연간', ok: tBad === 0, detail: tBad === 0 ? `2024~2026 총예산 일치(2026 ${won(scTotal[2])})` : `불일치 ${tBad}(${exT.join(', ')})` });
    }
  }

  // ── 리포트 ──
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok && !c.review).length; const rev = judged.filter((c) => c.ok && c.review).length; const fail = judged.filter((c) => !c.ok).length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : !c.ok ? '❌' : c.review ? '🔎' : '✅';
  const cls = (c: Check) => c.na ? 'na' : !c.ok ? 'ng' : c.review ? 'rv' : '';
  const rowsHtml = checks.map((c) => `<tr class="${cls(c)}"><td>${mark(c)}</td><td>${esc(c.group)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  const html = `<title>예산 총괄 내보내기 정합성</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--rv:#9a6700;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 60px;font:15px/1.6 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 90px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.rv-n{color:var(--rv)}.na-n{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.ng td{color:var(--ng);font-weight:600}tr.rv td{color:var(--rv)}tr.na td{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
</style><div class="wrap">
<h1>예산 총괄 — [내보내기] xlsx ↔ 화면 데이터 정합성</h1>
<div class="sub">예산 관리 > 예산 총괄 · 킹즈락 · ${ts} · 비파괴</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${rev ? 'rv-n' : 'ok-n'}">${rev}</div><div class="l">확인 필요</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">각 탭에서 <b>[내보내기]를 스크립트가 직접 눌러 다운로드</b>(자동 다운로드 통합형 · 같은 런·같은 화면 상태) → 화면(월간: 중분류×1~12월 / 연간: 중분류×2024·2025·2026)과 <b>셀 단위 대조</b>. 라벨(중분류)로 매칭 · 값 완전 일치=정상 · 행 집합 차이=확인 필요(🔎). 자동 다운로드 실패 시 폴백(수동)=🔎 표시. 참고(➖)=판정 제외.</div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-budget-export-verify.html'), html, 'utf-8');
  fs.writeFileSync(path.join('reports', 'course-budget-export-verify.dump.json'), JSON.stringify(dump, null, 2), 'utf-8');
  console.log(`\n[예산총괄 내보내기 정합성] 총 ${checks.length} · PASS ${pass} · 확인필요 ${rev} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-budget-export-verify.html');
});

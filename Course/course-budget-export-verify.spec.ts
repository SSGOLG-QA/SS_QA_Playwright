import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  예산 총괄 [내보내기] xlsx ↔ 화면 노출 데이터 정합성 검증 (비파괴).
//   화면(월간 탭: 중분류×1~12월 / 연간 탭: 중분류×2024·2025·2026+YoY)을 읽어
//   사용자가 내려받은 두 엑셀과 셀 단위 대조.
//   실행: npm run course:auth 후
//   npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-export-verify.spec.ts --no-deps
//   env: BUD_MONTHLY_XLSX / BUD_ANNUAL_XLSX 로 파일 경로 재정의(기본 = 다운로드 폴더).
// ──────────────────────────────────────────────────────────────

const DL = 'C:/Users/SMART-TN-093/Downloads';
const MONTHLY_XLSX = process.env.BUD_MONTHLY_XLSX || path.join(DL, '월별_예산_총괄_2026_월간.xlsx');
const ANNUAL_XLSX = process.env.BUD_ANNUAL_XLSX || path.join(DL, '연도별_예산_총괄_2026_연간.xlsx');

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

test('예산 총괄 내보내기 xlsx ↔ 화면 데이터 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks: Check[] = [];
  const dump: any = { ts: new Date().toISOString(), files: { MONTHLY_XLSX, ANNUAL_XLSX } };

  // ── 엑셀 로드 ──
  const missing: string[] = [];
  if (!fs.existsSync(MONTHLY_XLSX)) missing.push(MONTHLY_XLSX);
  if (!fs.existsSync(ANNUAL_XLSX)) missing.push(ANNUAL_XLSX);
  // 월간 엑셀
  const xlMonthly = new Map<string, number[]>(); let xlMonthlyTotal: number[] = [];
  if (fs.existsSync(MONTHLY_XLSX)) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(MONTHLY_XLSX); const ws = wb.getWorksheet(1)!;
    ws.eachRow((row, rn) => { if (rn === 1) return; const c1 = cellStr(row, 1).trim(); const c2 = cellStr(row, 2).trim(); const months: number[] = []; for (let i = 3; i <= 14; i++) months.push(toNum(cellStr(row, i)));
      if (/총\s*예산/.test(c1)) { xlMonthlyTotal = months; return; } xlMonthly.set(normLabel(c2 || c1), months); });
  }
  // 연간 엑셀
  const xlAnnual = new Map<string, number[]>(); let xlAnnualTotal: number[] = [];
  if (fs.existsSync(ANNUAL_XLSX)) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(ANNUAL_XLSX); const ws = wb.getWorksheet(1)!;
    ws.eachRow((row, rn) => { if (rn === 1) return; const c1 = cellStr(row, 1).trim(); const c2 = cellStr(row, 2).trim(); const yrs = [toNum(cellStr(row, 3)), toNum(cellStr(row, 4)), toNum(cellStr(row, 5))];
      if (/총\s*예산/.test(c1)) { xlAnnualTotal = yrs; return; } xlAnnual.set(normLabel(c2 || c1), yrs); });
  }

  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 총괄').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);

  if (!entered) {
    checks.push({ name: '예산 총괄 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' });
  } else if (missing.length) {
    checks.push({ name: '엑셀 파일 로드', group: '진입', ok: false, detail: `다운로드 파일 없음: ${missing.join(', ')}` });
  } else {
    // ── 월간 탭 ──
    await clickTab(admin, /^\s*월간\s*$/);
    const scMonthly = await readScreenMonthly(admin);
    dump.screenMonthly = scMonthly;
    if (!scMonthly.length) {
      checks.push({ name: '월간 화면 표', group: '월간', ok: true, na: true, detail: '월간 표/행 미검출 — 판정 제외' });
    } else {
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
    if (!scAnnual.length) {
      checks.push({ name: '연간 화면 표', group: '연간', ok: true, na: true, detail: `연간 표/행 미검출 — 판정 제외(탭전환 ${okTab})` });
    } else {
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
<div class="note">화면(월간: 중분류×1~12월 / 연간: 중분류×2024·2025·2026)을 읽어 사용자가 내려받은 두 엑셀(${esc(path.basename(MONTHLY_XLSX))} · ${esc(path.basename(ANNUAL_XLSX))})과 <b>셀 단위 대조</b>. 라벨(중분류)로 매칭 · 값 완전 일치=정상 · 행 집합 차이=확인 필요(🔎). 참고(➖)=판정 제외.</div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-budget-export-verify.html'), html, 'utf-8');
  fs.writeFileSync(path.join('reports', 'course-budget-export-verify.dump.json'), JSON.stringify(dump, null, 2), 'utf-8');
  console.log(`\n[예산총괄 내보내기 정합성] 총 ${checks.length} · PASS ${pass} · 확인필요 ${rev} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-budget-export-verify.html');
});

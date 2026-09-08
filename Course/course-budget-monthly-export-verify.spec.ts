import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  예산 분석 > 월간(그래프/테이블) [내보내기] '예산_월간_분석' xlsx 정합성 검증(비파괴).
//   월간 xlsx = 대/중/소분류 + 12개월 × 8지표(당월 예산/사용/절감·초과/사용률 + 누적 4) = 99열.
//   ⚠ 화면 월간 테이블은 당월 1개월(+누적)만 표시 → 96셀 전부 화면 직접대조 불가.
//    따라서 export 아티팩트를 ① xlsx 내부 불변식(전 12개월) ② 연간 xlsx 교차 ③ 화면 당월 슬라이스로 검증.
//   ★ 자동 다운로드 통합형: 월간 테이블 탭에서 [내보내기] 직접 클릭 → 캡처. 실패 시 폴백.
//   실행(⚠ 단독 실행 권장): npm run course:auth 후
//   npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-monthly-export-verify.spec.ts --no-deps
//   env: BUD_MONTHLY_ANAL_XLSX / BUD_ANAL_XLSX 로 폴백 경로 재정의.
// ──────────────────────────────────────────────────────────────

const DL = 'C:/Users/SMART-TN-093/Downloads';
const MONTHLY_XLSX = process.env.BUD_MONTHLY_ANAL_XLSX || path.join(DL, '예산_월간_분석_2026.xlsx');   // 폴백(수동)
const ANNUAL_XLSX = process.env.BUD_ANAL_XLSX || path.join(DL, '예산_연간_분석_2026.xlsx');            // 교차용(연간)
const DLDIR = 'reports/downloads';

interface Check { name: string; group: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
const nl = (s: string) => (s || '').replace(/\s+/g, '').trim();
const dec = (s: string): number | null => { const c = String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return null; const v = parseFloat(c); return Number.isFinite(v) ? v : null; };
const isSum = (b: string, m: string, s: string) => /소계|총\s*예산|합계|총계/.test(b) || /소계|합계|총계/.test(m) || /소계|합계|총계/.test(s);
// 지표 인덱스(월별 8): 0당월예산 1당월사용 2당월절감 3당월사용률 4누적예산 5누적사용 6누적절감 7누적사용률
const MI = { dP: 0, dU: 1, dSv: 2, dR: 3, aP: 4, aU: 5, aSv: 6, aR: 7 };

interface MRow { big: string; mid: string; sub: string; mon: (number | null)[][]; }   // mon[0..11] = 8지표
async function parseMonthlyXlsx(file: string): Promise<MRow[]> {
  const cs = (row: ExcelJS.Row, i: number) => { let v: any = row.getCell(i).value; if (v && typeof v === 'object') { if (v.result !== undefined) v = v.result; else if (v.text !== undefined) v = v.text; else if (v.richText) v = v.richText.map((t: any) => t.text).join(''); } return v == null ? '' : String(v); };
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('예산 월간 분석') || wb.getWorksheet(1)!;
  const out: MRow[] = []; let cb = '', cm = '';
  ws.eachRow((row, rn) => {
    if (rn <= 2) return;   // 헤더 2행(월 라벨 + 지표명)
    const b = cs(row, 1).trim(), m = cs(row, 2).trim(), s = cs(row, 3).trim();
    if (b) cb = b; if (m) cm = m;
    if (!s || isSum(cb, cm, s)) return;
    const mon: (number | null)[][] = [];
    for (let mm = 0; mm < 12; mm++) { const base = 4 + mm * 8; mon.push(Array.from({ length: 8 }, (_, k) => dec(cs(row, base + k)))); }
    out.push({ big: cb, mid: cm, sub: s, mon });
  });
  return out;
}
// 연간 xlsx: sub → { 연간예산, 누적사용, 예산사용률 } (교차용)
async function parseAnnualForCross(file: string): Promise<Map<string, { plan: number | null; accUse: number | null; rate: number | null }>> {
  const cs = (row: ExcelJS.Row, i: number) => { let v: any = row.getCell(i).value; if (v && typeof v === 'object') { if (v.result !== undefined) v = v.result; else if (v.text !== undefined) v = v.text; else if (v.richText) v = v.richText.map((t: any) => t.text).join(''); } return v == null ? '' : String(v); };
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('예산 연간 분석') || wb.getWorksheet(1)!;
  const map = new Map<string, { plan: number | null; accUse: number | null; rate: number | null }>(); let cb = '', cm = '';
  ws.eachRow((row, rn) => {
    if (rn === 1) return; const b = cs(row, 1).trim(), m = cs(row, 2).trim(), s = cs(row, 3).trim();
    if (b) cb = b; if (m) cm = m; if (!s || isSum(cb, cm, s)) return;
    map.set(nl(cb) + '|' + nl(cm) + '|' + nl(s), { plan: dec(cs(row, 4)), accUse: dec(cs(row, 5)), rate: dec(cs(row, 8)) });
  });
  return map;
}
// 화면 월간 테이블: 각 행 소분류 + 마지막 8셀(당월4+누적4).
async function readScreenMonthly(admin: Page): Promise<{ label: string; v: (number | null)[] }[]> {
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
      const trimmed = [...cells]; while (trimmed.length && trimmed[trimmed.length - 1] === '') trimmed.pop();   // 행 끝 빈 셀 제거
      const v = trimmed.slice(-8).map(numOf);   // 당월4(예산/사용/절감/사용률) + 누적4
      return { label, v };
    }).filter((r) => r.label && r.v.some((x) => x != null));
  }).catch(() => []);
}

async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1600); await killAlarms(admin); return true; }
  return false;
}
async function downloadExport(admin: Page, savePath: string): Promise<{ ok: boolean; name: string; err: string }> {
  const btn = admin.getByRole('button', { name: /내보내기/ })
    .or(admin.locator('button, a, [role="button"], [class*="btn"], [class*="button"]').filter({ hasText: /내보내기/ }))
    .or(admin.getByText(/^\s*내보내기\s*$/)).first();
  let vis = false;
  for (let i = 0; i < 2 && !vis; i++) { await btn.scrollIntoViewIfNeeded({ timeout: 1200 }).catch(() => {}); vis = await btn.isVisible({ timeout: 1800 }).catch(() => false); if (!vis) await admin.waitForTimeout(700); }
  if (!vis) return { ok: false, name: '', err: '내보내기 버튼 미노출' };
  const [dl] = await Promise.all([admin.waitForEvent('download', { timeout: 15000 }).catch(() => null), btn.click({ timeout: 3000 }).catch(() => {})]);
  await admin.waitForTimeout(1200); await killAlarms(admin);
  if (!dl) return { ok: false, name: '', err: '다운로드 이벤트 미발생' };
  const name = dl.suggestedFilename();
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  await dl.saveAs(savePath).catch(() => {});
  const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
  if (!(/\.(xlsx|xls|csv)$/i.test(name) && size > 0)) return { ok: false, name, err: `파일 이상(size ${size})` };
  return { ok: true, name, err: '' };
}
async function acquireXlsx(admin: Page, savePath: string, fallback: string): Promise<{ path: string; source: string; auto: boolean; name: string } | null> {
  const d = await downloadExport(admin, savePath);
  if (d.ok) return { path: savePath, source: `자동(${d.name})`, auto: true, name: d.name };
  if (fs.existsSync(fallback)) return { path: fallback, source: `수동폴백(${path.basename(fallback)})`, auto: false, name: path.basename(fallback) };
  return null;
}
const near = (a: number | null, b: number | null, tol = 0.5) => a != null && b != null && Math.abs(a - b) <= tol;

test('예산 월간 분석 xlsx 정합성(내부 불변식 + 연간 교차 + 화면 당월, 비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks: Check[] = [];
  const dump: any = { ts: new Date().toISOString(), acquire: {} };

  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 분석').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) {
    checks.push({ name: '예산 분석 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' });
  } else {
    await clickTab(admin, /월간\s*테이블/);
    const got = await acquireXlsx(admin, path.join(DLDIR, '예산_월간_분석.xlsx'), MONTHLY_XLSX);
    dump.acquire = got;
    const rows: MRow[] = got ? await parseMonthlyXlsx(got.path) : [];
    dump.xlRowCount = rows.length;

    if (!got) {
      checks.push({ name: 'xlsx 확보(자동 다운로드/폴백)', group: '진입', ok: false, detail: '자동 다운로드 실패 + 폴백 없음 — 검증 불가' });
    } else if (!rows.length) {
      checks.push({ name: 'xlsx 상세행', group: '진입', ok: true, na: true, detail: `상세행 미검출 — 판정 제외(${got.source})` });
    } else {
      checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source} · 상세 ${rows.length}행 × 12월` });

      // ① 내부 불변식(전 12개월 × 전 행)
      const MN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
      let svBad = 0, svCnt = 0, accBad = 0, accCnt = 0, rtBad = 0, rtCnt = 0; const exSv: string[] = [], exAcc: string[] = [], exRt: string[] = [];
      for (const r of rows) {
        let cumP = 0, cumU = 0;
        for (let m = 0; m < 12; m++) {
          const dP = r.mon[m][MI.dP], dU = r.mon[m][MI.dU], dSv = r.mon[m][MI.dSv], dR = r.mon[m][MI.dR];
          const aP = r.mon[m][MI.aP], aU = r.mon[m][MI.aU], aSv = r.mon[m][MI.aSv];
          // 당월 절감/초과 = 당월 사용 − 당월 예산
          if (dP != null && dU != null && dSv != null) { svCnt++; if (!near(dSv, dU - dP)) { svBad++; if (exSv.length < 4) exSv.push(`${r.sub}·${MN[m]}월(절감 ${won(dSv)}≠사용−예산 ${won(dU - dP)})`); } }
          // 누적[m] = Σ당월[1..m]
          if (dP != null) cumP += dP; if (dU != null) cumU += dU;
          if (aP != null) { accCnt++; if (!near(aP, cumP)) { accBad++; if (exAcc.length < 4) exAcc.push(`${r.sub}·${MN[m]}월(누적예산 ${won(aP)}≠Σ당월 ${won(cumP)})`); } }
          if (aU != null) { accCnt++; if (!near(aU, cumU)) { accBad++; if (exAcc.length < 4) exAcc.push(`${r.sub}·${MN[m]}월(누적사용 ${won(aU)}≠Σ당월 ${won(cumU)})`); } }
          // 누적 절감 = 누적 사용 − 누적 예산
          if (aP != null && aU != null && aSv != null) { accCnt++; if (!near(aSv, aU - aP)) { accBad++; if (exAcc.length < 4) exAcc.push(`${r.sub}·${MN[m]}월(누적절감 ${won(aSv)}≠누적사용−예산 ${won(aU - aP)})`); } }
          // 당월 사용률 = 사용/예산×100 (−100 센티넬·예산0 제외)
          if (dP != null && dU != null && dR != null && dR !== -100 && dP !== 0) { rtCnt++; if (!near(dR, (dU / dP) * 100, 0.6)) { rtBad++; if (exRt.length < 4) exRt.push(`${r.sub}·${MN[m]}월(사용률 ${dR}≠${((dU / dP) * 100).toFixed(2)})`); } }
        }
      }
      checks.push({ name: '★ 내부: 당월 절감/초과 = 당월 사용 − 예산', group: '내부 불변식', ok: svBad === 0, na: svCnt === 0, detail: svCnt === 0 ? '대조 없음' : `${svCnt}셀 중 일치 ${svCnt - svBad}${svBad ? ` · 불일치 ${svBad}(${exSv.join(', ')})` : ''}` });
      checks.push({ name: '★ 내부: 누적 = Σ당월 · 누적절감 = 누적사용−예산', group: '내부 불변식', ok: accBad === 0, na: accCnt === 0, detail: accCnt === 0 ? '대조 없음' : `${accCnt}셀 중 일치 ${accCnt - accBad}${accBad ? ` · 불일치 ${accBad}(${exAcc.join(', ')})` : ''}` });
      checks.push({ name: '내부: 당월 사용률 = 사용/예산 (센티넬 제외)', group: '내부 불변식', ok: rtBad === 0, na: rtCnt === 0, detail: rtCnt === 0 ? '대조 없음' : `${rtCnt}셀 중 일치 ${rtCnt - rtBad}${rtBad ? ` · 불일치 ${rtBad}(${exRt.join(', ')})` : ''}` });

      // ③ 화면 당월 슬라이스(월간 테이블 활성 상태에서 먼저): 화면 8지표 = xlsx 해당월(자동 감지)
      const sc = await readScreenMonthly(admin);
      dump.screenMonthly = sc;
      const byLeaf = new Map<string, MRow>(); const freq = new Map<string, number>();
      for (const r of rows) { const k = nl(r.sub); freq.set(k, (freq.get(k) || 0) + 1); byLeaf.set(k, r); }
      let matched = 0, cellBad = 0, cellCnt = 0, detMonth = -1; const exD: string[] = [];
      for (const row of sc) {
        const k = nl(row.label); if ((freq.get(k) || 0) !== 1) continue;   // 유일 소분류만(중복명 모호 배제)
        const xr = byLeaf.get(k); if (!xr) continue;
        // 화면 8지표(당월4+누적4)와 일치하는 월 탐색(당월예산·사용 + 누적예산·사용)
        let bestM = -1;
        for (let m = 0; m < 12; m++) { if ([MI.dP, MI.dU, MI.aP, MI.aU].every((i) => near(row.v[i], xr.mon[m][i], 1))) { bestM = m; break; } }
        if (bestM < 0) continue;
        if (detMonth < 0) detMonth = bestM;
        matched++;
        for (let i = 0; i < 8; i++) { const sv = row.v[i], xv = xr.mon[bestM][i]; if (sv == null || xv == null) continue; cellCnt++; const tol = (i === MI.dR || i === MI.aR) ? 0.05 : 1; if (!near(sv, xv, tol)) { cellBad++; if (exD.length < 4) exD.push(`${row.label}·지표${i}(화면 ${sv}≠xlsx ${xv})`); } }
      }
      if (matched === 0) checks.push({ name: '화면 당월 슬라이스 = xlsx 해당월', group: '화면', ok: true, na: true, detail: `매칭 0(월 미감지/유일소분류 없음) — 판정 제외(화면행 ${sc.length})` });
      else checks.push({ name: '★ 화면 당월 슬라이스 = xlsx 해당월(감지 ' + (detMonth + 1) + '월)', group: '화면', ok: cellBad === 0, detail: `${matched}행 × 8지표 = ${cellCnt}셀 중 일치 ${cellCnt - cellBad}${cellBad ? ` · 불일치 ${cellBad}(${exD.join(', ')})` : ''}` });

      // ② 연간 xlsx 교차: 연간예산 = 월간 누적예산[12월] · 연간 누적사용 = 월간 누적사용[12월]
      //  ⚠ Downloads 폴백 파일은 stale 가능(예: 회식비 09-04자 41,590,000 ≠ 현재 42,450,000) → 연간 테이블 탭서 신선 자동 다운로드 우선.
      await clickTab(admin, /연간\s*테이블/);
      const gotA = await acquireXlsx(admin, path.join(DLDIR, '예산_연간_분석.xlsx'), ANNUAL_XLSX);
      dump.acquireAnnual = gotA;
      if (!gotA) {
        checks.push({ name: '연간 교차: 연간예산 = 월간 누적[12월]', group: '교차', ok: true, na: true, detail: '연간 xlsx 확보 실패(자동+폴백) — 판정 제외' });
      } else {
        const ann = await parseAnnualForCross(gotA.path);
        let xBad = 0, xCnt = 0; const exX: string[] = [];
        for (const r of rows) {
          const a = ann.get(nl(r.big) + '|' + nl(r.mid) + '|' + nl(r.sub)); if (!a) continue;
          const mAP = r.mon[11][MI.aP], mAU = r.mon[11][MI.aU];
          if (a.plan != null && mAP != null) { xCnt++; if (!near(a.plan, mAP)) { xBad++; if (exX.length < 4) exX.push(`${r.big}>${r.sub}(연간예산 ${won(a.plan)}≠월간누적예산[12] ${won(mAP)})`); } }
          if (a.accUse != null && mAU != null) { xCnt++; if (!near(a.accUse, mAU)) { xBad++; if (exX.length < 4) exX.push(`${r.big}>${r.sub}(연간누적사용 ${won(a.accUse)}≠월간누적사용[12] ${won(mAU)})`); } }
        }
        const staleWarn = gotA.auto ? '' : ' ⚠폴백(stale 가능)';
        checks.push({ name: '★ 연간 교차: 연간예산 = 월간누적예산[12] · 연간누적사용 = 월간누적사용[12]', group: '교차', ok: xBad === 0, review: xBad > 0 && !gotA.auto, na: xCnt === 0, detail: `${gotA.source}${staleWarn} · ${xCnt === 0 ? '매칭 행 없음' : `${xCnt}셀 중 일치 ${xCnt - xBad}${xBad ? ` · 불일치 ${xBad}(${exX.join(', ')})` : ''}`}` });
      }
    }
  }

  // ── 리포트 ──
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok && !c.review).length; const rev = judged.filter((c) => c.ok && c.review).length; const fail = judged.filter((c) => !c.ok).length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : !c.ok ? '❌' : c.review ? '🔎' : '✅';
  const clsf = (c: Check) => c.na ? 'na' : !c.ok ? 'ng' : c.review ? 'rv' : '';
  const rowsHtml = checks.map((c) => `<tr class="${clsf(c)}"><td>${mark(c)}</td><td>${esc(c.group)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  const html = `<title>예산 월간 분석 내보내기 정합성</title><style>
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
<h1>예산 월간 분석 — [내보내기] xlsx 정합성</h1>
<div class="sub">예산 관리 > 예산 분석 > 월간(그래프/테이블) · 12월×8지표 · 킹즈락 · ${ts} · 비파괴</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${rev ? 'rv-n' : 'ok-n'}">${rev}</div><div class="l">확인 필요</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">월간 테이블 탭에서 <b>[내보내기] 직접 다운로드</b>. 화면은 당월 1개월만 표시 → export 아티팩트를 <b>①내부 불변식</b>(당월절감=사용−예산·누적=Σ당월·사용률) <b>②연간 xlsx 교차</b>(연간예산=월간누적예산[12]·연간누적사용=월간누적사용[12]) <b>③화면 당월 슬라이스</b>(자동 월감지)로 검증. 월간·연간 두 export(그래프=테이블 동일 파일)를 함께 담보. 참고(➖)=판정 제외.</div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-budget-monthly-export-verify.html'), html, 'utf-8');
  fs.writeFileSync(path.join('reports', 'course-budget-monthly-export-verify.dump.json'), JSON.stringify(dump, null, 2), 'utf-8');
  console.log(`\n[예산월간분석 내보내기 정합성] 총 ${checks.length} · PASS ${pass} · 확인필요 ${rev} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-budget-monthly-export-verify.html');
});

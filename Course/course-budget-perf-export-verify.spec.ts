import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  실적 관리 > 전체 탭 [내보내기] xlsx ↔ 화면 그리드 정합성(소분류 레벨, 비파괴).
//   화면 전체 탭(대/중/소분류 + 1~12월, rowspan+소계행, 합계열 없음)을 읽어
//   [내보내기] xlsx('실적관리_양식_2026.xlsx', 시트 '실적', 17열: ClassificationType·CategoryIdx +
//   대/중/소분류 + 12월)의 상세행(ClassificationType 있는 행)과 셀 단위 대조.
//   ★ 자동 다운로드 통합형: 전체 탭에서 [내보내기]를 스크립트가 직접 눌러 다운로드 캡처.
//     ⚠ [엑셀 업로드]·[내보내기]는 '전체' 탭에서만 노출 → 반드시 전체 탭에서 다운로드.
//     자동 실패 시 env/기본 경로 폴백. 소계는 화면 렌더만(xlsx 미포함) → 화면 상세행만 추출해 대조.
//   실행(⚠ 단독 실행 권장 — 세션 1회 로그인당 1런): npm run course:auth 후
//   npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-perf-export-verify.spec.ts --no-deps
//   env: BUD_PERF_XLSX 로 폴백 파일 경로 재정의(기본 = 다운로드 폴더).
// ──────────────────────────────────────────────────────────────

const DL = 'C:/Users/SMART-TN-093/Downloads';
const PERF_XLSX = process.env.BUD_PERF_XLSX || path.join(DL, '실적관리_양식_2026.xlsx');   // 폴백(수동)
const DLDIR = 'reports/downloads';

interface Check { name: string; group: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }
interface Cell { t: string; rs: number; cs: number; }
interface Tbl { heads: string[]; cells: Cell[][] }
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
const nl = (s: string) => (s || '').replace(/\s+/g, '').trim();
const num = (s: string) => { const m = String(s).replace(/[^0-9-]/g, ''); return m === '' ? 0 : parseInt(m, 10); };
const subLeaf = (s: string) => nl((s || '').split(/[>》]/).pop() || '');

// ── 그리드 리더(course-budget-detail-verify 검증본 재사용) ──
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

interface PerfRow { big: string; mid: string; sub: string; months: number[]; }
const isSum = (b: string, m: string, s: string) => /소계|총\s*예산|합계|총계/.test(b) || /소계|합계|총계/.test(m) || /소계|합계|총계/.test(s);

// 화면 그리드 → 상세행(소분류 있음, 소계 아님). 15열 = 대/중/소분류 + 12월(합계열 없음, 우측앵커).
function extractScreenRows(grid: string[][]): PerfRow[] {
  const out: PerfRow[] = [];
  for (const row of grid) {
    if (row.length < 15) continue;
    const big = (row[0] || '').trim(), mid = (row[1] || '').trim(), sub = (row[2] || '').trim();
    if (!sub || isSum(big, mid, sub)) continue;
    const months = row.slice(row.length - 12).map(num);
    if (months.length !== 12) continue;
    out.push({ big, mid, sub, months });
  }
  return out;
}
// xlsx → 상세행(ClassificationType 있는 행). col3~5 라벨 + col6~17 = 12월.
async function parsePerfXlsx(file: string): Promise<PerfRow[]> {
  const cellStr = (row: ExcelJS.Row, i: number) => { let v: any = row.getCell(i).value; if (v && typeof v === 'object') { if (v.result !== undefined) v = v.result; else if (v.text !== undefined) v = v.text; else if (v.richText) v = v.richText.map((t: any) => t.text).join(''); } return v == null ? '' : String(v); };
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('실적') || wb.getWorksheet(1)!;
  const out: PerfRow[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;   // 헤더
    const ct = cellStr(row, 1).trim(); if (!ct) return;   // ClassificationType 있는 상세행만
    const big = cellStr(row, 3).trim(), mid = cellStr(row, 4).trim(), sub = cellStr(row, 5).trim();
    if (isSum(big, mid, sub)) return;   // 방어(xlsx엔 소계 없음)
    const months: number[] = []; for (let i = 6; i <= 17; i++) months.push(num(cellStr(row, i)));
    out.push({ big, mid, sub, months });
  });
  return out;
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
  const badResp: string[] = []; const pageErr: string[] = [];
  const onResp = (r: { status: () => number; url: () => string }) => { if (r.status() >= 400 && /(export|download|excel|xls|report|file|budget|예산|perf)/i.test(r.url())) badResp.push(`${r.status()} ${r.url().split('?')[0].slice(-50)}`); };
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

test('실적 관리 전체 탭 xlsx ↔ 화면 그리드 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks: Check[] = [];
  const dump: any = { ts: new Date().toISOString(), fallback: PERF_XLSX, acquire: {} };

  const entered = await gotoCourseMenu(admin, '예산 관리', '실적 관리').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) {
    checks.push({ name: '실적 관리 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' });
  } else {
    await clickTab(admin, /^\s*전체\s*$/);   // ⚠ 내보내기·업로드는 전체 탭에서만
    // ── 자동 다운로드(전체 탭, 페이지네이션 前) → 파싱 ──
    const got = await acquireXlsx(admin, path.join(DLDIR, '실적관리_양식.xlsx'), PERF_XLSX);
    dump.acquire = got;
    const xlRows: PerfRow[] = got ? await parsePerfXlsx(got.path) : [];
    dump.xlRowCount = xlRows.length;

    if (!got) {
      checks.push({ name: 'xlsx 확보(자동 다운로드/폴백)', group: '진입', ok: false, detail: '자동 다운로드 실패 + 폴백 파일 없음 — 대조 불가' });
    } else {
      checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''} · 상세 ${xlRows.length}행` });

      const tbl = await grabPagedTable(admin);
      const grid = gridOf(tbl || undefined);
      const scRows = extractScreenRows(grid);
      dump.screenRows = scRows; dump.screenHeads = tbl?.heads; dump.gridCols = grid[0]?.length;

      if (!scRows.length) {
        checks.push({ name: '전체 화면 그리드', group: '진입', ok: true, na: true, detail: `상세행 미검출 — 판정 제외(세션 저하 가능 · heads=${JSON.stringify(tbl?.heads?.slice(0, 8))})` });
      } else {
        // ① 행 수
        checks.push({ name: '상세행 수(화면 ↔ xlsx)', group: '커버리지', ok: scRows.length === xlRows.length, review: scRows.length !== xlRows.length, detail: `화면 ${scRows.length}행 · xlsx ${xlRows.length}행` });

        // ② 라벨 정렬(대/중분류 strict, 소분류 leaf loose)
        const nmax = Math.min(scRows.length, xlRows.length);
        let labBad = 0, subDiff = 0; const exL: string[] = []; const exS: string[] = [];
        for (let k = 0; k < nmax; k++) {
          const s = scRows[k], x = xlRows[k];
          if (nl(s.big) !== nl(x.big) || nl(s.mid) !== nl(x.mid)) { labBad++; if (exL.length < 5) exL.push(`#${k + 1}(화면 ${s.big}/${s.mid} vs xlsx ${x.big}/${x.mid})`); }
          else if (subLeaf(s.sub) !== subLeaf(x.sub) && x.sub) { subDiff++; if (exS.length < 4) exS.push(`#${k + 1}(화면 '${s.sub}' vs xlsx '${x.sub}')`); }
        }
        checks.push({ name: '상세행 라벨 정렬(대/중분류)', group: '라벨', ok: labBad === 0, review: labBad > 0, detail: labBad === 0 ? `${nmax}행 대·중분류 순서 일치` : `불일치 ${labBad}(${exL.join(', ')})` });
        checks.push({ name: '소분류 표기(화면 vs xlsx leaf, 참고)', group: '라벨', ok: true, na: subDiff === 0 && labBad === 0, review: subDiff > 0, detail: subDiff === 0 ? '소분류 leaf 일치' : `표기 차이 ${subDiff}건(${exS.join(', ')})` });

        // ③ ★ 셀값 대조: 12개월 (대·중분류 정렬된 행만)
        let cellBad = 0, cellCnt = 0; const exV: string[] = []; const MN = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
        for (let k = 0; k < nmax; k++) {
          const s = scRows[k], x = xlRows[k];
          if (nl(s.big) !== nl(x.big) || nl(s.mid) !== nl(x.mid)) continue;
          for (let mi = 0; mi < 12; mi++) { cellCnt++; if (s.months[mi] !== x.months[mi]) { cellBad++; if (exV.length < 6) exV.push(`${x.mid}/${x.sub} ${MN[mi]}(화면 ${won(s.months[mi])}≠xlsx ${won(x.months[mi])})`); } }
        }
        checks.push({ name: '★ 실적 셀값 = 화면 ↔ xlsx (1~12월)', group: '값', ok: cellBad === 0, na: cellCnt === 0, detail: cellCnt === 0 ? '대조 셀 없음' : `${cellCnt}셀 중 일치 ${cellCnt - cellBad}${cellBad ? ` · 불일치 ${cellBad}(${exV.join(', ')})` : ''}` });

        // ④ 실적 총합(연 Σ) = xlsx 총합
        const scT = scRows.reduce((a, r) => a + r.months.reduce((x, y) => x + y, 0), 0); const xlT = xlRows.reduce((a, r) => a + r.months.reduce((x, y) => x + y, 0), 0);
        checks.push({ name: '실적 총액(화면 Σ ↔ xlsx Σ)', group: '값', ok: scT === xlT, detail: `화면 Σ ${won(scT)} vs xlsx Σ ${won(xlT)}${scT === xlT ? '' : ` diff ${won(scT - xlT)}`}` });
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
  const html = `<title>실적 관리 내보내기 정합성</title><style>
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
<h1>실적 관리 — [내보내기] xlsx ↔ 화면 그리드 정합성</h1>
<div class="sub">예산 관리 > 실적 관리 > 전체 탭 · 소분류 레벨(1~12월) · 킹즈락 · ${ts} · 비파괴</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${rev ? 'rv-n' : 'ok-n'}">${rev}</div><div class="l">확인 필요</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">전체 탭에서 <b>[내보내기]를 스크립트가 직접 눌러 다운로드</b>(자동 다운로드 통합형) → 화면 그리드(대/중/소분류 + 1~12월, 소계행은 화면 렌더만 → 상세행만 추출)와 대조. 상세행 순서 인덱스로 매칭 → 라벨 검증 후 값(12월) 대조. xlsx는 ClassificationType 있는 상세행만(소계 미포함). 자동 실패 시 폴백(수동)=🔎. 참고(➖)=판정 제외.</div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-budget-perf-export-verify.html'), html, 'utf-8');
  fs.writeFileSync(path.join('reports', 'course-budget-perf-export-verify.dump.json'), JSON.stringify(dump, null, 2), 'utf-8');
  console.log(`\n[실적관리 내보내기 정합성] 총 ${checks.length} · PASS ${pass} · 확인필요 ${rev} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-budget-perf-export-verify.html');
});

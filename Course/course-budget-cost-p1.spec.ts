import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseOneYear } from '../lib/course/courseHelpers';
import { num, firstNum, near, nearRel } from '../lib/course/domain/budgetCost';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  예산·비용 정합성 P1 보완(비파괴) — budget-verify 미커버 4항목.
//   ③ 분류별 월간 탭: 행 합계=Σ(1~12월) · 월간 합계=연간 합계
//   ④ 위치별 월간 탭: 동형(코스/홀축)
//   ⑤ 기간별 전연도 증감: YoY% = round((당해−전년)/전년×100,1) · ▲/▼ 부호
//   ⑥ 기간별 위치 탭: YoY% 동형 + 교차(기간별-위치 당해총계 = 위치별 연간 총계)
//   실행: npm run course:auth 후 npm run course:budget-p1 → reports/course-budget-cost-p1.html
//   ⚠ 탭 라벨 실측(2026-08-27): 연간|월간, 기간별 위치 탭, 연도컬럼 2024/2025(YoY)/2026(YoY). 비파괴(조회·탭전환만).
// ──────────────────────────────────────────────────────────────

const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
interface Chk { name: string; scope: string; ok: boolean; na?: boolean; detail: string; }

// 첫 데이터 표의 tbody 행을 원본 셀 텍스트 배열로 수집(rowspan 대비 우측앵커는 호출부에서).
async function readRows(admin: Page): Promise<{ heads: string[]; rows: string[][] }> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { heads: [], rows: [] };
    const heads = Array.from(tbl.querySelectorAll('thead th')).map((th) => norm(th.textContent));
    const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((td) => norm(td.textContent)));
    return { heads, rows };
  }).catch(() => ({ heads: [], rows: [] }));
}
async function enter(admin: Page, sub: string) {
  await gotoCourseMenu(admin, '비용 관리', sub).catch(() => {});
  await admin.waitForTimeout(1500); await killAlarms(admin);
  const dp = await admin.locator('.contents .datepicker-input:visible, main .datepicker-input:visible').count().catch(() => 0);
  if (dp >= 2) { await setCourseOneYear(admin).catch(() => {}); await admin.waitForTimeout(800); }
}
async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  // ⚠ 프로브 검증: exact:false + 공백허용 정규식이라야 탭 매칭됨(strict는 미매칭).
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1600); await killAlarms(admin); return true; }
  return false;
}
// 합계/총비용 컬럼을 헤더로 찾아 전 행 합산 = 총계(전체 행 없어도 성립). rowspan은 우측앵커로 흡수.
//   ⚠ 기본 접힘(top-level 행만) 가정 — 하위 행 펼침 시 이중합. 코스관리 기본은 접힘.
function sumHap(heads: string[], rows: string[][]): number | null {
  const ci = heads.findIndex((h) => /^합계$/.test(h.replace(/\s+/g, '')) || /총\s*비용/.test(h));
  if (ci < 0) return null;
  const fromEnd = heads.length - ci;
  let sum = 0; let any = false;
  for (const r of rows) { const v = num(r[r.length - fromEnd]); if (v != null) { sum += v; any = true; } }
  return any ? sum : null;
}
const labelOf = (r: string[]) => (r.find((c) => c && num(c) == null) || r[0] || '').trim();
const isTotalRow = (r: string[]) => /^전체$|^합계$|^총계$/.test(labelOf(r).replace(/\s+/g, ''));
// "3,210,689▲ 8.0%" → { val, yoy(부호포함%) }
function parseYoYCell(t: string): { val: number | null; yoy: number | null } {
  const val = firstNum(t);
  const m = (t || '').match(/([▲▼])\s*(-?[\d.]+)\s*%/);
  let yoy: number | null = null;
  if (m) { const p = Number(m[2]); yoy = m[1] === '▼' ? -Math.abs(p) : Math.abs(p); }
  return { val, yoy };
}

test('예산·비용 정합성 P1 보완 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(500_000);
  const admin = await openCourseAdmin(page, context);
  const checks: Chk[] = [];
  const push = (c: Chk) => checks.push(c);

  // ═══ ③ 분류별 월간 ═══
  let catAnnualTotal: number | null = null, catMonthlyTotal: number | null = null;
  await enter(admin, '분류별 비용');
  { await clickTab(admin, /^\s*연간\s*$/); const { heads, rows } = await readRows(admin); catAnnualTotal = sumHap(heads, rows); }
  {
    const okTab = await clickTab(admin, /^\s*월간\s*$/);
    const { heads, rows } = await readRows(admin);
    const V = 13;   // 합계 + 1~12월
    const bad: string[] = []; let cnt = 0;
    for (const r of rows) {
      const v = r.slice(-V).map((c) => num(c)); if (v.length < V || v[0] == null) continue; cnt++;
      const sum = v.slice(1).reduce((a: number, b) => a + (b || 0), 0);
      if (!near(v[0]!, sum, 2)) bad.push(`${labelOf(r)}(합계 ${won(v[0])}≠Σ월 ${won(sum)})`);
    }
    catMonthlyTotal = sumHap(heads, rows);
    if (!okTab || !cnt) push({ name: '③ 분류별 월간: 행 합계 = Σ(1~12월)', scope: 'cat', ok: true, na: true, detail: `월간 탭/데이터 없음 — 판정 제외(탭 ${okTab}, 행 ${cnt})` });
    else push({ name: '③ 분류별 월간: 행 합계 = Σ(1~12월)', scope: 'cat', ok: bad.length === 0, detail: bad.length === 0 ? `${cnt}행 전부 합계=Σ월 성립` : `불일치 ${bad.length}: ${bad.slice(0, 3).join(', ')}` });
    push({ name: '③ 분류별: 월간 총계 = 연간 총계(Σ행)', scope: 'cat', ok: catAnnualTotal != null && catMonthlyTotal != null ? nearRel(catMonthlyTotal, catAnnualTotal, 0.005) : true, na: catAnnualTotal == null || catMonthlyTotal == null, detail: catAnnualTotal == null || catMonthlyTotal == null ? `대조 부족(연간 ${won(catAnnualTotal)}·월간 ${won(catMonthlyTotal)})` : `연간 ${won(catAnnualTotal)} ${nearRel(catMonthlyTotal, catAnnualTotal, 0.005) ? '=' : '≠'} 월간 ${won(catMonthlyTotal)}` });
  }

  // ═══ ④ 위치별 월간 ═══
  let locAnnualTotal: number | null = null, locMonthlyTotal: number | null = null;
  await enter(admin, '위치별 비용');
  { await clickTab(admin, /^\s*연간\s*$/); const { heads, rows } = await readRows(admin); locAnnualTotal = sumHap(heads, rows); }
  {
    const okTab = await clickTab(admin, /^\s*월간\s*$/);
    const { heads, rows } = await readRows(admin);
    const V = 13;
    const bad: string[] = []; let cnt = 0;
    for (const r of rows) {
      const v = r.slice(-V).map((c) => num(c)); if (v.length < V || v[0] == null) continue; cnt++;
      const sum = v.slice(1).reduce((a: number, b) => a + (b || 0), 0);
      if (!near(v[0]!, sum, 2)) bad.push(`${labelOf(r)}(합계 ${won(v[0])}≠Σ월 ${won(sum)})`);
    }
    locMonthlyTotal = sumHap(heads, rows);
    if (!okTab || !cnt) push({ name: '④ 위치별 월간: 행 합계 = Σ(1~12월)', scope: 'loc', ok: true, na: true, detail: `월간 탭/데이터 없음 — 판정 제외(탭 ${okTab}, 행 ${cnt})` });
    else push({ name: '④ 위치별 월간: 행 합계 = Σ(1~12월)', scope: 'loc', ok: bad.length === 0, detail: bad.length === 0 ? `${cnt}행 전부 합계=Σ월 성립` : `불일치 ${bad.length}: ${bad.slice(0, 3).join(', ')}` });
    push({ name: '④ 위치별: 월간 총계 = 연간 총계(Σ행)', scope: 'loc', ok: locAnnualTotal != null && locMonthlyTotal != null ? nearRel(locMonthlyTotal, locAnnualTotal, 0.005) : true, na: locAnnualTotal == null || locMonthlyTotal == null, detail: locAnnualTotal == null || locMonthlyTotal == null ? `대조 부족(연간 ${won(locAnnualTotal)}·월간 ${won(locMonthlyTotal)})` : `연간 ${won(locAnnualTotal)} ${nearRel(locMonthlyTotal, locAnnualTotal, 0.005) ? '=' : '≠'} 월간 ${won(locMonthlyTotal)}` });
  }

  // ═══ ⑤ 기간별 전연도 증감(YoY) + ⑥ 위치 탭 ═══
  // YoY% = round((당해−전년)/전년×100,1). 셀: {값}{▲/▼}{부호%}. 우측 3열 = [2024, 2025(YoY), 2026(YoY)].
  const yoyCheck = (rows: string[][], label: string, scope: string): { total2026: number | null } => {
    const bad: string[] = []; let cnt = 0; let total2026: number | null = null;
    for (const r of rows) {
      const last3 = r.slice(-3); if (last3.length < 3) continue;
      const v2024 = num(last3[0]); const c2025 = parseYoYCell(last3[1]); const c2026 = parseYoYCell(last3[2]);
      if (isTotalRow(r)) total2026 = c2026.val;
      for (const [prev, cur, tag] of [[v2024, c2025, '2025'], [c2025.val, c2026, '2026']] as [number | null, { val: number | null; yoy: number | null }, string][]) {
        if (prev == null || cur.val == null || cur.yoy == null) continue;
        if (prev === 0) continue;   // 0분모 → na
        cnt++;
        const calc = (cur.val - prev) / prev * 100;
        if (Math.abs(calc - cur.yoy) > 0.15) bad.push(`${labelOf(r)} ${tag}(표시 ${cur.yoy}%≠계산 ${calc.toFixed(1)}%)`);
      }
    }
    if (!cnt) push({ name: `${label}: YoY% = (당해−전년)/전년`, scope, ok: true, na: true, detail: '연도 컬럼/데이터 없음 — 판정 제외' });
    else push({ name: `${label}: YoY% = (당해−전년)/전년`, scope, ok: bad.length === 0, detail: bad.length === 0 ? `${cnt}개 증감값 공식 일치(반올림 ±0.15%p)` : `불일치 ${bad.length}: ${bad.slice(0, 3).join(', ')}` });
    return { total2026 };
  };
  await enter(admin, '기간별 비용');
  let periodTotal2026: number | null = null, periodLocTotal2026: number | null = null;
  { const { rows } = await readRows(admin); periodTotal2026 = yoyCheck(rows, '⑤ 기간별 전연도 증감', 'per').total2026; }
  {
    const okTab = await clickTab(admin, /^\s*위치\s*$/);
    if (okTab) { const { rows } = await readRows(admin); periodLocTotal2026 = yoyCheck(rows, '⑥ 기간별 위치 탭 증감', 'perloc').total2026; }
    else push({ name: '⑥ 기간별 위치 탭 증감: YoY%', scope: 'perloc', ok: true, na: true, detail: '위치 탭 미노출 — 판정 제외' });
    // 교차: 기간별-위치 당해(2026) 총계 = 위치별 연간 총계
    if (periodLocTotal2026 != null && locAnnualTotal != null) push({ name: '⑥ 교차: 기간별-위치 당해총계 = 위치별 연간 총계', scope: 'perloc', ok: nearRel(periodLocTotal2026, locAnnualTotal, 0.01), detail: `기간별위치 2026 ${won(periodLocTotal2026)} ${nearRel(periodLocTotal2026, locAnnualTotal, 0.01) ? '=' : '≠'} 위치별 연간 ${won(locAnnualTotal)}` });
    else push({ name: '⑥ 교차: 기간별-위치 당해총계 = 위치별 연간 총계', scope: 'perloc', ok: true, na: true, detail: `대조 부족(기간별위치 ${won(periodLocTotal2026)}·위치별연간 ${won(locAnnualTotal)})` });
  }
  // 교차: 기간별 당해(2026) 전체 = 분류별 연간 전체(같은 당해 총비용, 축만 다름)
  if (periodTotal2026 != null && catAnnualTotal != null) push({ name: '⑤ 교차: 기간별 당해총계 = 분류별 연간 총계', scope: 'per', ok: nearRel(periodTotal2026, catAnnualTotal, 0.01), detail: `기간별 2026 ${won(periodTotal2026)} ${nearRel(periodTotal2026, catAnnualTotal, 0.01) ? '=' : '≠'} 분류별 연간 ${won(catAnnualTotal)}` });

  // ═══ 리포트 ═══
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok).length; const fail = judged.filter((c) => !c.ok).length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Chk) => c.na ? '➖' : c.ok ? '✅' : '❌';
  const rowsHtml = checks.map((c) => `<tr class="${c.na ? 'na' : c.ok ? '' : 'ng'}"><td>${mark(c)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  const html = `<title>예산·비용 정합성 P1 보완</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:940px;margin:0 auto;padding:24px 18px 60px;font:15px/1.6 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.na-n{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.ng td{color:var(--ng);font-weight:600}tr.na td{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
</style><div class="wrap">
<h1>예산·비용 정합성 — P1 보완 검증</h1>
<div class="sub">budget-verify 미커버 4항목(월간 탭·전연도 증감·기간별 위치) · 킹즈락 · ${ts} · 비파괴</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고(데이터없음)</div></div>` : ''}</div>
<div class="note">검증 불변식 — <b>③④</b> 월간 각 행 합계=Σ(1~12월) & 월간 합계=연간 합계 · <b>⑤⑥</b> 증감 YoY%=round((당해−전년)/전년×100,1) & 기간별-위치 당해총계=위치별 연간 총계. 데이터 없는 탭은 판정 제외(na).</div>
<table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-budget-cost-p1.html'), html, 'utf-8');
  console.log(`\n[P1] 총 ${checks.length} · PASS ${pass} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-budget-cost-p1.html');
});

import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseOneYear } from '../lib/course/courseHelpers';
import { num, near, firstNum } from '../lib/course/domain/budgetCost';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  카드/차트형 수치 승격 검증 (P2 ①, 비파괴).
//   프로브(_probe-summary-cards) 결과: 예산총괄·예산분석·비용집계엔 '요약 카드' 부재(표/차트만).
//   실제 존재 카드 = 분류별 '총 비용'·위치별 '전체 비용' → 이 값들을 검증 대상으로 승격(카드=Σ표행).
//   + 비용집계 표 파생(차액=실제발생−작업지시·행합=Σ유형) + 교차(비용집계 실제발생 = 예산분석 누적실적 API).
//   실행: npm run course:auth 후 npm run course:card-verify → reports/course-card-verify.html
// ──────────────────────────────────────────────────────────────

interface Check { name: string; group: string; ok: boolean; na?: boolean; detail: string; }
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());

// 첫 데이터 표를 문자열 격자로. (rowspan 무시 — 비용 표는 단순 격자)
async function readTable(admin: Page): Promise<{ heads: string[]; rows: string[][] }> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { heads: [], rows: [] };
    const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent)).filter(Boolean);
    const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((td) => norm(td.textContent)));
    return { heads, rows };
  }).catch(() => ({ heads: [] as string[], rows: [] as string[][] }));
}
// 요약 카드 후보 검출(라벨↔값). 프로브와 동일 로직 — '없음' 확증용.
async function detectCards(admin: Page): Promise<{ count: number; sample: string[] }> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const sc = document.querySelector('.contents, main') || document.body;
    const raw = Array.from(sc.querySelectorAll('[class*="card"],[class*="summary"],[class*="total"],[class*="amount"],[class*="stat"]'))
      .filter(vis).filter((e) => { const t = norm(e.textContent); return !!t && t.length < 140 && /[0-9]/.test(t); });
    const leaves = raw.filter((e) => !raw.some((o) => o !== e && e.contains(o)));
    return { count: leaves.length, sample: leaves.slice(0, 6).map((e) => norm(e.textContent).slice(0, 60)) };
  }).catch(() => ({ count: 0, sample: [] as string[] }));
}
async function enter(admin: Page, menu: string, sub: string, oneYear = false): Promise<boolean> {
  const ok = await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false);
  if (!ok) return false;
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (oneYear) { const dp = await admin.locator('.contents .datepicker-input:visible, main .datepicker-input:visible').count().catch(() => 0); if (dp >= 2) { await setCourseOneYear(admin).catch(() => {}); await admin.waitForTimeout(900); } }
  return true;
}

test('카드/차트형 수치 승격 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(500_000);
  const admin: Page = await openCourseAdmin(page, context);
  let analysis: any = null;
  admin.on('response', (res) => {
    if (!/budget\/anal\/monthly\/init/i.test(res.url())) return;
    res.text().then((b) => { try { const j = JSON.parse(b); if (j?.data) analysis = j.data; } catch { /* noop */ } }).catch(() => {});
  });
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // ═══ 1) 비용 집계 표 파생 정합(관리비유형 축) ═══
  let aggActualTotal: number | null = null;
  if (await enter(admin, '비용 관리', '비용 집계', true)) {
    const { heads, rows } = await readTable(admin);
    const rowBy = (kw: RegExp) => rows.find((r) => kw.test(r[0] || ''));
    const vals = (r?: string[]) => (r ? r.slice(1).map(num) : []);
    const order = vals(rowBy(/작업지시/)); const actual = vals(rowBy(/실제\s*발생/)); const diff = vals(rowBy(/차액/));
    const nCol = Math.min(order.length, actual.length, diff.length);
    aggActualTotal = actual[0] ?? null;
    if (nCol >= 2) {
      // ① 차액[유형] = 실제발생 − 작업지시 (부호 포함)
      const bad: string[] = []; let cnt = 0;
      for (let i = 0; i < nCol; i++) { const o = order[i], a = actual[i], d = diff[i]; if (o == null || a == null || d == null) continue; cnt++; if (!near(d, a - o, 2)) bad.push(`${heads[i + 1] || `열${i}`}(차액 ${won(d)}≠실적−지시 ${won(a - o)})`); }
      add({ name: '비용집계 · 차액 = 실제발생 − 작업지시(열별)', group: '비용집계 표', ok: bad.length === 0, na: cnt === 0, detail: cnt === 0 ? '대상 없음' : `${cnt}열 중 ${cnt - bad.length} 성립${bad.length ? ` · 위반: ${bad.slice(0, 3).join(', ')}` : ''}` });
      // ② 각 행 합계(첫 값=합계열) = Σ(유형 5열)
      for (const [r, label] of [[order, '작업지시'], [actual, '실제발생'], [diff, '차액']] as const) {
        if (r.length < 2 || r[0] == null) { add({ name: `비용집계 · ${label} 합계 = Σ유형`, group: '비용집계 표', ok: true, na: true, detail: '대상 없음' }); continue; }
        const sum = r.slice(1).reduce((a: number, b) => a + (b || 0), 0);
        add({ name: `비용집계 · ${label} 합계 = Σ유형`, group: '비용집계 표', ok: near(r[0]!, sum, 2), detail: `합계 ${won(r[0])} vs Σ유형 ${won(sum)}` });
      }
    } else add({ name: '비용집계 표', group: '비용집계 표', ok: true, na: true, detail: '표/행 미검출 — 판정 제외' });
  } else add({ name: '비용집계 진입', group: '비용집계 표', ok: true, na: true, detail: '진입 실패 — 판정 제외' });

  // ═══ 2) 분류별 '총 비용' 카드 = Σ(분류 행 합계) ═══
  if (await enter(admin, '비용 관리', '분류별 비용', true)) {
    const cardsInfo = await detectCards(admin);
    const { heads, rows } = await readTable(admin);
    // 합계 컬럼(우측앵커): 각 행 마지막 수치 셀을 행합으로 간주 → Σ = 총비용
    const rowTotals = rows.map((r) => { for (let i = r.length - 1; i >= 1; i--) { const v = num(r[i]); if (v != null) return v; } return null; }).filter((v): v is number => v != null);
    const cardTotal = firstNum((cardsInfo.sample.find((c) => /총\s*비용/.test(c)) || '')) ?? null;
    if (cardTotal != null && rowTotals.length) {
      const sum = rowTotals.reduce((a, b) => a + b, 0);
      add({ name: "분류별 · '총 비용' 카드 = Σ(분류 행합)", group: '분류별 카드', ok: near(cardTotal, sum, Math.max(2, sum * 0.001)), detail: `카드 ${won(cardTotal)} vs Σ행 ${won(sum)} (${rowTotals.length}행) · heads[0]=${heads[0] || '—'}` });
    } else add({ name: "분류별 · '총 비용' 카드", group: '분류별 카드', ok: true, na: true, detail: `카드/행 미검출 — 카드 ${cardsInfo.count}개(${cardsInfo.sample.slice(0, 3).join(' / ') || '없음'})` });
  }

  // ═══ 3) 위치별 '전체 비용' 카드 = Σ(코스 행 합계) ═══
  if (await enter(admin, '비용 관리', '위치별 비용', true)) {
    const cardsInfo = await detectCards(admin);
    const { rows } = await readTable(admin);
    const rowTotals = rows.map((r) => { for (let i = r.length - 1; i >= 1; i--) { const v = num(r[i]); if (v != null) return v; } return null; }).filter((v): v is number => v != null);
    const cardTotal = firstNum((cardsInfo.sample.find((c) => /전체\s*비용/.test(c)) || '')) ?? null;
    if (cardTotal != null && rowTotals.length) {
      const sum = rowTotals.reduce((a, b) => a + b, 0);
      add({ name: "위치별 · '전체 비용' 카드 = Σ(코스 행합)", group: '위치별 카드', ok: near(cardTotal, sum, Math.max(2, sum * 0.001)), detail: `카드 ${won(cardTotal)} vs Σ코스 ${won(sum)} (${rowTotals.length}행)` });
    } else add({ name: "위치별 · '전체 비용' 카드", group: '위치별 카드', ok: true, na: true, detail: `카드/행 미검출 — 카드 ${cardsInfo.count}개(${cardsInfo.sample.slice(0, 3).join(' / ') || '없음'})` });
  }

  // ═══ 4) 요약 카드 부재 확증(예산총괄·예산분석·비용집계) — 승격 대상 없음 투명화 ═══
  for (const [menu, sub] of [['예산 관리', '예산 총괄'], ['예산 관리', '예산 분석']] as const) {
    if (await enter(admin, menu, sub)) {
      const ci = await detectCards(admin);
      add({ name: `${sub} · 요약 카드 존재 여부`, group: '요약 카드 부재 확증', ok: true, na: true, detail: ci.count === 0 ? '요약 카드 없음(표/차트 화면) — 승격 대상 없음(판정 제외)' : `카드 ${ci.count}개 검출: ${ci.sample.slice(0, 3).join(' / ')} (승격 검토 필요)` });
    }
  }

  // ═══ 5) 교차: 비용집계 실제발생 합계 = 예산 분석 누적실적(API) ═══
  if (await enter(admin, '예산 관리', '예산 분석')) {
    if (!analysis) { await admin.reload({ waitUntil: 'networkidle' }).catch(() => {}); await admin.waitForTimeout(2500); await killAlarms(admin); }
    const accA = analysis?.budgetTotalMonthlyAnalysisRes?.budgetAccumPerform as number[] | undefined;
    const analActual = accA?.length ? ([...accA].reverse().find((v) => v > 0) ?? null) : null;
    if (aggActualTotal != null && analActual != null) {
      add({ name: '★ 교차: 비용집계 실제발생 합계 = 예산분석 누적실적(API)', group: '교차', ok: near(aggActualTotal, analActual, Math.max(2, analActual * 0.001)), detail: `비용집계 ${won(aggActualTotal)} vs 예산분석 누적실적 ${won(analActual)}` });
    } else add({ name: '★ 교차: 비용집계 실제발생 = 예산분석 누적실적', group: '교차', ok: true, na: true, detail: `대조 불가(비용집계 ${won(aggActualTotal)} · 예산분석API ${analysis ? '캡처O' : '미캡처'})` });
  }

  // ── 리포트 ──
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok).length; const fail = judged.filter((c) => !c.ok).length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : c.ok ? '✅' : '❌';
  const rowsHtml = checks.map((c) => `<tr class="${c.na ? 'na' : c.ok ? '' : 'ng'}"><td>${mark(c)}</td><td>${esc(c.group)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  const html = `<title>카드/차트형 수치 승격 검증</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:960px;margin:0 auto;padding:24px 18px 60px;font:15px/1.6 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.na-n{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.ng td{color:var(--ng);font-weight:600}tr.na td{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
</style><div class="wrap">
<h1>카드/차트형 수치 승격 검증 (P2 ①)</h1>
<div class="sub">코스관리 킹즈락 · ${ts} · 비파괴</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">프로브 결과 <b>예산총괄·예산분석·비용집계엔 요약 카드가 없습니다</b>(표/차트 화면). 실제 존재 카드 = 분류별 <b>총 비용</b>·위치별 <b>전체 비용</b> → 카드=Σ표행으로 승격 검증. + 비용집계 표 파생(차액=실제발생−작업지시·행합=Σ유형) + 교차(비용집계 실제발생 = 예산분석 누적실적 API). 참고(➖)=판정 제외.</div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-card-verify.html'), html, 'utf-8');
  console.log(`\n[카드검증] 총 ${checks.length} · PASS ${pass} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-card-verify.html');
});

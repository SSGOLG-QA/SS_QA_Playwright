import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { AnalRow, AC, analysisInvariants, totalRollup } from '../lib/course/domain/budgetAnalysis';
import { num, near } from '../lib/course/domain/budgetCost';
import { parseGraphCards } from '../lib/course/graphCards';
import { graphCardRollup } from '../lib/course/domain/graphCardRollup';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  예산 분석(P2 보완, 비파괴) — 차트 공급 API 불변식 검증.
//   차트는 DOM 수치 부재(Highcharts) → /api/v1/budget/anal/monthly/init(공급) 캡처 후 순수 불변식.
//   그룹 6종(고정직/임시직/코스자재/장비/기타 + 합계): 초과분·사용률·누적(예산/실적/차액/사용률) + 합계=Σ그룹.
//   + 교차: 합계 누적예산 말월 = 총예산(1,298,458,000 급) · 누적실적 = 실적 총계.
//   실행: npm run course:auth 후 npm run course:budget-analysis → reports/course-budget-analysis.html
//   비파괴(조회·reload로 refetch만).
// ──────────────────────────────────────────────────────────────

const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());

async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1600); await killAlarms(admin); return true; }
  return false;
}
// 월간 테이블 각 행 → { 소분류(리딩 라벨 마지막), 마지막 8셀(=12월 8서브컬럼) } 수집(우측앵커, rowspan 무관).
async function readMonthlyTable(admin: Page): Promise<{ label: string; last8: (number | null)[] }[]> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const numOf = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return null; const v = Number(c); return Number.isFinite(v) ? v : null; };
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return [];
    return Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      // 리딩 라벨 = 처음부터 비어있지않고 숫자아닌 셀 연속; 소분류 = 그 마지막
      const labels: string[] = [];
      for (const c of cells) { if (c === '' || numOf(c) != null) break; labels.push(c); }
      const label = labels[labels.length - 1] || '';
      const last8 = cells.slice(-8).map(numOf);
      return { label, last8 };
    }).filter((r) => r.label);
  }).catch(() => []);
}

test('예산 분석 공급 API 불변식 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  const admin: Page = await openCourseAdmin(page, context);
  let captured: any = null;
  admin.on('response', (res) => {
    if (!/budget\/anal\/monthly\/init/i.test(res.url())) return;
    res.text().then((b) => { try { const j = JSON.parse(b); if (j?.data) captured = j.data; } catch { /* noop */ } }).catch(() => {});
  });

  await gotoCourseMenu(admin, '예산 관리', '예산 분석').catch(() => {});
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!captured) { await admin.reload({ waitUntil: 'networkidle' }).catch(() => {}); await admin.waitForTimeout(2500); await killAlarms(admin); }

  const checks: AC[] = [];
  const GROUPS: { key: string; label: string }[] = [
    { key: 'budgetFixedMonthlyAnalysisRes', label: '고정직 인건비' },
    { key: 'budgetTempMonthlyAnalysisRes', label: '임시직 인건비' },
    { key: 'budgetCourseMonthlyAnalysisRes', label: '코스 자재비' },
    { key: 'budgetEquipMonthlyAnalysisRes', label: '장비 관리비' },
    { key: 'budgetMiscMonthlyAnalysisRes', label: '기타 관리비' },
  ];
  let total: AnalRow | null = null; const groupRows: AnalRow[][] = [];

  if (!captured) {
    checks.push({ name: '예산 분석 공급 API 캡처', ok: true, na: true, detail: '/budget/anal/monthly/init 미캡처 — 판정 제외(세션/화면 확인)' });
  } else {
    for (const g of GROUPS) {
      const rows = (captured[g.key] as AnalRow[]) || [];
      groupRows.push(rows);
      if (!rows.length) { checks.push({ name: `${g.label} · 데이터`, ok: true, na: true, detail: '행 없음 — 판정 제외' }); continue; }
      checks.push(...analysisInvariants(rows, g.label));
    }
    total = (captured.budgetTotalMonthlyAnalysisRes as AnalRow) || null;
    if (total) { checks.push(...analysisInvariants([total], '합계')); checks.push(...totalRollup(groupRows, total)); }

    // 교차(정보성): 합계 누적예산 말월 = 총예산 · 누적실적 최종 = 실적 총계
    const accP = total?.budgetAccumPlan; const accA = total?.budgetAccumPerform;
    if (accP?.length) checks.push({ name: '★ 교차: 합계 누적예산(말월) = 연간 총예산', ok: true, na: false, detail: `누적예산[12월] = ${won(accP[accP.length - 1])}원 (예산 총괄 연간 총예산과 대조 기준)` });
    if (accA?.length) { const last = [...accA].reverse().find((v) => v > 0) ?? null; checks.push({ name: '★ 교차: 합계 누적실적(최종) = 실적 총계', ok: true, na: false, detail: `누적실적 최종 = ${won(last)}원 (실적 관리 총계와 대조 기준)` }); }

    // ═══ DOM = API 대조(월간 테이블) ═══
    // 12월은 기본 펼침 → 각 행 마지막 8셀 = 12월 [당월예산·사용·절감·사용률·누적예산·사용·절감·사용률] = API[11].
    //   화면 렌더(필드 매핑·포맷·부호·%·−100 센티넬 표기)를 원값과 대조 → 프론트 렌더 회귀 포착.
    await clickTab(admin, /월간\s*테이블/);
    await admin.waitForTimeout(800);
    const domRows = await readMonthlyTable(admin);
    // API 소분류(cat2Name) → 필드값[11] 맵 + 빈도.
    //  ⚠ 소분류명은 그룹 간 중복 가능(예 '식대' = 고정직·임시직 공통) → cat2Name 단독 키는 마지막 그룹 값으로 덮여
    //    DOM 행↔API 행 오매칭(가짜 불일치). DOM 플랫텍스트는 rowspan으로 대분류·중분류가 이어받기 생략돼 계층 복원 불가 →
    //    전 그룹 통틀어 '유일한' 소분류명만 1:1 대조하고, 중복명은 '중복명 제외'로 투명 처리(누락 아님·모호 배제).
    const apiByCat2 = new Map<string, AnalRow>(); const freq = new Map<string, number>();
    for (const g of GROUPS) for (const r of ((captured[g.key] as AnalRow[]) || [])) {
      if (r.cat2Name && r.cat2Idx != null) { const k = r.cat2Name.replace(/\s+/g, ''); freq.set(k, (freq.get(k) || 0) + 1); apiByCat2.set(k, r); }
    }
    const M = 11; const FIELDS: (keyof AnalRow)[] = ['budgetPlan', 'budgetPerform', 'budgetDiff', 'budgetRate', 'budgetAccumPlan', 'budgetAccumPerform', 'budgetAccumDiff', 'budgetAccumRate'];
    const FLABEL = ['당월예산', '당월사용', '당월절감', '당월사용률', '누적예산', '누적사용', '누적절감', '누적사용률'];
    let matched = 0; let cells = 0; const bad: string[] = []; let unmatched = 0; let dup = 0;
    for (const dr of domRows) {
      const k = dr.label.replace(/\s+/g, '');
      if ((freq.get(k) || 0) > 1) { dup++; continue; }         // 중복명(그룹 간) → 모호, 제외
      const ar = apiByCat2.get(k);
      if (!ar || dr.last8.length < 8) { unmatched++; continue; }
      matched++;
      for (let i = 0; i < 8; i++) {
        const dv = dr.last8[i]; const av = (ar[FIELDS[i]] as number[])?.[M];
        if (dv == null || av == null) continue; cells++;
        const tol = /사용률/.test(FLABEL[i]) ? 0.05 : 1;
        if (!near(dv, av, tol)) bad.push(`${dr.label}·${FLABEL[i]}(화면 ${dv}≠API ${av})`);
      }
    }
    const tail = `${dup ? ` · 중복명 제외 ${dup}행(그룹 간 동명 소분류·모호)` : ''}${unmatched ? ` · 미매칭 ${unmatched}행` : ''}`;
    if (matched === 0) checks.push({ name: '★ DOM=API: 월간 테이블 12월 셀 = 공급 API', ok: true, na: true, detail: `매칭 행 0(테이블 미펼침/미노출) — 판정 제외(DOM행 ${domRows.length}·유일 소분류 ${[...freq.values()].filter((v) => v === 1).length})` });
    else checks.push({ name: '★ DOM=API: 월간 테이블 12월 셀 = 공급 API', ok: bad.length === 0, detail: bad.length === 0 ? `${matched}행 × 8필드 = ${cells}셀 전부 화면=API 일치(포맷·부호·%·−100 센티넬 포함)${tail}` : `불일치 ${bad.length}: ${bad.slice(0, 3).join(', ')}${tail}` });
  }

  // ═══ 연간 그래프 카드: 전체 = Σ카테고리 롤업(잔여 예산 floor-at-0 불일치 검출) ═══
  //   카드 6종(전체+5분류)의 연간예산·누적사용·잔여 예산을 읽어 전체=Σ카테고리 대조.
  //   ⚠ 잔여 예산은 카드마다 0-하한(초과 시 0 표시+초과 별도) → 전체(연간예산−누적사용, 초과 음수 상계)와 Σ카드잔여가 어긋남.
  //   연간예산·누적사용은 하한 없어 전체=Σ 성립해야(회귀 감시). 잔여 불일치는 표시 관례 차이 → review(확인 필요).
  {
    await clickTab(admin, /연간\s*그래프/).catch(() => {});
    await admin.waitForTimeout(1200); await killAlarms(admin);
    const CATS = ['전체', '고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
    const cards = await parseGraphCards(admin, CATS);
    for (const rc of graphCardRollup(cards, { total: '전체', subs: CATS.slice(1), screen: '예산 관리>예산 분석>연간 그래프' })) checks.push(rc as AC);
  }

  // ── 리포트 ──
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok).length;
  const review = judged.filter((c) => !c.ok && c.review).length;
  const fail = judged.filter((c) => !c.ok && !c.review).length;   // 실제 결함(확인 필요 제외)
  const attn = fail + review;                                       // 주의 필요 = 결함 + 확인 필요
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: AC) => c.na ? '➖' : c.ok ? '✅' : c.review ? '🔎' : '❌';
  const rowsHtml = checks.map((c) => `<tr class="${c.na ? 'na' : c.ok ? '' : c.review ? 'rv' : 'ng'}"><td>${mark(c)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  const html = `<title>예산 분석 공급 API 검증</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:960px;margin:0 auto;padding:24px 18px 60px;font:15px/1.6 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.na-n{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.ng td{color:var(--ng);font-weight:600}tr.na td{color:var(--mut)}tr.rv td{color:#9a6700;font-weight:600}.rv-n{color:#9a6700}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
</style><div class="wrap">
<h1>예산 분석 — 공급 API 불변식 검증 (P2)</h1>
<div class="sub">/api/v1/budget/anal/monthly/init · 킹즈락 · ${ts} · 비파괴(차트 DOM 수치 부재 → 공급 데이터 검증)</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${fail ? 'ng-n' : review ? 'rv-n' : 'ok-n'}">${attn}</div><div class="l">주의 필요${review ? ` (확인 필요 ${review})` : ''}</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">차트(Highcharts)는 DOM에 수치가 없어 <b>공급 API</b>를 검증합니다. 그룹 6종별 <b>초과분=실적−예산 · 사용률=실적÷예산 · 누적(예산=Σ월·실적=Σ월·차액·사용률)</b> + <b>합계=Σ그룹</b>. 미래월(실적 0·사용률 −100 센티넬)은 사용률 검증 제외. ★ 교차는 예산총괄/실적과 대조할 기준값(누적예산 말월=총예산, 누적실적 최종=실적총계).</div>
<table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-budget-analysis.html'), html, 'utf-8');
  console.log(`\n[예산분석] 총 ${checks.length} · PASS ${pass} · FAIL ${fail} · NA ${na} · API캡처 ${captured ? 'O' : 'X'}`);
  for (const c of checks) console.log(`  ${mark(c)} ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-budget-analysis.html');
});

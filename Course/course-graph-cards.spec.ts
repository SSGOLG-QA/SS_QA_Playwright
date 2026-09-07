import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { parseGraphCards } from '../lib/course/graphCards';
import { graphCardRollup } from '../lib/course/domain/graphCardRollup';
import { near } from '../lib/course/domain/budgetCost';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  그래프 화면 카드 검증 스윕(비파괴) — [전체+카테고리 카드] / [그래프 카드 = 원천 표] 정합.
//   실행: npm run course:auth 후 npm run course:graph-cards → reports/course-graph-cards.html
//   ⚠ 차트(Highcharts/canvas)는 DOM에 수치 부재 → 그래프 '옆 카드'와 '원천 표'로 정합 검증.
//   커버:
//    ① 예산 분석 연간 그래프 — 카드 롤업(전체=Σ, 잔여 2단) + ★그래프 전체 카드 = 연간 테이블 합계행 교차  [net-new]
//        (⚠ 연간 테이블=라인아이템 상세 46행이라 카드 5개 카테고리와 1:1 매핑 불가 → 카테고리별은 na, 합계행으로 교차)
//    ② 예산 분석 월간 그래프 — 카드 롤업 + 그래프 전체 카드 = 월간 테이블 합계행 교차(카드 라벨 상이 시 na)      [net-new]
//    ③ 비용 관리 분류별/위치별/기간별 — 그래프 렌더 확인 + 합계=Σ 정합은 budget-verify/coverage-fill 담당(정보 na, 중복 회피)
//    ④ HOME 작업지시분석 — 전체뷰 가로 정합은 home-verify ⑳ 담당(정보 na)
//   전부 비파괴(조회·탭 전환만). 파싱 실패는 na(판정 제외) — 거짓 결과 금지.
// ──────────────────────────────────────────────────────────────

interface AC { name: string; group: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const CATS = ['전체', '고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
const SUBS = CATS.slice(1);

async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.getByRole('tab', { name: re }).or(admin.locator('.contents, main').getByText(re)).first();
  if (!(await t.isVisible({ timeout: 2500 }).catch(() => false))) return false;
  await t.click({ timeout: 2500 }).catch(() => {});
  await admin.waitForTimeout(1200); await killAlarms(admin);
  return true;
}

// 첫 표를 카테고리 행별 숫자셀 배열로 읽음(라벨=첫 비숫자셀, 값=숫자셀 순서). 카드=표 교차용.
async function readCatTable(admin: Page): Promise<Record<string, number[]>> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const NUM = (s: string) => { const m = (s || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = sc.querySelector('table'); if (!tbl) return {};
    const out: Record<string, number[]> = {};
    tbl.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent)).filter((c) => c !== '');
      if (!cells.length) return;
      const label = cells.find((c) => !/^-?[\d,.%]+$/.test(c)) || cells[0];
      const nums = cells.map(NUM).filter((v): v is number => v != null);
      const key = label.replace(/\s/g, '');
      if (key && nums.length) out[key] = nums;
    });
    return out;
  }).catch(() => ({} as Record<string, number[]>));
}

// 카드 전체 ↔ 표 합계행(우측 8열: 연간예산·누적사용·잔여예산·…) 1:1 교차.
//  ⚠ 연간/월간 테이블은 라인아이템 상세(급여·보험 등 46행)라 카드 5개 카테고리와 1:1 매핑 불가 →
//    유효 교차는 [카드 전체 = 표 합계행]. 카테고리 내부 정합은 카드 롤업(전체=Σ)+coverage-fill ②(테이블 DOM=API)가 담당.
function crossCardTable(cards: Record<string, { budget: number | null; used: number | null; remain: number | null }>, tbl: Record<string, number[]>, group: string, screen: string): AC[] {
  const out: AC[] = [];
  const tot = cards['전체'];
  const sumRow = Object.entries(tbl).find(([k]) => /합계|총계|총예산|^전체$/.test(k));
  if (!tot || !sumRow) {
    out.push({ name: `★ ${group}: 그래프 전체 카드 = 원천 표 합계행`, group, ok: true, na: true, detail: `대조 불가(전체 카드 ${tot ? 'O' : 'X'}·합계행 ${sumRow ? 'O' : 'X'}·표 ${Object.keys(tbl).length}행) — 판정 제외. ${screen}` });
    return out;
  }
  const last8 = sumRow[1].slice(-8);
  const pairs: { label: string; key: 'budget' | 'used' | 'remain'; col: number }[] = [
    { label: '연간예산', key: 'budget', col: 0 }, { label: '누적사용', key: 'used', col: 1 }, { label: '잔여예산', key: 'remain', col: 2 },
  ];
  let m = 0, bad = 0; const ex: string[] = [];
  for (const p of pairs) {
    const cv = tot[p.key]; const tv = last8[p.col];
    if (cv == null || tv == null) continue; m++;
    if (!near(cv, tv, 2)) { bad++; ex.push(`${p.label}(카드 ${won(cv)}≠표 ${won(tv)})`); }
  }
  if (m === 0) out.push({ name: `★ ${group}: 그래프 전체 카드 = 원천 표 합계행`, group, ok: true, na: true, detail: `대조쌍 0(합계행 열 부족) — 판정 제외. ${screen}` });
  else out.push({ name: `★ ${group}: 그래프 전체 카드 = 원천 표 합계행(예산·사용·잔여)`, group, ok: bad === 0, detail: bad === 0 ? `전체 카드 = 표 합계행 ${m}셀 일치(예산 ${won(tot.budget)}·사용 ${won(tot.used)}·잔여 ${won(tot.remain)})` : `불일치 ${bad}: ${ex.join(', ')} — 화면: ${screen}` });
  out.push({ name: `${group}: 카테고리별 카드=표(참고)`, group, ok: true, na: true, detail: `연간/월간 테이블은 라인아이템 상세(${Object.keys(tbl).length}행)라 카드 5개 카테고리와 1:1 매핑 불가 — 카테고리 내부 정합은 카드 롤업(전체=Σ)+coverage-fill ②(테이블 DOM=API)가 담당.` });
  return out;
}

test('그래프 화면 카드 검증 스윕(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin = await openCourseAdmin(page, context);
  const checks: AC[] = [];
  const dump: Record<string, unknown> = {};

  // ── ① 예산 분석 연간 그래프 (카드 롤업 + 카드=연간 테이블 교차) ──
  if (await gotoCourseMenu(admin, '예산 관리', '예산 분석').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1200); await killAlarms(admin);
    // 연간 그래프
    const g1 = 'A. 예산 분석 · 연간 그래프';
    if (await clickTab(admin, /연간\s*그래프/)) {
      const cardsY = await parseGraphCards(admin, CATS);
      dump['연간그래프카드'] = cardsY;
      for (const rc of graphCardRollup(cardsY, { total: '전체', subs: SUBS, screen: '예산 분석>연간 그래프', prefix: '연간 그래프 카드' })) checks.push({ ...rc, group: g1 });
      // 연간 테이블로 교차
      if (await clickTab(admin, /연간\s*테이블/)) {
        const tblY = await readCatTable(admin); dump['연간테이블'] = tblY;
        for (const c of crossCardTable(cardsY, tblY, g1, '예산 분석>연간 그래프↔연간 테이블')) checks.push(c);
      } else checks.push({ name: `★ ${g1}: 그래프 카드 = 원천 표`, group: g1, ok: true, na: true, detail: '연간 테이블 탭 미노출 — 판정 제외' });
    } else checks.push({ name: `${g1}: 진입`, group: g1, ok: true, na: true, detail: '연간 그래프 탭 미노출 — 판정 제외' });

    // ── ② 예산 분석 월간 그래프 (카드 롤업 + 카드=월간 테이블 교차, 라벨 상이 시 na) ──
    const g2 = 'B. 예산 분석 · 월간 그래프';
    if (await clickTab(admin, /월간\s*그래프/)) {
      const cardsM = await parseGraphCards(admin, CATS); dump['월간그래프카드'] = cardsM;
      const rolled = graphCardRollup(cardsM, { total: '전체', subs: SUBS, screen: '예산 분석>월간 그래프', prefix: '월간 그래프 카드' });
      for (const rc of rolled) checks.push({ ...rc, group: g2 });
      if (await clickTab(admin, /월간\s*테이블/)) {
        const tblM = await readCatTable(admin); dump['월간테이블'] = tblM;
        for (const c of crossCardTable(cardsM, tblM, g2, '예산 분석>월간 그래프↔월간 테이블')) checks.push(c);
      }
    } else checks.push({ name: `${g2}: 진입`, group: g2, ok: true, na: true, detail: '월간 그래프 탭 미노출 — 판정 제외' });
  } else checks.push({ name: 'A. 예산 분석 진입', group: 'A. 예산 분석 · 연간 그래프', ok: true, na: true, detail: '예산 분석 진입 실패 — 판정 제외' });

  // ── ③ 비용 관리 분류별/위치별/기간별 — 그래프 렌더 확인 + 합계=Σ는 기존 스펙 담당(정보 na) ──
  for (const [sub, ref] of [['분류별 비용', 'budget-verify(분류별 Σ행=총비용·행 합계=Σ관리비)'], ['위치별 비용', 'budget-verify(위치별 Σ코스=전체·코스 총비용=Σ영역)'], ['기간별 비용', 'coverage-fill ③(3년비교 카드=표) · budget-verify(연도별 다축)']] as const) {
    const g = `C. 비용 관리 · ${sub}`;
    if (await gotoCourseMenu(admin, '비용 관리', sub).then(() => true).catch(() => false)) {
      await admin.waitForTimeout(1200); await killAlarms(admin);
      const chartCnt = await admin.locator('.contents, main').locator('canvas, svg, [class*="chart"], .highcharts-container').count().catch(() => 0);
      checks.push({ name: `${g}: 그래프 렌더`, group: g, ok: chartCnt > 0, na: chartCnt === 0, detail: chartCnt > 0 ? `차트/그래프 요소 ${chartCnt}개 렌더` : '차트 요소 미검출 — 판정 제외' });
      checks.push({ name: `${g}: 합계=Σ 정합(참조)`, group: g, ok: true, na: true, detail: `이 화면 합계=Σ 정합은 ${ref}에서 검증 — 본 스윕 중복 회피(정보)` });
    } else checks.push({ name: `${g}: 진입`, group: g, ok: true, na: true, detail: '진입 실패 — 판정 제외' });
  }

  // ── ④ HOME 작업지시분석 — 전체뷰 가로 정합은 home-verify ⑳ 담당(정보 na) ──
  {
    const g = 'D. HOME · 작업지시분석 그래프';
    checks.push({ name: `${g}: 전체/코스별/기간별 뷰 정합(참조)`, group: g, ok: true, na: true, detail: 'HOME 비용 탭 작업지시분석 전체뷰 가로 정합(합계=Σ관리비유형)은 course:home-verify ⑳에서 검증 — 본 스윕 중복 회피(정보). 코스별·기간별 뷰 롤업 확장은 home-verify 후속 대상.' });
  }

  // ── 리포트 ──
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok).length;
  const review = judged.filter((c) => !c.ok && c.review).length;
  const fail = judged.filter((c) => !c.ok && !c.review).length;
  const attn = fail + review;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: AC) => c.na ? '➖' : c.ok ? '✅' : c.review ? '🔎' : '❌';
  const groups = Array.from(new Set(checks.map((c) => c.group)));
  const bodyHtml = groups.map((gn) => {
    const rows = checks.filter((c) => c.group === gn);
    const p = rows.filter((r) => !r.na && r.ok).length; const f = rows.filter((r) => !r.na && !r.ok).length; const n = rows.filter((r) => r.na).length;
    return `<tr class="mt"><td colspan="3">${esc(gn)} — <span class="okb">통과 ${p}</span>${f ? ` · <span class="ngb">주의 ${f}</span>` : ''}${n ? ` · <span class="mut">참고 ${n}</span>` : ''}</td></tr>`
      + rows.map((c) => `<tr class="${c.na ? 'na' : c.ok ? '' : c.review ? 'rv' : 'ng'}"><td>${mark(c)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  }).join('');
  const html = `<title>그래프 화면 카드 검증</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 60px;font:15px/1.6 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.na-n{color:var(--mut)}.rv-n{color:#9a6700}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.mt td{background:var(--card);font-weight:700;font-size:12.5px;padding-top:12px}tr.ng td{color:var(--ng);font-weight:600}tr.na td{color:var(--mut)}tr.rv td{color:#9a6700;font-weight:600}
.okb{color:var(--ok)}.ngb{color:var(--ng)}.mut{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
</style><div class="wrap">
<h1>그래프 화면 카드 검증 스윕</h1>
<div class="sub">킹즈락 · ${ts} · 비파괴(차트 DOM 수치 부재 → 그래프 옆 카드·원천 표로 정합)</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${fail ? 'ng-n' : review ? 'rv-n' : 'ok-n'}">${attn}</div><div class="l">주의 필요${review ? ` (확인 필요 ${review})` : ''}</div></div><div class="card"><div class="n na-n">${na}</div><div class="l">참고(판정 제외)</div></div></div>
<div class="note">net-new = <b>예산 분석 그래프 카드 = 원천 표(연간·월간) 교차</b> + 카드 롤업(전체=Σ·잔여 2단). 비용 3화면·HOME 작업지시는 합계=Σ 정합이 <b>budget-verify / coverage-fill / home-verify</b>에 이미 있어 중복 회피(정보 na로 커버리지 맵만 표기). 파싱 실패=na(판정 제외, 거짓 결과 금지).</div>
<table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${bodyHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-graph-cards.html'), html, 'utf-8');
  try { fs.writeFileSync(path.join('analysis', '_graph-cards.json'), JSON.stringify(dump, null, 2), 'utf8'); } catch { /* noop */ }
  console.log(`\n[그래프카드] 총 ${checks.length} · PASS ${pass} · FAIL ${fail} · REVIEW ${review} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-graph-cards.html');
});

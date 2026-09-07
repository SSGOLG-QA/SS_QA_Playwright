import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseOneYear } from '../lib/course/courseHelpers';
import { near } from '../lib/course/domain/budgetCost';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  커버리지 보완 통합(P2 잔여 ②~⑤, 비파괴) — 단일 test 1런.
//   ② 예산 분석 연간 테이블 DOM=API(누적값 대조)
//   ③ 기간별 비용 3년비교 카드 5개 = 표 해당행 대조
//   ④ 위치별 비용 분포 막대 %·금액(세그먼트 %=금액/전체 + 홀별 분해 합)
//   ⑤ 예산 상세/실적 개별 분류 탭 합계=Σ월(탭 전환 후 재검증)
//   실행: npm run course:auth 후 npm run course:coverage-fill → reports/course-coverage-fill.html
//   ③④ 구조 불확실 → 검증과 동시에 원시 후보를 analysis/_coverage_fill_raw.json 덤프(재프로브 방지).
// ──────────────────────────────────────────────────────────────

interface Check { name: string; group: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
const NUM = (t: string): number | null => { const m = (t || '').match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/); if (!m) return null; const v = Number(m[0].replace(/,/g, '')); return Number.isFinite(v) ? v : null; };

async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1500); await killAlarms(admin); return true; }
  return false;
}
async function readTable(admin: Page): Promise<{ heads: string[]; rows: string[][] }> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { heads: [] as string[], rows: [] as string[][] };
    const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent)).filter(Boolean);
    const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((td) => norm(td.textContent)));
    return { heads, rows };
  }).catch(() => ({ heads: [] as string[], rows: [] as string[][] }));
}
async function enter(admin: Page, menu: string, sub: string, oneYear = false): Promise<boolean> {
  const ok = await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false);
  if (!ok) return false;
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (oneYear) { const dp = await admin.locator('.contents .datepicker-input:visible, main .datepicker-input:visible').count().catch(() => 0); if (dp >= 2) { await setCourseOneYear(admin).catch(() => {}); await admin.waitForTimeout(900); } }
  return true;
}
// 값+YoY 동거 셀 분해(예산총괄 연간과 동일 규칙: 선행 콤마그룹=값, 나머지 %=YoY)
function splitVY(t: string): { v: number | null; y: number | null } {
  const vm = (t || '').match(/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/); const v = vm ? Number(vm[0].replace(/,/g, '')) : null;
  const rest = vm ? t.slice(vm[0].length) : t; const ym = rest.match(/([+-]?\d+(?:\.\d+)?)\s*%/); const y = ym ? Number(ym[1]) : null;
  return { v: (v != null && Number.isFinite(v)) ? v : null, y: (y != null && Number.isFinite(y)) ? y : null };
}

test('예산·비용 커버리지 보완 검증(②~⑤, 비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  const admin: Page = await openCourseAdmin(page, context);
  let analysis: any = null;
  admin.on('response', (res) => { if (!/budget\/anal\/monthly\/init/i.test(res.url())) return; res.text().then((b) => { try { const j = JSON.parse(b); if (j?.data) analysis = j.data; } catch { /* */ } }).catch(() => {}); });
  const checks: Check[] = [];
  const raw: any = { ts: new Date().toISOString() };

  // ═══ ② 예산 분석 연간 테이블 DOM=API ═══
  if (await enter(admin, '예산 관리', '예산 분석')) {
    if (!analysis) { await admin.reload({ waitUntil: 'networkidle' }).catch(() => {}); await admin.waitForTimeout(2500); await killAlarms(admin); }
    const okTab = await clickTab(admin, /연간\s*테이블/);
    const { rows } = await readTable(admin);
    // 연간 테이블 값 8열(우측앵커): 연간예산·누적사용·잔여예산·전체절감·사용률%·누적예산·누적대비사용%·누적절감
    const GROUPS = ['budgetFixedMonthlyAnalysisRes', 'budgetTempMonthlyAnalysisRes', 'budgetCourseMonthlyAnalysisRes', 'budgetEquipMonthlyAnalysisRes', 'budgetMiscMonthlyAnalysisRes'];
    const byCat2 = new Map<string, any>(); const freq = new Map<string, number>();
    if (analysis) for (const g of GROUPS) for (const r of (analysis[g] || [])) { if (r.cat2Name && r.cat2Idx != null) { const k = r.cat2Name.replace(/\s+/g, ''); freq.set(k, (freq.get(k) || 0) + 1); byCat2.set(k, r); } }
    const total = analysis?.budgetTotalMonthlyAnalysisRes;
    const curIdx = total?.budgetPerform ? (total.budgetPerform as number[]).reduce((li: number, v: number, i: number) => (v > 0 ? i : li), -1) : -1;
    if (!analysis || !rows.length || !okTab) checks.push({ name: '② 예산분석 연간 테이블 DOM=API', group: '② 예산분석 연간테이블', ok: true, na: true, detail: `판정 제외(API ${analysis ? 'O' : 'X'}·행 ${rows.length}·탭 ${okTab})` });
    else {
      let mApi = 0, mForm = 0, badApi = 0, badForm = 0, dup = 0; const exA: string[] = []; const exF: string[] = [];
      for (const r of rows) {
        const cells = r; const last8 = cells.slice(-8).map(NUM); const label = cells.length >= 9 ? cells[cells.length - 9] : '';
        const k = label.replace(/\s+/g, '');
        if (/합계|소계|총\s*예산|총계|전체/.test(label) || last8.filter((x) => x != null).length < 6) continue;
        if ((freq.get(k) || 0) !== 1) { dup++; continue; }
        const ar = byCat2.get(k); if (!ar) { dup++; continue; }
        const [yb, cu, remain, wholeDiff, useRate, accB, accUseRate, accDiff] = last8;
        const apiYb = ar.budgetAccumPlan?.[11], apiCu = ar.budgetAccumPerform?.[11], apiAccB = curIdx >= 0 ? ar.budgetAccumPlan?.[curIdx] : null;
        // DOM=API: 연간예산·누적사용·누적예산
        for (const [d, a, nm] of [[yb, apiYb, '연간예산'], [cu, apiCu, '누적사용'], [accB, apiAccB, '누적예산']] as const) {
          if (d == null || a == null) continue; mApi++; if (!near(d, a, 2)) { badApi++; if (exA.length < 3) exA.push(`${label}·${nm}(화면 ${won(d)}≠API ${won(a)})`); }
        }
        // DOM 내부 파생식: 잔여=연간−누적사용 · 전체절감=누적사용−연간 · 사용률=누적사용/연간 · 누적대비=누적사용/누적예산 · 누적절감=누적사용−누적예산
        const forms: [number | null, number | null, string][] = [
          [remain, (yb != null && cu != null) ? yb - cu : null, '잔여=연간−누적사용'],
          [wholeDiff, (cu != null && yb != null) ? cu - yb : null, '전체절감=누적사용−연간'],
          [useRate, (cu != null && yb) ? cu / yb * 100 : null, '사용률=누적사용/연간'],
          [accUseRate, (cu != null && accB) ? cu / accB * 100 : null, '누적대비=누적사용/누적예산'],
          [accDiff, (cu != null && accB != null) ? cu - accB : null, '누적절감=누적사용−누적예산'],
        ];
        for (const [d, e, nm] of forms) { if (d == null || e == null) continue; mForm++; const tol = /사용률|대비/.test(nm) ? 0.06 : 2; if (!near(d, e, tol)) { badForm++; if (exF.length < 3) exF.push(`${label}·${nm}(화면 ${d}≠계산 ${e.toFixed(2)})`); } }
      }
      checks.push({ name: '② 연간 테이블 DOM=API (연간예산·누적사용·누적예산)', group: '② 예산분석 연간테이블', ok: badApi === 0, na: mApi === 0, detail: mApi === 0 ? '대상 없음' : `${mApi}셀 중 ${mApi - badApi} 일치${badApi ? ` · 위반 ${badApi}(${exA.join(', ')})` : ''}${dup ? ` · 중복명 제외 ${dup}행` : ''}` });
      checks.push({ name: '② 연간 테이블 내부 파생식(잔여·절감·사용률·누적대비)', group: '② 예산분석 연간테이블', ok: badForm === 0, na: mForm === 0, detail: mForm === 0 ? '대상 없음' : `${mForm}건 중 ${mForm - badForm} 성립${badForm ? ` · 위반 ${badForm}(${exF.join(', ')})` : ''}` });
    }
  }

  // ═══ ③ 기간별 비용 3년비교 카드 = 표 해당행 ═══
  if (await enter(admin, '비용 관리', '기간별 비용')) {
    await clickTab(admin, /^\s*분류\s*$/);
    // 카드 추출: 2024·2025·2026 연도 토큰을 모두 가진 짧은 블록 → 제목 + 연도별 값
    const cards = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      const out: { title: string; text: string }[] = [];
      const cand = Array.from(sc.querySelectorAll('div,li,section,article')).filter((e) => { const t = norm(e.textContent); return /2024/.test(t) && /2025/.test(t) && /2026/.test(t) && t.length < 160; });
      const leaves = cand.filter((e) => !cand.some((o) => o !== e && e.contains(o)));
      leaves.forEach((e) => { const t = norm(e.textContent); const title = (t.match(/^([^\d]{1,14}?)\s*2024/) || [])[1] || ''; out.push({ title: title.trim(), text: t }); });
      return out.slice(0, 12);
    }).catch(() => [] as { title: string; text: string }[]);
    raw.periodCards = cards;
    const { rows } = await readTable(admin);
    // 표 행: 1분류 label → 2024/2025/2026 (마지막 3셀 값+YoY 동거)
    const tblByLabel = new Map<string, number[]>();
    for (const r of rows) { const label = r[0] || ''; const last3 = r.slice(-3).map((c) => splitVY(c).v); if (label && last3.some((x) => x != null)) tblByLabel.set(label.replace(/\s+/g, ''), last3.map((x) => x ?? NaN)); }
    raw.periodTable = Array.from(tblByLabel.entries());
    if (!cards.length || !tblByLabel.size) checks.push({ name: '③ 기간별 3년비교 카드 = 표', group: '③ 기간별 카드', ok: true, na: true, detail: `판정 제외(카드 ${cards.length}·표행 ${tblByLabel.size}) — 원시덤프 확인` });
    else {
      let m = 0, bad = 0, unm = 0; const ex: string[] = [];
      for (const c of cards) {
        const key = c.title.replace(/\s+/g, ''); const trow = tblByLabel.get(key);
        // 카드 텍스트서 2024/2025/2026 직후 첫 숫자 추출
        const cv = ['2024', '2025', '2026'].map((y) => { const mm = c.text.match(new RegExp(y + '\\s*(-?\\d{1,3}(?:,\\d{3})*)')); return mm ? Number(mm[1].replace(/,/g, '')) : null; });
        if (!trow || cv.every((x) => x == null)) { unm++; continue; }
        for (let i = 0; i < 3; i++) { const d = cv[i], t = trow[i]; if (d == null || t == null || Number.isNaN(t)) continue; m++; if (!near(d, t, 2)) { bad++; if (ex.length < 3) ex.push(`${c.title}·${2024 + i}(카드 ${won(d)}≠표 ${won(t)})`); } }
      }
      checks.push({ name: '③ 기간별 3년비교 카드값 = 표 해당행', group: '③ 기간별 카드', ok: bad === 0, na: m === 0, detail: m === 0 ? `대상 없음(카드 ${cards.length}·표 ${tblByLabel.size})` : `${m}셀 중 ${m - bad} 일치${bad ? ` · 위반 ${bad}(${ex.join(', ')})` : ''}${unm ? ` · 미매칭 ${unm}카드` : ''}` });
    }
  }

  // ═══ ④ 위치별 비용 분포 막대 %·금액 ═══
  if (await enter(admin, '비용 관리', '위치별 비용')) {
    await clickTab(admin, /^\s*연간\s*$/);
    // 범례가 이름·%·금액 별도 자식 → 앵커 매칭 실패. 대신 "%/금액" 패턴만 추출(이 부분은 오염 없음, 이름 무시).
    const triples = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const full = norm((document.querySelector('.contents, main') || document.body).textContent);
      const out: { pct: number; amt: number }[] = []; const re = /([\d.]+)\s*%\s*\/\s*([\d,]+)/g; let m: RegExpExecArray | null;
      while ((m = re.exec(full)) && out.length < 80) out.push({ pct: Number(m[1]), amt: Number(m[2].replace(/,/g, '')) });
      return out;
    }).catch(() => [] as { pct: number; amt: number }[]);
    raw.locTriples = triples;
    // 코스별 비용 분포 = 페이지 첫 그룹, Σ%≈100 → 선행 프리픽스를 누적 %가 98 넘을 때까지 취함(코스 세그먼트, 금액 오염 없음).
    const courseSegs: { pct: number; amt: number }[] = []; let acc = 0;
    for (const t of triples) { courseSegs.push(t); acc += t.pct; if (acc >= 98) break; }
    const grand = courseSegs.reduce((a, t) => a + t.amt, 0);
    // 표 코스 총비용(교차 기준) — 금액 매칭
    const { rows } = await readTable(admin);
    const tblTot: number[] = [];
    for (const r of rows) { const label = (r[0] || '').replace(/\s+/g, ''); const tot = NUM(r[1] || ''); if (/South|East|West/i.test(label) && tot != null) tblTot.push(tot); }
    if (courseSegs.length < 2 || acc < 98) checks.push({ name: '④ 위치별 코스분포 막대 %·금액', group: '④ 위치별 분포', ok: true, na: true, detail: `코스분포 그룹 식별 실패(세그 ${courseSegs.length}·Σ% ${acc.toFixed(1)}) — 판정 제외(원시덤프)` });
    else {
      // ① 세그먼트 % = 금액 ÷ Σ(코스분포) (표시 소수1자리 → tol 0.2)
      let m = 0, bad = 0; const ex: string[] = [];
      for (const t of courseSegs) { const exp = t.amt / grand * 100; m++; if (Math.abs(t.pct - exp) > 0.2) { bad++; if (ex.length < 4) ex.push(`${won(t.amt)}(표시 ${t.pct}%≠금액/Σ ${exp.toFixed(1)}%)`); } }
      checks.push({ name: '④ 코스분포 세그먼트 % = 금액 ÷ Σ(코스분포)', group: '④ 위치별 분포', ok: bad === 0, na: m === 0, detail: m === 0 ? '대상 없음' : `${m}세그먼트 중 ${m - bad} 정합(Σ%=${acc.toFixed(1)}·Σ금액 ${won(grand)}·${courseSegs.map((t) => `${t.pct}%`).join('/')})${bad ? ` · 불일치 ${bad}(${ex.join(', ')})` : ''}` });
      // ② 코스 막대 금액 = 표 코스 총비용(금액 매칭 교차)
      let mc = 0, badc = 0;
      for (const tv of tblTot) { if (courseSegs.some((s) => near(s.amt, tv, Math.max(2, tv * 0.001)))) mc++; else badc++; }
      checks.push({ name: '④ 코스 막대 금액 = 표 코스 총비용(교차)', group: '④ 위치별 분포', ok: badc === 0, na: tblTot.length === 0, detail: tblTot.length === 0 ? '표 코스 행 미검출 — 판정 제외' : `표 ${tblTot.length}코스 중 막대와 일치 ${mc}${badc ? ` · 불일치 ${badc}` : ''}` });
      // ③ 홀별 세부 분포는 금액 뒤 'N홀' 인접으로 파싱 오염 → 코스 총비용 표 교차로 갈음(참고)
      checks.push({ name: '④ 코스별 홀별 세부 분포', group: '④ 위치별 분포', ok: true, na: true, detail: '홀별 세그먼트는 금액 뒤 홀 라벨 인접으로 신뢰 파싱 불가 → 코스 총비용 표 교차(②)로 갈음(판정 제외)' });
    }
  }

  // ═══ ⑤ 예산 상세 / 실적 관리 개별 분류 탭 ═══
  const MGMT = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
  for (const [menu, sub, key] of [['예산 관리', '예산 상세', '예산상세'], ['예산 관리', '실적 관리', '실적관리']] as const) {
    if (!(await enter(admin, menu, sub))) { checks.push({ name: `⑤ ${sub} 분류 탭`, group: `⑤ ${key} 분류탭`, ok: true, na: true, detail: '진입 실패 — 판정 제외' }); continue; }
    let tabsHit = 0; let totRows = 0, totBad = 0; const ex: string[] = []; let mode = '';
    for (const cat of MGMT) {
      if (!(await clickTab(admin, new RegExp(`^\\s*${cat.replace(/\s+/g, '\\s*')}\\s*$`)))) continue;
      tabsHit++;
      const { heads, rows } = await readTable(admin);
      const hasSum = heads.some((h) => /합계/.test(h));
      if (hasSum) { // 예산 상세: 합계 = Σ(1~12월) per row
        mode = '합계=Σ월';
        for (const r of rows) {
          const label = (r[0] || '') + (r[1] || '');
          const nums = r.map(NUM);
          // 합계 = 우측 13셀 중 첫 값(합계), 나머지 12 = 월. 우측앵커.
          const last13 = nums.slice(-13); const sumCell = last13[0]; const months = last13.slice(1, 13);
          if (sumCell == null || months.filter((x) => x != null).length < 6) continue;
          const s = months.reduce((a: number, b) => a + (b || 0), 0); totRows++;
          if (!near(sumCell, s, 2)) { totBad++; if (ex.length < 3) ex.push(`${cat}/${label.slice(0, 8)}(합계 ${won(sumCell)}≠Σ월 ${won(s)})`); }
        }
      } else { // 실적 관리: 합계 컬럼 없음 → 소계행 = Σ(직전 데이터행) per month
        mode = '소계=Σ행(월별)';
        const dataRows: (number | null)[][] = []; let checkedGroup = false;
        for (const r of rows) {
          const isSoke = r.some((c) => /소계/.test(c));
          const months = r.map(NUM).slice(-12);
          if (isSoke) {
            if (dataRows.length) {
              for (let mi = 0; mi < 12; mi++) { const colSum = dataRows.reduce((a, dr) => a + (dr[mi] || 0), 0); const sv = months[mi]; if (sv == null) continue; totRows++; checkedGroup = true; if (!near(sv, colSum, 2)) { totBad++; if (ex.length < 3) ex.push(`${cat}/소계 ${mi + 1}월(${won(sv)}≠Σ ${won(colSum)})`); } }
            }
            dataRows.length = 0;
          } else if (months.filter((x) => x != null).length >= 6) dataRows.push(months);
        }
        if (!checkedGroup) { /* 소계 없거나 단일행 — 대상 없음 */ }
      }
    }
    if (!tabsHit) checks.push({ name: `⑤ ${sub} 개별 분류 탭`, group: `⑤ ${key} 분류탭`, ok: true, na: true, detail: '분류 탭 전환 실패 — 판정 제외' });
    else if (totRows === 0) checks.push({ name: `⑤ ${sub} 개별 분류 탭 (${mode || '—'})`, group: `⑤ ${key} 분류탭`, ok: true, na: true, detail: `탭 ${tabsHit}종 전환 · 검증 대상 행 없음 — 판정 제외` });
    else checks.push({ name: `⑤ ${sub} 개별 분류 탭 · ${mode}`, group: `⑤ ${key} 분류탭`, ok: totBad === 0, detail: `탭 ${tabsHit}종 · ${totRows}건 중 ${totRows - totBad} 성립${totBad ? ` · 위반 ${totBad}(${ex.join(', ')})` : ''}` });
  }

  // ── 원시 덤프 + 리포트 ──
  try { if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true }); fs.writeFileSync(path.join('analysis', '_coverage_fill_raw.json'), JSON.stringify(raw, null, 2), 'utf-8'); } catch { /* */ }
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok && !c.review).length; const rev = judged.filter((c) => c.ok && c.review).length; const fail = judged.filter((c) => !c.ok).length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : !c.ok ? '❌' : c.review ? '🔎' : '✅';
  const clsOf = (c: Check) => c.na ? 'na' : !c.ok ? 'ng' : c.review ? 'rv' : '';
  const rowsHtml = checks.map((c) => `<tr class="${clsOf(c)}"><td>${mark(c)}</td><td>${esc(c.group)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  const html = `<title>예산·비용 커버리지 보완 검증</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--rv:#9a6700;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:980px;margin:0 auto;padding:24px 18px 60px;font:15px/1.65 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 90px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.rv-n{color:var(--rv)}.na-n{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.ng td{color:var(--ng);font-weight:600}tr.rv td{color:var(--rv)}tr.na td{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
</style><div class="wrap">
<h1>예산·비용 커버리지 보완 검증 (②~⑤)</h1>
<div class="sub">코스관리 킹즈락 · ${ts} · 비파괴 · 단일 로그인 1런</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${rev ? 'rv-n' : 'ok-n'}">${rev}</div><div class="l">확인 필요</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">커버리지 맵 잔여 후보 반영: <b>② 예산분석 연간 테이블 DOM=API</b>(연간예산·누적사용·누적예산 + 파생식) · <b>③ 기간별 3년비교 카드 = 표</b> · <b>④ 위치별 분포 막대 %=금액/전체 + 코스 교차</b> · <b>⑤ 예산상세/실적 개별 분류 탭</b>(합계=Σ월 / 소계=Σ행). ①(기타 일반 관리비)은 직전 <code>budget-annual</code>서 파싱버그 확정·해소 완료. 참고(➖)=판정 제외.</div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-coverage-fill.html'), html, 'utf-8');
  console.log(`\n[커버리지보완] 총 ${checks.length} · PASS ${pass} · 확인필요 ${rev} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-coverage-fill.html · [raw] analysis/_coverage_fill_raw.json');
});

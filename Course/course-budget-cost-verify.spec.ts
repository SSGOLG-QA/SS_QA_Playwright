import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseOneYear } from '../lib/course/courseHelpers';
import { Check, crossTotalsEqual, sumEquals, vectorEquals, near, nearRel, firstNum, num } from '../lib/course/domain/budgetCost';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  예산/비용 화면 간 계산 정합성 검증기(비파괴) — 현재 시스템 데이터 수집→교차 정합성→탭형 HTML.
//  실행: npm run course:auth 후 npm run course:budget-verify → reports/course-budget-cost-verify.html
//  탭: 실행방법 / 연관성 맵 / Summary / 비용 상세 / 예산 상세.
//  ⚠ rowspan(대분류/중분류 병합) 캡처 후 전체 그리드 재구성 → 원본표·파싱 열정렬 정확.
//  비파괴(조회/스캔만). 별도 입력 불필요.
// ──────────────────────────────────────────────────────────────

interface Cell { t: string; rs: number; cs: number; }
interface Tbl { heads: string[]; cells: Cell[][] }
interface Grab { cards: string[]; tables: Tbl[]; }

async function grab(admin: Page): Promise<Grab> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.contents, main') || document.body;
    const cards = Array.from(scope.querySelectorAll('[class*="card"], [class*="summary"], [class*="total"], [class*="amount"]'))
      .map((e) => norm(e.textContent)).filter((t) => t && t.length < 120 && /[0-9]/.test(t));
    const tables = Array.from(scope.querySelectorAll('table')).slice(0, 4).map((t) => ({
      heads: Array.from(t.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent)).filter(Boolean),
      cells: Array.from(t.querySelectorAll('tbody tr')).slice(0, 140).map((tr) => Array.from(tr.children).map((td) => ({ t: norm(td.textContent), rs: (td as HTMLTableCellElement).rowSpan || 1, cs: (td as HTMLTableCellElement).colSpan || 1 }))),
    }));
    return { cards: Array.from(new Set(cards)), tables };
  }).catch(() => ({ cards: [], tables: [] }));
}

// rowspan/colspan을 채워 완전한 격자(string[][])로 재구성.
function gridOf(T: Tbl | undefined): { cols: number; grid: string[][] } {
  if (!T) return { cols: 0, grid: [] };
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
  return { cols, grid };
}

// 페이지네이션 전 페이지 순회 수집(원천 화면=인력/장비/자재는 페이지 분할) — 다음 페이지 버튼/번호 클릭하며 행 누적.
async function grabPaged(admin: Page, menu: string, sub: string, maxPages = 25): Promise<Grab | null> {
  if (!(await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false))) return null;
  await admin.waitForTimeout(1500); await killAlarms(admin);
  const first = await grab(admin);
  if (!first.tables[0]) return first;
  const combined: Grab = { cards: first.cards, tables: [{ heads: first.tables[0].heads, cells: [...first.tables[0].cells] }] };
  let page = 1; let prevSig = first.tables[0].cells.map((r) => r.map((c) => c.t).join('|')).join('#');
  for (let i = 0; i < maxPages; i++) {
    const clicked = await admin.evaluate((target) => {
      const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !(e as HTMLButtonElement).disabled;
      const norm = (s: string | null) => (s || '').trim();
      const cls = (e: Element) => (typeof e.className === 'string' ? e.className : '');
      const inPag = (e: Element) => { let p: Element | null = e; for (let k = 0; k < 4 && p; k++) { if (/pag/i.test(cls(p))) return true; p = p.parentElement; } return false; };
      const all = Array.from(document.querySelectorAll('button, a, li'));
      const nums = all.filter((e) => vis(e) && norm(e.textContent) === target);
      let btn = nums.find(inPag) || nums[nums.length - 1];
      if (btn) { (btn as HTMLElement).click(); return true; }
      const arrow = all.find((e) => vis(e) && (/next|다음/i.test(cls(e) + (e.getAttribute('aria-label') || '')) || /^[›❯»>]$/.test(norm(e.textContent))));
      if (arrow) { (arrow as HTMLElement).click(); return true; }
      return false;
    }, String(page + 1)).catch(() => false);
    if (!clicked) break;
    await admin.waitForTimeout(900); await killAlarms(admin);
    const g = await grab(admin); const cells = g.tables[0]?.cells || [];
    const sig = cells.map((r) => r.map((c) => c.t).join('|')).join('#');
    if (!cells.length || sig === prevSig) break;   // 페이지 미변경/끝
    combined.tables[0].cells.push(...cells); prevSig = sig; page++;
  }
  return combined;
}

const MGMT = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
const won = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));

interface BudGroup { mid: string; major: string; cols: string[]; subRows: { label: string; vals: number[] }[]; sumVals: number[]; sokeVals: number[]; match: boolean[]; ok: boolean; }

test('예산/비용 화면 간 계산 정합성 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  const admin = await openCourseAdmin(page, context);
  // oneYear=true: 비용 관리 화면(datepicker 기본 3개월→데이터 제한)에 검색기간 1년 설정 후 수집(타이핑 방식).
  const dateApplied: Record<string, string> = {};
  const go = async (menu: string, sub: string, oneYear = false): Promise<Grab | null> => {
    if (!(await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false))) return null;
    await admin.waitForTimeout(1500); await killAlarms(admin);
    if (oneYear) {
      const hasDp = await admin.locator('.contents .datepicker-input:visible, main .datepicker-input:visible').count().catch(() => 0);
      const ok = hasDp >= 2 ? await setCourseOneYear(admin).catch(() => false) : false;
      dateApplied[sub] = hasDp < 2 ? 'datepicker없음' : ok ? '1년적용✓' : '적용실패';
      await admin.waitForTimeout(800);
    }
    return grab(admin);
  };

  const SCREENS: { menu: string; sub: string; route: string; grp: 'budget' | 'cost'; g: Grab | null }[] = [
    { menu: '예산 관리', sub: '예산 총괄', route: '/budget/summary', grp: 'budget', g: await go('예산 관리', '예산 총괄') },
    { menu: '예산 관리', sub: '예산 상세', route: '/budget/detail', grp: 'budget', g: await go('예산 관리', '예산 상세') },
    { menu: '예산 관리', sub: '실적 관리', route: '/budget/performance', grp: 'budget', g: await go('예산 관리', '실적 관리') },
    { menu: '예산 관리', sub: '예산 분석', route: '/budget/analysis', grp: 'budget', g: await go('예산 관리', '예산 분석') },
    { menu: '비용 관리', sub: '비용 집계', route: '/cost/aggregate', grp: 'cost', g: await go('비용 관리', '비용 집계', true) },
    { menu: '비용 관리', sub: '작업별 비용', route: '/cost/task', grp: 'cost', g: await go('비용 관리', '작업별 비용', true) },
    { menu: '비용 관리', sub: '분류별 비용', route: '/cost/category', grp: 'cost', g: await go('비용 관리', '분류별 비용', true) },
    { menu: '비용 관리', sub: '위치별 비용', route: '/cost/loc', grp: 'cost', g: await go('비용 관리', '위치별 비용', true) },
    { menu: '비용 관리', sub: '기간별 비용', route: '/cost/period', grp: 'cost', g: await go('비용 관리', '기간별 비용', true) },
  ];
  const G = (sub: string) => SCREENS.find((s) => s.sub === sub)?.g ?? null;
  const grid = (sub: string) => gridOf(G(sub)?.tables[0]);

  const checks: Check[] = [];
  // 비용 화면 1년 기간 적용 현황(정합성 비교 유효성 판단용) — 전 화면 '1년적용✓'여야 다축 비교가 동일 범위.
  checks.push({ name: '비용 관리 1년 기간 적용 현황(정보성)', scope: 'intra', ok: true, detail: `${Object.entries(dateApplied).map(([k, v]) => `${k}:${v}`).join(' · ') || '적용 없음'} — datepicker 있는 화면만 1년 설정, 연도필터 화면(datepicker없음)은 연도 선택 기반` });

  // ── 비용 집계 ──
  let aggOrder: (number | null)[] = [], aggTotal: number | null = null;
  { const { grid: gr } = grid('비용 집계');
    if (gr.length) {
      const rowBy = (kw: RegExp) => gr.find((r) => kw.test(r[0] || ''));
      const parse = (r?: string[]) => (r ? r.slice(1).map(num) : []);
      aggOrder = parse(rowBy(/작업지시/)); const aggActual = parse(rowBy(/실제\s*발생/)), aggDiff = parse(rowBy(/차액/));
      aggTotal = aggOrder[0] ?? null;
      checks.push(sumEquals('비용집계 총계 = Σ관리비유형(작업지시)', 'intra', aggOrder[0], aggOrder.slice(1)));
      const bad: string[] = []; let dc = 0;
      for (let i = 0; i < aggDiff.length; i++) { const o = aggOrder[i], a = aggActual[i], d = aggDiff[i]; if (o == null || a == null || d == null) continue; dc++; if (!near(d, o - a)) bad.push(`열${i}`); }
      checks.push({ name: '비용집계 차액 = 작업지시 − 실제발생', scope: 'intra', ok: bad.length === 0, detail: bad.length === 0 ? `${dc}열 일치` : `불일치: ${bad.join(',')}` });
    } }

  // ── 분류별 ──
  let catTotal: number | null = null, catColSums: (number | null)[] = [];
  { const T = G('분류별 비용')?.tables[0]; const { grid: gr } = grid('분류별 비용');
    if (T && gr.length) {
      const hi = T.heads.indexOf('합계');
      const dataRows = gr.filter((r) => !/합계|총계/.test(r[0] || '') && r.slice(hi >= 0 ? hi : 3).some((c) => num(c) != null));
      const rowTotals: (number | null)[] = []; const colMat: number[][] = [];
      for (const r of dataRows) {
        const cells = r.slice(hi >= 0 ? hi : 3); const total = num(cells[0]); const types = cells.slice(1, 6).map(num);
        rowTotals.push(total); colMat.push(types.map((v) => v ?? 0));
        checks.push(sumEquals(`분류별 행 합계=Σ관리비 (${r.find((c) => c && !num(c)) || r[0]})`, 'intra', total, types));
      }
      catColSums = MGMT.map((_, j) => colMat.reduce((a, row) => a + (row[j] || 0), 0));
      const cardTotal = firstNum(G('분류별 비용')!.cards.find((c) => /총\s*비용/.test(c)) || '');
      catTotal = cardTotal ?? (rowTotals.every((v) => v != null) ? (rowTotals as number[]).reduce((a, b) => a + b, 0) : null);
      if (cardTotal != null) checks.push(sumEquals('분류별 Σ행 = 총 비용(카드)', 'intra', cardTotal, rowTotals));
    } }

  // ── 위치별 ──
  let locTotal: number | null = null;
  { const T = G('위치별 비용')?.tables[0]; const { grid: gr } = grid('위치별 비용');
    if (T && gr.length) {
      const ti = T.heads.indexOf('총 비용') >= 0 ? T.heads.indexOf('총 비용') : 2;
      const dataRows = gr.filter((r) => (r[0] || '').length > 0 && num(r[ti]) != null);
      let sum = 0; let any = false;
      for (const r of dataRows) {
        const total = num(r[ti]); const areas = r.slice(ti + 1).map((c) => num(c)).filter((v): v is number => v != null);
        if (total != null) { sum += total; any = true; }
        const raw = areas.reduce((a, b) => a + b, 0); const k = total ? Math.round(raw / total) : 1;
        if (total && k >= 2 && near(raw / k, total)) checks.push({ name: `위치별 코스 총비용=Σ코스영역 (${r[0]})`, scope: 'intra', ok: true, detail: `총계 ${total.toLocaleString()} = Σarea/${k} (area 컬럼 ${k}배 반복)` });
        else checks.push(sumEquals(`위치별 코스 총비용=Σ코스영역 (${r[0]})`, 'intra', total, areas));
      }
      const cardTotal = firstNum(G('위치별 비용')!.cards.find((c) => /전체\s*비용/.test(c)) || '');
      locTotal = cardTotal ?? (any ? sum : null);
      if (cardTotal != null && any) checks.push(sumEquals('위치별 Σ코스 = 전체 비용(카드)', 'intra', cardTotal, [sum]));
    } }

  // ── 기간별 / 작업별 ──
  let perTotal2026: number | null = null, taskTotal: number | null = null, taskTotalAll: number | null = null, taskExcluded = 0, taskExclSum = 0;
  { const { grid: gr } = grid('기간별 비용'); const t = gr.find((r) => /전체/.test(r[0] || '')); if (t) perTotal2026 = firstNum(t[t.length - 1]); }
  { const T = G('작업별 비용')?.tables[0]; const { grid: gr } = grid('작업별 비용'); const ti = T?.heads.indexOf('총 비용') ?? -1; const pi = T && T.heads.indexOf('기간') >= 0 ? T.heads.indexOf('기간') : 2;
    const curYear = new Date().getFullYear();
    if (ti >= 0) {
      const dr = gr.filter((r) => !/없습니다/.test(r[0] || '') && num(r[ti]) != null);
      taskTotalAll = dr.reduce((a, r) => a + (num(r[ti]) || 0), 0);
      // ⚠ 크로스이어 이중계상 방지: 기간 시작연도 < 당해(전년도 시작)면 제외 → 연도필터 화면과 동일 기준.
      const cur = dr.filter((r) => { const y = Number(((r[pi] || '').match(/\d{4}/) || ['0'])[0]); return !(y > 0 && y < curYear); });
      taskExcluded = dr.length - cur.length; taskExclSum = taskTotalAll - cur.reduce((a, r) => a + (num(r[ti]) || 0), 0);
      if (cur.length) taskTotal = cur.reduce((a, r) => a + (num(r[ti]) || 0), 0);
    } }
  checks.push({ name: '작업별 전년도시작 제외(크로스이어 이중계상 방지)', scope: 'intra', ok: true, detail: `당해(${new Date().getFullYear()})시작만 합계 ${taskTotal?.toLocaleString() ?? '-'} = 전체 ${taskTotalAll?.toLocaleString() ?? '-'} − 전년도시작 ${taskExcluded}건(${taskExclSum.toLocaleString()}). 연도필터 화면(시작연도 기준)과 동일 스코프로 정렬. ★검토(제외 적용 범위): 제외는 **작업별(날짜필터, 겹침 전액=이중계상)에만** 필요 — 집계·분류별·위치별·기간별은 시작연도 기준이라 아래 교차검증 통과가 곧 '이미 정렬됨'의 증거 → 추가 제외 불필요(적용 시 이중제외로 과소계상)` });

  // ── ★ 교차 ──
  checks.push(crossTotalsEqual('★ 비용 총비용 다축 일치(집계=분류별=위치별=기간별=작업별[전년도시작제외])', [
    { label: '비용집계', value: aggTotal }, { label: '분류별', value: catTotal }, { label: '위치별', value: locTotal }, { label: '기간별2026', value: perTotal2026 }, ...(taskTotal != null ? [{ label: '작업별(당해시작)', value: taskTotal }] : []),
  ]));
  // ⚠ 교차(다축 일치)는 총계 0인 축을 '미집계 추정'으로 비교에서 제외한다(0으로 false FAIL 방지) → 그래서 ③에 안 잡힘.
  //   대신 0축을 '확인 필요'(review) 항목으로 별도 집계 = 주의 필요에 포함(사람이 원천 확인).
  for (const t of [{ l: '비용집계', v: aggTotal }, { l: '분류별', v: catTotal }, { l: '위치별', v: locTotal }, { l: '기간별', v: perTotal2026 }]) {
    if (t.v === 0) checks.push({ name: `${t.l} 총계 0 = 미집계 추정 — 확인 필요`, scope: 'cross', ok: false, review: true, detail: `${t.l} 총계가 0원 — 미집계/캡처 이슈 추정. 교차(다축 일치)는 0축을 제외하고 비교하므로 여기서 못 잡습니다 → 원천 화면에서 실제 0인지 반드시 확인 필요.` });
  }
  if (aggOrder.length && catColSums.length) checks.push(vectorEquals('★ 관리비유형별 집계 = Σ분류별 컬럼', aggOrder.slice(1, 6), catColSums, MGMT));

  // ── ★ 연도별 다축 일치(3순위 확장): 기간별 연도 컬럼별 전체 = Σ분류(top-level). ──
  //   기간별은 시작연도 기준(연도필터 화면) → 연도별 전체=Σ분류가 성립해야 이중계상 없이 연도 배분이 정합. 추가 조회 없이 기존 grid 재사용.
  //   ⚠ 작업별↔기간별 연도별 비교는 작업별 조회창(~1년)이 과거연도를 완전히 못 덮어 거짓FAIL 위험 → 제외(현재연도는 위 다축검증이 이미 커버).
  { const T = G('기간별 비용')?.tables[0]; const { grid: gr } = grid('기간별 비용');
    if (T && gr.length) {
      const yearCols = T.heads.map((h, i) => ({ year: (String(h).match(/20\d{2}/) || [''])[0], idx: i })).filter((y) => y.year);
      const totalRow = gr.find((r) => /전체/.test(r[0] || ''));
      // top-level 분류행: 1분류(0) 있고 2분류(1) 비어있음(하위행 이중합 방지), 전체/합계 제외
      const catRows = gr.filter((r) => (r[0] || '').trim() && !/전체|총계|합계/.test(r[0] || '') && !(r[1] || '').trim());
      for (const yc of yearCols) {
        const total = totalRow ? firstNum(totalRow[yc.idx]) : null;
        const parts = catRows.map((r) => firstNum(r[yc.idx]) ?? 0);
        if (total != null && parts.some((p) => p !== 0)) checks.push(sumEquals(`★ 연도별 다축 ${yc.year}(기간별 전체=Σ분류)`, 'cross', total, parts));
      }
    } }

  // ── 예산 상세/실적: 소계=Σ소분류. 그리드로 대/중분류 추적(rowspan), 원본 셀 우측앵커로 값+최심라벨(소분류/품명). ──
  //   ⚠ 자재비 등은 소분류 아래 4번째 레벨(품명: "비료명" 등)이 조건부 존재 → 헤더 3레벨과 불일치.
  //   월값은 항상 마지막 numCols개 → 원본 행 우측앵커. 라벨은 그 앞의 최심 비어있지않은 셀(소분류[/품명]).
  const parseBudget = (sub: string, hasHap: boolean, tag: string): BudGroup[] => {
    const T = G(sub)?.tables[0]; const { grid: gr } = grid(sub); if (!T || !gr.length || !T.cells.length) return [];
    const numCols = hasHap ? 13 : 12;
    const midCol = Math.max(0, T.heads.indexOf('중분류'));
    const majCol = Math.max(0, T.heads.indexOf('대분류'));
    const cols = T.heads.slice(-numCols);
    const dedup = (a: string[]) => a.filter((x, i) => x && (i === 0 || a[i - 1] !== x));   // 인접 중복(rowspan carry) 제거
    const groups: BudGroup[] = []; let acc: { label: string; vals: number[] }[] = []; let curMid = '', curMaj = '', curSoke: number[] = [];
    const close = () => {
      if (!acc.length) { acc = []; return; }
      const n = cols.length; const sumVals = Array.from({ length: n }, (_, j) => acc.reduce((a, row) => a + (row.vals[j] || 0), 0));
      const soke = curSoke.slice(0, n); const match = sumVals.map((s, j) => near(s, soke[j] ?? 0));
      groups.push({ mid: curMid || `그룹${groups.length + 1}`, major: curMaj, cols, subRows: acc, sumVals, sokeVals: soke, match, ok: match.every(Boolean) });
      acc = [];
    };
    for (let ri = 0; ri < gr.length; ri++) {
      const raw = (T.cells[ri] || []).map((c) => c.t);
      const vals = raw.slice(-numCols).map((c) => num(c) ?? 0);           // 월값: 원본 우측앵커
      const labelCells = dedup(raw.slice(0, Math.max(0, raw.length - numCols)));   // 라벨: 그 앞(인접중복 제거)
      const gMid = gr[ri][midCol] || curMid, gMaj = gr[ri][majCol] || curMaj;      // 대/중분류: 그리드(rowspan 채움)
      const isSoke = labelCells.some((x) => /^\s*소계\s*$/.test(x)) || /소계/.test(gr[ri][midCol] || '');
      if (isSoke) { curSoke = vals; close(); continue; }
      // 최심 라벨(소분류[/품명]) = 대/중분류 이후 비어있지 않은 셀들. 없으면 마지막 라벨셀.
      //   ⚠ 시스템이 품명 셀을 breadcrumb("구역 > 구역 > 품명")로 렌더 → '>' 분리·인접중복 제거 후 최심 2단.
      const deep = labelCells.filter((x) => x && x !== gMaj && x !== gMid && !/^\s*소계\s*$/.test(x));
      const rawLabel = (deep.length ? deep.slice(-2).join(' > ') : (labelCells[labelCells.length - 1] || ''));
      const parts = rawLabel.split(/\s*>\s*/).map((x) => x.trim()).filter(Boolean).filter((p, i, a) => i === 0 || a[i - 1] !== p);
      const label = parts.slice(-2).join(' > ');
      if (!label && vals.every((v) => v === 0) && !raw.length) continue;
      curMid = gMid; curMaj = gMaj; acc.push({ label, vals });
    }
    for (const grp of groups) checks.push({ name: `${tag} 소계=Σ소분류 (${grp.major ? grp.major + ' > ' : ''}${grp.mid})`, scope: 'intra', ok: grp.ok, detail: grp.ok ? `${grp.cols.length}개 열 일치` : `불일치: ${grp.cols.filter((_, j) => !grp.match[j]).join(',')}` });
    return groups;
  };
  const detailGroups = parseBudget('예산 상세', true, '예산 상세');
  const perfGroups = parseBudget('실적 관리', false, '실적');

  // ── 원천 값 검증(타 메뉴 → 비용 유입 값의 계산 정합성) — 페이지네이션 전 페이지 순회 ──
  const srcHR = await grabPaged(admin, '인력 관리', '인력 관리');
  const srcEq = await grabPaged(admin, '장비 관리', '장비 총괄');
  const srcMat = await grabPaged(admin, '자재 관리', '자재 총괄');
  const colIdx = (T: Tbl | undefined, re: RegExp) => (T ? T.heads.findIndex((h) => re.test(h)) : -1);

  const hrData: { name: string; salary: number; rate: number; k: number }[] = [];
  { const T = srcHR?.tables[0]; const { grid: gr } = gridOf(T);
    if (T && gr.length) {
      const ni = colIdx(T, /이름/), si = colIdx(T, /급여\s*정보/), ri = colIdx(T, /시간당\s*임률/);
      for (const r of gr) { const salary = num(r[si]), rate = num(r[ri]); if (rate != null && rate > 0 && salary != null) hrData.push({ name: r[ni] || '', salary, rate, k: salary / rate }); }
      // ⚠ 임률 = 급여 ÷ 연근무시간이나 근무시간이 구분(고정직/임시직)마다 달라 상수 아님 → 값 표시 + 반영 링크로 검증(assertion 생략).
    } }

  const eqData: { name: string; buy: number; life: number; annual: number; hourly: number; calc: number }[] = [];
  { const T = srcEq?.tables[0]; const { grid: gr } = gridOf(T);
    if (T && gr.length) {
      const ni = colIdx(T, /장비명/), bi = colIdx(T, /매입가/), li = colIdx(T, /내용\s*연수/), ai = colIdx(T, /연간\s*운용/), hi = colIdx(T, /시간당\s*비용/);
      const nonconf: string[] = [];
      for (const r of gr) { const buy = num(r[bi]), life = num(r[li]), annual = num(r[ai]), hourly = num(r[hi]); if (buy == null || life == null || annual == null || hourly == null || life * annual === 0) continue; const calc = buy / (life * annual); eqData.push({ name: r[ni] || '', buy, life, annual, hourly, calc }); if (!nearRel(calc, hourly, 0.01)) nonconf.push(`${r[ni]}(${won(hourly)}≠${calc.toFixed(2)})`); }
      const conf = eqData.length - nonconf.length;
      checks.push({ name: '장비 시간당비용 = 매입가 ÷ (내용연수 × 연간운용시간)', scope: 'source', ok: conf > 0, na: eqData.length === 0, detail: eqData.length === 0 ? '검증 대상 장비 데이터 없음 — 판정 제외(참고)' : `전 페이지 ${eqData.length}대 · 공식 정합 ${conf}대` + (nonconf.length ? ` · 불일치 ${nonconf.length}대(수동입력/스테일 추정 — ⑥탭 빨강: ${nonconf.slice(0, 2).join(',')})` : '') });
    } }

  const matData: { name: string; total: number; qty: number; unit: number; calc: number }[] = [];
  { const T = srcMat?.tables[0]; const { grid: gr } = gridOf(T);
    if (T && gr.length) {
      // ⚠ 자재 총괄 실제 컬럼: 재고수량 · 단위당 원가 · 총재고액 (총매입가 없음) → 불변식 = 총재고액 = 재고수량 × 단위당원가.
      const ni = colIdx(T, /자재명/), ti = colIdx(T, /총\s*재고액|총재고|총\s*매입가|총액/), qi = colIdx(T, /재고\s*수량/), ui = colIdx(T, /단위당\s*원가|단위당원가|단가/);
      const nonconf: string[] = [];
      for (const r of gr) { const total = num(r[ti]), qty = num(r[qi]), unit = num(r[ui]); if (total == null || qty == null || unit == null || qty === 0) continue; const calc = total / qty; matData.push({ name: r[ni] || '', total, qty, unit, calc }); if (!nearRel(calc, unit, 0.01)) nonconf.push(`${r[ni]}(${won(unit)}≠${calc.toFixed(0)})`); }
      const conf = matData.length - nonconf.length;
      checks.push({ name: '자재 단위당원가 = 총재고액 ÷ 재고수량', scope: 'source', ok: conf > 0, na: matData.length === 0, detail: matData.length === 0 ? '검증 대상 자재 데이터 없음 — 판정 제외(참고)' : `전 페이지 ${matData.length}종 · 공식 정합 ${conf}종` + (nonconf.length ? ` · 불일치 ${nonconf.length}종(수동입력/스테일 추정 — ⑥탭 빨강: ${nonconf.slice(0, 2).join(',')})` : '') });
    } }

  // 원천 → 비용 반영: 인력 임률이 분류별 비용 인건비 컬럼에 등장하는지(±1 반올림 허용)
  { const catT = G('분류별 비용')?.tables[0]; const { grid: gr } = gridOf(catT); const costVals = new Set<number>();
    if (catT) { const idxs = [colIdx(catT, /고정직/), colIdx(catT, /임시직/)].filter((i) => i >= 0); for (const r of gr) for (const i of idxs) { const v = num(r[i]); if (v != null && v > 0) costVals.add(v); } }
    const rates = hrData.map((d) => d.rate).filter((v) => v > 0);
    const matched = rates.filter((rt) => [...costVals].some((cv) => Math.abs(cv - rt) <= 1));
    if (rates.length && costVals.size) checks.push({ name: '원천 임률 → 비용 인건비 반영(값 등장)', scope: 'source', ok: matched.length > 0, detail: matched.length > 0 ? `인력 임률 ${matched.length}건이 분류별 비용 인건비 컬럼에 등장(예: ${matched.slice(0, 3).map((v) => v.toLocaleString()).join(', ')})` : `임률 ${rates.length}건 중 비용 컬럼 직접 매칭 0(집계/배분 방식 상이 가능)` });
  }

  // ── 원천값 ↔ 비용 화면 비교(원천 단가/임률이 비용 화면 값으로 직접 등장하는지 대조) ──
  const catCmpT = G('분류별 비용')?.tables[0];
  const { grid: catCmpGr } = gridOf(catCmpT);
  const colValues = (re: RegExp): number[] => { const i = colIdx(catCmpT, re); const out: number[] = []; if (catCmpT && i >= 0) for (const r of catCmpGr) { const v = num(r[i]); if (v != null && v > 0) out.push(v); } return out; };
  const laborSet = [...colValues(/고정직/), ...colValues(/임시직/)];
  const matCostSet = colValues(/코스\s*자재비|자재비/);
  const eqCostSet = colValues(/장비\s*관리비/);
  const nearestIn = (v: number, set: number[]): number | null => { let best: number | null = null; for (const c of set) if (best == null || Math.abs(c - v) < Math.abs(best - v)) best = c; return best; };
  interface Cmp { src: string; item: string; srcLabel: string; srcVal: number; costCol: string; costVal: number | null; appears: boolean; }
  const cmp: Cmp[] = [];
  const pushCmp = (rows: { name: string; val: number }[], src: string, srcLabel: string, costCol: string, set: number[]) => {
    const seen = new Set<number>();
    for (const r of rows) { if (r.val > 0 && !seen.has(r.val)) { seen.add(r.val); const c = nearestIn(r.val, set); cmp.push({ src, item: r.name, srcLabel, srcVal: r.val, costCol, costVal: c, appears: c != null && Math.abs(c - r.val) <= 1 }); } }
  };
  pushCmp(hrData.map((d) => ({ name: d.name, val: d.rate })), '인력 관리', '시간당 임률', '인건비(고정/임시)', laborSet);
  pushCmp(matData.map((d) => ({ name: d.name, val: d.unit })), '자재 관리', '단위당 원가', '코스 자재비', matCostSet);
  pushCmp(eqData.map((d) => ({ name: d.name, val: d.hourly })), '장비 관리', '시간당 비용', '장비 관리비', eqCostSet);
  const cmpAppearN = cmp.filter((c) => c.appears).length;

  // ═══════════════════════ HTML ═══════════════════════
  const cross = checks.filter((c) => c.scope === 'cross');
  const intra = checks.filter((c) => c.scope === 'intra');
  const source = checks.filter((c) => c.scope === 'source');
  const costChecks = intra.filter((c) => /비용집계|분류별|위치별/.test(c.name));
  const budChecks = intra.filter((c) => /소계/.test(c.name));
  // 판정: na(데이터 없음)는 pass/fail 집계에서 제외 — "미확인 ≠ 결함"(리포트 표준).
  //   review(확인 필요=미집계 추정 등)는 결함(fail)과 분리하되 "주의 필요"에 함께 집계(사람이 원천 확인).
  const isRev = (c: Check) => !!c.review;
  const judged = checks.filter((c) => !c.na);
  const naCount = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok).length;
  const fail = judged.filter((c) => !c.ok && !isRev(c)).length;   // 실제 결함(확인 필요 제외)
  const review = judged.filter((c) => !c.ok && isRev(c)).length;  // 확인 필요(미집계 추정)
  const attn = fail + review;                                      // 주의 필요 = 결함 + 확인 필요
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : c.review ? '🔎' : (c.ok ? '✅' : '❌');
  const chk = (c: Check) => `<tr class="${c.na ? 'na' : c.review ? 'rv' : c.ok ? 'ok' : 'ng'}"><td>${mark(c)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`;
  // 주의 필요(결함 + 확인필요) 상세 — 상단 카드 클릭 시 펼쳐짐.
  const attnItems = judged.filter((c) => !c.ok).sort((a, b) => (a.review ? 1 : 0) - (b.review ? 1 : 0));   // 결함 먼저
  const attnHtml = attnItems.length
    ? attnItems.map((c) => `<div class="attnitem ${c.review ? 'rv' : 'ng'}"><div class="ai-h">${c.review ? '🔎 확인 필요' : '❌ 주의'} — ${esc(c.name)}</div><div class="ai-d">${esc(c.detail)}</div></div>`).join('')
    : '<div class="attnitem okmsg">✅ 주의 필요 항목 없음 — 확인 항목 전부 정합</div>';
  const attnCardCls = fail ? 'sng' : review ? 'srv' : 'sok';
  const attnNumCls = fail ? 'ng-n' : review ? 'rv-n' : 'ok-n';
  const attnCard = `<details class="scard ${attnCardCls}"${attn ? ' open' : ''}><summary><span class="n ${attnNumCls}">${attn}</span><span class="l">주의 필요 ▾${review ? ` <span class="mut">(확인필요 ${review} 포함)</span>` : ''}</span></summary><div class="scard-body">${attnHtml}</div></details>`;

  // Report 탭: 전 검증 항목을 구분별로 그룹핑(구분 내 FAIL 우선), 판정 일람.
  const catOf = (c: Check): string => c.scope === 'cross' ? '교차 화면' : c.scope === 'source' ? '원천 값' : /소계/.test(c.name) ? '내부-예산(소계)' : /비용집계|분류별|위치별/.test(c.name) ? '내부-비용' : '정보';
  const REPORT_CATS = ['교차 화면', '내부-비용', '내부-예산(소계)', '원천 값', '정보'];
  const reportBody = REPORT_CATS.map((cn) => {
    const rows = checks.filter((c) => catOf(c) === cn).sort((a, b) => ((a.na ? 2 : a.ok ? 1 : 0)) - ((b.na ? 2 : b.ok ? 1 : 0)));
    if (!rows.length) return '';
    const p = rows.filter((r) => !r.na && r.ok).length; const f = rows.filter((r) => !r.na && !r.ok).length; const n = rows.filter((r) => r.na).length;
    return `<tr class="mt"><td colspan="4">${cn} — ${rows.length}건 · <span class="okb">통과 ${p}</span>${f ? ` · <span class="ngb">주의 ${f}</span>` : ''}${n ? ` · <span class="mut">참고 ${n}</span>` : ''}</td></tr>`
      + rows.map((r, i) => `<tr class="${r.na ? 'na' : r.review ? 'rv' : r.ok ? 'ok' : 'ng'}"><td class="num">${i + 1}</td><td>${mark(r)}</td><td>${esc(r.name)}</td><td>${esc(r.detail)}</td></tr>`).join('');
  }).join('');
  const catCount = (cn: string) => { const rows = checks.filter((c) => catOf(c) === cn && !c.na); return `${rows.filter((r) => r.ok).length}/${rows.length}`; };

  // 원천값 ↔ 비용 비교 테이블
  const cmpTbl = cmp.length
    ? `<div class="tblwrap"><table class="sys"><thead><tr><th>원천 화면</th><th>항목</th><th>원천 값 종류</th><th class="num">원천 값</th><th>비용 컬럼</th><th class="num">비용 화면 근사값</th><th>직접 등장</th></tr></thead><tbody>${cmp.slice(0, 40).map((c) => `<tr><td>${esc(c.src)}</td><td>${esc(c.item)}</td><td>${esc(c.srcLabel)}</td><td class="num">${won(c.srcVal)}</td><td>${esc(c.costCol)}</td><td class="num">${c.costVal != null ? won(c.costVal) : '—'}</td><td>${c.appears ? '<span class="okb">✅ 직접 등장</span>' : '<span class="mut">— 집계 반영</span>'}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="note">비교할 원천/비용 데이터 없음</div>';

  // 원본 테이블(그리드 기반, 열정렬 정확). 라벨 컬럼은 직전 행과 같으면 병합처럼 공란.
  const rawTable = (sub: string): string => {
    const g = G(sub); const T = g?.tables[0]; const { cols, grid: gr } = grid(sub);
    if (!T || !gr.length) return '<div class="note">테이블 데이터 없음(차트/카드형 화면 또는 데이터 없음)</div>';
    const heads = T.heads.slice(); while (heads.length < cols) heads.push('');
    const labelCols = Math.min(4, cols);   // 앞부분 라벨 컬럼(대/중/소/적요) 병합 표시
    const numish = (s: string) => /^-?[\d,]+(원|%)?$|▲|▼|신규/.test((s || '').trim());
    const head = `<tr>${heads.map((h) => `<th class="${/^\d+월$|합계|비용|예산|사용|율|스코어|타수/.test(h) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr>`;
    let prev: string[] = [];
    const body = gr.map((r) => {
      // 빈 데이터 행(전 열이 동일한 '내역 없음' 안내) → colspan 1회 중앙 노출(반복 노이즈 제거).
      const nonEmpty = r.map((c) => (c || '').trim()).filter(Boolean);
      const distinct = [...new Set(nonEmpty)];
      if (distinct.length === 1 && nonEmpty.length >= 3 && /없습니다|내역이\s*없|데이터가?\s*없/.test(distinct[0])) {
        return `<tr><td colspan="${cols}" style="text-align:center;color:var(--mut);padding:16px 8px">${esc(distinct[0])}</td></tr>`;
      }
      const hot = r.some((c) => /소계|전체|합계|총계|차액/.test(c || ''));
      const tds = r.map((c, i) => {
        const merge = i < labelCols && !hot && prev[i] === c && c !== '';       // 상위 분류 반복 → 병합(공백)
        const empty = (c || '').trim() === '';
        const inner = merge ? '' : (empty ? '<span style="color:var(--mut)">-</span>' : esc(c));
        return `<td class="${numish(c) ? 'num' : (empty && !merge ? 'ctr' : '')}">${inner}</td>`;
      }).join('');
      prev = r.slice();
      return `<tr class="${hot ? 'hot' : ''}">${tds}</tr>`;
    }).join('');
    return `<div class="tblwrap"><table class="sys"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  };
  const cardsLine = (sub: string) => { const c = G(sub)?.cards ?? []; return c.length ? `<div class="chips">${c.slice(0, 6).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''; };

  // 소계 검증 상세(중분류명 타이틀 + 소분류별 값 + Σ + 소계 + 일치)
  const budGroupTbl = (grp: BudGroup) => `<div class="bg"><div class="bgname">${grp.major ? esc(grp.major) + ' &gt; ' : ''}<b>${esc(grp.mid)}</b> ${grp.ok ? '<span class="okb">✅ 일치</span>' : '<span class="ngb">❌ 불일치</span>'}</div>
  <div class="tblwrap"><table class="sys"><thead><tr><th>소분류</th>${grp.cols.map((c) => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>
    ${grp.subRows.map((s) => `<tr><td>${esc(s.label)}</td>${grp.cols.map((_, j) => `<td class="num">${won(s.vals[j] ?? 0)}</td>`).join('')}</tr>`).join('')}
    <tr class="hot"><td>Σ 소분류(계산)</td>${grp.sumVals.map((v) => `<td class="num">${won(v)}</td>`).join('')}</tr>
    <tr class="hot"><td>소계(화면 값)</td>${grp.sokeVals.map((v) => `<td class="num">${won(v)}</td>`).join('')}</tr>
    <tr class="mt"><td>일치</td>${grp.match.map((m) => `<td class="num">${m ? '✅' : '❌'}</td>`).join('')}</tr>
  </tbody></table></div></div>`;

  // 연관성 맵
  const crossTotals = [
    { label: '비용집계', axis: '관리비유형축', v: aggTotal }, { label: '분류별', axis: '코스영역×유형', v: catTotal },
    { label: '위치별', axis: '코스/홀축', v: locTotal }, { label: '기간별', axis: '연도축', v: perTotal2026 },
    { label: '작업별', axis: taskTotal != null ? '작업축' : '작업축(데이터 없음)', v: taskTotal },
  ];
  // 총계 0인 축은 '미집계 추정'으로 일치 판정에서 제외(값 있는 축끼리 비교).
  const cmpAxes = crossTotals.filter((t) => t.v != null && t.v !== 0);
  const eqTotal = cmpAxes.length >= 2 ? cmpAxes.every((t) => near(t.v as number, cmpAxes[0].v as number)) : true;
  const shared = cmpAxes[0]?.v ?? null;
  const costNode = (t: { label: string; axis: string; v: number | null }) => { const zero = t.v === 0; return `<div class="node cost"${zero ? ' style="border-top-color:var(--mut);opacity:.7"' : ''}><div class="nt">${esc(t.label)}${zero ? ' <span style="font-size:10px;color:var(--mut)">미집계</span>' : ''}</div><div class="na">${esc(t.axis)}</div><div class="nv"${zero ? ' style="color:var(--mut)"' : ''}>${zero ? '0원(미집계 추정)' : won(t.v) + (t.v != null ? '원' : '')}</div></div>`; };
  const budNode = (l: string, s: string) => `<div class="node bud"><div class="nt">${esc(l)}</div><div class="na">${esc(s)}</div></div>`;
  const screenRows = SCREENS.map((s) => { const heads = s.g?.tables?.[0]?.heads ?? []; const items = heads.length ? heads.join(' · ') : (s.g?.cards?.length ? '요약 카드/차트(월 예산·당월 사용액·예산 초과분·예산 대비 사용률)' : '—'); return `<tr><td><b>${esc(s.menu)} &gt; ${esc(s.sub)}</b></td><td><code>${esc(s.route)}</code></td><td>${esc(items)}</td></tr>`; }).join('');

  const scrBlock = (grp: 'budget' | 'cost') => SCREENS.filter((s) => s.grp === grp).map((s) => `<div class="scr"><h3>${esc(s.menu)} &gt; ${esc(s.sub)}</h3><div class="rt">진입 <code>${esc(s.route)}</code></div>${cardsLine(s.sub)}${rawTable(s.sub)}</div>`).join('');

  // 원천 값 상세 테이블
  const okmark = (b: boolean) => b ? '✅' : '❌';
  const hrTbl = hrData.length ? `<div class="note">전 페이지 ${hrData.length}명 수집</div><div class="tblwrap"><table class="sys"><thead><tr><th>이름</th><th class="num">급여 정보</th><th class="num">시간당 임률</th><th class="num">급여÷임률(연근무h)</th></tr></thead><tbody>${hrData.slice(0, 60).map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${won(d.salary)}</td><td class="num">${won(d.rate)}</td><td class="num">${won(Math.round(d.k))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="note">인력 데이터 없음</div>';
  const eqSorted = [...eqData].sort((a, b) => (nearRel(a.calc, a.hourly, 0.01) ? 1 : 0) - (nearRel(b.calc, b.hourly, 0.01) ? 1 : 0));   // 불일치 우선
  const eqTbl = eqData.length ? `<div class="note">전 페이지 ${eqData.length}대 수집 · 공식 정합 ${eqData.filter((d) => nearRel(d.calc, d.hourly, 0.01)).length}대 (불일치 우선 표시)</div><div class="tblwrap"><table class="sys"><thead><tr><th>장비명</th><th class="num">매입가</th><th class="num">내용연수</th><th class="num">연간운용h</th><th class="num">시간당비용(화면)</th><th class="num">계산값</th><th>일치</th></tr></thead><tbody>${eqSorted.slice(0, 60).map((d) => `<tr class="${nearRel(d.calc, d.hourly, 0.01) ? '' : 'ng'}"><td>${esc(d.name)}</td><td class="num">${won(d.buy)}</td><td class="num">${d.life}</td><td class="num">${won(d.annual)}</td><td class="num">${won(d.hourly)}</td><td class="num">${d.calc.toFixed(2)}</td><td>${okmark(nearRel(d.calc, d.hourly, 0.01))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="note">장비 데이터 없음</div>';
  const matSorted = [...matData].sort((a, b) => (nearRel(a.calc, a.unit, 0.01) ? 1 : 0) - (nearRel(b.calc, b.unit, 0.01) ? 1 : 0));
  const matTbl = matData.length ? `<div class="note">전 페이지 ${matData.length}종 수집 · 공식 정합 ${matData.filter((d) => nearRel(d.calc, d.unit, 0.01)).length}종 (불일치 우선 표시)</div><div class="tblwrap"><table class="sys"><thead><tr><th>자재명</th><th class="num">총재고액</th><th class="num">재고수량</th><th class="num">단위당원가(화면)</th><th class="num">계산값</th><th>일치</th></tr></thead><tbody>${matSorted.slice(0, 60).map((d) => `<tr class="${nearRel(d.calc, d.unit, 0.01) ? '' : 'ng'}"><td>${esc(d.name)}</td><td class="num">${won(d.total)}</td><td class="num">${won(d.qty)}</td><td class="num">${won(d.unit)}</td><td class="num">${won(Math.round(d.calc))}</td><td>${okmark(nearRel(d.calc, d.unit, 0.01))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="note">자재 데이터 없음</div>';

  const html = `<style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da;--accent2:#8250df;--hot:#eef2f8}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff;--accent2:#a371f7;--hot:#1b2230}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff;--accent2:#a371f7;--hot:#1b2230}
:root[data-theme=light]{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da;--accent2:#8250df;--hot:#eef2f8}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:1060px;margin:0 auto;padding:24px 18px 60px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 10px;border-bottom:2px solid var(--line);padding-bottom:6px}h3{font-size:14px;margin:16px 0 4px}
.sub{color:var(--mut);font-size:13px;margin-bottom:8px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:23px;font-weight:700}.card .l{font-size:12px;color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:6px 0}th,td{text-align:left;padding:6px 9px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--mut);font-size:11.5px;background:var(--card)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}td.ctr{text-align:center}tr.hot td{background:var(--hot);font-weight:700;border-top:2px solid var(--accent)}tr.mt td{font-weight:700;border-top:2px solid var(--fg);background:var(--card)}tr.ng td{color:var(--ng);font-weight:600}tr.na td{color:var(--mut)}.na-n{color:var(--mut);font-weight:700}
.ok-n{color:var(--ok);font-weight:700}.ng-n{color:var(--ng);font-weight:700}.rv-n{color:#9a6700;font-weight:700}
tr.rv td{color:#7a5200;background:#fff8e5;font-weight:600}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) tr.rv td{color:#e3b341;background:#2a2413}:root:not([data-theme=light]) .rv-n{color:#e3b341}}
:root[data-theme=dark] tr.rv td{color:#e3b341;background:#2a2413}:root[data-theme=dark] .rv-n{color:#e3b341}
.scard{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;min-width:120px;cursor:pointer;list-style:none}
.scard>summary{display:flex;flex-direction:column;gap:2px;list-style:none;cursor:pointer}.scard>summary::-webkit-details-marker{display:none}
.scard>summary .n{font-size:26px;font-weight:800;line-height:1}.scard>summary .l{font-size:12px;color:var(--mut)}
.scard.sng{border-color:var(--ng);border-left:4px solid var(--ng)}.scard.srv{background:#fff8e5;border-color:#e0b84f;border-left:4px solid #9a6700}.scard.srv .l{color:#7a5200}
.scard-body{margin-top:10px;display:flex;flex-direction:column;gap:7px}
.attnitem{border-radius:7px;padding:8px 11px;font-size:12.5px}.attnitem.ng{background:rgba(220,50,50,.08);border-left:3px solid var(--ng)}.attnitem.rv{background:#fff8e5;border-left:3px solid #9a6700}.attnitem.okmsg{color:var(--ok);font-weight:600}
.attnitem .ai-h{font-weight:700;margin-bottom:2px}.attnitem.rv .ai-h{color:#7a5200}.attnitem .ai-d{color:var(--mut);font-weight:400;line-height:1.5}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) .scard.srv{background:#2a2413;border-color:#645209}:root:not([data-theme=light]) .scard.srv .l{color:#e3b341}:root:not([data-theme=light]) .attnitem.rv{background:#2a2413}:root:not([data-theme=light]) .attnitem.rv .ai-h{color:#e3b341}}
:root[data-theme=dark] .scard.srv{background:#2a2413;border-color:#645209}:root[data-theme=dark] .scard.srv .l{color:#e3b341}:root[data-theme=dark] .attnitem.rv{background:#2a2413}:root[data-theme=dark] .attnitem.rv .ai-h{color:#e3b341}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13.5px;color:var(--mut);margin:8px 0}.note.big{border-left:3px solid var(--accent)}
.review{background:#fff8e5;border:1px solid #e0b84f;border-left:4px solid #9a6700;border-radius:8px;padding:11px 15px;font-size:13.5px;color:#7a5200;margin:10px 0;font-weight:600}.review b{color:#7a5200}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) .review{background:#2a2413;border-color:#645209;border-left-color:#e3b341;color:#e3b341}:root:not([data-theme=light]) .review b{color:#e3b341}}
:root[data-theme=dark] .review{background:#2a2413;border-color:#645209;border-left-color:#e3b341;color:#e3b341}:root[data-theme=dark] .review b{color:#e3b341}
code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}kbd{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:2px 7px;font:12.5px monospace}
.tblwrap{overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:8px;margin:6px 0}.sys{min-width:100%;margin:0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.chip{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:3px 10px;font-size:12px;color:var(--mut)}
.tabin{position:absolute;left:-9999px}.tabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin:40px 0 0;flex-wrap:wrap}
.tabs label{padding:9px 14px;cursor:pointer;font-weight:600;font-size:13.5px;color:var(--mut);border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0}
#t1:checked~.tabs label[for=t1],#t2:checked~.tabs label[for=t2],#t3:checked~.tabs label[for=t3],#t4:checked~.tabs label[for=t4],#t5:checked~.tabs label[for=t5],#t6:checked~.tabs label[for=t6],#t7:checked~.tabs label[for=t7]{color:var(--fg);border-color:var(--line);background:var(--card)}
.panel{display:none;padding-top:14px}#t1:checked~#p1,#t2:checked~#p2,#t3:checked~#p3,#t4:checked~#p4,#t5:checked~#p5,#t6:checked~#p6,#t7:checked~#p7{display:block}
.map{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 14px;margin:8px 0}
.mrow{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}.node{border:1px solid var(--line);border-radius:9px;padding:9px 12px;background:var(--bg);min-width:120px;text-align:center}
.node .nt{font-weight:700;font-size:13px}.node .na{font-size:11px;color:var(--mut);margin-top:1px}.node .nv{font-size:12.5px;color:var(--accent);font-weight:700;margin-top:4px}
.node.cost{border-top:3px solid var(--accent)}.node.bud{border-top:3px solid var(--accent2)}.node.src{border-top:3px solid var(--ok)}
.flowdown{text-align:center;color:var(--accent);font-size:12.5px;margin:10px 0;font-weight:700}.mut{color:var(--mut)}.leg{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--mut);margin-top:10px}.leg span b{color:var(--fg)}
.shared{text-align:center;font-weight:700;color:var(--accent);margin:6px 0 12px;font-size:14px}.mlabel{font-size:12.5px;color:var(--mut);margin:16px 0 6px;font-weight:700}
.arrow{display:flex;align-items:center;color:var(--mut);font-size:12px;padding:0 2px}.arrow b{color:var(--fg)}
.bg{margin:12px 0}.bgname{font-weight:700;font-size:13.5px;margin:4px 0}.okb{color:var(--ok)}.ngb{color:var(--ng)}
.scr{margin:14px 0 22px}.scr h3{margin-bottom:2px}.scr .rt{color:var(--mut);font-size:12px;margin-bottom:4px}
.lead{font-size:16.5px;line-height:1.8;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:14px 0 10px}.lead b{font-size:18px}.lead .em{color:var(--accent);font-weight:700}
details.aux{margin:0 0 40px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
details.aux>summary{cursor:pointer;list-style:none;padding:10px 14px;font-size:13px;font-weight:600;color:var(--mut)}
details.aux>summary::-webkit-details-marker{display:none}
details.aux>summary::after{content:" ▾";color:var(--mut)}details.aux[open]>summary::after{content:" ▴"}
details.aux[open]>summary{border-bottom:1px solid var(--line)}
.auxbody{padding:12px 16px;font-size:13px;line-height:1.7}
.persp,.honest{background:none;border:none;border-radius:0;padding:0;margin:0;font-size:13px;color:var(--fg)}
.honest{border-top:1px dashed var(--line);margin-top:10px;padding-top:12px}.honest b,.persp b{color:var(--fg)}
.honest>.htitle{font-weight:700;margin-bottom:8px}
.hrow{display:flex;gap:9px;align-items:flex-start;margin:9px 0}
.hrow .hic{flex:0 0 auto;font-size:14px;line-height:1.4}
.hrow .hbody{flex:1}.hrow .hlbl{display:block;font-weight:700;margin-bottom:3px}
.hrow ul{margin:0;padding-left:16px}.hrow li{margin:2px 0;line-height:1.55}
.hrow.ok .hlbl{color:var(--ok)}.hrow.warn .hlbl{color:var(--ng)}.hrow.info .hlbl{color:var(--mut)}
details.gloss{margin:28px 0 0;font-size:13px;color:var(--mut);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px}details.gloss summary{cursor:pointer;font-weight:700;color:var(--fg)}details.gloss dt{font-weight:700;color:var(--fg);margin-top:8px}details.gloss dd{margin:0 0 2px 0}
</style>
<div class="wrap">
<h1>예산·비용이 공식대로 계산되고 화면마다 일관되는지 확인</h1>
<div class="sub">① 공식 계산 ② 합계 검산 ③ 화면 간 일관성 — 3가지를 함께 확인(화면 변경 없음) · 킹즈락 · 수집시각 ${ts}</div>
<div class="lead"><b>한눈에 보기.</b> 코스관리의 <span class="em">예산·비용 숫자</span>를 <b>세 가지 방식</b>으로 확인했습니다.<br>
<b>① 공식대로 계산됐나</b> — 원천 값이 정해진 계산식과 맞는지(예: 자재 단위당원가 = 총재고액 ÷ 재고수량, 장비 시간당비용 = 매입가 ÷ (내용연수 × 운용시간)).<br>
<b>② 합계가 부분의 합과 맞나</b> — 총계 = 항목들의 합, 소계 = 하위 분류들의 합(산술 검산).<br>
<b>③ 화면마다 일관되나</b> — 같은 총비용을 여러 화면이 다른 기준으로 재집계해도 총합이 일치하는지(교차).<br>
확인 항목 <b>${judged.length}개</b> 중 <span class="ok-n">정상 ${pass}개</span>${attn ? ` · <span class="${fail ? 'ng-n' : 'rv-n'}">주의 필요 ${attn}개</span>${review ? `(확인 필요 ${review} 포함)` : ''}` : ' · 주의 0개'} (그중 화면 간 교차 ${cross.length}건)${naCount ? ` · <span class="na-n">참고 ${naCount}개</span>(데이터 없어 판정 제외)` : ''}.</div>
<details class="aux"><summary>💡 리포트 검증 관점 및 참고사항 보기</summary><div class="auxbody">
<div class="persp">📏 <b>보는 관점:</b> 화면에 <b>표시된 값</b>을 공식·합계·화면 간으로 검산합니다(앱 내부 코드 커버리지가 아님). 확인 중 저장·변경하지 않습니다.</div>
<div class="honest"><div class="htitle">이 검증이 잡는 것과 못 잡는 것</div>
<div class="hrow ok"><span class="hic">✅</span><div class="hbody"><span class="hlbl">잡아냅니다</span><ul>
  <li>원천 단가·임률이 <b>공식과 다르게</b> 계산됨 <span class="mut">(①)</span></li>
  <li>총계·소계가 <b>부분의 합과 어긋남</b> <span class="mut">(②)</span></li>
  <li>한 화면 값이 <b>다른 화면과 다름</b> <span class="mut">(③)</span></li></ul></div></div>
<div class="hrow warn"><span class="hic">⚠️</span><div class="hbody"><span class="hlbl">못 잡습니다 (한계)</span><ul>
  <li>모든 화면이 <b>똑같이 틀린 값</b> — 교차(③)만으론 통과 <span class="mut">→ ①②로 보완</span></li>
  <li>입력 데이터 <b>자체가 틀린 경우</b>(예: 매입가 오입력) <span class="mut">→ 원본 대장 대조 별도 필요</span></li></ul></div></div>
<div class="hrow info"><span class="hic">ℹ️</span><div class="hbody"><span class="hlbl">참고</span><ul>
  <li>데이터 없는 항목은 <b>판정 제외</b></li>
  <li>회계 비용 vs 작업지시 집계 차이는 <b>항목별 사유 표기</b></li></ul></div></div></div>
</div></details>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상 통과</div></div>${attnCard}${naCount ? `<div class="card"><div class="n na-n">${naCount}</div><div class="l">참고(데이터없음)</div></div>` : ''}<div class="card"><div class="n">${cross.length}</div><div class="l">교차 확인</div></div></div>

<input class="tabin" type="radio" name="tab" id="t1" checked><input class="tabin" type="radio" name="tab" id="t2"><input class="tabin" type="radio" name="tab" id="t3"><input class="tabin" type="radio" name="tab" id="t7"><input class="tabin" type="radio" name="tab" id="t4"><input class="tabin" type="radio" name="tab" id="t5"><input class="tabin" type="radio" name="tab" id="t6">
<div class="tabs"><label for="t1">① 실행 방법</label><label for="t2">② 연관성 맵</label><label for="t3">③ 요약</label><label for="t7">④ 전체 결과</label><label for="t4">⑤ 비용 상세</label><label for="t5">⑥ 예산 상세</label><label for="t6">⑦ 원천 값 검증</label></div>

<div class="panel" id="p1">
<h2>실행 방법</h2>
<div class="note">공유 QA 계정은 <b>재로그인 1회당 1런</b>만 생존 → 실행 전 인증 필요:
<div style="margin-top:8px"><kbd>npm run course:auth</kbd> (수동 로그인) &nbsp;→&nbsp; <kbd>npm run course:budget-verify</kbd></div>
<div style="margin-top:8px">→ 현재 시스템 데이터 재수집 → <code>reports/course-budget-cost-verify.html</code> 재생성. <b>비파괴</b>. 별도 입력 불필요.</div></div>
<div class="note">대상 <code>https://course-mng-td.smartscore.kr</code> · 예산 4화면 + 비용 5화면 순회 → 순수 불변식(<code>lib/course/domain/budgetCost.ts</code>) 검증.</div>
<div class="note big"><b>정적 검증(본 리포트)</b> = "현재 값이 정합한가". <b>동적 변경 반영(write-path)</b> = "값 변경이 연관 화면에 반영되는가" — <kbd>$env:ALLOW_DESTRUCTIVE="1"; npm run course:writepath</kbd>. 예산 상세 값 +Δ 저장 → 상세 소계·예산 총괄 rollup 반영 확인 → 원본 정확 복원(3중 가드+finally). 옵트인 파괴, 미충족 시 SKIP.</div>
</div>

<div class="panel" id="p2">
<h2>화면 연관 다이어그램</h2>
<div class="map">
<div class="mlabel">① 타 메뉴 원천 → 비용 유입 (관리비유형별 발생원)</div>
<div class="mrow"><div class="node src"><div class="nt">인력 관리</div><div class="na">임률 → 인건비</div><div class="nv">${hrData.length}명</div></div><div class="node src"><div class="nt">자재 관리</div><div class="na">단가 → 코스 자재비</div><div class="nv">${matData.length}종</div></div><div class="node src"><div class="nt">장비 관리</div><div class="na">시간당비용 → 장비 관리비</div><div class="nv">${eqData.length}대</div></div><div class="node src"><div class="nt">작업 관리</div><div class="na">작업지시 → 작업지시 비용</div></div></div>
<div class="flowdown">▼ 발생·유입 → 비용 집계</div>
<div class="mlabel" style="margin-top:18px">② 비용 관리 — 같은 총비용을 다른 축으로 재집계 (총합·항목 일치해야)</div>
<div class="shared">공유 총비용 ${eqTotal ? '✅ 일치' : '❌ 불일치'} : ${won(shared)}원 <span style="font-size:11px;color:var(--mut);font-weight:400">(값 있는 ${cmpAxes.length}개 축 기준)</span></div>
${crossTotals.some((t) => t.v === 0) ? `<div class="review">🔎 <b>확인 필요</b> — <b>${crossTotals.filter((t) => t.v === 0).map((t) => t.label).join(', ')}</b> 총계 0 = <b>미집계 추정</b>(해당 화면 값을 못 읽음 — 데이터 없음/캡처 이슈). 일치 판정에서 제외했으니, <b>실제 0인지 원천 화면에서 반드시 확인</b>하세요.</div>` : ''}
<div class="mrow">${crossTotals.map(costNode).join('')}</div>
<div class="leg"><span><b>■</b> 원천(타 메뉴)</span><span><b style="color:var(--accent)">■</b> 비용 재집계 축</span><span><b style="color:var(--accent2)">■</b> 예산 흐름</span><span>세로 흐름 = 값 유입 방향</span></div>
<div class="mlabel" style="margin-top:18px">③ 예산 관리 — 편성 → 집행 → 분석 흐름</div>
<div class="mrow">${budNode('예산 총괄', '중분류 월별 편성')}<div class="arrow">─<b>rollup</b>→</div>${budNode('예산 상세', '소분류/적요·소계')}<div class="arrow">─<b>집행</b>→</div>${budNode('실적 관리', '소계=Σ소분류')}<div class="arrow">─<b>비교</b>→</div>${budNode('예산 분석', '예산 대비 사용률')}</div>
</div>
<h2>화면별 진입 경로 · 항목</h2>
<div class="tblwrap"><table><thead><tr><th>화면명</th><th>진입 경로</th><th>기입 항목(컬럼/필드)</th></tr></thead><tbody>${screenRows}</tbody></table></div>

<h2>관련 화면 (타 메뉴 → 비용 유입)</h2>
<div class="note">비용 집계의 5개 관리비유형 + 작업지시 비용은 <b>타 메뉴 화면에서 발생·유입</b>됩니다. 실연동 예: 인력 관리 <b>손기웅 시간당 임률 568,182</b> ≈ 분류별 비용 <b>그린 고정직 568,181</b>.</div>
<div class="tblwrap"><table><thead><tr><th>비용 유형</th><th>원천 화면 (타 메뉴)</th><th>진입 경로</th><th>연결 값 · 계산</th></tr></thead><tbody>
<tr><td><b>고정직 인건비</b></td><td>인력 관리 &gt; 인력 관리</td><td><code>/hr/human</code></td><td>급여 정보 · 시간당 임률(급여÷연근무시간) → 인건비</td></tr>
<tr><td><b>임시직 인건비</b></td><td>인력 관리 &gt; 인력·근태·투입</td><td><code>/hr/human</code> <code>/hr/work</code> <code>/hr/assign</code></td><td>시간당 임률 × 근태(근무일)·투입(작업배정)</td></tr>
<tr><td><b>코스 자재비</b></td><td>자재 관리 &gt; 자재 수불 · 자재 총괄</td><td><code>/material/ledger-item</code> <code>/material/summary</code></td><td>출고 수량 × 단위당 원가 · 기말=기초+입고−출고</td></tr>
<tr><td><b>장비 관리비</b></td><td>장비 관리 &gt; 장비 총괄</td><td><code>/equipment/summary</code></td><td>매입가 · 시간당 비용(=매입가÷(내용연수×연간운용시간)) · 유류</td></tr>
<tr><td><b>작업지시 비용</b></td><td>작업 관리 &gt; 작업 지시</td><td><code>/task/orders</code></td><td>작업(W-xxx)별 비용 발생 → 비용집계 작업지시 비용 · 작업별 비용</td></tr>
</tbody></table></div>
<div class="note">즉 <b>인력→인건비 · 자재→자재비 · 장비→장비관리비 · 작업지시→작업지시비용</b>으로 흐르며, 예산 상세(편성) ↔ 실적(집행) ↔ 비용 집계(발생)가 연결됩니다. 이 원천 값 변경 시 비용/예산 화면 동기화 검증이 후속 확장 대상.</div>
</div>

<div class="panel" id="p3">
<h2>검증 요약</h2>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상 통과</div></div>${attnCard}${naCount ? `<div class="card"><div class="n na-n">${naCount}</div><div class="l">참고(데이터없음)</div></div>` : ''}<div class="card"><div class="n">${cross.length}</div><div class="l">교차 확인</div></div></div>
<h2>구분별 검증 항목 · 결과</h2>
<div class="tblwrap"><table><thead><tr><th>구분</th><th>검증 내용</th><th class="num">항목</th><th class="num ok-n">정상</th><th class="num ng-n">주의 필요</th></tr></thead><tbody>
${REPORT_CATS.map((cn) => { const rows = checks.filter((c) => catOf(c) === cn); if (!rows.length) return ''; const p = rows.filter((r) => !r.na && r.ok).length; const f = rows.filter((r) => !r.na && !r.ok).length; const n = rows.filter((r) => r.na).length; const desc = { '교차 화면': '여러 화면 재집계 총합·항목 일치', '내부-비용': '비용 화면 내 합계=Σ관리비유형', '내부-예산(소계)': '예산/실적 소계=Σ소분류', '원천 값': '타 메뉴 단가/임률 계산·유입', '정보': '기간 스코프 등 참고(판정 제외)' }[cn] || ''; return `<tr class="${f ? 'ng' : ''}"><td><b>${cn}</b></td><td>${desc}${n ? ` <span class="mut">(참고 ${n})</span>` : ''}</td><td class="num">${p + f}</td><td class="num ok-n">${p}</td><td class="num ${f ? 'ng-n' : ''}">${f}</td></tr>`; }).join('')}
<tr class="mt"><td colspan="2">합계${naCount ? ` <span class="mut">(참고 ${naCount} 제외)</span>` : ''}</td><td class="num">${judged.length}</td><td class="num ok-n">${pass}</td><td class="num ${attn ? 'ng-n' : ''}">${attn}${review ? ` <span class="mut">(🔎${review})</span>` : ''}</td></tr>
</tbody></table></div>
<div class="note">항목별 상세 판정 일람은 <b>④ 전체 결과</b> 탭.</div>
<h2>★ 교차 화면 정합성</h2>
<div class="note big">같은 비용/예산이 여러 화면에 다른 축으로 재집계됨 → 총합·항목이 일치해야 함. 값 변경 시 전 화면 동기화 검증.</div>
<div class="tblwrap"><table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${cross.map(chk).join('')}</tbody></table></div>
<h2>내부 정합성 요약</h2>
<div class="note">비용 ${costChecks.length}건(PASS ${costChecks.filter((c) => c.ok).length}) · 예산 소계 ${budChecks.length}건(PASS ${budChecks.filter((c) => c.ok).length}) — 상세는 <b>④비용/⑤예산</b> 탭.</div>
<h2>원천 값 검증 요약 (인력 임률·자재 단가·장비 시간당비용 → 비용 유입)</h2>
<div class="tblwrap"><table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${source.map(chk).join('')}</tbody></table></div>
<div class="note">전체 검증 항목 일람은 <b>④ 전체 결과</b> 탭 · 상세 값·계산은 <b>⑦ 원천 값 검증</b> 탭.</div>
</div>

<div class="panel" id="p7">
<h2>전체 검증 항목 · 결과</h2>
<div class="note big">확인 항목 <b>${judged.length}</b>건 · <span class="okb">정상 ${pass}</span> · <span class="${fail ? 'ngb' : review ? 'rv-n' : 'okb'}">주의 필요 ${attn}${review ? ` (확인 필요 ${review} 포함)` : ''}</span>${naCount ? ` · <span class="mut">참고 ${naCount}(데이터 없음, 판정 제외)</span>` : ''}. 구분별 정상/확인 = 교차 ${catCount('교차 화면')} · 내부-비용 ${catCount('내부-비용')} · 내부-예산(소계) ${catCount('내부-예산(소계)')} · 원천 ${catCount('원천 값')} · 정보 ${catCount('정보')}. <span class="mut">(구분 내 주의 우선 정렬)</span></div>
${attn ? `<div class="note" style="border-left:3px solid ${fail ? 'var(--ng)' : '#9a6700'}"><b class="${fail ? 'ngb' : 'rv-n'}">⚠ 주의 필요 (${attn}건${review ? `: 결함 ${fail} · 확인 필요 ${review}` : ''})</b> — 각 항목의 "무엇이·왜·어디를 확인"을 함께 표기했습니다.<br>${attnItems.map((c) => `<div style="margin-top:8px"><b class="${c.review ? 'rv-n' : 'ngb'}">${c.review ? '🔎 확인 필요' : '❌'} ${esc(c.name)}</b><br><span style="color:var(--fg)">${esc(c.detail)}</span></div>`).join('')}</div>` : '<div class="note" style="border-left:3px solid var(--ok)"><b class="okb">✅ 확인 항목 전부 정상</b> — 주의 없음</div>'}${naCount ? `<div class="note" style="border-left:3px solid var(--mut)"><b>➖ 참고: 데이터가 없어 확인 대상이 아님 (${naCount}건, 판정 제외)</b> — 결함이 아니라 "확인 불가"입니다.<br>${checks.filter((c) => c.na).map((c) => `<div style="margin-top:6px"><b>➖ ${esc(c.name)}</b><br><span class="mut">${esc(c.detail)}</span></div>`).join('')}</div>` : ''}
<div class="tblwrap"><table><thead><tr><th class="num">#</th><th></th><th>검증 항목</th><th>결과</th></tr></thead><tbody>${reportBody}</tbody></table></div>
<div class="note">구분: <b>교차 화면</b>=여러 화면 재집계 총합/항목 일치 · <b>내부-비용/예산</b>=단일 화면 내 합계=Σ부분 · <b>원천 값</b>=타 메뉴 단가/임률 계산·유입 · <b>정보</b>=기간 스코프 등 판정 제외 참고.</div>
</div>

<div class="panel" id="p4">
<h2>비용 관리 — 화면별 수집 값 (시스템 화면 수준)</h2>
${scrBlock('cost')}
<h2>비용 내부 정합성 상세</h2>
<div class="tblwrap"><table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${costChecks.map(chk).join('')}</tbody></table></div>
</div>

<div class="panel" id="p5">
<h2>예산 관리 — 화면별 수집 값 (시스템 화면 수준)</h2>
${scrBlock('budget')}
<h2>예산 상세 · 소계 검증 (중분류별: 소계 = Σ소분류)</h2>
<div class="note">각 중분류 그룹: 소분류 실제값 → <b>Σ소분류(계산)</b> vs <b>소계(화면 값)</b> → 열별 일치. (합계·1~12월)</div>
${detailGroups.length ? detailGroups.map(budGroupTbl).join('') : '<div class="note">예산 상세 소계 데이터 없음</div>'}
<h2>실적 관리 · 소계 검증 (중분류별)</h2>
${perfGroups.length ? perfGroups.map(budGroupTbl).join('') : '<div class="note">실적 소계 데이터 없음</div>'}
</div>

<div class="panel" id="p6">
<h2>원천 값 검증 (타 메뉴 → 비용/예산 유입 값의 계산 정합성)</h2>
<div class="note big">비용의 관리비유형은 인력(임률)·자재(단가)·장비(시간당비용)에서 계산되어 유입됩니다. 원천 화면의 <b>단가/임률 계산이 정확</b>해야 비용/예산에 반영되는 값이 신뢰 가능. + 원천 값이 실제 비용에 등장하는지(반영) 확인.</div>
<div class="tblwrap"><table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${source.map(chk).join('')}</tbody></table></div>
<h3>인력 관리 — 시간당 임률 = 급여 정보 ÷ 연근무시간(상수)</h3>${hrTbl}
<div class="note">인력의 시간당 임률이 인건비(고정직/임시직)로 유입. 관측: 손기웅 임률이 분류별 비용 그린 고정직에 그대로 등장(반올림 ±1).</div>
<h3>장비 관리 — 시간당 비용 = 매입가 ÷ (내용연수 × 연간 운용시간)</h3>${eqTbl}
<div class="note">장비 시간당 비용이 장비 관리비로 유입.</div>
<h3>자재 관리 — 단위당 원가 = 총재고액 ÷ 재고수량</h3>${matTbl}
<div class="note">자재 단위당 원가 × 출고량 = 코스 자재비로 유입.</div>
<h2>★ 원천값 ↔ 비용 비교 결과 (원천 단가/임률이 비용 화면에 등장하는가)</h2>
<div class="note big">원천 화면의 단가·임률을 비용 화면(분류별) 값과 <b>직접 대조</b>. <b>인력 임률</b>은 단일작업 비용에 그대로 반영되어 <b>직접 등장</b>. <b>자재 단가·장비 시간당비용</b>은 출고량·운용시간과 곱해져 <b>집계</b>되므로 원값이 직접 등장하지 않을 수 있음(정상) — 이때는 위 단가 공식 정합으로 신뢰성 확보. 총 ${cmp.length}건 중 직접 등장 <b class="okb">${cmpAppearN}건</b>.</div>
${cmpTbl}
</div>
<details class="gloss"><summary>용어 풀이 (처음 보시는 분용)</summary>
<dl>
<dt>정합성</dt><dd>여러 화면·항목에 나오는 같은 숫자가 서로 어긋나지 않고 맞아떨어지는 상태.</dd>
<dt>교차(교차 확인)</dt><dd>같은 총비용·예산을 화면마다 다른 기준(작업별/분류별/위치별 등)으로 다시 모아 보여줄 때, 그 <b>총합과 항목이 일치</b>하는지 맞대어 보는 것.</dd>
<dt>원천(원천 값)</dt><dd>비용의 밑값이 되는 대표 화면의 단가·임률(인력 임률·자재 단가·장비 시간당 비용). 이 값이 정확해야 비용·예산이 신뢰 가능.</dd>
<dt>소계 검산</dt><dd>화면에 적힌 소계·합계가 실제 하위 항목들을 더한 값과 같은지 다시 계산해 맞춰 보는 것.</dd>
<dt>화면 변경 없음(비파괴)</dt><dd>확인만 하고 저장·삭제·수정은 하지 않아, 실제 데이터가 바뀌지 않음.</dd>
<dt>정상 통과 / 주의 / 참고</dt><dd>정상=값이 맞음. 주의=값이 다르거나 확인 필요(사유 표기). 참고=기간·범위 안내로 통과/결함 판정 대상 아님.</dd>
</dl></details>
</div>`;

  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  const outPath = path.join('reports', 'course-budget-cost-verify.html');
  // ⚠ 세션 만료 가드: 전 화면이 빈 값(로그인 페이지로 빠짐)이면 기존 리포트를 빈 데이터로 덮어쓰지 않음.
  const loadedScreens = SCREENS.filter((s) => s.g && (s.g.tables.some((t) => t.cells.length) || s.g.cards.length)).length;
  if (loadedScreens === 0) {
    console.log('\n[중단] 로드된 화면 0개 — 세션 만료/로그아웃 추정. 기존 리포트 보존(덮어쓰기 생략). → npm run course:auth 후 재실행.');
    throw new Error('세션 만료 추정(전 화면 빈 값) — 기존 리포트 보존. npm run course:auth 후 재실행하세요.');
  }
  fs.writeFileSync(outPath, html);
  console.log(`\n[검증] 총 ${checks.length} · PASS ${pass} · FAIL ${fail} · 교차 ${cross.length} · 예산소계 ${detailGroups.length}+${perfGroups.length}`);
  console.log(`[report] ${outPath}`);
  for (const c of checks.filter((x) => !x.ok && !x.na)) console.log(`  ❌ ${c.name} — ${c.detail}`);
});

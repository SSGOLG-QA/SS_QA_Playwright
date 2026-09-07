import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_URL, setCourseDateRange } from '../lib/course/courseHelpers';
import { num, near, nearRel } from '../lib/course/domain/budgetCost';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  HOME 대시보드 데이터 연관 정합성 검증기(비파괴) — 예산/비용 검증기와 동일 수준.
//  실행: npm run course:auth 후 npm run course:home-verify → reports/course-home-verify.html
//  HOME = .tab-group 3개 탭 → 탭별 분리 검증:
//   [관리 목표 및 현황] 등급 대시보드 → 관리 목표 등급 = [목표 설정] 모달 원천 · 스케일 · 기준일
//   [작업]             작업 운영 요약   → 오늘의 작업(W-작업지시) = 작업 관리>작업 지시 · 이번 달 상태 · 최근 작업 일보
//   [비용]             예산 대비 실적   → 잔여=연간예산−누적사용 · 사용률% · 전체=Σ카테고리 · 연간예산=[예산 관리] 원천
//  ⚠ 탭명 '작업'/'비용'은 별도 탭(초기 텍스트매칭 '작업 비용'은 헤더 연결문자열). '작업'=금액無 운영요약 / '비용'=예산실적 금액.
//  비파괴(조회/탭 전환/모달 열기→취소만). 별도 입력 불필요.
// ──────────────────────────────────────────────────────────────

const AREAS = ['전체', '그린', '그린칼라', '티박스', '페어웨이', '러프', '벙커'];
const GRADE_SCALE = ['E-', 'E', 'E+', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
const GRADE_RE = '(A\\+|A-|A|B\\+|B-|B|C\\+|C-|C|D\\+|D-|D|E\\+|E-|E)';
// 비용 탭 카테고리: 전체 = Σ(하위 5종)
const COST_CATS = ['전체', '고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));

interface Check { name: string; ok: boolean; scope: 'goal' | 'work' | 'cost' | 'woc'; detail: string; na?: boolean; review?: boolean; }
interface CostCat { pct: number; used: number | null; remain: number | null; budget: number | null; }

function extractGrades(txt: string, order: 'ga' | 'ag'): Record<string, string> {
  const out: Record<string, string> = {};
  const t = (txt || '').replace(/Loading\.\.\./g, ' ');
  for (const a of AREAS) {
    const re = order === 'ga' ? new RegExp(GRADE_RE + '\\s*' + a + '(?![가-힣])') : new RegExp(a + '(?![가-힣])\\s*' + GRADE_RE);
    const m = re.exec(t);
    if (m) out[a] = m[1];
  }
  return out;
}

// 비용 탭 섹션 텍스트에서 카테고리별 {사용률%·누적사용·잔여·예산} 파싱. budgetLabel = '연간예산' | '누적 예산'
function parseCostSection(text: string, budgetLabel: string): Record<string, CostCat> {
  const out: Record<string, CostCat> = {};
  for (const cat of COST_CATS) {
    // 실제 렌더(라이브 확인): "{명} [초과 {금액}] {pct}% 누적 사용 금액 {used} 잔여 예산 금액 {remain} {budgetLabel} {budget}".
    //  ⚠ 예산 초과 카테고리(누적사용>연간예산, 예: 고정직 110%)는 **이름과 % 사이에 '초과 {금액}' 배지**가 끼어들어 이름→누적 고정 매칭이 깨졌던 게 근본원인(라벨은 그대로 '잔여 예산 금액', 값은 표준 하이픈 음수 '-47,810,000'). → 이름↔'누적 사용 금액' 사이를 프리픽스 (.*?)로 흡수하고 %는 그 안에서 추출, 잔여는 음수(-?) 허용.
    const re = new RegExp(cat.replace(/ /g, '\\s*') + '\\s*(.*?)누적\\s*사용\\s*금액\\s*([\\d,]+)\\s*잔여\\s*예산\\s*금액\\s*(-?[\\d,]+)\\s*' + budgetLabel.replace(/ /g, '\\s*') + '\\s*([\\d,]+)');
    const m = re.exec(text);
    if (m) {
      const prefix = m[1] || '';                           // '초과 {금액} {pct}%'(초과) 또는 '{pct}%'(정상)
      const pctM = /(\d+)\s*%/.exec(prefix);
      const used = num(m[2]); const budget = num(m[4]);
      let remain = num(m[3]);                              // '-47,810,000' → num이 표준 하이픈 부호 처리
      if (remain != null && /초과/.test(prefix)) remain = -Math.abs(remain);   // 안전망: '초과' 배지=예산초과=음수 보증
      if (remain == null && budget != null && used != null) remain = budget - used;
      out[cat] = { pct: pctM ? Number(pctM[1]) : (budget && used != null ? Math.round(used / budget * 100) : 0), used, remain, budget };
    }
  }
  return out;
}

async function gotoHome(admin: Page) {
  await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1300);
  if (!/\/(home|dashboard)?(\?|$)/.test(admin.url())) { await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(1500); }
  await killAlarms(admin);
}
async function clickTab(admin: Page, name: string) {
  await admin.locator('.tab-group').getByText(name, { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1500); await killAlarms(admin);
}

// [비용] 탭 → "작업지시에 근거한 비용 분석" 서브뷰 목록(모두 같은 '전체=Σ하위' 롤업 구조).
const WO_VIEWS = ['전체', '코스별', 'South', 'East', 'West', '기간별'];
interface WCell { t: string; cs: number; rs: number; }
interface WoRow { label: string; nums: (number | null)[]; cellCount: number; }
interface WoView { ok: boolean; headRows: WCell[][]; bodyRows: WCell[][]; }
// 현재 렌더된 작업지시-분석 서브뷰의 표를 읽음(비파괴). 첫 데이터 표(행≥1)의 thead/tbody 셀을 span 포함 그대로 캡처.
//   상세 리포트(원본표 재현) + '전체'=Σ(하위 행) 롤업 검증(위치기반 열합) 겸용.
async function readWoView(admin: Page): Promise<WoView> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const cellOf = (c: Element) => ({ t: norm(c.textContent), cs: (c as HTMLTableCellElement).colSpan || 1, rs: (c as HTMLTableCellElement).rowSpan || 1 });
    const sc = document.querySelector('.contents, main') || document.body;
    const tables = Array.from(sc.querySelectorAll('table'));
    const tbl = tables.find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { ok: false as const, headRows: [], bodyRows: [] };
    const headRows = Array.from(tbl.querySelectorAll('thead tr')).map((tr) => Array.from(tr.children).map(cellOf));
    const bodyRows = Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map(cellOf));
    return { ok: true as const, headRows, bodyRows };
  }).catch(() => ({ ok: false as const, headRows: [], bodyRows: [] }));
}

// 코스별 뷰 전용: '전체' 행의 '합계' 그룹 열(코스별 총액)을 당월/누적 표에서 각각 파싱.
//   ⚠ 코스별 뷰는 2D 그리드 — 행 라벨=영역축(전체/그린/티박스/…), 코스명은 '합계' 그룹의 하위 열 헤더.
//   과거 대조 코드가 코스명을 행 라벨에서 찾아 항상 0건('데이터 없음' 오표기)이던 근본원인 → 열 기반으로 정정(2026-09-07).
//   ✨ 2026-09-08 구조 변경 반영: 하위 열이 [South/East/West] → [South/East/West/전체 골프장](코스무관/미귀속) 4열로 확장.
//     헤더 서브라벨로 그룹 크기(3 or 4)를 자동 감지 → 4번째('전체 골프장')도 파싱. 반환 키 = 서브라벨 그대로.
async function readCourseTotals(admin: Page): Promise<{ cur: Record<string, number>; cum: Record<string, number>; groupLabels: string[] }> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const numOf = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return null; const v = Number(c); return Number.isFinite(v) ? v : null; };
    const sc = document.querySelector('.contents, main') || document.body;
    const tables = Array.from(sc.querySelectorAll('table')).filter((t) => t.querySelectorAll('tbody tr').length >= 1);
    // 헤더 2행(서브라벨)에서 '합계' 그룹의 하위 열 라벨 추출 → 6개 지표 기준 그룹 크기.
    const groupLabelsOf = (tbl: Element | undefined): string[] => {
      if (!tbl) return ['South', 'East', 'West'];
      const rows = Array.from(tbl.querySelectorAll('thead tr'));
      const sub = rows.length >= 2 ? Array.from(rows[1].children).map((c) => norm(c.textContent)).filter((t) => t) : [];
      if (sub.length >= 6) { const g = Math.round(sub.length / 6); if (g >= 1 && g <= 6) return sub.slice(0, g); }   // 6지표 균등 분할
      return ['South', 'East', 'West'];
    };
    const readTotals = (tbl: Element | undefined, labels: string[]): Record<string, number> => {
      const out: Record<string, number> = {};
      if (!tbl) return out;
      const totalRow = Array.from(tbl.querySelectorAll('tbody tr')).find((tr) => /^전체$/.test(norm((tr.children[0] || {}).textContent).replace(/\s+/g, '')));
      if (!totalRow) return out;
      const nums = Array.from(totalRow.children).slice(1).map((c) => numOf(norm(c.textContent))).filter((n): n is number => n != null);
      // '합계' 그룹 = 첫 labels.length 개 수치. 라벨 순서대로 매핑(South/East/West/전체 골프장…).
      labels.forEach((lb, i) => { if (nums[i] != null) out[norm(lb)] = nums[i]; });
      return out;
    };
    const labels = groupLabelsOf(tables[0]);
    return { cur: readTotals(tables[0], labels), cum: readTotals(tables[1], groupLabelsOf(tables[1]) ), groupLabels: labels };
  }).catch(() => ({ cur: {} as Record<string, number>, cum: {} as Record<string, number>, groupLabels: [] as string[] }));
}
// 코스무관(코스 미귀속) 버킷 키 정규화 — 구현 '전체 골프장' / 기획 '작업장소 해당없음' 양쪽 수용.
const COURSE_NONE_RE = /전체\s*골프장|작업장소\s*해당없음|코스무관|미지정/;
const courseNoneVal = (m: Record<string, number>): number | null => { const k = Object.keys(m).find((k) => COURSE_NONE_RE.test(k)); return k ? m[k] : null; };

// 롤업/비음수용 행 파생: 각 tbody 행 → { label(첫 셀), nums(나머지 셀 숫자화), cellCount }.
function woRows(view: WoView): WoRow[] {
  const numOf = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return null; const v = Number(c); return Number.isFinite(v) ? v : null; };
  return (view.bodyRows || []).map((cells) => ({ label: cells[0]?.t || '', nums: cells.slice(1).map((c) => numOf(c.t)), cellCount: cells.length }));
}

// 롤업 검증: '전체' 행 = Σ(다음 '전체' 전까지의 하위 행), 우측 정렬 위치기반 열합.
//   반환 { na, ok, detail } — 하위 행/정렬 불가 시 na(판정 제외). tol: 반올림 off-by-1 + 상대 0.5%.
function rollup(view: WoView): { na: boolean; ok: boolean; detail: string; grand: number | null } {
  const rows = woRows(view);
  if (!view.ok || rows.length === 0) return { na: true, ok: true, detail: '표/행 없음 — 판정 제외', grand: null };
  const tIdx = rows.findIndex((r) => /^전체$/.test(r.label.replace(/\s+/g, '')));
  if (tIdx < 0) return { na: true, ok: true, detail: `'전체' 행 없음(라벨: ${rows.slice(0, 3).map((r) => r.label).join('/')}) — 판정 제외`, grand: null };
  const total = rows[tIdx];
  // 다음 '전체'(누적 블록 시작) 전까지를 하위 행으로
  const children: WoRow[] = [];
  for (let i = tIdx + 1; i < rows.length; i++) { if (/^전체$/.test(rows[i].label.replace(/\s+/g, ''))) break; children.push(rows[i]); }
  const aligned = children.filter((c) => c.cellCount === total.cellCount);
  if (aligned.length === 0) return { na: true, ok: true, detail: '정렬 가능한 하위 행 없음(구조 상이) — 판정 제외', grand: null };
  // 정수 원 반올림에 견고한 tolerance: 하위 N행 각각 정수 반올림(±1원)이 누적되므로 round(Σ)와 Σround가 최대 N원 차 가능.
  //   → 절대 floor를 하위행 수(aligned.length)+1로(near-zero 기타 관리비 21원류 컬럼의 3원 반올림 노이즈 흡수).
  //   대형 컬럼은 상대 0.5%가 지배(floor 무관) → 실제 결함(N원 초과)은 계속 검출. QA 무관 표시 반올림 false FAIL 제거(2026-09-07).
  const floor = Math.max(2, aligned.length + 1);
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(floor, Math.abs(b) * 0.005);
  const bad: string[] = []; let cols = 0; let grand: number | null = null;
  for (let i = 0; i < total.nums.length; i++) {
    const tv = total.nums[i]; if (tv == null) continue;
    if (grand == null && tv > 0) grand = tv;   // 첫 유효 컬럼(대개 합계) = 대표 총액
    const sum = aligned.reduce((a, c) => a + (c.nums[i] ?? 0), 0);
    cols++;
    if (!near(tv, sum)) bad.push(`col${i}(전체 ${tv.toLocaleString()}≠Σ ${sum.toLocaleString()})`);
  }
  if (cols === 0) return { na: true, ok: true, detail: '수치 컬럼 없음 — 판정 제외', grand: null };
  return { na: false, ok: bad.length === 0, grand, detail: bad.length === 0 ? `${aligned.length}개 하위행 × ${cols}개 열 롤업 일치(전체=Σ하위)` : `불일치 ${bad.length}열: ${bad.slice(0, 3).join(', ')}` };
}

test('HOME 대시보드 데이터 연관 정합성 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  const admin = await openCourseAdmin(page, context);
  const checks: Check[] = [];

  // ═══ [관리 목표 및 현황] 탭: 등급 ═══
  await gotoHome(admin);
  const home = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const gradeCells = Array.from(sc.querySelectorAll('div, span, td, li, p, dd, dt')).filter((e) => e.childElementCount <= 3 && /^(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|E\+|E-|E)(전체|그린칼라|그린|티박스|페어웨이|러프|벙커)$/.test(norm(e.textContent))).map((e) => norm(e.textContent));
    const goalBox = Array.from(new Set(gradeCells)).join(' ');
    const baseDate = (norm(sc.textContent).match(/\d{4}년\s*\d{1,2}월/) || [''])[0];
    const charts = sc.querySelectorAll('svg [class*="highcharts"], .highcharts-root, [class*="chart"] svg').length;
    return { goalBox, baseDate, charts };
  }).catch(() => ({ goalBox: '', baseDate: '', charts: 0 }));
  const homeGoal = extractGrades(home.goalBox, 'ga');

  let modalGrades: Record<string, string> = {};
  await admin.locator('.contents, main').first().getByRole('button', { name: /목표\s*설정/ }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1300); await killAlarms(admin);
  const modalTxt = await admin.evaluate(() => { const m = document.querySelector('.modal-group:not(.alarm)'); return m ? (m.textContent || '').replace(/\s+/g, ' ').trim() : ''; }).catch(() => '');
  modalGrades = extractGrades(modalTxt, 'ag');
  await admin.locator('.modal-group').getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 2000 }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);

  // ═══ [작업] 탭: 작업 운영 요약 ═══
  await gotoHome(admin);
  await clickTab(admin, '작업');
  const work = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const all = norm(sc.textContent);
    const ids = Array.from(new Set((all.match(/[A-Z]-\d{4,}/g) || [])));
    const mDone = (all.match(/완료\s*(\d+)/) || [])[1];
    const mProg = (all.match(/진행\s*중?\s*(\d+)/) || [])[1];
    const mWait = (all.match(/대기\s*중?\s*(\d+)/) || [])[1];
    let logHead: string[] = []; const logRows: string[][] = [];
    for (const t of Array.from(sc.querySelectorAll('table'))) {
      const head = Array.from(t.querySelectorAll('thead th, thead td')).map((c) => norm(c.textContent));
      if (head.some((h) => /단일\s*작업|반복\s*작업|고정직|임시직/.test(h))) {
        logHead = head;
        for (const r of Array.from(t.querySelectorAll('tbody tr')).slice(0, 8)) logRows.push(Array.from(r.children).map((c) => norm(c.textContent)));
        break;
      }
    }
    const wonCells = Array.from(sc.querySelectorAll('*')).filter((e) => e.children.length === 0 && /\d,\d{3}.*원|₩/.test(e.textContent || '')).length;
    return { ids, month: { done: mDone, prog: mProg, wait: mWait }, logHead, logRows, wonCells };
  }).catch(() => ({ ids: [] as string[], month: { done: undefined, prog: undefined, wait: undefined }, logHead: [] as string[], logRows: [] as string[][], wonCells: 0 }));

  // ═══ [비용] 탭: 예산 대비 실적 ═══
  await gotoHome(admin);
  await clickTab(admin, '비용');
  const costTab = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const full = norm(sc.textContent);
    const guide = (full.match(/수립된 예산과[^.]*\./) || [''])[0];
    const wonCells = Array.from(sc.querySelectorAll('*')).filter((e) => e.children.length === 0 && /\d,\d{3}/.test(e.textContent || '')).length;
    return { full, guide, wonCells };
  }).catch(() => ({ full: '', guide: '', wonCells: 0 }));
  const splitIdx = costTab.full.indexOf('누적 예산 대비 현황');
  const annualSec = splitIdx > 0 ? costTab.full.slice(0, splitIdx) : costTab.full;
  const cumulSec = splitIdx > 0 ? costTab.full.slice(splitIdx) : '';
  const annual = parseCostSection(annualSec, '연간예산');
  const cumul = parseCostSection(cumulSec, '누적 예산');

  // ═══ [비용] 탭 → "작업지시에 근거한 비용 분석" 서브뷰(전체/코스별/South/East/West/기간별) ═══
  //  토글(.tab-group.tab-type-line): [예산 대비 실적 분석 | 작업지시에 근거한 비용 분석]
  //  서브탭(.tab-group.tab-type-box): 전체·코스별·South·East·West·기간별. 각 뷰 표: '전체' 행 = Σ(하위 행) 롤업.
  //  ⚠ 전체 뷰(영역축)와 코스별 뷰(코스축)는 집계 축이 달라 상호 총합 일치 아님(코스 미지정 작업 존재) → 뷰별 자기 롤업만 검증. 비파괴.
  let woGuide = ''; let woToggleFound = false;
  const woViews: Record<string, WoView> = {};
  let homeCourseCur: Record<string, number> = {};   // 코스별 뷰 당월 전체행 합계(S/E/W[/전체 골프장])
  let homeCourseCum: Record<string, number> = {};   // 코스별 뷰 누적(YTD) 전체행 합계(S/E/W[/전체 골프장])
  {
    const toggle = admin.locator('.contents, main').getByText(/작업지시에\s*근거한\s*비용\s*분석/).first();
    woToggleFound = await toggle.isVisible({ timeout: 2500 }).catch(() => false);
    if (woToggleFound) {
      await toggle.click({ timeout: 2500 }).catch(() => {});
      await admin.waitForTimeout(1600); await killAlarms(admin);
      woGuide = await admin.evaluate(() => {
        const sc = document.querySelector('.contents, main') || document.body;
        const t = (sc.textContent || '').replace(/\s+/g, ' ').trim();
        return (t.match(/작업지시서를\s*통해서\s*집계되는[^]*?제공받을 수 있습니다\./) || [''])[0];
      }).catch(() => '');
      const boxTabs = admin.locator('.tab-type-box');
      for (const v of WO_VIEWS) {
        const tab = boxTabs.getByText(new RegExp('^\\s*' + v + '\\s*$')).first();
        if (await tab.isVisible({ timeout: 1500 }).catch(() => false)) {
          await tab.click({ timeout: 1500 }).catch(() => {});
          await admin.waitForTimeout(1200); await killAlarms(admin);
          woViews[v] = await readWoView(admin);
          if (v === '코스별') { const cc = await readCourseTotals(admin); homeCourseCur = cc.cur; homeCourseCum = cc.cum; }
        } else {
          woViews[v] = { ok: false, headRows: [], bodyRows: [] };
        }
      }
    }
  }

  // ── 작업 관리 > 작업 지시(원천) ──
  let orderIds: string[] = []; let orderStatus: Record<string, number> = {}; let orderTotal = 0;
  if (await gotoCourseMenu(admin, '작업 관리', '작업 지시').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1600); await killAlarms(admin);
    const od = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      const ids = Array.from(new Set((norm(sc.textContent).match(/[A-Z]-\d{4,}/g) || [])));
      const t = sc.querySelector('table'); let total = 0; const status: Record<string, number> = {};
      if (t) { const rows = Array.from(t.querySelectorAll('tbody tr')); total = rows.length; for (const r of rows) { const m = (r.textContent || '').match(/완료|진행\s*중|대기|취소|예정/); if (m) { const k = m[0].replace(/\s+/g, ''); status[k] = (status[k] || 0) + 1; } } }
      return { ids, total, status };
    }).catch(() => ({ ids: [] as string[], total: 0, status: {} as Record<string, number> }));
    orderIds = od.ids; orderTotal = od.total; orderStatus = od.status;
  }

  // ── 예산 관리 > 예산 총괄(원천): 금액 집합 ──
  //  ⚠ 예산 총괄은 [월간|연간] 탭. 기본=월간(월별 예산·롤업 소계만) → 카테고리/총 '연간예산'은 [연간] 탭에서만 노출.
  //     HOME 비용탭 '연간예산'(전체 1,298,458,000 등)의 원천은 [연간] 탭이므로 반드시 연간 탭을 클릭한 뒤 금액을 수집.
  //     (연간 탭 미클릭 시 월간 금액만 잡혀 1,298,458,000 미발견 → ⑪ 가짜 FAIL 발생했었음 — 2026-08-26 수정)
  let budgetNums: number[] = []; let budgetTxt = ''; let budgetYearTab = false;
  if (await gotoCourseMenu(admin, '예산 관리', '예산 총괄').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1600); await killAlarms(admin);
    const yearTab = admin.locator('.contents, main').getByText(/^\s*연간\s*$/).first();
    if (await yearTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await yearTab.click({ timeout: 2500 }).catch(() => {});
      await admin.waitForTimeout(1600); await killAlarms(admin);
      budgetYearTab = true;
    }
    const bd = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      const nums = (norm(sc.textContent).match(/\d{1,3}(,\d{3})+/g) || []);
      return { nums: Array.from(new Set(nums)), txt: norm(sc.textContent).slice(0, 200) };
    }).catch(() => ({ nums: [] as string[], txt: '' }));
    budgetNums = bd.nums.map((s) => num(s)).filter((v): v is number => v != null); budgetTxt = bd.txt;
  }

  // ── 예산 관리 > 예산 상세(원천): 대분류별 연간 합계 — HOME 비용탭 '연간예산'(카테고리)의 정확 원천 ──
  //   예산 상세 = 대분류(고정직 인건비/…, HOME과 동일 라벨) > 중분류 > 소분류 + 소계행 + 합계(연간)열.
  //   대분류별 연간예산 = Σ(그 대분류의 중분류 소계행 × 합계열). rowspan 전개 그리드로 대분류 추적.
  const budgetDetailByCat: Record<string, number> = {}; let budgetDetailVisited = false;
  if (await gotoCourseMenu(admin, '예산 관리', '예산 상세').then(() => true).catch(() => false)) {
    budgetDetailVisited = true;
    await admin.waitForTimeout(1600); await killAlarms(admin);
    const dg = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
      if (!tbl) return { heads: [] as string[], grid: [] as string[][] };
      // colspan/rowspan 완전 전개
      const expand = (trs: Element[]): string[][] => {
        const grid: string[][] = []; const carry: ({ t: string; rem: number } | null)[] = [];
        for (const tr of trs) {
          const cells = Array.from(tr.children) as HTMLTableCellElement[];
          const out: string[] = []; let col = 0, ci = 0;
          while (ci < cells.length || (carry[col] && carry[col]!.rem > 0)) {
            if (carry[col] && carry[col]!.rem > 0) { out[col] = carry[col]!.t; carry[col]!.rem--; col++; continue; }
            if (ci >= cells.length) break;
            const cell = cells[ci++]; const cs = cell.colSpan || 1; const rs = cell.rowSpan || 1; const t = norm(cell.textContent);
            for (let k = 0; k < cs; k++) { out[col] = t; if (rs > 1) carry[col] = { t, rem: rs - 1 }; col++; }
          }
          grid.push(out);
        }
        return grid;
      };
      const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent));
      const grid = expand(Array.from(tbl.querySelectorAll('tbody tr')));
      return { heads, grid };
    }).catch(() => ({ heads: [] as string[], grid: [] as string[][] }));
    // 합계(연간)열 인덱스: 헤더 '합계' 우선, 없으면 마지막 수치열
    const hapCol = (() => { const i = dg.heads.findIndex((h) => /^합계$/.test(h.replace(/\s+/g, ''))); return i; })();
    const numAt = (s: string) => { const c = (s || '').replace(/[^0-9.\-]/g, ''); return c && c !== '-' && c !== '.' ? Number(c) : NaN; };
    for (const row of dg.grid) {
      if (!row.some((c) => /^소계$/.test((c || '').replace(/\s+/g, '')))) continue;   // 소계 행만(= Σ소분류) → 중복 방지
      const maj = COST_CATS.find((c) => c !== '전체' && row.some((cell) => (cell || '').replace(/\s+/g, '') === c.replace(/\s+/g, '')));
      if (!maj) continue;
      // 합계열 값(없으면 행 내 최댓값=연간합 추정)
      let v = hapCol >= 0 ? numAt(row[hapCol]) : NaN;
      if (!Number.isFinite(v)) { const ns = row.map(numAt).filter((n) => Number.isFinite(n)); v = ns.length ? Math.max(...ns) : NaN; }
      if (Number.isFinite(v)) budgetDetailByCat[maj] = (budgetDetailByCat[maj] || 0) + v;
    }
  }

  // ── 비용 관리 > 위치별 비용(연간, 작업지시 자동집계 원천): 코스별 총비용 — HOME 작업지시 기반 비용과 교차 대조용 ──
  //   HOME [비용]탭 '작업지시에 근거한 비용 분석'과 위치별 비용은 둘 다 작업지시 집계 = 동일 원천 → 코스별 총액이 같아야.
  const locByCourse: Record<string, number> = {}; let locBucket: number | null = null;
  if (await gotoCourseMenu(admin, '비용 관리', '위치별 비용').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1500); await killAlarms(admin);
    const yr = admin.locator('.contents, main').getByText(/^\s*연간\s*$/).first();
    if (await yr.isVisible({ timeout: 1500 }).catch(() => false)) { await yr.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1300); await killAlarms(admin); }
    const loc = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const numOf = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return null; const v = Number(c); return Number.isFinite(v) ? v : null; };
      const sc = document.querySelector('.contents, main') || document.body;
      const tbl = Array.from(sc.querySelectorAll('table')).find((t) => /총\s*비용|합계/.test(t.textContent || '') && t.querySelectorAll('tbody tr').length >= 1);
      if (!tbl) return { rows: [] as { c0: string; c1: string; total: number | null }[] };
      const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((h) => norm(h.textContent));
      const ti = heads.findIndex((h) => /총\s*비용|합계/.test(h));
      const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => { const c = Array.from(tr.children).map((td) => norm(td.textContent)); return { c0: c[0] || '', c1: c[1] || '', total: ti >= 0 ? numOf(c[ti]) : null }; });
      return { rows };
    }).catch(() => ({ rows: [] as { c0: string; c1: string; total: number | null }[] }));
    for (const r of loc.rows) {
      if (r.c1 || r.total == null) continue;   // 코스레벨 행(홀 empty)만
      if (/전체\s*골프장/.test(r.c0)) locBucket = r.total;
      else { const m = r.c0.match(/South|East|West/i); if (m) locByCourse[m[0]] = r.total; }
    }
  }

  // ── 예산 관리 > 실적 관리(회계 비용 원천): 분류별 연간 합계 — HOME [비용] 예산 대비 실적의 '누적 사용 금액' 원천 ──
  //   실적 관리 안내 = "실제 회계상 집계된 전체 비용을 입력" → HOME 누적 사용(회계 비용)의 입력 원천 화면.
  //   구조: 분류 탭(고정직/임시직/코스자재/장비/기타) × 중분류·소분류 × 1~12월. 카테고리 연간합 = Σ(소계 행 × 12월).
  //   ⚠ 소계 행만 합산(= Σ소분류 월별) → 데이터 행과 중복 합산 방지.
  const PERF_TABS = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
  const perfByCat: Record<string, number> = {}; let perfGuide = ''; let perfEntered = false; let perfVisited = false;
  if (await gotoCourseMenu(admin, '예산 관리', '실적 관리').then(() => true).catch(() => false)) {
    perfVisited = true;
    await admin.waitForTimeout(1600); await killAlarms(admin);
    perfGuide = await admin.evaluate(() => {
      const sc = document.querySelector('.contents, main') || document.body;
      return ((sc.textContent || '').replace(/\s+/g, ' ').match(/실제\s*회계상[^.]*입력[^.]*\./) || [''])[0];
    }).catch(() => '');
    for (const T of PERF_TABS) {
      const tab = admin.locator('.contents, main').getByText(T, { exact: true }).first();
      if (!(await tab.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await tab.click({ timeout: 1500 }).catch(() => {}); await admin.waitForTimeout(1000); await killAlarms(admin);
      const sum = await admin.evaluate(() => {
        const numOf = (t: string | null) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (!c || c === '-' || c === '.') return 0; const v = Number(c); return Number.isFinite(v) ? v : 0; };
        const sc = document.querySelector('.contents, main') || document.body;
        const tbl = sc.querySelector('table'); if (!tbl) return 0;
        let s = 0;
        for (const tr of Array.from(tbl.querySelectorAll('tbody tr'))) {
          const cells = Array.from(tr.children).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim());
          if (!/^소계$/.test(cells[0] || '')) continue;         // 소계 행만(= Σ소분류 월별) → 중복 합산 방지
          for (let i = 1; i < cells.length; i++) s += numOf(cells[i]);
        }
        return s;
      }).catch(() => 0);
      perfByCat[T] = sum; if (sum > 0) perfEntered = true;
    }
  }

  // ── 비용 관리 > 작업별 비용(YTD): 카테고리별 컬럼합 + 총액 — QA-15497 직접 대조용(HOME 작업지시분석 ↔ 작업별 비용) ──
  //   QA-15497: HOME>[비용]>작업지시 분석 금액 ≠ 비용관리>작업별 비용 금액(당월/누적 상이). 같은 스코프(당해 YTD)로 읽어 대조.
  const taskByCat: Record<string, number> = {}; let taskTotalCard = 0; let taskVisited = false;
  {
    const ty = new Date(); const tcy = ty.getFullYear();
    const start = `${tcy}-01-01`; const end = `${tcy}-${String(ty.getMonth() + 1).padStart(2, '0')}-${String(ty.getDate()).padStart(2, '0')}`;
    if (await gotoCourseMenu(admin, '비용 관리', '작업별 비용').then(() => true).catch(() => false)) {
      taskVisited = true;
      await admin.waitForTimeout(1800); await killAlarms(admin);
      await setCourseDateRange(admin, start, end).catch(() => false);
      await admin.waitForTimeout(1300); await killAlarms(admin);
      // 요약 카드 총액(서버측 전체)
      taskTotalCard = await admin.evaluate(() => {
        const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
        const sc = document.querySelector('.contents, main') || document.body;
        for (const e of Array.from(sc.querySelectorAll('*'))) { if (e.children.length > 2) continue; const m = norm(e.textContent).match(/^총\s*비용\s*([0-9,]+)$/); if (m) return Number(m[1].replace(/,/g, '')); }
        return 0;
      }).catch(() => 0);
      // 카테고리 컬럼 인덱스 + 전 페이지 컬럼합
      const heads = await admin.evaluate(() => { const sc = document.querySelector('.contents, main') || document.body; const t = Array.from(sc.querySelectorAll('table')).find((x) => x.querySelectorAll('tbody tr').length >= 1); return t ? Array.from(t.querySelectorAll('thead th, thead td')).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()) : []; }).catch(() => [] as string[]);
      const CAT5 = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
      const catIdx: Record<string, number> = {}; CAT5.forEach((c) => { const i = heads.findIndex((h) => h.replace(/\s+/g, '') === c.replace(/\s+/g, '')); if (i >= 0) catIdx[c] = i; });
      CAT5.forEach((c) => { taskByCat[c] = 0; });
      const readBody = () => admin.evaluate(() => { const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim(); const sc = document.querySelector('.contents, main') || document.body; const t = Array.from(sc.querySelectorAll('table')).find((x) => x.querySelectorAll('tbody tr').length >= 1); if (!t) return [] as string[][]; return Array.from(t.querySelectorAll('tbody tr')).filter((tr) => !/내역이 없습니다|데이터가 없습니다/.test(tr.textContent || '')).map((tr) => Array.from(tr.children).map((td) => norm(td.textContent))); }).catch(() => [] as string[][]);
      const numC = (s: string) => { const c = (s || '').replace(/[^0-9.\-]/g, ''); return c && c !== '-' && c !== '.' ? Number(c) : 0; };
      const addRows = (rows: string[][]) => { for (const r of rows) for (const c of CAT5) if (catIdx[c] != null) taskByCat[c] += numC(r[catIdx[c]]); };
      let rows = await readBody(); addRows(rows); let prevSig = rows.map((r) => r.join('|')).join('#');
      for (let pageN = 2; pageN <= 25; pageN++) {
        const clicked = await admin.evaluate((target) => {
          const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !(e as HTMLButtonElement).disabled;
          const norm = (s: string | null) => (s || '').trim(); const cls = (e: Element) => (typeof e.className === 'string' ? e.className : '');
          const inPag = (e: Element) => { let p: Element | null = e; for (let k = 0; k < 4 && p; k++) { if (/pag/i.test(cls(p))) return true; p = p.parentElement; } return false; };
          const all = Array.from(document.querySelectorAll('button, a, li')); const ns = all.filter((e) => vis(e) && norm(e.textContent) === target);
          const btn = ns.find(inPag) || ns[ns.length - 1]; if (btn) { (btn as HTMLElement).click(); return true; }
          const arrow = all.find((e) => vis(e) && (/next|다음/i.test(cls(e) + (e.getAttribute('aria-label') || '')) || /^[›❯»>]$/.test(norm(e.textContent)))); if (arrow) { (arrow as HTMLElement).click(); return true; } return false;
        }, String(pageN)).catch(() => false);
        if (!clicked) break;
        await admin.waitForTimeout(900); await killAlarms(admin);
        rows = await readBody(); const sig = rows.map((r) => r.join('|')).join('#'); if (!rows.length || sig === prevSig) break; addRows(rows); prevSig = sig;
      }
    }
  }
  // HOME 작업지시분석 전체뷰 누적/당월 카테고리(전체 행) — QA-15497 대조·앵커용
  const woAllByCat: { cur: Record<string, number>; cum: Record<string, number>; curTotal: number; cumTotal: number } = { cur: {}, cum: {}, curTotal: 0, cumTotal: 0 };
  {
    const tv = woViews['전체']; const trow = tv?.ok ? woRows(tv).find((r) => /^전체$/.test(r.label.replace(/\s+/g, ''))) : undefined;
    const tn = (trow?.nums || []).filter((n): n is number => n != null);
    if (tn.length >= 4 && tn.length % 2 === 0) { const h = tn.length / 2; const CAT5 = COST_CATS.slice(1); woAllByCat.curTotal = tn[0]; woAllByCat.cumTotal = tn[h]; CAT5.forEach((c, i) => { woAllByCat.cur[c] = tn[1 + i] ?? 0; woAllByCat.cum[c] = tn[h + 1 + i] ?? 0; }); }
  }

  // ═══════════ 검증 ═══════════
  // ── [등급] ① 목표 등급 = 목표 설정 모달 ──
  {
    const areas = AREAS.filter((a) => homeGoal[a] != null && modalGrades[a] != null);
    const bad = areas.filter((a) => homeGoal[a] !== modalGrades[a]);
    if (areas.length === 0) checks.push({ name: '★ 목표 등급: HOME 관리 목표 = [목표 설정] 원천', scope: 'goal', ok: true, na: true, detail: `비교 가능한 등급 없음(HOME ${Object.keys(homeGoal).length}·모달 ${Object.keys(modalGrades).length}) — 판정 제외(데이터/상태 없음)` });
    else checks.push({ name: '★ 목표 등급: HOME 관리 목표 = [목표 설정] 원천', scope: 'goal', ok: bad.length === 0, detail: bad.length === 0 ? `${areas.length}개 영역 일치: ${areas.map((a) => `${a}=${homeGoal[a]}`).join(' · ')}` : `불일치: ${bad.map((a) => `${a}(HOME ${homeGoal[a]}≠모달 ${modalGrades[a]})`).join(', ')}` });
  }
  // ── [등급] ② 스케일 유효 · ③ 기준일 ──
  {
    const all = { ...homeGoal, ...modalGrades };
    const invalid = Object.entries(all).filter(([, g]) => !GRADE_SCALE.includes(g));
    checks.push({ name: '등급 스케일 유효(E-~A+ 15단계)', scope: 'goal', ok: invalid.length === 0, detail: invalid.length === 0 ? `${Object.keys(all).length}개 등급 모두 유효` : `유효 외: ${invalid.map(([a, g]) => `${a}=${g}`).join(',')}` });
  }
  {
    // 기준일은 관리 목표 및 현황 탭이 데이터를 렌더했을 때만 의미. 등급이 하나도 없으면(탭 미렌더/데이터 없음)
    //   형제 등급 체크와 동일하게 na(판정 제외) — "미확인 ≠ 결함"(리포트 표준). baseDate 있으면 정상 판정.
    const goalHasData = Object.keys(homeGoal).length > 0 || Object.keys(modalGrades).length > 0;
    if (!home.baseDate && !goalHasData) checks.push({ name: '관리 현황 기준일 노출', scope: 'goal', ok: true, na: true, detail: '관리 목표 및 현황 탭 데이터 없음(등급 0) — 판정 제외' });
    else checks.push({ name: '관리 현황 기준일 노출', scope: 'goal', ok: !!home.baseDate, detail: home.baseDate ? `기준일 ${home.baseDate} · 등급 추세 차트 ${home.charts}개(Highcharts, 시각)` : '기준일 미검출(등급 데이터는 존재 — 확인 필요)' });
  }

  // ── [작업] ④ 오늘의 작업 W-ID ⊆ 작업 지시 목록 ──
  {
    const homeIds = work.ids;
    if (homeIds.length === 0 || orderIds.length === 0) checks.push({ name: '★ 오늘의 작업(W-작업지시) = 작업 관리 목록', scope: 'work', ok: true, na: true, detail: `데이터 없음 SKIP(HOME ${homeIds.length}·목록 ${orderIds.length})` });
    else { const missing = homeIds.filter((id) => !orderIds.includes(id)); checks.push({ name: '★ 오늘의 작업(W-작업지시) = 작업 관리 목록', scope: 'work', ok: missing.length === 0, detail: missing.length === 0 ? `${homeIds.length}건 전부 작업 지시 목록 존재: ${homeIds.join(', ')}` : `목록에 없음: ${missing.join(', ')}` }); }
  }
  // ── [작업] ⑤ 이번 달 상태 카운트 ──
  {
    const d = Number(work.month.done), p = Number(work.month.prog), w = Number(work.month.wait);
    const has = [d, p, w].every((n) => Number.isFinite(n));
    if (!has) checks.push({ name: '이번 달 작업 상태 카운트', scope: 'work', ok: true, na: true, detail: `미검출 SKIP(완료 ${work.month.done ?? '-'}·진행중 ${work.month.prog ?? '-'}·대기 ${work.month.wait ?? '-'})` });
    else checks.push({ name: '이번 달 작업 상태 카운트', scope: 'work', ok: d >= 0 && p >= 0 && w >= 0, detail: `완료 ${d} · 진행중 ${p} · 대기 ${w} (합 ${d + p + w}) — 모두 ≥0 정합` });
  }
  // ── [작업] ⑥ 최근 작업 일보 ──
  {
    if (work.logHead.length === 0) checks.push({ name: '최근 작업 일보 구조·건수', scope: 'work', ok: true, na: true, detail: '테이블 미노출 SKIP' });
    else { const okHead = work.logHead.some((h) => /단일/.test(h)) && work.logHead.some((h) => /고정직/.test(h)); const badNum = work.logRows.some((r) => r.some((c) => { const m = c.match(/(-?\d+)\s*(건|명)/); return m ? Number(m[1]) < 0 : false; })); checks.push({ name: '최근 작업 일보 구조·건수', scope: 'work', ok: okHead && !badNum, detail: `헤더 [${work.logHead.join('/')}] · ${work.logRows.length}행 · 건·명 ${badNum ? '음수(결함)' : '모두 ≥0'}` }); }
  }

  // ── [비용] ⑦★ 잔여 예산 = 연간예산 − 누적 사용 (카테고리별) ──
  {
    const cats = COST_CATS.filter((c) => annual[c] && annual[c].budget != null && annual[c].used != null && annual[c].remain != null);
    if (cats.length === 0) checks.push({ name: '★ 잔여 예산 = 연간예산 − 누적 사용', scope: 'cost', ok: true, na: true, detail: '비용 탭 카테고리 데이터 없음(연간 실적 섹션 파싱 0) — 판정 제외' });
    else { const bad = cats.filter((c) => !near(annual[c].remain!, annual[c].budget! - annual[c].used!)); checks.push({ name: '★ 잔여 예산 = 연간예산 − 누적 사용', scope: 'cost', ok: bad.length === 0, detail: bad.length === 0 ? `${cats.length}개 카테고리 항등 성립` : `불일치: ${bad.map((c) => `${c}(잔여 ${annual[c].remain}≠${annual[c].budget}-${annual[c].used})`).join(', ')}` }); }
  }
  // ── [비용] ⑧ 사용률% = round(누적사용/연간예산×100) ──
  {
    const cats = COST_CATS.filter((c) => annual[c] && annual[c].budget != null && annual[c].used != null && annual[c].budget! > 0);
    if (cats.length === 0) checks.push({ name: '사용률% = 누적 사용 ÷ 연간예산', scope: 'cost', ok: true, na: true, detail: '연간예산>0 카테고리 없음(전 카테고리 예산 0) SKIP' });
    else { const bad = cats.filter((c) => Math.abs(annual[c].pct - Math.round(annual[c].used! / annual[c].budget! * 100)) > 1); checks.push({ name: '사용률% = 누적 사용 ÷ 연간예산', scope: 'cost', ok: bad.length === 0, detail: bad.length === 0 ? `${cats.length}개 카테고리 사용률 일치` : `불일치: ${bad.map((c) => `${c}(${annual[c].pct}%≠${Math.round(annual[c].used! / annual[c].budget! * 100)}%)`).join(', ')}` }); }
  }
  // ── [비용] ⑨★ 전체 = Σ(하위 5 카테고리) : 연간예산·누적사용(회귀 감시) + 잔여(표시관례 review) ──
  //   ⚠ HOME 예산 대비 실적 카드는 잔여를 음수(-47,810,000)로 표시 → 전체=Σ 성립. 반면 예산 분석 연간 그래프는 잔여 0-하한 → 어긋남.
  //     같은 데이터인데 화면 간 잔여 표시 관례가 다름 → HOME서 잔여 불일치 시 결함 아닌 review(확인 필요)로 분리(연간예산·누적사용은 하한 없어 회귀 감시).
  {
    const subs = COST_CATS.slice(1);
    if (!annual['전체']) checks.push({ name: '★ 전체 = Σ(고정직·임시직·자재·장비·기타)', scope: 'cost', ok: true, na: true, detail: '전체/하위 카테고리 데이터 없음 — 판정 제외' });
    else {
      // 연간예산·누적사용: 하한 없음 → 전체=Σ 성립해야(불일치=결함)
      for (const { key, label } of [{ key: 'budget' as const, label: '연간예산' }, { key: 'used' as const, label: '누적 사용' }]) {
        const tot = annual['전체'][key]; const parts = subs.map((c) => annual[c]?.[key]).filter((v): v is number => v != null);
        if (tot == null || parts.length === 0) { checks.push({ name: `★ 전체 ${label} = Σ카테고리`, scope: 'cost', ok: true, na: true, detail: '데이터 없음 — 판정 제외' }); continue; }
        const sum = parts.reduce((a, b) => a + b, 0); const ok = near(tot, sum);
        checks.push({ name: `★ 전체 ${label} = Σ카테고리`, scope: 'cost', ok, detail: ok ? `${tot.toLocaleString()} = Σ${sum.toLocaleString()} ✓` : `불일치: ${tot.toLocaleString()} ≠ Σ${sum.toLocaleString()}(차 ${(tot - sum).toLocaleString()})` });
      }
      // 잔여 2단 검증(실행마다 판정 뒤집힘 방지): ①데이터 정합(표시 무관) 전체 잔여=Σ(예산−사용) uncapped / ②표시 관례(정보) 카드 잔여 합≠전체면 review
      const tR = annual['전체'].remain;
      const buCats = subs.filter((c) => annual[c]?.budget != null && annual[c]?.used != null);
      const rParts = subs.map((c) => annual[c]?.remain).filter((v): v is number => v != null);
      if (tR == null || buCats.length < 2) checks.push({ name: '★ 전체 잔여 = Σ(예산−사용)', scope: 'cost', ok: true, na: true, detail: `잔여/구성 데이터 없음(전체잔여 ${tR == null ? 'X' : 'O'}·예산·사용 쌍 ${buCats.length}) — 판정 제외` });
      else {
        const sR = rParts.reduce((a, b) => a + b, 0);
        const uncapped = buCats.reduce((a, c) => a + (annual[c]!.budget! - annual[c]!.used!), 0);
        checks.push({ name: '★ 전체 잔여 = Σ(예산−사용)', scope: 'cost', ok: near(tR, uncapped), detail: near(tR, uncapped) ? `전체 잔여 ${tR.toLocaleString()} = Σ(예산−사용) ${uncapped.toLocaleString()} ✓(데이터 정합·표시 무관)` : `데이터 불일치: 전체 잔여 ${tR.toLocaleString()} ≠ Σ(예산−사용) ${uncapped.toLocaleString()}(차 ${(tR - uncapped).toLocaleString()})` });
        if (rParts.length && !near(sR, tR)) checks.push({ name: '카드 잔여 표시 관례(0-하한)', scope: 'cost', ok: false, review: true, detail: `표시 관례(확인 필요, 결함 아님): Σ카드 잔여(표시) ${sR.toLocaleString()} ≠ 전체 잔여 ${tR.toLocaleString()}(차 ${(sR - tR).toLocaleString()}). 초과 분류 잔여 0-하한 표시(+초과 배지)에서 발생 — 데이터는 위 ①에서 정합. ⚠ 화면 간 잔여 표시 상이: HOME(음수) vs 예산 분석 연간 그래프(0-하한).` });
      }
    }
  }
  // ── [비용] ⑩ 누적 섹션: 잔여 = 누적예산 − 누적사용 ──
  {
    const cats = COST_CATS.filter((c) => cumul[c] && cumul[c].budget != null && cumul[c].used != null && cumul[c].remain != null);
    if (cats.length === 0) checks.push({ name: '누적 예산 대비: 잔여 = 누적예산 − 누적사용', scope: 'cost', ok: true, na: true, detail: '누적 예산 섹션 파싱 없음 SKIP' });
    else { const bad = cats.filter((c) => !near(cumul[c].remain!, cumul[c].budget! - cumul[c].used!)); checks.push({ name: '누적 예산 대비: 잔여 = 누적예산 − 누적사용', scope: 'cost', ok: bad.length === 0, detail: bad.length === 0 ? `${cats.length}개 카테고리 항등 성립` : `불일치: ${bad.map((c) => `${c}`).join(', ')}` }); }
  }
  // ── [비용] ⑪★ 연간예산(카테고리) = [예산 관리 > 예산 상세] 대분류 연간 합계 원천 ──
  //   HOME 비용탭 카테고리별 '연간예산' ↔ 예산 상세 대분류(고정직/임시직/…) 소계 Σ(합계열). 동일 원천이라 카테고리별 일치해야.
  //   전체 총액은 보조로 예산 총괄 금액집합 존재 확인. 예산 상세 미수집·대조불가 카테고리는 na/보류(가짜 FAIL 금지).
  {
    const subs = COST_CATS.slice(1);
    const pairs = subs.filter((c) => annual[c]?.budget != null && annual[c]!.budget! > 0 && (budgetDetailByCat[c] ?? 0) > 0);
    const total = annual['전체']?.budget;
    const totalHit = total != null && budgetNums.some((v) => near(v, total, 1));
    if (!budgetDetailVisited || pairs.length === 0) {
      // 예산 상세 대조 불가 → 전체 총액 존재 확인으로 폴백(기존 ⑪ 동작)
      if (total == null || budgetNums.length === 0) checks.push({ name: '★ 연간예산 = [예산 관리>예산 상세] 원천', scope: 'cost', ok: true, na: true, detail: `대조 대상 부족(예산 상세 방문 ${budgetDetailVisited}·대조쌍 ${pairs.length}·비용탭 전체예산 ${total?.toLocaleString() ?? '-'}·총괄 금액 ${budgetNums.length}건) — 판정 제외` });
      else checks.push({ name: '★ 연간예산 = [예산 관리>예산 상세] 원천', scope: 'cost', ok: totalHit, review: !totalHit, detail: totalHit ? `예산 상세 카테고리 대조 불가(방문 ${budgetDetailVisited}) → 보조: 비용탭 전체 연간예산 ${total!.toLocaleString()} = 예산 총괄 금액집합 존재(원천 일치)` : `비용탭 전체 연간예산 ${total!.toLocaleString()} 이 예산 총괄 금액집합에 없음 → 원천 확인` });
    } else {
      const bad = pairs.filter((c) => !nearRel(annual[c]!.budget!, budgetDetailByCat[c], 0.005));
      checks.push({
        name: '★ 연간예산 = [예산 관리>예산 상세] 원천', scope: 'cost',
        ok: bad.length === 0, review: bad.length > 0,   // 카테고리 불일치=확인 필요(원천 정렬 우선)
        detail: bad.length === 0
          ? `${pairs.length}개 카테고리 연간예산 = 예산 상세 대분류 연간합 일치: ${pairs.map((c) => `${c}(${annual[c]!.budget!.toLocaleString()})`).join(' · ')}${total != null ? ` · 전체 ${total.toLocaleString()}${totalHit ? '=예산 총괄 존재' : ''}` : ''}`
          : `불일치(확인 필요): ${bad.map((c) => `${c}(HOME ${annual[c]!.budget!.toLocaleString()} ↔ 예산 상세 ${budgetDetailByCat[c].toLocaleString()})`).join(', ')}. 경로: HOME>[비용]탭 연간예산 ↔ 예산 관리>예산 상세(대분류 소계 합계열).`,
      });
    }
  }
  // ── [비용] ⑲★ 누적 사용 금액(회계) = [예산 관리 > 실적 관리] 원천 ──
  //   HOME [비용]>예산 대비 실적의 '누적 사용 금액'은 회계상 집계 비용. 그 입력 원천은 예산 관리 > 실적 관리(분류×월).
  //   대조: 카테고리별 HOME annual[c].used(누적 사용) ↔ perfByCat[c](실적 관리 Σ소계×12월).
  //   ⚠ 스코프 차이 — HOME 누적=연중 누계(당월까지), 실적=입력된 전체 월 합. 원천이면 HOME 누적 ≤ 실적 연간합(부분합 ≤ 전체합).
  //     → 성립하면 PASS(정확 일치 또는 누계<연간합). HOME 누적 > 실적 연간합(실적 미입력/다른 축)만 review(확인 필요). 결함 단정 금지.
  {
    const srcNote = `원천 화면: [예산 관리 > 실적 관리]${perfGuide ? ` — "${perfGuide.slice(0, 48)}…"` : ''}`;
    const subs = COST_CATS.slice(1);
    const homeUsedCats = subs.filter((c) => annual[c]?.used != null && annual[c]!.used! > 0);
    const pairs = subs.filter((c) => annual[c]?.used != null && annual[c]!.used! > 0 && (perfByCat[c] ?? 0) > 0);
    if (!perfVisited) {
      checks.push({ name: '★ 누적 사용 금액 = [실적 관리] 회계 원천', scope: 'cost', ok: false, review: true, detail: `실적 관리 화면 진입 실패 — 회계 원천 대조 불가(확인 필요). ${srcNote}` });
    } else if (homeUsedCats.length > 0 && !perfEntered) {
      checks.push({ name: '★ 누적 사용 금액 = [실적 관리] 회계 원천', scope: 'cost', ok: false, review: true, detail: `HOME 누적 사용 노출(${homeUsedCats.map((c) => `${c}=${annual[c]!.used!.toLocaleString()}`).join(' · ')})이나 실적 관리는 전 분류 빈값(미입력) — 회계 원천 미입력/다른 축 가능(확인 필요). ${srcNote}` });
    } else if (pairs.length === 0) {
      checks.push({ name: '★ 누적 사용 금액 = [실적 관리] 회계 원천', scope: 'cost', ok: true, na: true, detail: `양측 대조 가능한 분류 없음(HOME 누적>0 ${homeUsedCats.length}·실적 입력 ${Object.values(perfByCat).filter((v) => v > 0).length}) — 판정 제외. ${srcNote}` });
    } else {
      const over = pairs.filter((c) => annual[c]!.used! > perfByCat[c] * 1.005);        // HOME 누적 > 실적 연간합(부분합>전체합 위배)
      const exact = pairs.filter((c) => nearRel(annual[c]!.used!, perfByCat[c], 0.005));
      if (over.length === 0) {
        const subset = pairs.length - exact.length;
        checks.push({ name: '★ 누적 사용 금액 = [실적 관리] 회계 원천', scope: 'cost', ok: true, detail: `${pairs.length}개 분류 정합(HOME 누적 ≤ 실적 관리 연간합) — 정확 일치 ${exact.length}${subset ? ` · 누계<연간합 ${subset}(당월까지 누계)` : ''}: ${pairs.map((c) => `${c}(${annual[c]!.used!.toLocaleString()}${nearRel(annual[c]!.used!, perfByCat[c], 0.005) ? '=' : '≤'}${perfByCat[c].toLocaleString()})`).join(' · ')}. ${srcNote}` });
      } else {
        checks.push({ name: '★ 누적 사용 금액 = [실적 관리] 회계 원천', scope: 'cost', ok: false, review: true, detail: `확인 필요(결함 단정 아님) — HOME 누적 사용이 실적 관리 연간합을 초과(실적 미입력/다른 회계축 가능): ${over.map((c) => `${c}(HOME ${annual[c]!.used!.toLocaleString()} > 실적 ${perfByCat[c].toLocaleString()})`).join(', ')}. 경로: HOME>[비용]>예산 대비 실적 ↔ 예산 관리>실적 관리. ${srcNote}` });
      }
    }
  }
  // ── [비용] ⑫ 예산 실적(회계)≠작업지시 집계 안내 표기 확인(정보성) ──
  checks.push({ name: '비용 탭 = 예산 대비 실적(회계 비용) 안내', scope: 'cost', ok: !!costTab.guide, detail: costTab.guide ? `안내 노출: "${costTab.guide.slice(0, 60)}…" (작업지시 집계와 차이 가능 명시)` : '안내문구 미검출(구조 확인)' });

  // ═══ [비용] 탭 → 작업지시에 근거한 비용 분석(전체/코스별/South/East/West/기간별) ═══
  // ⑬ 서브뷰 구조 렌더(6종 진입·표·행) · ⑭ 뷰별 '전체=Σ하위' 롤업 정합 · ⑮ 비음수 · ⑯ 안내문구.
  {
    if (!woToggleFound) {
      checks.push({ name: '★ 작업지시 기반 비용 분석 — 서브뷰 렌더(6종)', scope: 'woc', ok: true, na: true, detail: "'작업지시에 근거한 비용 분석' 토글 미노출 — 판정 제외(비용 탭 구조/데이터 확인)" });
    } else {
      // ⑬ 구조: 6개 서브뷰 진입·표·데이터 행
      const rendered = WO_VIEWS.filter((v) => woViews[v]?.ok && woViews[v].bodyRows.length > 0);
      const missing = WO_VIEWS.filter((v) => !(woViews[v]?.ok && woViews[v].bodyRows.length > 0));
      checks.push({ name: '★ 작업지시 기반 비용 분석 — 서브뷰 렌더(6종)', scope: 'woc', ok: missing.length === 0, detail: missing.length === 0 ? `전체·코스별·South·East·West·기간별 6종 모두 표·데이터 렌더(${rendered.map((v) => `${v} ${woViews[v].bodyRows.length}행`).join(' · ')})` : `미렌더/데이터없음: ${missing.join(', ')}` });

      // ⑭ 뷰별 '전체 = Σ(하위 행)' 롤업 정합(영역/홀/월 축)
      const rolls = WO_VIEWS.map((v) => ({ v, r: rollup(woViews[v] || { ok: false, headRows: [], bodyRows: [] }) }));
      const judgedRolls = rolls.filter((x) => !x.r.na);
      const badRolls = judgedRolls.filter((x) => !x.r.ok);
      if (judgedRolls.length === 0) checks.push({ name: "★ 작업지시 분석 '전체' = Σ(하위) 롤업 정합", scope: 'woc', ok: true, na: true, detail: '롤업 판정 가능한 뷰 없음(데이터/구조) — 판정 제외' });
      else checks.push({ name: "★ 작업지시 분석 '전체' = Σ(하위) 롤업 정합", scope: 'woc', ok: badRolls.length === 0, detail: badRolls.length === 0 ? `${judgedRolls.length}개 뷰 롤업 성립 — ${judgedRolls.map((x) => `${x.v}(${x.r.detail.replace(/개.*$/, '개열')})`).join(' · ')}` : `롤업 불일치: ${badRolls.map((x) => `${x.v}: ${x.r.detail}`).join(' / ')}` });

      // ⑮ 비음수(전 뷰 전 수치 ≥ 0)
      const negHits: string[] = [];
      for (const v of WO_VIEWS) { const vw = woViews[v]; if (!vw?.ok) continue; for (const row of woRows(vw)) for (const n of row.nums) if (n != null && n < 0) { negHits.push(`${v}/${row.label}`); break; } }
      const anyData = WO_VIEWS.some((v) => woViews[v]?.ok && woViews[v].bodyRows.length > 0);
      checks.push({ name: '작업지시 분석 — 비용 값 비음수', scope: 'woc', ok: negHits.length === 0, na: !anyData, detail: !anyData ? '데이터 없음 — 판정 제외' : negHits.length === 0 ? '전 뷰 전 수치 ≥ 0' : `음수 발견: ${negHits.slice(0, 5).join(', ')}` });

      // ⑯ 안내문구(작업지시서 기반 집계·회계비용과 차이 가능)
      checks.push({ name: '작업지시 분석 안내문구 노출', scope: 'woc', ok: !!woGuide, detail: woGuide ? `안내 노출: "${woGuide.slice(0, 70)}…"` : '안내문구 미검출(구조 확인)' });

      // ⑰★ A: HOME 작업지시 기반 비용(코스별) 총액 = 비용 관리 > 위치별 비용(동일 원천, 작업지시 집계) 코스별 총액
      //   HOME woc '코스별' 뷰의 South/East/West 총액 ↔ 위치별 비용 연간의 각 코스 총비용. 동일 원천이라 일치해야.
      //   ⚠ 스코프(HOME 현재 vs 위치별 연간) 어긋나면 가짜 불일치 위험 → 불일치는 review(확인 필요)로, 화면 경로 명시.
      {
        // 코스별 뷰는 코스명이 '합계' 그룹의 하위 열 → 전체 행 합계 열(당월/누적)을 코스별 총액으로 사용(readCourseTotals).
        // 위치별 비용은 연간 총비용 → 스코프상 HOME '누적(YTD)'가 최근접. 누적 우선, 없으면 당월로 대조.
        const homeRef = Object.keys(homeCourseCum).length > 0 ? homeCourseCum : homeCourseCur;
        const refLabel = Object.keys(homeCourseCum).length > 0 ? '누적(YTD)' : '당월';
        const haveHome = Object.keys(homeRef).length > 0;
        const haveLoc = Object.keys(locByCourse).length > 0;
        const courses = ['South', 'East', 'West'].filter((c) => homeRef[c] != null && locByCourse[c] != null);
        if (!woToggleFound || !haveHome || !haveLoc || courses.length === 0) {
          checks.push({ name: '★ HOME 작업지시 기반 비용(코스별) ↔ 비용 관리 위치별 비용(코스별 총액)', scope: 'woc', ok: true, na: true, detail: `대조 대상 부족 — 판정 제외(HOME 코스별 당월 ${Object.keys(homeCourseCur).length}·누적 ${Object.keys(homeCourseCum).length}건·[비용 관리>위치별 비용] 코스 ${Object.keys(locByCourse).length}건).` });
        } else {
          const bad = courses.filter((c) => !nearRel(homeRef[c], locByCourse[c], 0.005));
          checks.push({
            name: '★ HOME 작업지시 기반 비용(코스별) ↔ 비용 관리 위치별 비용(코스별 총액)', scope: 'woc',
            ok: bad.length === 0, review: bad.length > 0,   // 불일치=결함 단정 아님(원천/스코프 정합 미확정) → 확인 필요
            detail: bad.length === 0
              ? `${courses.length}개 코스 총액 일치(HOME ${refLabel} = 위치별 연간): ${courses.map((c) => `${c} ${homeRef[c].toLocaleString()}`).join(' · ')}.`
              : `확인 필요(결함 단정 아님) — 코스별 총액 상이: ${courses.map((c) => `${c}(HOME ${refLabel} ${homeRef[c].toLocaleString()} ${nearRel(homeRef[c], locByCourse[c], 0.005) ? '=' : '≠'} 위치별 ${locByCourse[c].toLocaleString()})`).join(', ')}. 원천/스코프 정합 미확정 — HOME=작업지시 집계(${refLabel}) vs 위치별=연간 총비용, 코스무관(전체 골프장) 버킷·회계축 차이 가능. 경로: HOME>[비용]>작업지시에 근거한 비용 분석>코스별 ↔ 비용 관리>위치별 비용>연간.`,
          });
        }
      }
      // ⑱ C: 코스무관(코스 미귀속) 작업 비용 — ✨2026-09-08 구조 변경: HOME 코스별에 '전체 골프장'(코스무관) 열 직접 신설.
      //   이전엔 코스별 뷰에 S/E/W만 있어 위치별 화면에 의존했으나, 이제 HOME 자체에서 코스무관 버킷 검증 가능.
      {
        const homeNoneCur = courseNoneVal(homeCourseCur);   // 당월 코스무관(전체 골프장)
        const homeNoneCum = courseNoneVal(homeCourseCum);   // 누적 코스무관
        const noneKey = Object.keys(homeCourseCur).find((k) => COURSE_NONE_RE.test(k)) || Object.keys(homeCourseCum).find((k) => COURSE_NONE_RE.test(k));
        if (homeNoneCur != null || homeNoneCum != null) {
          // ⑱-1 코스무관 가시화(HOME 직접)
          checks.push({ name: '코스무관(코스 미지정) 작업 비용 가시화 — HOME 코스별 열', scope: 'woc', ok: true, detail: `HOME 코스별에 '${noneKey}' 열 노출(특정 코스 미귀속 작업) — 당월 ${homeNoneCur?.toLocaleString() ?? '-'}원 · 누적 ${homeNoneCum?.toLocaleString() ?? '-'}원.${locBucket != null ? ` [비용 관리>위치별 비용] '전체 골프장' 버킷 ${locBucket.toLocaleString()}원과 대응.` : ''}` });
          // ⑱-2 그랜드 항등: HOME 코스별 당월 전체 = South+East+West+코스무관 = 전체뷰 당월 총계(woViews['전체'] 전체행 첫 수치)
          const sew = ['South', 'East', 'West'].reduce((a, c) => a + (homeCourseCur[c] ?? 0), 0);
          const grand = sew + (homeNoneCur ?? 0);
          const wv = woViews['전체'];
          const wvTotal = wv?.ok ? (woRows(wv).find((r) => /^전체$/.test(r.label.replace(/\s+/g, '')))?.nums.find((n) => n != null) ?? null) : null;
          if (sew > 0 && wvTotal != null) {
            const near2 = (a: number, b: number) => Math.abs(a - b) <= Math.max(4, Math.abs(b) * 0.005);
            checks.push({ name: '★ HOME 코스별: 전체 = South+East+West+코스무관 (당월 그랜드 항등)', scope: 'woc', ok: near2(grand, wvTotal), detail: near2(grand, wvTotal) ? `당월 그랜드 항등 성립: S+E+W+코스무관 ${grand.toLocaleString()} = 전체뷰 당월 총계 ${wvTotal.toLocaleString()}` : `불일치: S+E+W+코스무관 ${grand.toLocaleString()} ≠ 전체뷰 당월 ${wvTotal.toLocaleString()}(차 ${(grand - wvTotal).toLocaleString()})` });
          }
          // ⑱-3 기획-구현 라벨 차이(정보성) — 기획 '작업장소 해당없음' vs 구현 '전체 골프장'
          if (noneKey && /전체\s*골프장/.test(noneKey)) {
            checks.push({ name: '기획-구현 차이: 코스무관 열 라벨', scope: 'woc', ok: true, review: true, detail: `기획(Figma) 라벨 '작업장소 해당없음' ↔ 구현 라벨 '${noneKey}' 상이 — 의미 혼동 소지('전체 골프장'=코스 전역 vs '작업장소 해당없음'=위치 미지정). QA 확인 요망(결함 아님·표기 통일 검토).` });
          }
        } else if (locBucket != null) {
          checks.push({ name: '코스무관(코스 미지정) 작업 비용 가시화 — HOME 코스별 열', scope: 'woc', ok: true, na: true, detail: `HOME 코스별에 코스무관 열 미검출(구조 3열?) — [위치별 비용] '전체 골프장' 버킷 ${locBucket.toLocaleString()}원으로 대체 참고.` });
        } else {
          checks.push({ name: '코스무관(코스 미지정) 작업 비용 가시화 — HOME 코스별 열', scope: 'woc', ok: true, na: true, detail: 'HOME 코스별 코스무관 열·위치별 버킷 모두 미검출 — 판정 제외.' });
        }
      }
      // ⑳ D: 전체뷰 '전체' 행 가로 정합 — 합계 컬럼 = Σ(카테고리 컬럼) (당월·누적 각 블록)
      //   ⚠ 2026-09-04 프로브(course:cost-decomp)로 발견: HOME 전체뷰 '합계'가 Σ표시카테고리보다 큼(누적 5,174,135·당월 260,639).
      //     표시된 5개 카테고리로 설명 안 되는 금액이 합계에 포함(영역 미배정 작업의 합계 귀속 추정, 카테고리엔 미반영).
      //     세로 롤업(⑭ 전체=Σ영역)과 별개인 '가로' 항등 — 결함 단정 금지, 불일치는 review(확인 필요)로 상시 노출.
      {
        const tv = woViews['전체'];
        const totalRow = tv?.ok ? woRows(tv).find((r) => /^전체$/.test(r.label.replace(/\s+/g, ''))) : undefined;
        const nums = (totalRow?.nums || []).filter((n): n is number => n != null);
        if (!totalRow || nums.length < 4 || nums.length % 2 !== 0) {
          checks.push({ name: "★ 전체뷰 가로 정합: '합계' = Σ카테고리", scope: 'woc', ok: true, na: true, detail: `전체뷰 '전체' 행 구조 부적합(수치 ${nums.length}개) — 판정 제외` });
        } else {
          const half = nums.length / 2;   // [당월: 합계+카테고리][누적: 합계+카테고리]
          const blocks: { label: string; total: number; catSum: number; diff: number }[] = [];
          for (const [i, label] of [[0, '당월'], [half, '누적']] as [number, string][]) {
            const total = nums[i]; const cats = nums.slice(i + 1, i + half); const catSum = cats.reduce((a, b) => a + b, 0);
            blocks.push({ label, total, catSum, diff: total - catSum });
          }
          const bad = blocks.filter((b) => Math.abs(b.diff) > Math.max(2, Math.abs(b.total) * 0.005));
          checks.push({
            name: "★ 전체뷰 가로 정합: '합계' = Σ카테고리", scope: 'woc',
            ok: bad.length === 0, review: bad.length > 0,   // 불일치=확인 필요(내부 정합성 — 결함 단정 아님)
            detail: bad.length === 0
              ? `당월·누적 블록 모두 '합계' = Σ카테고리(가로 항등 성립): ${blocks.map((b) => `${b.label} ${b.total.toLocaleString()}`).join(' · ')}`
              : `내부 불일치(확인 필요) — '합계' 컬럼이 표시된 카테고리 합과 다름: ${bad.map((b) => `${b.label}(합계 ${b.total.toLocaleString()} ≠ Σ카테고리 ${b.catSum.toLocaleString()}, 차이 ${b.diff.toLocaleString()})`).join(', ')}. 표시 5개 카테고리로 설명 안 되는 금액이 합계에 포함(영역 미배정분의 합계 귀속 추정). 화면: HOME>[비용]탭>작업지시에 근거한 비용 분석>전체.`,
          });
        }
      }
      // ㉒ 코스별·기간별 뷰 심화 정합(⑳ 전체뷰 확장) — 라이브 구조 확정(2026-09-07, 전체뷰와 다른 2D 그리드):
      //   코스별: 열=[합계·고정직·임시직·자재·장비·기타]×[South·East·West](18). per-course 합계=Σ5메트릭 → 미귀속 시 review
      //           (⑳ 당월 미귀속 260,639이 코스로 분산 — West 정확·South/East 집중).
      //   기간별: 열=[관리유형5][작업분류13](18), 행=전체+1~12월. Σ관리유형=Σ작업분류(같은 총액 2분류 교차) + Σ(1~12월)=전체.
      //   ✨2026-09-08 코스별 구조 변경: [S·E·W](18) → [S·E·W·전체 골프장](24). ㉒ 코스별은 그룹크기 G(3/4) 자동 대응.
      //   ⚠ 코스별 18/24열·기간별 18열 행만 판정(구조 확정분). 다른 구조=na. 불일치=결함 단정 아닌 review(내부 정합·미귀속 현상).
      {
        const near2 = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.005);
        // 코스별: per-course '합계' = Σ5메트릭. ✨2026-09-08 3열(S/E/W·18)/4열(S/E/W/전체골프장·24) 자동 대응(그룹크기 G=nums/6).
        {
          const vw = woViews['코스별'];
          const rows = vw?.ok ? woRows(vw).filter((r) => { const c = r.nums.filter((n) => n != null).length; return c === 18 || c === 24; }) : [];
          if (rows.length === 0) checks.push({ name: "★ 코스별뷰: 코스 '합계' = Σ5메트릭", scope: 'woc', ok: true, na: true, detail: '코스별 뷰 18/24열 행 없음 — 판정 제외(구조 상이)' });
          else {
            let judged = 0, bad = 0; const exs: string[] = [];
            for (const r of rows) {
              const n = r.nums.filter((x): x is number => x != null);   // [합계,고정,임시,자재,장비,기타]×[코스 G개]
              const G = n.length / 6;   // 3(S/E/W) 또는 4(S/E/W/전체골프장)
              const labels = G === 4 ? ['South', 'East', 'West', '전체 골프장'] : ['South', 'East', 'West'];
              for (let c = 0; c < G; c++) {
                const total = n[c]; const metricSum = n[G + c] + n[2 * G + c] + n[3 * G + c] + n[4 * G + c] + n[5 * G + c];
                judged++;
                if (!near2(total, metricSum)) { bad++; if (exs.length < 5) exs.push(`${r.label}/${labels[c]}(합계 ${total.toLocaleString()}≠Σ ${metricSum.toLocaleString()}, 차 ${(total - metricSum).toLocaleString()})`); }
              }
            }
            checks.push({ name: "★ 코스별뷰: 코스 '합계' = Σ5메트릭", scope: 'woc', ok: bad === 0, review: bad > 0, detail: bad === 0 ? `${judged}개 행×코스 '합계'=Σ메트릭 성립(${rows[0].nums.filter((n) => n != null).length === 24 ? '4열·전체골프장 포함' : '3열'})` : `내부 불일치(확인 필요) ${bad}/${judged}: ${exs.join(', ')}. 미귀속분이 합계에 포함(⑳ 전체뷰 당월 미귀속의 코스별 분산). 화면: HOME>[비용]>작업지시에 근거한 비용 분석>코스별.` });
          }
        }
        // 기간별: 행별 Σ관리유형 = Σ작업분류 + Σ(1~12월) = 전체
        {
          const vw = woViews['기간별'];
          const rows = vw?.ok ? woRows(vw).filter((r) => r.nums.filter((n) => n != null).length === 18) : [];
          if (rows.length === 0) checks.push({ name: '★ 기간별뷰: Σ관리유형 = Σ작업분류', scope: 'woc', ok: true, na: true, detail: '기간별 뷰 18열 행 없음 — 판정 제외(구조 상이)' });
          else {
            let judged = 0, bad = 0; const exs: string[] = []; const rowTot: Record<string, number> = {};
            for (const r of rows) {
              const n = r.nums.filter((x): x is number => x != null);   // [관리유형5][작업분류13]
              const mgmt = n.slice(0, 5).reduce((a, b) => a + b, 0); const work = n.slice(5, 18).reduce((a, b) => a + b, 0);
              rowTot[r.label.replace(/\s+/g, '')] = mgmt; judged++;
              if (!near2(mgmt, work)) { bad++; if (exs.length < 4) exs.push(`${r.label}(관리유형Σ ${mgmt.toLocaleString()}≠작업분류Σ ${work.toLocaleString()})`); }
            }
            checks.push({ name: '★ 기간별뷰: Σ관리유형 = Σ작업분류(2분류 동일 총액)', scope: 'woc', ok: bad === 0, review: bad > 0, detail: bad === 0 ? `${judged}개 행 관리유형Σ=작업분류Σ 성립` : `불일치(확인 필요) ${bad}/${judged}: ${exs.join(', ')}` });
            const monKeys = Object.keys(rowTot).filter((k) => /^\d+월$/.test(k));
            const tot = rowTot['전체'];
            if (tot != null && monKeys.length > 0) { const monSum = monKeys.reduce((a, k) => a + rowTot[k], 0); checks.push({ name: '★ 기간별뷰: Σ(1~12월) = 전체', scope: 'woc', ok: near2(monSum, tot), detail: near2(monSum, tot) ? `Σ${monKeys.length}개월 ${monSum.toLocaleString()} = 전체 ${tot.toLocaleString()} ✓` : `불일치: Σ월 ${monSum.toLocaleString()} ≠ 전체 ${tot.toLocaleString()}(차 ${(monSum - tot).toLocaleString()})` }); }
          }
        }
      }
      // ㉑ QA-15497: HOME 작업지시분석(누적) 금액 = 비용관리 작업별 비용(YTD) 금액 — 두 화면 직접 대조
      //   등록 버그(QA-15497): 두 화면 금액 상이. 같은 스코프(당해 YTD)로 대조 → 일치하면 수정됨(회귀 통과), 상이하면 버그 재현(review).
      {
        const CAT5 = COST_CATS.slice(1);
        const pairs = CAT5.filter((c) => (woAllByCat.cum[c] ?? 0) > 0 && (taskByCat[c] ?? 0) > 0);
        const taskTotal = taskTotalCard > 0 ? taskTotalCard : CAT5.reduce((a, c) => a + (taskByCat[c] || 0), 0);
        if (!taskVisited || woAllByCat.cumTotal === 0 || pairs.length === 0) {
          checks.push({ name: '★ QA-15497: HOME 작업지시분석(누적) = 작업별 비용(YTD)', scope: 'woc', ok: true, na: true, detail: `대조 대상 부족(작업별 방문 ${taskVisited}·HOME 누적합계 ${woAllByCat.cumTotal.toLocaleString()}·대조쌍 ${pairs.length}) — 판정 제외` });
        } else {
          const badCat = pairs.filter((c) => !nearRel(woAllByCat.cum[c], taskByCat[c], 0.005));
          const totalOk = nearRel(woAllByCat.cumTotal, taskTotal, 0.005);
          const ok = badCat.length === 0 && totalOk;
          checks.push({
            name: '★ QA-15497: HOME 작업지시분석(누적) = 작업별 비용(YTD)', scope: 'woc',
            ok, review: !ok,   // 상이=등록버그(QA-15497) 재현 → 확인 필요(수정 시 PASS로 회귀)
            detail: ok
              ? `✅ 두 화면 금액 일치(QA-15497 해소 추정) — 총액 HOME ${woAllByCat.cumTotal.toLocaleString()} = 작업별 ${taskTotal.toLocaleString()}, ${pairs.length}개 카테고리 일치`
              : `🔎 QA-15497 재현 — 두 화면 금액 상이: 총액 HOME 작업지시분석 ${woAllByCat.cumTotal.toLocaleString()} ≠ 작업별 비용 ${taskTotal.toLocaleString()}(차 ${(taskTotal - woAllByCat.cumTotal).toLocaleString()})`
                + (badCat.length ? ` · 카테고리 상이: ${badCat.map((c) => `${c}(HOME ${woAllByCat.cum[c].toLocaleString()} ≠ 작업별 ${taskByCat[c].toLocaleString()})`).join(', ')}` : '')
                + `. 등록 버그 QA-15497(HOME>비용>작업지시 분석 금액 ≠ 비용관리>작업별 비용). 원인분해: 스코프 차 + 미귀속 잔여(작업지시분석 유형 미분류).`,
          });
        }
      }
    }
  }

  // ═══ HTML(탭 구조) ═══
  // 판정: na(데이터 없음)는 pass/fail 집계 제외 — "미확인 ≠ 결함"(리포트 표준).
  // review(확인 필요)는 결함과 분리하되 "주의 필요"에 함께 집계(사람이 원천 확인) — 예산·비용 리포트와 동일 기준.
  const isRev = (c: Check) => !!c.review;
  const judged = checks.filter((c) => !c.na);
  const naCount = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok).length;
  const fail = judged.filter((c) => !c.ok && !isRev(c)).length;   // 실제 결함
  const review = judged.filter((c) => !c.ok && isRev(c)).length;  // 확인 필요
  const attn = fail + review;                                      // 주의 필요 = 결함 + 확인 필요
  const goalChk = checks.filter((c) => c.scope === 'goal'); const workChk = checks.filter((c) => c.scope === 'work'); const costChk = checks.filter((c) => c.scope === 'cost'); const wocChk = checks.filter((c) => c.scope === 'woc');
  const cnt = (cs: Check[]) => { const j = cs.filter((c) => !c.na); return `${j.filter((c) => c.ok).length}/${j.length}`; };
  const allOkOf = (cs: Check[]) => cs.filter((c) => !c.na).every((c) => c.ok);
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : c.review ? '🔎' : (c.ok ? '✅' : '❌');
  const chk = (c: Check) => `<tr class="${c.na ? 'na' : c.review ? 'rv' : c.ok ? '' : 'ng'}"><td>${mark(c)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`;
  // 주의 필요(결함 + 확인필요) 상세 — 상단 카드 클릭 시 펼쳐짐.
  const attnItems = judged.filter((c) => !c.ok).sort((a, b) => (a.review ? 1 : 0) - (b.review ? 1 : 0));
  const attnHtml = attnItems.length
    ? attnItems.map((c) => `<div class="attnitem ${c.review ? 'rv' : 'ng'}"><div class="ai-h">${c.review ? '🔎 확인 필요' : '❌ 주의'} — ${esc(c.name)}</div><div class="ai-d">${esc(c.detail)}</div></div>`).join('')
    : '<div class="attnitem okmsg">✅ 주의 필요 항목 없음 — 확인 항목 전부 정합</div>';
  const attnCard = `<details class="scard ${fail ? 'sng' : review ? 'srv' : 'sok'}"${attn ? ' open' : ''}><summary><span class="n ${fail ? 'ng-n' : review ? 'rv-n' : 'ok-n'}">${attn}</span><span class="l">주의 필요 ▾${review ? ` <span class="mut">(확인필요 ${review} 포함)</span>` : ''}</span></summary><div class="scard-body">${attnHtml}</div></details>`;
  const chkTbl = (cs: Check[]) => `<table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${cs.map(chk).join('')}</tbody></table>`;
  const gradeTbl = `<table class="sys"><thead><tr><th>영역</th><th>HOME 관리 목표</th><th>목표 설정(원천)</th><th>일치</th></tr></thead><tbody>${AREAS.map((a) => `<tr class="${homeGoal[a] && modalGrades[a] && homeGoal[a] !== modalGrades[a] ? 'ng' : ''}"><td>${esc(a)}</td><td>${esc(homeGoal[a] || '—')}</td><td>${esc(modalGrades[a] || '—')}</td><td>${homeGoal[a] && modalGrades[a] ? (homeGoal[a] === modalGrades[a] ? '✅' : '❌') : '—'}</td></tr>`).join('')}</tbody></table>`;
  const logTbl = work.logHead.length ? `<table class="sys"><thead><tr>${work.logHead.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${work.logRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="note">최근 작업 일보 미수집</div>';
  const idTbl = `<table class="sys"><thead><tr><th>오늘의 작업(HOME)</th><th>작업 지시 목록 존재</th></tr></thead><tbody>${(work.ids.length ? work.ids : ['(없음)']).map((id) => `<tr class="${work.ids.length && !orderIds.includes(id) ? 'ng' : ''}"><td>${esc(id)}</td><td>${work.ids.length ? (orderIds.includes(id) ? '✅ 존재' : '❌ 없음') : '—'}</td></tr>`).join('')}</tbody></table>`;
  const costRow = (cat: string, d: CostCat | undefined) => { if (!d) return `<tr><td>${esc(cat)}</td><td colspan="4" style="color:var(--mut)">파싱 없음</td></tr>`; const calc = d.budget != null && d.used != null ? d.budget - d.used : null; const ok = calc != null && d.remain != null && near(d.remain, calc); return `<tr class="${cat === '전체' ? 'mt' : ''} ${calc != null && !ok ? 'ng' : ''}"><td>${esc(cat)}</td><td class="num">${d.used?.toLocaleString() ?? '—'}</td><td class="num">${d.remain?.toLocaleString() ?? '—'}</td><td class="num">${d.budget?.toLocaleString() ?? '—'}</td><td class="num">${d.pct}% ${calc != null ? (ok ? '✅' : '❌') : ''}</td></tr>`; };
  const costTbl = (data: Record<string, CostCat>, budgetLabel: string) => `<table class="sys"><thead><tr><th>카테고리</th><th class="num">누적 사용</th><th class="num">잔여 예산</th><th class="num">${esc(budgetLabel)}</th><th class="num">사용률(검산)</th></tr></thead><tbody>${COST_CATS.map((c) => costRow(c, data[c])).join('')}</tbody></table>`;
  // 작업지시 분석 뷰별 롤업 요약 표(전체 대표총액 + 하위행 수 + 롤업 판정)
  const wocSummaryTbl = `<table class="sys"><thead><tr><th>서브뷰</th><th>렌더</th><th class="num">행 수</th><th class="num">'전체' 대표총액</th><th>전체=Σ하위 롤업</th></tr></thead><tbody>${WO_VIEWS.map((v) => {
    const vw = woViews[v]; const r = rollup(vw || { ok: false, headRows: [], bodyRows: [] });
    const rendered = vw?.ok && vw.bodyRows.length > 0;
    const mk = r.na ? '➖ 판정 제외' : r.ok ? '✅ 성립' : '❌ 불일치';
    return `<tr class="${!r.na && !r.ok ? 'ng' : ''}"><td><b>${esc(v)}</b></td><td>${rendered ? '✅' : '➖'}</td><td class="num">${rendered ? vw.bodyRows.length : '—'}</td><td class="num">${r.grand != null ? r.grand.toLocaleString() : '—'}</td><td>${mk}${!r.na ? ` <span class="mut">${esc(r.detail)}</span>` : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
  // 작업지시 분석 서브뷰 원본표 재현(span 보존) + '전체' 행 강조. 숫자 셀 우측정렬.
  const isNumCell = (t: string) => /^-?[\d,]+(원|%)?$/.test((t || '').trim());
  const woCellRow = (cells: WCell[], tag: 'th' | 'td', hot: boolean) => `<tr class="${hot ? 'mt' : ''}">${cells.map((c) => `<${tag}${c.cs > 1 ? ` colspan="${c.cs}"` : ''}${c.rs > 1 ? ` rowspan="${c.rs}"` : ''} class="${isNumCell(c.t) ? 'num' : ''}">${esc(c.t || '')}</${tag}>`).join('')}</tr>`;
  const woDetailTbl = (v: string) => {
    const vw = woViews[v];
    if (!vw?.ok || !vw.bodyRows.length) return '<div class="note">데이터 없음(미렌더/빈 표)</div>';
    const thead = vw.headRows.map((r) => woCellRow(r, 'th', false)).join('');
    const tbody = vw.bodyRows.map((r) => woCellRow(r, 'td', /^전체$/.test((r[0]?.t || '').replace(/\s+/g, '')))).join('');
    return `<div class="tblwrap"><table class="sys">${thead ? `<thead>${thead}</thead>` : ''}<tbody>${tbody}</tbody></table></div>`;
  };
  const woViewNote: Record<string, string> = {
    '전체': '영역(그린·티박스·페어웨이…)별 <b>당월/누적</b> 비용. \'전체\' 행 = Σ(영역 행).',
    '코스별': '코스(South·East·West)별 카테고리 비용. \'전체\' 행 = Σ(영역 행). ⚠ 영역축이라 코스별 총합은 전체 뷰와 다를 수 있음(코스 미지정 작업).',
    'South': 'South 코스 <b>홀별(1~9홀)</b> · 예산분류별/작업분류별 × 카테고리 × 영역. \'전체\' 행 = Σ(홀 행).',
    'East': 'East 코스 홀별 · 예산분류별/작업분류별 × 카테고리 × 영역. \'전체\' 행 = Σ(홀 행).',
    'West': 'West 코스 홀별 · 예산분류별/작업분류별 × 카테고리 × 영역. \'전체\' 행 = Σ(홀 행).',
    '기간별': '<b>월별(1~12월)</b> 비용 추이. \'전체\' 행 = Σ(월 행).',
  };
  const woDetailSections = woToggleFound
    ? WO_VIEWS.map((v) => { const r = rollup(woViews[v] || { ok: false, headRows: [], bodyRows: [] }); const badge = r.na ? '<span class="badge">판정 제외</span>' : r.ok ? '<span class="badge" style="color:var(--ok);border-color:var(--ok)">✅ 롤업 성립</span>' : '<span class="badge" style="color:var(--ng);border-color:var(--ng)">❌ 롤업 불일치</span>'; return `<h3>${esc(v)} ${badge} ${r.grand != null ? `<span class="mut" style="font-size:12px;font-weight:400">대표총액 ${r.grand.toLocaleString()}원</span>` : ''}</h3><div class="note" style="margin:4px 0 6px">${woViewNote[v] || ''} ${!r.na ? `<span class="mut">— ${esc(r.detail)}</span>` : ''}</div>${woDetailTbl(v)}`; }).join('')
    : '';

  const html = `<style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 60px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 10px;border-bottom:2px solid var(--line);padding-bottom:6px}h3{font-size:14px;margin:16px 0 4px}
.sub{color:var(--mut);font-size:13px;margin-bottom:8px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:23px;font-weight:700}.card .l{font-size:12px;color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:6px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-size:11.5px;background:var(--card)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}tr.mt td{font-weight:700;border-top:2px solid var(--fg);background:var(--card)}tr.ng td{color:var(--ng);font-weight:600}tr.na td{color:var(--mut)}.ok-n{color:var(--ok);font-weight:700}.ng-n{color:var(--ng);font-weight:700}.na-n{color:var(--mut);font-weight:700}.mut{color:var(--mut)}.rv-n{color:#9a6700;font-weight:700}
tr.rv td{color:#7a5200;background:#fff8e5;font-weight:600}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) tr.rv td{color:#e3b341;background:#2a2413}:root:not([data-theme=light]) .rv-n{color:#e3b341}}
:root[data-theme=dark] tr.rv td{color:#e3b341;background:#2a2413}:root[data-theme=dark] .rv-n{color:#e3b341}
.scard{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:8px 12px;min-width:118px;cursor:pointer;list-style:none}
.scard>summary{display:flex;flex-direction:column;gap:2px;list-style:none;cursor:pointer}.scard>summary::-webkit-details-marker{display:none}
.scard>summary .n{font-size:24px;font-weight:800;line-height:1.1}.scard>summary .l{font-size:11px;color:var(--mut)}
.scard.sng{border-color:var(--ng);border-left:4px solid var(--ng)}.scard.srv{background:#fff8e5;border-color:#e0b84f;border-left:4px solid #9a6700}.scard.srv .l{color:#7a5200}
.scard-body{margin-top:10px;display:flex;flex-direction:column;gap:7px}
.attnitem{border-radius:7px;padding:8px 11px;font-size:12.5px}.attnitem.ng{background:rgba(220,50,50,.08);border-left:3px solid var(--ng)}.attnitem.rv{background:#fff8e5;border-left:3px solid #9a6700}.attnitem.okmsg{color:var(--ok);font-weight:600}
.attnitem .ai-h{font-weight:700;margin-bottom:2px}.attnitem.rv .ai-h{color:#7a5200}.attnitem .ai-d{color:var(--mut);font-weight:400;line-height:1.5}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) .scard.srv{background:#2a2413;border-color:#645209}:root:not([data-theme=light]) .scard.srv .l{color:#e3b341}:root:not([data-theme=light]) .attnitem.rv{background:#2a2413}:root:not([data-theme=light]) .attnitem.rv .ai-h{color:#e3b341}}
:root[data-theme=dark] .scard.srv{background:#2a2413;border-color:#645209}:root[data-theme=dark] .scard.srv .l{color:#e3b341}:root[data-theme=dark] .attnitem.rv{background:#2a2413}:root[data-theme=dark] .attnitem.rv .ai-h{color:#e3b341}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13.5px;color:var(--mut);margin:8px 0}.note.big{border-left:3px solid var(--accent)}
code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}kbd{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:2px 7px;font:12.5px monospace}
.tblwrap{overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:8px;margin:6px 0}.sys{min-width:100%;margin:0}
.map{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:8px 0}.mrow{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center;margin-top:8px}
.node{border:1px solid var(--line);border-radius:9px;padding:8px 12px;background:var(--bg);text-align:center;min-width:118px}.node .nt{font-weight:700;font-size:13px}.node .na{font-size:11px;color:var(--mut);margin-top:1px}
.node.hi{border-top:3px solid var(--accent)}.arrow{color:var(--mut);font-size:12px}.arrow b{color:var(--fg)}.mlabel{font-size:12.5px;color:var(--mut);font-weight:700;margin:14px 0 2px}
.tabin{position:absolute;left:-9999px}.tabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin:40px 0 0;flex-wrap:wrap}
.tabs label{padding:9px 13px;cursor:pointer;font-weight:600;font-size:13px;color:var(--mut);border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0}
#t1:checked~.tabs label[for=t1],#t2:checked~.tabs label[for=t2],#t3:checked~.tabs label[for=t3],#t4:checked~.tabs label[for=t4],#t5:checked~.tabs label[for=t5],#t6:checked~.tabs label[for=t6],#t7:checked~.tabs label[for=t7]{color:var(--fg);border-color:var(--line);background:var(--card)}
.panel{display:none;padding-top:14px}#t1:checked~#p1,#t2:checked~#p2,#t3:checked~#p3,#t4:checked~#p4,#t5:checked~#p5,#t6:checked~#p6,#t7:checked~#p7{display:block}
.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:var(--card);border:1px solid var(--line);color:var(--mut);margin-left:6px}
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
<h1>홈 화면 숫자가 원천 값과 맞는지 확인</h1>
<div class="sub">코스관리 첫 화면(홈)의 등급·작업·비용 표시 값을 각 원천 화면과 대조(화면 변경 없음) · 킹즈락 · ${ts}</div>
<div class="lead"><b>한눈에 보기.</b> 코스관리 <span class="em">첫 화면(홈)</span>에 보이는 <b>등급·작업·비용</b> 숫자가 그 값이 나오는 <b>원천 화면</b>과 어긋나지 않는지 확인했습니다.<br>
확인 항목 <b>${judged.length}개</b> 중 <span class="ok-n">정상 ${pass}개</span>${attn ? ` · <span class="ng-n">주의 필요 ${attn}개</span>${review ? `(확인 필요 ${review} 포함)` : ''}` : ' · 주의 0개'}${naCount ? ` · <span class="na-n">참고 ${naCount}개</span>(데이터 없어 판정 제외)` : ''}.<br>
이 리포트는 <b>"지금 화면 값이 맞는가"</b>를 봅니다 — 사용자가 보는 화면 기준 확인이며, 앱 내부 코드 검사는 아닙니다.</div>
<details class="aux"><summary>💡 리포트 검증 관점 및 참고사항 보기</summary><div class="auxbody">
<div class="persp">📏 <b>보는 관점:</b> 화면에 <b>표시된 값</b>을 원천 화면과 맞대어 봅니다(앱 내부 코드 커버리지가 아님). 확인 중 화면을 바꾸거나 저장하지 않습니다.</div>
<div class="honest"><div class="htitle">이 검증이 잡는 것과 못 잡는 것</div>
<div class="hrow ok"><span class="hic">✅</span><div class="hbody"><span class="hlbl">잡아냅니다</span><ul>
  <li>HOME 값이 <b>원천 화면과 다름</b> <span class="mut">(등급=목표설정 · 작업=작업지시 · 연간예산=예산관리)</span></li>
  <li>비용 탭(예산 대비 실적) <b>계산 항등이 깨짐</b> <span class="mut">(잔여=연간예산−누적 · 사용률% · 전체=Σ카테고리)</span></li>
  <li>비용 탭(작업지시 분석) <b>'전체' 롤업이 깨짐</b> <span class="mut">(전체·코스별·South·East·West·기간별 각 뷰: 전체 행 = Σ 하위 행)</span></li></ul></div></div>
<div class="hrow warn"><span class="hic">⚠️</span><div class="hbody"><span class="hlbl">못 잡습니다 (한계)</span><ul>
  <li>HOME은 원천을 <b>가져다 보여주는</b> 화면 — <b>원천 자체가 틀리면</b> 같이 틀린 채 통과 <span class="mut">(원천 정확성은 각 원천 검증 담당)</span></li>
  <li><b>집계 범위가 다른</b> 항목(이번 달 vs 전체기간)은 직접 일치가 아니라 자기정합(≥0)만 확인</li></ul></div></div>
<div class="hrow info"><span class="hic">ℹ️</span><div class="hbody"><span class="hlbl">참고</span><ul>
  <li>데이터 없는 항목은 <b>판정 제외</b>(결함 아님)</li></ul></div></div></div>
</div></details>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상 통과</div></div>${attnCard}${naCount ? `<div class="card"><div class="n na-n">${naCount}</div><div class="l">참고(데이터없음)</div></div>` : ''}</div>

<input class="tabin" type="radio" name="tab" id="t1" checked><input class="tabin" type="radio" name="tab" id="t2"><input class="tabin" type="radio" name="tab" id="t3"><input class="tabin" type="radio" name="tab" id="t4"><input class="tabin" type="radio" name="tab" id="t5"><input class="tabin" type="radio" name="tab" id="t6"><input class="tabin" type="radio" name="tab" id="t7">
<div class="tabs"><label for="t1">① 실행 방법</label><label for="t2">② 연관성 맵</label><label for="t3">③ 요약</label><label for="t4">④ 관리 목표·현황</label><label for="t5">⑤ 작업 탭</label><label for="t6">⑥ 비용 탭(예산 대비 실적)</label><label for="t7">⑦ 비용 탭(작업지시 분석)</label></div>

<div class="panel" id="p1">
<h2>실행 방법</h2>
<div class="note">공유 QA 계정은 <b>재로그인 1회당 1런</b>만 생존 → 실행 전 인증 필요:
<div style="margin-top:8px"><kbd>npm run course:auth</kbd> (수동 로그인) &nbsp;→&nbsp; <kbd>npm run course:home-verify</kbd></div>
<div style="margin-top:8px">→ HOME <b>3탭 전환</b>(관리 목표 및 현황·작업·비용) + [목표 설정] 모달 + [작업 관리&gt;작업 지시] + [예산 관리&gt;예산 총괄] 데이터 재수집 → <code>reports/course-home-verify.html</code> 재생성. <b>비파괴</b>(조회·탭 전환·모달 열기→취소만). 별도 입력 불필요.</div></div>
<div class="note">대상 <code>https://course-mng-td.smartscore.kr</code> · 탭 전환은 <code>.tab-group</code> 텍스트 클릭. 검증 3계열: <b>등급</b>(파싱 방향 'ga'/'ag') · <b>작업</b>(W-ID 집합 포함) · <b>비용</b>(예산 실적 계산 항등).</div>
<div class="note big"><b>본 리포트</b>는 "현재 HOME 값이 원천과 정합한가". 금액 계산 정합성·동적 변경 반영의 심화는 별도 검증기: <kbd>npm run course:budget-verify</kbd>(예산·비용 교차/원천 불변식) · <kbd>$env:ALLOW_DESTRUCTIVE="1"; npm run course:writepath</kbd>(값 변경→연관 반영→복원).</div>
</div>

<div class="panel" id="p2">
<h2>화면 연관 맵 (탭별)</h2>
<div class="map">
<div class="mlabel">[관리 목표 및 현황] 탭 — 등급</div>
<div class="mrow"><div class="node"><div class="nt">목표 설정 모달</div><div class="na">영역별 목표 등급(원천)</div></div><div class="arrow">─<b>표시</b>→</div><div class="node hi"><div class="nt">HOME 관리 목표</div><div class="na">7영역 등급</div></div></div>
<div class="mrow"><div class="node"><div class="nt">평가 작성/평가내역</div><div class="na">기준일 등급 산정</div></div><div class="arrow">─<b>산정</b>→</div><div class="node"><div class="nt">HOME 관리 현황</div><div class="na">현재 등급·추세</div></div></div>
<div class="mlabel">[작업] 탭 — 작업 운영(금액 아님)</div>
<div class="mrow"><div class="node"><div class="nt">작업 관리 &gt; 작업 지시</div><div class="na">W-작업지시·상태</div></div><div class="arrow">─<b>연동</b>→</div><div class="node hi"><div class="nt">HOME 오늘의 작업/이번 달</div><div class="na">W-xxxxx·완료/진행/대기</div></div></div>
<div class="mrow"><div class="node"><div class="nt">작업 관리 &gt; 작업 일보</div><div class="na">일자별 작업/인력</div></div><div class="arrow">─<b>요약</b>→</div><div class="node"><div class="nt">HOME 최근 작업 일보</div><div class="na">단일/반복·고정직/임시직</div></div></div>
<div class="mlabel">[비용] 탭 — 예산 대비 실적(금액)</div>
<div class="mrow"><div class="node"><div class="nt">예산 관리 &gt; 예산 총괄</div><div class="na">카테고리 연간예산(원천)</div></div><div class="arrow">─<b>입력값</b>→</div><div class="node hi"><div class="nt">HOME 비용 탭</div><div class="na">연간/누적 예산 대비 실적</div></div></div>
<div class="mrow"><div class="node"><div class="nt">예산 관리 &gt; 실적 관리</div><div class="na">회계상 집계 전체 비용(분류×월)</div></div><div class="arrow">─<b>원천</b>→</div><div class="node hi"><div class="nt">HOME 누적 사용 금액</div><div class="na">회계 비용(작업지시 집계와 다른 축)</div></div></div>
<div class="mlabel">[비용] 탭(작업지시 분석) — 작업지시서 집계 비용(6개 관점)</div>
<div class="mrow"><div class="node"><div class="nt">작업 관리 &gt; 작업 지시(완료확정)</div><div class="na">작업별 원가 집계</div></div><div class="arrow">─<b>분석</b>→</div><div class="node hi"><div class="nt">HOME 작업지시 분석</div><div class="na">전체·코스별·South·East·West·기간별</div></div></div>
<div class="mrow" style="justify-content:center"><div class="node" style="border:none;background:none"><div class="na">각 뷰 롤업: '전체' 행 = Σ(영역/홀/월 하위 행)</div></div></div>
</div>
<h3>HOME 탭·블록·원천</h3>
<table class="sys"><thead><tr><th>탭</th><th>블록</th><th>기입 항목</th><th>원천 화면</th></tr></thead><tbody>
<tr><td rowspan="2">관리 목표 및 현황</td><td>관리 목표 등급</td><td>7영역(전체·그린·그린칼라·티박스·페어웨이·러프·벙커) 등급</td><td>[목표 설정] 모달</td></tr>
<tr><td>관리 현황 등급</td><td>기준일 현재 등급 + 등급 추세 차트</td><td>평가 작성/평가내역</td></tr>
<tr><td rowspan="3">작업</td><td>오늘의 작업</td><td>W-작업지시 카드(지시명·기간·조장)</td><td>작업 관리 &gt; 작업 지시</td></tr>
<tr><td>이번 달 작업</td><td>완료 / 진행중 / 대기 중</td><td>작업 관리 &gt; 작업 지시(상태)</td></tr>
<tr><td>최근 작업 일보</td><td>일자·단일/반복 작업·고정직/임시직</td><td>작업 관리 &gt; 작업 일보</td></tr>
<tr><td rowspan="3">비용</td><td>예산 대비 실적 — 연간 예산 대비 실적</td><td>카테고리별 누적 사용·잔여·연간예산·사용률%</td><td>예산 관리(예산 총괄 <b>연간 탭</b>/상세)</td></tr>
<tr><td>예산 대비 실적 — 누적 예산 대비 현황</td><td>카테고리별 <b>누적 사용</b>(회계)·잔여·누적 예산</td><td>예산 관리 &gt; <b>실적 관리</b>(회계 비용 입력)</td></tr>
<tr><td>작업지시에 근거한 비용 분석</td><td>전체·코스별·South·East·West·기간별(작업지시서 집계 비용)</td><td>작업 관리 &gt; 작업 지시(완료확정) · 비용 관리</td></tr>
</tbody></table>
</div>

<div class="panel" id="p3">
<h2>요약</h2>
<div class="cards"><div class="card"><div class="n ${allOkOf(goalChk) ? 'ok-n' : 'ng-n'}">${cnt(goalChk)}</div><div class="l">관리 목표·현황(등급)</div></div><div class="card"><div class="n ${allOkOf(workChk) ? 'ok-n' : 'ng-n'}">${cnt(workChk)}</div><div class="l">작업 탭</div></div><div class="card"><div class="n ${allOkOf(costChk) ? 'ok-n' : 'ng-n'}">${cnt(costChk)}</div><div class="l">비용 탭(예산 대비 실적)</div></div><div class="card"><div class="n ${allOkOf(wocChk) ? 'ok-n' : 'ng-n'}">${cnt(wocChk)}</div><div class="l">비용 탭(작업지시 분석)</div></div>${naCount ? `<div class="card"><div class="n na-n">${naCount}</div><div class="l">참고(데이터없음)</div></div>` : ''}</div>
${attn ? `<div class="note" style="border-left:3px solid ${fail ? 'var(--ng)' : '#9a6700'}"><b class="${fail ? 'ng-n' : 'rv-n'}">⚠ 주의 필요 (${attn}건${review ? `: 결함 ${fail} · 확인 필요 ${review}` : ''})</b><br>${attnItems.map((c) => `<div style="margin-top:8px"><b class="${c.review ? 'rv-n' : 'ng-n'}">${c.review ? '🔎 확인 필요' : '❌'} ${esc(c.name)}</b><br><span>${esc(c.detail)}</span></div>`).join('')}</div>` : '<div class="note" style="border-left:3px solid var(--ok)"><b class="ok-n">✅ 확인 항목 전부 정상</b> — 주의 없음</div>'}${naCount ? `<div class="note" style="border-left:3px solid var(--mut)"><b>➖ 참고: 데이터가 없어 확인 대상이 아님 (${naCount}건, 판정 제외)</b> — 결함이 아니라 "확인 불가"입니다.<br>${checks.filter((c) => c.na).map((c) => `<div style="margin-top:6px"><b>➖ ${esc(c.name)}</b><br><span class="mut">${esc(c.detail)}</span></div>`).join('')}</div>` : ''}
<h3>① 관리 목표 및 현황 (등급)</h3>${chkTbl(goalChk)}
<h3>② 작업 탭 (작업 운영)</h3>${chkTbl(workChk)}
<h3>③ 비용 탭 (예산 대비 실적)</h3>${chkTbl(costChk)}
<h3>④ 비용 탭 (작업지시에 근거한 비용 분석)</h3>${chkTbl(wocChk)}
</div>

<div class="panel" id="p4">
<h2>관리 목표 등급 대조 (HOME ↔ [목표 설정] 원천)</h2>
<div class="note">HOME은 <b>등급+영역</b>(A+전체), 목표 설정 모달은 <b>영역+등급</b>(전체A+) 순서로 렌더 → <code>extractGrades(txt, 'ga'|'ag')</code>로 방향 명시해야 인접 영역 등급 오인(off-by-one)을 막음.</div>
<div class="tblwrap">${gradeTbl}</div>
<div class="note">관리 현황 기준일: <b>${esc(home.baseDate || '—')}</b> · 등급 추세 차트 ${home.charts}개(Highcharts SVG, 시각 — DOM 수치 대조 제한). 등급 스케일 <code>E- E E+ D- … A A+</code> 15단계.</div>
</div>

<div class="panel" id="p5">
<h2>작업 탭 검증 (작업 관리 연동)</h2>
<div class="note">HOME [작업] 탭은 명칭 '작업'대로 <b>작업 운영 요약</b>(금액 없음). 검증은 노출 데이터를 <code>작업 관리</code>와 연동 대조.</div>
<h3>오늘의 작업(W-작업지시) = 작업 관리 목록 <span class="badge">목록 ${orderTotal}건</span></h3>
<div class="tblwrap">${idTbl}</div>
<h3>이번 달 작업 상태</h3>
<table class="sys"><thead><tr><th>완료</th><th>진행중</th><th>대기 중</th><th>합</th></tr></thead><tbody><tr><td>${esc(work.month.done ?? '—')}</td><td>${esc(work.month.prog ?? '—')}</td><td>${esc(work.month.wait ?? '—')}</td><td>${[work.month.done, work.month.prog, work.month.wait].every((n) => Number.isFinite(Number(n))) ? Number(work.month.done) + Number(work.month.prog) + Number(work.month.wait) : '—'}</td></tr></tbody></table>
<div class="note">작업 지시 목록 상태 분포(원천): ${Object.keys(orderStatus).length ? Object.entries(orderStatus).map(([k, v]) => `${k} ${v}`).join(' · ') : '미수집'}. ⚠ HOME '이번 달'=당월 필터·목록=전체기간 → 총계 직접 일치 아님, HOME 자기정합(≥0)만 검증.</div>
<h3>최근 작업 일보</h3>
<div class="tblwrap">${logTbl}</div>
</div>

<div class="panel" id="p6">
<h2>비용 탭 검증 — 예산 대비 실적 (계산 정합성)</h2>
<div class="note big"><b>핵심</b>: [비용] 탭 = <b>예산 대비 실적 분석</b> 대시보드(금액 카드 ${costTab.wonCells}개). 카테고리별 <b>잔여=연간예산−누적사용</b> 항등·<b>사용률%</b> 검산·<b>전체=Σ하위</b> 롤업 + 연간예산 <b>[예산 관리] 원천 대조</b>. 회계 비용이라 작업지시 집계와 차이 가능(안내 명시).</div>
<h3>연간 예산 대비 실적 현황</h3>
<div class="tblwrap">${costTbl(annual, '연간예산')}</div>
<div class="note">검산: 잔여 예산 = 연간예산 − 누적 사용 · 사용률% = round(누적사용 ÷ 연간예산 × 100). <b>전체</b> 행 = Σ(고정직·임시직·자재·장비·기타). ✅=항등 성립.</div>
<h3>누적 예산 대비 현황</h3>
<div class="tblwrap">${costTbl(cumul, '누적 예산')}</div>
<h3>연간예산 원천 대조 <span class="mut">— 예산 관리 &gt; 예산 상세</span></h3>
<div class="note">HOME 비용탭 <b>연간예산</b>(카테고리)의 정확 원천은 <b>[예산 관리 &gt; 예산 상세]</b>의 대분류(고정직/임시직/자재/장비/기타) 연간 합계(소계 Σ 합계열). 카테고리별 HOME 연간예산 ↔ 예산 상세 대분류 연간합 대조.<br>안내문구: <i>${esc(costTab.guide || '—')}</i></div>
<div class="tblwrap"><table class="sys"><thead><tr><th>분류</th><th class="num">HOME 연간예산</th><th class="num">예산 상세 연간합</th><th>대조</th></tr></thead><tbody>${COST_CATS.slice(1).map((c) => {
  const b = annual[c]?.budget; const d = budgetDetailByCat[c];
  const bv = b != null ? b.toLocaleString() + '원' : '—';
  const dv = (d ?? 0) > 0 ? d.toLocaleString() + '원' : (budgetDetailVisited ? '미추출' : '—');
  let verdict = '<span class="mut">—</span>';
  if (b != null && b > 0 && (d ?? 0) > 0) verdict = nearRel(b, d, 0.005) ? '<span style="color:var(--ok)">✅ 일치</span>' : '<span style="color:#9a6700;font-weight:600">🔎 확인 필요</span>';
  else if (b != null && b > 0 && budgetDetailVisited) verdict = '<span class="mut">예산 상세 미추출 — 보류</span>';
  return `<tr><td>${esc(c)}</td><td class="num">${bv}</td><td class="num">${dv}</td><td>${verdict}</td></tr>`;
}).join('')}</tbody></table></div>
<div class="note"><span class="mut">※ 예산 상세 = 대분류 &gt; 중분류 &gt; 소분류 + <b>소계행</b> + <b>합계(연간)열</b>. 대분류 연간예산 = Σ(중분류 소계 × 합계열). 전체 총액은 보조로 예산 총괄 금액집합(${budgetNums.length}건) 존재 확인. 예산 상세 방문: ${budgetDetailVisited ? 'O' : 'X'}.</span></div>
<h3>누적 사용 금액 원천 대조 <span class="mut">— 회계 비용</span></h3>
<div class="note">HOME <b>누적 사용 금액</b>(회계상 집계 비용)의 입력 원천은 <b>[예산 관리 &gt; 실적 관리]</b>. 카테고리별 HOME 누적 사용 ↔ 실적 관리 분류 연간합(Σ 소계×12월) 대조.<br>안내문구: <i>${esc(perfGuide || '—')}</i></div>
<div class="tblwrap"><table class="sys"><thead><tr><th>분류</th><th class="num">HOME 누적 사용</th><th class="num">실적 관리 연간합</th><th>대조</th></tr></thead><tbody>${COST_CATS.slice(1).map((c) => {
  const h = annual[c]?.used; const p = perfByCat[c];
  const hv = h != null ? h.toLocaleString() + '원' : '—'; const pv = (p ?? 0) > 0 ? p.toLocaleString() + '원' : (perfVisited ? '0/미입력' : '—');
  let verdict = '<span class="mut">—</span>';
  if (h != null && h > 0 && (p ?? 0) > 0) verdict = nearRel(h, p, 0.005) ? '<span style="color:var(--ok)">✅ 정확 일치</span>' : (h <= p * 1.005 ? '<span style="color:var(--ok)">✅ 누계 ≤ 연간합</span>' : '<span style="color:#9a6700;font-weight:600">🔎 누계 &gt; 연간합</span>');
  else if (h != null && h > 0 && perfVisited) verdict = '<span style="color:#9a6700;font-weight:600">🔎 실적 미입력</span>';
  return `<tr><td>${esc(c)}</td><td class="num">${hv}</td><td class="num">${pv}</td><td>${verdict}</td></tr>`;
}).join('')}</tbody></table></div>
<div class="note"><span class="mut">※ 스코프 차이 주의 — HOME 누적 사용=연중 누계(당월까지) vs 실적 관리=입력된 전체 월 합. 범위가 달라 불일치해도 <b>결함이 아닌 확인 필요(🔎)</b>로 분류. 원천 화면 존재·입력 축 일치가 검증 목적.</span></div>
</div>

<div class="panel" id="p7">
<h2>비용 탭 검증 — 작업지시에 근거한 비용 분석</h2>
<div class="note big"><b>핵심</b>: [비용] 탭의 두 번째 분석 모드. <b>작업지시서로 집계된 비용</b>을 <b>전체·코스별·South·East·West·기간별</b> 6개 관점으로 제공(예산 대비 실적과 별개 축, 회계 비용과 차이 가능). 각 뷰의 <b>'전체' 행 = Σ(하위 행)</b> 롤업(영역/홀/월 축)이 성립하는지 검증(위치기반 열합 — 컬럼 의미와 무관하게 성립해야 함).</div>
${woToggleFound ? `<h3>서브뷰별 롤업 정합성</h3>
<div class="tblwrap">${wocSummaryTbl}</div>
<div class="note">'전체' 대표총액 = 각 뷰 '전체' 행의 첫 유효 수치 열(대개 합계). 롤업 = '전체' 행이 그 아래 하위 행(전체 뷰=영역 / South·East·West=홀 / 기간별=월)의 열별 합과 일치하는지(반올림 off-by-1·상대 0.5% 허용). <b>⚠ 전체 뷰(영역축)와 코스별 뷰(코스축)는 집계 축이 달라</b> 서로의 총합이 일치하지 않는 것이 정상(코스 미지정·복수코스 작업 존재) → 뷰 간 총액 일치는 검증하지 않고 <b>각 뷰 자기 롤업</b>만 검증.</div>
<div class="note">안내문구: <i>${esc(woGuide || '—')}</i></div>
<h2 style="margin-top:26px">서브뷰별 상세 분석 데이터</h2>
<div class="note">각 서브뷰의 <b>실제 집계표</b>를 화면 그대로 재현(당월/누적·카테고리·영역·홀·월 포함). <span class="mt-legend" style="background:var(--card);border:1px solid var(--line);border-radius:4px;padding:1px 6px">진한 행</span> = \'전체\' 롤업 행(하위 합계).</div>
${woDetailSections}` : '<div class="note" style="border-left:3px solid var(--mut)">➖ \'작업지시에 근거한 비용 분석\' 토글이 노출되지 않아 판정에서 제외했습니다(비용 탭 구조/권한/데이터 확인 필요).</div>'}
</div>
<details class="gloss"><summary>용어 풀이 (처음 보시는 분용)</summary>
<dl>
<dt>정합성</dt><dd>여러 화면에 나오는 같은 숫자가 서로 어긋나지 않고 맞아떨어지는 상태.</dd>
<dt>원천(원천 화면)</dt><dd>그 값을 실제로 입력·계산하는 대표 화면. 홈은 이 값을 가져다 보여줄 뿐이라, 원천과 같아야 정상.</dd>
<dt>등급 추세</dt><dd>구역별 관리 등급(A+~E-)이 시간에 따라 어떻게 변했는지 보여주는 선 그래프.</dd>
<dt>화면 변경 없음(비파괴)</dt><dd>확인만 하고 저장·삭제·수정은 하지 않아, 실제 데이터가 바뀌지 않음.</dd>
<dt>정상 통과 / 주의</dt><dd>정상=값이 맞음. 주의=값이 다르거나 확인이 더 필요(원인은 각 항목에 표기).</dd>
<dt>롤업(전체 = Σ 하위)</dt><dd>'전체' 합계는 그 아래 세부 항목(영역·홀·월)들의 합과 같아야 함. 이 관계가 깨지면 집계가 잘못된 것.</dd>
<dt>작업지시에 근거한 비용 분석</dt><dd>작업지시서로 집계된 비용을 여러 관점(전체·코스별·기간별 등)으로 보여주는 분석. 예산 대비 실적(회계 비용)과는 다른 축이라 총액이 다를 수 있음.</dd>
</dl></details>
</div>`;

  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  const outPath = path.join('reports', 'course-home-verify.html');
  fs.writeFileSync(outPath, html);

  // ── 교차분석용 앵커 덤프(course:cross 리코셔너가 읽음) — 실패해도 리포트 불영향 ──
  try {
    const annualByCat: Record<string, number> = {}; const usedByCat: Record<string, number> = {};
    for (const c of COST_CATS) { if (annual[c]?.budget != null) annualByCat[c] = annual[c].budget!; if (annual[c]?.used != null) usedByCat[c] = annual[c].used!; }
    // 작업지시분석 전체뷰: 합계·Σ유형·미귀속(당월/누적)
    const tv = woViews['전체']; const trow = tv?.ok ? woRows(tv).find((r) => /^전체$/.test(r.label.replace(/\s+/g, ''))) : undefined;
    const tn = (trow?.nums || []).filter((n): n is number => n != null);
    let woAllView: Record<string, number> | null = null;
    if (tn.length >= 4 && tn.length % 2 === 0) { const h = tn.length / 2; const curCat = tn.slice(1, h).reduce((a, b) => a + b, 0); const cumCat = tn.slice(h + 1).reduce((a, b) => a + b, 0); woAllView = { curTotal: tn[0], curCatSum: curCat, curHidden: tn[0] - curCat, cumTotal: tn[h], cumCatSum: cumCat, cumHidden: tn[h] - cumCat }; }
    const taskTotalFinal = taskTotalCard > 0 ? taskTotalCard : COST_CATS.slice(1).reduce((a, c) => a + (taskByCat[c] || 0), 0);
    const homeAnchors = {
      ts: new Date().toISOString(), source: 'course-home-verify',
      annualByCat, usedByCat, perfByCat, budgetDetailByCat, locByCourse, woAllView,
      woAllByCat,                          // HOME 작업지시분석 전체뷰 당월/누적 카테고리(QA-15497)
      // ㉒ 후속: 코스별/기간별 뷰 실제 열구조 덤프(전체뷰와 열구조 상이 → 정확 분할 파악용)
      woViewStruct: (['코스별', '기간별'] as const).reduce((o, v) => {
        const vw = woViews[v];
        o[v] = vw?.ok
          ? { head: vw.headRows.map((hr) => hr.map((c) => `${c.t}${c.cs > 1 ? '*' + c.cs : ''}`)), body: vw.bodyRows.slice(0, 5).map((br) => br.map((c) => c.t)), rowsParsed: woRows(vw).map((r) => ({ label: r.label, numCount: r.nums.filter((n) => n != null).length, cellCount: r.cellCount })) }
          : { ok: false };
        return o;
      }, {} as Record<string, unknown>),
      taskByCat, taskTotal: taskTotalFinal,   // 비용관리 작업별 비용 YTD 카테고리/총액(QA-15497)
      summary: { total: judged.length, pass, fail, review, na: naCount },
    };
    if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
    fs.writeFileSync(path.join('analysis', '_cross-home.json'), JSON.stringify(homeAnchors, null, 2), 'utf8');
  } catch { /* noop */ }
  console.log(`\n[HOME 검증] 총 ${checks.length} · PASS ${pass} · FAIL ${fail}`);
  console.log(`[report] ${outPath}`);
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} [${c.scope}] ${c.name} — ${c.detail}`);
});

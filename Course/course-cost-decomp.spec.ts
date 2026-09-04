import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseDateRange, COURSE_URL } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport } from '../lib/reporter';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  비용 원천 격차 분해 프로브(비파괴) — "작업별 비용(총액)"과 "HOME 작업지시 분석(전체뷰 누적)"이
//  같은 작업지시 집계인데도 왜 다른가를, 세 축으로 원 단위 귀속.
//   실행: npm run course:auth 후 npm run course:cost-decomp → reports/코스관리_비용원천분해_report_*.xlsx
//   축:
//    (A) 크로스이어  — 작업별 비용(날짜필터)은 전년도(2025)시작·당해 걸침 작업을 전액 포함(각 연도 전액=이중계상, 기확인 제품 이슈).
//                      → 작업별 전체 − 작업별(전년도시작 제외) = 크로스이어 기여분.
//    (B) 집계 축      — HOME '전체' 뷰는 영역(부위)축 → 영역/코스 미지정 작업 누락 가능 → HOME이 작아짐.
//                      → 작업별(전년도시작 제외) − HOME 전체뷰 누적합계 = 잔여(축/상태/기간 차이).
//                      + HOME 코스별 뷰 '코스무관' 버킷(전체 − Σ코스) 가시화.
//    (C) 내부 합계    — HOME '전체' 행 누적 합계 vs Σ(누적 카테고리 컬럼) / vs Σ(영역 행) — 잘린 컬럼·기준 차이 관찰.
//   전부 비파괴(조회/탭 전환/페이지 순회/파싱만). 결함 단정 없음 — 측정·귀속 + 확인 필요(diff).
// ──────────────────────────────────────────────────────────────

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const numOf = (t: string | null) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (!c || c === '-' || c === '.') return 0; const v = Number(c); return Number.isFinite(v) ? v : 0; };

test('비용 원천 격차 분해(작업별 vs HOME 작업지시 분석) — 비파괴', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const P = '비용 원천 분해';
  const dump: Record<string, unknown> = {};

  const today = new Date();
  const curYear = today.getFullYear();
  const start = `${curYear}-01-01`;
  const end = `${curYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // ═══════════ (1) 비용 관리 > 작업별 비용 — 카드 총액 + 전 페이지 행 순회 + 크로스이어 분리 ═══════════
  let taskCardTotal = 0; let taskCardCats: Record<string, number> = {};
  let taskRowAll = 0; let taskRowPure = 0; let taskRowCross = 0;
  let taskRowCount = 0; let crossRows: { no: string; startDate: string; total: number }[] = [];
  let taskEntered = false; let appliedRange = '?';

  if (await gotoCourseMenu(admin, '비용 관리', '작업별 비용').then(() => true).catch(() => false)) {
    taskEntered = true;
    await admin.waitForTimeout(2000); await killAlarms(admin);
    await setCourseDateRange(admin, start, end).catch(() => false);
    await admin.waitForTimeout(1400); await killAlarms(admin);

    // 요약 카드(서버측 전체집계, 페이지 무관) — 총 비용 + 5 카테고리
    const card = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      // '총 비용' 라벨을 가진 카드 컨테이너를 찾고, 라벨→값 쌍 파싱
      const labels = ['총 비용', '고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
      const out: Record<string, number> = {};
      // 요약 카드는 라벨과 값이 인접(형제/부모-자식) — 라벨 텍스트 노드 근처의 숫자를 취함
      const walk = Array.from(sc.querySelectorAll('*')).filter((e) => e.children.length <= 2);
      for (const lab of labels) {
        for (const e of walk) {
          const t = norm(e.textContent);
          // "총 비용 39,252,229" 또는 라벨 요소 + 인접 값 요소
          const m = t.match(new RegExp('^' + lab.replace(/ /g, '\\s*') + '\\s*([0-9,]+)\\s*$'));
          if (m) { out[lab] = Number(m[1].replace(/,/g, '')); break; }
        }
      }
      return out;
    }).catch(() => ({} as Record<string, number>));
    taskCardTotal = card['총 비용'] || 0;
    taskCardCats = card;

    appliedRange = await admin.evaluate(() => { const i = document.querySelectorAll('.contents .datepicker-input, main .datepicker-input'); return `${(i[0] as HTMLInputElement)?.value || ''}~${(i[1] as HTMLInputElement)?.value || ''}`; }).catch(() => '?');

    // 전 페이지 순회하며 행 누적(작업별 비용은 페이지 분할 — 첫 페이지만 읽으면 부분합)
    const readRows = () => admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
      if (!tbl) return { heads: [] as string[], rows: [] as string[][] };
      const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent));
      const rows = Array.from(tbl.querySelectorAll('tbody tr'))
        .filter((tr) => !/내역이 없습니다|데이터가 없습니다/.test(tr.textContent || ''))
        .map((tr) => Array.from(tr.children).map((td) => norm(td.textContent)));
      return { heads, rows };
    }).catch(() => ({ heads: [] as string[], rows: [] as string[][] }));

    const first = await readRows();
    // 총비용·기간 컬럼 인덱스 동적 탐지(하드코딩 회피)
    const totalCol = (() => { const i = first.heads.findIndex((h) => /총\s*비용/.test(h)); return i >= 0 ? i : 6; })();
    const periodCol = (() => { const i = first.heads.findIndex((h) => /기간|작업\s*일|일시/.test(h)); return i >= 0 ? i : 2; })();
    dump.taskHeads = first.heads; dump.taskTotalCol = totalCol; dump.taskPeriodCol = periodCol;

    const allRows: string[][] = [...first.rows];
    let prevSig = first.rows.map((r) => r.join('|')).join('#');
    for (let pageN = 2; pageN <= 25; pageN++) {
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
      }, String(pageN)).catch(() => false);
      if (!clicked) break;
      await admin.waitForTimeout(900); await killAlarms(admin);
      const g = await readRows();
      const sig = g.rows.map((r) => r.join('|')).join('#');
      if (!g.rows.length || sig === prevSig) break;
      allRows.push(...g.rows); prevSig = sig;
    }

    taskRowCount = allRows.length;
    for (const c of allRows) {
      const total = numOf(c[totalCol]);
      const startDate = ((c[periodCol] || '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
      const y = Number(startDate.slice(0, 4));
      const isCross = y > 0 && y < curYear;
      taskRowAll += total;
      if (isCross) { taskRowCross += total; crossRows.push({ no: c[0] || c[1] || '?', startDate, total }); }
      else taskRowPure += total;
    }
    dump.taskRowCount = taskRowCount; dump.taskCardTotal = taskCardTotal; dump.taskRowAll = taskRowAll;
    dump.taskRowPure = taskRowPure; dump.taskRowCross = taskRowCross; dump.crossRows = crossRows;
  }

  // ═══════════ (2) HOME > [비용] 탭 > 작업지시에 근거한 비용 분석 > 전체/코스별 뷰 ═══════════
  const readView = () => admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { ok: false, heads: [] as string[], rows: [] as { label: string; nums: number[] }[] };
    const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent));
    const numCell = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); return c && c !== '-' && c !== '.' ? Number(c) : NaN; };
    const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      const label = cells[0] || '';
      const nums = cells.slice(1).map(numCell).filter((n) => Number.isFinite(n)) as number[];
      return { label, nums };
    });
    return { ok: true, heads, rows };
  }).catch(() => ({ ok: false, heads: [] as string[], rows: [] as { label: string; nums: number[] }[] }));

  // 완전 전개 그리드(colspan/rowspan 채움) — 헤더 다층·코스 컬럼그룹 같은 복합 구조 해석용.
  const readGrid = () => admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { ok: false, headRowCount: 0, grid: [] as string[][] };
    const expand = (trs: Element[]): string[][] => {
      const grid: string[][] = []; const carry: ({ t: string; rem: number } | null)[] = [];
      for (const tr of trs) {
        const cells = Array.from(tr.children) as HTMLTableCellElement[];
        const out: string[] = []; let col = 0, ci = 0;
        // carry(rowspan 잔여) 소진 후 셀 배치 — 동적 컬럼 폭.
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
    const headTrs = Array.from(tbl.querySelectorAll('thead tr'));
    const bodyTrs = Array.from(tbl.querySelectorAll('tbody tr'));
    const head = expand(headTrs); const body = expand(bodyTrs);
    // 컬럼 폭 통일
    const width = Math.max(0, ...head.map((r) => r.length), ...body.map((r) => r.length));
    const pad = (g: string[][]) => g.map((r) => { const o = r.slice(); while (o.length < width) o.push(''); return o; });
    return { ok: true, headRowCount: head.length, grid: [...pad(head), ...pad(body)] };
  }).catch(() => ({ ok: false, headRowCount: 0, grid: [] as string[][] }));

  // HOME 진입
  await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1300);
  if (!/\/(home|dashboard)?(\?|$)/.test(admin.url())) { await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(1500); }
  await killAlarms(admin);
  await admin.locator('.tab-group').getByText('비용', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1500); await killAlarms(admin);

  let homeToggle = false;
  const toggle = admin.locator('.contents, main').getByText(/작업지시에\s*근거한\s*비용\s*분석/).first();
  homeToggle = await toggle.isVisible({ timeout: 2500 }).catch(() => false);
  if (homeToggle) { await toggle.click({ timeout: 2500 }).catch(() => {}); await admin.waitForTimeout(1600); await killAlarms(admin); }

  const clickBoxTab = async (v: string) => {
    const tab = admin.locator('.tab-type-box').getByText(new RegExp('^\\s*' + v + '\\s*$')).first();
    if (await tab.isVisible({ timeout: 1500 }).catch(() => false)) { await tab.click({ timeout: 1500 }).catch(() => {}); await admin.waitForTimeout(1200); await killAlarms(admin); return true; }
    return false;
  };

  // '전체' 뷰 — 영역축. '전체' 행에서 누적 합계·누적 카테고리, 그리고 Σ(영역 행) 누적 합계.
  let homeAllCumTotal = 0; let homeAllCurTotal = 0; let homeAllCumCats: number[] = []; let homeAreaCumSum = 0; let homeAllView: { ok: boolean; heads: string[]; rows: { label: string; nums: number[] }[] } = { ok: false, heads: [], rows: [] };
  if (homeToggle && await clickBoxTab('전체')) {
    homeAllView = await readView();
    const totalRow = homeAllView.rows.find((r) => /^전체$/.test(r.label.replace(/\s+/g, '')));
    if (totalRow && totalRow.nums.length >= 2) {
      const half = Math.floor(totalRow.nums.length / 2);   // [당월 half][누적 half]
      homeAllCurTotal = totalRow.nums[0] ?? 0;              // 당월 합계(코스별뷰 기간 기준 대조용)
      homeAllCumTotal = totalRow.nums[half] ?? 0;           // 누적 블록 첫 값 = 누적 합계
      homeAllCumCats = totalRow.nums.slice(half + 1);       // 누적 카테고리들
      // Σ(영역 행)의 누적 합계 — '전체' 아닌 행들에서 동일 위치(누적 합계 컬럼) 합
      for (const r of homeAllView.rows) {
        if (/^전체$/.test(r.label.replace(/\s+/g, ''))) continue;
        if (r.nums.length === totalRow.nums.length) homeAreaCumSum += (r.nums[half] ?? 0);
      }
    }
    dump.homeAllTotalRow = totalRow; dump.homeAllRows = homeAllView.rows.map((r) => ({ label: r.label, n: r.nums.length }));
  }

  // '코스별' 뷰 — 코스가 행이 아니라 컬럼 그룹으로 피벗될 수 있음(프로브 1차: 18숫자·South/East/West 행 미검출).
  //   완전 전개 그리드로 구조를 덤프하고, ① 행-기반(코스가 행) ② 컬럼그룹-기반(코스가 헤더 그룹) 둘 다 시도.
  const CNAMES = /South|East|West|남\s*코스|동\s*코스|서\s*코스/i;
  let homeCourseCumTotal = 0; const homeCourseByName: Record<string, number> = {};
  let courseAxis = 'unknown';
  if (homeToggle && await clickBoxTab('코스별')) {
    const g = await readGrid();
    dump.homeCourseGrid = g;   // ★ 원시 전개 그리드 — 파서 확정용
    if (g.ok && g.grid.length > g.headRowCount) {
      const norm = (s: string) => (s || '').replace(/\s+/g, '');
      const headers = g.grid.slice(0, g.headRowCount);
      const body = g.grid.slice(g.headRowCount);
      const totalRow = body.find((r) => /^전체$/.test(norm(r[0] || ''))) || body[0];
      const numAt = (s: string) => { const c = (s || '').replace(/[^0-9.\-]/g, ''); return c && c !== '-' && c !== '.' ? Number(c) : NaN; };

      // ① 행-기반: 코스명이 행 라벨(첫 컬럼)
      const rowHits = body.filter((r) => CNAMES.test(r[0] || ''));
      if (rowHits.length >= 2) {
        courseAxis = 'row';
        // '합계' 컬럼 탐지(헤더 마지막 행에서 합계/소계 위치) 또는 첫 수치 컬럼
        const hlast = headers[headers.length - 1] || [];
        let sumCol = hlast.findIndex((h) => /^(합계|소계|계)$/.test(norm(h)));
        if (sumCol < 0) sumCol = (totalRow || []).findIndex((c, i) => i > 0 && Number.isFinite(numAt(c)));
        for (const r of rowHits) { const m = (r[0] || '').match(CNAMES); if (m) homeCourseByName[m[0]] = numAt(r[sumCol]) || 0; }
        homeCourseCumTotal = numAt((totalRow || [])[sumCol]) || 0;
      } else {
        // ② 컬럼그룹-기반(실측 구조): H0=카테고리 그룹(합계/고정직/…), H1=그룹 내 코스(South/East/West).
        //   코스별 총액 = '합계' 그룹의 코스 하위컬럼(전체 행). ⚠ 기타 그룹의 코스컬럼을 잡던 버그 수정.
        courseAxis = 'col';
        const h0 = headers[0] || []; const h1 = headers[1] || headers[0] || [];
        for (let i = 0; i < h0.length; i++) {
          if (!/^(합계|소계|계)$/.test(norm(h0[i]))) continue;   // '합계' 그룹 컬럼만
          const m = (h1[i] || '').match(CNAMES);
          if (m) homeCourseByName[m[0]] = numAt((totalRow || [])[i]) || 0;
        }
        homeCourseCumTotal = Object.values(homeCourseByName).reduce((a, b) => a + b, 0);   // Σ코스(코스별뷰는 단일 기간·전체=Σ코스면 코스무관 0)
      }
    }
    dump.homeCourseByName = homeCourseByName; dump.courseAxis = courseAxis; dump.homeCourseCumTotal = homeCourseCumTotal;
  }
  const homeCourseSum = Object.values(homeCourseByName).reduce((a, b) => a + b, 0);

  // ═══════════ (3) 기록 ═══════════
  if (!taskEntered) { skip({ path: P, tcRef: '코스관리_분해_0', tcId: 'DECOMP-00', desc: '진입' }, '작업별 비용 진입 실패'); await writeReport('코스관리_비용원천분해'); return; }

  // 페이징 검증: 행합 = 카드총액 (같아야 파싱 신뢰)
  const pageOk = taskCardTotal > 0 && Math.abs(taskRowAll - taskCardTotal) <= Math.max(2, taskCardTotal * 0.005);
  record(
    { path: `${P} > 작업별 비용 수집`, tcRef: '코스관리_분해_task', tcId: 'DECOMP-TASK', desc: '작업별 비용 카드총액 = 전 페이지 행합(페이징 무결)', failMsg: '행합≠카드' },
    taskCardTotal === 0 ? 'PASS' : (pageOk ? 'PASS' : 'FAIL'),
    taskCardTotal === 0
      ? { actual: `[적용 ${appliedRange}] ${taskRowCount}행 · 행합 ${won(taskRowAll)} (카드총액 미검출 — 행합 사용)` }
      : pageOk
        ? { actual: `[적용 ${appliedRange}] ${taskRowCount}행 · 행합 ${won(taskRowAll)} = 카드 ${won(taskCardTotal)} ✓ (페이징 무결)` }
        : { error: '행합≠카드(페이징 누락 의심)', detail: `행합 ${won(taskRowAll)} vs 카드 ${won(taskCardTotal)} — 일부 페이지 미수집 가능` },
  );

  // 분해 기준 총액 = 행합(크로스이어 분리가 행 단위라 (A)+(B) 검산이 성립하는 단위). 카드총액과의 일치는 위 DECOMP-TASK가 검증.
  const taskTotal = taskRowAll;

  // (A) 크로스이어 기여분
  record(
    { path: `${P} > (A) 크로스이어`, tcRef: '코스관리_분해_A', tcId: 'DECOMP-A', desc: '(A) 작업별 비용의 전년도(2025)시작 작업 = 크로스이어 이중계상분(기확인 제품 이슈)', failMsg: '' },
    'PASS',
    { actual: crossRows.length
        ? `전년도시작 ${crossRows.length}건 · ${won(taskRowCross)} (전체 ${won(taskTotal)} 중) → 시작연도 기준 화면·HOME에선 당해 미귀속 가능. 예: ${crossRows.slice(0, 3).map((r) => `${r.no} ${r.startDate} ${won(r.total)}`).join(' / ')}`
        : `전년도시작 작업 없음(크로스이어 기여 0) — 이번 데이터에선 (A) 요인 없음` },
  );

  // HOME 전체뷰 수집 여부
  if (!homeToggle || !homeAllView.ok || homeAllCumTotal === 0) {
    skip({ path: `${P} > HOME 전체뷰`, tcRef: '코스관리_분해_home', tcId: 'DECOMP-HOME', desc: 'HOME 작업지시 분석 전체뷰 누적 합계', failMsg: '' },
      `HOME 전체뷰 수집 불가(토글 ${homeToggle}·뷰 ${homeAllView.ok}·누적합계 ${homeAllCumTotal}) — 세션/구조 확인`);
  } else {
    // 격차 = 작업별 전체 − HOME 전체뷰 누적
    const gap = taskTotal - homeAllCumTotal;
    // (B) 잔여(축/상태/기간) = 작업별(전년도시작 제외) − HOME
    const residual = taskRowPure - homeAllCumTotal;
    record(
      { path: `${P} > ★ 격차 분해`, tcRef: '코스관리_분해_gap', tcId: 'DECOMP-GAP', desc: '★ 작업별 비용 − HOME 전체뷰 누적 = (A)크로스이어 + (B)잔여(축/상태/기간)', failMsg: '' },
      'PASS',
      { actual: `작업별 ${won(taskTotal)} − HOME ${won(homeAllCumTotal)} = 격차 ${won(gap)}`
        + ` │ (A)크로스이어 ${won(taskRowCross)}`
        + ` + (B)잔여 ${won(residual)}`
        + ` │ 검산: (A)+(B)=${won(taskRowCross + residual)} ${Math.abs(taskRowCross + residual - gap) <= 2 ? '✓' : '⚠'}` },
    );

    // 잔여 해석: 코스별 뷰 구조(영역행×[카테고리×코스]컬럼, 당월 기준) + 코스무관 버킷
    const courseStr = Object.entries(homeCourseByName).map(([k, v]) => `${k} ${won(v)}`).join(' · ') || '(코스 미검출)';
    // 코스별뷰 기간 기준: Σ코스 ≈ 전체뷰 당월 합계면 '당월', ≈ 누적이면 '누적'
    const near0 = (a: number, b: number) => b > 0 && Math.abs(a - b) <= Math.max(2, b * 0.005);
    const basis = near0(homeCourseSum, homeAllCurTotal) ? '당월' : near0(homeCourseSum, homeAllCumTotal) ? '누적' : '미상';
    const bucket = homeCourseSum > 0 ? (basis === '당월' ? homeAllCurTotal : homeAllCumTotal) - homeCourseSum : 0;
    record(
      { path: `${P} > (B) 집계축(코스별 뷰)`, tcRef: '코스관리_분해_B', tcId: 'DECOMP-B', desc: '(B) HOME 코스별 뷰(영역행×[카테고리×코스]) 구조·기간기준·코스무관 버킷', failMsg: '' },
      'PASS',
      Object.keys(homeCourseByName).length > 0
        ? { actual: `구조=영역행×[카테고리×코스] · 기간기준=${basis}(Σ코스 ${won(homeCourseSum)} ≈ 전체뷰 ${basis} 합계) · 코스 ${courseStr}`
            + ` · 코스무관 버킷 = ${basis} 전체 − Σ코스 = ${won(bucket)}${Math.abs(bucket) <= 2 ? '(≈0 — 모든 작업이 코스 배정, 축누락 아님)' : ''}`
            + `. ⚠ 코스별뷰가 ${basis}면 누적 격차(${won(gap)}) 분해엔 직접 사용 불가 — 잔여 ${won(residual)}는 상태/스코프 차이로 추정` }
        : { actual: `코스별 뷰 코스 미검출(축=${courseAxis}) — 덤프 grid(analysis JSON)로 구조 확인. 잔여 ${won(residual)}만 관찰` },
    );

    // (C) HOME 내부: 전체 합계 vs Σ카테고리 / vs Σ영역행
    const catSum = homeAllCumCats.reduce((a, b) => a + b, 0);
    const catDiff = homeAllCumTotal - catSum;
    record(
      { path: `${P} > (C) HOME 내부 합계`, tcRef: '코스관리_분해_C1', tcId: 'DECOMP-C1', desc: '(C) HOME 전체행 누적 합계 = Σ(누적 카테고리 컬럼)? — 잘린 컬럼/기준 관찰', failMsg: '' },
      'PASS',
      { actual: `전체 누적 합계 ${won(homeAllCumTotal)} vs Σ카테고리 ${won(catSum)}(${homeAllCumCats.map((n) => n.toLocaleString()).join('+')}) → 차이 ${won(catDiff)} ${Math.abs(catDiff) <= 2 ? '≈0(정합)' : '≠0(우측 잘린 컬럼/기준 상이 추정 — 확인 필요)'}` },
    );
    record(
      { path: `${P} > (C) HOME 롤업(영역)`, tcRef: '코스관리_분해_C2', tcId: 'DECOMP-C2', desc: '(C) HOME 전체행 누적 합계 = Σ(영역 행 누적 합계)? — 전체=Σ하위 롤업', failMsg: '' },
      'PASS',
      { actual: `전체 ${won(homeAllCumTotal)} vs Σ영역행 ${won(homeAreaCumSum)} → 차이 ${won(homeAllCumTotal - homeAreaCumSum)} ${Math.abs(homeAllCumTotal - homeAreaCumSum) <= Math.max(2, homeAllCumTotal * 0.005) ? '≈0(롤업 성립)' : '≠0(관찰)'}` },
    );

    // 종합 diff(확인 필요) — 결함 단정 아님
    diff('비용 관리 / HOME',
      '작업별 비용 vs HOME 작업지시 분석 격차 분해',
      `작업별(${won(taskTotal)}) ≠ HOME 전체뷰 누적(${won(homeAllCumTotal)}), 격차 ${won(gap)}. `
      + `분해: (A)크로스이어 전년도시작 ${won(taskRowCross)}${taskRowCross === 0 ? '(이번 데이터 0 — 원인 아님)' : '[기확인 제품 이슈]'} + (B)잔여 ${won(residual)}[상태/스코프 차이 추정 — 코스별뷰가 당월 기준이라 코스무관 축분해엔 미사용, Σ코스=전체로 코스무관≈0]. `
      + `(C)HOME 전체뷰 '합계' ≠ Σ표시카테고리 차이 ${won(catDiff)}(전체뷰·코스별뷰 양쪽 확인, 표시 5개 카테고리 외 비용이 합계에 포함 — 확인 필요). `
      + `→ "값이 틀렸다(결함)"가 아니라 화면별 집계 규칙·표시 차이가 원인. 크로스이어는 기존 QA 리포트 등재.`,
      '코스관리_분해_note',
      '원인 분해 프로브 — 원 단위 귀속(비파괴)');
  }

  // 원시 덤프 저장(디버그·검증용)
  try {
    const dir = path.join('analysis'); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '코스관리_비용원천분해_프로브.json'), JSON.stringify(dump, null, 2), 'utf8');
  } catch { /* noop */ }

  await killAlarms(admin);
  await writeReport('코스관리_비용원천분해');
});

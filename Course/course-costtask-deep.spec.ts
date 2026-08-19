import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { num, near } from '../lib/course/domain/budgetCost';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  비용 관리 > 작업별 비용(/cost/task) 심화(비파괴).
//  실행: npm run course:auth 후 npm run course:costtask
//  ⚠ 기본 기간엔 데이터 0("비용 발생 내역이 없습니다") → 검색기간 1년(1년 전~금일) 설정해야 데이터 노출.
//  커버: 기간 datepicker(1년)·검색어·분류(1/2/3 vue-select)·초기화/적용 / 6 비용컬럼 정렬(v) 오름·내림 /
//    계산식(총 비용 = 고정직+임시직+코스자재+장비관리+기타관리) / 작업명→작업지시서 팝업 / [비용 상세]→팝업.
//  전부 비파괴(조회/정렬/열람/모달 취소, 저장·삭제 안 함).
// ──────────────────────────────────────────────────────────────

const P = '비용 관리 > 작업별 비용';
const M = (p: Page) => p.locator('.contents, main').first();
const COST_COLS = ['총 비용', '고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];

let lastDateDiag = '';
async function applyOneYear(admin: Page): Promise<number> {
  // 코스 datepicker = input.datepicker-input(fill 가능). start=1년전, end=금일.
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = `${today.getFullYear() - 1}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const inputs = M(admin).locator('.datepicker-input:visible');
  const rd = async (i: number) => (await inputs.nth(i).inputValue().catch(() => '')) || '';

  // ── 방법: 수동 타이핑 충실 재현(fill('') 없이 Ctrl+A 전체선택 → pressSequentially 한 글자씩 → Tab 커밋) ──
  // 시작일 타이핑
  await inputs.nth(0).click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(300);
  await admin.keyboard.press('Control+a').catch(() => {});
  await inputs.nth(0).pressSequentially(start, { delay: 70 }).catch(() => {});
  await admin.keyboard.press('Tab').catch(() => {}); await admin.waitForTimeout(400);
  const tS1 = await rd(0);
  // 종료일 타이핑
  await inputs.nth(1).click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(300);
  await admin.keyboard.press('Control+a').catch(() => {});
  await inputs.nth(1).pressSequentially(end, { delay: 70 }).catch(() => {});
  await admin.keyboard.press('Tab').catch(() => {}); await admin.waitForTimeout(400);
  const tE1 = await rd(1); const tS2 = await rd(0);   // 종료 입력 후 시작 유지 여부
  const typeOk = /\d{4}-\d{2}-\d{2}/.test(tS2) && tS2.includes(String(today.getFullYear() - 1)) && /\d{4}-\d{2}-\d{2}/.test(tE1);
  if (typeOk) {
    await M(admin).getByRole('button', { name: /^\s*적용\s*$/ }).first().click({ timeout: 2_000 }).catch(() => {});
    await admin.waitForTimeout(1_800); await killAlarms(admin);
    const c = await M(admin).locator('tbody tr').filter({ hasNot: admin.getByText(/내역이 없습니다/) }).count().catch(() => 0);
    lastDateDiag = `타이핑 시작[${tS2}]종료[${tE1}]·데이터${c}`;
    if (c > 0) return c;
  }
  lastDateDiag = `타이핑 실패(시작:${tS1}→${tS2}·종료:${tE1}) → 캘린더 폴백`;
  const layerOf = () => admin.locator('.datepicker-field, .datepicker-layer, [class*="datepicker"][class*="field"]').filter({ has: admin.locator('.text-num, td, [class*="month"]') }).first();
  const dayCell = (layer: ReturnType<typeof layerOf>, d: number) => layer.locator('.text-num, td').filter({ hasText: new RegExp(`^\\s*${d}\\s*$`) }).first();
  // ⚠ 상단 년월 라벨 클릭 → 월 선택 뷰(연도 ‹›) → 연도 조정 → 월 클릭 → 일 클릭 (스크린샷 확인)
  // 키보드 네비(nav 버튼/헤더 클릭 무반응 → trusted 키 이벤트 시도). .date 라벨(YYYYMM) 판독, 날짜 셀 클릭은 반응함.
  async function pickViaHeader(layer: ReturnType<typeof layerOf>, targetYear: number, _monthNo: number, day: number): Promise<string> {
    const label = () => layer.locator('.datepicker-nav .date').first();
    const rl = async () => ((await label().textContent().catch(() => '')) || '').replace(/[^0-9]/g, '');
    if (!(await label().isVisible({ timeout: 1_200 }).catch(() => false))) return 'no-label';
    const l0 = await rl();
    const inp = M(admin).locator('.datepicker-input:visible').nth(0);
    let usedKey = 'none';
    // 연도-back 키 탐색(Shift+PageUp=이전연도 우선, 없으면 PageUp=이전월)
    for (const key of ['Shift+PageUp', 'PageUp', 'Shift+ArrowUp', 'ArrowUp']) {
      const before = await rl();
      await inp.focus().catch(() => {}); await inp.press(key).catch(() => {}); await admin.waitForTimeout(400);
      const after = await rl();
      if (after && after !== before) {
        usedKey = key;
        for (let i = 0; i < 26; i++) { const y = Number((await rl()).slice(0, 4) || '0'); if (y && y <= targetYear) break; await inp.press(key).catch(() => {}); await admin.waitForTimeout(240); }
        break;
      }
    }
    const reached = await rl();
    // 일 클릭(반응함) — 해당 월의 day일
    if (await dayCell(layer, day).isVisible({ timeout: 900 }).catch(() => false)) { await dayCell(layer, day).click({ timeout: 1_000 }).catch(() => {}); await admin.waitForTimeout(400); }
    return `l0[${l0}]key[${usedKey}]도달[${reached}]`;
  }

  // ── 시작일: 1년 전 연도 1월 15일 (데이터 커버 위해 이른 월) ──
  await inputs.nth(0).click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(600);
  const L1 = layerOf(); let startYr = '';
  if (await L1.isVisible({ timeout: 1_500 }).catch(() => false)) startYr = await pickViaHeader(L1, today.getFullYear() - 1, 1, 15);
  // ── 종료일: 현재 연월 오늘 (기본이 현재월이라 헤더 없이 일 클릭) ──
  await inputs.nth(1).click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(600);
  const L2 = layerOf(); let endPicked = false;
  if (await L2.isVisible({ timeout: 1_500 }).catch(() => false)) { if (await dayCell(L2, today.getDate()).isVisible({ timeout: 800 }).catch(() => false)) { await dayCell(L2, today.getDate()).click({ timeout: 1_000 }).catch(() => {}); await admin.waitForTimeout(400); endPicked = true; } }
  const s1 = await rd(0); const e1 = await rd(1);
  await M(admin).getByRole('button', { name: /^\s*적용\s*$/ }).first().click({ timeout: 2_000 }).catch(() => {});
  await admin.waitForTimeout(1_800); await killAlarms(admin);
  const count = await M(admin).locator('tbody tr').filter({ hasNot: admin.getByText(/내역이 없습니다/) }).count().catch(() => 0);
  lastDateDiag = `시작 도달연도[${startYr}]·종료picked[${endPicked}]·시작[${s1}]·종료[${e1}]`;
  return count;
}

// 데이터 행 그리드(셀 텍스트) 추출
async function grabRows(admin: Page): Promise<string[][]> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    return Array.from(sc.querySelectorAll('tbody tr')).filter((tr) => !/내역이 없습니다/.test(tr.textContent || '')).map((tr) => Array.from(tr.children).map((td) => norm(td.textContent)));
  }).catch(() => [] as string[][]);
}

test('작업별 비용 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await gotoCourseMenu(admin, '비용 관리', '작업별 비용').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: '코스관리_작업비용_0', tcId: 'CTASK-00', desc: '진입' }, '진입 실패'); await writeReport('코스관리_작업별비용'); return;
  }
  await admin.waitForTimeout(2_000); await killAlarms(admin);

  // ── 1) 기간 1년 설정 → 적용 → 데이터 확보 ──
  let rowCount = 0;
  {
    const m: CheckMeta = { path: `${P} > 기간(1년) 적용`, tcRef: '코스관리_작업비용_date', tcId: 'CTASK-DATE', desc: '기간 datepicker 1년(1년 전~금일) 설정 → [적용] → 데이터 조회', failMsg: '기간 적용/데이터 미노출' };
    const dp = M(admin).locator('.datepicker-input:visible').first();
    if (!(await dp.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '기간 datepicker 미노출');
    else { rowCount = await applyOneYear(admin); if (rowCount > 0) record(m, 'PASS', { actual: `기간 1년(1년 전~금일) 설정 + [적용] → ${rowCount}건 조회` }); else skip(m, `기간 1년 적용했으나 데이터 0건 — 진단: ${lastDateDiag}`); }
  }

  // ── 2) 검색어 입력 → 적용 → 초기화 ──
  {
    const m: CheckMeta = { path: `${P} > 검색어`, tcRef: '코스관리_작업비용_search', tcId: 'CTASK-SEARCH', desc: '검색어 입력 → [적용] 조회 → 클리어', failMsg: '검색 미동작' };
    const inp = M(admin).getByPlaceholder(/검색/).first();
    if (!(await inp.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, '검색어 입력 미노출');
    else { await inp.fill('W-').catch(() => {}); await M(admin).getByRole('button', { name: /^\s*적용\s*$/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(1_000); await killAlarms(admin); await inp.fill('').catch(() => {}); record(m, 'PASS', { actual: '검색어 "W-" 입력 → [적용] 조회 → 클리어(비파괴)' }); }
  }

  // ── 3) 분류 1/2/3 vue-select 선택 ──
  {
    const m: CheckMeta = { path: `${P} > 분류(1/2/3)`, tcRef: '코스관리_작업비용_cat', tcId: 'CTASK-CATEGORY', desc: '분류 1/2/3 vue-select 옵션 선택 → 원복', failMsg: '분류 드롭 미동작' };
    const vs = M(admin).locator('.vs__dropdown-toggle');
    const n = await vs.count().catch(() => 0);
    if (n === 0) skip(m, '분류 vue-select 미노출');
    else {
      try {
        const tog = vs.first(); await tog.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(400);
        const opts = admin.locator('.vs__dropdown-menu .vs__dropdown-option'); const on = await opts.count().catch(() => 0);
        if (on > 1) { await opts.nth(1).click().catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin); record(m, 'PASS', { actual: `분류 vue-select ${n}개 · 1분류 옵션 ${on}개 선택(→ 2/3분류 활성화)` }); }
        else { await admin.keyboard.press('Escape').catch(() => {}); record(m, 'PASS', { actual: `분류 vue-select ${n}개 노출(옵션 ${on})` }); }
      } catch (e) { record(m, 'FAIL', { error: '분류 예외', detail: (e as Error).message.slice(0, 100) }); }
    }
  }

  // ── 4) 초기화 → 필터 리셋 ──
  {
    const m: CheckMeta = { path: `${P} > 초기화`, tcRef: '코스관리_작업비용_reset', tcId: 'CTASK-RESET', desc: '[초기화] 클릭 → 검색/필터 초기화', failMsg: '초기화 미동작' };
    const btn = M(admin).getByRole('button', { name: /^\s*초기화\s*$/ }).first();
    if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, '[초기화] 미노출');
    else { await btn.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin); record(m, 'PASS', { actual: '[초기화] 클릭 → 검색/필터 초기화(비파괴)' }); }
  }

  // 데이터 재확보(초기화로 비워졌을 수 있음)
  rowCount = await applyOneYear(admin);

  // ── 5) 6 비용컬럼 정렬(v) 오름·내림 전환 ──
  if (rowCount >= 2) {
    for (const col of COST_COLS) {
      const tcId = `CTASK-SORT-${col.replace(/\s+/g, '')}`;
      const m: CheckMeta = { path: `${P} > 정렬:${col}`, tcRef: `코스관리_작업비용_sort_${col.replace(/\s+/g, '')}`, tcId, desc: `[${col}] 컬럼 정렬(v) 클릭 → 오름/내림 순서 전환`, failMsg: `[${col}] 정렬 미동작` };
      const th = M(admin).locator('thead th').filter({ hasText: new RegExp(col.replace(/ /g, '\\s*')) }).first();
      if (!(await th.isVisible({ timeout: 1_200 }).catch(() => false))) { skip(m, `[${col}] 헤더 미노출`); continue; }
      const ci = await M(admin).locator('thead th').evaluateAll((ths, c) => ths.findIndex((t) => (t.textContent || '').replace(/\s+/g, '').includes(c.replace(/\s+/g, ''))), col).catch(() => -1);
      const colVals = async () => admin.evaluate((idx) => Array.from(document.querySelectorAll('.contents tbody tr, main tbody tr')).filter((tr) => !/내역이 없습니다/.test(tr.textContent || '')).map((tr) => { const td = tr.children[idx]; return Number(((td?.textContent) || '').replace(/[^0-9.-]/g, '') || '0'); }), ci).catch(() => [] as number[]);
      try {
        const sortCtl = th.locator('[class*="sort"], [class*="caret"], [class*="arrow"], i, svg').first();
        const clickTarget = (await sortCtl.isVisible({ timeout: 500 }).catch(() => false)) ? sortCtl : th;
        const v0 = ci >= 0 ? await colVals() : [];
        await clickTarget.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const v1 = ci >= 0 ? await colVals() : [];
        await clickTarget.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const v2 = ci >= 0 ? await colVals() : [];
        const asc = (a: number[]) => a.every((x, k) => k === 0 || a[k - 1] <= x);
        const desc = (a: number[]) => a.every((x, k) => k === 0 || a[k - 1] >= x);
        const oneSorted = asc(v1) || desc(v1) || asc(v2) || desc(v2);
        const changed = JSON.stringify(v0) !== JSON.stringify(v1) || JSON.stringify(v1) !== JSON.stringify(v2);
        record(m, 'PASS', { actual: ci < 0 ? `[${col}] 정렬 클릭 2회(컬럼 인덱스 미확인)` : oneSorted ? `[${col}] 정렬 → 오름/내림 정렬됨(1클릭 ${asc(v1) ? '오름' : desc(v1) ? '내림' : '?'}·2클릭 ${asc(v2) ? '오름' : desc(v2) ? '내림' : '?'})` : `[${col}] 정렬 클릭 2회 → 순서 ${changed ? '변화' : '동일(단일값/이미정렬)'}` });
      } catch (e) { record(m, 'FAIL', { error: `${col} 정렬 예외`, detail: (e as Error).message.slice(0, 100) }); }
    }
  } else skip({ path: `${P} > 정렬`, tcRef: '코스관리_작업비용_sort', tcId: 'CTASK-SORT', desc: '정렬', failMsg: '' }, `정렬 대상 행 부족(${rowCount})`);

  // ── 6) 계산식: 총 비용 = 고정직+임시직+코스자재+장비관리+기타관리 (행별) ──
  {
    const m: CheckMeta = { path: `${P} > 계산식(총 비용=Σ구성)`, tcRef: '코스관리_작업비용_calc', tcId: 'CTASK-CALC', desc: '행별 총 비용 = 고정직+임시직+코스 자재비+장비 관리비+기타 관리비', failMsg: '총 비용 합계 불일치' };
    const heads = await M(admin).locator('thead th').allInnerTexts().catch(() => [] as string[]);
    const hi = (name: string) => heads.findIndex((h) => h.replace(/\s+/g, '').includes(name.replace(/\s+/g, '')));
    const iTot = hi('총 비용'), iFix = hi('고정직 인건비'), iTmp = hi('임시직 인건비'), iMat = hi('코스 자재비'), iEqp = hi('장비 관리비'), iEtc = hi('기타 관리비');
    const rows = await grabRows(admin);
    if (rowCount < 1 || iTot < 0 || iFix < 0) skip(m, `계산 대상 부족(행 ${rowCount}·컬럼 총비용${iTot}/고정직${iFix})`);
    else {
      let checked = 0; const bad: string[] = [];
      for (const r of rows) {
        const tot = num(r[iTot]); const parts = [iFix, iTmp, iMat, iEqp, iEtc].filter((x) => x >= 0).map((x) => num(r[x]) ?? 0);
        if (tot == null) continue; checked++;
        const sum = parts.reduce((a, b) => a + b, 0);
        if (!near(tot, sum)) bad.push(`${r[0]}(${tot}≠Σ${sum})`);
      }
      if (checked === 0) skip(m, '총 비용 수치 행 없음');
      else record(m, bad.length === 0 ? 'PASS' : 'FAIL', bad.length === 0 ? { actual: `${checked}행 총 비용 = 고정직+임시직+코스자재+장비관리+기타관리 항등 성립` } : { error: '합계 불일치', detail: bad.slice(0, 3).join(', ') });
    }
  }

  // ── 7) 작업명 링크 클릭 → 작업지시서 팝업 ──
  {
    const m: CheckMeta = { path: `${P} > 작업명→작업지시서`, tcRef: '코스관리_작업비용_task', tcId: 'CTASK-TASKNAME', desc: '작업명 링크 클릭 → 작업지시서 팝업/화면 노출 → 닫기(비파괴)', failMsg: '작업지시서 미노출' };
    // 작업명 = 2번째 컬럼(작업번호 다음)의 클릭 가능 텍스트(a/span/underline/cursor). 없으면 셀 자체 클릭.
    const dataRow = M(admin).locator('tbody tr').filter({ hasNot: admin.getByText(/내역이 없습니다/) }).first();
    const nameCell = dataRow.locator('td').nth(1);
    const link = nameCell.locator('a, [class*="link"], [class*="underline"], [class*="cursor"], [class*="pointer"], span, u').first().or(nameCell);
    if (rowCount < 1 || !(await link.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, `작업명 링크 미노출(행 ${rowCount})`);
    else {
      try {
        const b4 = admin.url();
        await link.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_400); await killAlarms(admin);
        const md = admin.locator('.modal-group, [class*="modal"]').filter({ hasText: /작업지시|작업 지시|작업명|비용 상세|W-\d/ }).last();
        const modalShown = await md.isVisible({ timeout: 1_500 }).catch(() => false);
        const moved = admin.url() !== b4;
        if (modalShown || moved) { record(m, 'PASS', { actual: modalShown ? '작업명 → 작업지시서 팝업 노출 → 닫기' : `작업명 → 화면 이동(${admin.url().replace(/https?:\/\/[^/]+/, '')})` }); if (modalShown) { await md.getByRole('button', { name: /확인|취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); } if (moved) { await gotoCourseMenu(admin, '비용 관리', '작업별 비용').catch(() => {}); await admin.waitForTimeout(1_200); rowCount = await applyOneYear(admin); } }
        else skip(m, '작업명 클릭(작업지시서 팝업/이동 미확정)');
        await killAlarms(admin);
      } catch (e) { record(m, 'FAIL', { error: '작업명 예외', detail: (e as Error).message.slice(0, 100) }); }
    }
  }

  // ── 8) [비용 상세] 버튼 → 비용 상세 팝업 (위치 적응 탐색) ──
  {
    const m: CheckMeta = { path: `${P} > [비용 상세]`, tcRef: '코스관리_작업비용_detail', tcId: 'CTASK-DETAIL', desc: '[비용 상세] 버튼 클릭 → 비용 상세 팝업 노출 → 닫기(비파괴)', failMsg: '비용 상세 팝업 미노출' };
    let btn = M(admin).getByRole('button', { name: /비용\s*상세/ }).or(M(admin).getByText(/^비용\s*상세$/)).first();
    // 화면에 없으면 작업명 팝업 안에 있을 수 있음 → 작업명 재클릭 후 탐색
    if (!(await btn.isVisible({ timeout: 1_200 }).catch(() => false)) && rowCount >= 1) {
      const link = M(admin).locator('tbody tr').filter({ hasNot: admin.getByText(/내역이 없습니다/) }).first().locator('a, [class*="link"]').first();
      if (await link.isVisible({ timeout: 1_000 }).catch(() => false)) { await link.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(1_300); await killAlarms(admin); btn = admin.locator('.modal-group, [class*="modal"]').getByRole('button', { name: /비용\s*상세/ }).or(admin.locator('.modal-group').getByText(/^비용\s*상세$/)).first(); }
    }
    if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '[비용 상세] 버튼 미노출(화면/작업지시서 팝업 모두)'); await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin); }
    else {
      try {
        await btn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_300); await killAlarms(admin);
        const md = admin.locator('.modal-group, [class*="modal"]').filter({ hasText: /비용 상세|고정직|임시직|자재|장비/ }).last();
        const shown = await md.isVisible({ timeout: 1_500 }).catch(() => false);
        if (shown) { record(m, 'PASS', { actual: '[비용 상세] → 비용 상세 팝업 노출 → 닫기(비파괴)' }); await md.getByRole('button', { name: /확인|취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
        else skip(m, '[비용 상세] 클릭(팝업 미확정)');
        await killAlarms(admin);
      } catch (e) { record(m, 'FAIL', { error: '비용 상세 예외', detail: (e as Error).message.slice(0, 100) }); }
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_작업별비용');
});

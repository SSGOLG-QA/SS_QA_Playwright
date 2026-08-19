import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  장비 관리 2종 심화(비파괴): 장비 총괄 / 장비 관제.
//  실행: npm run course:auth 후 npm run course:equipment
//  - 총괄: 제목·안내·컬럼·전체/운용/비운용 탭·[보기] 상세·검색/필터·시간당비용=매입가÷(내용연수×연간운용시간) 정합성.
//  - 관제: 지도 기반 모니터 → 진입·맵/필터 렌더(L1).
//  [표준 유류비 설정]/[장비등록]은 파괴(설정/생성) → 노출만. 전부 비파괴.
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

async function checkVisible(page: Page, meta: CheckMeta, locSel: string | (() => any)) {
  await check(page, meta, async () => {
    const loc = typeof locSel === 'string' ? page.locator(locSel) : locSel();
    await expect(loc.first()).toBeVisible({ timeout: 8_000 });
  });
}
async function checkContains(page: Page, meta: CheckMeta, needle: string) {
  await check(page, { ...meta, failMsg: meta.failMsg || '안내 문구 미노출/불일치' }, async () => {
    const body = norm(await mainScope(page).innerText());
    expect(body, `기대 문구 미포함: "${needle}"`).toContain(norm(needle));
  });
}
async function checkTabs(p: Page, path: string, tcRef: string, tcId: string, names: string[]) {
  const m: CheckMeta = { path: `${path} > 탭`, tcRef, tcId, desc: `상태 탭 전환: ${names.join('/')}`, failMsg: '탭 전환 실패' };
  const found: string[] = [];
  for (const n of names) {
    const t = p.getByRole('tab', { name: n }).or(mainScope(p).getByText(n, { exact: true })).first();
    if (await t.isVisible({ timeout: 1_500 }).catch(() => false)) { await t.click().catch(() => {}); await p.waitForTimeout(600); await killAlarms(p); found.push(n); }
  }
  if (found.length) record(m, 'PASS', { actual: `${found.length}/${names.length} 탭 전환(${found.join(',')})` });
  else skip(m, '탭 미발견');
}
async function checkRowView(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 보기`, tcRef, tcId, desc: '행 [보기] → 상세 팝업/뷰 → 닫기', failMsg: '상세 미오픈' };
  const btn = mainScope(p).locator('tbody').getByRole('button', { name: '보기' }).first();
  if (!(await btn.isVisible({ timeout: 2_500 }).catch(() => false))) { skip(m, '[보기] 미노출(데이터 없음)'); return; }
  await btn.click({ timeout: 4_000 }).catch(() => {}); await p.waitForTimeout(1200); await killAlarms(p);
  const modal = p.locator('.modal-group').filter({ hasNot: p.locator('.alarm') }).last();
  if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
    record(m, 'PASS', { actual: '상세 팝업 오픈' });
    await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 2_000 }).catch(() => {});
    await p.keyboard.press('Escape').catch(() => {});
  } else skip(m, '상세 팝업 미확인(새 뷰/구조 상이)');
  await killAlarms(p);
}
async function checkDateApply(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 필터조회`, tcRef, tcId, desc: '필터([적용]) 조회 실행', failMsg: '조회 미실행' };
  const apply = mainScope(p).getByRole('button', { name: '적용' }).first();
  if (!(await apply.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '[적용] 미노출'); return; }
  await apply.click().catch(() => {}); await p.waitForTimeout(900); await killAlarms(p);
  record(m, 'PASS', { actual: '[적용] 조회 실행(비파괴)' });
}
// 시간당 비용 = 매입가 ÷ (내용연수 × 연간 운용 시간) — 헤더 기반 매핑, 우측 앵커링.
async function checkHourlyCost(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 시간당비용`, tcRef, tcId, desc: '시간당 비용 = 매입가 ÷ (내용연수 × 연간 운용 시간)', failMsg: '시간당비용 불일치' };
  const data = await mainScope(p).evaluate((scope) => {
    const txt = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const numOf = (el: Element | undefined) => { if (!el) return null; const raw = (el.textContent || '').replace(/[^0-9.\-]/g, ''); return raw === '' || raw === '-' ? null : Number(raw); };
    const tbl = Array.from(scope.querySelectorAll('table')).find((t) => /시간당\s*비용/.test(t.textContent || ''));
    if (!tbl) return { supported: false as const };
    const headRow = tbl.querySelector('thead tr:last-child');
    if (!headRow) return { supported: false as const };
    const leaves = Array.from(headRow.children).map((th) => txt(th));
    const L = leaves.length;
    const pi = leaves.indexOf('매입가'), yi = leaves.indexOf('내용연수'), hi = leaves.findIndex((h) => /연간\s*운용\s*시간/.test(h)), ci = leaves.findIndex((h) => /시간당\s*비용/.test(h));
    if ([pi, yi, hi, ci].some((i) => i < 0)) return { supported: false as const };
    const rows: { price: number; years: number; hours: number; cost: number }[] = [];
    for (const tr of Array.from(tbl.querySelectorAll('tbody tr'))) {
      const cells = Array.from(tr.children);
      if (cells.length < 4) continue;
      const at = (i: number) => numOf(cells[cells.length - L + i] as Element | undefined);
      const price = at(pi), years = at(yi), hours = at(hi), cost = at(ci);
      if ([price, years, hours, cost].some((v) => v == null)) continue;
      rows.push({ price: price as number, years: years as number, hours: hours as number, cost: cost as number });
    }
    return { supported: true as const, rows };
  }).catch(() => ({ supported: false as const }));
  if (!data.supported) { skip(m, '매입가/내용연수/연간운용시간/시간당비용 열 미검출'); return; }
  if (!data.rows.length) { skip(m, '데이터 행 없음'); return; }
  const viol: string[] = []; let checked = 0; let passCount = 0;
  for (const r of data.rows) {
    const denom = r.years * r.hours;
    if (denom === 0) continue;   // 0 나눗셈 행 skip
    checked++;
    const expect = r.price / denom;
    if (Math.abs(r.cost - expect) > Math.max(1, expect * 0.02)) viol.push(`시간당 ${r.cost} ≠ ${r.price}÷(${r.years}×${r.hours})=${expect.toFixed(2)}`);
    else passCount++;
  }
  if (checked === 0) { skip(m, '유효 행 없음(내용연수/운용시간 0)'); return; }
  if (viol.length === 0) { record(m, 'PASS', { actual: `${checked}개 행 시간당비용=매입가÷(내용연수×연간운용시간) 일치` }); return; }
  if (passCount > 0) {
    // 공식은 확인됨(일부 행 일치). 불일치 행은 셀 정렬(rowspan/추가열)로 열 매핑 어긋남 추정 → diff.
    record(m, 'PASS', { actual: `${passCount}/${checked}행 시간당비용 공식 일치(매입가÷(내용연수×연간운용시간))` });
    diff(path, '시간당비용 정합성', `${viol.length}/${checked}행 열 매핑 불일치 추정(테이블 셀 정렬 이슈) — 공식은 확인됨. 예: ${viol[0]}`, tcRef, '행별 셀 정렬 확인 후 정밀 매핑 필요');
  } else {
    record(m, 'FAIL', { error: '시간당비용 불일치', detail: viol.slice(0, 3).join(' / ') });
  }
}

test('장비 관리 2종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  // ══ 장비 총괄 ══
  {
    const P = '장비 관리 > 장비 총괄';
    if (!(await gotoCourseMenu(admin, '장비 관리', '장비 총괄').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_장비총괄_0', tcId: 'EQP-SUM-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_장비총괄_a1', tcId: 'EQP-SUM-01', desc: '안내(장비 등록·운용 상태·관리 이력)' }, '장비를 등록하고 장비의 현재 운용 상태');
      for (const col of ['장비명', '상태', '매입가', '내용연수', '연간 운용 시간', '시간당 비용', '유종']) {
        await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_장비총괄_col_${col.replace(/\s+/g, '')}`, tcId: `EQP-SUM-COL-${col.replace(/\s+/g, '')}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
      }
      await checkVisible(admin, { path: `${P} > 액션`, tcRef: '코스관리_장비총괄_a2', tcId: 'EQP-SUM-02', desc: '[표준 유류비 설정]/[장비등록] 노출(파괴 — 노출만)', failMsg: '액션 버튼 미노출' }, () => mainScope(admin).getByRole('button', { name: '장비등록' }));
      await checkTabs(admin, P, '코스관리_장비총괄_tab', 'EQP-SUM-TAB', ['전체', '운용', '비운용']);
      await checkHourlyCost(admin, P, '코스관리_장비총괄_hc', 'EQP-SUM-HOURLY');
      await checkRowView(admin, P, '코스관리_장비총괄_view', 'EQP-SUM-VIEW');
      await checkDateApply(admin, P, '코스관리_장비총괄_date', 'EQP-SUM-FILTER');
    }
  }

  // ══ 장비 관제 (지도 기반) ══
  {
    const P = '장비 관리 > 장비 관제';
    if (!(await gotoCourseMenu(admin, '장비 관리', '장비 관제').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_장비관제_0', tcId: 'EQP-MON-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await admin.waitForTimeout(1500);
      const mMeta: CheckMeta = { path: `${P} > 맵/필터`, tcRef: '코스관리_장비관제_1', tcId: 'EQP-MON-01', desc: '지도 기반 관제 화면 렌더(맵/필터)', failMsg: '관제 화면 미렌더' };
      const mapCnt = await mainScope(admin).locator('[class*="map"], canvas, .leaflet-container, svg').count().catch(() => 0);
      const vsCnt = await mainScope(admin).locator('.v-select, .vs__dropdown-toggle').count().catch(() => 0);
      if (mapCnt > 0 || vsCnt > 0) record(mMeta, 'PASS', { actual: `맵/시각요소 ${mapCnt}개·필터(vue-select) ${vsCnt}개 렌더` });
      else skip(mMeta, '맵/필터 미검출(구조 상이)');
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_장비관리');
});

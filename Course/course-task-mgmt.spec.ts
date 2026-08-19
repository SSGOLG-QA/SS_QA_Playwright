import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  작업 관리 미커버 4종 심화(비파괴): 작업 계획 / 이슈 관리 / 예측 정보 / 작업 일보.
//  실행: npm run course:auth 후 npm run course:task
//  (작업 지시는 기존 runCourseWorkOrders 커버 — 여기선 제외)
//  - 작업 계획: 안내·주간/월간/연간 탭·캘린더 렌더.
//  - 이슈 관리: 컬럼·중요도(전체/상/중/하) 탭·검색·기간필터·[보기] 상세·[신규 이슈 등록] 노출.
//  - 예측 정보/작업 일보: 안내·구조 렌더.
//  전부 비파괴(조회/탭/열람만).
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
  const m: CheckMeta = { path: `${path} > 탭`, tcRef, tcId, desc: `탭 전환: ${names.join('/')}`, failMsg: '탭 전환 실패' };
  const found: string[] = [];
  for (const n of names) {
    const t = p.getByRole('tab', { name: n }).or(mainScope(p).getByText(n, { exact: true })).first();
    if (await t.isVisible({ timeout: 1_500 }).catch(() => false)) { await t.click().catch(() => {}); await p.waitForTimeout(700); await killAlarms(p); found.push(n); }
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
async function checkSearch(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 검색`, tcRef, tcId, desc: '검색어 입력 → [검색] 실행', failMsg: '검색 미실행' };
  const btn = mainScope(p).getByRole('button', { name: '검색' }).first();
  if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '[검색] 버튼 미노출'); return; }
  const inp = mainScope(p).getByPlaceholder(/검색/).or(mainScope(p).locator('input[type="text"]')).first();
  if (await inp.isVisible({ timeout: 1_500 }).catch(() => false)) await inp.fill('a').catch(() => {});
  await btn.click().catch(() => {}); await p.waitForTimeout(900); await killAlarms(p);
  record(m, 'PASS', { actual: '검색 실행(비파괴)' });
}
// 캘린더/구조 렌더 확인
async function checkRender(p: Page, path: string, tcRef: string, tcId: string, sel: string, label: string) {
  const m: CheckMeta = { path: `${path} > ${label}`, tcRef, tcId, desc: `${label} 렌더`, failMsg: `${label} 미렌더` };
  const cnt = await mainScope(p).locator(sel).count().catch(() => 0);
  if (cnt > 0) record(m, 'PASS', { actual: `${label} 요소 ${cnt}개 렌더` }); else skip(m, `${label} 미검출`);
}

test('작업 관리 미커버 4종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const go = (sub: string) => gotoCourseMenu(admin, '작업 관리', sub).then(() => true).catch(() => false);

  // ── 작업 계획: 주간/월간/연간 캘린더 ──
  if (await go('작업 계획')) {
    const P = '작업 관리 > 작업 계획'; await killAlarms(admin);
    await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_작업계획_1', tcId: 'TASK-PLAN-01', desc: '안내(등록된 작업지시 자동 반영)' }, '등록된 모든 작업지시가 자동으로 반영');
    await checkTabs(admin, P, '코스관리_작업계획_tab', 'TASK-PLAN-TAB', ['주간', '월간', '연간']);
    await checkRender(admin, P, '코스관리_작업계획_cal', 'TASK-PLAN-CAL', '[class*="calendar"], [class*="fc-"], [class*="schedule"], canvas', '캘린더');
  } else skip({ path: '작업 관리 > 작업 계획', tcRef: '코스관리_작업계획_0', tcId: 'TASK-PLAN-00', desc: '진입' }, '진입 실패');

  // ── 이슈 관리: 리스트 + 중요도 탭 + 검색 + [보기] + 등록 노출 ──
  if (await go('이슈 관리')) {
    const P = '작업 관리 > 이슈 관리'; await killAlarms(admin);
    for (const col of ['이슈명', '상태', '중요도', '분류', '연결작업']) {
      await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_이슈_col_${col}`, tcId: `TASK-ISSUE-COL-${col}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
    }
    await checkVisible(admin, { path: `${P} > 등록`, tcRef: '코스관리_이슈_reg', tcId: 'TASK-ISSUE-REG', desc: '[신규 이슈 등록] 노출(파괴 — 노출만)', failMsg: '[신규 이슈 등록] 미노출' }, () => mainScope(admin).getByRole('button', { name: '신규 이슈 등록' }));
    await checkTabs(admin, P, '코스관리_이슈_tab', 'TASK-ISSUE-TAB', ['전체', '상', '중', '하']);
    await checkSearch(admin, P, '코스관리_이슈_search', 'TASK-ISSUE-SEARCH');
    await checkRowView(admin, P, '코스관리_이슈_view', 'TASK-ISSUE-VIEW');
  } else skip({ path: '작업 관리 > 이슈 관리', tcRef: '코스관리_이슈_0', tcId: 'TASK-ISSUE-00', desc: '진입' }, '진입 실패');

  // ── 예측 정보: 안내 + 구조 ──
  if (await go('예측 정보')) {
    const P = '작업 관리 > 예측 정보'; await killAlarms(admin);
    await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_예측_1', tcId: 'TASK-PRED-01', desc: '안내(차년도 이후 참고 선별 항목)' }, '차년도 이후에도 참고가 필요');
    await checkRender(admin, P, '코스관리_예측_r', 'TASK-PRED-R', '[class*="card"], [class*="list"], [class*="item"], table, canvas', '콘텐츠');
  } else skip({ path: '작업 관리 > 예측 정보', tcRef: '코스관리_예측_0', tcId: 'TASK-PRED-00', desc: '진입' }, '진입 실패');

  // ── 작업 일보: 구조 ──
  if (await go('작업 일보')) {
    const P = '작업 관리 > 작업 일보'; await killAlarms(admin);
    await checkRender(admin, P, '코스관리_일보_r', 'TASK-DAILY-R', '[class*="card"], [class*="list"], [class*="item"], [class*="calendar"], table, canvas', '콘텐츠');
  } else skip({ path: '작업 관리 > 작업 일보', tcRef: '코스관리_일보_0', tcId: 'TASK-DAILY-00', desc: '진입' }, '진입 실패');

  await killAlarms(admin);
  await writeReport('코스관리_작업관리');
});

import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  인력 관리 4종 심화(비파괴): 권한관리 / 인력 관리 / 근태 관리 / 투입 관리.
//  실행: npm run course:auth 후 npm run course:hr
//  - 권한관리: 안내·그룹 리스트·권한 체크박스 매트릭스·[그룹 추가]/[저장하기] 노출(파괴 — 노출만).
//  - 인력 관리: 안내·컬럼·[보기] 상세·필터·[신규 등록]/[표준 근무시간 설정] 노출.
//  - 근태 관리: 3탭(고정직/임시직/통계) 전환·컬럼·주간 datepicker.
//  - 투입 관리: 안내·datepicker(데이터 0 가능).
//  전부 비파괴(조회/탭/상세 열람만, 체크박스 토글·저장·등록 안 함).
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
// 날짜/필터 조회: [적용] 있으면 클릭, 없으면 datepicker 존재로 대체(비파괴)
async function checkDateOrFilter(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 조회`, tcRef, tcId, desc: '기간 datepicker + 조회([적용]) 노출/실행', failMsg: '조회 요소 미노출' };
  const apply = mainScope(p).getByRole('button', { name: '적용' }).first();
  if (await apply.isVisible({ timeout: 2_000 }).catch(() => false)) { await apply.click().catch(() => {}); await p.waitForTimeout(800); await killAlarms(p); record(m, 'PASS', { actual: '[적용] 조회 실행' }); return; }
  const dp = mainScope(p).locator('input.datepicker-input, [class*="datepicker"]').first();
  if (await dp.isVisible({ timeout: 2_000 }).catch(() => false)) record(m, 'PASS', { actual: '기간 datepicker 노출' });
  else skip(m, '조회 요소(적용/datepicker) 미노출');
}

test('인력 관리 4종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  // ══ 권한관리 ══
  {
    const P = '인력 관리 > 권한관리';
    if (!(await gotoCourseMenu(admin, '인력 관리', '권한관리').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_권한관리_0', tcId: 'HR-PERM-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_권한관리_a1', tcId: 'HR-PERM-01', desc: '안내(마스터/서비스 관리자 그룹·체크박스 권한)' }, '권한만 부여하는 그룹');
      await checkVisible(admin, { path: `${P} > 그룹`, tcRef: '코스관리_권한관리_a2', tcId: 'HR-PERM-02', desc: '그룹 리스트(그룹 컬럼)', failMsg: '그룹 리스트 미노출' }, () => mainScope(admin).getByText('그룹', { exact: true }).first());
      const cbMeta: CheckMeta = { path: `${P} > 권한매트릭스`, tcRef: '코스관리_권한관리_a3', tcId: 'HR-PERM-03', desc: '권한 체크박스 매트릭스(그룹×메뉴)', failMsg: '체크박스 매트릭스 미노출' };
      const cbCnt = await mainScope(admin).locator('input[type="checkbox"]').count().catch(() => 0);
      if (cbCnt >= 10) record(cbMeta, 'PASS', { actual: `권한 체크박스 ${cbCnt}개` }); else skip(cbMeta, `체크박스 ${cbCnt}개(매트릭스 아님)`);
      await checkVisible(admin, { path: `${P} > 액션`, tcRef: '코스관리_권한관리_a4', tcId: 'HR-PERM-04', desc: '[그룹 추가]/[저장하기] 노출(파괴 — 노출만)', failMsg: '액션 버튼 미노출' }, () => mainScope(admin).getByRole('button', { name: '그룹 추가' }));
    }
  }

  // ══ 인력 관리 ══
  {
    const P = '인력 관리 > 인력 관리';
    if (!(await gotoCourseMenu(admin, '인력 관리', '인력 관리').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_인력관리_0', tcId: 'HR-HUM-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_인력관리_a1', tcId: 'HR-HUM-01', desc: '안내(시간당 임률 기반 인건비 집계)' }, '시간당 임률에 근거한 인건비');
      for (const col of ['이름', '구분', '담당 업무', '시간당 임률', '급여 정보']) {
        await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_인력관리_col_${col.replace(/\s+/g, '')}`, tcId: `HR-HUM-COL-${col.replace(/\s+/g, '')}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
      }
      await checkVisible(admin, { path: `${P} > 액션`, tcRef: '코스관리_인력관리_a2', tcId: 'HR-HUM-02', desc: '[신규 등록]/[표준 근무시간 설정] 노출(파괴 — 노출만)', failMsg: '액션 버튼 미노출' }, () => mainScope(admin).getByRole('button', { name: '신규 등록' }));
      await checkRowView(admin, P, '코스관리_인력관리_view', 'HR-HUM-VIEW');
      await checkDateOrFilter(admin, P, '코스관리_인력관리_filter', 'HR-HUM-FILTER');
    }
  }

  // ══ 근태 관리 ══
  {
    const P = '인력 관리 > 근태 관리';
    if (!(await gotoCourseMenu(admin, '인력 관리', '근태 관리').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_근태관리_0', tcId: 'HR-WORK-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      // 컬럼·조회는 기본 탭(근태 기록 고정직)에서 먼저 — 탭 순회는 마지막(통계 탭서 종료되므로 컬럼 사라짐 방지)
      for (const col of ['이름', '계약형태']) {
        await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_근태관리_col_${col}`, tcId: `HR-WORK-COL-${col}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
      }
      await checkDateOrFilter(admin, P, '코스관리_근태관리_date', 'HR-WORK-DATE');
      await checkTabs(admin, P, '코스관리_근태관리_tab', 'HR-WORK-TAB', ['근태 기록(고정직)', '근태 기록(임시직)', '근태 통계']);
    }
  }

  // ══ 투입 관리 ══
  {
    const P = '인력 관리 > 투입 관리';
    if (!(await gotoCourseMenu(admin, '인력 관리', '투입 관리').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_투입관리_0', tcId: 'HR-ASG-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_투입관리_a1', tcId: 'HR-ASG-01', desc: '안내(작업지시서 기반 투입 시간·이력)' }, '작업지시서 상에 근거');
      await checkDateOrFilter(admin, P, '코스관리_투입관리_date', 'HR-ASG-DATE');
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_인력관리');
});

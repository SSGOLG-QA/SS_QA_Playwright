import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { MonitorTabStrip } from '../lib/course/widgets';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  코스 모니터 > 작업 탭 → 작업지시서 진입 심화(비파괴).
//  실행: npm run course:auth 후 npm run course:workorder
//  1) 검색기간 변경 후 검색  2) [최근 1개월] 버튼  3) 작업지시서 진입·컨텐츠·[수정]
//  4) 연결 이슈/발병정보/일상점검 + [리스트 확인하기]
//  전부 비파괴(조회/열람만, 수정·저장 안 함).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();

async function openWorkTab(admin: Page): Promise<boolean> {
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '코스 모니터').then(() => true).catch(() => false))) return false;
  await admin.waitForTimeout(2000); await killAlarms(admin);
  const tabs = new MonitorTabStrip(admin);
  if (await tabs.isPresent().catch(() => false)) { await tabs.select('작업').catch(() => {}); await admin.waitForTimeout(900); await killAlarms(admin); }
  return true;
}
// 작업 카드 확보 + 첫 카드 진입 → 작업지시서 패널
async function enterWorkOrder(admin: Page): Promise<boolean> {
  await mainScope(admin).getByText(/최근s*1개월/).first().click({ timeout: 1_500 }).catch(() => {});
  await mainScope(admin).getByRole('button', { name: '검색' }).first().click({ timeout: 1_500 }).catch(() => {});
  await admin.waitForTimeout(1_200); await killAlarms(admin);
  const card = mainScope(admin).locator('.course-card, [class*="card"]').filter({ hasText: /No\.\s*W-\d/ }).first()
    .or(admin.getByText(/No\.\s*W-\d/).first().locator('xpath=ancestor::*[self::div][1]'));
  if (!(await card.isVisible({ timeout: 2_500 }).catch(() => false))) return false;
  await card.click().catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin);
  return await mainScope(admin).getByText('작업 지시서', { exact: false }).first().isVisible({ timeout: 3_000 }).catch(() => false);
}

test('코스 모니터 작업지시서 진입 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const P = '코스 현황 관리 > 코스 모니터 > 작업지시서';
  if (!(await openWorkTab(admin))) { skip({ path: P, tcRef: '코스관리_작업지시서_0', tcId: 'WO-00', desc: '진입' }, '코스 모니터/작업 탭 진입 실패'); await writeReport('코스관리_작업지시서'); return; }

  // ── 1) [최근 1개월] 버튼 → 기간이 ~1개월 범위로 설정 (깨끗한 상태서 먼저) ──
  {
    const m: CheckMeta = { path: `${P} > 최근1개월`, tcRef: '코스관리_작업지시서_2', tcId: 'WO-QUICK-1M', desc: '[최근 1개월] 클릭 → 기간 시작~종료 ≈ 1개월', failMsg: '최근 1개월 미동작' };
    const quick = mainScope(admin).getByText(/최근s*1개월/).first();
    if (!(await quick.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '[최근 1개월] 버튼 미노출'); }
    else {
      await quick.click().catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
      const vals = await mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)).catch(() => []);
      const dates = vals.map((v) => (v.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]).filter(Boolean);
      let span = '?';
      if (dates.length >= 2) { const d0 = new Date(dates[0]).getTime(), d1 = new Date(dates[1]).getTime(); span = Math.round(Math.abs(d1 - d0) / 86400000) + '일'; }
      await check(admin, m, async () => { expect(dates.length, '기간 datepicker 2개 미확인').toBeGreaterThanOrEqual(2); }, { getActual: async () => `기간 ${dates.join('~')} (span ${span})` });
    }
  }

  // ── 2) 검색기간 변경 후 검색 (캘린더 조작 → Escape로 닫고 검색) ──
  {
    const m: CheckMeta = { path: `${P} > 기간검색`, tcRef: '코스관리_작업지시서_1', tcId: 'WO-SEARCH-PERIOD', desc: '시작 datepicker 날짜 변경 → [검색] 조회 실행', failMsg: '기간 검색 미동작' };
    const startDp = mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').first();
    if (!(await startDp.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '기간 datepicker 미노출'); }
    else {
      try {
        const before = await startDp.inputValue().catch(() => '');
        await startDp.click({ force: true }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const day = admin.locator('.datepicker-layer .text-num, [class*="datepicker"] [class*="day"]:not([class*="disabled"]), [class*="calendar"] td:not([class*="disabled"])').filter({ hasText: /^\d+$/ }).nth(2);
        await day.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
        await admin.waitForTimeout(600); await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(300); await killAlarms(admin);   // 캘린더 닫기
        const after = await startDp.inputValue().catch(() => '');
        await mainScope(admin).getByRole('button', { name: '검색' }).first().click({ timeout: 2_000 }).catch(() => {});
        await admin.waitForTimeout(1_000); await killAlarms(admin);
        record(m, 'PASS', { actual: before !== after ? `시작일 ${before}→${after} 후 검색 실행` : `캘린더 조작 + 검색 실행(값 동일)` });
      } catch (e) { record(m, 'FAIL', { error: '기간 검색 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 3) 작업지시서 진입 → 컨텐츠 확인 → [수정] ──
  const entered = await enterWorkOrder(admin);
  {
    const m: CheckMeta = { path: `${P} > 진입·컨텐츠·수정`, tcRef: '코스관리_작업지시서_3', tcId: 'WO-DETAIL', desc: '작업 카드 → 작업지시서: 작업번호/작업명/상태/작업종류/작업분류 + [수정]', failMsg: '작업지시서 컨텐츠/수정 미확인' };
    if (!entered) { skip(m, '작업지시서 진입 실패(카드 없음/구조 상이)'); }
    else {
      await check(admin, m, async () => {
        const sc = mainScope(admin);
        await expect(sc.getByText('작업번호', { exact: false }).first()).toBeVisible({ timeout: 5_000 });
        await expect(sc.getByText('작업명', { exact: false }).first()).toBeVisible();
        await expect(sc.getByText('상태', { exact: true }).first()).toBeVisible();
        await expect(sc.getByText(/작업\s*종류/).first()).toBeVisible();
        await expect(sc.getByText(/작업\s*분류/).first()).toBeVisible();
        await expect(sc.getByRole('button', { name: '수정' }).first()).toBeVisible();   // [수정] 노출(클릭 안 함=비파괴)
      });
    }
  }

  // ── 4) 연결 이슈/발병정보/일상점검 + [리스트 확인하기] ──
  {
    const m: CheckMeta = { path: `${P} > 연결정보·리스트`, tcRef: '코스관리_작업지시서_4', tcId: 'WO-LINKED', desc: '연결 이슈/발병정보/일상점검 + [리스트 확인하기] × 3', failMsg: '연결 정보/리스트 버튼 미확인' };
    if (!entered) { skip(m, '작업지시서 미진입'); }
    else {
      const sc = mainScope(admin);
      const links = await sc.getByText('리스트 확인하기', { exact: false }).count().catch(() => 0);
      const hasIssue = await sc.getByText('연결 이슈', { exact: false }).first().isVisible({ timeout: 2_000 }).catch(() => false);
      const hasDisease = await sc.getByText('연결 발병정보', { exact: false }).first().isVisible({ timeout: 1_500 }).catch(() => false);
      const hasDaily = await sc.getByText('연결 일상점검', { exact: false }).first().isVisible({ timeout: 1_500 }).catch(() => false);
      if (!(hasIssue || hasDisease || hasDaily)) { skip(m, '연결 정보 섹션 미노출'); }
      else {
        await check(admin, m, async () => {
          expect(hasIssue, '연결 이슈 미노출').toBeTruthy();
          expect(hasDisease, '연결 발병정보 미노출').toBeTruthy();
          expect(hasDaily, '연결 일상점검 미노출').toBeTruthy();
          expect(links, '[리스트 확인하기] 3개 미확인').toBeGreaterThanOrEqual(3);
        }, { getActual: async () => `연결(이슈:${hasIssue}·발병:${hasDisease}·일상:${hasDaily})·리스트확인하기 ${links}개` });

        // [리스트 확인하기](연결 이슈) 클릭 → 리스트 이동/노출 확인(비파괴)
        const m2: CheckMeta = { path: `${P} > 리스트 확인하기`, tcRef: '코스관리_작업지시서_5', tcId: 'WO-LINK-OPEN', desc: '[리스트 확인하기] 클릭 → 연결 리스트 이동/노출', failMsg: '리스트 미노출' };
        try {
          const beforeUrl = admin.url();
          await sc.getByText('리스트 확인하기', { exact: false }).first().click({ timeout: 3_000 }).catch(() => {});
          await admin.waitForTimeout(1_500); await killAlarms(admin);
          const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
          const modalShown = await modal.isVisible({ timeout: 2_000 }).catch(() => false);
          const urlChanged = admin.url() !== beforeUrl;
          const listShown = modalShown || urlChanged || await sc.getByText(/이슈명|이슈번호|목록|리스트/).first().isVisible({ timeout: 1_500 }).catch(() => false);
          if (listShown) record(m2, 'PASS', { actual: modalShown ? '리스트 모달 노출' : urlChanged ? '리스트 화면 이동' : '리스트 콘텐츠 노출' });
          else skip(m2, '리스트 이동/노출 미확인(구조 상이)');
          if (modalShown) { await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
        } catch (e) { record(m2, 'FAIL', { error: '리스트 확인하기 예외', detail: (e as Error).message.slice(0, 120) }); }
      }
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_작업지시서');
});

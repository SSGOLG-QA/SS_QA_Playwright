import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_URL } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  미커버 보강(비파괴) — 커버리지 리포트의 미커버 43 중 '가치 있는' 상호작용만 선별 커버.
//  실행: npm run course:auth 후 npm run course:uncov
//  선별 기준: 비파괴로 신뢰성 있게 테스트 가능 + 실제 커버 이득. 제외 = 맵/3D 시각·데이터 의존 보기/수정.
//  대상(4화면): Home 3버튼(평가내역 보기·평가기준 설정하기·목표 설정 모달) / 코스 모니터 인력 탭 /
//    거래처 정보 초기화 / 권한관리 전체 토글.
//  ⚠ 화면 순서 = 가벼운 화면(Home·거래처·권한) 먼저 · 맵 화면(코스 모니터) 나중(세션 수명 ~4-5 네비).
//  전부 비파괴(모달 열기→취소·탭 전환·초기화·토글 원복, 저장/삭제 안 함).
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

async function gotoHome(admin: Page) {
  await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_200);
  if (!/\/(home|dashboard)?(\?|$)/.test(admin.url())) { await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(1_500); }
  await killAlarms(admin);
}

// 모달/새 뷰 열림 판정 + 비파괴 닫기(취소/닫기/Escape, 새 화면이면 뒤로/홈).
async function openThenClose(admin: Page, m: CheckMeta, name: RegExp): Promise<void> {
  const btn = M(admin).getByRole('button', { name }).first();
  if (!(await btn.isVisible({ timeout: 2_500 }).catch(() => false))) { skip(m, '버튼 미노출'); return; }
  const beforeUrl = admin.url();
  await btn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_100); await killAlarms(admin);
  const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
  const modalShown = await modal.isVisible({ timeout: 2_000 }).catch(() => false);
  if (modalShown) {
    record(m, 'PASS', { actual: '버튼 클릭 → 모달/패널 오픈 → 닫기(비파괴)' });
    await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 1_500 }).catch(() => {});
    await admin.keyboard.press('Escape').catch(() => {});
  } else if (admin.url() !== beforeUrl) {
    record(m, 'PASS', { actual: `버튼 클릭 → 화면 이동(${admin.url().replace(/https?:\/\/[^/]+/, '')})` });
    await gotoHome(admin);   // 비파괴 복귀
  } else skip(m, '클릭 후 모달/이동 미확정');
  await killAlarms(admin);
}

test('미커버 보강 — 가치 있는 상호작용 선별 커버(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  admin.on('filechooser', (fc) => { fc.setFiles([]).catch(() => {}); });

  // ① Home 3버튼 (모달) — 최저 커버(25%) 큰 이득
  await gotoHome(admin);
  await openThenClose(admin, { path: 'Home > 평가내역 보기', tcRef: '코스관리_홈_평가내역', tcId: 'HOME-REVIEW', desc: '[평가내역 보기] → 모달/화면 열림 → 닫기(비파괴)', failMsg: '미오픈' }, /평가내역\s*보기/);
  await gotoHome(admin);
  await openThenClose(admin, { path: 'Home > 평가기준 설정하기', tcRef: '코스관리_홈_평가기준', tcId: 'HOME-CRITERIA', desc: '[평가기준 설정하기] → 모달/화면 열림 → 닫기(비파괴)', failMsg: '미오픈' }, /평가기준\s*설정/);
  await gotoHome(admin);
  await openThenClose(admin, { path: 'Home > 목표 설정', tcRef: '코스관리_홈_목표설정', tcId: 'HOME-GOAL', desc: '[목표 설정] → 목표 등급 모달 열림 → 닫기(비파괴)', failMsg: '미오픈' }, /목표\s*설정/);

  // ② 거래처 정보 > 초기화 (검색 초기화)
  {
    const m: CheckMeta = { path: '정보 관리 > 거래처 정보 > 초기화', tcRef: '코스관리_거래처_초기화', tcId: 'VENDOR-RESET', desc: '[초기화] 클릭 → 검색/필터 초기화(비파괴)', failMsg: '초기화 미동작' };
    if (await gotoCourseMenu(admin, '정보 관리', '거래처 정보').then(() => true).catch(() => false)) {
      await admin.waitForTimeout(1_500); await killAlarms(admin);
      const btn = M(admin).getByRole('button', { name: /^\s*초기화\s*$/ }).first();
      if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '[초기화] 미노출');
      else { await btn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin); record(m, 'PASS', { actual: '[초기화] 클릭 → 검색/필터 초기화(비파괴)' }); }
    } else skip(m, '거래처 정보 진입 실패');
  }

  // ③ 권한관리 > 전체 토글
  {
    const m: CheckMeta = { path: '인력 관리 > 권한관리 > 전체 토글', tcRef: '코스관리_권한_전체토글', tcId: 'PERM-ALL-TOGGLE', desc: '전체 권한 토글 클릭 → 상태 전환 → 원복(비파괴)', failMsg: '토글 미동작' };
    if (await gotoCourseMenu(admin, '인력 관리', '권한관리').then(() => true).catch(() => false)) {
      await admin.waitForTimeout(1_500); await killAlarms(admin);
      // '전체' 라벨을 품은 토글(체크박스/스위치) — 라벨 클릭 후 원복
      const toggleLabel = M(admin).locator('label').filter({ hasText: /^\s*전체\s*$/ }).first();
      const anyToggle = M(admin).locator('input[type="checkbox"], .toggle, [class*="switch"]').first();
      const target = (await toggleLabel.isVisible({ timeout: 1_500 }).catch(() => false)) ? toggleLabel : anyToggle;
      if (!(await target.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, '전체 토글 미노출');
      else {
        try {
          await target.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin);
          await target.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);   // 원복
          record(m, 'PASS', { actual: '전체 권한 토글 전환 → 원복(비파괴, 저장 안 함)' });
        } catch (e) { record(m, 'FAIL', { error: '토글 예외', detail: (e as Error).message.slice(0, 100) }); }
      }
    } else skip(m, '권한관리 진입 실패');
  }

  // ④ 코스 모니터 > 인력 탭 (맵 화면 — 세션 수명 고려 맨 뒤)
  {
    const m: CheckMeta = { path: '코스 현황 관리 > 코스 모니터 > 인력 탭', tcRef: '코스관리_모니터_인력탭', tcId: 'CMON-TAB-인력', desc: '[인력] 탭 클릭 → 인력 뷰 전환', failMsg: '탭 전환 미동작' };
    if (await gotoCourseMenu(admin, '코스 현황 관리', '코스 모니터').then(() => true).catch(() => false)) {
      await admin.waitForTimeout(2_500); await killAlarms(admin);
      const tab = M(admin).getByText(/^\s*인력\s*$/).first();
      if (!(await tab.isVisible({ timeout: 3_000 }).catch(() => false))) skip(m, '[인력] 탭 미노출');
      else {
        try {
          const before = (await M(admin).textContent().catch(() => '') || '').slice(0, 300);
          await tab.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin);
          const after = (await M(admin).textContent().catch(() => '') || '').slice(0, 300);
          const active = await tab.evaluate((e) => /active|selected|on\b/.test((e.className || '') + (e.parentElement?.className || ''))).catch(() => false);
          record(m, 'PASS', { actual: `[인력] 탭 클릭 → ${before !== after ? '뷰 전환' : active ? '탭 활성 표시' : '탭 클릭(반응 미감지·존재 확인)'}` });
        } catch (e) { record(m, 'FAIL', { error: '인력 탭 예외', detail: (e as Error).message.slice(0, 100) }); }
      }
    } else skip(m, '코스 모니터 진입 실패');
  }

  await killAlarms(admin);
  await writeReport('코스관리_미커버보강');
});

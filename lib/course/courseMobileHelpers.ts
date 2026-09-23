import { expect, Page } from '@playwright/test';
import { settle } from '../adminHelpers';
import { dismissBlockingOverlays } from '../popupHandlers';
import { COURSE_MOBILE_URL } from './courseHelpers';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** 공통 헬퍼 (2026-09-11 IA 실측 기반)
//  - 대상: https://course-mng-td.smartscore.kr/mobile/  (별도 Vue 앱, title "Course Mobile")
//  - 진입: 모바일 홈(타일 4개) → [코스관리] 타일 → /mobile/course (기능 9영역 랜딩)
//  - ⚠ 데스크톱과 DOM 체계 다름: SNB/.contents-box/.tab-group 없음. 메뉴 타일=`.content-box`(제목 .fs-20).
//    라우트=`/course/:component` 동적. 네비는 타일 텍스트 클릭.
//  - ⚠ 세션은 course-mobile.json(데스크톱 course.json과 분리). 만료 시 course:auth-mobile 재인증.
//  - 비파괴 원칙(데스크톱과 동일): 저장/삭제/변경/등록 클릭 금지, 노출·구조만 검증.
// ──────────────────────────────────────────────────────────────

// 코스관리 모바일 기능 영역(코스관리 랜딩 타일 = /mobile/course). IA 실측(2026-09-11).
//   데스크톱 11 대메뉴의 **현장 부분집합** — 예산/비용/인력/사진 관리는 모바일 미제공.
export const MOBILE_CM_AREAS = [
  '작업 지시', '작업 관리', '코스 뷰', '일상 점검', '코스정보', '이슈/예측', '장비관리', '시설관리', '자재관리',
] as const;
export type MobileArea = typeof MOBILE_CM_AREAS[number];

// 모바일 알림/오버레이 정리(데스크톱 killAlarms 대응).
export async function killMobileAlarms(page: Page): Promise<number> {
  return dismissBlockingOverlays(page);
}

// 모바일 앱 진입(세션 재사용) — /mobile/ 홈 로드 + 로그인 상태 검증. 미인증이면 fail-fast(재인증 안내).
export async function openCourseMobile(page: Page): Promise<Page> {
  await page.goto(COURSE_MOBILE_URL, { waitUntil: 'domcontentloaded' });
  // 진입 판정: 로그인 페이지(만료) vs 건강한 홈(코스관리 타일 노출).
  const cmTile = page.getByText('코스관리', { exact: true }).first();
  await expect
    .poll(async () => {
      if (/\/mobile\/Login/i.test(page.url())) return 'login';
      if (await cmTile.isVisible().catch(() => false)) return 'ok';
      return 'wait';
    }, { timeout: 25_000, intervals: [500, 1000, 1500, 2000] })
    .not.toBe('wait')
    .catch(() => {});
  if (/\/mobile\/Login/i.test(page.url()) || !(await cmTile.isVisible().catch(() => false))) {
    throw new Error(
      `[openCourseMobile] 모바일 세션 무효/만료 (${page.url()}). `
      + `\`npm run course:auth-mobile\`(헤디드 수동 로그인)로 재인증 후 다시 실행하세요. `
      + `(세션은 재로그인 1회당 1런만 생존)`,
    );
  }
  await settle(page, 600);
  await killMobileAlarms(page);
  return page;
}

// 코스관리 기능 랜딩(/mobile/course, 정확히) 진입.
//   ⚠ 핵심(2026-09-11 캐스케이드 버그 수정): 랜딩 판정은 반드시 `/mobile/course$`(끝) — 서브페이지(/course/issuePrediction 등)를
//   '랜딩'으로 오판하면 타일 클릭을 건너뛰어 다음 영역 진입이 연쇄 실패했음. 서브페이지면 뒤로가기로 랜딩 복귀, 그 외엔 홈 경유 타일 클릭.
export async function enterCourseMgmt(page: Page): Promise<boolean> {
  if (/\/mobile\/course$/i.test(page.url())) return true;
  // 서브페이지(/course/xxx) → 뒤로가기로 랜딩 복귀
  if (/\/mobile\/course\//i.test(page.url())) {
    for (let i = 0; i < 3 && !/\/mobile\/course$/i.test(page.url()); i++) { if (!(await mobileBack(page))) break; }
    if (/\/mobile\/course$/i.test(page.url())) { await killMobileAlarms(page); return true; }
  }
  // 홈이 아니면 홈으로 이동 후 [코스관리] 타일 클릭
  if (!/\/mobile\/?$/i.test(page.url())) { await page.goto(COURSE_MOBILE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); await settle(page, 900); }
  const tile = page.getByText('코스관리', { exact: true }).first();
  if (await tile.count().catch(() => 0)) {
    await tile.click({ timeout: 4_000 }).catch(() => {});
    await expect.poll(async () => /\/mobile\/course$/i.test(page.url()), { timeout: 8_000, intervals: [400, 800] }).toBeTruthy().catch(() => {});
    await settle(page, 700);
  }
  await killMobileAlarms(page);
  return /\/mobile\/course$/i.test(page.url());
}

// 코스관리 랜딩에서 특정 기능 영역(타일) 진입 — `.content-box` 중 영역 제목을 품은 타일 클릭.
//   ⚠ enterCourseMgmt가 '정확한 랜딩' 보장 → 타일 클릭 → 서브페이지(/course/<route>) 도달로 진입 성공 판정.
export async function gotoMobileArea(page: Page, area: MobileArea): Promise<boolean> {
  if (!(await enterCourseMgmt(page))) return false;   // 랜딩 보장 실패 → 진입 불가(호출부 skip)
  await killMobileAlarms(page);
  const byBox = page.locator('.content-box').filter({ hasText: area }).first();
  const target = (await byBox.count().catch(() => 0)) ? byBox : page.getByText(area, { exact: true }).first();
  if (!(await target.count().catch(() => 0))) return false;
  await target.click({ timeout: 4_000 }).catch(() => {});
  await expect.poll(async () => /\/mobile\/course\//i.test(page.url()), { timeout: 6_000, intervals: [400, 800] }).toBeTruthy().catch(() => {});
  await settle(page, 800);
  await killMobileAlarms(page);
  return /\/mobile\/course\//i.test(page.url());   // 서브페이지 도달 = 진입 성공
}

// 코스관리 랜딩으로 복귀(뒤로가기 우선, 실패 시 직접 네비).
export async function backToCourseMgmt(page: Page): Promise<void> {
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle(page, 500);
  if (!/\/mobile\/course/i.test(page.url())) { await enterCourseMgmt(page); }
  await killMobileAlarms(page);
}

// ── 헤더/인터랙션 프리미티브(2026-09-11 인터랙션 프로브 실측) ──────────────
//  헤더: 알림=i.ico-alarm(→/course/notification), 홈=i.ico-home(→/mobile/), 뒤로=i.ico-arrow-prev.
export async function mobileBack(page: Page): Promise<boolean> {
  const back = page.locator('i.ico-arrow-prev, [class*="ico-arrow-prev"]').first();
  if (!(await back.count().catch(() => 0))) { await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); return false; }
  await back.click({ timeout: 2_500 }).catch(() => {});
  await settle(page, 700); await killMobileAlarms(page);
  return true;
}
// 서브페이지(알림/상세 등) → 코스관리 랜딩(/mobile/course)으로 견고 복귀.
export async function returnToLanding(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (/\/mobile\/course$/i.test(page.url())) break;
    if (!(await mobileBack(page))) break;
  }
  if (!/\/mobile\/course$/i.test(page.url())) { await page.goto(COURSE_MOBILE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); await settle(page, 900); await enterCourseMgmt(page); }
  await killMobileAlarms(page);
}
// 헤더 알림 열기(→/notification). 반환: 알림 페이지 도달 여부.
export async function openAlarm(page: Page): Promise<boolean> {
  const bell = page.locator('button.button-common.type-i:has(i.ico-alarm), i.ico-alarm').first();
  if (!(await bell.count().catch(() => 0))) return false;
  await bell.click({ timeout: 3_000 }).catch(() => {});
  await settle(page, 1_200); await killMobileAlarms(page);
  return /\/mobile\/course\/notification/i.test(page.url());
}
// 헤더 홈 이동(→/mobile/). 반환: 홈 도달 여부.
export async function goMobileHome(page: Page): Promise<boolean> {
  const home = page.locator('button.button-common.type-i:has(i.ico-home), i.ico-home').first();
  if (!(await home.count().catch(() => 0))) return false;
  await home.click({ timeout: 3_000 }).catch(() => {});
  await settle(page, 1_200); await killMobileAlarms(page);
  return /\/mobile\/?$/i.test(page.url());
}

// ── vue-select 폼 프리미티브(CRUD) — 코스 모바일 셀렉트=.v-select. 토글→첫 옵션 선택. ──
export async function pickFirstVueOption(page: Page, vsel: import('@playwright/test').Locator): Promise<boolean> {
  const toggle = vsel.locator('.vs__dropdown-toggle').first();
  if (!(await toggle.count().catch(() => 0))) return false;
  await toggle.click({ timeout: 2_500 }).catch(() => {});
  await settle(page, 500);
  const opt = page.locator('.vs__dropdown-menu li, .vs__dropdown-option, li[role="option"]').filter({ visible: true }).first();
  if (!(await opt.count().catch(() => 0))) { await page.keyboard.press('Escape').catch(() => {}); return false; }
  await opt.click({ timeout: 2_500 }).catch(() => {});
  await settle(page, 500);
  return true;
}

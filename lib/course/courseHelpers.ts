import { expect, Page, BrowserContext } from '@playwright/test';
import { navigateMenu, settle } from '../adminHelpers';
import { installPopupHandlers, dismissBlockingOverlays } from '../popupHandlers';

// ──────────────────────────────────────────────────────────────
//  코스관리(Course Management) 어드민 공통 헬퍼
//  - 대상: https://course-mng-td.smartscore.kr (클럽 킹즈락, td=테스트 환경)
//  - 진입: 클라우드 대시보드(sv1td4) → 코스관리 카드 → [바로가기](새 탭). `.smartscore.kr` 공유 쿠키.
//  - 프레임워크는 경기관제 어드민과 동일(.side-navbar-container / .depth-1/2 / .contents-box)
//    → SNB 네비게이션은 adminHelpers 의 navigateMenu/settle 를 그대로 재사용.
//  - ⚠ 코스관리 고유: 알림 모달(.modal-group.alarm)이 자동으로 떠 dim 오버레이가 클릭을 차단
//    → killAlarms + addLocatorHandler 로 상시 정리 필수.
//  - ⚠ 세션은 "재로그인 1회당 1런"만 생존(공유 QA 계정). 헤디드 수동 로그인은 auth/course.setup.ts.
// ──────────────────────────────────────────────────────────────

export const COURSE_SUBDOMAIN = process.env.COURSE_SUBDOMAIN || 'course-mng-td';
export const COURSE_ORIGIN = `https://${COURSE_SUBDOMAIN}.smartscore.kr`;
export const COURSE_URL = `${COURSE_ORIGIN}/?langCode=ko`;
export const DASHBOARD_URL = 'https://sv1td4.smartscore.kr/ko/dashboard';
export const COURSE_STORAGE = 'auth/.auth/course.json';

// ── IA (실측 SNB, 2026-08-05) — 대메뉴 → 소메뉴(라우트) ───────────────────
export interface CourseSub { name: string; route: string; }
export interface CourseMenu { menu: string; subs: CourseSub[]; }
export const COURSE_IA: CourseMenu[] = [
  { menu: 'Home', subs: [{ name: 'Home', route: '/' }] },
  { menu: '코스 현황 관리', subs: [
    { name: '코스 모니터', route: '/monitor/view' },
    { name: '식생 분석', route: '/monitor/spectral' },
    { name: '코스 영역 설정', route: '/monitor/draw' },
    { name: '드론사진 업로드', route: '/monitor/upload' },
    { name: '3D', route: '/monitor/3d' },
    { name: '그린 분석', route: '/monitor/green' },
  ] },
  { menu: '정보 관리', subs: [
    { name: '코스 기본 정보', route: '/info/course' },
    { name: '코스 리뉴얼 정보', route: '/info/renewal' },
    { name: '홀 별 정보', route: '/info/hole' },
    { name: '잔디 측정 정보', route: '/info/grass' },
    { name: '토양 측정 정보', route: '/info/soil' },
    { name: '발병 정보', route: '/info/disease' },
    { name: '코스 운영 정보', route: '/info/operation' },
    { name: '기상 정보', route: '/info/weather' },
    { name: '거래처 정보', route: '/info/vendor' },
    { name: '관리 기준 정보', route: '/info/eval' },
    { name: '일상 점검', route: '/info/daily' },
  ] },
  { menu: '사진 관리', subs: [
    { name: '정보별 사진', route: '/photo/info' },
    { name: '위치별 사진', route: '/photo/loc' },
  ] },
  { menu: '작업 관리', subs: [
    { name: '작업 지시', route: '/task/orders' },
    { name: '작업 계획', route: '/task/plan' },
    { name: '이슈 관리', route: '/task/issue' },
    { name: '예측 정보', route: '/task/predict' },
    { name: '작업 일보', route: '/task/daily' },
  ] },
  { menu: '예산 관리', subs: [
    { name: '예산 총괄', route: '/budget/summary' },
    { name: '예산 상세', route: '/budget/detail' },
    { name: '실적 관리', route: '/budget/performance' },
    { name: '예산 분석', route: '/budget/analysis' },
  ] },
  { menu: '비용 관리', subs: [
    { name: '비용 집계', route: '/cost/aggregate' },
    { name: '작업별 비용', route: '/cost/task' },
    { name: '분류별 비용', route: '/cost/category' },
    { name: '위치별 비용', route: '/cost/loc' },
    { name: '기간별 비용', route: '/cost/period' },
  ] },
  { menu: '인력 관리', subs: [
    { name: '권한관리', route: '/hr/perms' },
    { name: '인력 관리', route: '/hr/human' },
    { name: '근태 관리', route: '/hr/work' },
    { name: '투입 관리', route: '/hr/assign' },
  ] },
  { menu: '장비 관리', subs: [
    { name: '장비 총괄', route: '/equipment/summary' },
    { name: '장비 관제', route: '/equipment/monitor' },
  ] },
  { menu: '자재 관리', subs: [
    { name: '자재 총괄', route: '/material/summary' },
    { name: '자재 수불(품목별)', route: '/material/ledger-item' },
    { name: '자재 수불(일자별)', route: '/material/ledger-daily' },
  ] },
  { menu: '시설 관리', subs: [
    { name: '시설 총괄', route: '/facility/summary' },
    { name: '시설 관제', route: '/facility/monitor' },
  ] },
];

// 코스관리 알림/공지 모달 + dim 오버레이 즉시 제거. 공용 dismissBlockingOverlays 로 위임(하위호환 API 유지).
export async function killAlarms(page: Page): Promise<number> {
  return dismissBlockingOverlays(page);
}

// 코스관리 어드민 진입(세션 재사용) — course.json 쿠키로 course-mng-td 직접 로드.
//   로그인 페이지로 빠지면 세션 만료로 판단하고 fail-fast(명확한 재인증 안내).
export async function openCourseAdmin(page: Page, _context?: BrowserContext): Promise<Page> {
  await page.goto(COURSE_URL, { waitUntil: 'domcontentloaded' });

  // 진입 판정: 로그인 페이지(세션 만료) / 건강한 진입(SNB 셸 + depth-2 nav 데이터 렌더) 구분.
  //   ⚠ 셸(.depth-1-title)만 뜨고 .depth-2 a 가 비어있으면 '반쯤 로그아웃'된 degraded 세션
  //     (API 인증 실패 → 네비/본문 데이터 미로드). "재로그인 1회당 1런" 제약으로 흔함 → fail-fast.
  const snb = page.locator('.side-navbar-container .depth-1-title').first();
  const navReady = async () => page.locator('.side-navbar-container .depth-2 a').count().catch(() => 0);
  await expect
    .poll(async () => {
      if (/\/login/.test(page.url())) return 'login';
      if ((await snb.isVisible().catch(() => false)) && (await navReady()) > 0) return 'ok';
      return 'wait';
    }, { timeout: 25_000, intervals: [500, 1000, 1500, 2000] })
    .not.toBe('wait')
    .catch(() => {});

  const shellOnly = (await snb.isVisible().catch(() => false)) && (await navReady()) === 0;
  if (/\/login/.test(page.url()) || shellOnly || !(await snb.isVisible().catch(() => false))) {
    const why = /\/login/.test(page.url()) ? '로그인 페이지로 이동' : shellOnly ? 'SNB 셸만 노출·네비/본문 미로드(반쯤 로그아웃)' : 'SNB 미노출';
    throw new Error(
      `[openCourseAdmin] 코스관리 세션 무효/만료 — ${why} (${page.url()}). `
      + `\`npm run course:auth\`(헤디드 수동 로그인)로 재인증 후 다시 실행하세요. `
      + `(세션은 재로그인 1회당 1런만 생존 — 직전에 다른 코스관리 런을 돌렸다면 세션이 소진됨)`,
    );
  }

  // 팝업 Interception 자동 처리 전략 — 진입 직후 1회 install(알림/공지/알림배너 자동 닫기).
  await installPopupHandlers(page);
  await dismissBlockingOverlays(page);
  await settle(page, 800);
  return page;
}

// 코스관리 datepicker에 특정 날짜(ISO 'YYYY-MM-DD') 입력(비파괴).
//   ⚠ 실측(프로브 2026-08-06): 코스관리 datepicker = `input.datepicker-input`(type=text, maxlength=10,
//     placeholder YYYY-MM-DD) — 달력 팝업 아님, **타이핑(fill) 입력**. 범위형이면 시작·종료 2개.
//   경기관제(달력 전용 `.datepicker-layer`)와 다르므로 fill 사용. datepicker 없으면 false.
export async function pickCourseDate(page: Page, iso: string, _which = 0): Promise<boolean> {
  await dismissBlockingOverlays(page);
  const inputs = page.locator('.datepicker-input:visible');
  const n = await inputs.count().catch(() => 0);
  if (!n) return false;
  const idxs = n >= 2 ? [0, 1] : [0];   // 범위형: 시작·종료 모두 채워 유효 범위(비파괴 검색 필터)
  let okAny = false;
  for (const i of idxs) {
    const inp = inputs.nth(i);
    if (!(await inp.isVisible().catch(() => false))) continue;
    await inp.click({ timeout: 3000 }).catch(() => {});
    await inp.fill('').catch(() => {});
    await inp.fill(iso).catch(() => {});
    await inp.press('Enter').catch(() => {});
    await page.waitForTimeout(200);
    const v = (await inp.inputValue().catch(() => '')).replace(/[^0-9-]/g, '');
    if (v.includes(iso)) okAny = true;
  }
  await page.keyboard.press('Escape').catch(() => {});
  return okAny;
}

// 코스관리 range datepicker(시작~종료) 범위 설정 → [적용]. 반환: 두 값 반영 여부.
//   ⚠ 핵심(2026-08-14 해결): range-picker는 nav 클릭·키보드·JS세터 무반응 + Playwright `fill()`은 `fill('')`가
//     range를 리셋시켜 다른 입력을 지움. → **수동 타이핑 충실 재현**: 클릭 → Ctrl+A(전체선택) → pressSequentially(한 글자씩) → Tab.
//   fill 금지. 단일 날짜는 pickCourseDate(fill) OK, 범위는 반드시 이 방식.
export async function setCourseDateRange(page: Page, startIso: string, endIso: string): Promise<boolean> {
  const scope = page.locator('.contents, main').first();
  const inputs = scope.locator('.datepicker-input:visible');
  if ((await inputs.count().catch(() => 0)) < 2) return false;
  const applyBtn = scope.getByRole('button', { name: /^\s*적용\s*$/ }).first();
  // ⚠ 핵심(영상 프레임 분석): 입력이 숫자만 받아 대시를 자동 삽입 → **대시 없이 숫자8자리만 타이핑**("20250101").
  //   대시 포함 타이핑("2025-01-01")은 자동포맷과 충돌해 값이 깨져 사라짐(시작 비어버린 원인). 커밋=다음 필드 클릭(blur).
  const digits = (iso: string) => iso.replace(/[^0-9]/g, '');
  await inputs.nth(0).click({ timeout: 2_000 }).catch(() => {}); await page.waitForTimeout(250);
  await page.keyboard.press('Control+a').catch(() => {});
  await inputs.nth(0).pressSequentially(digits(startIso), { delay: 60 }).catch(() => {});
  await page.waitForTimeout(250);
  await inputs.nth(1).click({ timeout: 2_000 }).catch(() => {}); await page.waitForTimeout(250);   // 종료 클릭 = 시작 커밋
  await page.keyboard.press('Control+a').catch(() => {});
  await inputs.nth(1).pressSequentially(digits(endIso), { delay: 60 }).catch(() => {});
  await page.waitForTimeout(250);
  const s = (await inputs.nth(0).inputValue().catch(() => '')) || '';
  const e = (await inputs.nth(1).inputValue().catch(() => '')) || '';
  const ok = s.includes(startIso.slice(0, 7)) && e.includes(endIso.slice(0, 4));
  await applyBtn.click({ timeout: 2_000 }).catch(() => {});   // 적용 클릭 = 종료 커밋
  await page.waitForTimeout(1_500); await killAlarms(page);
  return ok;
}

// 검색기간을 1년(1년 전~금일)으로 설정 → [적용].
export async function setCourseOneYear(page: Page): Promise<boolean> {
  const t = new Date();
  const end = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const start = `${t.getFullYear() - 1}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return setCourseDateRange(page, start, end);
}

// SNB 메뉴 진입 — 알림 정리 후 navigateMenu(공용) 재사용 + 진입 후 재정리.
export async function gotoCourseMenu(page: Page, parent: string, child?: string): Promise<boolean> {
  await killAlarms(page);
  const ok = await navigateMenu(page, parent, child);
  await settle(page, 700);
  await killAlarms(page);
  return ok;
}

export { navigateMenu, settle };

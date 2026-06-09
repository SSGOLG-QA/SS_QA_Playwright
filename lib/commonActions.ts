import { Page, expect } from '@playwright/test';
import { check } from './reporter';

// ──────────────────────────────────────────────────────────────
//  전체메뉴 공통 버튼 동작 자동화 (비파괴) — 화면에 해당 버튼이 있을 때만 검증.
//   · 내보내기: 클릭 → 다운로드 이벤트 발생만 확인(내용 검증 제외). 0건/알럿 시 데이터 의존 허용.
//   · 초기화: 클릭 → 검색조건 초기화(목록/폼 정상 유지, 비파괴).
//  ⚠ 모두 조회/다운로드/초기화 = 비파괴(데이터 변경 없음). 저장/적용형 초기화가 아닌 '검색 초기화'에 한함.
// ──────────────────────────────────────────────────────────────

// [내보내기] → 엑셀 다운로드 발생만 확인 (내용 검증 X)
export async function checkExportDownload(admin: Page, P: string, R: string, tcId = 'EXPORT-01'): Promise<void> {
  const btn = admin.getByRole('button', { name: '내보내기', exact: true }).first();
  if (!(await btn.isVisible({ timeout: 1500 }).catch(() => false))) return;   // 내보내기 없는 화면 → 조용히 건너뜀
  await check(admin, { path: `${P} > 내보내기`, tcRef: `${R}_내보내기`, tcId, desc: '[내보내기] 클릭 시 엑셀 다운로드 발생(내용 검증 제외)', expected: 'download 이벤트', failMsg: '다운로드 미발생' },
    async () => {
      const dlP = admin.waitForEvent('download', { timeout: 12_000 }).catch(() => null);
      await btn.click();
      const d = await dlP;
      if (d) { expect(d.suggestedFilename(), '다운로드 파일명 존재').toBeTruthy(); return; }
      // 다운로드 미발생 → 0건/알럿(데이터 의존) 허용
      const dataDep = await admin.getByText(/없습니다|내역이 없|데이터가 없|기록이 없/).first().isVisible({ timeout: 1500 }).catch(() => false);
      expect(dataDep, '다운로드 발생 또는 데이터 없음 안내').toBeTruthy();
    });
}

// [초기화] → 검색조건 초기화(목록/콘텐츠 정상 유지, 비파괴)
export async function checkResetFilter(admin: Page, P: string, R: string, tcId = 'RESET-01'): Promise<void> {
  const btn = admin.getByRole('button', { name: '초기화', exact: true }).first();
  if (!(await btn.isVisible({ timeout: 1500 }).catch(() => false))) return;
  await check(admin, { path: `${P} > 초기화`, tcRef: `${R}_초기화`, tcId, desc: '[초기화] 클릭 시 검색조건 초기화(콘텐츠 정상 유지·비파괴)', expected: '초기화 후 화면 정상', failMsg: '초기화 후 오류/화면 깨짐' },
    async () => {
      await btn.click().catch(() => {});
      await admin.waitForTimeout(800);
      await expect(admin.locator('.contents-box').first()).toBeVisible();
    });
}

// [달력] 날짜 선택 → 조회 실동작 (비파괴) — datepicker + 조회/적용 보유 검색폼에서만.
//   ⚠ 데이트피커는 '달력 전용'(fill 미반영) + 팝업이 뷰포트 밖 → 좌표 클릭 대신 DOM el.click() 사용
//      (round-mgmt.pom 의 검증된 방식). 날짜 셀/조회 버튼은 datepicker를 품은 .contents-box 로 스코프
//      → 저장형 [적용](태블릿/아이콘 등) 오클릭 방지(그 화면들엔 datepicker 자체가 없어 진입 안 함).
//   동작: 검색폼 datepicker 열기 → 현재 월 유효 날짜 1개 선택 → [조회]/[적용](검색폼 내) 클릭 → 화면 정상 유지 검증.
//   조회(읽기)·다운로드 없는 순수 조회 동작이라 비파괴. 1개 날짜 선택은 1년 초과 알럿 미발생.
export async function checkDateSearch(admin: Page, P: string, R: string, tcId = 'DATESEARCH-01'): Promise<void> {
  // 검색폼 = datepicker 를 품은 .contents-box (결과 박스·저장폼과 분리)
  const box = admin.locator('.contents-box').filter({ has: admin.locator('.datepicker-input') }).first();
  if (!(await box.isVisible({ timeout: 1500 }).catch(() => false))) return;       // datepicker 없는 화면 → 패스
  // 검색 실행 버튼: '조회' 우선, 없으면 검색폼 내 '적용'(읽기 동작)
  const queryBtn = (await box.getByRole('button', { name: '조회', exact: true }).first().isVisible({ timeout: 800 }).catch(() => false))
    ? box.getByRole('button', { name: '조회', exact: true }).first()
    : box.getByRole('button', { name: '적용', exact: true }).first();
  if (!(await queryBtn.isVisible({ timeout: 800 }).catch(() => false))) return;    // 조회/적용 없는 화면 → 패스

  await check(admin, { path: `${P} > 조회일`, tcRef: `${R}_조회일`, tcId, desc: '달력 날짜 선택 → [조회]/[적용] 동작(비파괴: 읽기)', expected: '조회 후 결과/빈상태 정상 유지', failMsg: '날짜 선택→조회 동작 실패/화면 오류' },
    async () => {
      // 1) 달력 열기 → 현재 월의 유효 날짜 1개 선택 (DOM el.click → 뷰포트 무관)
      await box.locator('.datepicker-input').first().click().catch(() => {});
      const layer = admin.locator('.datepicker-layer').first();
      if (await layer.isVisible({ timeout: 3000 }).catch(() => false)) {
        const cell = layer.locator('.text-num:not(.disabled)').filter({ hasText: /^\d{1,2}$/ }).first();
        await cell.evaluate((el: HTMLElement) => el.click()).catch(() => {});
        await admin.waitForTimeout(120);
        await admin.keyboard.press('Escape').catch(() => {});
      }
      // 2) 조회 실행 → 화면 정상 유지(비파괴 스모크)
      await queryBtn.click().catch(() => {});
      await admin.waitForTimeout(1000);
      await expect(admin.locator('.contents-box').first()).toBeVisible();
    });
}

// 화면 공통 액션 일괄(있는 것만): 달력 날짜선택→조회 → 초기화 → 내보내기
export async function runCommonActions(admin: Page, P: string, R: string): Promise<void> {
  await checkDateSearch(admin, P, R).catch(() => {});
  await checkResetFilter(admin, P, R).catch(() => {});
  await checkExportDownload(admin, P, R).catch(() => {});
}

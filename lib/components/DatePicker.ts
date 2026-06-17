import { Locator, Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────────
//  L2 Component — DatePicker (달력 전용 데이트피커)
//  ⚠ fill()/타이핑은 모델에 반영 안 됨 → 달력 클릭 필수. 팝업이 뷰포트 밖에 떠 좌표 클릭 불가
//     → 날짜 셀을 DOM el.click()(뷰포트 무관)으로 클릭, 닫기는 Escape.
//  (commonActions.checkDateSearch 의 검증된 방식을 컴포넌트화)
//  scope = .datepicker-input 을 품은 검색폼(.contents-box) — 저장형 [적용] 오클릭 방지 위해 스코프 필수.
// ────────────────────────────────────────────────────────────────
export class DatePicker {
  constructor(private scope: Locator) {}
  private page(): Page { return this.scope.page(); }
  input(): Locator { return this.scope.locator('.datepicker-input'); }

  async count(): Promise<number> { return this.input().count().catch(() => 0); }
  async isVisible(): Promise<boolean> { return this.input().first().isVisible().catch(() => false); }

  /** which번째 데이트피커 열어 현재 월 유효 날짜 1개 선택(비파괴). 성공 시 true. */
  async pickAnyValidDay(which = 0): Promise<boolean> {
    const inp = this.input().nth(which);
    if (!(await inp.isVisible().catch(() => false))) return false;
    await inp.click().catch(() => {});
    const layer = this.page().locator('.datepicker-layer').first();
    if (!(await layer.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
    const cell = layer.locator('.text-num:not(.disabled)').filter({ hasText: /^\d{1,2}$/ }).first();
    const ok = await cell.evaluate((el: HTMLElement) => { el.click(); return true; }).catch(() => false);
    await this.page().waitForTimeout(120);
    await this.page().keyboard.press('Escape').catch(() => {});
    return !!ok;
  }
}

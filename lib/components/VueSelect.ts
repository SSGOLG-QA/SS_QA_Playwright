import { Locator, Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────────
//  L2 Component — VueSelect (vue-select 드롭다운)
//  <select>가 아니라 .vs__dropdown-toggle/.vs__selected/.vs__dropdown-option 구조.
//  scope = vue-select(들)를 품은 Locator(.contents-box 등). 화면 무관 재사용.
//   ⚠ 비파괴 주의: choose()는 선택값을 바꾸므로 '조회 필터'에만 사용. 저장형 화면(코스 기본식당 등)은
//      count()/selected()/options() 등 읽기 메서드만 사용할 것.
// ────────────────────────────────────────────────────────────────
export class VueSelect {
  constructor(private scope: Locator) {}
  private page(): Page { return this.scope.page(); }
  private toggle(): Locator { return this.scope.locator('.vs__dropdown-toggle').first(); }

  /** scope 내 vue-select 개수 */
  async count(): Promise<number> {
    return this.scope.locator('.v-select, .vs__dropdown-toggle').count().catch(() => 0);
  }
  async isVisible(): Promise<boolean> {
    return this.toggle().isVisible().catch(() => false);
  }
  /** 현재 선택값(.vs__selected) */
  async selected(): Promise<string> {
    return (await this.scope.locator('.vs__selected').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  }
  async open(): Promise<void> {
    await this.toggle().click().catch(() => {});
    await this.page().locator('.vs__dropdown-menu').first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  }
  /** 드롭다운 옵션 텍스트 목록(연 뒤 Escape로 닫음 — 비파괴) */
  async options(): Promise<string[]> {
    await this.open();
    const opts = await this.page().locator('.vs__dropdown-option').allInnerTexts().catch(() => []);
    await this.page().keyboard.press('Escape').catch(() => {});
    return opts.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  /** 옵션 선택(값 변경 — 파괴적일 수 있음, 조회 필터에서만) */
  async choose(label: string | RegExp): Promise<void> {
    await this.open();
    await this.page().locator('.vs__dropdown-option', { hasText: label }).first().click().catch(() => {});
  }
}

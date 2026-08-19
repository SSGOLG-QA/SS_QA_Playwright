import { Locator, Page } from '@playwright/test';

// ──────────────────────────────────────────────────────────────
//  코스관리 커스텀 위젯 어댑터 (POM) — getByText 로 못 잡는 위젯을 의도 중심으로 조작.
//  실측(2026-08-05 프로브): 코스관리 드롭다운은 전부 vue-select, 코스모니터 좌측 탭은 .sub-navigation-bar li.
// ──────────────────────────────────────────────────────────────

// vue-select 어댑터 — 뷰모드/코스·홀·구역 필터 등 모든 드롭다운 공통.
//   scope = 해당 .v-select 를 품은 컨테이너(또는 .v-select 자체). 옵션은 페이지 레벨 .vs__dropdown-menu 로 렌더.
export class VueSelect {
  constructor(private scope: Locator) {}
  private page(): Page { return this.scope.page(); }
  root(): Locator { return this.scope.locator('.v-select').first(); }
  toggle(): Locator { return this.scope.locator('.vs__dropdown-toggle').first(); }
  selected(): Locator { return this.scope.locator('.vs__selected').first(); }

  async isPresent(): Promise<boolean> { return (await this.scope.locator('.v-select, .vs__dropdown-toggle').count().catch(() => 0)) > 0; }
  async selectedText(): Promise<string> { return (await this.selected().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ').trim(); }
  async open(): Promise<void> { await this.toggle().click({ timeout: 3000 }).catch(() => {}); await this.page().waitForTimeout(300); }

  // 열린 드롭다운 옵션(페이지 레벨). vue-select 는 .vs__dropdown-option(li).
  options(): Locator { return this.page().locator('.vs__dropdown-menu .vs__dropdown-option, .vs__dropdown-menu li'); }
  async optionTexts(): Promise<string[]> {
    return (await this.options().allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  async select(text: string | RegExp): Promise<boolean> {
    await this.open();
    const re = typeof text === 'string' ? new RegExp('^\\s*' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') : text;
    const opt = this.options().filter({ hasText: re }).first();
    if (!(await opt.isVisible({ timeout: 2000 }).catch(() => false))) { await this.page().keyboard.press('Escape').catch(() => {}); return false; }
    await opt.click({ timeout: 3000 }).catch(() => {});
    await this.page().waitForTimeout(700);
    return true;
  }
}

// 코스 모니터 좌측 탭 스트립 — 전체/작업/이슈/점검/인력/관심. 선택 시 화면(패널) 변형.
export class MonitorTabStrip {
  constructor(private page: Page) {}
  strip(): Locator { return this.page.locator('.sub-navigation-bar').first(); }
  tab(name: string): Locator {
    return this.strip().locator('li').filter({ hasText: new RegExp('^\\s*' + name + '\\s*$') }).first();
  }
  async isPresent(): Promise<boolean> { return (await this.strip().count().catch(() => 0)) > 0; }
  async select(name: string): Promise<void> {
    await this.tab(name).click({ timeout: 4000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
  }
  async activeText(): Promise<string> {
    return (await this.strip().locator('li.active').first().innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ').trim();
  }
}

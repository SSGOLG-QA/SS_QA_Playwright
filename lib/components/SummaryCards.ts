import { Locator, Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────────
//  L2 Component — SummaryCards (요약 카드 그룹)
//  .summary-card (__label / __value / __sub). 대시보드·통계 화면 공통.
//  root = 카드들을 품은 Locator 또는 Page(전역).
// ────────────────────────────────────────────────────────────────
export class SummaryCards {
  constructor(private root: Locator | Page) {}
  private loc(sel: string): Locator { return (this.root as Page).locator ? (this.root as Page).locator(sel) : (this.root as Locator).locator(sel); }

  async count(): Promise<number> { return this.loc('.summary-card').count().catch(() => 0); }
  async labels(): Promise<string[]> {
    return (await this.loc('.summary-card__label').allInnerTexts().catch(() => [])).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  card(label: string | RegExp): Locator { return this.loc('.summary-card').filter({ hasText: label }).first(); }
  async value(label: string | RegExp): Promise<string> {
    return (await this.card(label).locator('.summary-card__value').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  }
  async sub(label: string | RegExp): Promise<string> {
    return (await this.card(label).locator('.summary-card__sub').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  }
  async has(label: string | RegExp): Promise<boolean> { return (await this.card(label).count().catch(() => 0)) > 0; }
}

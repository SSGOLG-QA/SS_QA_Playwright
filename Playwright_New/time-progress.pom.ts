import { Page, Locator, expect } from '@playwright/test';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { MENU, SCREEN, TIMEOUT } from './time-progress.data';

const RAW = [
  { n: '{{ }}', re: /\{\{[\s\S]{0,40}?\}\}/ }, { n: 'undefined', re: /\bundefined\b/ },
  { n: 'NaN', re: /(^|[^A-Za-z])NaN([^A-Za-z]|$)/ }, { n: '[object Object]', re: /\[object Object\]/ },
  { n: 'JSON', re: /\{\s*"\w+"\s*:/ }, { n: '$t(', re: /\$t\(/ }, { n: 'v-dir', re: /\bv-(if|for|bind|model|show)\b/ },
];

export class TimeBasePage {
  constructor(protected readonly page: Page) {}
  get gnbTitle(): Locator { return this.page.locator('h1').first(); }
  get infoBox(): Locator { return this.page.locator('.info-box-text'); }
  get table(): Locator { return this.page.locator('.table-overflow-item table').first(); }
  get rows(): Locator { return this.table.locator('tbody tr'); }
  column(name: string): Locator { return this.table.getByRole('columnheader', { name, exact: true }).first(); }
  button(name: string): Locator { return this.page.getByRole('button', { name, exact: true }); }

  async open(sub: string): Promise<void> { await navigateMenu(this.page, MENU, sub); await settle(this.page); }
  async expectLoaded(urlPart: string): Promise<void> {
    await expect(this.page, '지정 URL 로드').toHaveURL(new RegExp(urlPart.replace(/\//g, '\\/')), { timeout: TIMEOUT.load });
    await expect(this.gnbTitle, 'GNB 노출').toBeVisible();
  }
  async expectSessionAlive(): Promise<void> {
    await expect(this.page, '세션 유지(/club/)').toHaveURL(/\/club\//);
    await expect(this.gnbTitle, '세션 유지(관제 어드민)').toHaveText(/관제 어드민/);
  }
  async scanRawCode(): Promise<string[]> {
    const body = await this.page.locator('body').innerText();
    return RAW.filter(p => p.re.test(body)).map(p => p.n);
  }
  async renderedRowCount(): Promise<number> {
    const empty = await this.rows.filter({ hasText: /내역이 없|데이터가 없|기록이 없|조회된/ }).count().catch(() => 0);
    return empty > 0 ? 0 : await this.rows.count();
  }
  async listTotalCount(): Promise<number | null> {
    const body = await this.page.locator('body').innerText();
    const m = body.match(/검색\s*결과\s*:?\s*([\d,]+)/) || body.match(/총\s*([\d,]+)\s*(?:건|개|팀)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }
}

export class StandardPage extends TimeBasePage { async open() { await super.open(SCREEN.standard.sub); } }
export class RealtimePage extends TimeBasePage {
  async open() { await super.open(SCREEN.realtime.sub); }
  // 홀별시각보기 → 상세 모달(읽기). 비파괴: 열고 닫기만.
  detailModal(): Locator { return this.page.locator('.modal, [class*="modal-wrap"], [role="dialog"]').filter({ hasNot: this.page.locator('.snb-toggle__switchbtn') }).first(); }
}
export class SearchPage extends TimeBasePage {
  async open() { await super.open(SCREEN.search.sub); }
  get datepickers(): Locator { return this.page.locator('.datepicker-input'); }
}
export class StatsPage extends TimeBasePage { async open() { await super.open(SCREEN.stats.sub); } }

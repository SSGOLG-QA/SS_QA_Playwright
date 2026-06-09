import { Page, Locator, expect } from '@playwright/test';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { MENU, SCREEN, TIMEOUT } from './beto.data';

const RAW = [
  { n: '{{ }}', re: /\{\{[\s\S]{0,40}?\}\}/ }, { n: 'undefined', re: /\bundefined\b/ },
  { n: 'NaN', re: /(^|[^A-Za-z])NaN([^A-Za-z]|$)/ }, { n: '[object Object]', re: /\[object Object\]/ },
  { n: 'JSON', re: /\{\s*"\w+"\s*:/ }, { n: '$t(', re: /\$t\(/ }, { n: 'v-dir', re: /\bv-(if|for|bind|model|show)\b/ },
];

export class BetoBasePage {
  constructor(protected readonly page: Page) {}
  get gnbTitle(): Locator { return this.page.locator('h1').first(); }
  get infoBox(): Locator { return this.page.locator('.info-box-text'); }
  get table(): Locator { return this.page.locator('.table-overflow-item table, .table-overflow-x table').first(); }
  get rows(): Locator { return this.table.locator('tbody tr'); }
  get datepickers(): Locator { return this.page.locator('.datepicker-input'); }
  column(name: string): Locator { return this.table.getByRole('columnheader', { name, exact: false }).first(); }
  button(name: string): Locator { return this.page.getByRole('button', { name, exact: true }); }

  async open(sub: string): Promise<void> {
    // SNB 링크가 isVisible 통과 후 클릭 직전 접히는 레이스(배토 통계 등) 대비 1회 재시도
    try { await navigateMenu(this.page, MENU, sub); }
    catch { await this.page.waitForTimeout(500); await navigateMenu(this.page, MENU, sub); }
    await settle(this.page);
  }
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
}

export class BetoRecordPage extends BetoBasePage {
  async open() { await super.open(SCREEN.record.sub); }
  viewBtn(): Locator { return this.page.getByRole('button', { name: SCREEN.record.viewBtn, exact: true }); }
}
export class BetoStatsPage extends BetoBasePage {
  async open() { await super.open(SCREEN.stats.sub); }
  modeBtn(name: string): Locator { return this.page.getByRole('button', { name, exact: true }); }
}

import { Page, Locator, expect } from '@playwright/test';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { MENU, SCREEN, TIMEOUT } from './course-ops.data';

// 화면 본문 미가공 코드/오타 패턴 (round-mgmt와 동일 기준)
const RAW = [
  { n: '{{ }}', re: /\{\{[\s\S]{0,40}?\}\}/ }, { n: 'undefined', re: /\bundefined\b/ },
  { n: 'NaN', re: /(^|[^A-Za-z])NaN([^A-Za-z]|$)/ }, { n: '[object Object]', re: /\[object Object\]/ },
  { n: 'JSON', re: /\{\s*"\w+"\s*:/ }, { n: '$t(', re: /\$t\(/ }, { n: 'v-dir', re: /\bv-(if|for|bind|model|show)\b/ },
];

export class CourseBasePage {
  constructor(protected readonly page: Page) {}
  get gnbTitle(): Locator { return this.page.locator('h1').first(); }
  get infoBox(): Locator { return this.page.locator('.info-box-text'); }
  get table(): Locator { return this.page.locator('.table-overflow-item table').first(); }
  get rows(): Locator { return this.table.locator('tbody tr'); }
  column(name: string): Locator { return this.table.getByRole('columnheader', { name, exact: false }).first(); }
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
    const m = body.match(/총\s*([\d,]+)\s*(?:건|개|명|팀)/) || body.match(/검색\s*결과\s*:?\s*([\d,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }
  currentPageParam(): number { const m = this.page.url().match(/[?&]cp=(\d+)/); return m ? parseInt(m[1], 10) : 1; }
  async gotoPageNumber(n: number): Promise<void> { await this.button(String(n)).first().click(); await settle(this.page, 800); }
}

export class PinPositionPage extends CourseBasePage { async open() { await super.open(SCREEN.pin.sub); } }
export class PinHistoryPage extends CourseBasePage {
  async open() { await super.open(SCREEN.pinHistory.sub); }
  get datepickers(): Locator { return this.page.locator('.datepicker-input'); }
}
export class GreenSpeedPage extends CourseBasePage {
  async open() { await super.open(SCREEN.green.sub); }
  speedInput(): Locator { return this.page.getByPlaceholder(SCREEN.green.inputPh); }
}
export class ClubNewsPage extends CourseBasePage {
  async open() { await super.open(SCREEN.news.sub); }
  // 행 [삭제] → confirm 모달(취소/확인). ⚠ 확인은 파괴적 → 취소만
  rowDeleteBtn(): Locator { return this.rows.first().getByRole('button', { name: SCREEN.news.delBtn }); }
  confirmModal(): Locator { return this.page.locator('.modal-footer').filter({ has: this.page.getByRole('button', { name: '확인', exact: true }) }).first(); }
  modalCancelBtn(): Locator { return this.confirmModal().getByRole('button', { name: /취소|아니요|닫기/ }).first(); }
}

import { Page, Locator } from '@playwright/test';
import { DataGrid } from '../components/DataGrid';
import { VueSelect } from '../components/VueSelect';

// ────────────────────────────────────────────────────────────────
//  L3 PageObject — 계정 관리 > 계정 리스트 (/club/page/account-list)
//  검색(이름+권한 vue-select) + 계정 테이블(DataGrid). 비파괴(권한변경 클릭 금지).
// ────────────────────────────────────────────────────────────────
export class AccountListPage {
  readonly table: DataGrid;
  readonly filter: VueSelect;
  constructor(private admin: Page) {
    this.table = new DataGrid(admin.locator('.table-overflow-item table, table').first());
    this.filter = new VueSelect(admin);
  }
  async ready(): Promise<void> { await this.info().first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}); }
  info(): Locator { return this.admin.locator('.info-box-text'); }
  nameSearch(): Locator { return this.admin.getByPlaceholder('이름을 입력해주세요'); }
  applyBtn(): Locator { return this.admin.getByRole('button', { name: '적용', exact: true }); }
  rowAction(name: string): Locator { return this.admin.getByRole('button', { name }).first(); }
  async headers(): Promise<string[]> { return this.table.headers(); }
  /** 계정 이름 목록(교차검증용) */
  async accountNames(): Promise<string[]> {
    return (await this.table.records()).map(r => {
      const k = Object.keys(r).find(k => /^이름$/.test(k.replace(/\s+/g, '')));
      return (k ? r[k] : '').trim();
    }).filter(Boolean);
  }
}

import { Page, Locator } from '@playwright/test';
import { VueSelect } from '../components/VueSelect';
import { DataGrid } from '../components/DataGrid';

// ────────────────────────────────────────────────────────────────
//  L3 PageObject — 홀맵 관리 > 홀맵 구역 설정 (/club/page/holemap-zone-management)
//  드리프트 빈발 화면(구역관리→구역 관리 등). 필터(VueSelect) + 구역표(DataGrid) + 버튼. 비파괴.
// ────────────────────────────────────────────────────────────────
export class HolemapZonePage {
  readonly filter: VueSelect;
  readonly table: DataGrid;
  constructor(private admin: Page) {
    this.filter = new VueSelect(admin);
    this.table = new DataGrid(admin.locator('.table-overflow-item table, table').first());
  }
  async ready(): Promise<void> { await this.info().first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}); }
  info(): Locator { return this.admin.locator('.info-box-text'); }
  applyBtn(): Locator { return this.admin.getByRole('button', { name: '적용', exact: true }).first(); }
  resetBtn(): Locator { return this.admin.getByRole('button', { name: '초기화', exact: true }).first(); }
  zoneManageBtn(): Locator { return this.admin.getByRole('button', { name: '구역 관리' }).first(); }
  async headers(): Promise<string[]> { return this.table.headers(); }
}

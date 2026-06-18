import { Page, Locator } from '@playwright/test';
import { DataGrid } from '../components/DataGrid';
import { VueSelect } from '../components/VueSelect';

// ────────────────────────────────────────────────────────────────
//  L3 PageObject — 캐디 관리 > 캐디 리스트 (/club/page/caddie-all)
//  그래프/통계 카드 + 활동상태 필터(VueSelect) + 캐디 테이블(DataGrid). 비파괴.
// ────────────────────────────────────────────────────────────────
export class CaddieListPage {
  readonly table: DataGrid;
  readonly filter: VueSelect;
  constructor(private admin: Page) {
    this.table = new DataGrid(admin.locator('.table-overflow-item table, table').first());
    this.filter = new VueSelect(admin);
  }
  async ready(): Promise<void> { await this.info().first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}); }
  info(): Locator { return this.admin.locator('.info-box-text'); }
  graphCards(): Locator { return this.admin.locator('.graph-card'); }
  statCards(): Locator { return this.admin.locator('.stat-card'); }
  canvas(): Locator { return this.admin.locator('canvas'); }
  nameSearch(): Locator { return this.admin.getByPlaceholder('캐디명을 입력하세요.'); }
  applyBtn(): Locator { return this.admin.getByRole('button', { name: '적용', exact: true }); }
  controlApplyBtn(): Locator { return this.admin.getByRole('button', { name: '관제 적용' }); }
  async headers(): Promise<string[]> { return this.table.headers(); }
}

import { Page, Locator } from '@playwright/test';
import { DataGrid } from '../components/DataGrid';
import { VisitRow, parseVisitRow } from '../domain/visitStatus';

// ────────────────────────────────────────────────────────────────
//  L3 PageObject — 라운드관리 > 내장 현황 (/club/page/round-visit)
//  일별 내장객 집계 보드. DataGrid 조립 + 행→도메인(VisitRow) 파싱 캡슐화.
// ────────────────────────────────────────────────────────────────
export class VisitStatusPage {
  readonly grid: DataGrid;
  constructor(private admin: Page) {
    this.grid = new DataGrid(admin.locator('.table-overflow-item table'));
  }
  async ready(): Promise<void> {
    await this.admin.locator('.table-overflow-item table tbody tr').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  }
  async isEmpty(): Promise<boolean> { return this.grid.isEmpty(); }
  /** 일별 행 → 도메인 레코드(계산 정합성용) */
  async rows(): Promise<VisitRow[]> { return (await this.grid.records()).map(parseVisitRow); }
  exportBtn(): Locator { return this.admin.getByRole('button', { name: '내보내기', exact: true }).first(); }
}

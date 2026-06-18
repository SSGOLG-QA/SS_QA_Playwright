import { Page } from '@playwright/test';
import { DataGrid } from '../components/DataGrid';
import { ReviewRow, parseReviewRow } from '../domain/reviewStats';

// L3 PageObject — 고객 평가 관리 > 후기 통계 (통계표)
export class ReviewStatsPage {
  readonly grid: DataGrid;
  constructor(private admin: Page) { this.grid = new DataGrid(admin.locator('.table-overflow-item table, table').first()); }
  async isEmpty(): Promise<boolean> { return this.grid.isEmpty(); }
  async rows(): Promise<ReviewRow[]> { return (await this.grid.records()).map(parseReviewRow); }
}

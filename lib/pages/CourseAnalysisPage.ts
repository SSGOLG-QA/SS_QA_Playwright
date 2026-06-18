import { Page } from '@playwright/test';
import { DataGrid } from '../components/DataGrid';
import { CourseRow, parseCourseRow } from '../domain/courseAnalysis';

// L3 PageObject — 코스 운영 관리 > 코스 분석 (홀별 분석표)
export class CourseAnalysisPage {
  readonly grid: DataGrid;
  constructor(private admin: Page) { this.grid = new DataGrid(admin.locator('.table-overflow-item table, table').first()); }
  async isEmpty(): Promise<boolean> { return this.grid.isEmpty(); }
  async rows(): Promise<CourseRow[]> { return (await this.grid.records()).map(parseCourseRow); }
}

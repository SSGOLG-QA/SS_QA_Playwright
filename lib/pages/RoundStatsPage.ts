import { Page, Locator } from '@playwright/test';
import { SummaryCards } from '../components/SummaryCards';
import { DataGrid } from '../components/DataGrid';

// ────────────────────────────────────────────────────────────────
//  L3 PageObject — 라운드관리 > 내장 통계 (/club/page/round-statistics)
//  요약 카드(총 스스회원 내장객/일평균/남여비중) + 필터(전체보기/성별만/연령만) + 통계표.
// ────────────────────────────────────────────────────────────────
export class RoundStatsPage {
  readonly summary: SummaryCards;
  readonly table: DataGrid;
  constructor(private admin: Page) {
    this.summary = new SummaryCards(admin);
    this.table = new DataGrid(admin.locator('.table-overflow-item table').first());
  }
  async ready(): Promise<void> { await this.admin.locator('.summary-card').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}); }
  filterBtn(name: string): Locator { return this.admin.getByRole('button', { name, exact: true }).first(); }
  async isEmpty(): Promise<boolean> { return this.table.isEmpty(); }

  /** 요약 '남성/여성 비중' → [남, 여] (%) */
  async genderRatio(): Promise<[number, number]> {
    const v = await this.summary.value('남성/여성 비중');
    const ns = (v.match(/\d+/g) || []).map(Number);
    return [ns[0] ?? NaN, ns[1] ?? NaN];
  }
  /** 요약 '총 스스회원 내장객' 숫자 */
  async totalSsMembers(): Promise<number> { return DataGrid.num(await this.summary.value('총 스스회원 내장객')); }

  /** 통계표에서 헤더가 re와 매칭되는 컬럼의 가시 행 합(없으면 NaN) */
  async columnSum(re: RegExp): Promise<number> {
    const recs = await this.table.records();
    if (!recs.length) return NaN;
    const key = Object.keys(recs[0]).find(k => re.test(k.replace(/\s+/g, '')));
    if (!key) return NaN;
    return recs.reduce((a, r) => a + (DataGrid.num(r[key]) || 0), 0);
  }
}

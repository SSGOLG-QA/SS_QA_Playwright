import { Page, Locator } from '@playwright/test';
import { DatePicker } from '../components/DatePicker';
import { VueSelect } from '../components/VueSelect';
import { SummaryCards } from '../components/SummaryCards';
import { DataGrid } from '../components/DataGrid';

// ────────────────────────────────────────────────────────────────
//  L3 PageObject — 식음 관리 > 주문 내역 관리 (/club/page/table-order-statistics)
//  L2 컴포넌트(DatePicker·VueSelect·SummaryCards·DataGrid)를 "조립"만 하는 화면 객체.
//   · 락케이터/액션/도메인 파싱을 캡슐화 → run*()는 검증(check)·리포팅에만 집중(관심사 분리).
//   · 셀렉터 변경 시 이 파일만 수정(드리프트 1곳 격리).
// ────────────────────────────────────────────────────────────────
export interface RankRow { name: string; supply: number; vat: number; amount: number; cnt: number; avg: number }

export class FnbOrderPage {
  readonly searchBox: Locator;
  readonly period: DatePicker;     // 기간 datepicker(시작~종료)
  readonly filters: VueSelect;     // 식당/캐디 vue-select
  readonly summary: SummaryCards;  // 요약 카드 4종
  readonly ranking: DataGrid;      // 캐디주문실적 랭킹표
  readonly detail: DataGrid;       // 주문 상세 내역표

  constructor(private admin: Page) {
    this.searchBox = admin.locator('.contents-box').filter({ has: admin.locator('.datepicker-input') }).first();
    this.period = new DatePicker(this.searchBox);
    this.filters = new VueSelect(admin);
    this.summary = new SummaryCards(admin);
    this.ranking = new DataGrid(admin.locator('table').filter({ has: admin.getByRole('columnheader', { name: '공급가', exact: false }) }).first());
    this.detail = new DataGrid(admin.locator('table').filter({ has: admin.getByRole('columnheader', { name: '주문일시', exact: false }) }).first());
  }

  async ready(): Promise<void> { await this.info().first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}); }

  info(): Locator { return this.admin.locator('.info-box-text'); }
  perspectiveTab(name: string): Locator { return this.admin.getByText(name, { exact: true }).first(); }
  periodUnit(name: string): Locator { return this.admin.getByRole('button', { name, exact: true }).first(); }
  applyBtn(): Locator { return this.admin.getByRole('button', { name: '적용', exact: true }).first(); }
  resetBtn(): Locator { return this.admin.getByRole('button', { name: '초기화', exact: true }).first(); }

  /** 캐디주문실적 랭킹표 행 → 도메인 레코드(계산 정합성용). 빈 표면 []. */
  async rankingRows(): Promise<RankRow[]> {
    if (await this.ranking.isEmpty().catch(() => true)) return [];
    const cell = (rec: Record<string, string>, re: RegExp) => {
      const k = Object.keys(rec).find(k => re.test(k.replace(/\s+/g, '')));
      return k ? rec[k] : '';
    };
    return (await this.ranking.records()).map(rec => ({
      name: cell(rec, /캐디명|순위/),
      supply: DataGrid.num(cell(rec, /공급가/)),
      vat: DataGrid.num(cell(rec, /부가세/)),
      amount: DataGrid.num(cell(rec, /^주문금액$|주문금액/)),
      cnt: DataGrid.num(cell(rec, /주문건수/)),
      avg: DataGrid.num(cell(rec, /평균주문금액/)),
    }));
  }
}

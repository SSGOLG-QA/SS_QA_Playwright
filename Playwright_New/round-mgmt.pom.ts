import { Page, Locator, expect } from '@playwright/test';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { MENU, SCREEN, RAW_CODE_PATTERNS, TIMEOUT } from './round-mgmt.data';

// ──────────────────────────────────────────────────────────────
//  POM — 라운드 관리 공통 베이스 + 화면별 페이지 오브젝트
//  진입은 openAdmin(대시보드→어드민) 이후의 admin Page 를 주입받아 사용.
// ──────────────────────────────────────────────────────────────

export class RoundBasePage {
  constructor(protected readonly page: Page) {}

  // ── 공통 요소 ──────────────────────────────
  get gnbTitle(): Locator { return this.page.locator('h1').first(); }        // 리뉴얼: '관제 어드민'
  get clubName(): Locator { return this.page.locator('h3', { hasText: '킹즈락' }); }
  get infoBox(): Locator { return this.page.locator('.info-box-text'); }
  get table(): Locator { return this.page.locator('.table-overflow-item table').first(); }
  get rows(): Locator { return this.table.locator('tbody tr'); }
  column(name: string): Locator { return this.table.getByRole('columnheader', { name, exact: false }).first(); }
  button(name: string): Locator { return this.page.getByRole('button', { name, exact: true }); }

  // ── 네비게이션/진입 ────────────────────────
  async open(sub: string): Promise<void> {
    await navigateMenu(this.page, MENU, sub);
    await settle(this.page);
  }
  async expectLoaded(urlPart: string): Promise<void> {
    await expect(this.page, '지정 URL 로드').toHaveURL(new RegExp(urlPart.replace(/\//g, '\\/')), { timeout: TIMEOUT.load });
    await expect(this.gnbTitle, 'GNB(헤더) 노출').toBeVisible();
  }
  async expectSessionAlive(): Promise<void> {
    await expect(this.page, '어드민 세션 유지(/club/)').toHaveURL(/\/club\//);
    await expect(this.gnbTitle, '세션 유지(관제 어드민 헤더)').toHaveText(/관제 어드민/);
  }

  // ── 텍스트(오타/raw code) 스캔 ──────────────
  async scanRawCode(): Promise<{ name: string; sample: string }[]> {
    const body = await this.page.locator('body').innerText();
    const hits: { name: string; sample: string }[] = [];
    for (const { name, re } of RAW_CODE_PATTERNS) {
      const m = body.match(re);
      if (m) hits.push({ name, sample: (m[0] || '').slice(0, 40) });
    }
    return hits;
  }

  // ── 데이터 정합성 ──────────────────────────
  async renderedRowCount(): Promise<number> {
    const empty = await this.rows.filter({ hasText: /내역이 없습니다|데이터가 없습니다|기록이 없습니다/ }).count().catch(() => 0);
    if (empty) return 0;
    return this.rows.count();
  }
  // 리스트 총 건수 표기(있으면 숫자, 없으면 null)
  async listTotalCount(): Promise<number | null> {
    const body = await this.page.locator('body').innerText();
    const m = body.match(/총\s*([\d,]+)\s*(?:건|대|팀|명|개)/) || body.match(/검색\s*결과\s*:?\s*([\d,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  // ── 페이지네이션 ───────────────────────────
  currentPageParam(): number {
    const m = this.page.url().match(/[?&]cp=(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }
  async gotoPageNumber(n: number): Promise<void> {
    await this.button(String(n)).first().click();
    await settle(this.page, 800);
  }
  // 이전/다음/처음/마지막 — 화살표 아이콘 버튼(있을 때만, best-effort)
  arrow(dir: 'prev' | 'next' | 'first' | 'last'): Locator {
    const ico: Record<string, string> = {
      prev: '.ico-left,.ico-prev,.ico-arrow-left', next: '.ico-right,.ico-next,.ico-arrow-right',
      first: '.ico-first,.ico-double-left', last: '.ico-last,.ico-double-right',
    };
    return this.page.locator(`.pagination button:has(${ico[dir]}), [class*=paging] button:has(${ico[dir]})`).first();
  }
}

// 1) 내장 현황 ───────────────────────────────
export class VisitStatusPage extends RoundBasePage {
  async open() { await super.open(SCREEN.visit.sub); }
  exportButton() { return this.button(SCREEN.visit.exportBtn); }
}

// 2) 내장 통계 (달력/모달) ────────────────────
export class VisitStatsPage extends RoundBasePage {
  async open() { await super.open(SCREEN.stats.sub); }
  get datepickers(): Locator { return this.page.locator('.datepicker-input'); }
  get calendarLayer(): Locator { return this.page.locator('.datepicker-layer').first(); }
  // 열린 달력 레이어 내부의 nav 로 스코프(뷰포트 밖 숨은 nav 회피)
  navPrev() { return this.calendarLayer.locator('.datepicker-nav button').filter({ has: this.page.locator('.ico-left') }).first(); }
  navNext() { return this.calendarLayer.locator('.datepicker-nav button').filter({ has: this.page.locator('.ico-right') }).first(); }

  // ⚠ 데이트피커는 '달력 전용'(fill/타이핑 미반영) → 달력 클릭으로 범위 지정.
  //   start 입력을 열어 monthsBack 만큼 '이전' 후 1일 선택, 다시 '다음' 후 endDay 선택(범위형).
  //   달력 팝업이 뷰포트 경계에 걸릴 수 있어 scrollIntoView + force 클릭 사용.
  // 달력 팝업이 뷰포트 밖에 위치할 수 있어 좌표 클릭 대신 DOM 레벨 el.click()(뷰포트 무관) 사용
  private async clickInCal(loc: Locator): Promise<void> {
    await loc.first().evaluate((el: HTMLElement) => el.click());
    await this.page.waitForTimeout(90);
  }
  async pickRangeMonthsBack(monthsBack: number, endDay = 28): Promise<void> {
    await this.datepickers.first().click();
    await this.calendarLayer.waitFor({ state: 'visible', timeout: 5_000 });
    for (let i = 0; i < monthsBack; i++) await this.clickInCal(this.navPrev());
    await this.clickInCal(this.calendarLayer.locator('.text-num', { hasText: /^1$/ }).first());
    for (let i = 0; i < monthsBack; i++) await this.clickInCal(this.navNext());
    await this.clickInCal(this.calendarLayer.locator('.text-num', { hasText: new RegExp(`^${endDay}$`) }).first());
    await this.page.keyboard.press('Escape').catch(() => {});
  }
  async clickApply() { await this.button(SCREEN.stats.applyBtn).click(); }
  alert(text: string) { return this.page.getByText(new RegExp(text)); }
  alertConfirmBtn() { return this.page.locator('.modal-footer').getByRole('button', { name: '확인', exact: true }); }
}

// 3) 전체 라운드 (검색 입력/반영) ─────────────
export class RoundAllPage extends RoundBasePage {
  async open() { await super.open(SCREEN.all.sub); }
  searchInput(ph: string) { return this.page.getByPlaceholder(ph); }
  async search(ph: string, value: string) {
    await this.searchInput(ph).fill(value);
    await this.button(SCREEN.all.applyBtn).click();
    await settle(this.page, 1000);
  }
  async reset() { await this.button(SCREEN.all.resetBtn).click(); await settle(this.page, 800); }
}

// 4) 카트 관리 (페이지네이션/모달) ────────────
export class CartMgmtPage extends RoundBasePage {
  async open() { await super.open(SCREEN.cart.sub); }
  firstRow() { return this.rows.first(); }
  // 행 [사용중지] → confirm 모달(취소/확인). ⚠ 확인은 파괴적 → 취소만 검증
  async openDisableConfirm() { await this.firstRow().getByRole('button', { name: SCREEN.cart.rowDisableBtn }).first().click(); }
  confirmModal() { return this.page.locator('.modal-footer').filter({ has: this.page.getByRole('button', { name: '확인', exact: true }) }).first(); }
  modalCancelBtn() { return this.confirmModal().getByRole('button', { name: /취소|아니요|닫기/ }).first(); }
  modalConfirmBtn() { return this.confirmModal().getByRole('button', { name: '확인', exact: true }).first(); }
}

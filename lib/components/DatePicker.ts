import { Locator, Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────────
//  L2 Component — DatePicker (달력 전용 데이트피커)
//  ⚠ fill()/타이핑은 모델에 반영 안 됨 → 달력 클릭 필수. 팝업이 뷰포트 밖에 떠 좌표 클릭 불가
//     → 날짜 셀을 DOM el.click()(뷰포트 무관)으로 클릭, 닫기는 Escape.
//  (commonActions.checkDateSearch 의 검증된 방식을 컴포넌트화)
//  scope = .datepicker-input 을 품은 검색폼(.contents-box) — 저장형 [적용] 오클릭 방지 위해 스코프 필수.
// ────────────────────────────────────────────────────────────────
export class DatePicker {
  constructor(private scope: Locator) {}
  private page(): Page { return this.scope.page(); }
  input(): Locator { return this.scope.locator('.datepicker-input'); }

  async count(): Promise<number> { return this.input().count().catch(() => 0); }
  async isVisible(): Promise<boolean> { return this.input().first().isVisible().catch(() => false); }

  /** which번째 데이트피커 열어 현재 월 유효 날짜 1개 선택(비파괴). 성공 시 true. */
  async pickAnyValidDay(which = 0): Promise<boolean> {
    const inp = this.input().nth(which);
    if (!(await inp.isVisible().catch(() => false))) return false;
    await inp.click().catch(() => {});
    const layer = this.page().locator('.datepicker-layer').first();
    if (!(await layer.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
    const cell = layer.locator('.text-num:not(.disabled)').filter({ hasText: /^\d{1,2}$/ }).first();
    const ok = await cell.evaluate((el: HTMLElement) => { el.click(); return true; }).catch(() => false);
    await this.page().waitForTimeout(120);
    await this.page().keyboard.press('Escape').catch(() => {});
    return !!ok;
  }

  // ── 월 이동 nav (round-mgmt.pom 검증 셀렉터) ──────────────────────
  private layer(): Locator { return this.page().locator('.datepicker-layer').first(); }
  private navBtn(dir: 'prev' | 'next'): Locator {
    const ico = dir === 'prev' ? '.ico-left,.ico-prev,.ico-arrow-left' : '.ico-right,.ico-next,.ico-arrow-right';
    // .datepicker-nav 내 화살표 버튼 우선, 없으면 layer 내 아이콘 버튼 폴백
    const inNav = this.layer().locator('.datepicker-nav button').filter({ has: this.page().locator(ico) }).first();
    return inNav;
  }

  /** 달력 헤더에서 표시 중인 연·월 파싱(가능하면). 실패 시 null. */
  private async readShownMonth(): Promise<{ y: number; m: number } | null> {
    const heads = ['.datepicker-nav', '.datepicker-title', '.datepicker-header', '.current-month', '.month-year'];
    for (const sel of heads) {
      const t = await this.layer().locator(sel).first().innerText({ timeout: 500 }).catch(() => '');
      const ym = /(\d{4})\s*[.\-년/]?\s*(\d{1,2})/.exec((t || '').replace(/\s+/g, ' '));
      if (ym) return { y: +ym[1], m: +ym[2] };
    }
    return null;
  }

  /**
   * 특정 날짜(ISO 'YYYY-MM-DD') 선택(비파괴). 월 이동 화살표로 대상 월 이동 후 일자 셀을 DOM click.
   *  - 헤더에서 현재 표시 월을 읽으면 그 기준, 못 읽으면 '오늘' 기준으로 이동 개월 수 계산(round-mgmt 방식).
   *  - fill/타이핑은 모델 미반영이라 사용 안 함. 성공 시 true.
   */
  async pickDate(iso: string, which = 0): Promise<boolean> {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return false;
    const ty = +m[1], tm = +m[2], td = +m[3];
    const inp = this.input().nth(which);
    if (!(await inp.isVisible().catch(() => false))) return false;
    await inp.click().catch(() => {});
    if (!(await this.layer().isVisible({ timeout: 3_000 }).catch(() => false))) return false;

    let cur = await this.readShownMonth();
    if (!cur) { const now = new Date(); cur = { y: now.getFullYear(), m: now.getMonth() + 1 }; }
    let diff = (ty * 12 + tm) - (cur.y * 12 + cur.m);
    const nav = this.navBtn(diff < 0 ? 'prev' : 'next');
    for (let i = 0; i < Math.min(Math.abs(diff), 36); i++) {
      if (!(await nav.isVisible().catch(() => false))) break;
      await nav.click({ timeout: 2_000 }).catch(() => {});
      await this.page().waitForTimeout(90);
    }
    const cell = this.layer().locator('.text-num:not(.disabled)').filter({ hasText: new RegExp(`^${td}$`) }).first();
    const ok = await cell.evaluate((el: HTMLElement) => { el.click(); return true; }).catch(() => false);
    await this.page().waitForTimeout(120);
    await this.page().keyboard.press('Escape').catch(() => {});
    return !!ok;
  }
}

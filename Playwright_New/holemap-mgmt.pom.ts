import { Page, Locator, expect } from '@playwright/test';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { MENU, SCREEN, RAW_CODE_PATTERNS, TIMEOUT } from './holemap-mgmt.data';

// ──────────────────────────────────────────────────────────────
//  POM — 홀맵 관리 공통 베이스 + 화면별 페이지 오브젝트
//  진입은 openAdmin(대시보드→어드민) 이후의 admin Page 를 주입받아 사용.
// ──────────────────────────────────────────────────────────────

export class HolemapBasePage {
  constructor(protected readonly page: Page) {}

  get gnbTitle(): Locator { return this.page.locator('h1').first(); }
  get clubName(): Locator { return this.page.locator('h3', { hasText: '킹즈락' }); }
  get infoBox(): Locator { return this.page.locator('.info-box-text'); }
  get table(): Locator { return this.page.locator('.table-overflow-item table, .list-table-group table').first(); }
  get rows(): Locator { return this.table.locator('tbody tr'); }
  button(name: string): Locator { return this.page.getByRole('button', { name, exact: true }); }

  async open(sub: string): Promise<void> {
    await navigateMenu(this.page, MENU, sub);
    await settle(this.page);
  }
  async expectLoaded(urlPart: string): Promise<void> {
    await expect(this.page, '지정 URL 로드').toHaveURL(new RegExp(urlPart.replace(/\//g, '\\/')), { timeout: TIMEOUT.load });
    await expect(this.gnbTitle, 'GNB 헤더 노출').toBeVisible();
  }
  async expectSessionAlive(): Promise<void> {
    await expect(this.page, '어드민 세션 유지(/club/)').toHaveURL(/\/club\//);
    await expect(this.gnbTitle, '세션 유지(관제 어드민 헤더)').toHaveText(/관제 어드민/);
  }

  async scanRawCode(): Promise<{ name: string; sample: string }[]> {
    const body = await this.page.locator('body').innerText();
    const hits: { name: string; sample: string }[] = [];
    for (const { name, re } of RAW_CODE_PATTERNS) {
      const m = body.match(re);
      if (m) hits.push({ name, sample: (m[0] || '').slice(0, 40) });
    }
    return hits;
  }

  async renderedRowCount(): Promise<number> {
    const empty = await this.rows.filter({ hasText: /내역이 없습니다|데이터가 없습니다|기록이 없습니다/ }).count().catch(() => 0);
    if (empty) return 0;
    return this.rows.count();
  }
  async listTotalCount(): Promise<number | null> {
    const body = await this.page.locator('body').innerText();
    const m = body.match(/총\s*([\d,]+)\s*(?:건|대|팀|명|개)/) || body.match(/검색\s*결과\s*:?\s*([\d,]+)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  currentPageParam(): number {
    const m = this.page.url().match(/[?&]cp=(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }
  arrow(dir: 'prev' | 'next' | 'first' | 'last'): Locator {
    const ico: Record<string, string> = {
      prev: '.ico-left,.ico-prev,.ico-arrow-left', next: '.ico-right,.ico-next,.ico-arrow-right',
      first: '.ico-first,.ico-double-left', last: '.ico-last,.ico-double-right',
    };
    return this.page.locator(`.pagination button:has(${ico[dir]}), [class*=paging] button:has(${ico[dir]})`).first();
  }
}

// 1) 홀맵 구역 설정 (/club/page/holemap-zone-management)
export class HolemapZonePage extends HolemapBasePage {
  async open() { await super.open(SCREEN.zone.sub); }
  // 코스/홀 필터 (vue-select .vs__dropdown-toggle)
  get vueSelects(): Locator { return this.page.locator('.vs__dropdown-toggle'); }
  // [구역관리] 버튼 (여러 행에 존재 → 첫 번째 사용)
  get zoneBtn(): Locator { return this.button(SCREEN.zone.zoneBtn).first(); }
  column(name: string): Locator { return this.table.getByRole('columnheader', { name, exact: false }).first(); }
  // 모달 (구역관리 클릭 시 오픈)
  modal(): Locator { return this.page.locator('.modal-footer').first(); }
  modalCancelBtn(): Locator { return this.modal().getByRole('button', { name: /취소|아니요|닫기|닫 기/ }).first(); }
}

// 2) 카트패스 진입여부 설정 (/club/page/holemap-cart-entrance)
export class HolemapCartEntrancePage extends HolemapBasePage {
  async open() { await super.open(SCREEN.cartEntrance.sub); }
  get tabGroup(): Locator { return this.page.locator('.tab-group').first(); }
  tab(name: string): Locator { return this.page.locator('.tab-group').getByText(name, { exact: false }).first(); }
  get checkboxes(): Locator { return this.page.locator('.contents-box input[type="checkbox"]'); }
}

// 3) 티샷 유의 거리 설정 (/club/page/holemap-teeshot-distance)
export class HolemapTeeshotPage extends HolemapBasePage {
  async open() { await super.open(SCREEN.teeshot.sub); }
  get tabGroup(): Locator { return this.page.locator('.tab-group').first(); }
  tab(name: string): Locator { return this.page.locator('.tab-group').getByText(name, { exact: false }).first(); }
  get checkboxes(): Locator { return this.page.locator('.contents-box input[type="checkbox"]'); }
  get distanceInputs(): Locator { return this.page.getByPlaceholder(SCREEN.teeshot.inputPh); }
}

// 4) 홀맵 미리보기 (/club/page/holemap-preview)
export class HolemapPreviewPage extends HolemapBasePage {
  async open() { await super.open(SCREEN.preview.sub); }
  get vueSelects(): Locator { return this.page.locator('.vs__dropdown-toggle'); }
  // 미리보기 영역 — svg(홀맵 렌더), opacity-slider, preview-summary
  get svgArea(): Locator { return this.page.locator('svg').first(); }
  get opacitySlider(): Locator { return this.page.locator('.opacity-slider').first(); }
  get previewSummary(): Locator { return this.page.locator('.preview-summary').first(); }
}

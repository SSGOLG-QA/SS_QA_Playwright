import { Page, Locator, expect } from '@playwright/test';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { MENU, SCREEN, RAW_CODE_PATTERNS, TIMEOUT } from './tablet-ops.data';

// ──────────────────────────────────────────────────────────────
//  POM — 태블릿 운영 관리 공통 베이스 + 화면별 페이지 오브젝트
//  진입은 openAdmin(대시보드→어드민) 이후의 admin Page 를 주입받아 사용.
// ──────────────────────────────────────────────────────────────

export class TabletBasePage {
  constructor(protected readonly page: Page) {}

  // ── 공통 요소 ──────────────────────────────
  get gnbTitle(): Locator { return this.page.locator('h1').first(); }
  get clubName(): Locator { return this.page.locator('h3', { hasText: '킹즈락' }); }
  get infoBox(): Locator { return this.page.locator('.info-box-text'); }
  // 태블릿 화면 테이블은 .table-overflow-item 또는 .list-table-group 내부
  get table(): Locator { return this.page.locator('.table-overflow-item table, .list-table-group table').first(); }
  get rows(): Locator { return this.table.locator('tbody tr'); }
  button(name: string): Locator { return this.page.getByRole('button', { name, exact: true }); }

  // ── 네비게이션/진입 ────────────────────────
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
  arrow(dir: 'prev' | 'next' | 'first' | 'last'): Locator {
    const ico: Record<string, string> = {
      prev: '.ico-left,.ico-prev,.ico-arrow-left', next: '.ico-right,.ico-next,.ico-arrow-right',
      first: '.ico-first,.ico-double-left', last: '.ico-last,.ico-double-right',
    };
    return this.page.locator(`.pagination button:has(${ico[dir]}), [class*=paging] button:has(${ico[dir]})`).first();
  }
}

// 1) 태블릿 기능 설정 (/club/page/live-game) ───────────────────
export class TabletFeaturePage extends TabletBasePage {
  async open() { await super.open(SCREEN.feature.sub); }
  // 경기 진행 설정 섹션 통계카드(전체/활성화/비활성화)
  get statCards(): Locator {
    return this.page.locator('.contents-box').filter({ hasText: SCREEN.feature.sectionGameRx }).locator('.setting-stat-card');
  }
  section(rx: RegExp): Locator { return this.page.locator('.contents-box').filter({ hasText: rx }); }
  // [패스워드 변경] — 비파괴: 버튼 노출 확인용 (클릭 금지 — CLAUDE.md 비파괴 원칙)
  get passwordBtn(): Locator { return this.page.getByRole('button', { name: '패스워드 변경', exact: true }); }
}

// 2) 메시지 관리 (/club/page/live-message) ────────────────────
export class TabletMessagePage extends TabletBasePage {
  async open() { await super.open(SCREEN.message.sub); }
  get tabGroup(): Locator { return this.page.locator('.tab-group').first(); }
  tab(name: string): Locator { return this.page.locator('.tab-group').getByText(name, { exact: false }).first(); }
  get tabletGrid(): Locator { return this.page.locator('.tablet-grid').first(); }
  // 메시지 관리 테이블 행의 [수정] 버튼 — 클릭 시 편집 모달 노출(비파괴: 취소로 닫음)
  firstEditBtn(): Locator { return this.page.getByRole('button', { name: '수정', exact: true }).first(); }
  modal(): Locator { return this.page.locator('.modal-footer').first(); }
  modalCancelBtn(): Locator { return this.modal().getByRole('button', { name: /취소|아니요|닫기/ }).first(); }
}

// 3) 홀 이벤트 관리 (/club/page/live-hole-event) ──────────────
export class TabletHoleEventPage extends TabletBasePage {
  async open() { await super.open(SCREEN.holeEvent.sub); }
  column(name: string): Locator { return this.table.getByRole('columnheader', { name, exact: false }).first(); }
  firstRow(): Locator { return this.rows.first(); }
}

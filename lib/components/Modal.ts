import { Page, Locator } from '@playwright/test';

// ────────────────────────────────────────────────────────────────
//  L2 Component — Modal (오버레이 팝업 비파괴 제어)
//  langCheck.closeModalNonDestructive 의 검증된 에스컬레이션 로직을 컴포넌트화.
//  ⚠ 언어 무관(텍스트 금지) · danger/primary(삭제·저장 실행) 버튼은 순수 알림 외엔 클릭 안 함(파괴 방지).
// ────────────────────────────────────────────────────────────────
const ROOTS = '.modal-group, .modal-box, .modal-content, [class*="-pop"]';
const FOOTER = '.modal-footer, .btn-area, .button-area, .pop-footer, .popup-footer, .layer-btn, .ctrl-area';

export class Modal {
  constructor(private admin: Page) {}

  /** 열린(가시·텍스트 있는) 모달 개수 */
  async openCount(): Promise<number> {
    return this.admin.locator(ROOTS).filter({ hasText: /\S/ }).count().catch(() => 0);
  }
  async isOpen(): Promise<boolean> { return (await this.openCount()) > 0; }

  /** 최상위 오버레이 루트 */
  root(): Locator { return this.admin.locator(ROOTS).filter({ hasText: /\S/ }).last(); }

  /** 비파괴 닫기 — 취소/닫기/X → 순수 알림 [확인] → Escape 순 에스컬레이션(최대 5회) */
  async closeNonDestructive(): Promise<void> {
    const cancelSel = ['.modal-footer', '.btn-area', '.button-area', '.pop-footer', '.popup-footer', '.layer-btn', '.layer-footer', '.footer-wrap', '.ctrl-area']
      .map(s => `${s} button:not(.primary):not(.danger)`).join(', ');
    const xSel = [
      '.modal-group button[class*="close"]', '.modal-box button[class*="close"]', '.modal-content button[class*="close"]',
      '[class*="-pop"] button[class*="close"]', '[class*="popup"] button[class*="close"]', '[class*="layer"] button[class*="close"]',
      '.modal-group [class*="close"]:not(button)', '.modal-box [class*="close"]:not(button)', '[class*="-pop"] [class*="close"]:not(button)',
      '[aria-label*="close" i]', '[title*="close" i]', '.ico-close', '.icon-close', '.btn-x',
    ].join(', ');
    for (let attempt = 0; attempt < 5 && (await this.openCount()) > 0; attempt++) {
      const cancel = this.admin.locator(cancelSel).last();
      if (await cancel.isVisible().catch(() => false)) { await cancel.click().catch(() => {}); await this.admin.waitForTimeout(450); continue; }
      const x = this.admin.locator(xSel).last();
      if (await x.isVisible().catch(() => false)) { await x.click({ force: true }).catch(() => {}); await this.admin.waitForTimeout(450); continue; }
      // 순수 알림([확인]만, danger 없음) → 안전 dismiss
      const footer = this.admin.locator(FOOTER).last();
      const dangerCnt = await footer.locator('button.danger, button[class*="danger"]').count().catch(() => 0);
      if (dangerCnt === 0) {
        const ok = footer.getByRole('button', { name: '확인', exact: true }).first();
        if (await ok.isVisible().catch(() => false)) { await ok.click().catch(() => {}); await this.admin.waitForTimeout(450); continue; }
      }
      await this.admin.keyboard.press('Escape').catch(() => {});
      await this.admin.waitForTimeout(450);
    }
  }
}

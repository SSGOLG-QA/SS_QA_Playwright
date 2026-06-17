import { Locator, Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────────
//  L2 Component — ToggleGroup (기능 토글 스위치 묶음)
//  ⚠ 토글 input id(#tgv-N-0)는 SPA 네비게이션마다 동적 채번 → id 의존 금지.
//     반드시 섹션(.contents-box+텍스트)으로 스코프 후 count/상태 검증.
//  ⚠ SNB 네비 토글(.snb-toggle/.depth-2-toggle)은 제외(컨텐츠 기능 토글만).
//  ⚠ set/toggle()은 값 변경 = 파괴적 → 저장형 화면에선 반드시 원복(비파괴 원칙).
// ────────────────────────────────────────────────────────────────
export class ToggleGroup {
  constructor(private scope: Locator) {}
  private page(): Page { return this.scope.page(); }
  switches(): Locator {
    return this.scope.locator('input[type=checkbox]:not(.snb-toggle__switchbtn):not(.depth-2-toggle__switchbtn)');
  }
  async count(): Promise<number> { return this.switches().count().catch(() => 0); }
  async isChecked(i = 0): Promise<boolean> { return this.switches().nth(i).isChecked().catch(() => false); }

  /** i번째 토글 클릭(값 변경·파괴적). id 동적채번 → label[for] 우선, 없으면 el.click(뷰포트 무관). */
  async toggle(i = 0): Promise<void> {
    const cb = this.switches().nth(i);
    const id = await cb.getAttribute('id').catch(() => null);
    if (id) {
      const lbl = this.page().locator(`label[for="${id}"]`).first();
      if (await lbl.isVisible().catch(() => false)) { await lbl.click().catch(() => {}); return; }
    }
    await cb.evaluate((el: HTMLElement) => el.click()).catch(() => {});
  }
}

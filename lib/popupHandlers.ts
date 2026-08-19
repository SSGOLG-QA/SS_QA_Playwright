import { Page } from '@playwright/test';

// ──────────────────────────────────────────────────────────────
//  팝업/모달 Interception 자동 처리 전략 (중앙화)
//  - Playwright addLocatorHandler: 예상치 못한 팝업이 뜰 때마다 '자동으로' 닫아
//    클릭 인터셉션(dim 오버레이) 플레이크를 원천 차단. 액션마다 try/catch 불필요.
//  - 진입 직후 1회 install → 이후 테스트 전체 커버. (openAdmin/openCourseAdmin 공용)
//  - ⚠ 비파괴 안전장치: '확인'만 있는 순수 알림/공지/알림배너만 자동 닫기.
//    '취소/아니요/닫기'가 동반된 파괴적 confirm(삭제·저장 확인)은 건드리지 않음.
// ──────────────────────────────────────────────────────────────

export interface PopupHandlerOpts {
  alarm?: boolean;    // 코스관리 알림 모달(.modal-group.alarm) + dim 제거
  notice?: boolean;   // 상단 공지 배너(.btn-top-close / SMART CLUB ADMIN NOTICE)
  loginConfirm?: boolean; // '로그인을 진행하시겠습니까?' → 예
  alertConfirm?: boolean; // 순수 알림 모달(.modal-footer 에 '확인'만) → 확인
  times?: number;     // 각 핸들러 최대 발동 횟수(기본 30)
}

// JS로 blocking 오버레이 즉시 제거(알림/공지 모달 + stray dim). 반환=제거 수.
//   addLocatorHandler 가 놓치는 찰나 케이스까지 커버(폼 조작 직전 명시 호출용).
export async function dismissBlockingOverlays(page: Page): Promise<number> {
  return page.evaluate(() => {
    let killed = 0;
    document.querySelectorAll('.modal-group.alarm, .modal-group[class*="alarm"], .modal-group.notice').forEach((m) => {
      const btn = Array.from(m.querySelectorAll('button')).find((b) => /확인|닫기|취소|OK/.test(b.textContent || ''));
      // 파괴적 confirm 회피: '취소+저장/삭제' 조합이면 건드리지 않음
      const hasDanger = Array.from(m.querySelectorAll('button')).some((b) => /삭제|저장|적용/.test(b.textContent || ''));
      if (hasDanger) return;
      if (btn) { (btn as HTMLElement).click(); killed++; } else { (m as HTMLElement).style.display = 'none'; killed++; }
    });
    document.querySelectorAll('.dim').forEach((d) => {
      const mg = d.closest('.modal-group') as HTMLElement | null;
      if (!mg || mg.style.display === 'none') d.remove();
    });
    return killed;
  }).catch(() => 0);
}

// 팝업 자동 처리 핸들러 일괄 등록. (선택적으로 종류 on/off — 없는 셀렉터는 무해)
export async function installPopupHandlers(page: Page, opts: PopupHandlerOpts = {}): Promise<void> {
  const o = { alarm: true, notice: true, loginConfirm: true, alertConfirm: true, times: 30, ...opts };

  if (o.alarm) {
    await page.addLocatorHandler(
      page.locator('.modal-group.alarm, .modal-group[class*="alarm"]'),
      async () => { await dismissBlockingOverlays(page); },
      { noWaitAfter: true, times: o.times },
    ).catch(() => {});
  }
  if (o.notice) {
    await page.addLocatorHandler(
      page.getByText('SMART CLUB ADMIN NOTICE'),
      async () => { await page.locator('.btn-top-close').first().click().catch(() => {}); },
      { noWaitAfter: true, times: o.times },
    ).catch(() => {});
  }
  if (o.loginConfirm) {
    await page.addLocatorHandler(
      page.getByText('로그인을 진행하시겠습니까?'),
      async () => { await page.getByRole('button', { name: '예' }).click().catch(() => {}); },
      { noWaitAfter: true, times: o.times },
    ).catch(() => {});
  }
  if (o.alertConfirm) {
    // 순수 알림(확인만) 모달 — '취소/아니요/닫기' 동반 시 비파괴 보호로 건드리지 않음
    const alertFooter = page.locator('.modal-footer').filter({ has: page.getByRole('button', { name: '확인', exact: true }) });
    await page.addLocatorHandler(
      alertFooter.first().getByRole('button', { name: '확인', exact: true }),
      async () => {
        const f = alertFooter.first();
        const hasCancel = await f.getByRole('button', { name: /취소|아니요|닫기/ }).count().catch(() => 0);
        if (hasCancel === 0) await f.getByRole('button', { name: '확인', exact: true }).first().click().catch(() => {});
      },
      { noWaitAfter: true, times: o.times },
    ).catch(() => {});
  }
}

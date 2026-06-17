import { test } from '../lib/fixtures';

// 스코어카드 팝업 닫기 컨트롤 식별(비파괴). 행 [스코어] 클릭 → 모달 내 닫기성 요소 덤프.
test('scorecard popup close controls', async ({ admin }) => {
  test.setTimeout(120_000);
  await navigateMenu(admin, '라운드관리', '전체 라운드');
  await settle(admin, 1500);
  const rows = admin.locator('.table-overflow-item table tbody tr');
  const rc = Math.min(await rows.count(), 8);
  let opened = false;
  for (let r = 0; r < rc; r++) {
    const b = rows.nth(r).getByRole('button', { name: '스코어', exact: false }).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); opened = true; break; }
  }
  await admin.waitForTimeout(1500);
  const info = await admin.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('.modal-group, .modal-box, .modal-content, [class*="-pop"], [class*="popup"], [class*="modal"]'))
      .filter(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const pick = roots[roots.length - 1] as HTMLElement | undefined;
    if (!pick) return { found: false };
    // 닫기 후보: class/aria/title 에 close/x, dim/overlay, 우상단 아이콘 버튼
    const closeish = Array.from(pick.querySelectorAll('*'))
      .filter(e => { const c = (e.className || '').toString().toLowerCase(); const a = (e.getAttribute('aria-label') || '').toLowerCase(); const t = (e.getAttribute('title') || '').toLowerCase(); return /close|cancel|dismiss|btn-x|-x\b/.test(c + ' ' + a + ' ' + t); })
      .map(e => ({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 60), aria: e.getAttribute('aria-label'), title: e.getAttribute('title') })).slice(0, 15);
    const dim = Array.from(document.querySelectorAll('[class*="dim"], [class*="overlay"], [class*="backdrop"]')).map(e => (e.className || '').toString().slice(0, 50)).slice(0, 6);
    const footerBtns = Array.from(pick.querySelectorAll('.modal-footer button, .btn-area button, .button-area button')).map(b => ({ txt: (b as HTMLElement).innerText.trim().slice(0, 20), cls: (b.className || '').toString().slice(0, 50) }));
    return { found: true, rootCls: pick.className.toString().slice(0, 80), closeish, dim, footerBtns };
  });
  console.log(JSON.stringify(info, null, 1));
});

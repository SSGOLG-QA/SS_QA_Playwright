import { test } from '../lib/fixtures';
import * as fs from 'fs';

// 전체 라운드 행 액션 버튼 클릭 → 팝업(.modal-group/.modal-box) DOM 스캔 가능 여부 실증.
//  비파괴: 보기성 팝업([스코어]/[클럽체크])만 열고 닫음. [삭제]는 confirm 텍스트만 읽고 취소.
test('round-all popup feasibility', async ({ admin }) => {
  test.setTimeout(180_000);
  await navigateMenu(admin, '라운드관리', '전체 라운드');
  await settle(admin, 1800);

  const out: any = {};
  // 모달 DOM 텍스트 + 버튼 수집
  const scanModal = async (label: string) => {
    await admin.waitForTimeout(1200);
    const data = await admin.evaluate(() => {
      const roots = Array.from(document.querySelectorAll('.modal-group, .modal-box, .modal-content, [class*="-pop"]'))
        .filter(e => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed');
      const pick = roots[roots.length - 1] as HTMLElement | undefined; // 최상위 오버레이
      if (!pick) return { found: false };
      const buttons = Array.from(pick.querySelectorAll('button, [role=button], a[class*=btn]'))
        .map(b => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const titles = Array.from(pick.querySelectorAll('h1,h2,h3,h4,.modal-title,.pop-title,[class*=title]'))
        .map(t => (t as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
      const cls = pick.className.slice(0, 60);
      const textLen = (pick.innerText || '').length;
      const sample = (pick.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return { found: true, cls, buttons: [...new Set(buttons)].slice(0, 20), titles: [...new Set(titles)], textLen, sample };
    });
    return data;
  };
  const closeModal = async () => {
    // 비파괴 닫기: 취소/닫기 버튼 또는 Escape, X 아이콘
    for (const sel of ['button:has-text("취소")', 'button:has-text("닫기")', '.modal-close', '.btn-close', '[class*="close"]']) {
      const el = admin.locator(sel).last();
      if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await admin.waitForTimeout(500); }
    }
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(600);
  };

  const firstRow = admin.locator('.table-overflow-item table tbody tr').first();
  for (const name of ['스코어', '클럽체크', '삭제']) {
    try {
      const b = firstRow.getByRole('button', { name, exact: false }).first();
      if (!(await b.isVisible().catch(() => false))) { out[name] = { skip: '버튼 미노출(데이터 의존)' }; continue; }
      await b.click().catch(() => {});
      out[name] = await scanModal(name);
      console.log(`\n[${name}]`, JSON.stringify(out[name], null, 1));
      await closeModal();
    } catch (e: any) { out[name] = { error: String(e?.message || e).slice(0, 100) }; await closeModal(); }
  }

  fs.writeFileSync('analysis/_popup_round-all.json', JSON.stringify(out, null, 2), 'utf-8');
  console.log('\n>>> saved analysis/_popup_round-all.json');
});

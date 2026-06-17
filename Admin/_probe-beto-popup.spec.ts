import { test } from '../lib/fixtures';

// 배토 기록 조회 [보기] 팝업 DOM 구조 진단
//  목적: closeModalNonDestructive가 찾지 못하는 [닫기] 버튼의 실제 클래스·컨테이너 특정
// 실행: npx playwright test --project=admin-chromium Admin/_probe-beto-popup.spec.ts --no-deps
test('beto popup structure probe', async ({ admin }) => {
  test.setTimeout(120_000);
  await navigateMenu(admin, '배토 관리', '배토 기록 조회');
  await settle(admin, 1500);

  // [보기] 버튼 탐색 — 행 버튼
  const rows = admin.locator('.table-overflow-item table tbody tr, .list-table-group tbody tr');
  const rc = Math.min(await rows.count().catch(() => 0), 10);
  let opened = false;
  for (let r = 0; r < rc; r++) {
    const btns = rows.nth(r).locator('button, [role="button"]');
    const bc = await btns.count();
    for (let bi = 0; bi < bc; bi++) {
      const txt = (await btns.nth(bi).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (txt === '보기' && await btns.nth(bi).isVisible().catch(() => false)) {
        await btns.nth(bi).click().catch(() => {});
        opened = true;
        break;
      }
    }
    if (opened) break;
  }

  if (!opened) { console.log('⚠ [보기] 버튼 미발견 (데이터 없음)'); return; }
  await admin.waitForTimeout(1500);

  const info = await admin.evaluate(() => {
    // ① 가시 오버레이 후보 전수
    const OVERLAY_SEL = [
      '.modal-group', '.modal-box', '.modal-content',
      '[class*="-pop"]', '[class*="pop"]', '[class*="popup"]',
      '[class*="layer"]', '[class*="overlay"]', '[class*="modal"]',
    ].join(', ');
    const overlays = Array.from(document.querySelectorAll(OVERLAY_SEL))
      .filter(e => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.width > 10 && r.height > 10;
      })
      .map(e => ({
        cls: (e.className || '').toString().slice(0, 80),
        tag: e.tagName,
        w: Math.round((e as HTMLElement).getBoundingClientRect().width),
        h: Math.round((e as HTMLElement).getBoundingClientRect().height),
        zIndex: getComputedStyle(e).zIndex,
        childBtnCount: e.querySelectorAll('button').length,
      }));

    // ② 실제 팝업 루트 — 가장 안쪽 오버레이(자식 포함)
    const candidate = overlays.filter(o => o.childBtnCount > 0).slice(-3);

    // ③ 팝업 내 모든 버튼 전수
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(e => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0 &&
               getComputedStyle(e).visibility !== 'hidden' &&
               getComputedStyle(e).display !== 'none';
      })
      .map(e => ({
        txt: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 30),
        cls: (e.className || '').toString().slice(0, 80),
        tag: e.tagName,
        parentCls: (e.parentElement?.className || '').toString().slice(0, 60),
        grandCls: (e.parentElement?.parentElement?.className || '').toString().slice(0, 60),
      }))
      .filter(b => b.txt);

    // ④ fixed/absolute + z-index>100 요소(팝업 후보)
    const fixedElems = Array.from(document.querySelectorAll('*'))
      .filter(e => {
        const st = getComputedStyle(e);
        const zi = parseInt(st.zIndex || '0') || 0;
        return (st.position === 'fixed' || st.position === 'absolute') && zi >= 100;
      })
      .map(e => ({
        cls: (e.className || '').toString().slice(0, 70),
        zi: getComputedStyle(e).zIndex,
        btnCnt: e.querySelectorAll('button').length,
      }))
      .filter(e => e.btnCnt > 0)
      .slice(0, 8);

    return { overlayRoots: overlays.slice(0, 15), topCandidates: candidate, allBtns, fixedElems };
  });

  console.log('\n=== 오버레이 루트 후보 ===');
  for (const o of info.overlayRoots) {
    console.log(`  [${o.tag}] cls="${o.cls}" ${o.w}x${o.h} z=${o.zIndex} btns=${o.childBtnCount}`);
  }
  console.log('\n=== 팝업 루트 상위후보(버튼 포함) ===');
  for (const c of info.topCandidates) {
    console.log(`  cls="${c.cls}" ${c.w}x${c.h} z=${c.zIndex} btns=${c.childBtnCount}`);
  }
  console.log('\n=== 현재 가시 버튼 전수 ===');
  for (const b of info.allBtns) {
    console.log(`  "${b.txt}" | cls="${b.cls}" | parent="${b.parentCls}" | grand="${b.grandCls}"`);
  }
  console.log('\n=== fixed/absolute z>=100 요소(버튼 포함) ===');
  for (const f of info.fixedElems) {
    console.log(`  cls="${f.cls}" z=${f.zi} btns=${f.btnCnt}`);
  }

  // ⑤ openModalCount 기준으로 탐지 여부 확인
  const detectedCount = await admin.locator('.modal-group, .modal-box, .modal-content, [class*="-pop"]').filter({ hasText: /\S/ }).count();
  console.log(`\n=== openModalCount 현행 선택자 탐지 수: ${detectedCount} ===`);
  if (detectedCount === 0) console.log('  ⚠ 기존 openModalCount = 0 → 닫기 루프가 아예 진입 안 함');
});

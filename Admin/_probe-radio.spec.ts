import { test } from '../lib/fixtures';
import * as fs from 'fs';

// 라디오 버튼 동적 UI 진단 probe
//  대상: 경기진행관리 > 진행시간 통계 (stat-which / stat-type 구조)
//  목적: ① 초기 라디오 가시성(visible/hidden) 확인
//        ② 각 옵션 클릭 전/후 노출 텍스트 변화 기록 → analysis/_radio_probe.json
// 실행: npx playwright test --project=admin-chromium Admin/_probe-radio.spec.ts --no-deps

test('radio DOM + dynamic text probe — 진행시간 통계', async ({ admin }) => {
  test.setTimeout(120_000);
  await navigateMenu(admin, '경기 진행 관리', '진행시간 통계');
  await settle(admin, 1200);

  // ① 초기 라디오 상태 스냅샷
  const snap = (label: string) => admin.evaluate((lbl) => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
    return {
      label: lbl,
      radios: radios.map((inp, ri) => {
        const he = inp as HTMLInputElement;
        const bRect = he.getBoundingClientRect();
        const id = inp.id;
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) as HTMLElement | null : null;
        const labelBRect = labelEl?.getBoundingClientRect();
        const isInputVisible = bRect.width > 0 || bRect.height > 0;
        const isLabelVisible = labelBRect ? (labelBRect.width > 0 || labelBRect.height > 0) : false;
        // display:none 체크(조상 포함)
        let hidden = false;
        let el: HTMLElement | null = he;
        while (el) {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') { hidden = true; break; }
          el = el.parentElement;
        }
        return {
          ri,
          name: inp.getAttribute('name'),
          id: inp.id,
          checked: he.checked,
          inputBRect: `${Math.round(bRect.width)}x${Math.round(bRect.height)}`,
          labelText: (labelEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
          labelVisible: isLabelVisible,
          displayNone: hidden,
        };
      }),
    };
  }, label);

  // ② 가시 시스템 텍스트 수집(info-box-text 등)
  const sysTexts = () => admin.evaluate(() => {
    const zones = [
      '.info-box-text',
      '[class*="guide"]',
      '[class*="info-text"]',
      '[class*="desc"]',
      '.sub-title',
      '.box-title',
      'h3, h4',
    ];
    const isVisible = (el: Element) => {
      let e: HTMLElement | null = el as HTMLElement;
      while (e) {
        const st = getComputedStyle(e);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        e = e.parentElement;
      }
      const bRect = (el as HTMLElement).getBoundingClientRect();
      return bRect.width > 0 || bRect.height > 0;
    };
    const texts: { cls: string; tag: string; txt: string }[] = [];
    for (const sel of zones) {
      document.querySelectorAll(sel).forEach(el => {
        if (!isVisible(el)) return;
        const txt = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!txt || txt.length < 5) return;
        texts.push({ cls: el.className?.toString().slice(0, 60) || el.tagName, tag: el.tagName, txt });
      });
    }
    return texts;
  });

  const initial = await snap('INITIAL');
  const initialTexts = await sysTexts();

  const results: Record<string, unknown>[] = [
    { snapshot: initial, sysTexts: initialTexts },
  ];

  // ③ 각 라디오 옵션 클릭 → 변화 기록
  const radioCount = initial.radios.length;
  for (let ri = 0; ri < radioCount; ri++) {
    const info = initial.radios[ri];
    if (info.name?.startsWith('snb') || info.name?.startsWith('depth')) continue; // SNB 토글 제외
    try {
      const radio = admin.locator('input[type="radio"]').nth(ri);
      const id = await radio.getAttribute('id').catch(() => '');
      const lbl = id ? admin.locator(`label[for="${id}"]`).first() : null;
      if (lbl && await lbl.isVisible().catch(() => false)) {
        await lbl.click();
      } else {
        await radio.click({ force: true });
      }
      await admin.waitForTimeout(1000);

      const afterSnap = await snap(`AFTER_ri${ri}(${info.name}:${info.id})`);
      const afterTexts = await sysTexts();

      // 새로 나타난 텍스트
      const initialTxtSet = new Set(initialTexts.map(t => t.txt));
      const newTexts = afterTexts.filter(t => !initialTxtSet.has(t.txt));

      // 새로 나타난 라디오 그룹
      const initialRadioNames = new Set(initial.radios.map(r => r.name));
      const newRadios = afterSnap.radios.filter(r =>
        !initial.radios.some(ir => ir.name === r.name && ir.id === r.id)
      );

      results.push({
        clickedRi: ri,
        clickedInfo: info,
        newTexts,
        newRadioGroups: [...new Set(newRadios.map(r => r.name))],
        newRadioDetails: newRadios,
        vsDropdowns: await admin.locator('.vs__dropdown-toggle').count(),
      });

      console.log(`[ri=${ri}] ${info.name}:${info.id} | newTexts=${newTexts.length} | newGroups=${[...new Set(newRadios.map(r => r.name))].join(',') || '-'}`);
      if (newTexts.length) {
        console.log('  📝 새 텍스트:', newTexts.map(t => `[${t.cls.slice(0,30)}] ${t.txt.slice(0,60)}`).join('\n    '));
      }
    } catch (e) {
      results.push({ clickedRi: ri, clickedInfo: info, error: String(e) });
    }
  }

  fs.writeFileSync('analysis/_radio_probe.json', JSON.stringify({ url: await admin.url(), results }, null, 2), 'utf-8');
  console.log('>>> saved analysis/_radio_probe.json');
});

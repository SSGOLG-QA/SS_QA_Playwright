import { test } from '../lib/fixtures';
import { navigateMenu } from '../lib/adminHelpers';
import fs from 'fs';

// 프로브(일회성): 홀맵 미리보기 빈화면 진단 — 콘텐츠 영역 실제 DOM/가시텍스트 덤프(한국어/베트남어).
// 실행: npx playwright test --project=admin-chromium Admin/_probe-holemap-preview.spec.ts --no-deps

async function dump(admin: any, tag: string) {
  return await admin.evaluate((t: string) => {
    const vis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const st = getComputedStyle(el as HTMLElement); return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none'; };
    // 콘텐츠 영역 = SNB(.snb)·헤더 제외한 본문 추정
    const snb = document.querySelector('.snb');
    const inSnb = (el: Element) => snb ? snb.contains(el) : false;
    const sels = ['.contents', '.contents-box', '.info-box-text', 'table', 'canvas', 'svg', '[class*="map"]', '[class*="preview"]', '[class*="hole"]', '[class*="empty"]', '[class*="no-data"]'];
    const found: any[] = [];
    for (const s of sels) for (const el of Array.from(document.querySelectorAll(s))) {
      if (inSnb(el)) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      found.push({ sel: s, cls: (el.className || '').toString().slice(0, 50), vis: vis(el), w: Math.round(r.width), h: Math.round(r.height), txt: ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
    }
    // 본문 가시 텍스트 총량(SNB·헤더 제외)
    let bodyText = '';
    const main = document.querySelector('.contents') || document.body;
    for (const el of Array.from(main.querySelectorAll('*'))) {
      if (inSnb(el)) continue;
      if ((el as HTMLElement).children.length) continue; // leaf만
      if (!vis(el)) continue;
      const tx = ((el as HTMLElement).innerText || '').trim();
      if (tx) bodyText += tx + ' ';
    }
    return { tag: t, url: location.href, visibleContentText: bodyText.replace(/\s+/g, ' ').trim().slice(0, 200), visibleContentTextLen: bodyText.replace(/\s+/g, '').length, elements: found.filter(f => f.vis) , hiddenElements: found.filter(f => !f.vis).length };
  }, tag);
}

test('probe: 홀맵 미리보기 빈화면 진단', async ({ admin }) => {
  test.setTimeout(180_000);
  const ok = await navigateMenu(admin, '홀맵 관리', '홀맵 미리보기').catch(() => false);
  await admin.waitForTimeout(2500);
  const ko = await dump(admin, '한국어');
  console.log('\n=== 한국어 ===\n' + JSON.stringify(ko, null, 2));

  // 베트남어 전환
  await admin.locator('.title').filter({ hasText: /한국어|Tiếng/ }).first().click({ force: true }).catch(() => {});
  await admin.waitForTimeout(600);
  await admin.locator('.slot-item', { hasText: 'Tiếng Việt' }).first().click({ force: true }).catch(() => {});
  await admin.waitForTimeout(2500);
  const vi = await dump(admin, '베트남어');
  console.log('\n=== 베트남어 ===\n' + JSON.stringify(vi, null, 2));

  // 원복
  await admin.locator('.title').filter({ hasText: /Tiếng|한국어/ }).first().click({ force: true }).catch(() => {});
  await admin.waitForTimeout(600);
  await admin.locator('.slot-item', { hasText: '한국어' }).first().click({ force: true }).catch(() => {});

  if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
  fs.writeFileSync('analysis/_holemap_preview_probe.json', JSON.stringify({ navOk: ok, ko, vi }, null, 2));
  console.log('\n[probe] analysis/_holemap_preview_probe.json 저장');
});

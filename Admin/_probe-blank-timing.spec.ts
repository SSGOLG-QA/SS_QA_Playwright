import { test } from '../lib/fixtures';
import { navigateMenu, settle } from '../lib/adminHelpers';

// 프로브: enterMenuChecked의 isContentBlank 오탐 진단 — 진입 직후 vs 대기 후 콘텐츠 가시 여부.
// 실행: npx playwright test --project=admin-chromium Admin/_probe-blank-timing.spec.ts --no-deps
const SELS = '.contents-box, .info-box-text, table, .list-table-group, .summary-card, .card-col, canvas, svg, [class*="map"], [class*="preview"], [class*="chart"], [class*="viewer"]';

async function blankNow(admin: any): Promise<{ blank: boolean; visCount: number; total: number }> {
  return await admin.evaluate((sel: string) => {
    const vis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const st = getComputedStyle(el as HTMLElement); return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const els = Array.from(document.querySelectorAll(sel));
    const visCount = els.filter(vis).length;
    return { blank: visCount === 0, visCount, total: els.length };
  }, SELS);
}

const TARGETS: [string, string][] = [
  ['대회', '대회관리'],
  ['경기 진행 관리', '진행시간 실시간'],
  ['캐디 관리', '캐디 리스트'],
  ['식음 관리', '버전 및 설정'],
];

test('probe: isContentBlank 타이밍 진단', async ({ admin }) => {
  test.setTimeout(180_000);
  for (const [menu, sub] of TARGETS) {
    const ok = await navigateMenu(admin, menu, sub).catch(() => false);
    await settle(admin);                       // enterMenuChecked와 동일 시점
    const t0 = await blankNow(admin);          // settle 직후(현재 검사 시점)
    await admin.waitForTimeout(2000);
    const t1 = await blankNow(admin);          // +2s
    await admin.waitForTimeout(2000);
    const t2 = await blankNow(admin);          // +4s
    console.log(`\n[${menu} > ${sub}] navOk=${ok}`);
    console.log(`  settle직후: blank=${t0.blank} vis=${t0.visCount}/${t0.total}`);
    console.log(`  +2s       : blank=${t1.blank} vis=${t1.visCount}/${t1.total}`);
    console.log(`  +4s       : blank=${t2.blank} vis=${t2.visCount}/${t2.total}`);
  }
});

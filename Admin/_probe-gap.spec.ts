import { test } from '../lib/fixtures';
import { MENU_LIST } from '../lib/langCheck';
import * as fs from 'fs';
import * as path from 'path';

// 버튼·탭·토글 갭 센서스
// 실행: npx playwright test --project=admin-chromium Admin/_probe-gap.spec.ts --no-deps

test('gap census — 전 화면 버튼·탭·토글 vs suites.ts tcId', async ({ admin }) => {
  test.setTimeout(900_000);

  // suites.ts에서 tcId 목록 추출 (정적 grep)
  const suitesPath = path.join('lib', 'suites.ts');
  const suitesContent = fs.readFileSync(suitesPath, 'utf-8');
  const tcIdPattern = /tcId:\s*['"`]([^'"`]+)['"`]/g;
  const allTcIds = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tcIdPattern.exec(suitesContent)) !== null) allTcIds.add(m[1]);

  const report: Record<string, unknown>[] = [];

  for (const { menu, subs } of MENU_LIST) {
    for (const sub of subs) {
      const screen = `${menu} > ${sub}`;
      const ok = await navigateMenu(admin, menu, sub).catch(() => false);
      await settle(admin, 1000);
      if (!ok) {
        report.push({ screen, status: 'SKIP(진입실패)', buttons: [], tabs: [], toggles: [], gaps: [] });
        continue;
      }

      // DOM 수집: 페이지 레벨 버튼·탭·토글 (행 버튼 제외)
      const elements = await admin.evaluate(() => {
        const ROW_SEL = '.table-overflow-item table tbody tr, .list-table-group tbody tr';
        const isVisible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).display !== 'none';
        };
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter(el => isVisible(el) && !el.closest(ROW_SEL))
          .map(el => ({ txt: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 30), cls: (el.className || '').toString().slice(0, 60) }))
          .filter(b => b.txt);
        const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab-item, .tab-btn, .tab-link'))
          .filter(el => isVisible(el))
          .map(el => ({ txt: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 30) }))
          .filter(t => t.txt);
        const toggles = Array.from(document.querySelectorAll('input[type="checkbox"]:not(table *), input[type="radio"]:not(table *), [class*="toggle"]:not(table *)'))
          .filter(el => isVisible(el))
          .map(el => ({ type: el.tagName + '/' + (el.getAttribute('type') || el.className.toString().slice(0, 30)) }));
        return { buttons: [...new Map(buttons.map(b => [b.txt, b])).values()].slice(0, 30), tabs: [...new Map(tabs.map(t => [t.txt, t])).values()].slice(0, 20), toggles: toggles.slice(0, 20) };
      });

      // 버튼 중 suites.ts에서 언급되지 않은 텍스트 → 갭 후보
      const gaps = elements.buttons.filter(b => {
        if (!b.txt || b.txt.length < 2) return false;
        // suites.ts에 해당 버튼 텍스트가 있는지 확인
        const q = b.txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !new RegExp(q).test(suitesContent);
      }).map(b => b.txt);

      report.push({ screen, status: 'OK', buttons: elements.buttons, tabs: elements.tabs, toggles: elements.toggles, gaps });
      console.log(`[${screen}] btns=${elements.buttons.length} tabs=${elements.tabs.length} toggles=${elements.toggles.length} gaps=${gaps.length > 0 ? gaps.join(',') : '-'}`);
    }
  }

  // 갭 요약
  const gapScreens = report.filter(r => Array.isArray((r as any).gaps) && (r as any).gaps.length > 0);
  console.log(`\n=== 갭 후보 화면 (${gapScreens.length}건) ===`);
  for (const r of gapScreens) {
    console.log(`  [${r.screen}] → ${(r as any).gaps.join(' / ')}`);
  }
  console.log(`\n총 화면=${report.length} / 갭화면=${gapScreens.length} / SKIP=${report.filter(r => r.status !== 'OK').length}`);

  fs.mkdirSync('analysis', { recursive: true });
  fs.writeFileSync('analysis/_gap_report.json', JSON.stringify({ summary: report.map(r => ({ screen: r.screen, status: r.status, gapCount: Array.isArray((r as any).gaps) ? (r as any).gaps.length : 0, gaps: (r as any).gaps })), detail: report }, null, 2), 'utf-8');
  console.log('>>> saved analysis/_gap_report.json');
});

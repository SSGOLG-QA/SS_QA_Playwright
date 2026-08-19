import { test, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_IA, COURSE_SUBDOMAIN } from '../lib/course/courseHelpers';

// ──────────────────────────────────────────────────────────────
//  컴포넌트 인벤토리 추출 — 전 화면의 '상호작용 요소'(분모)를 자동 열거.
//  - 커버리지 = 검증한 것 ÷ [전체]. 이 스펙이 '전체'를 확정한다.
//  - 각 화면 기본 상태에서 보이는 button/toggle/vue-select/tab/input/datepicker/zoom 추출.
//    (탭 선택 후 조건부 노출되는 요소는 L2 테스트가 커버 — 여기선 기본 노출 요소가 분모)
//  - 산출: baselines/course-components.<sub>.json  → scripts/courseCoverage 가 갭 계산.
//  - 실행: npm run course:auth 후  npm run course:inventory
// ──────────────────────────────────────────────────────────────

interface Comp { kind: string; label: string }

async function extract(page: Page): Promise<Comp[]> {
  return page.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const seen = new Set<string>();
    const out: { kind: string; label: string }[] = [];
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const inSnb = (e: Element) => !!e.closest('.side-navbar-container');
    const push = (kind: string, label: string) => {
      label = norm(label).slice(0, 40);
      if (!label) label = '(무텍스트)';
      const key = kind + '|' + label;
      if (seen.has(key)) return; seen.add(key);
      out.push({ kind, label });
    };
    const labelOf = (e: Element) => {
      const t = norm((e as HTMLElement).innerText || e.textContent || '');
      if (t) return t;
      const el = e as HTMLElement;
      return el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder')
        || (typeof el.className === 'string' ? el.className.split(/\s+/).find(c => /ico|btn|icon|zoom|close|add|reset/i.test(c)) || '' : '') || '';
    };
    // 좌측 탭
    document.querySelectorAll('.sub-navigation-bar li').forEach(e => { if (vis(e)) push('tab', labelOf(e)); });
    // vue-select 드롭다운
    document.querySelectorAll('.v-select').forEach(e => { if (vis(e) && !inSnb(e)) { const sel = e.querySelector('.vs__selected'); push('dropdown', sel ? labelOf(sel) : labelOf(e)); } });
    // 토글(체크박스/toggle 클래스)
    document.querySelectorAll('[class*="toggle"] input, input[type="checkbox"], [class*="switch"]').forEach(e => { if (!inSnb(e)) { const lab = e.closest('label') || e.parentElement; push('toggle', lab ? labelOf(lab) : '(토글)'); } });
    // 날짜
    document.querySelectorAll('.datepicker-input, input[type="date"], .datepicker-range').forEach(e => { if (vis(e) && !inSnb(e)) push('datepicker', labelOf(e) || '날짜'); });
    // 줌/지도 컨트롤
    document.querySelectorAll('.leaflet-control-zoom a, [class*="zoom"] button, [class*="zoom"] a').forEach(e => push('zoom', labelOf(e) || (e as HTMLElement).getAttribute('title') || '줌'));
    // 인풋(검색 등)
    document.querySelectorAll('input:not([type="checkbox"]):not([type="date"]):not(.vs__search)').forEach(e => { if (vis(e) && !inSnb(e)) push('input', (e as HTMLElement).getAttribute('placeholder') || '입력'); });
    // 버튼(일반)
    document.querySelectorAll('button, [role="button"], a.button-common, a.btn').forEach(e => { if (vis(e) && !inSnb(e) && !e.closest('.v-select') && !e.closest('.leaflet-control-zoom')) push('button', labelOf(e)); });
    return out;
  });
}

test('코스관리 컴포넌트 인벤토리 추출', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin = await openCourseAdmin(page, context);
  const inv: Record<string, Comp[]> = {};

  for (const { menu, subs } of COURSE_IA) {
    for (const { name: sub } of subs) {
      const key = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      try {
        if (menu !== 'Home') { const ok = await gotoCourseMenu(admin, menu, sub); if (!ok) { inv[key] = []; continue; } }
        await killAlarms(admin);
        await admin.waitForTimeout(1200);
        const comps = await extract(admin).catch(() => [] as Comp[]);
        inv[key] = comps;
        console.log(`  ${key.padEnd(28)} 컴포넌트 ${comps.length}`);
      } catch (e) { inv[key] = []; console.log(`  ${key} 추출 실패: ${(e as Error).message.slice(0, 60)}`); }
    }
  }

  const dir = path.join(process.cwd(), 'baselines');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `course-components.${COURSE_SUBDOMAIN}.json`);
  fs.writeFileSync(file, JSON.stringify(inv, null, 2));
  const total = Object.values(inv).reduce((a, c) => a + c.length, 0);
  console.log(`\n[인벤토리] 화면 ${Object.keys(inv).length} · 컴포넌트 총 ${total} → ${file}`);
});

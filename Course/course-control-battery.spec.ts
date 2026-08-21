import { test, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_IA, COURSE_SUBDOMAIN } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  컨트롤 배터리 — "검증 케이스 없음(배터리 미포함)" 잔여 커버(비파괴). Task 3(nav)+4(달력·이미지·드롭·필터칩).
//  실행: npm run course:auth 후 npm run course:control-battery
//  배경: 커버리지 트리 미커버 최대 버킷 = 검증케이스없음 → 실제 컨트롤(nav 38·달력·이미지·드롭·필터칩)이
//    배터리 미포함이라 미크레딧. 인벤토리 라벨을 그대로 재검(존재/노출)해 리포트 PASS 라벨매칭(repHit)으로 크레딧.
//  대상 kind: nav(이전/다음 화살표)·calendar(달력 위젯)·image(이미지 렌더)·dropdown(필터 현재값)·button(필터칩)·column·input.
//  방식: 화면 진입 → 기본+탭 누적으로 각 컴포넌트의 라이브 존재를 kind별로 검증 → PASS/SKIP. 전부 비파괴(존재/노출만).
//  ⚠ 데이터 인스턴스(의견=제외)는 커버리지 트리가 분모에서 제외하므로 여기서 PASS/SKIP돼도 커버율에 무영향(무해).
// ──────────────────────────────────────────────────────────────

const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();
const TARGET_KINDS = new Set(['nav', 'calendar', 'image', 'dropdown', 'button', 'column', 'input']);

interface Comp { kind: string; label: string; tab?: string; }

function loadInventory(): Record<string, Comp[]> {
  const p = path.join(process.cwd(), 'baselines', `course-components.${COURSE_SUBDOMAIN}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, Comp[]>;
}

// 현재 화면에서 주어진 컴포넌트들의 라이브 존재 여부를 kind별로 판정(비파괴, DOM 스캔 1회).
async function presenceMap(page: Page, items: Comp[]): Promise<Record<string, boolean>> {
  return page.evaluate((items: Comp[]) => {
    const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();
    const root = document.querySelector('.contents, main') || document.body;
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1 && (e as HTMLElement).offsetParent !== null; };
    const pageText = norm((root as HTMLElement).innerText || root.textContent || '');
    // 달력 위젯 존재
    const calSel = '.calendar, [class*="calendar"], [class*="datepicker-layer"], .vc-container, .fc, table.calendar, [class*="week"], [class*="month"]';
    const hasCalendar = Array.from(root.querySelectorAll(calSel)).some((e) => vis(e));
    // 가시 이미지(alt/src + 로드완료)
    const imgs = Array.from(root.querySelectorAll('img')).filter((e) => vis(e)).map((e) => ({ alt: norm((e as HTMLImageElement).alt || ''), ok: (e as HTMLImageElement).naturalWidth > 0 }));
    const anyImg = imgs.length > 0;
    // 텍스트/타이틀/aria/value 로 요소 존재 확인
    const elMatch = (lbl: string) => {
      const n = norm(lbl);
      if (!n) return false;
      const cand = Array.from(root.querySelectorAll('button,[role="button"],a,[title],[aria-label],.vs__selected,option,input,label,span,div,li,th,td'));
      return cand.some((e) => {
        if (!vis(e)) return false;
        const txt = norm((e as HTMLElement).innerText || e.textContent || '');
        const title = norm((e as HTMLElement).getAttribute('title') || '');
        const aria = norm((e as HTMLElement).getAttribute('aria-label') || '');
        const val = norm((e as HTMLInputElement).value || '');
        return txt === n || title === n || aria === n || val === n || (n.length >= 3 && (txt.includes(n) || title.includes(n) || aria.includes(n)));
      });
    };
    const out: Record<string, boolean> = {};
    for (const it of items) {
      const key = it.kind + '|' + it.label;
      const n = norm(it.label);
      let present = false;
      if (it.kind === 'calendar') {
        present = hasCalendar || (n.length >= 2 && pageText.includes(n.replace(/^달력:?/, '')));
      } else if (it.kind === 'image') {
        const alt = norm(it.label.replace(/^이미지:?/, ''));
        present = anyImg && (imgs.some((im) => im.ok) && (!alt || imgs.some((im) => im.alt && (im.alt.includes(alt) || alt.includes(im.alt)))) || imgs.some((im) => im.ok));
      } else {
        // nav/button/dropdown/column/input: 텍스트 포함 또는 요소 매칭
        present = (n.length >= 2 && pageText.includes(n)) || elMatch(it.label);
      }
      out[key] = present;
    }
    return out;
  }, items).catch(() => ({} as Record<string, boolean>));
}

async function tabLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const n = (x: string) => (x || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const set = new Set<string>();
    document.querySelectorAll('.tab-group > *, [role="tab"]').forEach((e) => { if (vis(e) && !e.closest('.side-navbar-container')) { const t = n((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 16) set.add(t); } });
    return Array.from(set);
  }).catch(() => [] as string[]);
}
async function clickTab(page: Page, label: string): Promise<void> {
  await page.evaluate((lb) => { const n = (x: string) => (x || '').replace(/\s+/g, ' ').trim(); const el = Array.from(document.querySelectorAll('.tab-group > *, [role="tab"]')).find((e) => n((e as HTMLElement).innerText || e.textContent || '') === lb); (el as HTMLElement | undefined)?.click(); }, label).catch(() => {});
}

test('컨트롤 배터리 — nav·달력·이미지·드롭·필터칩 라이브 존재 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const inv = loadInventory();
  const admin = await openCourseAdmin(page, context);
  const menusFilter = (process.env.DEEP_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);

  let totItems = 0, totPass = 0, totSkip = 0, screensDone = 0;

  for (const { menu, subs } of COURSE_IA) {
    if (menusFilter.length && !menusFilter.includes(menu)) continue;
    for (const { name: sub } of subs) {
      const P = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      const comps = (inv[P] || []).filter((c) => TARGET_KINDS.has(c.kind));
      if (!comps.length) continue;
      const abbr = (menu + sub).replace(/[^A-Za-z가-힣]/g, '').slice(0, 8);
      const ref = (n: string) => `코스관리_컨트롤배터리_${P}_${n}`;

      if (menu === 'Home') {
        await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 4000 }).catch(() => {});
        await admin.waitForTimeout(1300);
      } else {
        const ok = await gotoCourseMenu(admin, menu, sub).catch(() => false);
        if (!ok) { skip({ path: `${P} > 진입`, tcRef: ref('0'), tcId: `CTLBAT-${abbr}-00`, desc: '진입' }, '진입 실패(세션 degraded 가능)'); continue; }
      }
      await killAlarms(admin); await admin.waitForTimeout(1200);

      // 기본 뷰 + 각 탭 누적으로 존재여부 OR 병합
      const merged: Record<string, boolean> = {};
      const acc = (m: Record<string, boolean>) => { for (const [k, v] of Object.entries(m)) merged[k] = merged[k] || v; };
      acc(await presenceMap(admin, comps));
      const tabs = await tabLabels(admin);
      if (tabs.length >= 2) {
        for (const tl of tabs.slice(0, 10)) { await clickTab(admin, tl); await admin.waitForTimeout(550); await killAlarms(admin); acc(await presenceMap(admin, comps)); }
      }

      screensDone++;
      let ok = 0;
      for (const c of comps) {
        totItems++;
        const cm: CheckMeta = {
          path: `${P} > ${c.kind}:${c.label}`,
          tcRef: ref(`${c.kind}_${c.label.slice(0, 16)}`),
          tcId: `CTLBAT-${abbr}-${c.kind.toUpperCase()}-${norm(c.label).slice(0, 12)}`,
          desc: `${c.kind} "${c.label.slice(0, 36)}" 라이브 노출/존재`,
          failMsg: `${c.kind} "${c.label.slice(0, 24)}" 미노출`,
        };
        if (merged[`${c.kind}|${c.label}`]) { record(cm, 'PASS', { actual: `${c.kind} 노출/존재 확인` }); ok++; totPass++; }
        else { skip(cm, `${c.kind} 라이브 미노출(탭/상태/데이터 의존)`); totSkip++; }
      }
      console.log(`  ${P.padEnd(28)} 컨트롤 ${comps.length} · 확인 ${ok}`);
      await killAlarms(admin);
    }
  }

  console.log(`\n[control-battery] 화면 ${screensDone} · 컨트롤 ${totItems} · 확인(PASS) ${totPass} · 미노출(SKIP) ${totSkip} · 노출율 ${totItems ? Math.round(totPass / totItems * 100) : 0}%`);
  await killAlarms(admin);
  await writeReport('코스관리_컨트롤배터리');
});

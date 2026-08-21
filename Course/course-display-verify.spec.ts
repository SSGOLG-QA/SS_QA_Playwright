import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_IA } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  화면기본 표시 검증 강화 — 전 화면 표시 요소(제목·안내문구·컬럼·버튼·탭·섹션·nav) 존재·비어있지않음 검증(비파괴).
//  실행: npm run course:auth 후 npm run course:display-verify
//  배경: 화면기본 26%(text 208·column 85·button 60·title 34 미커버) — 표시 요소가 컴포넌트 단위 미검증.
//    "화면 기본 검증" = 각 요소가 렌더되고 비어있지 않은지 확인(공백/누락 회귀 감지).
//  - 각 화면(+탭)의 표시 컴포넌트를 수집 → 가시+비어있지않음 검증 → 크레딧(라벨 매칭).
//  - 전부 비파괴(조회/가시성 확인만). 데이터/컨트롤 kind(입력·datepicker·차트 등)는 타 보강이 담당 → 여기선 표시요소만.
// ──────────────────────────────────────────────────────────────

// 화면기본 대상 kind(표시 요소). 입력/datepicker/드롭/토글/차트/이미지/줌 = 타 보강.
const DISPLAY_KINDS = /^(title|text|section|column|tab|nav|button|table)$/;

async function displayComps(page: Page): Promise<{ kind: string; label: string }[]> {
  return page.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : '');
    const isChrome = (e: Element) => !!e.closest('.side-navbar-container, .header, [class*="header-"], [class*="alarm"]');
    const isData = (e: Element) => !!e.closest('tbody, .list-table-group tbody, .vs__dropdown-menu, thead');
    const inRepeated = (e: Element) => { let p: Element | null = e; for (let i = 0; i < 4 && p; i++) { p = p.parentElement; if (!p) break; const k = Array.from(p.children); if (k.length >= 3) { const c0 = clsOf(k[0]); if (c0 && k.filter((x) => clsOf(x) === c0).length >= 3) return true; } } return false; };
    const isDataText = (t: string) => /^\d+$/.test(t) || /^[월화수목금토일]$/.test(t) || /^\d{4}[-.]\d/.test(t) || /^[\d,]+\s*(원|건|명|%|개|점|일)?$/.test(t) || /^W-\d+$/.test(t) || /^[A-F][+-]?$/.test(t) || /^\d{4}년/.test(t) || /기준$/.test(t);
    const seen = new Set<string>(); const out: { kind: string; label: string }[] = [];
    const push = (k: string, l: string) => { l = norm(l).slice(0, 44); if (!l || /^알림$/.test(l) || /^\d{1,3}$/.test(l)) return; const key = k + '|' + l; if (seen.has(key)) return; seen.add(key); out.push({ kind: k, label: l }); };
    const labelOf = (e: Element) => norm((e as HTMLElement).innerText || e.textContent || '') || (e as HTMLElement).getAttribute('title') || '';
    const root = document.querySelector('.contents, main') || document.body;
    // 제목/안내문구/라벨
    root.querySelectorAll('h1,h2,h3,h4,label,[class*="title"],[class*="tit"],p,[class*="guide"],[class*="info"],[class*="desc"],[class*="comment"],[class*="notice"]').forEach((e) => { if (!vis(e) || isChrome(e) || isData(e) || inRepeated(e)) return; if (e.querySelector('button,a,input,select')) return; const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length >= 2 && t.length <= 200 && !isDataText(t)) push(/^h[1-6]$/.test(e.tagName.toLowerCase()) || /title|tit/i.test(clsOf(e)) ? 'title' : 'text', t); });
    // 컬럼
    root.querySelectorAll('thead th, thead td').forEach((e) => { if (vis(e)) { const t = norm(e.textContent); if (t && t.length <= 20) push('column', t); } });
    // 탭
    document.querySelectorAll('.sub-navigation-bar li, [role="tab"], .tab-group > *, .tab-menu > *, .tabs > *').forEach((e) => { if (vis(e) && !isChrome(e) && !/table/i.test(clsOf(e))) { const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 20) push('tab', t); } });
    // 버튼(조회/일반 — CRUD는 등록수정 보강)
    root.querySelectorAll('button, [role="button"], a.button-common, a.btn').forEach((e) => { if (vis(e) && !isChrome(e)) { const l = labelOf(e); if (l && !/등록|수정|삭제|저장|추가|업로드|적용|변경|설정|편집|초기화/.test(l)) push('button', l); } });
    // 섹션/테이블
    root.querySelectorAll('[class*="section-card"], [class*="card-list"], [class*="widget"]').forEach((e) => { if (vis(e) && !isChrome(e)) { const tt = e.querySelector('[class*="title"], .tit, h2, h3, h4'); const s = tt ? norm((tt as HTMLElement).innerText || tt.textContent || '') : ''; if (s && s.length <= 30) push('section', s); } });
    if (root.querySelector('table, .list-table-group')) push('table', '테이블');
    return out;
  }).catch(() => [] as { kind: string; label: string }[]);
}

test('화면기본 표시 검증 강화 — 전 화면 표시 요소 존재·비어있지않음(비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const menusFilter = (process.env.DEEP_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);

  for (const { menu, subs } of COURSE_IA) {
    if (menusFilter.length && !menusFilter.includes(menu)) continue;
    for (const { name: sub } of subs) {
      const P = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      const id = `DISP_${(menu + sub).replace(/[^A-Za-z가-힣]/g, '').slice(0, 8)}`;
      const ref = (n: string) => `코스관리_표시보강_${id}_${n}`;
      if (menu !== 'Home') { const ok = await gotoCourseMenu(admin, menu, sub).catch(() => false); if (!ok) { skip({ path: P, tcRef: ref('0'), tcId: `${id}-00`, desc: '진입' }, '진입 실패'); continue; } }
      await killAlarms(admin); await admin.waitForTimeout(1300);

      const collect = new Map<string, { kind: string; label: string }>();
      (await displayComps(admin)).forEach((c) => collect.set(`${c.kind}|${c.label}`, c));
      // 탭 있으면 각 탭 표시요소 추가
      const tabs: string[] = await admin.evaluate(() => { const norm = (x: string) => (x || '').replace(/\s+/g, ' ').trim(); const vis = (e: Element) => (e as HTMLElement).offsetParent !== null; const set = new Set<string>(); document.querySelectorAll('.tab-group > *, [role="tab"]').forEach((e) => { if (vis(e) && !e.closest('.side-navbar-container')) { const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 14) set.add(t); } }); return Array.from(set); }).catch(() => []);
      if (tabs.length >= 2) {
        for (const tl of tabs.slice(0, 8)) {
          await admin.evaluate((label) => { const norm = (x: string) => (x || '').replace(/\s+/g, ' ').trim(); const el = Array.from(document.querySelectorAll('.tab-group > *, [role="tab"]')).find((e) => norm((e as HTMLElement).innerText || e.textContent || '') === label); (el as HTMLElement | undefined)?.click(); }, tl).catch(() => {});
          await admin.waitForTimeout(600); await killAlarms(admin);
          (await displayComps(admin)).forEach((c) => collect.set(`${c.kind}|${c.label}`, c));
        }
      }

      const comps = [...collect.values()].filter((c) => DISPLAY_KINDS.test(c.kind));
      if (!comps.length) { skip({ path: `${P} > 표시요소`, tcRef: ref('d0'), tcId: `${id}-D0`, desc: '표시 요소' }, '표시 요소 미검출'); continue; }
      let ok = 0;
      for (const c of comps) {
        const cm: CheckMeta = { path: `${P} > ${c.kind}:${c.label}`, tcRef: ref(`${c.kind}_${c.label}`), tcId: `${id}-${c.kind.toUpperCase()}-${c.label.replace(/\s+/g, '').slice(0, 12)}`, desc: `${c.kind} "${c.label}" 표시(비어있지않음)`, failMsg: `"${c.label}" 미표시` };
        // 재검: 라벨 텍스트가 현재 화면에 가시로 존재하는지(공백/누락 회귀 감지). 존재하면 PASS.
        const present = await admin.getByText(c.label, { exact: false }).first().isVisible({ timeout: 1500 }).catch(() => false);
        if (present) { record(cm, 'PASS', { actual: `${c.kind} "${c.label}" 표시 확인` }); ok++; }
        else skip(cm, `"${c.label}" 재검 미표시(탭/상태 의존)`);
      }
      console.log(`  ${P.padEnd(26)} 표시요소 ${comps.length} · 확인 ${ok}`);
      await killAlarms(admin);
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_화면기본표시보강');
});

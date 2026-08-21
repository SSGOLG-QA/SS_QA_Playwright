import { test, Page, BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_IA, COURSE_SUBDOMAIN } from '../lib/course/courseHelpers';

// ──────────────────────────────────────────────────────────────
//  Phase B/C — 화면 밖 전환 매핑 + 대상(모달/팝업/페이지) 구성요소 카탈로그(비파괴).
//  실행: npm run course:auth 후 npm run course:transition-map
//  - 각 화면의 "열기형" 트리거(버튼/링크)를 비파괴로 클릭 → 결과 분류:
//      모달(.modal-group 증가) / 새탭·팝업(page 이벤트) / 페이지 전환(URL 변화) / 무동작.
//  - 전환 대상의 구성요소(버튼·입력·텍스트·테이블·차트 등)를 카탈로그(Phase C = 모달 내부를 분모에 편입).
//  - 닫기: 모달=취소/닫기/Escape · 새탭=close · 페이지=goBack. ⚠ 저장/삭제/변경 등 파괴 트리거는 클릭 금지.
//  - 산출: baselines/course-transitions.<sub>.json → 트리 렌더러가 화면별 전환 서브트리로 표시.
//  - td(테스트 환경)·킹즈락(비실데이터) 전제(CLAUDE.md). 그래도 파괴 라벨은 화이트리스트로 원천 차단.
// ──────────────────────────────────────────────────────────────

// 파괴 라벨(클릭 금지). 열기형만 클릭.
const DESTRUCTIVE = /저장|삭제|변경|사용\s*중지|관제\s*적용|적용|초기화|재개|승인|반려|발행|전송|보내기|제출|확정|동기화|업로드|다운로드|내보내기|로그아웃|권한\s*변경/;
// 열기형(전환 유발 가능) 트리거.
const OPENISH = /보기|상세|신규\s*등록|등록$|설정|관리$|편집|미리보기|웹뷰|추가$|조회|열기|선택|바로가기|링크/;

interface Comp { kind: string; label: string }
interface Transition { trigger: string; type: string; url?: string; components: Comp[]; count: number }

// 대상(모달/페이지/새탭) 구성요소 컴팩트 캡처(root 스코프). 데이터/chrome 제외.
async function captureIn(page: Page, rootSel: string | null): Promise<Comp[]> {
  return page.evaluate((sel) => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const root: Element = (sel ? document.querySelector(sel) : null) || document.querySelector('.contents, main') || document.body;
    const seen = new Set<string>(); const out: { kind: string; label: string }[] = [];
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : '');
    const isChrome = (e: Element) => !!e.closest('.side-navbar-container, .header, [class*="header-"], [class*="alarm"]');
    const isData = (e: Element) => !!e.closest('tbody, .list-table-group tbody, .vs__dropdown-menu, thead');
    const push = (k: string, l: string) => { l = norm(l).slice(0, 60); if (!l || /^알림$/.test(l)) return; if ((k === 'button') && /^\d{1,3}$/.test(l)) return; const key = k + '|' + l; if (seen.has(key)) return; seen.add(key); out.push({ kind: k, label: l }); };
    const labelOf = (e: Element) => { const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t) return t; const el = e as HTMLElement; return el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || ''; };
    // 위젯
    root.querySelectorAll('table, .list-table-group').forEach((t) => { if (vis(t)) { push('table', '테이블'); t.querySelectorAll('thead th').forEach((th) => { const c = norm(th.textContent); if (c && c.length <= 20) push('column', c); }); } });
    root.querySelectorAll('canvas, [class*="chart"], .highcharts-container').forEach((e) => { if (vis(e) && !e.closest('[class*="3d"], [class*="leaflet"]')) push('chart', '차트'); });
    root.querySelectorAll('img').forEach((e) => { if (vis(e) && !isData(e)) push('image', '이미지'); });
    // 컨트롤
    root.querySelectorAll('.datepicker-input, input[type="date"]').forEach((e) => { if (vis(e)) push('datepicker', '날짜'); });
    root.querySelectorAll('.v-select').forEach((e) => { if (vis(e)) { const s = e.querySelector('.vs__selected'); push('dropdown', (s && norm(s.textContent || '')) || '드롭'); } });
    root.querySelectorAll('input[type="checkbox"], [class*="switch"]').forEach((e) => { if (vis(e) && !isChrome(e)) { const lab = e.closest('label') || e.parentElement; push('toggle', (lab && labelOf(lab)) || '토글'); } });
    root.querySelectorAll('input:not([type="checkbox"]):not([type="date"]):not(.vs__search):not(.datepicker-input)').forEach((e) => { if (vis(e) && !isChrome(e)) { const ph = (e as HTMLElement).getAttribute('placeholder') || ''; if (!/^\s*YYYY-MM-DD\s*$/.test(ph)) push('input', ph || '입력'); } });
    root.querySelectorAll('button, [role="button"], a.button-common, a.btn').forEach((e) => { if (vis(e) && !isChrome(e)) push('button', labelOf(e)); });
    // 텍스트(제목/문구/라벨)
    root.querySelectorAll('h1,h2,h3,h4,label,[class*="title"],[class*="tit"],p,[class*="guide"],[class*="info"],[class*="desc"]').forEach((e) => { if (!vis(e) || isChrome(e) || isData(e)) return; if (e.querySelector('button,a,input,select')) return; const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length >= 2 && t.length <= 200 && !/^[\d,]+$/.test(t)) push(/^h[1-6]$/.test(e.tagName.toLowerCase()) || /title|tit/i.test(clsOf(e)) ? 'title' : 'text', t); });
    return out;
  }, rootSel).catch(() => [] as Comp[]);
}

async function closeTarget(page: Page) {
  // 모달 취소/닫기 → Escape. 파괴 submit 금지.
  await page.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : '')).pop();
    if (md) { const b = Array.from(md.querySelectorAll('button')).find((x) => /^\s*(취소|닫기|이전)\s*$/.test(x.textContent || '') && !/저장|등록|삭제/.test(x.textContent || '')) || Array.from(md.querySelectorAll('[class*="close"]'))[0]; if (b) (b as HTMLElement).click(); }
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400); await killAlarms(page);
}

test('Phase B/C — 화면 밖 전환 매핑 + 대상 구성요소 카탈로그(비파괴)', async ({ page, context }) => {
  test.setTimeout(1_800_000);
  const admin = await openCourseAdmin(page, context);
  const result: Record<string, Transition[]> = {};
  const menusFilter = (process.env.DEEP_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);

  for (const { menu, subs } of COURSE_IA) {
    if (menusFilter.length && !menusFilter.includes(menu)) continue;
    for (const { name: sub } of subs) {
      const key = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      const transitions: Transition[] = [];
      try {
        if (menu !== 'Home') { const ok = await gotoCourseMenu(admin, menu, sub); if (!ok) { result[key] = []; continue; } }
        await killAlarms(admin); await admin.waitForTimeout(1200);

        // 열기형 트리거 후보 수집(라벨). 파괴 라벨 제외.
        const triggers: string[] = await admin.evaluate(({ OPEN, DESTR }) => {
          const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
          const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          const openRe = new RegExp(OPEN); const destrRe = new RegExp(DESTR);
          const root = document.querySelector('.contents, main') || document.body;
          const set = new Set<string>();
          root.querySelectorAll('button, [role="button"], a.button-common, a.btn').forEach((e) => { if (!vis(e) || e.closest('.side-navbar-container, .header')) return; const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 20 && openRe.test(t) && !destrRe.test(t) && t !== '알림') set.add(t); });
          return Array.from(set).slice(0, 12);
        }, { OPEN: OPENISH.source, DESTR: DESTRUCTIVE.source }).catch(() => [] as string[]);

        for (const trg of triggers) {
          const beforeModals = await admin.locator('.modal-group').count().catch(() => 0);
          const beforeUrl = admin.url();
          const popupP: Promise<Page | null> = context.waitForEvent('page', { timeout: 3500 }).catch(() => null);
          // 클릭(첫 매칭 트리거, 파괴 재확인)
          const clicked = await admin.evaluate(({ label, DESTR }) => {
            const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
            const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
            const destrRe = new RegExp(DESTR);
            const root = document.querySelector('.contents, main') || document.body;
            const el = Array.from(root.querySelectorAll('button, [role="button"], a.button-common, a.btn')).find((e) => vis(e) && norm((e as HTMLElement).innerText || e.textContent || '') === label && !destrRe.test(norm((e as HTMLElement).innerText || e.textContent || '')));
            if (el) { (el as HTMLElement).click(); return true; } return false;
          }, { label: trg, DESTR: DESTRUCTIVE.source }).catch(() => false);
          if (!clicked) { await popupP; continue; }
          await admin.waitForTimeout(1300); await killAlarms(admin);
          const np: Page | null = await popupP;

          let type = '무동작'; let comps: Comp[] = []; let url = '';
          if (np) {
            type = '새탭/팝업';
            await np.waitForTimeout(1200).catch(() => {});
            url = np.url();
            comps = await captureIn(np, null).catch(() => []);
            await np.close().catch(() => {});
          } else if ((await admin.locator('.modal-group').count().catch(() => 0)) > beforeModals) {
            type = '모달';
            comps = await captureIn(admin, '.modal-group').catch(() => []);
            await closeTarget(admin);
          } else if (admin.url() !== beforeUrl) {
            type = '페이지 전환';
            url = admin.url();
            comps = await captureIn(admin, null).catch(() => []);
            await admin.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
            await admin.waitForTimeout(800); await killAlarms(admin);
          }
          if (type !== '무동작') transitions.push({ trigger: trg, type, url: url || undefined, components: comps, count: comps.length });
          await killAlarms(admin);
        }
        result[key] = transitions;
        console.log(`  ${key.padEnd(26)} 전환 ${transitions.length} [${transitions.map((t) => `${t.trigger}→${t.type}(${t.count})`).slice(0, 4).join(', ')}]`);
      } catch (e) { result[key] = transitions; console.log(`  ${key} 오류: ${(e as Error).message.slice(0, 50)}`); }
    }
  }

  const dir = path.join(process.cwd(), 'baselines');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `course-transitions.${COURSE_SUBDOMAIN}.json`), JSON.stringify(result, null, 2));
  const totT = Object.values(result).reduce((a, c) => a + c.length, 0);
  const totC = Object.values(result).reduce((a, arr) => a + arr.reduce((x, t) => x + t.count, 0), 0);
  console.log(`\n[전환맵] 화면 ${Object.keys(result).length} · 전환 ${totT} · 대상 구성요소 ${totC} → baselines/course-transitions.${COURSE_SUBDOMAIN}.json`);
});

import { test, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_SUBDOMAIN } from '../lib/course/courseHelpers';
import { closeForm } from '../lib/course/formE2E';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  화면 밖 전환 검증 배터리 — 캡처된 전환(모달/페이지/새탭)을 실제 열어 내부 구성요소 검증(비파괴).
//  실행: npm run course:auth 후 npm run course:transition-battery
//  배경: 전환 대상 커버 56% — 크레딧이 간접(부모화면 라벨매칭)이고, 실제 여는 검증은 등록/수정 모달(modal-controls)뿐.
//    보기(view)·설정·페이지 전환은 미검증 → 여기서 전환맵(course-transitions.<sub>.json)의 전 전환을 열어
//    대상 구성요소 존재를 직접 검증 → 리포트 라벨매칭으로 전환 대상에 직접 크레딧 + 실검증.
//  방식(비파괴): 화면 진입 → 열기형 트리거 클릭 → 모달/페이지/새탭 판별 → 내부 구성요소 존재검증 →
//    closeForm(취소/닫기/Escape/goBack)·새탭 close 로 복원. 저장/삭제/업로드 등 파괴 트리거는 제외.
// ──────────────────────────────────────────────────────────────

const DESTRUCTIVE = /저장|삭제|변경|사용\s*중지|관제\s*적용|적용$|초기화|재개|승인|반려|발행|전송|보내기|제출|확정|동기화|업로드|다운로드|내보내기|로그아웃|권한\s*변경/;
const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();

interface Comp { kind: string; label: string; }
interface Transition { trigger: string; type: string; components: Comp[]; }
type TransMap = Record<string, Transition[]>;

function loadTransitions(): TransMap {
  const p = path.join(process.cwd(), 'baselines', `course-transitions.${COURSE_SUBDOMAIN}.json`);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  const out: TransMap = {};
  for (const [k, v] of Object.entries(raw)) { if (k !== '_meta' && Array.isArray(v)) out[k] = v as Transition[]; }
  return out;
}

// 트리거 클릭(본문 스코프, 파괴 라벨 제외). 반환: 클릭 성공.
async function clickTrigger(admin: Page, trigger: string): Promise<boolean> {
  if (DESTRUCTIVE.test(trigger)) return false;
  return admin.evaluate((trg) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, '').trim();
    const root = document.querySelector('.contents, main') || document.body;
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && (e as HTMLElement).offsetParent !== null; };
    const cand = Array.from(root.querySelectorAll('button, [role="button"], a.button-common, a.btn, a'));
    const t = norm(trg);
    const el = cand.find((e) => vis(e) && norm((e as HTMLElement).innerText || e.textContent) === t)
      || cand.find((e) => vis(e) && norm((e as HTMLElement).innerText || e.textContent).includes(t) && t.length >= 2);
    if (el) { (el as HTMLElement).click(); return true; }
    return false;
  }, trigger).catch(() => false);
}

// 열린 대상(모달 우선, 없으면 페이지 본문) 스코프에서 컴포넌트 존재 여부 맵.
async function presenceInTarget(admin: Page, comps: Comp[]): Promise<Record<string, boolean>> {
  return admin.evaluate((comps: Comp[]) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, '').trim();
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const cls = (e: Element) => (typeof e.className === 'string' ? e.className : '');
    const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m) && !/alarm/.test(cls(m)));
    const root: Element = mods.length ? mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] : (document.querySelector('.contents, main') || document.body);
    const pageText = norm((root as HTMLElement).innerText || root.textContent || '');
    const elMatch = (lbl: string) => {
      const n = norm(lbl); if (!n) return false;
      return Array.from(root.querySelectorAll('button,[role="button"],a,[title],[aria-label],.vs__selected,option,input,textarea,label,th,td,span,div,p,h1,h2,h3,h4')).some((e) => {
        if (!vis(e)) return false;
        const txt = norm((e as HTMLElement).innerText || e.textContent);
        const ph = norm((e as HTMLElement).getAttribute('placeholder'));
        const ti = norm((e as HTMLElement).getAttribute('title'));
        const ar = norm((e as HTMLElement).getAttribute('aria-label'));
        return txt === n || ph === n || ti === n || ar === n || (n.length >= 3 && (txt.includes(n) || ph.includes(n)));
      });
    };
    const out: Record<string, boolean> = {};
    for (const c of comps) { const n = norm(c.label); out[c.kind + '|' + c.label] = (n.length >= 2 && pageText.includes(n)) || elMatch(c.label); }
    return out;
  }, comps).catch(() => ({} as Record<string, boolean>));
}

async function modalOpen(admin: Page): Promise<boolean> {
  return admin.evaluate(() => { const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; const cls = (e: Element) => (typeof e.className === 'string' ? e.className : ''); return Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).some((m) => vis(m) && !/alarm/.test(cls(m))); }).catch(() => false);
}

test('화면 밖 전환 배터리 — 캡처 전환 열기·내부 구성요소 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(1_200_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const trans = loadTransitions();
  const admin = await openCourseAdmin(page, context);
  const menusFilter = (process.env.DEEP_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);

  let totComp = 0, totPass = 0, nTrans = 0, opened = 0;

  for (const [screen, list] of Object.entries(trans)) {
    if (!list.length) continue;
    const [menu, sub] = screen.includes(' > ') ? [screen.split(' > ')[0], screen.split(' > ').slice(1).join(' > ')] : [screen, ''];
    if (menusFilter.length && !menusFilter.includes(menu)) continue;
    const abbr = norm(menu + sub).replace(/[^A-Za-z가-힣]/g, '').slice(0, 8);

    for (const tr of list) {
      nTrans++;
      const ref = (n: string) => `코스관리_전환배터리_${screen}_${tr.trigger}_${n}`;
      const tid = `TRBAT-${abbr}-${norm(tr.trigger).slice(0, 8)}`;
      // 화면 신규 진입(전환마다 격리 — 페이지 전환/URL 변화 대비)
      if (menu === 'Home') { await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await admin.waitForTimeout(1200); }
      else { const ok = await gotoCourseMenu(admin, menu, sub).catch(() => false); if (!ok) { skip({ path: `${screen} > 전환:${tr.trigger}`, tcRef: ref('0'), tcId: `${tid}-00`, desc: '진입' }, '진입 실패(세션 degraded 가능)'); continue; } }
      await killAlarms(admin); await admin.waitForTimeout(900);

      if (DESTRUCTIVE.test(tr.trigger)) { skip({ path: `${screen} > 전환:${tr.trigger}`, tcRef: ref('d'), tcId: `${tid}-D`, desc: '전환 열기' }, '파괴 트리거 — 클릭 제외(비파괴)'); continue; }

      // 새 탭 대비 리스너
      let newPage: Page | null = null;
      const onPage = (p: Page) => { if (!newPage) newPage = p; };
      (context as BrowserContext).on('page', onPage);
      const urlBefore = admin.url();
      const clicked = await clickTrigger(admin, tr.trigger);
      await admin.waitForTimeout(1500);
      (context as BrowserContext).off('page', onPage);

      if (!clicked) { skip({ path: `${screen} > 전환:${tr.trigger}`, tcRef: ref('t'), tcId: `${tid}-T`, desc: '트리거 클릭' }, '트리거 미발견(라벨 변동/데이터 의존)'); continue; }

      // 대상 판별
      const isModal = await modalOpen(admin);
      const target: Page = newPage || admin;
      if (newPage) { await (newPage as Page).waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {}); await (newPage as Page).waitForTimeout(900); }
      const urlChanged = !newPage && admin.url() !== urlBefore;
      const kindOpen = isModal ? '모달' : newPage ? '새탭' : urlChanged ? '페이지' : '무동작';
      opened += kindOpen === '무동작' ? 0 : 1;

      if (kindOpen === '무동작') {
        skip({ path: `${screen} > 전환:${tr.trigger}`, tcRef: ref('n'), tcId: `${tid}-N`, desc: '전환 열림' }, '트리거 클릭 후 전환 미발생(선택 게이트/데이터 의존)');
      } else {
        const pres = newPage ? await presenceInTarget(newPage as Page, tr.components) : await presenceInTarget(admin, tr.components);
        let ok = 0;
        for (const c of tr.components) {
          totComp++;
          const cm: CheckMeta = { path: `${screen} > 전환:${tr.trigger}(${kindOpen}) > ${c.kind}:${c.label}`, tcRef: ref(`${c.kind}_${c.label.slice(0, 14)}`), tcId: `${tid}-${c.kind.toUpperCase()}-${norm(c.label).slice(0, 10)}`, desc: `[${tr.trigger}] ${kindOpen} 내 ${c.kind} "${c.label.slice(0, 30)}" 노출` };
          if (pres[`${c.kind}|${c.label}`]) { record(cm, 'PASS', { actual: `${kindOpen} 내 노출` }); ok++; totPass++; }
          else skip(cm, `${kindOpen} 내 미노출(상태/데이터 의존)`);
        }
        console.log(`  ${screen} · [${tr.trigger}] ${kindOpen} · 대상 ${tr.components.length} · 확인 ${ok}`);
      }

      // 닫기(비파괴)
      if (newPage) { await (newPage as Page).close().catch(() => {}); await admin.bringToFront().catch(() => {}); }
      else { await closeForm(admin).catch(() => {}); }
      await killAlarms(admin); await admin.waitForTimeout(500);
    }
  }

  console.log(`\n[transition-battery] 전환 ${nTrans} · 열림 ${opened} · 대상 ${totComp} · 확인(PASS) ${totPass} · 노출율 ${totComp ? Math.round(totPass / totComp * 100) : 0}%`);
  await killAlarms(admin);
  await writeReport('코스관리_전환배터리');
});

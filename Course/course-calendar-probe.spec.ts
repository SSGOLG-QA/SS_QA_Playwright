import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  달력/일정 화면 컴포넌트 미추출 진단 프로브(비파괴).
//  실행: npm run course:auth 후 npm run course:calendar-probe
//  대상: 작업 관리 > 작업 계획(주간/월간/연간 달력 뷰). 인벤토리에서 컴포넌트 0으로 나온 원인 파악 —
//    ① 진입 성공/렌더 여부 ② 뷰 토글(주간/월간/연간)·날짜이동(<,>)·기간표시 요소 구조
//    ③ extractState 가시성(offsetParent) 필터가 왜 다 걸러내는지 ④ 로딩 지연 여부.
//  산출: analysis/코스관리_작업계획_달력.json
//  ⚠ 비파괴: 관찰만(뷰 토글/날짜이동 클릭 없음).
// ──────────────────────────────────────────────────────────────

test('작업 계획(달력) 컴포넌트 미추출 진단', async ({ page, context }) => {
  test.setTimeout(200_000);
  const admin: Page = await openCourseAdmin(page, context);
  const entered = await gotoCourseMenu(admin, '작업 관리', '작업 계획').catch(() => false);
  const out: Record<string, unknown> = { entered, url: admin.url() };
  if (!entered) { out.note = '진입 실패(하위메뉴 미노출 — 세션 degraded/만료)'; fin(out); return; }
  await admin.waitForTimeout(2_500); await killAlarms(admin);   // 달력 데이터 로딩 여유

  out.scan = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : (e.getAttribute && e.getAttribute('class')) || '');
    const visOffset = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const visRect = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const chain = (e: Element, n = 4) => { const o: string[] = []; let p: Element | null = e; for (let i = 0; i < n && p; i++) { o.push(`${p.tagName.toLowerCase()}${clsOf(p) ? '.' + clsOf(p).split(/\s+/).slice(0, 2).join('.') : ''}`); p = p.parentElement; } return o.join(' < '); };

    // 전체 인터랙티브 요소(가시성 두 방식 비교 — offsetParent vs rect)
    const all = Array.from(document.querySelectorAll('button, a, [role="button"], input, .v-select, [class*="toggle"]'));
    const interactive = all.map((e) => ({
      tag: e.tagName.toLowerCase(), txt: norm((e as HTMLElement).innerText || e.textContent || '').slice(0, 24),
      cls: clsOf(e).slice(0, 50), visOffset: visOffset(e), visRect: visRect(e),
      inChrome: !!e.closest('.side-navbar-container, .header, .gnb, [class*="header-"], [class*="alarm"], [class*="noti-"]'),
    })).filter((x) => x.txt || /btn|button|toggle|arrow|prev|next|nav/i.test(x.cls)).slice(0, 60);

    // 뷰 토글(주간/월간/연간) + 날짜 이동 후보
    const viewToggle = all.filter((e) => /^(주간|월간|연간|일간|주|월|년)$/.test(norm(e.textContent))).map((e) => ({ txt: norm(e.textContent), tag: e.tagName.toLowerCase(), cls: clsOf(e).slice(0, 50), chain: chain(e) }));
    const dateNav = Array.from(document.querySelectorAll('[class*="prev"], [class*="next"], [class*="arrow"], [class*="nav"] button, .swiper-button-prev, .swiper-button-next')).filter(visRect).map((e) => ({ tag: e.tagName.toLowerCase(), cls: clsOf(e).slice(0, 50), title: (e as HTMLElement).getAttribute('title') || '' })).slice(0, 8);

    // 컨테이너 구조(달력 루트)
    const mainTxt = norm((document.querySelector('.contents, main') as HTMLElement)?.innerText || '').slice(0, 200);
    const rootCls = Array.from(document.querySelectorAll('[class*="calendar"], [class*="schedule"], [class*="week"], [class*="plan"], [class*="card"]')).slice(0, 6).map((e) => clsOf(e).slice(0, 40));

    return {
      counts: { button: document.querySelectorAll('button').length, a: document.querySelectorAll('a').length, input: document.querySelectorAll('input').length,
        visOffsetBtns: Array.from(document.querySelectorAll('button')).filter(visOffset).length, visRectBtns: Array.from(document.querySelectorAll('button')).filter(visRect).length },
      interactive, viewToggle, dateNav, rootCls, mainTxtHead: mainTxt,
    };
  }).catch((e) => ({ error: String(e) }));

  fin(out);

  function fin(o: Record<string, unknown>) {
    if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
    fs.writeFileSync(path.join('analysis', '코스관리_작업계획_달력.json'), JSON.stringify(o, null, 2));
    console.log('\n══ 작업 계획 달력 프로브 ══');
    console.log(JSON.stringify(o, null, 1).slice(0, 3000));
    console.log('[out] analysis/코스관리_작업계획_달력.json');
  }
});

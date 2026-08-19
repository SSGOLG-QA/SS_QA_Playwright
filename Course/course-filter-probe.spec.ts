import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  지도 화면 필터(vue-select) 미노출 진단 프로브 — EQMON-FILTER/FCMON-FILTER 공통 SKIP 규명.
//  실행: npm run course:auth 후 npm run course:filter-probe
//  장비 관제(첫 지도 화면)에서 필터 영역 DOM을 시간대별(2s/6s/12s)로 덤프 →
//    ① .vs__dropdown-toggle 셀렉터가 맞는지 ② 늦게 렌더되는지 ③ 조건부(데이터/토글)인지 판별.
//  산출: analysis/_filter-probe.json + 콘솔 요약. 비파괴(스캔만).
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

test('지도 필터(vue-select) 미노출 진단(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin = await openCourseAdmin(page, context);
  const out: Record<string, unknown> = { ts: new Date().toISOString().slice(0, 19).replace('T', ' ') };

  const finish = () => {
    if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
    fs.writeFileSync(path.join('analysis', '_filter-probe.json'), JSON.stringify(out, null, 2));
    console.log('\n══ 필터 프로브 요약 ══');
    for (const k of Object.keys(out)) if (/^snap/.test(k)) { const s = out[k] as Record<string, unknown>; console.log(`[${k}] url=${s.url} · vs__toggle ${s.vsToggle} · vs__any ${s.vsAny} · v-select ${s.vSelect} · native select ${s.nativeSelect} · loading ${s.loading} · len ${s.contentLen}`); }
    console.log('[out] analysis/_filter-probe.json');
  };

  // 시설 관제로 재조준(장비 관제는 이미 진단=필터3 확인). 시설 관제 필터가 별개 케이스인지 규명.
  if (!(await gotoCourseMenu(admin, '시설 관리', '시설 관제').then(() => true).catch(() => false))) {
    out.error = '시설 관제 진입 실패(세션 만료 추정)'; finish(); return;
  }
  out.entered = true; out.target = '시설 관제(/facility/monitor)';

  const scan = () => admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : '');
    const scope = document.querySelector('.contents, main') || document.body;
    const dump = (sel: string, n = 20) => Array.from(scope.querySelectorAll(sel)).slice(0, n).map((e) => ({ tag: e.tagName.toLowerCase(), cls: clsOf(e).slice(0, 90), vis: vis(e), txt: norm((e as HTMLElement).innerText || e.textContent).slice(0, 40) }));
    return {
      url: location.pathname,
      vsToggle: scope.querySelectorAll('.vs__dropdown-toggle').length,
      vsAny: scope.querySelectorAll('[class*="vs__"]').length,
      vSelect: scope.querySelectorAll('.v-select, [class*="v-select"]').length,
      nativeSelect: scope.querySelectorAll('select').length,
      loading: /Loading/i.test(scope.textContent || ''),
      contentLen: norm(scope.textContent).length,
      // 후보 셀렉터 전수 덤프(실제 필터가 어떤 클래스인지)
      selectish: dump('[class*="select"], [class*="dropdown"], [class*="filter"], [class*="combo"], [class*="picker"]', 30),
      vsSelected: dump('.vs__selected, [class*="vs__selected"], [class*="selected"]', 12),
      // 필터로 추정되는 라벨/텍스트(코스·홀·구역·유형)
      filterLabels: [...new Set(Array.from(scope.querySelectorAll('label, [class*="label"], [class*="title"], span, button')).filter(vis).map((e) => norm((e as HTMLElement).innerText)).filter((t) => /코스|홀|구역|유형|전체|필터/.test(t) && t.length < 20))].slice(0, 25),
      // 지도 상단/좌측 컨트롤 영역 컨테이너 힌트
      controlBoxes: dump('[class*="control"], [class*="toolbar"], [class*="top"], [class*="header"], [class*="side"], [class*="panel"]', 15),
    };
  }).catch((e) => ({ ERROR: String(e).slice(0, 150) }));

  // 진입 직후 지도 렌더 대기
  await admin.locator('.contents .leaflet-container, main .leaflet-container').first().waitFor({ state: 'visible', timeout: 16_000 }).catch(() => {});
  await killAlarms(admin);

  // 시간대별 스냅샷(늦은 렌더 검출)
  await admin.waitForTimeout(2_000); out.snap_2s = await scan();
  await admin.waitForTimeout(4_000); out.snap_6s = await scan();   // 누적 6s
  await admin.waitForTimeout(6_000); out.snap_12s = await scan();  // 누적 12s

  // 최종: 전체 페이지에서 vue-select 계열 원본 HTML 샘플(스코프 밖 포함)
  out.fullPageVsToggle = await admin.evaluate(() => document.querySelectorAll('.vs__dropdown-toggle').length).catch(() => -1);
  out.filterAreaHTML = await admin.evaluate(() => {
    const scope = document.querySelector('.contents, main') || document.body;
    // vue-select 후보/필터 컨테이너 첫 요소의 부모 영역 HTML(구조 파악)
    const cand = scope.querySelector('[class*="vs__"], [class*="v-select"], select, [class*="filter"]');
    const box = cand ? (cand.closest('[class*="control"], [class*="toolbar"], [class*="top"], [class*="header"], [class*="panel"], [class*="side"]') || cand.parentElement?.parentElement || cand.parentElement) : null;
    return box ? (box as HTMLElement).outerHTML.replace(/\s+/g, ' ').slice(0, 2500) : '(필터 후보 요소 미검출)';
  }).catch(() => '(HTML 덤프 실패)');

  finish();
});

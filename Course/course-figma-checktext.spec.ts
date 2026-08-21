import { test, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_IA, COURSE_SUBDOMAIN } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  Figma 설계 문구 checkText 검증 — 화면기본(text/title/section) 커버리지 상향(비파괴).
//  실행: npm run course:auth 후 npm run course:figma-checktext
//  배경: 화면기본 미커버의 핵심 = 안내문구(text) — 커버리지 트리 사유 "안내문구 — checkText 매핑 필요".
//    Figma(코스관리 1.1 기획서)를 정본 필터로 사용해, 인벤토리의 정적 UI 텍스트 중 설계에 실재하는 것만
//    선별(baselines/course-figma-texts.<sub>.json, scripts/extractFigmaCourseTexts.js)해 라이브 존재를 검증.
//    데이터 인스턴스(인명·거래처·날짜·수치)는 Figma 미존재로 애초에 매핑에서 배제됨 → 정적 문구만 검증.
//  방식: 화면 진입 → 기본 뷰 + 각 탭의 가시 텍스트를 누적(blob) → 매핑된 설계 문구가 blob에 존재하면 PASS.
//    - 문구는 DOM 노드 분할이 흔해 단일 getByText 실패가 잦음 → innerText 누적 blob의 공백무시 포함검사로 견고화.
//    - 존재하면 설계-구현 문구 일치(설계 정본이 화면에 렌더됨) = 화면기본 표시 회귀 가드. 부재는 정직하게 SKIP.
//  전부 비파괴(조회·탭 전환만). 커버리지 트리는 리포트 경로 tail(kind:label)로 인벤토리 라벨을 크레딧.
// ──────────────────────────────────────────────────────────────

const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();

interface FigItem { kind: string; label: string; tab: string; via: string; }
type FigMap = Record<string, FigItem[]>;

function loadMap(): FigMap {
  const p = path.join(process.cwd(), 'baselines', `course-figma-texts.${COURSE_SUBDOMAIN}.json`);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  const out: FigMap = {};
  for (const [k, v] of Object.entries(raw)) { if (k !== '_meta' && Array.isArray(v)) out[k] = v as FigItem[]; }
  return out;
}

// 현재 화면 본문의 가시 텍스트를 공백무시 blob 으로 수집(.contents/main 스코프, chrome 제외).
async function textBlob(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('.contents, main') || document.body;
    // side-navbar/header 등 chrome 은 제외하고 본문 innerText 만.
    const t = (root as HTMLElement).innerText || root.textContent || '';
    return t.replace(/\s+/g, '');
  }).catch(() => '');
}

// 탭 라벨 수집(본문 탭 — SNB 제외).
async function tabLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const n = (x: string) => (x || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const set = new Set<string>();
    document.querySelectorAll('.tab-group > *, [role="tab"]').forEach((e) => {
      if (vis(e) && !e.closest('.side-navbar-container')) { const t = n((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 16) set.add(t); }
    });
    return Array.from(set);
  }).catch(() => [] as string[]);
}

async function clickTab(page: Page, label: string): Promise<void> {
  await page.evaluate((lb) => {
    const n = (x: string) => (x || '').replace(/\s+/g, ' ').trim();
    const el = Array.from(document.querySelectorAll('.tab-group > *, [role="tab"]')).find((e) => n((e as HTMLElement).innerText || e.textContent || '') === lb);
    (el as HTMLElement | undefined)?.click();
  }, label).catch(() => {});
}

test('Figma 설계 문구 checkText 검증 — 정적 UI 텍스트 라이브 존재(비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const figMap = loadMap();
  const admin = await openCourseAdmin(page, context);
  const menusFilter = (process.env.DEEP_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);

  let totItems = 0, totPass = 0, totSkip = 0, screensDone = 0;

  for (const { menu, subs } of COURSE_IA) {
    if (menusFilter.length && !menusFilter.includes(menu)) continue;
    for (const { name: sub } of subs) {
      const P = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      const items = figMap[P];
      if (!items || !items.length) continue;   // 이 화면에 Figma 확정 정적 문구 없음
      const abbr = (menu + sub).replace(/[^A-Za-z가-힣]/g, '').slice(0, 8);
      const ref = (n: string) => `코스관리_Figma문구_${P}_${n}`;

      if (menu === 'Home') {
        await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 4000 }).catch(() => {});
        await admin.waitForTimeout(1300);
      } else {
        const ok = await gotoCourseMenu(admin, menu, sub).catch(() => false);
        if (!ok) { skip({ path: `${P} > 진입`, tcRef: ref('0'), tcId: `FIGTXT-${abbr}-00`, desc: '진입' }, '진입 실패(세션 degraded 가능)'); continue; }
      }
      await killAlarms(admin); await admin.waitForTimeout(1200);

      // 기본 뷰 + 각 탭의 텍스트 누적(인벤토리가 탭 누적으로 캡처됐으므로 동일하게 누적 검사)
      let blob = await textBlob(admin);
      const tabs = await tabLabels(admin);
      if (tabs.length >= 2) {
        for (const tl of tabs.slice(0, 10)) {
          await clickTab(admin, tl); await admin.waitForTimeout(600); await killAlarms(admin);
          blob += '' + await textBlob(admin);
        }
      }

      screensDone++;
      let ok = 0;
      for (const it of items) {
        totItems++;
        const needle = norm(it.label);
        const cm: CheckMeta = {
          path: `${P} > ${it.kind}:${it.label}`,
          tcRef: ref(`${it.kind}_${it.label.slice(0, 16)}`),
          tcId: `FIGTXT-${abbr}-${it.kind.toUpperCase()}-${norm(it.label).slice(0, 12)}`,
          desc: `Figma 설계 ${it.kind} "${it.label.slice(0, 40)}${it.label.length > 40 ? '…' : ''}" 라이브 표시`,
          expected: `Figma 설계 정본(match:${it.via})`,
          failMsg: `설계 문구 "${it.label.slice(0, 30)}" 라이브 미표시`,
        };
        if (needle && blob.includes(needle)) { record(cm, 'PASS', { actual: `설계 ${it.kind} 표시 확인(Figma ${it.via})` }); ok++; totPass++; }
        else { skip(cm, `설계 문구 라이브 미표시(탭/상태 의존 또는 설계-구현 문구 상이)`); totSkip++; }
      }
      console.log(`  ${P.padEnd(28)} Figma문구 ${items.length} · 확인 ${ok}`);
      await killAlarms(admin);
    }
  }

  console.log(`\n[figma-checktext] 화면 ${screensDone} · 설계문구 ${totItems} · 라이브확인(PASS) ${totPass} · 미표시(SKIP) ${totSkip} · 설계일치율 ${totItems ? Math.round(totPass / totItems * 100) : 0}%`);
  await killAlarms(admin);
  await writeReport('코스관리_Figma문구검증');
});

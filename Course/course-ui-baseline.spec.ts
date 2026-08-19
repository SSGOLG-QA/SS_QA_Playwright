/**
 * 코스관리 UI 구조 베이스라인 드리프트 검출
 *
 *  목적: COURSE_IA 전 화면의 구조적 chrome(컬럼헤더·버튼·탭·안내문구)을 committed baseline과
 *    대조해 라벨/컬럼/구조 변경을 자동 diff. 반복되는 수동 드리프트 추적을 단일 스캔으로 대체.
 *    (Admin/ui-baseline.spec.ts의 코스관리 이식판.)
 *
 *  모드(env UI_BASELINE):
 *    - capture : 라이브 스캔 → baselines/course-ui-structure.<sub>.json 생성/갱신(리뷰 후 커밋).
 *    - diff(기본) : baseline 로드 → 라이브 스캔 대조.
 *        · 제거된 컬럼/버튼/탭/안내문구 → check FAIL (회귀 신호)
 *        · 추가된 항목 → diff() 기록(기획-구현 차이 시트)
 *      baseline 부재 시 최초 실행은 자동 capture(비교 없음).
 *
 *  실행(세션 1런 제약 — course:auth 직후):
 *    캡처:  $env:UI_BASELINE="capture"; npm run course:ui-baseline
 *    검출:  npm run course:ui-baseline
 *  산출: reports/코스관리_UI드리프트_report_*.xlsx + reports/course-ui-drift_<ts>.md
 *
 *  비파괴: 메뉴 진입·DOM 스캔만. 클릭/저장/삭제 없음.
 */
import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, settle, killAlarms, COURSE_IA, COURSE_SUBDOMAIN } from '../lib/course/courseHelpers';
import { check, skip, diff, resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport } from '../lib/reporter';
import * as fs from 'fs';
import * as path from 'path';

const SUB = COURSE_SUBDOMAIN;
const MODE = (process.env.UI_BASELINE || 'diff').toLowerCase();  // capture | diff
const BASELINE_DIR = 'baselines';
const BASELINE_FILE = path.join(BASELINE_DIR, `course-ui-structure.${SUB}.json`);

interface ScreenSnap { url: string; headers: string[]; buttons: string[]; tabs: string[]; guide: string[]; }
type Baseline = Record<string, ScreenSnap>;

const FIELDS: { key: keyof ScreenSnap; label: string }[] = [
  { key: 'headers', label: '컬럼헤더' },
  { key: 'buttons', label: '버튼' },
  { key: 'tabs', label: '탭' },
  { key: 'guide', label: '안내문구' },
];

const scan = (admin: Page): Promise<ScreenSnap> => admin.evaluate(() => {
  const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
  const txt = (el: Element) => ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
  const uniq = (a: string[]) => [...new Set(a)];
  const scope = document.querySelector('.contents, main') || document.body;
  const headers = uniq(Array.from(scope.querySelectorAll('th, [role=columnheader], thead td'))
    .filter(vis).map(txt).filter(Boolean)).slice(0, 60);
  const buttons = uniq(Array.from(scope.querySelectorAll('button, [role=button]'))
    .filter(vis).map(txt).filter((t) => !!t && t.length <= 24 && t !== '이용가이드')).slice(0, 60);
  const tabs = uniq(Array.from(document.querySelectorAll('.sub-navigation-bar li, .tab, [class*="tab"] li, [role=tab]'))
    .filter(vis).map(txt).filter(Boolean)).slice(0, 24);
  const guide = uniq(Array.from(scope.querySelectorAll(
    '[class*="info"], [class*="guide"], [class*="desc"], [class*="notice"], [class*="comment"], .sub-title, .page-title'))
    .filter(vis).map(txt).filter((t) => t.length >= 10 && t.length <= 400)).slice(0, 12);
  return { url: location.pathname, headers, buttons, tabs, guide };
});

test('코스관리 UI 구조 베이스라인 드리프트 검출', async ({ page, context }) => {
  test.setTimeout(20 * 60_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  // ── 전 화면 라이브 스캔 ──
  const live: Baseline = {};
  for (const { menu, subs } of COURSE_IA) {
    if (menu === 'Home') continue;
    for (const sub of subs) {
      const key = `${menu} > ${sub.name}`;
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) ok = await gotoCourseMenu(admin, menu, sub.name).then(() => true).catch(() => false);
      if (!ok) {
        if (MODE !== 'capture') skip({ path: key, tcRef: `UI_DRIFT_${sub.route}`, tcId: `DRIFT-${sub.route}`, desc: '메뉴 진입' }, '메뉴 진입 불가(미구현 또는 진입 실패)');
        continue;
      }
      await settle(admin, 1500); await admin.waitForTimeout(700); await killAlarms(admin);
      live[key] = await scan(admin);
    }
  }

  // ── capture 모드 ──
  if (MODE === 'capture') {
    if (!fs.existsSync(BASELINE_DIR)) fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(live, null, 2));
    console.log(`[baseline] ${Object.keys(live).length}개 화면 저장 → ${BASELINE_FILE}`);
    await writeReport('코스관리_UI드리프트'); return;
  }

  // ── diff 모드: baseline 부재 시 최초 캡처 ──
  if (!fs.existsSync(BASELINE_FILE)) {
    if (!fs.existsSync(BASELINE_DIR)) fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(live, null, 2));
    console.log(`[baseline] 기존 baseline 없음 → 최초 스냅샷 저장(비교 생략) → ${BASELINE_FILE}`);
    await writeReport('코스관리_UI드리프트'); return;
  }

  const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const mdLines: string[] = [`# 코스관리 UI 구조 드리프트 (${SUB})`, ''];
  let removedTotal = 0, addedTotal = 0;

  for (const key of Object.keys(baseline)) {
    const b = baseline[key]; const c = live[key];
    if (!c) {
      await check(admin, { path: key, tcRef: `UI_DRIFT_${key}`, tcId: 'DRIFT', desc: '화면 존재(baseline 대비)', failMsg: '화면 소실' },
        async () => { throw new Error('baseline에 존재하나 이번 스캔서 진입 실패(화면/메뉴 소실 가능)'); });
      mdLines.push(`## 🔴 ${key} — 화면 소실(진입 실패)`, ''); removedTotal++; continue;
    }
    const screenMd: string[] = [];
    for (const { key: f, label } of FIELDS) {
      const bv = b[f] as string[], cv = c[f] as string[];
      const removed = bv.filter((x) => !cv.includes(x));
      const added = cv.filter((x) => !bv.includes(x));
      if (removed.length) {
        removedTotal += removed.length;
        await check(admin, { path: `${key} > ${label}`, tcRef: `UI_DRIFT_${key}`, tcId: `DRIFT-${f}`, desc: `${label} 제거 없음(baseline 대비)`, failMsg: '구조 제거' },
          async () => { throw new Error(`${label} 제거됨: ${removed.join(' · ')}`); });
        screenMd.push(`  - 🔴 [제거] ${label}: ${removed.join(' · ')}`);
      }
      if (added.length) {
        addedTotal += added.length;
        diff(key, `(baseline ${label} 없음)`, added.join(' · '), `UI_DRIFT_${key}`, `${label} 신규 추가 — 드리프트`);
        screenMd.push(`  - 🟡 [추가] ${label}: ${added.join(' · ')}`);
      }
    }
    if (screenMd.length) mdLines.push(`## ${key}`, ...screenMd, '');
  }

  const newScreens = Object.keys(live).filter((k) => !(k in baseline));
  newScreens.forEach((k) => {
    diff(k, '(baseline 없음)', '신규 화면 스캔됨', `UI_DRIFT_${k}`, '신규 화면 — baseline 갱신 필요');
    mdLines.push(`## 🟢 ${k} — 신규 화면(baseline 미등록)`, '');
  });

  console.log(`\n[UI 드리프트] 제거 ${removedTotal} · 추가 ${addedTotal} · 신규화면 ${newScreens.length}`);
  mdLines.unshift(`> 제거 ${removedTotal}(회귀 신호) · 추가 ${addedTotal} · 신규화면 ${newScreens.length}`, '');
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', `course-ui-drift_${ts}.md`), mdLines.join('\n'));
  await writeReport('코스관리_UI드리프트');
});

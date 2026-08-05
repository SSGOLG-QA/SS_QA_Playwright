/**
 * UI 구조 베이스라인 드리프트 검출 (P-DRIFT)
 *
 *  목적: 전 메뉴의 구조적 chrome(컬럼헤더·버튼 라벨·탭·안내문구)을 committed baseline과
 *    대조해 라벨/컬럼/구조 변경을 자동 diff. 반복되는 수동 드리프트 추적
 *    (all-suite → FAIL 산발 → 프로브 → AS-IS 반영)을 단일 스캔으로 대체한다.
 *
 *  기존 driftDiff.ts(리포트 간 회귀 비교)와의 차이:
 *    - driftDiff = 두 전체테스트 리포트의 FAIL 증감 비교(기대값이 구값일 때만 드리프트가 FAIL로 노출).
 *    - 본 스펙  = 라이브 구조 vs 구조 baseline 직접 대조 → 드리프트를 '추가/제거' 델타로 깔끔히 산출.
 *      기대값을 아직 안 고쳤어도 컬럼/버튼이 사라지면 즉시 잡힌다.
 *
 *  모드(env UI_BASELINE):
 *    - capture : 라이브 스캔 → baselines/ui-structure.<sub>.json 생성/갱신(리뷰 후 커밋).
 *    - diff(기본) : baseline 로드 → 라이브 스캔 대조.
 *        · 제거된 컬럼/버튼/탭/안내문구 → check FAIL (회귀 신호)
 *        · 추가된 항목 → diff() 기록(기획-구현 차이 시트)
 *      baseline 부재 시 최초 실행은 자동 capture(비교 없음).
 *
 *  실행:
 *    캡처:  $env:UI_BASELINE="capture"; npx playwright test --project=admin-chromium Admin/ui-baseline.spec.ts --no-deps
 *    검출:  npx playwright test --project=admin-chromium Admin/ui-baseline.spec.ts --no-deps
 *  산출: reports/ui-baseline_report_*.xlsx + reports/ui-drift_<ts>.md
 *
 *  비파괴: 메뉴 진입·DOM 스캔만. 클릭/저장/삭제 없음.
 */
import { test } from '../lib/fixtures';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { MENU_LIST } from '../lib/langCheck';
import { check, skip, diff, resetResults, resetNoTC, resetDiff, writeReport } from '../lib/reporter';
import * as fs from 'fs';
import * as path from 'path';

const SUB = process.env.SUBDOMAIN || 'td17';
const MODE = (process.env.UI_BASELINE || 'diff').toLowerCase();  // capture | diff
const BASELINE_DIR = 'baselines';
const BASELINE_FILE = path.join(BASELINE_DIR, `ui-structure.${SUB}.json`);

interface ScreenSnap {
  url: string;
  headers: string[];
  buttons: string[];
  tabs: string[];
  guide: string[];
}
type Baseline = Record<string, ScreenSnap>;  // key = "대메뉴 > 소메뉴"

// diff 대상 필드 정의(라벨 표시명 포함)
const FIELDS: { key: keyof ScreenSnap; label: string }[] = [
  { key: 'headers', label: '컬럼헤더' },
  { key: 'buttons', label: '버튼' },
  { key: 'tabs', label: '탭' },
  { key: 'guide', label: '안내문구' },
];

test('UI 구조 베이스라인 드리프트 검출', async ({ admin }) => {
  test.setTimeout(20 * 60_000);
  resetResults(); resetNoTC(); resetDiff();

  const scan = (): Promise<ScreenSnap> => admin.evaluate(() => {
    const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
    const txt = (el: Element) => ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    const uniq = (a: string[]) => [...new Set(a)];
    const headers = uniq(Array.from(document.querySelectorAll('th, [role=columnheader], .list-table-group thead td'))
      .filter(vis).map(txt).filter(Boolean));
    const buttons = uniq(Array.from(document.querySelectorAll('button, [role=button], a[class*=btn]'))
      .filter(vis).map(txt).filter(t => !!t && t.length <= 24)).slice(0, 60);
    const tabs = uniq(Array.from(document.querySelectorAll('.tab, [class*="tab"] li, [role=tab]'))
      .filter(vis).map(txt).filter(Boolean)).slice(0, 24);
    const guide = uniq(Array.from(document.querySelectorAll(
      '.contents-info, .info-box, .guide-box, .desc, .comment-box, .txt-info, .page-info, .sub-title'))
      .filter(vis).map(txt).filter(t => t.length >= 10 && t.length <= 400)).slice(0, 12);
    return { url: location.pathname, headers, buttons, tabs, guide };
  });

  // ── 전 메뉴 라이브 스캔 ────────────────────────────────────────
  const live: Baseline = {};
  for (const { menu, subs } of MENU_LIST) {
    for (const sub of subs) {
      const key = `${menu} > ${sub}`;
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) ok = await navigateMenu(admin, menu, sub).catch(() => false);
      if (!ok) {
        // 진입 실패 — baseline에 있으면 회귀 신호, 없으면 미구현으로 skip
        if (MODE !== 'capture') {
          skip({ path: key, tcRef: `UI_DRIFT_${sub}`, tcId: `DRIFT-${sub}`, desc: '메뉴 진입' },
            '메뉴 진입 불가(미구현 또는 진입 실패)');
        }
        continue;
      }
      await settle(admin, 1800);
      live[key] = await scan();
    }
  }

  // ── capture 모드: baseline 저장 후 종료 ────────────────────────
  if (MODE === 'capture') {
    if (!fs.existsSync(BASELINE_DIR)) fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(live, null, 2));
    console.log(`[baseline] ${Object.keys(live).length}개 화면 저장 → ${BASELINE_FILE}`);
    await writeReport('ui-baseline');
    return;
  }

  // ── diff 모드: baseline 대조 ──────────────────────────────────
  if (!fs.existsSync(BASELINE_FILE)) {
    if (!fs.existsSync(BASELINE_DIR)) fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(live, null, 2));
    console.log(`[baseline] 기존 baseline 없음 → 최초 스냅샷 저장(비교 생략) → ${BASELINE_FILE}`);
    await writeReport('ui-baseline');
    return;
  }

  const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const mdLines: string[] = [`# UI 구조 드리프트 (${SUB})`, ''];
  let removedTotal = 0, addedTotal = 0;

  for (const key of Object.keys(baseline)) {
    const b = baseline[key];
    const c = live[key];
    if (!c) {
      // baseline엔 있으나 이번 스캔서 미진입 — 화면 소실 가능(회귀)
      await check(admin, { path: key, tcRef: `UI_DRIFT_${key}`, tcId: `DRIFT`, desc: '화면 존재(baseline 대비)', failMsg: '화면 소실' },
        async () => { throw new Error('baseline에 존재하나 이번 스캔서 진입 실패(화면/메뉴 소실 가능)'); });
      mdLines.push(`## 🔴 ${key} — 화면 소실(진입 실패)`, '');
      removedTotal++;
      continue;
    }
    const screenMd: string[] = [];
    for (const { key: f, label } of FIELDS) {
      const bv = b[f] as string[], cv = c[f] as string[];
      const removed = bv.filter(x => !cv.includes(x));
      const added = cv.filter(x => !bv.includes(x));
      if (removed.length) {
        removedTotal += removed.length;
        await check(admin,
          { path: `${key} > ${label}`, tcRef: `UI_DRIFT_${key}`, tcId: `DRIFT-${f}`, desc: `${label} 제거 없음(baseline 대비)`, failMsg: '구조 제거' },
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

  // 신규 화면(baseline에 없던 key)
  const newScreens = Object.keys(live).filter(k => !(k in baseline));
  newScreens.forEach(k => {
    diff(k, '(baseline 없음)', '신규 화면 스캔됨', `UI_DRIFT_${k}`, '신규 화면 — baseline 갱신 필요');
    mdLines.push(`## 🟢 ${k} — 신규 화면(baseline 미등록)`, '');
  });

  console.log(`\n[UI 드리프트] 제거 ${removedTotal} · 추가 ${addedTotal} · 신규화면 ${newScreens.length}`);
  mdLines.unshift(`> 제거 ${removedTotal}(회귀 신호) · 추가 ${addedTotal} · 신규화면 ${newScreens.length}`, '');

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  const outPath = path.join('reports', `ui-drift_${ts}.md`);
  fs.writeFileSync(outPath, mdLines.join('\n'));
  console.log(`[report] ${outPath}`);

  await writeReport('ui-baseline');
});

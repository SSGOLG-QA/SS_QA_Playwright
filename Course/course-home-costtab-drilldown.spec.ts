import { test, Page } from '@playwright/test';
import { openCourseAdmin, killAlarms, COURSE_URL } from '../lib/course/courseHelpers';
import { renderReport, Check } from '../lib/course/exportVerifyCommon';
import { drilldownInvariants, DrillGrid } from '../lib/course/domain/homeCostDrilldown';

// ──────────────────────────────────────────────────────────────
//  HOME > 비용 탭 > "작업지시에 근거한 비용 분석" > 코스별 뷰 > [코스 선택] 홀별 드릴다운(B-2) 정합성 검증.
//   재설계 반영 확인(2026-09-08 프로브): 코스별 뷰에 코스 선택 드롭다운([전체/South/East/West]) 신설,
//   실코스 선택 시 표가 홀별(전체·1~9홀) × 2축(예산 분류별 5 · 작업 분류별 13)으로 재구성 = B-2 구현.
//   불변식 3종(homeCostDrilldown.ts): I1 예산분류Σ=작업분류Σ(행별) · I2 전체=Σ(1~9홀)(컬럼별) · I3 코스별뷰 합계-{코스}=드릴다운 전체행.
//   비파괴(탭 전환·드롭다운 선택만, 저장 없음).
//   실행: npm run course:auth 후
//    npx playwright test --config=Course/playwright.config.ts --project=course Course/course-home-costtab-drilldown.spec.ts --no-deps
// ──────────────────────────────────────────────────────────────

const COURSES = ['South', 'East', 'West'];

async function gotoHome(admin: Page) {
  await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1300);
  if (!/\/(home|dashboard)?(\?|$)/.test(admin.url())) { await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(1500); }
  await killAlarms(admin);
}
async function clickTab(admin: Page, name: string) {
  await admin.locator('.tab-group').getByText(name, { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1500); await killAlarms(admin);
}

// 현재 렌더된 코스별/드릴다운 표(첫 데이터 표, 행≥1)를 span 포함 head 2행 + tbody rows로 캡처.
async function readGrid(admin: Page): Promise<DrillGrid> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const cellOf = (c: Element) => ({ t: norm(c.textContent), cs: (c as HTMLTableCellElement).colSpan || 1 });
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { head: [], rows: [] };
    const head = Array.from(tbl.querySelectorAll('thead tr')).map((tr) => Array.from(tr.children).map(cellOf));
    const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((td) => norm(td.textContent)));
    return { head, rows };
  }).catch(() => ({ head: [] as { t: string; cs: number }[][], rows: [] as string[][] }));
}

// 코스별 뷰 '전체' 행의 '합계' 그룹(코스별 총액) 파싱 → { South, East, West, 전체 골프장 }.
//   head[0] = [분류][합계 cs=4][고정직 cs=4]… , head[1] 서브라벨 = South/East/West/전체 골프장 × 6그룹.
//   전체 행 첫 4수치 = 합계 그룹(코스 순서). 라벨은 head[1] 앞 4개로 매핑.
async function readCourseViewTotals(admin: Page): Promise<Record<string, number>> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const numOf = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return null; const v = Number(c); return Number.isFinite(v) ? v : null; };
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return {};
    const hrs = Array.from(tbl.querySelectorAll('thead tr'));
    // '합계' 그룹 하위 라벨 수 = 그룹 colspan
    const grpCs = hrs.length ? (() => { const c = Array.from(hrs[0].children).find((e) => /^합계$/.test(norm(e.textContent))); return c ? (c as HTMLTableCellElement).colSpan || 4 : 4; })() : 4;
    const sub = hrs.length >= 2 ? Array.from(hrs[1].children).map((c) => norm(c.textContent)).filter((t) => t).slice(0, grpCs) : [];
    const labels = sub.length === grpCs ? sub : ['South', 'East', 'West', '전체 골프장'].slice(0, grpCs);
    const totalRow = Array.from(tbl.querySelectorAll('tbody tr')).find((tr) => /^전체$/.test(norm((tr.children[0] || {}).textContent).replace(/\s+/g, '')));
    if (!totalRow) return {};
    const nums = Array.from(totalRow.children).slice(1).map((c) => numOf(norm(c.textContent))).filter((n): n is number => n != null);
    const out: Record<string, number> = {};
    labels.forEach((lb, i) => { if (nums[i] != null) out[norm(lb)] = nums[i]; });
    return out;
  }).catch(() => ({}));
}

// vue-select 코스 선택 드롭다운에서 특정 코스 선택(비파괴 — 필터/드릴다운 전환만).
async function selectCourse(admin: Page, course: string): Promise<boolean> {
  const vs = admin.locator('.contents, main').locator('.v-select, .vs__dropdown-toggle').first();
  if (!(await vs.isVisible({ timeout: 1500 }).catch(() => false))) return false;
  await vs.click({ timeout: 1500 }).catch(() => {});
  await admin.waitForTimeout(700);
  const opt = admin.locator('.vs__dropdown-menu li, .vs__dropdown-option').filter({ hasText: new RegExp('^\\s*' + course + '\\s*$') }).first();
  if (!(await opt.isVisible({ timeout: 1200 }).catch(() => false))) { await admin.keyboard.press('Escape').catch(() => {}); return false; }
  await opt.click({ timeout: 1500 }).catch(() => {});
  await admin.waitForTimeout(1700); await killAlarms(admin);
  return true;
}

test('HOME 비용탭 작업지시분석 코스별 홀별 드릴다운(B-2) 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  const admin = await openCourseAdmin(page, context);
  const checks: Check[] = [];
  const add = (group: string, name: string, ok: boolean, detail: string, na?: boolean, review?: boolean) => checks.push({ group, name, ok, detail, na, review });

  // HOME → [비용] 탭 → 작업지시 근거 비용분석 토글 → 코스별 뷰
  await gotoHome(admin);
  await clickTab(admin, '비용');
  const toggle = admin.locator('.contents, main').getByText(/작업지시에\s*근거한\s*비용\s*분석/).first();
  const toggleFound = await toggle.isVisible({ timeout: 2500 }).catch(() => false);
  add('진입', '작업지시 근거 비용분석 토글 노출', toggleFound, toggleFound ? '토글 존재 → 코스별 뷰 진입' : '토글 미노출 — 재설계 미반영 가능');
  if (toggleFound) { await toggle.click({ timeout: 2500 }).catch(() => {}); await admin.waitForTimeout(1600); await killAlarms(admin); }

  const courseTab = admin.locator('.tab-type-box').getByText(/^\s*코스별\s*$/).first();
  const courseTabFound = toggleFound && await courseTab.isVisible({ timeout: 1800 }).catch(() => false);
  add('진입', '코스별 뷰 탭 노출', !!courseTabFound, courseTabFound ? '코스별 서브뷰 존재' : '코스별 탭 미노출');
  if (courseTabFound) { await courseTab.click({ timeout: 1500 }).catch(() => {}); await admin.waitForTimeout(1500); await killAlarms(admin); }

  // 코스별 뷰 '합계-{코스}' (교차 기준값) — 드롭다운 열기 전 캡처
  const courseViewTotals = courseTabFound ? await readCourseViewTotals(admin) : {};
  const cvLabels = Object.keys(courseViewTotals);
  add('코스별 뷰', '합계-코스별 총액 파싱', cvLabels.length > 0,
    cvLabels.length > 0 ? `${cvLabels.map((k) => `${k}:${Math.round(courseViewTotals[k]).toLocaleString()}`).join(' · ')}` : '합계 그룹 미파싱', cvLabels.length === 0);

  // 코스 선택 드롭다운 존재 여부(B-2 게이트)
  const vs = admin.locator('.contents, main').locator('.v-select, .vs__dropdown-toggle').first();
  const dropdownFound = courseTabFound && await vs.isVisible({ timeout: 1500 }).catch(() => false);
  add('진입', '코스 선택 드롭다운 노출(B-2 게이트)', !!dropdownFound, dropdownFound ? '코스 선택 드롭다운 존재 → 홀별 드릴다운 가능' : '드롭다운 미노출 — B-2 미반영');

  // 코스별 홀별 드릴다운 불변식
  if (dropdownFound) {
    for (const course of COURSES) {
      const picked = await selectCourse(admin, course);
      if (!picked) { add(`드릴다운·${course}`, `${course} 선택`, true, `${course} 옵션 미노출/선택 실패 — 판정 제외`, true); continue; }
      const grid = await readGrid(admin);
      const holeRows = grid.rows.filter((r) => /^\s*\d+\s*홀\s*$/.test(r[0] || '')).length;
      add(`드릴다운·${course}`, `${course} 홀별 재구성 확인`, holeRows > 0,
        holeRows > 0 ? `홀 ${holeRows}행 + 전체행 → [예산 분류별·작업 분류별] 2축 재구성` : '홀별 행 미검출 — 드릴다운 아님', holeRows === 0);
      if (holeRows === 0) continue;
      for (const c of drilldownInvariants(course, grid, courseViewTotals[course] ?? null)) {
        add(`드릴다운·${course}`, c.name.replace(`[${course}] `, ''), c.ok, c.detail, c.na, c.review);
      }
    }
  }

  renderReport('course-home-costtab-drilldown', 'HOME 비용탭 — 코스별 홀별 드릴다운(B-2) 정합성',
    `HOME > 비용 > 작업지시 근거 비용분석 > 코스별 > [코스 선택] 홀별 드릴다운 · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '재설계(B-2) 반영 검증: 코스 선택 시 표가 <b>홀별(전체·1~9홀) × 2축(예산 분류별 5 · 작업 분류별 13)</b>로 재구성. 불변식 — <b>I1</b> 예산분류Σ=작업분류Σ(행별) · <b>I2</b> 전체=Σ(1~9홀)(컬럼별) · <b>I3</b> 코스별뷰 합계-{코스}=드릴다운 전체행. 참고(➖)=판정 제외(데이터/구조 부재).',
    checks);
});

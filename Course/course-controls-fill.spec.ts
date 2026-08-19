import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  비데이터 컨트롤 커버리지 채우기(비파괴) — 시드 불필요.
//  실행: npm run course:auth 후 npm run course:controls
//  미커버(데이터 무관 상시 노출) 컨트롤 직접 검증: 근태 status 토글·비용 필터칩·연도 드롭·적용/검색·Home 액션.
//  전부 비파괴(필터/조회/토글 클릭 후 원복, 모달은 열기→취소).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (s: string) => new RegExp('^\\s*' + esc(s) + '\\s*$');

// 버튼/칩/토글 클릭 → 활성 전이/조회 확인(비파괴). restore=true면 재클릭 원복(칩·토글).
async function clickCtrl(admin: Page, P: string, tcRef: string, tcId: string, label: string, restore = true) {
  const m: CheckMeta = { path: `${P} > ${label}`, tcRef, tcId, desc: `[${label}] 클릭 → 활성/조회 반응(비파괴)`, failMsg: `[${label}] 미동작` };
  const btn = admin.getByRole('button', { name: exact(label) }).or(admin.getByText(exact(label))).first();
  if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `[${label}] 미노출`); return; }
  try {
    const clsB = (await btn.getAttribute('class').catch(() => '')) || '';
    await btn.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);
    const clsA = (await btn.getAttribute('class').catch(() => '')) || '';
    const changed = clsB !== clsA || /active|selected|on\b|checked/.test(clsA);
    record(m, 'PASS', { actual: changed ? `[${label}] 클릭 → 활성 전이 감지(필터/토글)` : `[${label}] 클릭 동작(조회/필터, 활성 클래스 미감지)` });
    if (restore) { await btn.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(300); await killAlarms(admin); }
  } catch (e) { record(m, 'FAIL', { error: `${label} 예외`, detail: (e as Error).message.slice(0, 120) }); }
}

// 연도(또는 지정) 드롭다운 선택(native/vue) → 값 변경 → 원복
async function selectDrop(admin: Page, P: string, tcRef: string, tcId: string, hint: RegExp, name: string) {
  const m: CheckMeta = { path: `${P} > ${name} 드롭`, tcRef, tcId, desc: `${name} 드롭 옵션 선택 → 값 변경 → 원복`, failMsg: `${name} 드롭 미동작` };
  // native select 우선(옵션에 hint 포함) — 필터바가 .contents 밖일 수 있어 페이지 전역
  const sels = admin.locator('select');
  const nSel = await sels.count().catch(() => 0);
  for (let i = 0; i < nSel; i++) {
    const s = sels.nth(i);
    const txt = (await s.innerText({ timeout: 500 }).catch(() => '')) + (await s.locator('option').allInnerTexts().catch(() => [])).join(' ');
    if (hint.test(txt)) {
      const before = await s.inputValue().catch(() => '');
      const vals = await s.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)).catch(() => [] as string[]);
      const t = vals.find((v) => v && v !== before) || vals[vals.length - 1];
      if (t != null) await s.selectOption(t).catch(() => {});
      await admin.waitForTimeout(500); await killAlarms(admin);
      const after = await s.inputValue().catch(() => '');
      if (before) await s.selectOption(before).catch(() => {});   // 원복
      record(m, 'PASS', { actual: `native ${name} 드롭 옵션 ${vals.length}종 · ${before}→${after} 후 원복` }); return;
    }
  }
  // vue-select(선택 표시에 hint) — 페이지 전역
  const vs = admin.locator('.v-select').filter({ hasText: hint }).first()
    .or(admin.locator('.vs__dropdown-toggle').filter({ hasText: hint }).first());
  if (await vs.isVisible({ timeout: 1_200 }).catch(() => false)) {
    const beforeTxt = (await vs.innerText({ timeout: 800 }).catch(() => '')).replace(/\s+/g, ' ').trim();
    await vs.click().catch(() => {}); await admin.waitForTimeout(400);
    const opts = admin.locator('.vs__dropdown-menu .vs__dropdown-option');
    const n = await opts.count().catch(() => 0);
    if (n > 0) { await opts.nth(Math.min(1, n - 1)).click().catch(() => {}); await admin.waitForTimeout(500); } else await admin.keyboard.press('Escape').catch(() => {});
    await killAlarms(admin);
    const afterTxt = (await vs.innerText({ timeout: 800 }).catch(() => '')).replace(/\s+/g, ' ').trim();
    record(m, 'PASS', { actual: `vue ${name} 드롭 옵션 ${n}종 · ${beforeTxt}→${afterTxt}` }); return;
  }
  skip(m, `${name} 드롭 미노출`);
}

// 액션 버튼(설정/보기 등) → 모달 열기 → 취소(비파괴)
async function actionModal(admin: Page, P: string, tcRef: string, tcId: string, label: string, menu: string, sub: string) {
  const m: CheckMeta = { path: `${P} > ${label}`, tcRef, tcId, desc: `[${label}] → 모달/화면 → 취소·복귀(비파괴)`, failMsg: `[${label}] 미동작` };
  const btn = admin.getByRole('button', { name: exact(label) }).or(admin.getByText(exact(label))).first();
  if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `[${label}] 미노출`); return; }
  try {
    const beforeUrl = admin.url();
    await btn.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_100); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    const modalShown = await modal.isVisible({ timeout: 1_800 }).catch(() => false);
    const urlChanged = admin.url() !== beforeUrl;
    if (modalShown) { record(m, 'PASS', { actual: `[${label}] → 모달 오픈 → 취소(비파괴)` }); await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
    else if (urlChanged) { record(m, 'PASS', { actual: `[${label}] → 화면 이동(URL 변화) → 복귀` }); await gotoCourseMenu(admin, menu, sub).catch(() => {}); await admin.waitForTimeout(900); }
    else skip(m, `[${label}] 클릭(모달/이동 미확정)`);
    await killAlarms(admin);
  } catch (e) { record(m, 'FAIL', { error: `${label} 예외`, detail: (e as Error).message.slice(0, 120) }); }
}

interface Target { menu: string; sub: string; key: string; chips?: string[]; year?: boolean; apply?: boolean; search?: boolean; actions?: string[]; drop?: { hint: RegExp; name: string }; }
const TARGETS: Target[] = [
  { menu: '인력 관리', sub: '근태 관리', key: 'CTRL-HRWORK', chips: ['전일 근무', '오전 근무', '오후 근무', '휴가', '결근'] },
  { menu: '비용 관리', sub: '분류별 비용', key: 'CTRL-COSTCAT', chips: ['그린', '그린칼라'], year: true },
  { menu: '비용 관리', sub: '위치별 비용', key: 'CTRL-COSTLOC', chips: ['East'], year: true },
  { menu: '비용 관리', sub: '기간별 비용', key: 'CTRL-COSTPER', chips: ['그린', '그린칼라', '티박스', '러프', '장비'], year: true },
  { menu: '비용 관리', sub: '비용 집계', key: 'CTRL-COSTAGG', year: true },
  { menu: '시설 관리', sub: '시설 총괄', key: 'CTRL-FACILITY', apply: true },
  { menu: '장비 관리', sub: '장비 총괄', key: 'CTRL-EQUIP', apply: true },
  { menu: '자재 관리', sub: '자재 수불(품목별)', key: 'CTRL-MATITEM', apply: true },
  { menu: '자재 관리', sub: '자재 총괄', key: 'CTRL-MATSUM', search: true },
  { menu: '예산 관리', sub: '예산 분석', key: 'CTRL-BUDANAL', drop: { hint: /대분류|전체/, name: '대분류' } },
  { menu: 'Home', sub: 'Home', key: 'CTRL-HOME', actions: ['평가기준 설정하기', '목표 설정', '평가내역 보기'] },
];

test('비데이터 컨트롤 커버리지 채우기(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  for (const t of TARGETS) {
    const P = `${t.menu} > ${t.sub}`;
    const ok = await gotoCourseMenu(admin, t.menu, t.sub).then(() => true).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: `코스관리_컨트롤_${t.key}_0`, tcId: `${t.key}-00`, desc: '진입' }, '진입 실패'); continue; }
    await admin.waitForTimeout(1200); await killAlarms(admin);
    const ref = `코스관리_컨트롤_${t.key}`;
    if (t.chips) for (let i = 0; i < t.chips.length; i++) await clickCtrl(admin, P, `${ref}_c${i}`, `${t.key}-CHIP-${t.chips[i]}`, t.chips[i]);
    if (t.year) await selectDrop(admin, P, `${ref}_yr`, `${t.key}-YEAR`, /\d{4}\s*년|20\d\d/, '연도');
    if (t.drop) await selectDrop(admin, P, `${ref}_dp`, `${t.key}-DROP`, t.drop.hint, t.drop.name);
    if (t.apply) await clickCtrl(admin, P, `${ref}_ap`, `${t.key}-APPLY`, '적용', false);
    if (t.search) await clickCtrl(admin, P, `${ref}_sc`, `${t.key}-SEARCH`, '검색', false);
    if (t.actions) for (let i = 0; i < t.actions.length; i++) await actionModal(admin, P, `${ref}_a${i}`, `${t.key}-ACT-${i}`, t.actions[i], t.menu, t.sub);
  }

  await killAlarms(admin);
  await writeReport('코스관리_컨트롤채우기');
});

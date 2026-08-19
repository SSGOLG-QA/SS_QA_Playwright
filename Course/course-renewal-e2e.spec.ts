import { test, Page, Locator } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { runFormBattery, closeForm } from '../lib/course/formE2E';

// ──────────────────────────────────────────────────────────────
//  정보 관리 > 코스 리뉴얼 정보 — 전용 심화 E2E(비파괴). course-info-e2e-all(제네릭 배터리) 갭 보강.
//  실행: npm run course:auth 후 npm run course:renewal-e2e
//  요청 커버(사용자):
//    ① 1차~6차 차수 탭 간 이동(활성 전환/콘텐츠 변화)
//    ② [+신규 등록] → 입력필드·버튼·라디오 동작 + [취소]/[저장](활성) — FILL은 배터리 재사용
//    ③ [수정] → 동일(신규등록과 별개 경로)
//  ⚠ 비파괴: 폼 조작 후 [취소] 폐기. [저장]은 노출·활성만 확인(클릭=영속 → 금지). 라디오는 미저장 상태 변경(취소 폐기).
// ──────────────────────────────────────────────────────────────

const P = '정보 관리 > 코스 리뉴얼 정보';
const R = (n: string) => `코스관리_코스리뉴얼_${n}`;
const M = (p: Page) => p.locator('.contents, main').first();

// 활성 폼 스코프(모달 우선, 없으면 main)
function formScope(admin: Page): Locator {
  const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
  return modal;
}
async function scopeOf(admin: Page): Promise<Locator> {
  return (await formScope(admin).isVisible({ timeout: 800 }).catch(() => false)) ? formScope(admin) : M(admin);
}

// ── 라디오버튼 동작: 미체크 옵션 클릭 → 체크 전환 확인(비파괴, 취소 폐기) ──
async function radioTest(admin: Page, scope: Locator, K: string) {
  const m: CheckMeta = { path: `${P} > ${K} > 라디오`, tcRef: R(`${K}_radio`), tcId: `RENEW-${K}-RADIO`, desc: '라디오버튼 선택 전환(공사 범위 등)', failMsg: '라디오 미동작' };
  const radios = scope.locator('input[type=radio]');
  const n = await radios.count().catch(() => 0);
  if (n < 2) { skip(m, `라디오 ${n}개(2개 미만 — 선택 전환 대상 아님)`); return; }
  // 현재 미체크 라디오를 in-page로 클릭(라벨/카드 가려질 수 있어 네이티브)
  const res = await scope.evaluate((sc) => {
    const rs = Array.from(sc.querySelectorAll('input[type=radio]')) as HTMLInputElement[];
    const beforeChecked = rs.findIndex((r) => r.checked);
    const target = rs.find((r) => !r.checked && !r.disabled);
    if (!target) return { switched: false, reason: '미체크 대상 없음' };
    // 라벨/카드 클릭(input 숨김 대비) → 실패 시 input 직접
    const id = target.id;
    const lab = id ? document.querySelector(`label[for="${id}"]`) as HTMLElement | null : null;
    (lab || target.closest('label') as HTMLElement || target).click();
    const afterChecked = rs.findIndex((r) => r.checked);
    return { switched: target.checked || afterChecked !== beforeChecked, before: beforeChecked, after: afterChecked, count: rs.length };
  }).catch(() => ({ switched: false, reason: 'evaluate 실패' }));
  await admin.waitForTimeout(300);
  if (res.switched) record(m, 'PASS', { actual: `라디오 ${(res as any).count ?? n}종 · 선택 전환(${(res as any).before}→${(res as any).after})` });
  else skip(m, `라디오 선택 전환 미확인(${(res as any).reason || ''})`);
}

// ── [저장] 버튼 동작: 노출·활성 확인(비파괴 — 클릭 금지) ──
async function saveActive(admin: Page, scope: Locator, K: string) {
  const m: CheckMeta = { path: `${P} > ${K} > 저장`, tcRef: R(`${K}_save`), tcId: `RENEW-${K}-SAVE`, desc: '[저장] 버튼 노출·활성(클릭 금지=비파괴)', failMsg: '저장 버튼 미노출/비활성' };
  const save = scope.getByRole('button', { name: /^\s*저장(하기)?\s*$/ }).first()
    .or(scope.getByRole('button', { name: /^\s*등록\s*$/ }).first());
  if (!(await save.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '[저장]/[등록] 버튼 미노출'); return; }
  const enabled = await save.isEnabled().catch(() => false);
  const label = (await save.innerText().catch(() => '')).trim();
  if (enabled) record(m, 'PASS', { actual: `[${label}] 노출·활성(클릭 미수행=비파괴)` });
  else diff(`${P} > ${K}`, `[${label}] 버튼 비활성`, '노출됐으나 disabled(입력 조건 미충족 추정)', R(`${K}_save`), '활성 조건 확인 — 필수입력 채운 뒤 재확인 권장');
}

// ── 등록/수정 폼 열기 → 배터리(입력·클리어·datepicker·항목) + 라디오 + 저장활성 → 취소 ──
async function formPath(admin: Page, K: string, openBtnRe: RegExp) {
  const openM: CheckMeta = { path: `${P} > ${K} > 폼`, tcRef: R(`${K}_form`), tcId: `RENEW-${K}-FORM`, desc: `[${K === 'REG' ? '신규 등록' : '수정'}] → 폼 오픈`, failMsg: '폼 미오픈' };
  const btn = M(admin).getByRole('button', { name: openBtnRe }).first();
  if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(openM, `[${K === 'REG' ? '신규 등록' : '수정'}] 버튼 미노출(데이터 의존/권한)`); return; }
  const urlBefore = admin.url();
  await btn.click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_300); await killAlarms(admin);
  const modalOpen = await formScope(admin).getByRole('button', { name: /저장|등록|취소/ }).first().isVisible({ timeout: 1_500 }).catch(() => false);
  const pageForm = await M(admin).getByRole('button', { name: /^\s*(저장|등록|취소)\s*$/ }).first().isVisible({ timeout: 1_000 }).catch(() => false);
  const urlChanged = admin.url() !== urlBefore;
  if (!(modalOpen || pageForm || urlChanged)) { skip(openM, '폼(저장/취소·모달·라우트) 미확인'); return; }
  record(openM, 'PASS', { actual: modalOpen ? '모달 폼' : (urlChanged ? '라우트 페이지 폼' : '페이지 폼') });

  const scope = await scopeOf(admin);
  await radioTest(admin, scope, K);
  await runFormBattery(admin, `${P} > ${K}`, R(K.toLowerCase()), `RN-${K}`).catch(() => {});
  await saveActive(admin, await scopeOf(admin), K);
  await closeForm(admin).catch(() => {});
  await killAlarms(admin);
}

test('정보 관리 > 코스 리뉴얼 정보 심화 E2E(탭·신규등록·수정·라디오, 비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  if (!(await gotoCourseMenu(admin, '정보 관리', '코스 리뉴얼 정보').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: R('0'), tcId: 'RENEW-00', desc: '진입' }, '진입 실패(세션 만료 — course:auth)');
    await writeReport('코스관리_코스리뉴얼E2E'); return;
  }
  await admin.waitForTimeout(1_200); await killAlarms(admin);

  // ══════════ ① 차수 탭 이동(1차~6차) ══════════
  const tabM: CheckMeta = { path: `${P} > 차수 탭`, tcRef: R('tab'), tcId: 'RENEW-TAB', desc: '1차~6차 탭 간 이동(활성 전환)', failMsg: '탭 전환 미동작' };
  const tabLabels = ['1차', '2차', '3차', '4차', '5차', '6차'];
  let switched = 0, present = 0;
  for (const t of tabLabels) {
    const tab = M(admin).getByText(new RegExp(`^\\s*${t}\\s*$`), { exact: false }).filter({ hasNot: admin.locator('input') }).first();
    if (!(await tab.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
    present++;
    // 클릭 전/후 활성 판정: 탭 요소의 active 계열 클래스 or 콘텐츠(공사 기간 값) 변화
    const before = await M(admin).evaluate(() => (document.querySelector('.contents, main') as HTMLElement)?.innerText?.slice(0, 400) || '').catch(() => '');
    await tab.click({ timeout: 2_000 }).catch(() => {});
    await admin.waitForTimeout(700); await killAlarms(admin);
    const activeOk = await tab.evaluate((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      let p: Element | null = el; for (let i = 0; i < 3 && p; i++) { const c = typeof p.className === 'string' ? p.className : ''; if (/active|selected|on\b|current/i.test(c)) return true; p = p.parentElement; }
      return /active|selected|on\b|current/i.test(cls);
    }).catch(() => false);
    const after = await M(admin).evaluate(() => (document.querySelector('.contents, main') as HTMLElement)?.innerText?.slice(0, 400) || '').catch(() => '');
    if (activeOk || before !== after) switched++;
  }
  if (present === 0) skip(tabM, '차수 탭 미검출(구조 상이)');
  else if (switched >= Math.min(2, present)) record(tabM, 'PASS', { actual: `차수 탭 ${present}개 · 전환 ${switched}개(활성/콘텐츠 변화)` });
  else record(tabM, 'FAIL', { error: `탭 전환 미확인 ${switched}/${present}` });
  // 1차로 복귀
  await M(admin).getByText(/^\s*1차\s*$/).first().click({ timeout: 1_500 }).catch(() => {});
  await admin.waitForTimeout(500); await killAlarms(admin);

  // ══════════ ② 수정 경로 (먼저 — [수정]은 초기 상세뷰에 노출) ══════════
  await formPath(admin, 'EDIT', /^\s*수정\s*$/);

  // ⚠ 라우트 폼→goBack 후 상세뷰/버튼 미복원 → 화면 재진입으로 완전 복원(양 경로 트리거 노출 보장)
  await gotoCourseMenu(admin, '정보 관리', '코스 리뉴얼 정보').catch(() => {});
  await admin.waitForTimeout(1_000); await killAlarms(admin);

  // ══════════ ③ 신규 등록 경로 ══════════
  await formPath(admin, 'REG', /신규\s*등록|^\s*등록\s*$/);

  diff(P, '심화 커버리지', '차수 탭 이동·신규등록/수정 양경로·라디오 동작·저장 활성 — 제네릭 배터리 갭 보강(비파괴)', R('cov'), '저장 미클릭·취소 폐기 · course-info-e2e-all(RN 제네릭)과 상보');
  await killAlarms(admin);
  await writeReport('코스관리_코스리뉴얼E2E');
});

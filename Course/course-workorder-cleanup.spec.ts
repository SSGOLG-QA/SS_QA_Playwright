import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseDateRange } from '../lib/course/courseHelpers';
import * as fs from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 파괴적(작업 지시 삭제) — 중복/스트레이 정리 전용. 기본은 PROBE(삭제 안 함).
//   배경: write 런의 3개월 필터 false-negative로 1~5월이 중복 생성됨(run1 W57-66 + rerun W73-82) + 진단 W72.
//   유지: W-00057~00070(과제 14건). 삭제: 아래 TARGETS(재런 중복 10 + 진단 1 = 11건).
//   안전장치:
//    ① 삭제는 WO_DELETE_CONFIRM=1 일 때만. 미설정 시 상세 진입해 삭제 컨트롤 후보만 덤프(비파괴).
//    ② 이름으로 검색 → 정확히 '작업번호==해당 W'인 행만 상세 진입(중복쌍 중 지정 W만).
//    ③ 첫 타깃에서 삭제 버튼(/^삭제$/) 미발견 시 전체 중단(오삭제 방지).
//    ④ 삭제 후 해당 W가 목록에서 사라졌는지 검증. 미검증(여전히 존재) 시 이후 타깃 중단.
//   실행(비파괴 프로브): npm run course:auth → npm run course:wo-cleanup
//   실행(실삭제)      : npm run course:auth → $env:WO_DELETE_CONFIRM="1"; npm run course:wo-cleanup
// ─────────────────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1536, height: 950 } });
const dir = 'reports/_workorder-write';
const GATE = process.env.WO_DELETE_CONFIRM === '1';

// 삭제 대상: {name, wno}. 중복쌍은 '높은 W(재런분)'만, 진단 스트레이 포함.
const TARGETS: Array<{ name: string; wno: string }> = [
  { name: '[YS] _진단_5월제출테스트', wno: 'W-00072' },
  { name: '[YS] 그린_관수_1월', wno: 'W-00073' },
  { name: '[YS] 그린칼라_구조변경_이전_1월', wno: 'W-00074' },
  { name: '[YS] 티박스_구조변경_수정_2월', wno: 'W-00075' },
  { name: '[YS] 페어웨이_시약_2월', wno: 'W-00076' },
  { name: '[YS] 러프_배토_3월', wno: 'W-00077' },
  { name: '[YS] 벙커_벙커정리_장비_3월', wno: 'W-00078' },
  { name: '[YS] 법면_기타_4월', wno: 'W-00079' },
  { name: '[YS] 그린_스위핑_눈_4월', wno: 'W-00080' },
  { name: '[YS] 그린칼라_매트_5월', wno: 'W-00081' },
  { name: '[YS] 티박스_예지_5월', wno: 'W-00082' },
];

// 이름 검색 후, 작업번호==wno 인 행의 작업명 링크 클릭(상세 진입). 반환: 진입 여부.
async function openDetailByWno(admin: Page, name: string, wno: string): Promise<boolean> {
  const box = admin.getByPlaceholder('검색어 입력').first();
  if (!(await box.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
  await box.click().catch(() => {}); await box.fill('').catch(() => {}); await box.fill(name).catch(() => {}); await box.press('Enter').catch(() => {});
  await admin.waitForTimeout(1_400); await killAlarms(admin);
  // wno 행 찾기 → 그 행의 작업명 링크 클릭
  const row = admin.locator('table tbody tr').filter({ hasText: wno }).first();
  if (!(await row.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
  const link = row.locator('a').filter({ hasText: '[YS]' }).first();
  const clickable = (await link.isVisible({ timeout: 1_000 }).catch(() => false)) ? link : row.getByText('[YS]', { exact: false }).first();
  await clickable.click({ timeout: 2_500 }).catch(() => {});
  await admin.waitForTimeout(1_600); await killAlarms(admin);
  return true;
}

// 상세에서 보이는 버튼/삭제후보 덤프.
async function dumpDetailButtons(admin: Page): Promise<string[]> {
  return await admin.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    return [...document.querySelectorAll('button, a[role=button], .button-common')].filter(vis)
      .map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 20);
  }).catch(() => [] as string[]);
}

test('작업 지시 중복/스트레이 정리(삭제)', async ({ page, context }) => {
  test.setTimeout(1_200_000);
  fs.mkdirSync(dir, { recursive: true });
  const admin = await openCourseAdmin(page, context);
  const out: any = { ts: new Date().toISOString(), gate: GATE, rows: [] };

  if (!(await gotoCourseMenu(admin, '작업 관리', '작업 지시').then(() => true).catch(() => false))) { test.skip(true, '진입 실패'); return; }
  await admin.waitForTimeout(1_800); await killAlarms(admin);
  if (admin.url().includes('/login')) { test.skip(true, '세션 만료'); return; }

  // 전체기간(중복 1~5월 포함) 노출
  out.rangeSet = await setCourseDateRange(admin, '2026-01-01', '2026-12-31');
  await admin.waitForTimeout(1_500); await killAlarms(admin);

  let aborted = false;
  for (let idx = 0; idx < TARGETS.length; idx++) {
    const t = TARGETS[idx];
    if (aborted) { out.rows.push({ ...t, skipped: 'aborted' }); continue; }
    const rec: any = { ...t };
    const opened = await openDetailByWno(admin, t.name, t.wno);
    rec.opened = opened;
    if (!opened) { rec.result = '행/상세 미발견 → 스킵'; out.rows.push(rec); console.log(`[cleanup] ${t.wno} ${t.name} → 미발견`); await admin.goto(admin.url()).catch(() => {}); continue; }

    const btns = await dumpDetailButtons(admin);
    rec.detailButtons = btns;
    const delBtn = admin.getByRole('button', { name: /^\s*삭제\s*$/ }).first();
    const delVisible = await delBtn.isVisible({ timeout: 1_500 }).catch(() => false);
    rec.deleteBtnFound = delVisible;

    if (!GATE) {
      // 프로브: 삭제 안 함. 상세 닫고 목록 복귀.
      rec.result = delVisible ? '삭제버튼 확인(프로브·미삭제)' : '삭제버튼 미발견(프로브)';
      console.log(`[cleanup·probe] ${t.wno} ${t.name} → 삭제버튼=${delVisible} · buttons=${JSON.stringify(btns)}`);
      // 목록 복귀(뒤로가기/취소/닫기)
      for (const lbl of ['취소', '닫기', '목록']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); break; } }
      await admin.goBack().catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin);
      // 목록 확인 안 되면 메뉴 재진입
      if (!(await admin.getByPlaceholder('검색어 입력').first().isVisible({ timeout: 1_500 }).catch(() => false))) { await gotoCourseMenu(admin, '작업 관리', '작업 지시'); await admin.waitForTimeout(1_200); out.rangeSet2 = await setCourseDateRange(admin, '2026-01-01', '2026-12-31'); await admin.waitForTimeout(1_000); }
      out.rows.push(rec); continue;
    }

    // 실삭제 모드
    if (!delVisible) {
      rec.result = '삭제버튼 미발견 → 전체 중단(안전)';
      out.rows.push(rec); aborted = true;
      console.log(`[cleanup] ⚠ ${t.wno} 삭제버튼 미발견 → 중단. buttons=${JSON.stringify(btns)}`);
      continue;
    }
    await delBtn.click({ timeout: 2_500 }).catch(() => {});
    await admin.waitForTimeout(1_000);
    // 삭제 확인 모달(확인/예/삭제) — 취소/아니요는 누르지 않음
    let confirmed = false;
    for (const lbl of ['확인', '예', '삭제']) { const b = admin.getByRole('button', { name: new RegExp(`^\\s*${lbl}\\s*$`) }).last(); if (await b.isVisible({ timeout: 1_000 }).catch(() => false)) { await b.click({ timeout: 1_500 }).catch(() => {}); confirmed = true; break; } }
    rec.confirmed = confirmed;
    await admin.waitForTimeout(2_000); await killAlarms(admin);

    // 목록 복귀 + 검증(해당 W 사라졌는지)
    if (!(await admin.getByPlaceholder('검색어 입력').first().isVisible({ timeout: 1_500 }).catch(() => false))) { await gotoCourseMenu(admin, '작업 관리', '작업 지시'); await admin.waitForTimeout(1_200); await setCourseDateRange(admin, '2026-01-01', '2026-12-31'); await admin.waitForTimeout(1_000); await killAlarms(admin); }
    const box = admin.getByPlaceholder('검색어 입력').first();
    await box.fill('').catch(() => {}); await box.fill(t.name).catch(() => {}); await box.press('Enter').catch(() => {}); await admin.waitForTimeout(1_300);
    const stillThere = await admin.locator('table tbody tr').filter({ hasText: t.wno }).first().isVisible({ timeout: 1_500 }).catch(() => false);
    rec.deleted = !stillThere;
    rec.result = !stillThere ? '삭제 확인' : '삭제 실패(여전히 존재) → 중단';
    if (stillThere) aborted = true;
    console.log(`[cleanup] ${t.wno} ${t.name} → confirmed=${confirmed} deleted=${!stillThere}`);
    await box.fill('').catch(() => {}); await box.press('Enter').catch(() => {}); await admin.waitForTimeout(600);
    out.rows.push(rec);
  }

  fs.writeFileSync(`${dir}/cleanup.json`, JSON.stringify(out, null, 2), 'utf-8');
  await admin.screenshot({ path: `${dir}/cleanup-after.png`, fullPage: true }).catch(() => {});
  const del = out.rows.filter((r: any) => r.deleted).length;
  console.log(`\n[cleanup] gate=${GATE} · 삭제 ${del}/${TARGETS.length} · ${aborted ? 'ABORTED' : 'OK'} · cleanup.json`);
});

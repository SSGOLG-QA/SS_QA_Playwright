import { test, expect } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { isCourseDestructiveAllowed, deleteCourseMarkerRows, CRUD_MARK } from '../lib/course/destructive';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  코스관리 쓰기경로 E2E — 발병 정보 CRUD (옵트인 파괴). 생성→검증→행 삭제→teardown.
//  실행: $env:ALLOW_DESTRUCTIVE="1"; npm run course:auth  후
//        $env:ALLOW_DESTRUCTIVE="1"; npm run course:write
//  가드 미충족 시 전체 SKIP(데이터 무변경). 마커행(E2ECRUD발병) teardown 으로 잔여 0.
// ──────────────────────────────────────────────────────────────

const modalNow = (p: any) => p.locator('.modal-group').filter({ hasNot: p.locator('.alarm') }).last();

test('코스관리 쓰기경로 — 발병 정보 CRUD(옵트인 파괴)', async ({ page, context }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  const P = '정보 관리 > 발병 정보';
  const guard = await isCourseDestructiveAllowed(admin);
  const base: CheckMeta = { path: `${P} > CRUD`, tcRef: '코스관리_발병_CRUD', tcId: 'CRUD-DISEASE', desc: '발병 정보 생성→검증→삭제(왕복)' };
  if (!guard.ok) {
    skip(base, `파괴 가드 미충족: ${guard.why}`);
    await writeReport('코스관리_쓰기경로');
    return;
  }

  await gotoCourseMenu(admin, '정보 관리', '발병 정보');
  await killAlarms(admin);
  // 사전 teardown(이전 잔여)
  await deleteCourseMarkerRows(admin, CRUD_MARK);

  // ── CREATE ──
  const cMeta: CheckMeta = { path: `${P} > CREATE`, tcRef: '코스관리_발병_1', tcId: 'CRUD-DISEASE-C', desc: '신규 등록: 병충해명·발병일·위치 저장→등록', failMsg: '생성 실패(목록 미반영)' };
  try {
    await admin.getByRole('button', { name: /신규 등록/ }).first().click({ timeout: 8_000 });
    await admin.waitForTimeout(1500); await killAlarms(admin);
    const m = modalNow(admin);
    await m.getByPlaceholder('병충해명 입력').first().fill(CRUD_MARK);
    // ⚠ 날짜는 모달에 기본값(오늘/발병기간)이 이미 채워져 있어 건드리지 않음(pickCourseDate 가 여러 datepicker 오염).
    // 발병 위치: 코스/홀/구역 기본선택 상태 → [위치 저장] 커밋 (핵심 — 미클릭 시 '위치를 선택해주세요')
    const saveLoc = m.getByRole('button', { name: /위치 저장/ }).first();
    if (await saveLoc.isVisible({ timeout: 2_000 }).catch(() => false)) { await saveLoc.click(); await admin.waitForTimeout(1000); await killAlarms(admin); }
    // 등록
    await m.getByRole('button', { name: /^(등록|저장)$/ }).first().click({ timeout: 6_000 });
    await admin.waitForTimeout(2500);
    // 실패 진단용 스크린샷(제출 직후 — 검증 토스트/모달 잔존 확인)
    const shot = 'reports/screenshots/CRUD-DISEASE-submit.png';
    await admin.screenshot({ path: shot }).catch(() => {});
    await killAlarms(admin);
    // 검증: 목록에 마커 노출
    const shown = await admin.locator('tbody tr').filter({ hasText: CRUD_MARK }).count().catch(() => 0);
    if (shown > 0) record(cMeta, 'PASS', { actual: `목록 반영 ${shown}행` });
    else record(cMeta, 'FAIL', { error: '생성 실패(목록 미반영)', detail: `검증 토스트/필수값 확인 — ${shot}`, screenshot: shot });
  } catch (e) { record(cMeta, 'FAIL', { error: '생성 예외', detail: (e as Error).message.slice(0, 160) }); }

  // ── VERIFY(검색) ──
  const vMeta: CheckMeta = { path: `${P} > VERIFY`, tcRef: '코스관리_발병_2', tcId: 'CRUD-DISEASE-V', desc: '검색으로 생성행 재확인', failMsg: '검색 미반영' };
  try {
    const search = admin.locator('.contents, main').first().getByPlaceholder(/검색/).first();
    if (await search.isVisible({ timeout: 1500 }).catch(() => false)) { await search.fill(CRUD_MARK); await search.press('Enter'); await admin.waitForTimeout(1500); }
    const cnt = await admin.locator('tbody tr').filter({ hasText: CRUD_MARK }).count().catch(() => 0);
    if (cnt > 0) record(vMeta, 'PASS', { actual: `검색 ${cnt}행` }); else skip(vMeta, '생성행 없음(생성 실패 시)');
  } catch (e) { record(vMeta, 'FAIL', { error: '검색 예외', detail: (e as Error).message.slice(0, 120) }); }

  // ── DELETE(teardown) ──
  const dMeta: CheckMeta = { path: `${P} > DELETE`, tcRef: '코스관리_발병_3', tcId: 'CRUD-DISEASE-D', desc: '행 [삭제]→확인→목록 제거(원복)', failMsg: '삭제 미반영(잔여)' };
  try {
    const removed = await deleteCourseMarkerRows(admin, CRUD_MARK);
    const still = await admin.locator('tbody tr').filter({ hasText: CRUD_MARK }).count().catch(() => 0);
    if (removed > 0 && still === 0) record(dMeta, 'PASS', { actual: `삭제 ${removed}행·잔여 0` });
    else if (removed === 0) skip(dMeta, '삭제 대상 없음(생성 실패 시)');
    else record(dMeta, 'FAIL', { error: '삭제 미반영', detail: `잔여 ${still}` });
  } catch (e) { record(dMeta, 'FAIL', { error: '삭제 예외', detail: (e as Error).message.slice(0, 120) }); }

  // 최종 teardown 보장(무엇이 실패했든 마커행 잔여 0)
  await deleteCourseMarkerRows(admin, CRUD_MARK);
  await writeReport('코스관리_쓰기경로');
});


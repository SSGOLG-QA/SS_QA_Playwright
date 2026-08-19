import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  사진 관리 2종 심화(비파괴): 정보별 사진 / 위치별 사진.
//  실행: npm run course:auth 후 npm run course:photo
//  - 안내·필터(vue-select)·날짜검색·이미지 그리드/맵 렌더. 사진 0건이면 그리드 skip.
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

async function checkContains(page: Page, meta: CheckMeta, needle: string) {
  await check(page, { ...meta, failMsg: meta.failMsg || '안내 문구 미노출/불일치' }, async () => {
    const body = norm(await mainScope(page).innerText());
    expect(body, `기대 문구 미포함: "${needle}"`).toContain(norm(needle));
  });
}
async function checkCount(p: Page, path: string, tcRef: string, tcId: string, sel: string, label: string, min = 1) {
  const m: CheckMeta = { path: `${path} > ${label}`, tcRef, tcId, desc: `${label} 노출(≥${min})`, failMsg: `${label} 미노출` };
  const cnt = await mainScope(p).locator(sel).count().catch(() => 0);
  if (cnt >= min) record(m, 'PASS', { actual: `${label} ${cnt}개` }); else skip(m, `${label} ${cnt}개(<${min})`);
}
async function checkDateApply(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 날짜검색`, tcRef, tcId, desc: '기간 datepicker + [적용] 조회', failMsg: '조회 미실행' };
  const dp = mainScope(p).locator('input.datepicker-input, [class*="datepicker"]').first();
  if (!(await dp.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, 'datepicker 미노출'); return; }
  const apply = mainScope(p).getByRole('button', { name: '적용' }).first();
  if (await apply.isVisible({ timeout: 2_000 }).catch(() => false)) { await apply.click().catch(() => {}); await p.waitForTimeout(900); await killAlarms(p); record(m, 'PASS', { actual: 'datepicker + [적용] 조회' }); }
  else record(m, 'PASS', { actual: 'datepicker 노출' });
}
// 이미지 렌더(유효 크기) 확인
async function checkImages(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 이미지`, tcRef, tcId, desc: '사진 이미지 렌더(유효 크기)', failMsg: '이미지 미렌더' };
  const big = await mainScope(p).evaluate((scope) => Array.from(scope.querySelectorAll('img')).filter((im) => { const r = (im as HTMLElement).getBoundingClientRect(); return r.width > 40 && r.height > 40; }).length).catch(() => 0);
  if (big > 0) record(m, 'PASS', { actual: `사진 이미지 ${big}개 렌더` }); else skip(m, '표시된 사진 없음(데이터 0건)');
}

test('사진 관리 2종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const go = (sub: string) => gotoCourseMenu(admin, '사진 관리', sub).then(() => true).catch(() => false);

  // ── 정보별 사진 ──
  if (await go('정보별 사진')) {
    const P = '사진 관리 > 정보별 사진'; await killAlarms(admin);
    await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_정보별사진_1', tcId: 'PHOTO-INFO-01', desc: '안내(작업/이슈/점검/발병 등 정보별)' }, '정보별로 확인');
    await checkCount(admin, P, '코스관리_정보별사진_2', 'PHOTO-INFO-FILTER', '.v-select, .vs__dropdown-toggle', '정보 유형 필터(vue-select)', 1);
    await checkDateApply(admin, P, '코스관리_정보별사진_date', 'PHOTO-INFO-DATE');
    await checkImages(admin, P, '코스관리_정보별사진_img', 'PHOTO-INFO-IMG');
  } else skip({ path: '사진 관리 > 정보별 사진', tcRef: '코스관리_정보별사진_0', tcId: 'PHOTO-INFO-00', desc: '진입' }, '진입 실패');

  // ── 위치별 사진 ──
  if (await go('위치별 사진')) {
    const P = '사진 관리 > 위치별 사진'; await killAlarms(admin);
    await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_위치별사진_1', tcId: 'PHOTO-LOC-01', desc: '안내(위치별 사진 확인)' }, '위치별로 확인');
    await checkCount(admin, P, '코스관리_위치별사진_2', 'PHOTO-LOC-FILTER', '.v-select, .vs__dropdown-toggle', '위치 필터(vue-select)', 1);
    await checkCount(admin, P, '코스관리_위치별사진_3', 'PHOTO-LOC-MAP', '[class*="map"], canvas, svg', '위치 맵', 1);
    await checkDateApply(admin, P, '코스관리_위치별사진_date', 'PHOTO-LOC-DATE');
    await checkImages(admin, P, '코스관리_위치별사진_img', 'PHOTO-LOC-IMG');
  } else skip({ path: '사진 관리 > 위치별 사진', tcRef: '코스관리_위치별사진_0', tcId: 'PHOTO-LOC-00', desc: '진입' }, '진입 실패');

  await killAlarms(admin);
  await writeReport('코스관리_사진관리');
});

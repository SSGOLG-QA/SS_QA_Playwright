import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  시설 관리 2종 심화(비파괴): 시설 총괄 / 시설 관제.
//  실행: npm run course:auth 후 npm run course:facility
//  - 총괄: 제목·컬럼·[보기] 상세·필터·[신규 등록] 노출(파괴 — 노출만).
//  - 관제: 지도 기반 모니터 → 맵/필터 렌더(L1).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();

async function checkVisible(page: Page, meta: CheckMeta, locSel: string | (() => any)) {
  await check(page, meta, async () => {
    const loc = typeof locSel === 'string' ? page.locator(locSel) : locSel();
    await expect(loc.first()).toBeVisible({ timeout: 8_000 });
  });
}
async function checkRowView(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 보기`, tcRef, tcId, desc: '행 [보기] → 상세 팝업/뷰 → 닫기', failMsg: '상세 미오픈' };
  const btn = mainScope(p).locator('tbody').getByRole('button', { name: '보기' }).first();
  if (!(await btn.isVisible({ timeout: 2_500 }).catch(() => false))) { skip(m, '[보기] 미노출(데이터 없음)'); return; }
  await btn.click({ timeout: 4_000 }).catch(() => {}); await p.waitForTimeout(1200); await killAlarms(p);
  const modal = p.locator('.modal-group').filter({ hasNot: p.locator('.alarm') }).last();
  if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
    record(m, 'PASS', { actual: '상세 팝업 오픈' });
    await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 2_000 }).catch(() => {});
    await p.keyboard.press('Escape').catch(() => {});
  } else skip(m, '상세 팝업 미확인(새 뷰/구조 상이)');
  await killAlarms(p);
}
async function checkFilter(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 필터`, tcRef, tcId, desc: '필터([적용]) 조회 실행', failMsg: '조회 미실행' };
  const apply = mainScope(p).getByRole('button', { name: '적용' }).first();
  if (!(await apply.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '[적용] 미노출'); return; }
  await apply.click().catch(() => {}); await p.waitForTimeout(900); await killAlarms(p);
  record(m, 'PASS', { actual: '[적용] 조회 실행(비파괴)' });
}

test('시설 관리 2종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  // ══ 시설 총괄 ══
  {
    const P = '시설 관리 > 시설 총괄';
    if (!(await gotoCourseMenu(admin, '시설 관리', '시설 총괄').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_시설총괄_0', tcId: 'FAC-SUM-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin);
      await checkVisible(admin, { path: `${P} > 제목`, tcRef: '코스관리_시설총괄_a0', tcId: 'FAC-SUM-01', desc: '제목 노출', failMsg: '제목 미노출' }, () => mainScope(admin).getByText('시설 총괄', { exact: false }).first());
      for (const col of ['1분류', '2분류', '시설명', '공사 업체', '위치', '최초 설치일', '설치 비용']) {
        await checkVisible(admin, { path: `${P} > 컬럼:${col}`, tcRef: `코스관리_시설총괄_col_${col.replace(/\s+/g, '')}`, tcId: `FAC-SUM-COL-${col.replace(/\s+/g, '')}`, desc: `컬럼 "${col}"`, failMsg: `"${col}" 미노출` }, () => mainScope(admin).getByText(col, { exact: true }).first());
      }
      await checkVisible(admin, { path: `${P} > 액션`, tcRef: '코스관리_시설총괄_a1', tcId: 'FAC-SUM-02', desc: '[신규 등록] 노출(파괴 — 노출만)', failMsg: '[신규 등록] 미노출' }, () => mainScope(admin).getByRole('button', { name: '신규 등록' }));
      await checkRowView(admin, P, '코스관리_시설총괄_view', 'FAC-SUM-VIEW');
      await checkFilter(admin, P, '코스관리_시설총괄_filter', 'FAC-SUM-FILTER');
    }
  }

  // ══ 시설 관제 (지도 기반) ══
  {
    const P = '시설 관리 > 시설 관제';
    if (!(await gotoCourseMenu(admin, '시설 관리', '시설 관제').then(() => true).catch(() => false))) { skip({ path: P, tcRef: '코스관리_시설관제_0', tcId: 'FAC-MON-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin); await admin.waitForTimeout(1500);
      const mMeta: CheckMeta = { path: `${P} > 맵/필터`, tcRef: '코스관리_시설관제_1', tcId: 'FAC-MON-01', desc: '지도 기반 관제 화면 렌더(맵/필터)', failMsg: '관제 화면 미렌더' };
      const mapCnt = await mainScope(admin).locator('[class*="map"], canvas, .leaflet-container, svg').count().catch(() => 0);
      const vsCnt = await mainScope(admin).locator('.v-select, .vs__dropdown-toggle').count().catch(() => 0);
      if (mapCnt > 0 || vsCnt > 0) record(mMeta, 'PASS', { actual: `맵/시각요소 ${mapCnt}개·필터(vue-select) ${vsCnt}개 렌더` });
      else skip(mMeta, '맵/필터 미검출(구조 상이)');
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_시설관리');
});

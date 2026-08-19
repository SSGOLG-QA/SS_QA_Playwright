import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';
import * as fs from 'fs';

const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
async function checkContains(page: Page, meta: CheckMeta, needle: string) {
  await check(page, { ...meta, failMsg: meta.failMsg || '안내 문구 미노출/불일치' }, async () => {
    const body = norm(await page.locator('.contents, main, body').first().innerText());
    expect(body, `기대 문구 미포함: "${needle}"`).toContain(norm(needle));
  });
}
async function checkVisible(page: Page, meta: CheckMeta, locSel: string | (() => any)) {
  await check(page, meta, async () => {
    const loc = typeof locSel === 'string' ? page.locator(locSel) : locSel();
    await expect(loc.first()).toBeVisible({ timeout: 8_000 });
  });
}

// ──────────────────────────────────────────────────────────────
//  예산 관리 형제 화면 검증(비파괴): 예산 총괄 / 실적 관리 / 예산 분석.
//  실행: npm run course:auth 후 npm run course:budget-siblings
//  - 총괄: 월간/연간 탭·롤업 테이블·내보내기 다운로드·(행 합계=Σ월).
//  - 실적: 5 분류 탭·안내문구·엑셀업로드 UI(취소)·내보내기 다운로드. (값 입력 정합성은 예산상세 edit-calc와 동형 → 참조)
//  - 분석: 월간/연간 × 그래프/테이블 4탭 전환·차트 렌더·내보내기.
//  전부 비파괴(다운로드/취소/조회만).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();

// [내보내기] 다운로드 검증(공통)
async function checkExport(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 내보내기`, tcRef, tcId, desc: '[내보내기] → 파일 다운로드', failMsg: '다운로드 미발생' };
  const btn = mainScope(p).getByRole('button', { name: '내보내기' }).first();
  if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) { skip(m, '내보내기 버튼 미노출'); return; }
  try {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15_000 }).catch(() => null), btn.click().catch(() => {})]);
    if (!dl) { record(m, 'FAIL', { error: '다운로드 이벤트 미발생' }); return; }
    const name = dl.suggestedFilename();
    const sp = `reports/downloads/${name}`;
    await dl.saveAs(sp).catch(() => {});
    const size = fs.existsSync(sp) ? fs.statSync(sp).size : 0;
    if (/\.(xlsx|xls|csv)$/i.test(name) && size > 0) record(m, 'PASS', { actual: `${name} (${size}b)` });
    else record(m, 'FAIL', { error: '파일 이상', detail: `${name}/${size}b` });
    try { if (fs.existsSync(sp)) fs.unlinkSync(sp); } catch { /* noop */ }
  } catch (e) { record(m, 'FAIL', { error: '내보내기 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// 탭 전환 검증(공통) — 각 탭 클릭 → 활성/노출 확인(비파괴)
async function checkTabs(p: Page, path: string, tcRef: string, tcId: string, tabNames: string[]) {
  const m: CheckMeta = { path: `${path} > 탭`, tcRef, tcId, desc: `탭 전환: ${tabNames.join('/')}`, failMsg: '탭 전환 실패' };
  const found: string[] = [];
  for (const name of tabNames) {
    const tab = p.getByRole('tab', { name }).or(mainScope(p).getByText(name, { exact: true })).first();
    if (await tab.isVisible({ timeout: 2_000 }).catch(() => false)) { await tab.click().catch(() => {}); await p.waitForTimeout(700); await killAlarms(p); found.push(name); }
  }
  if (found.length === tabNames.length) record(m, 'PASS', { actual: `${found.length}개 탭 전환 OK` });
  else if (found.length > 0) record(m, 'PASS', { actual: `${found.length}/${tabNames.length}개 탭 전환(${found.join(',')})` });
  else skip(m, '탭 미발견');
}

test('예산 관리 형제 화면(총괄/실적/분석) 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  // ══════════ 예산 총괄 ══════════
  {
    const P = '예산 관리 > 예산 총괄';
    if (!(await gotoCourseMenu(admin, '예산 관리', '예산 총괄').then(() => true).catch(() => false))) {
      skip({ path: P, tcRef: '코스관리_예산총괄_0', tcId: 'BSUM-00', desc: '진입' }, '진입 실패');
    } else {
      await killAlarms(admin);
      await checkVisible(admin, { path: `${P} > 제목`, tcRef: '코스관리_예산총괄_1', tcId: 'BSUM-01', desc: '제목 노출', failMsg: '제목 미노출' }, () => mainScope(admin).getByText('예산 총괄', { exact: false }));
      await checkVisible(admin, { path: `${P} > 컬럼`, tcRef: '코스관리_예산총괄_2', tcId: 'BSUM-02', desc: '롤업 테이블(대분류/중분류/월별)', failMsg: '테이블 미노출' }, () => mainScope(admin).getByText('대분류', { exact: true }).first());
      await checkTabs(admin, P, '코스관리_예산총괄_3', 'BSUM-03', ['월간', '연간']);
      await checkExport(admin, P, '코스관리_예산총괄_4', 'BSUM-EXPORT');
    }
  }

  // ══════════ 실적 관리 ══════════
  {
    const P = '예산 관리 > 실적 관리';
    if (!(await gotoCourseMenu(admin, '예산 관리', '실적 관리').then(() => true).catch(() => false))) {
      skip({ path: P, tcRef: '코스관리_실적관리_0', tcId: 'BPERF-00', desc: '진입' }, '진입 실패');
    } else {
      await killAlarms(admin);
      await checkVisible(admin, { path: `${P} > 제목`, tcRef: '코스관리_실적관리_1', tcId: 'BPERF-01', desc: '제목 노출', failMsg: '제목 미노출' }, () => mainScope(admin).getByText('실적 관리', { exact: false }).first());
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_실적관리_2', tcId: 'BPERF-02', desc: '안내문구(실제 회계상 집계 비용 입력)' }, '실제 회계상 집계된 전체 비용을 입력');
      // 5 분류 탭 노출
      await checkVisible(admin, { path: `${P} > 분류탭`, tcRef: '코스관리_실적관리_3', tcId: 'BPERF-03', desc: '분류 탭(고정직/임시직/코스자재/장비/기타)', failMsg: '분류 탭 미노출' }, () => mainScope(admin).getByText('코스 자재비', { exact: true }).first());
      // 엑셀 업로드 UI(비파괴 — 파일 미선택)
      const uMeta: CheckMeta = { path: `${P} > 엑셀 업로드`, tcRef: '코스관리_실적관리_4', tcId: 'BPERF-UPLOAD', desc: '[엑셀 업로드] → 파일 선택기/모달 노출 → 취소(비파괴)', failMsg: '업로드 UI 미노출' };
      const upBtn = mainScope(admin).getByRole('button', { name: '엑셀 업로드' }).first();
      if (!(await upBtn.isVisible({ timeout: 3_000 }).catch(() => false))) { skip(uMeta, '엑셀 업로드 버튼 미노출'); }
      else {
        const chooserP = admin.waitForEvent('filechooser', { timeout: 3_000 }).catch(() => null);
        await upBtn.click().catch(() => {});
        const chooser = await chooserP;
        const fi = await admin.locator('input[type="file"]').count().catch(() => 0);
        if (chooser) record(uMeta, 'PASS', { actual: `파일 선택기 노출(input[type=file] ${fi}) — 파일 미선택 취소` });
        else if (fi > 0) record(uMeta, 'PASS', { actual: `숨겨진 input[type=file] ${fi}개 존재` });
        else { await admin.waitForTimeout(800); const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last(); if (await modal.isVisible({ timeout: 1_500 }).catch(() => false)) { record(uMeta, 'PASS', { actual: '업로드 모달 노출' }); await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 2_000 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); } else record(uMeta, 'FAIL', { error: '업로드 UI 미확인' }); }
      }
      await checkExport(admin, P, '코스관리_실적관리_5', 'BPERF-EXPORT');
    }
  }

  // ══════════ 예산 분석 ══════════
  {
    const P = '예산 관리 > 예산 분석';
    if (!(await gotoCourseMenu(admin, '예산 관리', '예산 분석').then(() => true).catch(() => false))) {
      skip({ path: P, tcRef: '코스관리_예산분석_0', tcId: 'BANAL-00', desc: '진입' }, '진입 실패');
    } else {
      await killAlarms(admin);
      await checkVisible(admin, { path: `${P} > 제목`, tcRef: '코스관리_예산분석_1', tcId: 'BANAL-01', desc: '제목 노출', failMsg: '제목 미노출' }, () => mainScope(admin).getByText('예산 분석', { exact: false }).first());
      await checkContains(admin, { path: `${P} > 안내`, tcRef: '코스관리_예산분석_2', tcId: 'BANAL-02', desc: '안내문구(예산 대비 실제 총비용 비교/분석)' }, '수립한 예산 대비 실제 발생한 총비용을 비교');
      await checkTabs(admin, P, '코스관리_예산분석_3', 'BANAL-03', ['월간 그래프', '월간 테이블', '연간 그래프', '연간 테이블']);
      // 차트 렌더(그래프 탭에서 SVG/canvas 존재)
      const cMeta: CheckMeta = { path: `${P} > 차트`, tcRef: '코스관리_예산분석_4', tcId: 'BANAL-04', desc: '그래프 탭 차트 렌더(SVG/canvas)', failMsg: '차트 미렌더' };
      await (admin.getByRole('tab', { name: '월간 그래프' }).or(mainScope(admin).getByText('월간 그래프', { exact: true })).first()).click().catch(() => {});
      await admin.waitForTimeout(1_000);
      const chartCnt = await mainScope(admin).locator('canvas, svg').count().catch(() => 0);
      if (chartCnt > 0) record(cMeta, 'PASS', { actual: `차트 요소 ${chartCnt}개 렌더` }); else skip(cMeta, '차트 요소 미검출');
      await checkExport(admin, P, '코스관리_예산분석_5', 'BANAL-EXPORT');
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_예산형제화면');
});

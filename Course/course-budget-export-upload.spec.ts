import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  예산 상세 > 전체 탭: [내보내기] 다운로드 검증 + [엑셀 업로드] UI 노출→취소(비파괴).
//  실행: npm run course:auth 후 npm run course:export-upload
//  - 내보내기: waitForEvent('download') → 파일명/확장자/크기 검증(비파괴, 파일 저장 후 잔여 삭제).
//  - 엑셀 업로드: 클릭 → 파일선택기(filechooser)/인페이지 모달/연도잠금 알림 적응 감지 → 파일 미선택/취소(비파괴).
//  가드 불필요(비파괴 — 다운로드 + 업로드 취소, 실제 파일 업로드 안 함).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();

test('예산 상세 > 내보내기 다운로드 + 엑셀 업로드 UI(비파괴)', async ({ page, context }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const P = '예산 관리 > 예산 상세';

  await gotoCourseMenu(admin, '예산 관리', '예산 상세');
  await killAlarms(admin);
  // 전체 탭 선택(내보내기/엑셀 업로드 보유)
  const allTab = admin.getByRole('tab', { name: '전체' }).or(mainScope(admin).getByText('전체', { exact: true })).first();
  if (await allTab.isVisible({ timeout: 3_000 }).catch(() => false)) { await allTab.click().catch(() => {}); await admin.waitForTimeout(1_000); await killAlarms(admin); }

  // ── 내보내기: 다운로드 이벤트 포착 → 파일명/확장자/크기 검증 ──
  const eMeta: CheckMeta = { path: `${P} > 내보내기`, tcRef: '코스관리_예산상세_export', tcId: 'CBUD-EXPORT', desc: '[내보내기] → xlsx 다운로드 발생·파일명/크기 검증', failMsg: '다운로드 미발생' };
  try {
    const exportBtn = mainScope(admin).getByRole('button', { name: '내보내기' }).first();
    if (!(await exportBtn.isVisible({ timeout: 3_000 }).catch(() => false))) { skip(eMeta, '내보내기 버튼 미노출'); }
    else {
      const [dl] = await Promise.all([
        admin.waitForEvent('download', { timeout: 15_000 }).catch(() => null),
        exportBtn.click().catch(() => {}),
      ]);
      if (!dl) { record(eMeta, 'FAIL', { error: '다운로드 이벤트 미발생(15s)' }); }
      else {
        const name = dl.suggestedFilename();
        const okName = /\.(xlsx|xls|csv)$/i.test(name);
        const savePath = `reports/downloads/${name}`;
        await dl.saveAs(savePath).catch(() => {});
        const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
        if (okName && size > 0) record(eMeta, 'PASS', { actual: `다운로드 "${name}" (${size} bytes)` });
        else record(eMeta, 'FAIL', { error: '파일명/크기 이상', detail: `${name} / ${size}b` });
        try { if (fs.existsSync(savePath)) fs.unlinkSync(savePath); } catch { /* noop */ }   // 잔여 삭제
      }
    }
  } catch (e) { record(eMeta, 'FAIL', { error: '내보내기 예외', detail: (e as Error).message.slice(0, 160) }); }

  // ── 엑셀 업로드 UI: 클릭 → filechooser/모달/연도잠금 감지 → 취소(파일 미선택, 비파괴) ──
  const uMeta: CheckMeta = { path: `${P} > 엑셀 업로드`, tcRef: '코스관리_예산상세_upload', tcId: 'CBUD-UPLOAD', desc: '[엑셀 업로드] → 업로드 UI(파일선택기/모달) 노출 → 취소(파일 미선택·비파괴)', failMsg: '업로드 UI 미노출' };
  try {
    const upBtn = mainScope(admin).getByRole('button', { name: '엑셀 업로드' }).first();
    if (!(await upBtn.isVisible({ timeout: 3_000 }).catch(() => false))) { skip(uMeta, '엑셀 업로드 버튼 미노출'); }
    else {
      const chooserP = admin.waitForEvent('filechooser', { timeout: 3_000 }).catch(() => null);
      await upBtn.click().catch(() => {});
      const chooser = await chooserP;
      if (chooser) {
        // 네이티브 파일 선택기 노출 → 파일 미선택 = 취소(비파괴). 숨겨진 input 여부도 병기.
        const fi = await admin.locator('input[type="file"]').count().catch(() => 0);
        record(uMeta, 'PASS', { actual: `파일 선택기(filechooser) 노출 — 파일 미선택 취소 (input[type=file] ${fi})` });
      } else {
        await admin.waitForTimeout(1_000);
        // 연도 잠금 알림?
        const lock = admin.locator('.modal-group.alarm, .modal-group[class*="alarm"]').filter({ hasText: /수립할 수 없|지난 연도/ }).last();
        if (await lock.isVisible({ timeout: 1_500 }).catch(() => false)) {
          record(uMeta, 'PASS', { actual: '업로드 시 연도 잠금 알림(지난 연도 수립 불가)' });
          diff('예산 관리 > 예산 상세', '엑셀 업로드 연도 게이트', '지난 연도(2026)에서 업로드 시 "수립할 수 없습니다" 알림 → 편집 가능 연도 필요', '코스관리_예산상세_upload', '실 업로드 왕복은 편집 가능 연도 선결');
          await killAlarms(admin);
        } else {
          // 인페이지 모달?
          const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
          const fi = await admin.locator('input[type="file"]').count().catch(() => 0);
          if (await modal.isVisible({ timeout: 2_000 }).catch(() => false)) {
            record(uMeta, 'PASS', { actual: `업로드 모달 노출 (input[type=file] ${fi}개)` });
            await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 2_000 }).catch(() => {});
            await admin.keyboard.press('Escape').catch(() => {});
          } else if (fi > 0) {
            record(uMeta, 'PASS', { actual: `숨겨진 input[type=file] ${fi}개 존재(모달/선택기 없음) — setInputFiles 주입 가능` });
          } else {
            record(uMeta, 'FAIL', { error: '업로드 UI/입력요소 미확인', detail: 'filechooser·모달·input[type=file] 모두 없음' });
            await admin.screenshot({ path: 'reports/screenshots/CBUD-UPLOAD-unknown.png' }).catch(() => {});
          }
        }
      }
    }
  } catch (e) { record(uMeta, 'FAIL', { error: '업로드 예외', detail: (e as Error).message.slice(0, 160) }); }

  await killAlarms(admin);
  await writeReport('코스관리_예산내보내기업로드');
});

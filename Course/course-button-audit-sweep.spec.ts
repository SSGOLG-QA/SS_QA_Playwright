import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, settle, COURSE_IA } from '../lib/course/courseHelpers';
import { auditButtonCoverage } from '../lib/course/coverageAudit';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// 등록/설정/업로드 액션 버튼 → 모달/폼 열기 → 취소(비파괴, 저장 절대 안 함).
const ACTION_RE = /(신규.*등록|.*등록|그룹\s*추가|추가\s*입고|표준.*설정|엑셀\s*업로드)$/;
const DESTR_RE = /(저장|저장하기|삭제|변경|사용중지|발송|전송|승인|반려)/;
const mainScope = (p: Page) => p.locator('.contents, main').first();

async function probeOpenCancel(admin: Page, P: string, label: string, menu: string, sub: string): Promise<void> {
  const safe = label.replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 20);
  const m: CheckMeta = { path: `${P} > 액션:${label}`, tcRef: `코스관리_액션_${safe}`, tcId: `ACT-${safe}`, desc: `[${label}] → 모달/폼 열기 → 취소(비파괴)`, failMsg: `[${label}] 미동작` };
  const btn = mainScope(admin).getByRole('button', { name: new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') }).first();
  if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `[${label}] 비가시`); return; }
  try {
    const beforeUrl = admin.url();
    await btn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_100); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    const modalShown = await modal.isVisible({ timeout: 2_000 }).catch(() => false);
    const urlChanged = admin.url() !== beforeUrl;
    if (modalShown) {
      record(m, 'PASS', { actual: `[${label}] → 모달/폼 오픈 → 취소(비파괴, 저장 안 함)` });
      await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {});
      await admin.keyboard.press('Escape').catch(() => {});
    } else if (urlChanged) {
      record(m, 'PASS', { actual: `[${label}] → 등록/설정 화면 이동(URL 변화) → 복귀` });
      await gotoCourseMenu(admin, menu, sub).catch(() => {}); await admin.waitForTimeout(900);
    } else skip(m, `[${label}] 클릭(모달/이동 미확정)`);
    await killAlarms(admin);
  } catch (e) { record(m, 'FAIL', { error: `${label} 예외`, detail: (e as Error).message.slice(0, 120) }); }
}

// ──────────────────────────────────────────────────────────────
//  코스관리 전 화면 버튼 커버리지 감사 스윕(비파괴) — "모든 케이스 생성 시 적용" 전면 확대.
//  실행: npm run course:auth 후 npm run course:btn-audit
//  COURSE_IA(46화면) 한 로그인 순회 → 각 화면 auditButtonCoverage(handled/파괴제외/프레임워크/미처리).
//  미처리>0 화면은 diff로 명시화 → 존재-미테스트 버튼 갭 맵. 분석용 raw 덤프 병행.
//  ⚠ 세션 1런 제약: course:auth 직후 1회.
// ──────────────────────────────────────────────────────────────

test('코스관리 전 화면 버튼 커버리지 감사 스윕(비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  admin.on('filechooser', (fc) => { fc.setFiles([]).catch(() => {}); });   // 업로드 filechooser 자동 취소(파일 미선택)

  for (const menu of COURSE_IA) {
    if (menu.menu === 'Home') continue;
    for (const sub of menu.subs) {
      const P = `${menu.menu} > ${sub.name}`;
      const ref = `코스관리_감사_${sub.route.replace(/\//g, '_')}`;
      const id = `AUDIT-${sub.route.replace(/\//g, '-')}`;
      const ok = await gotoCourseMenu(admin, menu.menu, sub.name).then(() => true).catch(() => false);
      if (!ok) { skip({ path: P, tcRef: ref, tcId: id, desc: '진입' }, '진입 실패(미구현/네비 실패)'); continue; }
      await settle(admin, 900); await admin.waitForTimeout(900); await killAlarms(admin);
      // 표시 버튼 → 등록/설정/업로드 액션 버튼 실제 테스트(open→cancel, 비파괴 — 파괴 버튼 제외)
      const btns = Array.from(new Set((await mainScope(admin).locator('button:visible').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)));
      for (const b of btns) { if (ACTION_RE.test(b) && !DESTR_RE.test(b)) await probeOpenCancel(admin, P, b, menu.menu, sub.name); }
      await auditButtonCoverage(admin, P, ref, id);
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_버튼감사');
});

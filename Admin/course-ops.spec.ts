import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { runPinPosition, runPinHistory, runPinAnalysis, runCourseAnalysis, runGreenSpeed, runClubNews } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 코스 운영 관리 6종 (핀 포지션 관리/변경이력/분석, 코스 분석, 그린스피드, 골프장 소식) - 구조 기반
//   ⚠ 전체/선택 적용/수정/등록/삭제/조회/내보내기/checkbox는 비파괴(노출만). 안내문구 부분 일치
// 실행: npx playwright test --project=admin-chromium Admin/course-ops.spec.ts --no-deps
test('코스 운영 관리 6종 검증 (구조 기반)', async ({ page, context }) => {
  test.setTimeout(420_000);
  resetResults(); resetNoTC(); resetDiff();
  const admin = await openAdmin(page, context);
  const M = '코스 운영 관리';
  if (await gotoMenu(admin, M, '핀 포지션 관리', { path: '코스 운영 관리 > 핀 포지션 관리', tcRef: '코스 운영 관리_핀 포지션 관리', tcId: '진입', desc: '핀 포지션 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runPinPosition(admin);
  if (await gotoMenu(admin, M, '핀 포지션 변경이력', { path: '코스 운영 관리 > 핀 포지션 변경이력', tcRef: '코스 운영 관리_핀 포지션 변경이력', tcId: '진입', desc: '핀 포지션 변경이력 진입', failMsg: '메뉴 진입 불가' }))
    await runPinHistory(admin);
  if (await gotoMenu(admin, M, '핀 포지션 분석', { path: '코스 운영 관리 > 핀 포지션 분석', tcRef: '코스 운영 관리_핀 포지션 분석', tcId: '진입', desc: '핀 포지션 분석 진입', failMsg: '메뉴 진입 불가' }))
    await runPinAnalysis(admin);
  if (await gotoMenu(admin, M, '코스 분석', { path: '코스 운영 관리 > 코스 분석', tcRef: '코스 운영 관리_코스 분석', tcId: '진입', desc: '코스 분석 진입', failMsg: '메뉴 진입 불가' }))
    await runCourseAnalysis(admin);
  if (await gotoMenu(admin, M, '그린 스피드', { path: '코스 운영 관리 > 그린스피드', tcRef: '코스 운영 관리_그린스피드', tcId: '진입', desc: '그린스피드 진입', failMsg: '메뉴 진입 불가' }))
    await runGreenSpeed(admin);
  if (await gotoMenu(admin, M, '골프장 소식', { path: '코스 운영 관리 > 골프장 소식', tcRef: '코스 운영 관리_골프장 소식', tcId: '진입', desc: '골프장 소식 진입', failMsg: '메뉴 진입 불가' }))
    await runClubNews(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('course-ops'); });

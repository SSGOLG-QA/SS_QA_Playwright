import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import * as S from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, resetIA, gotoMenu } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  전체 테스트 — 전 대메뉴를 한 문서(탭=대메뉴명)로 산출
//   · 결과: reports/전체테스트_report_*.xlsx (요약 대시보드 + 대메뉴별 탭 + IA + SKIP + 차이)
//   · 개별 테스트는 각 Admin/<메뉴>.spec.ts 가 개별 문서로 산출(현행 유지)
//  실행: npx playwright test --project=admin-chromium Admin/all-suite.spec.ts --no-deps
// ──────────────────────────────────────────────────────────────

// [parent SNB, child SNB, run 함수] — gotoMenu 진입 후 실행. 홈/라운드관리는 자체 진입/네비
const STEPS: [string, string, (p: any) => Promise<void>][] = [
  ['대회', '대회관리', S.runTournament],
  ['관제 관리', '아이콘 관리', S.runIconMgmt],
  ['관제 관리', '라이브채팅 공지 조회', S.runLiveChatNotice],
  ['관제 관리', '카트이동경로 확인', S.runCartTrace],
  ['관제 관리', '메시지 기록 조회', S.runMessageHistory],
  ['태블릿 운영 관리', '태블릿 기능 설정', S.runTabletFeature],
  ['태블릿 운영 관리', '메시지 관리', S.runTabletMessage],
  ['태블릿 운영 관리', '홀 이벤트 관리', S.runTabletHoleEvent],
  ['홀맵 관리', '홀맵 구역 설정', S.runHolemapZone],
  ['홀맵 관리', '카트패스 진입여부 설정', S.runHolemapCartEntrance],
  ['홀맵 관리', '티샷 유의 거리 설정', S.runHolemapTeeshot],
  ['홀맵 관리', '홀맵 미리보기', S.runHolemapPreview],
  ['코스 운영 관리', '핀 포지션 관리', S.runPinPosition],
  ['코스 운영 관리', '핀 포지션 변경이력', S.runPinHistory],
  ['코스 운영 관리', '핀 포지션 분석', S.runPinAnalysis],
  ['코스 운영 관리', '코스 분석', S.runCourseAnalysis],
  ['코스 운영 관리', '그린 스피드', S.runGreenSpeed],
  ['코스 운영 관리', '골프장 소식', S.runClubNews],
  ['경기 진행 관리', '진행시간 표준 설정', S.runTimeStandard],
  ['경기 진행 관리', '진행시간 실시간', S.runTimeRealtime],
  ['경기 진행 관리', '진행시간 조회', S.runTimeSearch],
  ['경기 진행 관리', '진행시간 통계', S.runTimeStats],
  ['캐디 관리', '캐디 리스트', S.runCaddieList],
  ['캐디 관리', '캐디 등록 관리', S.runCaddieRegister],
  ['캐디 관리', '캐디 실적', S.runCaddiePerformance],
  ['배토 관리', '배토 기록 조회', S.runBetoRecord],
  ['배토 관리', '배토 통계', S.runBetoStats],
  ['식음 관리', '버전 및 설정', S.runFnbVersion],
  ['식음 관리', '식당 관리', S.runFnbRestaurant],
  ['식음 관리', '상품 등록 관리', S.runFnbProduct],
  ['식음 관리', '주문 내역 관리', S.runFnbOrderHistory],
  ['고객 평가 관리', '고객 평가', S.runCustomerEval],
  ['고객 평가 관리', '캐디 평가', S.runCaddieEval],
  ['고객 평가 관리', '후기 리스트', S.runReviewList],
  ['고객 평가 관리', '후기 통계', S.runReviewStats],
  ['계정 관리', '계정 리스트', S.runAccountList],
  ['계정 관리', '계정 권한 관리', S.runAccountPermission],
];

test('전체 테스트 — 전 대메뉴 단일 문서', async ({ page, context }) => {
  test.setTimeout(1_200_000);
  resetResults(); resetNoTC(); resetDiff(); resetIA();
  const admin = await openAdmin(page, context);

  // 홈(진입 직후) → 라운드관리(자체 서브 네비)
  await S.runHome(admin).catch(() => {});
  await S.runRoundMgmt(admin).catch(() => {});

  // 나머지 대메뉴: gotoMenu 진입 후 run
  for (const [parent, child, fn] of STEPS) {
    const path = `${parent} > ${child}`;
    if (await gotoMenu(admin, parent, child, { path, tcRef: `${parent}_${child}`, tcId: '진입', desc: `${child} 진입`, failMsg: '메뉴 진입 불가' })) {
      // 긴 단일세션 연속 실행 SPA 렌더 레이스 완화 — 콘텐츠 안정화 대기
      await admin.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await admin.locator('.info-box-text, .contents-box, .map-box').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
      await admin.waitForTimeout(400);
      await fn(admin).catch(() => {});
      // 공통 버튼 동작(초기화/내보내기)은 각 run*() 내부에서 호출(개별 스펙과 공유) → 여기서 별도 호출 불필요
    }
  }

  // IA 구현여부(전 SNB 순회) — IA 시트 포함용
  await S.runIA(admin).catch(() => {});

  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('전체테스트'); });

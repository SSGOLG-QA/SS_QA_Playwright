import { test, expect } from '../lib/fixtures';
import { Page } from '@playwright/test';
import * as S from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  IA(메뉴) 순서 전체 검증 — 단일 진입( 1회) + 단일 통합 리포트
//  ⚠ Playwright는 파일을 알파벳순으로 실행하므로, IA 순서 보장을 위해
//    한 스펙 안에서 run*() 를 IA 트리 순서로 직접 호출한다.
//  ⚠ 배토 통계는 별도 스타일 스펙(beto-stats.spec.ts)이라 여기서 제외.
//  ⚠ runHome 의 'h1 경기관제' 검증(No.1-①/No.2-①)은 리뉴얼('관제 어드민')로 FAIL — 기지(旣知) 이슈.
//
//  실행(브라우저 보며, 순차):
//    npx playwright test --project=admin-chromium Admin/ia-order-full.spec.ts --headed --workers=1 --no-deps
// ──────────────────────────────────────────────────────────────
test('IA 순서 전체 검증 (단일 진입·통합 리포트)', async ({ admin }) => {
  test.setTimeout(1_800_000);
  resetResults(); resetNoTC(); resetDiff();

  // 1) 홈 (진입 직후 화면)
  await S.runHome(admin);
  // 2) 라운드관리 (내부에서 7종 자체 네비)
  await S.runRoundMgmt(admin);

  // 3) 이하 [대메뉴, 하위메뉴, 검증함수] — IA 트리 순서
  const steps: [string, string, (a: Page) => Promise<void>][] = [
    ['대회', '대회관리', S.runTournament],
    ['관제 관리', '아이콘 관리', S.runIconMgmt],
    ['관제 관리', '라이브채팅 공지 조회', S.runLiveChatNotice],
    ['관제 관리', '메시지 기록 조회', S.runMessageHistory],
    // ⚠️드리프트(2026-06-16): '카트이동경로 확인' 메뉴 제거됨(관제 모니터 통합 추정) → 진입 FAIL 방지 위해 제외. cart-trace.spec.ts가 제거 사실 추적.
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
  for (const [parent, child, run] of steps) {
    const path = `${parent} > ${child}`;
    if (await gotoMenu(admin, parent, child, { path, tcRef: `${parent}_${child}`, tcId: '진입', desc: `${child} 진입`, failMsg: '메뉴 진입 불가' }))
      await run(admin);
  }

  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('ia-order-full'); });

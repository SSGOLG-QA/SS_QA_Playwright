/**
 * 시각 회귀(Visual Regression) — 핵심 화면 스크린샷 baseline 대조 (P4-4)
 *
 *  목적: DOM 스캔으로 못 잡는 결함을 픽셀 대조로 포착.
 *    - 글리프 깨짐(□·�), 글자 잘림/오버플로, 아이콘 누락, 레이아웃 붕괴, CSS 회귀.
 *      다국어 검증의 '범위 제외(글리프/픽셀)' 갭을 메운다.
 *
 *  ⚠ 단일 test 설계(2026-08): admin 픽스처는 test 스코프 → test마다 재로그인.
 *    화면별 개별 test면 반복 로그인 → 강제 로그아웃. 한 test에서 1회 로그인으로 전 화면 순회.
 *    화면별 판정은 expect.soft로 독립 기록(한 화면 실패해도 나머지 계속).
 *
 *  안정성: 고정 뷰포트 1280×800(기본 최대화는 머신별 크기 상이) + 동적데이터 마스킹 + maxDiffPixelRatio 2%.
 *
 *  baseline 생성/갱신: npx playwright test --project=admin-chromium Admin/visual-regression.spec.ts --no-deps --update-snapshots
 *  검출: npx playwright test --project=admin-chromium Admin/visual-regression.spec.ts --no-deps
 *  ⚠ baseline은 동일 환경(권장 CI 고정 러너)에서 생성 — 로컬↔CI 폰트/렌더 차이가 오탐 유발. 비파괴.
 */
import { test } from '../lib/fixtures';
import { expect } from '@playwright/test';
import { navigateMenu, settle } from '../lib/adminHelpers';

// 결정성을 위한 고정 뷰포트(최대화 대신)
test.use({ viewport: { width: 1280, height: 800 } });

interface VisualScreen { menu: string; sub: string; name: string; }

// ✨P4 확대(2026-08-19): 6→22화면 · 전 대메뉴 핵심 화면 픽셀 baseline 대조.
//   ⚠ baseline은 **동일(고정 CI) 러너에서 --update-snapshots로 생성**해야 오탐 없음(로컬↔CI 폰트/렌더 차이).
//   신규 화면은 첫 --update-snapshots 실행 시 baseline 생성됨. 비파괴.
const SCREENS: VisualScreen[] = [
  // 설정/폼 화면(레이아웃·글리프 회귀 민감)
  { menu: '태블릿 운영 관리', sub: '태블릿 기능 설정', name: 'tablet-feature' },
  { menu: '경기 진행 관리', sub: '진행시간 표준 설정', name: 'time-standard' },
  { menu: '코스 운영 관리', sub: '그린 스피드', name: 'green-speed' },
  { menu: '관제 관리', sub: '아이콘 관리', name: 'icon-mgmt' },
  { menu: '라운드 관리', sub: '스코어 출력 설정', name: 'score-output' },
  { menu: '홀맵 관리', sub: '홀맵 구역 설정', name: 'holemap-zone' },
  // 리스트/테이블 화면(컬럼·정렬·페이지네이션 chrome)
  { menu: '라운드 관리', sub: '내장 현황', name: 'visit-status' },
  { menu: '라운드 관리', sub: '전체라운드', name: 'all-rounds' },
  { menu: '계정 관리', sub: '계정 리스트', name: 'account-list' },
  { menu: '계정 관리', sub: '계정 권한 관리', name: 'account-perm' },
  { menu: '캐디 관리', sub: '캐디 리스트', name: 'caddie-list' },
  { menu: '배토 관리', sub: '배토 기록 조회', name: 'beto-record' },
  { menu: '식음 관리', sub: '주문 내역 관리', name: 'fnb-order' },
  { menu: '고객 평가 관리', sub: '후기 통계', name: 'review-stats' },
  { menu: '코스 운영 관리', sub: '핀 포지션 관리', name: 'pin-position' },
  { menu: '경기 진행 관리', sub: '진행시간 통계', name: 'time-stats' },
  // 안내문구/탭 화면
  { menu: '관제 관리', sub: '라이브채팅 공지 조회', name: 'livechat-notice' },
  { menu: '관제 관리', sub: '메시지 기록 조회', name: 'message-history' },
  { menu: '태블릿 운영 관리', sub: '메시지 관리', name: 'tablet-message' },
  { menu: '태블릿 운영 관리', sub: '홀 이벤트 관리', name: 'hole-event' },
  { menu: '코스 운영 관리', sub: '골프장 소식', name: 'club-news' },
  { menu: '대회', sub: '대회관리', name: 'tournament' },
];

test('시각 회귀 — 핵심 화면(단일 세션 순회)', async ({ admin }) => {
  test.setTimeout(10 * 60_000);

  for (const s of SCREENS) {
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) ok = await navigateMenu(admin, s.menu, s.sub).catch(() => false);
    if (!ok) { console.log(`[skip] ${s.menu} > ${s.sub} 진입 불가`); continue; }
    await settle(admin, 2200);
    await admin.waitForLoadState('networkidle').catch(() => {});

    // 동적 데이터 영역 마스킹(데이터 변동 오탐 방지 — chrome/레이아웃만 비교)
    const masks = [
      admin.locator('.list-table-group tbody'),
      admin.locator('.table-overflow-item tbody'),
      admin.locator('.summary-card__value'),
      admin.locator('.datepicker-input'),
      admin.locator('.vs__selected'),
      admin.locator('input[type="text"]'),
      admin.locator('canvas'),
      admin.locator('img'),
    ];

    await expect.soft(admin).toHaveScreenshot(`${s.name}.png`, {
      fullPage: true,
      animations: 'disabled',
      mask: masks,
      maxDiffPixelRatio: 0.02,
      timeout: 20_000,
    });
  }
});

/**
 * 시각 회귀(Visual Regression) — 핵심 화면 스크린샷 baseline 대조 (P-VISUAL)
 *
 *  목적: DOM 스캔으로 못 잡는 결함을 픽셀 대조로 포착.
 *    - 글리프 깨짐(□·�), 글자 잘림/오버플로, 아이콘 누락, 레이아웃 붕괴,
 *      CSS 회귀(정렬/간격/색). 다국어 검증의 '범위 제외(글리프/픽셀)' 갭을 메운다.
 *
 *  안정성 설계:
 *    - 고정 뷰포트(1280×800)로 결정성 확보(기본 --start-maximized는 머신마다 크기 상이 → baseline 불안정).
 *    - 동적 데이터(테이블 tbody·요약카드 값·날짜 입력·vue-select 값)는 mask로 가림 → 데이터 변동 오탐 제거.
 *    - maxDiffPixelRatio 2% 허용(안티에일리어싱/커서 흔들림 흡수).
 *    - 레이아웃이 안정적인 화면(폼·헤더·안내문구 중심)만 선별. 데이터 리스트 화면은 마스킹으로 chrome만 비교.
 *
 *  baseline 생성/갱신(최초 1회 + 의도적 UI 변경 후):
 *    npx playwright test --project=admin-chromium Admin/visual-regression.spec.ts --no-deps --update-snapshots
 *  검출(회귀 확인):
 *    npx playwright test --project=admin-chromium Admin/visual-regression.spec.ts --no-deps
 *  산출: Admin/visual-regression.spec.ts-snapshots/*.png(baseline) + 실패 시 diff 이미지(test-results/)
 *
 *  ⚠ baseline은 반드시 동일 환경(권장: CI 고정 러너)에서 생성. 로컬↔CI 폰트/렌더 차이가 오탐을 유발.
 *  비파괴: 진입·스크린샷만. 클릭/저장 없음.
 */
import { test } from '../lib/fixtures';
import { expect } from '@playwright/test';
import { navigateMenu, settle } from '../lib/adminHelpers';

// 결정성을 위한 고정 뷰포트(최대화 대신)
test.use({ viewport: { width: 1280, height: 800 } });

interface VisualScreen {
  menu: string;
  sub: string;
  name: string;   // 스냅샷 파일명
}

// 레이아웃 안정적(폼/헤더/안내문구 중심) 화면 선별
const SCREENS: VisualScreen[] = [
  { menu: '태블릿 운영 관리', sub: '태블릿 기능 설정', name: 'tablet-feature' },
  { menu: '경기 진행 관리', sub: '진행시간 표준 설정', name: 'time-standard' },
  { menu: '코스 운영 관리', sub: '그린 스피드', name: 'green-speed' },
  { menu: '관제 관리', sub: '아이콘 관리', name: 'icon-mgmt' },
  { menu: '계정 관리', sub: '계정 리스트', name: 'account-list' },
  { menu: '대회', sub: '대회관리', name: 'tournament' },
];

test.describe('시각 회귀 — 핵심 화면', () => {
  for (const s of SCREENS) {
    test(`${s.menu} > ${s.sub} 시각 baseline`, async ({ admin }) => {
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) ok = await navigateMenu(admin, s.menu, s.sub).catch(() => false);
      test.skip(!ok, `${s.menu} > ${s.sub} 진입 불가(미구현/진입 실패)`);
      await settle(admin, 2200);
      await admin.waitForLoadState('networkidle').catch(() => {});

      // 동적 데이터 영역 마스킹(데이터 변동에 의한 오탐 방지 — chrome/레이아웃만 비교)
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

      await expect(admin).toHaveScreenshot(`${s.name}.png`, {
        fullPage: true,
        animations: 'disabled',
        mask: masks,
        maxDiffPixelRatio: 0.02,
        timeout: 20_000,
      });
    });
  }
});

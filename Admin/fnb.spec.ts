import { test } from '../lib/fixtures';
import { runFnbVersion, runFnbRestaurant, runFnbProduct, runFnbOrderHistory } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 식음 관리 — 구현된 4종 통합 구조 기반 전수 검증 (드라이브 상세 TC 미작성)
//   실 SNB 4종: 버전 및 설정 / 식당 관리 / 상품 등록 관리 / 주문 내역 관리
//   (그늘집 및 TOS관리·식당·품목 매핑은 SNB 부재=미구현 → runIA에서 기록)
//   🔴 비파괴: 생성/수정/삭제/토글/동기화 금지(노출·활성만). 조회/검색/내보내기만 실행.
// 실행: npx playwright test --project=admin-chromium Admin/fnb.spec.ts --no-deps
const STEPS: [string, string, (p: any) => Promise<void>][] = [
  ['버전 및 설정', '식음 관리_버전 및 설정', runFnbVersion],
  ['식당 관리', '식음 관리_식당 관리', runFnbRestaurant],
  ['상품 등록 관리', '식음 관리_상품 등록 관리', runFnbProduct],
  ['주문 내역 관리', '식음 관리_주문 내역 관리', runFnbOrderHistory],
];

test('식음 관리 4종 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff();
  for (const [child, tcRef, fn] of STEPS) {
    if (await gotoMenu(admin, '식음 관리', child, { path: `식음 관리 > ${child}`, tcRef, tcId: '진입', desc: `${child} 진입`, failMsg: '메뉴 진입 불가' })) {
      await admin.locator('.info-box-text, .contents-box').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
      await fn(admin).catch(() => {});
    }
  }
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('fnb'); });

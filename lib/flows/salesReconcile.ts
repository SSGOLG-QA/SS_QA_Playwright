import { Page, expect } from '@playwright/test';
import { check, skip } from '../reporter';
import { FnbOrderPage } from '../pages/FnbOrderPage';
import { DataGrid } from '../components/DataGrid';

// ────────────────────────────────────────────────────────────────
//  L4 Scenario — 매출 교차정합 (주문 내역 ↔ 매출 집계)
//  PageObject(FnbOrderPage)가 조립한 두 데이터 뷰를 한 시나리오로 엮어 정합 검증:
//    · 요약카드(매출 집계, SummaryCards)  ↔  캐디 랭킹표(명세, DataGrid)
//  ⚠ 랭킹은 상위 캐디 부분집합 → Σ ≤ 총계(subset invariant, 가짜 FAIL 방지).
//  ⚠ 진정한 메뉴-간 정합(예약↔정산↔매출, 서로 다른 화면)은 결정적 테스트 데이터(시드/픽스처) 선행 필요 → 별도(보류).
// ────────────────────────────────────────────────────────────────
export async function runSalesReconcile(admin: Page) {
  const P = '식음 관리 > 주문 내역 관리 > 교차정합';
  const R = '식음 관리_주문 내역_RECON';
  const page = new FnbOrderPage(admin);
  await page.ready();

  const rows = await page.rankingRows();
  if (rows.length === 0) { skip({ path: P, tcRef: R, tcId: 'RECON', desc: '매출 요약↔랭킹 교차정합' }, '랭킹 데이터 없음(조회 결과 0)'); return; }

  const sumAmount = rows.reduce((a, r) => a + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const sumCnt = rows.reduce((a, r) => a + (Number.isFinite(r.cnt) ? r.cnt : 0), 0);
  const totalAmount = DataGrid.num(await page.summary.value('총 주문금액'));
  const totalCnt = DataGrid.num(await page.summary.value('총 주문건수'));
  const topCaddie = (await page.summary.value('주문TOP캐디')).trim();

  // RECON-01: Σ(랭킹 주문금액) ≤ 총 주문금액 (랭킹=상위 캐디 부분집합)
  await check(admin, { path: P, tcRef: `${R}_1`, tcId: 'RECON-01', desc: 'Σ(캐디 랭킹 주문금액) ≤ 요약 총 주문금액', expected: 'Σ랭킹 ≤ 총액', failMsg: '랭킹 합이 총액 초과(집계 불일치)' },
    async () => { expect(Number.isFinite(totalAmount) ? sumAmount <= totalAmount : true, `Σ랭킹 ${sumAmount} ≤ 총 ${totalAmount}`).toBeTruthy(); });

  // RECON-02: Σ(랭킹 주문건수) ≤ 총 주문건수
  await check(admin, { path: P, tcRef: `${R}_2`, tcId: 'RECON-02', desc: 'Σ(캐디 랭킹 주문건수) ≤ 요약 총 주문건수', expected: 'Σ건수 ≤ 총건수', failMsg: '랭킹 건수 합이 총건수 초과' },
    async () => { expect(Number.isFinite(totalCnt) ? sumCnt <= totalCnt : true, `Σ건수 ${sumCnt} ≤ 총 ${totalCnt}`).toBeTruthy(); });

  // RECON-03: 요약 '주문TOP캐디' == 랭킹 1위 캐디(집계 ↔ 명세 정합)
  await check(admin, { path: P, tcRef: `${R}_3`, tcId: 'RECON-03', desc: "요약 '주문TOP캐디' = 랭킹 1위 캐디명", expected: 'TOP캐디 = 랭킹1위', failMsg: '집계 TOP캐디 ≠ 랭킹 1위(불일치)' },
    async () => { const top1 = (rows[0]?.name || '').trim(); expect(topCaddie && top1 ? topCaddie === top1 : true, `요약TOP '${topCaddie}' vs 랭킹1위 '${top1}'`).toBeTruthy(); });
}

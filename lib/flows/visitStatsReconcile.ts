import { Page, expect } from '@playwright/test';
import { check, skip } from '../reporter';
import { RoundStatsPage } from '../pages/RoundStatsPage';

// ────────────────────────────────────────────────────────────────
//  L4 Scenario — 내장 통계 교차정합 (요약 집계 ↔ 통계표 명세)
//  RoundStatsPage가 조립한 SummaryCards ↔ DataGrid 두 뷰를 엮어 정합 검증.
//   · 남성/여성 비중 합 ≈ 100% (요약 카드 내부 정합)
//   · Σ(통계표 가시행 SS회원수) ≤ 요약 '총 스스회원 내장객' (요약↔명세 subset, 페이지네이션 고려)
//  ⚠ 가짜 FAIL 방지: 데이터 없음/컬럼 미발견 시 SKIP.
// ────────────────────────────────────────────────────────────────
export async function runVisitStatsReconcile(admin: Page) {
  const P = '라운드관리 > 내장 통계 > 교차정합';
  const R = '라운드 관리_내장 통계_RECON';
  const page = new RoundStatsPage(admin);
  await page.ready();

  // VSTAT-RECON-01: 남성/여성 비중 합 ≈ 100%
  const [m, f] = await page.genderRatio();
  if (Number.isFinite(m) && Number.isFinite(f))
    await check(admin, { path: P, tcRef: `${R}_1`, tcId: 'VSTAT-RECON-01', desc: '요약 남성/여성 비중 합 ≈ 100%', expected: '합 ≈ 100', failMsg: '비중 합 100% 아님' },
      async () => { expect(Math.abs(m + f - 100), `${m}+${f}`).toBeLessThanOrEqual(1); });
  else
    skip({ path: P, tcRef: `${R}_1`, tcId: 'VSTAT-RECON-01', desc: '요약 남성/여성 비중 합 ≈ 100%' }, '비중 값 없음(데이터 의존)');

  // VSTAT-RECON-02: Σ(통계표 SS회원수) ≤ 총 스스회원 내장객 (요약 ↔ 명세, 페이지네이션 subset)
  const total = await page.totalSsMembers();
  const visibleSum = await page.columnSum(/SS회원수|회원수|SS회원/);
  if (await page.isEmpty() || !Number.isFinite(visibleSum) || !Number.isFinite(total))
    skip({ path: P, tcRef: `${R}_2`, tcId: 'VSTAT-RECON-02', desc: 'Σ(통계표 SS회원수) ≤ 총 스스회원 내장객' }, '통계표 비어있음/SS 컬럼 미발견(데이터 의존)');
  else
    await check(admin, { path: P, tcRef: `${R}_2`, tcId: 'VSTAT-RECON-02', desc: 'Σ(통계표 가시행 SS회원수) ≤ 요약 총 스스회원 내장객(subset)', expected: 'Σ ≤ 총계', failMsg: '명세 합이 집계 초과(불일치)' },
      async () => { expect(visibleSum <= total, `Σ가시 ${visibleSum} ≤ 총 ${total}`).toBeTruthy(); });
}

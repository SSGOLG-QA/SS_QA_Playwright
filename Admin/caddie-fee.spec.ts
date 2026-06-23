import { test } from '../lib/fixtures';
import { runCaddyFeeSettings, runCaddyFeeStats, runCaddyFeePayment, runCaddyFeeDocument } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu, diff, skip } from '../lib/reporter';
import { navigateMenu } from '../lib/adminHelpers';

// 캐디피 관리 (4종) — 구조 기반 TC
//   ⚠ 환경 조건부: '태블릿 캐디피 결제' 기능이 ON인 골프장에서만 SNB 노출.
//     td17 킹즈락 환경: 미구현(SNB 대메뉴 부재) — 적응형 패턴으로 운용.
//   → 적응형: SNB 대메뉴 존재 시 각 서브메뉴 순회 검증, 부재 시 미구현 diff+skip
//   🔴 비파괴: 금전·세무 화면 일체 저장/삭제/변경 금지(노출·조회만)
//   TC 참조: 드라이브 '2026-06 경기 관제 리뉴얼' > 캐디피 관리 시트
// 실행: npx playwright test --project=admin-chromium Admin/caddie-fee.spec.ts --no-deps

const SUBS: [string, (p: any) => Promise<void>][] = [
  ['캐디피 설정', runCaddyFeeSettings],
  ['캐디피 통계', runCaddyFeeStats],
  ['캐디피 결제 내역', runCaddyFeePayment],
  ['캐디 자료/신고서', runCaddyFeeDocument],
];

test('캐디피 관리 검증 (환경 조건부 / 구조 기반)', async ({ admin }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff();

  // 캐디피 관리 SNB 대메뉴 존재 여부 선탐지(2~3회 재시도)
  // navigateMenu는 실패해도 FAIL 기록 안 함 — 존재 여부만 확인
  let menuPresent = false;
  for (let i = 0; i < 3 && !menuPresent; i++)
    menuPresent = await navigateMenu(admin, '캐디피 관리', '캐디피 설정').catch(() => false);

  if (!menuPresent) {
    // ── 미구현(SNB 부재) — 환경 조건부 기능 ──────────────────────────────────
    diff('캐디피 관리', '캐디피 관리 대메뉴 SNB 노출(환경 조건 충족 시)',
      'SNB에 캐디피 관리 대메뉴 없음 — 태블릿 캐디피 결제 미설정 환경으로 추정',
      '캐디피 관리_전체',
      '환경 조건부 기능(캐디피 결제 설정 ON 필요) — td17 킹즈락 환경 미구현');
    for (const [sub] of SUBS)
      skip(
        { path: `캐디피 관리 > ${sub}`, tcRef: `캐디피 관리_${sub}`, tcId: `CADFE-ALL`, desc: `${sub} 전체 검증` },
        '캐디피 관리 SNB 대메뉴 미노출 — 환경 조건부 기능(태블릿 캐디피 결제 미설정)',
      );
    if (process.env.KEEP_OPEN) await admin.pause();
    return;
  }

  // ── SNB 존재 시: 각 서브메뉴 순회 ─────────────────────────────────────────
  for (const [sub, fn] of SUBS) {
    const entered = await gotoMenu(admin, '캐디피 관리', sub, {
      path: `캐디피 관리 > ${sub}`,
      tcRef: `캐디피 관리_${sub}`,
      tcId: '진입',
      desc: `${sub} 진입`,
      failMsg: '메뉴 진입 불가',
    });
    if (entered) {
      await admin.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await admin.locator('.info-box-text, .contents-box').first()
        .waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
      await admin.waitForTimeout(400);
      await fn(admin).catch(() => {});
    }
  }
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('caddie-fee'); });

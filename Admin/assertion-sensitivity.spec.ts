/**
 * 단언 민감도 정식 검증 스위트 (P3-B)
 *
 * 목적: 각 검증 패턴(check/checkText/toBeVisible/…)이 falsifiable 한가 —
 *       제품 결함을 시뮬레이션(DOM 결함 주입)했을 때 FAIL로 뒤집히는가(mutant kill).
 *       뒤집히지 않으면(survive) "가짜 PASS(vacuous pass)" 위험 단언으로 분류.
 *
 * 대상 화면(4개) × 케이스(A~E, 5종) = 최대 20건 측정:
 *   1. 관제 관리 > 라이브채팅 공지 조회  — 안내문구 + 버튼
 *   2. 코스 운영 관리 > 코스 분석        — 안내문구 + 컬럼 헤더
 *   3. 고객 평가 관리 > 후기 통계        — 안내문구 + 컬럼 헤더 + 버튼
 *   4. 캐디 관리 > 캐디 리스트           — 컬럼 헤더 + 버튼
 *
 * 케이스:
 *   A: checkText 안내문구 전문 일치          → 민감(변조 즉시 FAIL) 기대
 *   B: body.includes 부분 일치              → 둔감 입증(매칭 구간 밖 변조 미검출)
 *   C: count ≥ 1 느슨한 버튼 단언           → 둔감 입증(다수 소실 미검출)
 *   D: toBeVisible 존재 단언                → 민감(요소 숨김 시 FAIL) 기대
 *   E: columnheader 정확 일치               → 민감(헤더 변조 시 FAIL) 기대
 *
 * 비파괴 보장:
 *   - 변형은 in-page DOM(page.evaluate)에만 적용. 서버/네트워크 쓰기 없음.
 *   - 각 케이스 mutate() → revert() 패턴으로 측정 직후 원복.
 *   - ALLOW_DESTRUCTIVE 불필요.
 *
 * 실행:
 *   npx playwright test --project=admin-chromium Admin/assertion-sensitivity.spec.ts --no-deps
 * 산출:
 *   reports/단언민감도_report_*.xlsx
 */

import { test } from '../lib/fixtures';
import { gotoMenu, resetResults, resetNoTC, resetDiff, writeReport, skip } from '../lib/reporter';
import { settle } from '../lib/adminHelpers';
import {
  evaluateSensCases, recordVerdicts, currentScreenLabel,
  caseA, caseB, caseC, caseD, caseE,
  SensCase,
} from '../lib/assertionSens';

const TOP = '단언민감도';

// ── 검증 대상 화면 정의 ──────────────────────────────────────────
const SENS_SCREENS: Array<{
  parent: string;
  child: string;
  cases: (admin: import('@playwright/test').Page, screen: string) => SensCase[];
}> = [
  {
    parent: '관제 관리', child: '라이브채팅 공지 조회',
    cases: (admin, screen) => {
      const ctx = { infoText: '' };
      return [caseA(admin, screen, TOP, ctx), caseB(admin, screen, TOP, ctx), caseC(admin, screen, TOP), caseD(admin, screen, TOP)];
    },
  },
  {
    parent: '코스 운영 관리', child: '코스 분석',
    cases: (admin, screen) => {
      const ctx = { infoText: '', colHeader: '' };
      return [caseA(admin, screen, TOP, ctx), caseB(admin, screen, TOP, ctx), caseD(admin, screen, TOP), caseE(admin, screen, TOP, ctx)];
    },
  },
  {
    parent: '고객 평가 관리', child: '후기 통계',
    cases: (admin, screen) => {
      const ctx = { infoText: '', colHeader: '' };
      return [caseA(admin, screen, TOP, ctx), caseB(admin, screen, TOP, ctx), caseC(admin, screen, TOP), caseD(admin, screen, TOP), caseE(admin, screen, TOP, ctx)];
    },
  },
  {
    parent: '캐디 관리', child: '캐디 리스트',
    cases: (admin, screen) => {
      const ctx = { infoText: '', colHeader: '' };
      return [caseC(admin, screen, TOP), caseD(admin, screen, TOP), caseE(admin, screen, TOP, ctx)];
    },
  },
];

test('단언 민감도 정식 검증 스위트 — 4개 화면 × A~E 케이스', async ({ admin }) => {
  test.setTimeout(480_000);
  resetResults(); resetNoTC(); resetDiff();

  let totalPass = 0, totalFail = 0, totalSkip = 0;

  for (const { parent, child, cases } of SENS_SCREENS) {
    const menuPath = `${parent} > ${child}`;
    const entered = await gotoMenu(admin, parent, child, {
      path: `${TOP} > ${menuPath}`, tcRef: '-', tcId: '진입',
      desc: `${child} 진입`, failMsg: '메뉴 진입 불가',
    }).catch(() => false);

    if (!entered) {
      skip({ path: `${TOP} > ${menuPath} > 민감도`, tcRef: '-', tcId: 'SKIP', desc: `${child} 민감도 전체` }, '메뉴 진입 불가');
      continue;
    }

    await settle(admin, 1200);
    const screen = await currentScreenLabel(admin);
    const casesForScreen = cases(admin, screen);

    console.log(`\n[단언민감도] ─── ${menuPath} (케이스 ${casesForScreen.length}건) ───`);
    const verdicts = await evaluateSensCases(casesForScreen);
    recordVerdicts(verdicts, TOP);

    const p = verdicts.filter(v => v.result === 'PASS').length;
    const f = verdicts.filter(v => v.result === 'FAIL').length;
    const s = verdicts.filter(v => v.result === 'SKIP').length;
    console.log(`[단언민감도] ${menuPath} — 민감 ${p} / 둔감 ${f} / 보류 ${s}`);
    totalPass += p; totalFail += f; totalSkip += s;
  }

  console.log(`\n[단언민감도] ══ 전체 결과 ══ 민감 ${totalPass} / 둔감 ${totalFail} / 보류 ${totalSkip}\n`);

  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('단언민감도'); });

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNum, materialLedgerInvariant, costAggregateInvariant,
  budgetSubtotalInvariant, budgetSubtotalMatrixInvariant, summaryTotalInvariant,
} from '../lib/course/domain/invariants';

// 코스관리 계산 불변식 순수 로직 단위테스트 — 세션 불필요. 실행: npm run test:unit

// ── parseNum ─────────────────────────────────────────────────────
test('parseNum: 콤마/단위 제거·빈값·대시', () => {
  assert.equal(parseNum('1,210 개'), 1210);
  assert.equal(parseNum('999,999,999,000'), 999999999000);
  assert.equal(parseNum('-12'), -12);
  assert.equal(parseNum('-'), null);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum(null), null);
  assert.equal(parseNum('없음'), null);
});

// ── 자재 수불: 기말 = 기초 + 입고 − 출고 ─────────────────────────
test('materialLedgerInvariant: 정상/위반/비수치 skip', () => {
  const ok = materialLedgerInvariant([
    { name: 'A', base: 10, in: 1200, out: 0, end: 1210 },
    { name: 'B', base: 100, in: 1013, out: 0, end: 1113 },
    { name: 'C', base: 10, in: 30, out: 40, end: 0 },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.checked, 3);
  assert.equal(ok.violations.length, 0);

  const bad = materialLedgerInvariant([{ name: 'X', base: 10, in: 5, out: 0, end: 99 }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations[0].expected, 15);
  assert.equal(bad.violations[0].actual, 99);

  // NaN 포함 행은 검증 제외(checked 미증가)
  const skipRow = materialLedgerInvariant([{ name: 'N', base: NaN, in: 1, out: 0, end: 1 }]);
  assert.equal(skipRow.checked, 0);
});

// ── 비용 집계: 차액 = 작업지시 − 실제발생 ────────────────────────
test('costAggregateInvariant: 차액 검증', () => {
  const r = costAggregateInvariant([
    { label: '합계', order: 1862165, actual: 0, diff: 1862165 },
    { label: '고정직', order: 1174246, actual: 0, diff: 1174246 },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.checked, 2);

  const bad = costAggregateInvariant([{ label: 'x', order: 100, actual: 30, diff: 60 }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations[0].expected, 70);
});

// ── 예산 소계(단일 열) ───────────────────────────────────────────
test('budgetSubtotalInvariant: 소계 = Σ소분류', () => {
  const r = budgetSubtotalInvariant([{ name: '급여', items: [10, 20, 30], subtotal: 60 }]);
  assert.equal(r.ok, true);
  const bad = budgetSubtotalInvariant([{ name: '급여', items: [10, 20], subtotal: 40 }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations[0].expected, 30);
});

// ── 예산 소계(다열 매트릭스) ─────────────────────────────────────
test('budgetSubtotalMatrixInvariant: 열별 소계 = Σ행', () => {
  // 2개 소분류 × [합계,1월,2월], 소계 = 열별 합
  const ok = budgetSubtotalMatrixInvariant([
    { name: '급여', rows: [[30, 10, 20], [70, 40, 30]], subtotal: [100, 50, 50] },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.checked, 3);      // 3개 열 검증

  // 전부 0(테스트 데이터) → 0=0 통과
  const zeros = budgetSubtotalMatrixInvariant([
    { name: 'g', rows: [[0, 0], [0, 0]], subtotal: [0, 0] },
  ]);
  assert.equal(zeros.ok, true);

  // 한 열 위반
  const bad = budgetSubtotalMatrixInvariant([
    { name: '급여', rows: [[30, 10], [70, 40]], subtotal: [100, 99] },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations[0].expected, 50);
  assert.equal(bad.violations[0].actual, 99);

  // 행/소계 길이 상이 → 공통 길이(min)만 비교
  const ragged = budgetSubtotalMatrixInvariant([
    { name: 'g', rows: [[1, 2, 3]], subtotal: [1, 2] },
  ]);
  assert.equal(ragged.checked, 2);
  assert.equal(ragged.ok, true);

  // 행 셀이 NaN이면 0으로 취급하고 합산(오탐 없이 통과)
  const nanCell = budgetSubtotalMatrixInvariant([
    { name: 'g', rows: [[NaN, 10], [5, 20]], subtotal: [5, 30] },
  ]);
  assert.equal(nanCell.ok, true);
  assert.equal(nanCell.checked, 2);

  // 빈 행 또는 빈 소계 → 그룹 건너뜀(checked 0)
  const empty = budgetSubtotalMatrixInvariant([{ name: 'g', rows: [], subtotal: [1] }]);
  assert.equal(empty.checked, 0);
  assert.equal(empty.ok, true);
});

// ── 총계 = Σ구분 카드 (인력 관리 등) ─────────────────────────────
test('summaryTotalInvariant: 총계 = Σ구분 / 위반 / 파싱실패 skip', () => {
  const ok = summaryTotalInvariant(9, [4, 2, 2, 1]);
  assert.equal(ok.ok, true);
  assert.equal(ok.checked, 1);
  assert.equal(ok.violations.length, 0);

  // 위반: 총 4 ≠ 4+2+2+1=9 (실측서 관찰된 인력관리 총계≠행수 유형)
  const bad = summaryTotalInvariant(4, [4, 2, 2, 1]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations[0].expected, 9);
  assert.equal(bad.violations[0].actual, 4);

  // 빈 parts → 검증 생략(checked 0, 오탐 방지)
  assert.equal(summaryTotalInvariant(5, []).checked, 0);
  // NaN 총계 → 검증 생략
  assert.equal(summaryTotalInvariant(NaN, [1, 2]).checked, 0);
  // parts에 NaN 포함 → 검증 생략
  assert.equal(summaryTotalInvariant(3, [1, NaN]).checked, 0);
  // 단일 구분 = 총계
  assert.equal(summaryTotalInvariant(7, [7]).ok, true);
});

// ── 경계·부호 엣지케이스 ─────────────────────────────────────────
test('parseNum: 소수·음수콤마·다중부호·순수기호', () => {
  assert.equal(parseNum('3.5'), 3.5);
  assert.equal(parseNum('-1,234'), -1234);
  assert.equal(parseNum('12.5%'), 12.5);
  assert.equal(parseNum('.'), null);       // 점만 → null
  assert.equal(parseNum('₩0'), 0);         // 0은 유효값(null 아님)
});

test('near 허용오차(0.5): 소계/기말 경계', () => {
  // 0.5 이내 통과, 초과 위반 — 반올림/표시 오차 흡수
  assert.equal(budgetSubtotalInvariant([{ name: 'a', items: [10, 20], subtotal: 30.5 }]).ok, true);
  assert.equal(budgetSubtotalInvariant([{ name: 'a', items: [10, 20], subtotal: 30.6 }]).ok, false);
});

test('materialLedgerInvariant: 다중 위반 카운트·음수 기말', () => {
  const r = materialLedgerInvariant([
    { name: 'A', base: 10, in: 0, out: 0, end: 99 },   // 위반
    { name: 'B', base: 5, in: 0, out: 0, end: 5 },     // 정상
    { name: 'C', base: 0, in: 0, out: 40, end: -40 },  // 정상(음수 기말 허용)
    { name: 'D', base: 10, in: 5, out: 0, end: 14 },   // 위반(기대 15)
  ]);
  assert.equal(r.checked, 4);
  assert.equal(r.violations.length, 2);
  assert.equal(r.ok, false);
});

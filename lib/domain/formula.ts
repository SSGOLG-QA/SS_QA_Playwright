// ────────────────────────────────────────────────────────────────
//  순수 계산 로직(브라우저 무관) — 단위테스트 + 뮤테이션 테스트(StrykerJS) 대상.
//  calcChecks.ts(브라우저 글루: verifyInvariants/lockOrSkipFormula)에서 분리.
//   · Invariant / RatioCandidate : 도메인 오라클 공통 타입
//   · inferFormula               : 표시 정밀도 자동감지 후 비율/파생 공식 후보 적합도 산출
// ────────────────────────────────────────────────────────────────
export type Invariant = { name: string; ok: boolean; detail: string };
export type RatioCandidate<T> = { label: string; calc: (r: T) => number };

/** 표시 정밀도 자동감지(전 행 정수면 정수 반올림, 아니면 소수1자리)해 후보를 동일 정밀도로 맞춰 적합도 산출 */
export function inferFormula<T>(rows: T[], shown: (r: T) => number, cands: RatioCandidate<T>[], tol = 0.15) {
  const usable = rows.filter(r => Number.isFinite(shown(r)));
  const allInt = usable.length > 0 && usable.every(r => Number.isInteger(shown(r)));
  const adj = (x: number) => (allInt ? Math.round(x) : Math.round(x * 10) / 10);
  return cands.map(c => ({
    label: c.label,
    fit: usable.filter(r => Number.isFinite(c.calc(r)) && Math.abs(adj(c.calc(r)) - shown(r)) <= tol).length,
    of: usable.length,
  })).sort((a, b) => b.fit - a.fit);
}

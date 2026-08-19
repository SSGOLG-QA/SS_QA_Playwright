// ──────────────────────────────────────────────────────────────
//  코스관리 계산 불변식 (순수 함수 — DOM/네트워크 비의존, 단위테스트 가능)
//  실측 화면 구조(2026-08-05) 기반:
//   - 자재 수불(품목별): 수량[기초/입고/출고/기말] → 기말 = 기초 + 입고 − 출고
//   - 비용 집계: [작업지시 비용 합계 / 실제 발생 비용 합계 / 차액] → 차액 = 작업지시 − 실제발생
//   - 예산 상세: 소계 = Σ(해당 중분류의 소분류 값)  (월별/합계 각각)
// ──────────────────────────────────────────────────────────────

export interface Violation { label: string; expected: number; actual: number; }
export interface InvariantResult { ok: boolean; checked: number; violations: Violation[]; }

const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

// 숫자 파싱: "1,210 개" / "999,999,999,000" / "-" → number|null
export function parseNum(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = String(s).replace(/[^0-9.\-]/g, '');
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ── 자재 수불: 기말수량 = 기초 + 입고 − 출고 ─────────────────────
export interface LedgerRow { name: string; base: number; in: number; out: number; end: number; }
export function materialLedgerInvariant(rows: LedgerRow[]): InvariantResult {
  const violations: Violation[] = [];
  let checked = 0;
  for (const r of rows) {
    if ([r.base, r.in, r.out, r.end].some((v) => !Number.isFinite(v))) continue;
    checked++;
    const expect = r.base + r.in - r.out;
    if (!near(r.end, expect)) violations.push({ label: `${r.name} 기말수량`, expected: expect, actual: r.end });
  }
  return { ok: violations.length === 0, checked, violations };
}

// ── 비용 집계: 차액 = 작업지시 비용 − 실제 발생 비용 (분류별) ────────
export interface CostCol { label: string; order: number; actual: number; diff: number; }
export function costAggregateInvariant(cols: CostCol[]): InvariantResult {
  const violations: Violation[] = [];
  let checked = 0;
  for (const c of cols) {
    if ([c.order, c.actual, c.diff].some((v) => !Number.isFinite(v))) continue;
    checked++;
    const expect = c.order - c.actual;
    if (!near(c.diff, expect)) violations.push({ label: `${c.label} 차액`, expected: expect, actual: c.diff });
  }
  return { ok: violations.length === 0, checked, violations };
}

// ── 테이블 집계: 총계 = Σ(구분 카드) ─────────────────────────────
//   예) 인력 관리: 총 N명 = 고정직 정규 + 고정직 계약 + 임시직 장기 + 임시직 단기
export function summaryTotalInvariant(total: number, parts: number[]): InvariantResult {
  if (!Number.isFinite(total) || !parts.length || !parts.every((v) => Number.isFinite(v))) {
    return { ok: true, checked: 0, violations: [] };   // 파싱 실패 → 검증 생략(오탐 방지)
  }
  const sum = parts.reduce((a, b) => a + b, 0);
  const ok = near(total, sum);
  return { ok, checked: 1, violations: ok ? [] : [{ label: '총계 = Σ구분', expected: sum, actual: total }] };
}

// ── 예산 상세(단일 열): 소계 = Σ(소분류) ─────────────────────────
export interface BudgetGroup { name: string; items: number[]; subtotal: number; }
export function budgetSubtotalInvariant(groups: BudgetGroup[]): InvariantResult {
  const violations: Violation[] = [];
  let checked = 0;
  for (const g of groups) {
    if (!g.items.every((v) => Number.isFinite(v)) || !Number.isFinite(g.subtotal)) continue;
    checked++;
    const sum = g.items.reduce((a, b) => a + b, 0);
    if (!near(g.subtotal, sum)) violations.push({ label: `${g.name} 소계`, expected: sum, actual: g.subtotal });
  }
  return { ok: violations.length === 0, checked, violations };
}

// ── 예산 상세(다열 매트릭스): 소계[열] = Σ_소분류(행[열]) ──────────
//   각 중분류 그룹 = { 소분류 행들(rows: 행별 [합계,1월..12월] 숫자벡터), 소계벡터(subtotal) }.
//   열마다 Σ(rows[*][j]) == subtotal[j] 검증. 행/소계 벡터 길이가 다르면 공통 길이만 비교.
export interface BudgetMatrixGroup { name: string; rows: number[][]; subtotal: number[]; }
export function budgetSubtotalMatrixInvariant(groups: BudgetMatrixGroup[]): InvariantResult {
  const violations: Violation[] = [];
  let checked = 0;
  for (const g of groups) {
    if (!g.rows.length || !g.subtotal.length) continue;
    const cols = Math.min(g.subtotal.length, ...g.rows.map((r) => r.length));
    if (!Number.isFinite(cols) || cols <= 0) continue;
    for (let j = 0; j < cols; j++) {
      checked++;
      const sum = g.rows.reduce((a, r) => a + (Number.isFinite(r[j]) ? r[j] : 0), 0);
      if (!near(g.subtotal[j], sum)) {
        violations.push({ label: `${g.name} 소계[열${j}]`, expected: sum, actual: g.subtotal[j] });
      }
    }
  }
  return { ok: violations.length === 0, checked, violations };
}

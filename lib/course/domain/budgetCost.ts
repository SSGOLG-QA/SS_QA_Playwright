// ──────────────────────────────────────────────────────────────
//  예산/비용 화면 간(cross-screen) 계산 정합성 불변식 (순수 함수).
//  실측(2026-08-12) 데이터 기반:
//   - 같은 총비용(2026 1,862,165)이 비용집계/분류별/위치별/기간별에 다른 축으로 재집계 → 총합 동일해야.
//   - 비용집계 관리비유형별 값 = Σ(분류별 화면 해당 컬럼).
//   - 예산 총괄[중분류][월] = 예산 상세 소계[중분류][월].
//   - 소계 = Σ소분류(상세/실적) / 행 합계 = Σ관리비유형(분류별).
// ──────────────────────────────────────────────────────────────

export interface Check {
  name: string;
  scope: 'cross' | 'intra' | 'source';
  ok: boolean;
  detail: string;
  values?: { label: string; value: number | null }[];
}

export const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
// 상대 허용오차(반올림 표기 대응 — 166.66 vs 166.67). 0에 대해선 절대 1.
export const nearRel = (a: number, b: number, rel = 0.005) => (Math.abs(b) < 1 ? Math.abs(a - b) <= 1 : Math.abs(a - b) / Math.abs(b) <= rel);

// 문자열 첫 숫자 토큰 파싱("1,862,165▼ -97.4%" → 1862165). 음수 허용.
export function firstNum(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = String(s).replace(/\s/g, '').match(/-?[\d,]*\d/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
export function num(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = String(s).replace(/[^0-9.\-]/g, '');
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// 여러 총계가 모두 동일한지(교차 화면 총비용 일치).
export function crossTotalsEqual(name: string, totals: { label: string; value: number | null }[]): Check {
  const present = totals.filter((t) => t.value != null) as { label: string; value: number }[];
  if (present.length < 2) return { name, scope: 'cross', ok: true, detail: `비교 대상 부족(${present.length}개) — 검증 생략`, values: totals };
  const base = present[0].value;
  const bad = present.filter((t) => !near(t.value, base));
  return {
    name, scope: 'cross', ok: bad.length === 0, values: totals,
    detail: bad.length === 0
      ? `${present.length}개 화면 총계 일치: ${base.toLocaleString()}`
      : `불일치: ${present.map((t) => `${t.label}=${t.value.toLocaleString()}`).join(' / ')}`,
  };
}

// 합계 = Σ부분 (행 합계=Σ관리비유형, 총계=Σ행, 소계=Σ소분류 등 범용).
export function sumEquals(name: string, scope: 'cross' | 'intra', total: number | null, parts: (number | null)[]): Check {
  if (total == null || parts.some((p) => p == null)) return { name, scope, ok: true, detail: '데이터 없음 — 생략' };
  const sum = (parts as number[]).reduce((a, b) => a + b, 0);
  return { name, scope, ok: near(total, sum), detail: near(total, sum) ? `합계 ${total.toLocaleString()} = Σ ${sum.toLocaleString()}` : `불일치: 합계 ${total.toLocaleString()} ≠ Σ ${sum.toLocaleString()}` };
}

// 두 벡터(관리비유형별)가 항목별 동일한지: 비용집계 분류값 vs Σ(분류별 컬럼).
export function vectorEquals(name: string, a: (number | null)[], b: (number | null)[], labels: string[]): Check {
  const n = Math.min(a.length, b.length);
  const bad: string[] = [];
  let checked = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] == null || b[i] == null) continue;
    checked++;
    if (!near(a[i] as number, b[i] as number)) bad.push(`${labels[i] || i}: ${(a[i] as number).toLocaleString()}≠${(b[i] as number).toLocaleString()}`);
  }
  return { name, scope: 'cross', ok: bad.length === 0, detail: bad.length === 0 ? `${checked}개 항목 일치` : `불일치: ${bad.join(' / ')}` };
}

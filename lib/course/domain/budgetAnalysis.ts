// ──────────────────────────────────────────────────────────────
//  예산 분석(/budget/anal/monthly/init) 공급 데이터 순수 불변식.
//   차트는 DOM에 수치 부재(Highcharts) → 공급 API를 검증(course-chart-integrity 패턴).
//   API data: 6그룹(고정직/임시직/코스자재/장비/기타 + 합계Total), 각 행:
//     budgetPlan[12](월 예산) · budgetPerform[12](당월 실적) · budgetDiff[12](초과분) · budgetRate[12](사용률%)
//     budgetAccumPlan/Perform/Diff/Rate[12](누적). ⚠ 미래월 실적 0 → budgetRate= -100(센티넬, 사용률 검증서 제외).
// ──────────────────────────────────────────────────────────────

export interface AnalRow {
  cat0Idx?: number | null; cat1Idx?: number | null; cat2Idx?: number | null;
  cat1Name?: string; cat2Name?: string;
  budgetPlan: number[]; budgetPerform: number[]; budgetDiff: number[]; budgetRate: number[];
  budgetAccumPlan?: number[]; budgetAccumPerform?: number[]; budgetAccumDiff?: number[]; budgetAccumRate?: number[];
}
export interface AC { name: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const cumsum = (a: number[]): number[] => { const o: number[] = []; let s = 0; for (const x of a) { s += (x || 0); o.push(s); } return o; };

/** 한 그룹(카테고리 items)의 월별·누적 불변식 6종. 각 (행×월) 검사 후 항목별 위반 집계. */
export function analysisInvariants(rows: AnalRow[], group: string): AC[] {
  const out: AC[] = [];
  const chk = (name: string, test: (r: AnalRow, m: number) => boolean | null) => {
    let bad = 0, cnt = 0; const ex: string[] = [];
    for (const r of rows) for (let m = 0; m < 12; m++) { const v = test(r, m); if (v === null) continue; cnt++; if (!v) { bad++; if (ex.length < 3) ex.push(`${r.cat1Name ?? ''}/${r.cat2Name ?? ''} ${m + 1}월`); } }
    out.push({ name: `${group} · ${name}`, ok: bad === 0, na: cnt === 0, detail: cnt === 0 ? '대상 없음' : `${cnt}건 중 ${cnt - bad} 성립${bad ? ` · 위반 ${bad}(${ex.join(', ')})` : ''}` });
  };
  chk('초과분 = 실적 − 예산(월)', (r, m) => (r.budgetPlan?.[m] == null || r.budgetPerform?.[m] == null || r.budgetDiff?.[m] == null) ? null : near(r.budgetDiff[m], r.budgetPerform[m] - r.budgetPlan[m], 1));
  chk('사용률 = 실적 ÷ 예산 ×100(월)', (r, m) => { const p = r.budgetPlan?.[m], a = r.budgetPerform?.[m], rt = r.budgetRate?.[m]; if (p == null || a == null || rt == null || p <= 0 || a <= 0 || rt <= -100) return null; return Math.abs(rt - a / p * 100) <= 0.05; });
  chk('누적예산 = Σ(월 예산)', (r, m) => r.budgetAccumPlan?.[m] == null ? null : near(r.budgetAccumPlan[m], cumsum(r.budgetPlan)[m], 1));
  chk('누적실적 = Σ(월 실적)', (r, m) => r.budgetAccumPerform?.[m] == null ? null : near(r.budgetAccumPerform[m], cumsum(r.budgetPerform)[m], 1));
  chk('누적차액 = 누적실적 − 누적예산', (r, m) => (r.budgetAccumDiff?.[m] == null || r.budgetAccumPerform?.[m] == null || r.budgetAccumPlan?.[m] == null) ? null : near(r.budgetAccumDiff[m], r.budgetAccumPerform[m] - r.budgetAccumPlan[m], 1));
  chk('누적사용률 = 누적실적 ÷ 누적예산', (r, m) => { const p = r.budgetAccumPlan?.[m], a = r.budgetAccumPerform?.[m], rt = r.budgetAccumRate?.[m]; if (p == null || a == null || rt == null || p <= 0) return null; return Math.abs(rt - a / p * 100) <= 0.05; });
  return out;
}

/** 합계(Total) = Σ(그룹들 leaf items) 월별 — 월 예산·당월 실적 롤업.
 *  ⚠ 각 그룹 배열 = leaf(cat2Idx有) + 소계 행(cat1Idx/cat2Idx=null) → leaf만 합산(소계 이중계상 방지). */
export function totalRollup(groups: AnalRow[][], total: AnalRow | null): AC[] {
  const out: AC[] = [];
  if (!total) return out;
  const leafGroups = groups.map((rows) => rows.filter((r) => r.cat2Idx != null));
  for (const [key, label] of [['budgetPlan', '월 예산'], ['budgetPerform', '당월 실적']] as const) {
    let bad = 0, cnt = 0; const ex: string[] = [];
    for (let m = 0; m < 12; m++) {
      const sum = leafGroups.reduce((s, rows) => s + rows.reduce((a, r) => a + (((r as unknown as Record<string, number[]>)[key]?.[m]) || 0), 0), 0);
      const tv = (total as unknown as Record<string, number[]>)[key]?.[m];
      if (tv == null) continue; cnt++;
      if (!near(tv, sum, 2)) { bad++; if (ex.length < 3) ex.push(`${m + 1}월(합계 ${Math.round(tv).toLocaleString()}≠Σ ${Math.round(sum).toLocaleString()})`); }
    }
    out.push({ name: `합계 = Σ(그룹) · ${label}`, ok: bad === 0, na: cnt === 0, detail: cnt === 0 ? '대상 없음' : `12개월 중 ${cnt - bad} 성립${bad ? ` · 위반 ${bad}(${ex.join(', ')})` : ''}` });
  }
  return out;
}

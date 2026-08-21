import { Check, num, near, nearRel } from './budgetCost';

// ──────────────────────────────────────────────────────────────
//  P1 — 교차 검증 맹점 보완: 독립 재집계(Tier A) + 이상치·정상성(Tier E) 순수 불변식.
//  원리: "표시 집계를 서로 비교"가 아니라 "원자 원천 레코드에서 총액을 독립 재구성" 후 표시값과 대조 →
//        모든 화면이 같은 오값이어도(교차 통과) 집계·롤업·매핑 오류를 포착.
//  ⚠ 한계: 원자 입력값 자체 오류(예: 매입가 오입력)는 재집계도 같은 입력을 쓰므로 못 잡음(Tier C=외부대장 몫).
//          Tier E(정상성)는 그중 '명백한' 입력 오류(음수·0·자릿수 이탈)만 저비용으로 거름.
// ──────────────────────────────────────────────────────────────

export interface Atom { label: string; qty: number; unit: number; }

// 원자(수량×단가) 합으로 총액 독립 재구성.
export function recomposeTotal(atoms: Atom[]): number {
  return atoms.reduce((a, x) => a + x.qty * x.unit, 0);
}

// Tier A: 독립 재구성값 ↔ 화면 표시 총액 대조(상대오차 허용). null/원자없음이면 na(판정 제외).
export function reconcileIndependent(name: string, atoms: Atom[], displayed: number | null, tol = 0.01): Check {
  if (!atoms.length || displayed == null) {
    return { name, scope: 'cross', ok: true, na: true, detail: `독립 재집계 불가 — ${!atoms.length ? '원자(수량×단가) 데이터 없음' : '표시 총액 없음'}(판정 제외)` };
  }
  const recomputed = recomposeTotal(atoms);
  const ok = displayed === 0 ? recomputed === 0 : nearRel(recomputed, displayed, tol);
  return {
    name, scope: 'cross', ok,
    detail: ok
      ? `독립 재구성 ${Math.round(recomputed).toLocaleString()}원 = 표시 ${displayed.toLocaleString()}원 (원자 ${atoms.length}건 Σ수량×단가)`
      : `[불일치] 독립 재구성 ${Math.round(recomputed).toLocaleString()}원 ≠ 표시 ${displayed.toLocaleString()}원 (차이 ${Math.round(recomputed - displayed).toLocaleString()}). `
        + `원자 ${atoms.length}건에서 다시 쌓은 값과 화면 집계가 어긋남 → 집계·롤업·매핑 단계 확인(모든 화면이 같은 값이어도 원값 오류일 수 있음).`,
  };
}

// Tier E: 단일 수치의 정상성(유한·부호·범위·자릿수). 범위는 도메인별 plausible bound(넉넉히).
export interface SanityOpt { min?: number; max?: number; allowZero?: boolean; }
export function sanityValue(name: string, value: number | null, opt: SanityOpt = {}): Check {
  if (value == null) return { name, scope: 'source', ok: true, na: true, detail: '값 없음 — 판정 제외' };
  const { min = 0, max = Number.POSITIVE_INFINITY, allowZero = false } = opt;
  const problems: string[] = [];
  if (!Number.isFinite(value)) problems.push('비유한값');
  if (value < 0) problems.push('음수');
  if (!allowZero && value === 0) problems.push('0(미입력/미집계 의심)');
  if (value < min && value !== 0) problems.push(`하한 미만(<${min.toLocaleString()})`);
  if (value > max) problems.push(`상한 초과(>${max.toLocaleString()})`);
  return { name, scope: 'source', ok: problems.length === 0, detail: problems.length === 0 ? `정상 범위: ${value.toLocaleString()}` : `이상치: ${value.toLocaleString()} — ${problems.join(', ')}` };
}

// Tier E 집합: 원천 단가/임률/시간당비용 리스트의 정상성 요약(이상 건만 상세).
export function sanityBatch(name: string, values: { label: string; v: number | null }[], opt: SanityOpt = {}): Check {
  const present = values.filter((x) => x.v != null) as { label: string; v: number }[];
  if (!present.length) return { name, scope: 'source', ok: true, na: true, detail: '검증 대상 값 없음 — 판정 제외' };
  const bad = present.filter((x) => {
    const c = sanityValue(x.label, x.v, opt);
    return !c.ok;
  });
  return {
    name, scope: 'source', ok: bad.length === 0,
    detail: bad.length === 0
      ? `${present.length}건 전부 정상 범위`
      : `이상치 ${bad.length}/${present.length}건: ${bad.slice(0, 4).map((b) => `${b.label}=${b.v.toLocaleString()}`).join(', ')}${bad.length > 4 ? ' …' : ''}`,
  };
}

// 헤더 배열에서 정규식 매칭 컬럼 인덱스(여러 후보 중 첫 매칭).
export function findCol(heads: string[], re: RegExp): number {
  return (heads || []).findIndex((h) => re.test((h || '').replace(/\s+/g, '')));
}

// 격자 행에서 원자(수량·단가) 추출: qtyCol/unitCol 유효 시 {qty,unit} (숫자 파싱, 결측·0수량 스킵).
export function atomsFromGrid(grid: string[][], nameCol: number, qtyCol: number, unitCol: number): Atom[] {
  if (qtyCol < 0 || unitCol < 0) return [];
  const out: Atom[] = [];
  for (const r of grid) {
    const qty = num(r[qtyCol]); const unit = num(r[unitCol]);
    if (qty == null || unit == null || qty === 0) continue;
    out.push({ label: nameCol >= 0 ? (r[nameCol] || '') : '', qty, unit });
  }
  return out;
}

// near 재노출(스펙 편의).
export { near, nearRel };

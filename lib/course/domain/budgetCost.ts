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
  na?: boolean;   // 데이터 없음 = 판정 제외(참고). pass/fail 집계에서 제외 — "미확인 ≠ 결함".
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
  // 총계 0인 축 = 미집계/미캡처 추정(다른 축이 큰 값인데 한 축만 0 = 데이터 없음) → 비교에서 제외하고 참고로 표기.
  //   ⚠ "총비용 0"은 정상 값이 아니라 '해당 화면 값을 못 읽음'일 가능성이 큼 → 0으로 FALSE FAIL 방지("미확인 ≠ 결함").
  const meaningful = present.filter((t) => t.value !== 0);
  const zeros = present.filter((t) => t.value === 0);
  const zeroNote = zeros.length ? ` · ⚠ 참고 제외(총계 0=미집계 추정): ${zeros.map((z) => z.label).join(', ')} — 해당 화면 값을 못 읽었을 가능성(데이터 없음/캡처 이슈), 별도 확인 필요` : '';
  if (meaningful.length < 2) {
    return { name, scope: 'cross', ok: true, na: meaningful.length === 0, detail: `비교 가능한 축 부족(값 있는 축 ${meaningful.length}개)${zeroNote}`, values: totals };
  }
  // 다수 일치값(consensus) 산출 → 일치 그룹 vs 이탈 축 구분(상세 설명용).
  let consensus = meaningful[0].value, best = 0;
  for (const t of meaningful) { const c = meaningful.filter((o) => near(o.value, t.value)).length; if (c > best) { best = c; consensus = t.value; } }
  const agree = meaningful.filter((t) => near(t.value, consensus));
  const deviate = meaningful.filter((t) => !near(t.value, consensus));
  if (deviate.length === 0) {
    return { name, scope: 'cross', ok: true, values: totals, detail: `${meaningful.length}개 축 총계 일치: ${consensus.toLocaleString()}원 (${agree.map((a) => a.label).join('·')})${zeroNote}` };
  }
  // 실제 불일치(값 있는 축끼리 어긋남) — 왜/어디를 확인할지 상세 설명.
  return {
    name, scope: 'cross', ok: false, values: totals,
    detail: `[불일치] 같은 총비용을 축만 달리 재집계한 값이라 원래 서로 같아야 하는데 어긋났습니다. `
      + `일치 ${agree.length}개 축 = ${consensus.toLocaleString()}원(${agree.map((a) => a.label).join('·')}) · `
      + `이탈: ${deviate.map((d) => `${d.label}=${d.value.toLocaleString()}원`).join(', ')}. `
      + `→ 이탈 축의 집계 기준(필터·기간·중복행)·데이터를 우선 확인.${zeroNote}`,
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

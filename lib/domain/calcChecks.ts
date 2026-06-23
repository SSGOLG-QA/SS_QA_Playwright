import { Page, expect } from '@playwright/test';
import { check, skip } from '../reporter';
import { Invariant, RatioCandidate, inferFormula } from './formula';

// 순수 로직은 formula.ts로 분리(단위/뮤테이션 테스트 대상). 하위호환 위해 재export.
export { Invariant, RatioCandidate, inferFormula } from './formula';

// ────────────────────────────────────────────────────────────────
//  재사용 계산검증 엔진 (화면/도메인 무관)
//  "요소가 보이는가"를 넘어 "파생값이 원시값과 정합한가"를 검증하는 공통 도구.
//   · verifyInvariants  : 전 행 불변식(분해합=총·요약=Σ·범위 등)을 불변식명별로 집계 검증
//   · lockOrSkipFormula : 비율/파생 공식 후보를 라이브 행에서 자동추론 → 유일 일치 시 잠금(검증), 모호 시 SKIP
//  내장 현황·주문 내역 등 계산보유 메뉴가 공통으로 호출.
// ────────────────────────────────────────────────────────────────

/** 전 행 불변식 검증 — 불변식명별로 집계해 check() 1건씩 기록. 다음 사용 idx 반환 */
export async function verifyInvariants<T>(
  admin: Page, P: string, R: string, prefix: string,
  rows: T[], invariantsOf: (r: T) => Invariant[], startIdx = 0,
): Promise<number> {
  const byName = new Map<string, { fails: string[]; n: number }>();
  for (const r of rows)
    for (const inv of invariantsOf(r)) {
      const e = byName.get(inv.name) ?? { fails: [], n: 0 };
      e.n++; if (!inv.ok) e.fails.push(inv.detail);
      byName.set(inv.name, e);
    }
  let idx = startIdx;
  for (const [name, { fails, n }] of byName) {
    idx++;
    await check(admin, { path: P, tcRef: `${R}_${idx}`, tcId: `${prefix}-${idx}`, desc: `${name} (전 ${n}행)`, expected: '전 행 정합', failMsg: '계산 불일치' },
      async () => { expect(fails, `불일치 ${fails.length}/${n}건: ${fails.slice(0, 5).join(' | ')}`).toHaveLength(0); });
  }
  return idx;
}

/** 비율/파생 공식 후보 자동추론 → 유일 전행일치 시 잠금(검증), 모호/불일치 시 SKIP(가짜 FAIL 방지) */
export async function lockOrSkipFormula<T>(
  admin: Page, P: string, R: string, tcId: string, label: string,
  rows: T[], shown: (r: T) => number, cands: RatioCandidate<T>[],
) {
  const inf = inferFormula(rows, shown, cands);
  console.log(`[calc] ${label} 공식 적합도:`, inf.map(x => `${x.label}=${x.fit}/${x.of}`).join('  '));
  const perfect = inf.filter(x => x.of > 0 && x.fit === x.of);
  if (perfect.length === 1) {
    await check(admin, { path: P, tcRef: `${R}_${tcId}`, tcId, desc: `${label} = ${perfect[0].label} (전 행 정합·공식 확정)`, expected: perfect[0].label, failMsg: '공식 불일치' },
      async () => { expect(perfect[0].fit).toBe(perfect[0].of); });
  } else {
    const s = inf.map(x => `${x.label}=${x.fit}/${x.of}`).join(' / ');
    skip({ path: P, tcRef: `${R}_${tcId}`, tcId, desc: `${label} 공식 검증` },
      perfect.length === 0 ? `전 행 일치 후보 없음 → 공식 확인 필요. [${s}]` : `복수 후보 동시 일치(모호) → 데이터 다양성 필요. [${s}]`);
  }
}

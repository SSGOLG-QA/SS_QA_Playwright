import type { Invariant } from './formula';

// ────────────────────────────────────────────────────────────────
//  Domain Oracle — 라운드관리 > 단체 라운드 (스코어·결과집계 팝업)
//  스코어 팝업  (/club/RoundGroupScore/{id}): Player·전반·후반·합계·오버타수 합계
//  결과집계 팝업(/club/RoundGroupRank/{id}) : 순위·성별·이름·스코어 + 시상내역 + Team Average
//
//  계산 불변식(명세 불요·골프 룰 기반):
//   [스코어]  · 합계 = 전반 + 후반 (9홀+9홀 분해합)
//             · 합계 − 오버타수 = Par(전 플레이어 동일·일정)
//             · 합계 ≥ 0
//   [순위]    · 순위 = 1..N 연속(동순위 없을 때)
//             · 스코어 단조 비감소(상위 순위 = 저타수, 좋은순)
//   [Team Avg]· 전체 평균 = mean(전원 스코어)  · 남자/여자 평균 = mean(성별 스코어)
//   [시상]    · 최우수상 점수 = 최저 스코어 = 1위 스코어
//   [교차]    · 결과집계 스코어 = 스코어 팝업 합계 (이름 조인)
// ────────────────────────────────────────────────────────────────
export interface GroupScoreRow { name: string; front: number; back: number; total: number; over: number; }
export interface GroupRankRow { rank: number; gender: string; name: string; score: number; }

const fin = Number.isFinite;
export const mean = (ns: number[]): number => ns.reduce((a, b) => a + b, 0) / ns.length;
/** 표시 정밀도(소수 1자리) 반올림 후 비교 — 92.75 → 92.8 == 화면값 */
export const round1 = (x: number): number => Math.round(x * 10) / 10;

/** 합계 − 오버타수 의 공통값(Par) 추정. 유효행 없으면 null */
export function inferPar(rows: GroupScoreRow[]): number | null {
  const v = rows.filter(r => fin(r.total) && fin(r.over)).map(r => r.total - r.over);
  return v.length ? v[0] : null;
}

/** 스코어 팝업 행별 불변식 */
export function groupScoreInvariants(r: GroupScoreRow, par: number | null): Invariant[] {
  const inv: Invariant[] = [];
  if (fin(r.front) && fin(r.back) && fin(r.total))
    inv.push({ name: '합계 = 전반 + 후반', ok: r.front + r.back === r.total, detail: `${r.name}: ${r.front}+${r.back}=${r.front + r.back} vs 합계 ${r.total}` });
  if (fin(r.total) && fin(r.over) && par != null)
    inv.push({ name: '합계 − 오버타수 = Par(일정)', ok: r.total - r.over === par, detail: `${r.name}: ${r.total}-${r.over}=${r.total - r.over} vs Par ${par}` });
  if (fin(r.total))
    inv.push({ name: '합계 ≥ 0', ok: r.total >= 0, detail: `${r.name}: 합계 ${r.total}` });
  return inv;
}

/** 순위표 정합성(집합 전체 1건) — 순위 연속 + 스코어 단조 */
export function rankOrderInvariants(rows: GroupRankRow[]): Invariant[] {
  const inv: Invariant[] = [];
  const s = [...rows].sort((a, b) => a.rank - b.rank);
  inv.push({ name: '순위 1..N 연속', ok: s.every((r, i) => r.rank === i + 1), detail: `순위열: ${s.map(r => r.rank).join(',')}` });
  let mono = true; const seg: string[] = [];
  for (let i = 1; i < s.length; i++)
    if (fin(s[i].score) && fin(s[i - 1].score)) { seg.push(`${s[i - 1].score}≤${s[i].score}`); if (s[i].score < s[i - 1].score) mono = false; }
  inv.push({ name: '스코어 순위 단조(상위=저타수)', ok: mono, detail: seg.join(' ') || '비교불가' });
  return inv;
}

/** Team Average 정합성 — 화면 표시 평균 vs 스코어로 재계산한 평균(소수1자리) */
export function teamAvgInvariants(rows: GroupRankRow[], shown: { all?: number; male?: number; female?: number }): Invariant[] {
  const inv: Invariant[] = [];
  const scored = rows.filter(r => fin(r.score));
  const all = scored.map(r => r.score);
  const males = scored.filter(r => /^[M남]/i.test(r.gender)).map(r => r.score);
  const females = scored.filter(r => /^[F여]/i.test(r.gender)).map(r => r.score);
  if (fin(shown.all as number) && all.length)
    inv.push({ name: '전체 평균 = mean(전원 스코어)', ok: round1(mean(all)) === round1(shown.all as number), detail: `mean(${all.join(',')})=${round1(mean(all))} vs 표시 ${shown.all}` });
  if (fin(shown.male as number) && males.length)
    inv.push({ name: '남자 평균 = mean(남자 스코어)', ok: round1(mean(males)) === round1(shown.male as number), detail: `mean(${males.join(',')})=${round1(mean(males))} vs 표시 ${shown.male}` });
  if (fin(shown.female as number) && females.length)
    inv.push({ name: '여자 평균 = mean(여자 스코어)', ok: round1(mean(females)) === round1(shown.female as number), detail: `mean(${females.join(',')})=${round1(mean(females))} vs 표시 ${shown.female}` });
  return inv;
}

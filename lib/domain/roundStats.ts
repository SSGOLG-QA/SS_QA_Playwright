import { DataGrid } from '../components/DataGrid';
import type { Invariant } from './formula';

// ────────────────────────────────────────────────────────────────
//  Domain Oracle — 라운드관리 > 내장 통계 (round-statistics)
//  컬럼: 기간 · 전체 · 남성 · 여성 · 20대 · 30대 · 40대 · 50대 · 60대이상
//  계산 불변식(명세 불요):
//   · 전체 = 남성 + 여성 (성별 분해합)
//   · 연령대 합 ≤ 전체 (연령 미인식 내장객 존재 가능 → 등호 아닌 ≤)
//   · 모든 수치 ≥ 0
// ────────────────────────────────────────────────────────────────
export interface RoundStatsRow {
  period: string;
  total: number;
  male: number;
  female: number;
  age20: number;
  age30: number;
  age40: number;
  age50: number;
  age60plus: number;
}

function pick(rec: Record<string, string>, re: RegExp): string {
  const k = Object.keys(rec).find(k => re.test(k.replace(/\s+/g, '')));
  return k ? rec[k] : '';
}

export function parseRoundStatsRow(rec: Record<string, string>): RoundStatsRow {
  return {
    period: pick(rec, /기간|날짜|일자/),
    total:    DataGrid.num(pick(rec, /^전체$|^합계$/)),
    male:     DataGrid.num(pick(rec, /남성|^남$/)),
    female:   DataGrid.num(pick(rec, /여성|^여$/)),
    age20:    DataGrid.num(pick(rec, /20대/)),
    age30:    DataGrid.num(pick(rec, /30대/)),
    age40:    DataGrid.num(pick(rec, /40대/)),
    age50:    DataGrid.num(pick(rec, /50대/)),
    age60plus: DataGrid.num(pick(rec, /60대이상|60대/)),
  };
}

export function roundStatsInvariants(r: RoundStatsRow): Invariant[] {
  const inv: Invariant[] = [];
  const fin = (x: number) => Number.isFinite(x);

  if (fin(r.male))     inv.push({ name: '남성 ≥ 0',  ok: r.male >= 0,   detail: `${r.period}: 남성 ${r.male}` });
  if (fin(r.female))   inv.push({ name: '여성 ≥ 0',  ok: r.female >= 0, detail: `${r.period}: 여성 ${r.female}` });
  if (fin(r.total))    inv.push({ name: '전체 ≥ 0',  ok: r.total >= 0,  detail: `${r.period}: 전체 ${r.total}` });

  if (fin(r.total) && fin(r.male) && fin(r.female))
    inv.push({
      name: '전체 = 남성 + 여성',
      ok: r.male + r.female === r.total,
      detail: `${r.period}: ${r.male}+${r.female}=${r.male + r.female} vs 전체 ${r.total}`,
    });

  const ages = [r.age20, r.age30, r.age40, r.age50, r.age60plus];
  if (fin(r.total) && ages.every(fin)) {
    const ageSum = ages.reduce((a, b) => a + b, 0);
    inv.push({
      name: '연령대 합 ≤ 전체',
      ok: ageSum <= r.total,
      detail: `${r.period}: 연령합 ${ageSum} ≤ 전체 ${r.total}`,
    });
  }

  return inv;
}

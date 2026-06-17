import { DataGrid } from '../components/DataGrid';
import { Invariant, RatioCandidate } from './calcChecks';

// ────────────────────────────────────────────────────────────────
//  Domain Oracle — 내장 현황(round-visit) 계산 정합성
//  화면이 "계산해서 보여준" 파생 컬럼(총 내장객/SS회원 비율/출력률)을
//  같은 행의 원시값으로 "독립 재계산"해 대조하기 위한 순수 로직(UI 무관).
//
//  컬럼: 날짜 · 총 내장객 · 내장객 남/여 · 유효 내장객 ·
//        기존 SS회원 · 신규 SS회원 · 일일 SS회원 · SS회원 비율 · 출력 횟수 · 출력률
// ────────────────────────────────────────────────────────────────
export interface VisitRow {
  date: string;
  total: number;        // 총 내장객
  male: number; female: number;   // 내장객 남/여
  valid: number;        // 유효 내장객
  ssExisting: number; ssNew: number; ssDaily: number; // 기존/신규/일일 SS회원
  ssRatio: number;      // SS회원 비율(%) — 화면 표시값
  prints: number;       // 출력 횟수
  printRate: number;    // 출력률(%) — 화면 표시값
}

// 헤더명은 공백/맞춤법 드리프트 가능 → 정규식 매칭으로 컬럼 키 탐색(인덱스 의존 금지)
function pick(rec: Record<string, string>, re: RegExp): string | undefined {
  const key = Object.keys(rec).find(k => re.test(k.replace(/\s+/g, '')));
  return key ? rec[key] : undefined;
}

export function parseVisitRow(rec: Record<string, string>): VisitRow {
  // 남/여는 분리 컬럼('내장객 남' / '내장객 여')이 기본, 병합 컬럼('내장객 남/여')은 폴백
  let male = DataGrid.num(pick(rec, /^내장객남$|^남$/));
  let female = DataGrid.num(pick(rec, /^내장객여$|^여$/));
  if (!Number.isFinite(male) || !Number.isFinite(female)) {
    const [m, f] = DataGrid.pair(pick(rec, /^내장객남\/?여$|^남\/?여$/));
    if (!Number.isFinite(male)) male = m;
    if (!Number.isFinite(female)) female = f;
  }
  return {
    date: pick(rec, /날짜/) ?? '',
    total: DataGrid.num(pick(rec, /총내장객/)),
    male, female,
    valid: DataGrid.num(pick(rec, /유효내장객/)),
    ssExisting: DataGrid.num(pick(rec, /기존SS회원/)),
    ssNew: DataGrid.num(pick(rec, /신규SS회원/)),
    ssDaily: DataGrid.num(pick(rec, /일일SS회원/)),
    ssRatio: DataGrid.pct(pick(rec, /SS회원비율/)),
    prints: DataGrid.num(pick(rec, /출력횟수/)),
    printRate: DataGrid.pct(pick(rec, /출력률/)),
  };
}

// 공식 불확실성 없이 "항상 참"이어야 하는 확정 불변식만(가짜 FAIL 방지)
export function visitInvariants(r: VisitRow): Invariant[] {
  const inv: Invariant[] = [];
  const has = (...xs: number[]) => xs.every(x => Number.isFinite(x));

  if (has(r.total, r.male, r.female))
    inv.push({ name: '총 내장객 = 남 + 여', ok: r.male + r.female === r.total, detail: `${r.date}: ${r.male}+${r.female}=${r.male + r.female} vs 총 ${r.total}` });

  if (has(r.valid, r.total))
    inv.push({ name: '유효 내장객 ≤ 총 내장객', ok: r.valid <= r.total, detail: `${r.date}: 유효 ${r.valid} ≤ 총 ${r.total}` });

  if (has(r.ssRatio))
    inv.push({ name: 'SS회원 비율 0~100%', ok: r.ssRatio >= 0 && r.ssRatio <= 100, detail: `${r.date}: ${r.ssRatio}%` });

  if (has(r.printRate))
    inv.push({ name: '출력률 ≥ 0%', ok: r.printRate >= 0, detail: `${r.date}: ${r.printRate}%` });

  return inv;
}

// 비율 공식 후보 — 라이브 행에서 어떤 분자/분모가 화면값과 맞는지 추론용(calcChecks.inferFormula).
//   원시 %를 반환(반올림은 inferFormula가 표시정밀도에 맞춰 수행).
const ratio = (num: number, den: number) => (den > 0 ? (num / den) * 100 : NaN);

export const SS_RATIO_CANDIDATES: RatioCandidate<VisitRow>[] = [
  { label: '(기존+신규) / 총내장객', calc: r => ratio(r.ssExisting + r.ssNew, r.total) },
  { label: '(기존+신규+일일) / 총내장객', calc: r => ratio(r.ssExisting + r.ssNew + r.ssDaily, r.total) },
  { label: '(기존+신규) / 유효내장객', calc: r => ratio(r.ssExisting + r.ssNew, r.valid) },
  { label: '(기존+신규+일일) / 유효내장객', calc: r => ratio(r.ssExisting + r.ssNew + r.ssDaily, r.valid) },
];

export const PRINT_RATE_CANDIDATES: RatioCandidate<VisitRow>[] = [
  { label: '출력횟수 / 총내장객', calc: r => ratio(r.prints, r.total) },
  { label: '출력횟수 / 유효내장객', calc: r => ratio(r.prints, r.valid) },
];

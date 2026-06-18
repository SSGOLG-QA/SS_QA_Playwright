import { DataGrid } from '../components/DataGrid';
import { Invariant, RatioCandidate } from './calcChecks';

// ────────────────────────────────────────────────────────────────
//  Domain Oracle — 후기 통계(review-statistics) 통계표
//  컬럼: 순서 · 날짜 · 등록후기 수 · 전체 · 코스 · 그린 · 서비스 · 진행 · 식음료 · 공감수 · 비공감수 · 골프장의견 수
//  계산 불변식: 건수 ≥ 0, 평점 ≥ 0. 공식 추론: 전체 = 평균(코스·그린·서비스·진행·식음료)?
// ────────────────────────────────────────────────────────────────
export interface ReviewRow {
  date: string; regCount: number;
  overall: number; course: number; green: number; service: number; progress: number; fnb: number;
  like: number; dislike: number; opinion: number;
}

function pick(rec: Record<string, string>, re: RegExp): string {
  const k = Object.keys(rec).find(k => re.test(k.replace(/\s+/g, '')));
  return k ? rec[k] : '';
}

export function parseReviewRow(rec: Record<string, string>): ReviewRow {
  return {
    date: pick(rec, /날짜/),
    regCount: DataGrid.num(pick(rec, /등록후기수/)),
    overall: DataGrid.num(pick(rec, /^전체$/)),
    course: DataGrid.num(pick(rec, /^코스$/)),
    green: DataGrid.num(pick(rec, /^그린$/)),
    service: DataGrid.num(pick(rec, /^서비스$/)),
    progress: DataGrid.num(pick(rec, /^진행$/)),
    fnb: DataGrid.num(pick(rec, /^식음료$/)),
    like: DataGrid.num(pick(rec, /^공감수$/)),
    dislike: DataGrid.num(pick(rec, /비공감수/)),
    opinion: DataGrid.num(pick(rec, /골프장의견수/)),
  };
}

export function reviewInvariants(r: ReviewRow): Invariant[] {
  const inv: Invariant[] = [];
  const fin = (x: number) => Number.isFinite(x);
  for (const [label, v] of [['등록후기 수', r.regCount], ['공감수', r.like], ['비공감수', r.dislike], ['골프장의견 수', r.opinion]] as [string, number][])
    if (fin(v)) inv.push({ name: `${label} ≥ 0`, ok: v >= 0, detail: `${r.date}: ${v}` });
  for (const [label, v] of [['전체', r.overall], ['코스', r.course], ['그린', r.green], ['서비스', r.service], ['진행', r.progress], ['식음료', r.fnb]] as [string, number][])
    if (fin(v)) inv.push({ name: `평점 '${label}' ≥ 0`, ok: v >= 0, detail: `${r.date}: ${v}` });
  return inv;
}

const mean = (xs: number[]) => { const f = xs.filter(Number.isFinite); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN; };

// '전체' 평점이 5개 항목 평균인지 자동 추론(맞으면 잠금, 아니면 SKIP — 독립 종합점수일 수 있음)
export const OVERALL_RATING_CANDIDATES: RatioCandidate<ReviewRow>[] = [
  { label: '평균(코스·그린·서비스·진행·식음료)', calc: r => mean([r.course, r.green, r.service, r.progress, r.fnb]) },
];

import { DataGrid } from '../components/DataGrid';
import { Invariant } from './calcChecks';

// ────────────────────────────────────────────────────────────────
//  Domain Oracle — 코스 분석(course-analysis-detail) 홀별 분석표
//  컬럼: 홀 · 스코어 · 퍼트수 · 페어웨이안착률 · 그린적중률 …
//  계산 불변식(명세 불요): 안착률/적중률 ∈ [0,100], 퍼트수/스코어 ≥ 0.
// ────────────────────────────────────────────────────────────────
export interface CourseRow { hole: string; score: number; putts: number; fairway: number; green: number }

function pick(rec: Record<string, string>, re: RegExp): string {
  const k = Object.keys(rec).find(k => re.test(k.replace(/\s+/g, '')));
  return k ? rec[k] : '';
}

export function parseCourseRow(rec: Record<string, string>): CourseRow {
  return {
    hole: pick(rec, /^홀$|홀/),
    score: DataGrid.num(pick(rec, /^스코어$/)),
    putts: DataGrid.num(pick(rec, /퍼트수/)),
    fairway: DataGrid.pct(pick(rec, /페어웨이안착률|페어웨이/)),
    green: DataGrid.pct(pick(rec, /그린적중률/)),
  };
}

export function courseInvariants(r: CourseRow): Invariant[] {
  const inv: Invariant[] = [];
  const fin = (x: number) => Number.isFinite(x);
  if (fin(r.fairway)) inv.push({ name: '페어웨이안착률 0~100%', ok: r.fairway >= 0 && r.fairway <= 100, detail: `${r.hole}홀: ${r.fairway}` });
  if (fin(r.green)) inv.push({ name: '그린적중률 0~100%', ok: r.green >= 0 && r.green <= 100, detail: `${r.hole}홀: ${r.green}` });
  if (fin(r.putts)) inv.push({ name: '퍼트수 ≥ 0', ok: r.putts >= 0, detail: `${r.hole}홀: ${r.putts}` });
  if (fin(r.score)) inv.push({ name: '스코어 ≥ 0', ok: r.score >= 0, detail: `${r.hole}홀: ${r.score}` });
  return inv;
}

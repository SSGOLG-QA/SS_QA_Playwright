// ──────────────────────────────────────────────────────────────
//  HOME > 비용 탭 > 작업지시 근거 비용 분석 > 코스별 뷰 > [코스 선택] 홀별 드릴다운(B-2) 순수 불변식.
//  Playwright 무관(DOM에서 파싱한 grid만 입력). 라이브 구조(2026-09-08 프로브 실측):
//   head[0] = [분류] [예산 분류별 cs=5] [작업 분류별 cs=13]
//   head[1] = ["", 고정직/임시직/자재/장비/기타, | 그린/그린칼라/…/시설/장비/기타]
//   rows    = [전체, 1홀, 2홀, …, 9홀] × 18수치열
//  불변식 3종:
//   I1 예산분류 Σ = 작업분류 Σ (같은 금액을 2축[예산분류·작업분류]으로 분해 → 행별 총합 동일)
//   I2 전체 = Σ(1~9홀) (홀별 분해의 컬럼별 합 = 전체행)
//   I3 코스별 뷰 '합계-{코스}' 열 = 드릴다운 '전체' 행 총액 (뷰 간 교차 정합)
// ──────────────────────────────────────────────────────────────

export interface DrillCell { t: string; cs: number; }
export interface DrillGrid { head: DrillCell[][]; rows: string[][]; }
export interface DrillCheck { name: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }

const numOf = (t: string): number => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (c === '' || c === '-' || c === '.') return 0; const v = Number(c); return Number.isFinite(v) ? v : 0; };
const won = (n: number): string => Math.round(n).toLocaleString();

// 그룹헤더(head[0]) colspan으로 [예산 분류별, 작업 분류별] 열 개수 분리. 실패 시 라이브 확인값(5|13) 폴백.
export function splitCols(head: DrillCell[][]): { budget: number; work: number } {
  const g = head[0] || [];
  let budget = 0, work = 0;
  for (const c of g) {
    if (/예산\s*분류/.test(c.t)) budget = c.cs || 0;
    else if (/작업\s*분류/.test(c.t)) work = c.cs || 0;
  }
  return budget > 0 && work > 0 ? { budget, work } : { budget: 5, work: 13 };
}

interface DRow { label: string; nums: number[]; }
function dataRows(grid: DrillGrid): DRow[] {
  return (grid.rows || []).filter((r) => r && r.length >= 2).map((r) => ({ label: (r[0] || '').replace(/\s+/g, ''), nums: r.slice(1).map(numOf) }));
}

// I1: 행별 예산분류 Σ = 작업분류 Σ. tol = max(전체 3원, 상대 0.1%)(카테고리 반올림 누적 흡수).
export function checkBudgetEqualsWork(course: string, grid: DrillGrid): DrillCheck {
  const { budget, work } = splitCols(grid.head);
  const rows = dataRows(grid);
  if (rows.length === 0) return { name: `[${course}] I1 예산분류Σ=작업분류Σ(행별)`, ok: true, na: true, detail: '행 없음 — 판정 제외' };
  const bad: string[] = [];
  for (const r of rows) {
    const bud = r.nums.slice(0, budget).reduce((a, b) => a + b, 0);
    const wrk = r.nums.slice(budget, budget + work).reduce((a, b) => a + b, 0);
    const tol = Math.max(3, Math.abs(bud) * 0.001);
    if (Math.abs(bud - wrk) > tol) bad.push(`${r.label}(예산 ${won(bud)}≠작업 ${won(wrk)})`);
  }
  return { name: `[${course}] I1 예산분류Σ=작업분류Σ(행별)`, ok: bad.length === 0,
    detail: bad.length === 0 ? `${rows.length}행 모두 2축(예산분류 ${budget}열·작업분류 ${work}열) 총합 일치` : `불일치 ${bad.length}행: ${bad.slice(0, 3).join(', ')}` };
}

// I2: 컬럼별 전체 = Σ(1~9홀). tol = max(홀수+1원, 상대 0.5%)(홀별 반올림 누적).
export function checkTotalEqualsHoles(course: string, grid: DrillGrid): DrillCheck {
  const rows = dataRows(grid);
  const total = rows.find((r) => /^전체$/.test(r.label));
  const holes = rows.filter((r) => /^\d+홀$/.test(r.label));
  if (!total || holes.length === 0) return { name: `[${course}] I2 전체=Σ(1~9홀)(컬럼별)`, ok: true, na: true, detail: `전체행/홀행 부재(홀 ${holes.length}) — 판정 제외` };
  const floor = Math.max(2, holes.length + 1);
  const bad: string[] = []; let cols = 0;
  for (let i = 0; i < total.nums.length; i++) {
    const tv = total.nums[i];
    const sum = holes.reduce((a, h) => a + (h.nums[i] ?? 0), 0);
    cols++;
    const tol = Math.max(floor, Math.abs(tv) * 0.005);
    if (Math.abs(tv - sum) > tol) bad.push(`col${i}(전체 ${won(tv)}≠Σ홀 ${won(sum)})`);
  }
  return { name: `[${course}] I2 전체=Σ(1~9홀)(컬럼별)`, ok: bad.length === 0,
    detail: bad.length === 0 ? `${holes.length}개 홀 × ${cols}개 열 컬럼합 = 전체행 일치` : `불일치 ${bad.length}열: ${bad.slice(0, 3).join(', ')}` };
}

// I3: 코스별 뷰 '합계-{코스}' 열 총액 = 드릴다운 '전체' 행 예산분류 Σ(=작업분류 Σ). tol = 3원.
export function checkCrossCourseTotal(course: string, grid: DrillGrid, courseViewTotal: number | null): DrillCheck {
  const nm = `[${course}] I3 코스별뷰 합계-${course} = 드릴다운 전체행`;
  if (courseViewTotal == null) return { name: nm, ok: true, na: true, detail: '코스별 뷰 합계 미획득 — 판정 제외' };
  const { budget } = splitCols(grid.head);
  const rows = dataRows(grid);
  const total = rows.find((r) => /^전체$/.test(r.label));
  if (!total) return { name: nm, ok: true, na: true, detail: '드릴다운 전체행 부재 — 판정 제외' };
  const drillTotal = total.nums.slice(0, budget).reduce((a, b) => a + b, 0);
  const ok = Math.abs(drillTotal - courseViewTotal) <= 3;
  return { name: nm, ok, detail: `코스별뷰 ${won(courseViewTotal)} ${ok ? '=' : '≠'} 드릴다운 ${won(drillTotal)}` };
}

// 세 불변식을 한 코스에 대해 실행.
export function drilldownInvariants(course: string, grid: DrillGrid, courseViewTotal: number | null): DrillCheck[] {
  return [
    checkBudgetEqualsWork(course, grid),
    checkTotalEqualsHoles(course, grid),
    checkCrossCourseTotal(course, grid, courseViewTotal),
  ];
}

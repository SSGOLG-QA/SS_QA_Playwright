// ──────────────────────────────────────────────────────────────
//  Home 등급 평가 도메인 — /api/v1/home/management/eval-init 순수 불변식.
//  등급추세 스파크라인은 DOM에 값이 없음(포인트/축/툴팁 부재) → 공급 API(eval-init)로 데이터 정합성 검증.
//  levelInfos(등급↔점수 임계) · goal(목표=화면 카드) · monthlyEvalScores(추세 시계열) · lastEvalSheet(최신 평가).
// ──────────────────────────────────────────────────────────────

export const GRADE_SCALE = ['E-', 'E', 'E+', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
// 화면 구역명 → API 필드 접두.
export const AREA_KEY: Record<string, string> = { 전체: 'total', 그린: 'green', 티박스: 'teebox', 페어웨이: 'fairway', 그린칼라: 'greencolor', 러프: 'rough', 벙커: 'bunker' };
export const AREAS = Object.keys(AREA_KEY);

export interface LevelInfo { scoreLevel: string; lowScore: number; highScore: number; }
export interface MonthScore { evalYearMonth: string; [k: string]: number | string; }
export interface EvalInit {
  goal?: Record<string, unknown>;
  levelInfos?: LevelInfo[];
  monthlyEvalScores?: MonthScore[];
  lastEvalSheet?: Record<string, unknown>;
}

// 점수 → 등급(levelInfos 기준). low<=score<high, 최상위(A+)만 high 포함. 미매칭 null.
export function scoreToGrade(score: number, levels: LevelInfo[]): string | null {
  if (!Number.isFinite(score) || !levels || !levels.length) return null;
  const top = levels.reduce((a, b) => (b.highScore > a.highScore ? b : a), levels[0]);
  for (const lv of levels) {
    if (lv === top && score >= lv.lowScore && score <= lv.highScore) return lv.scoreLevel;
    if (score >= lv.lowScore && score < lv.highScore) return lv.scoreLevel;
  }
  return null;
}

// C1: levelInfos 스케일 정합 — 15단계·등급셋 일치·임계 연속·0~100 커버.
export function levelScaleInvariants(levels: LevelInfo[]): { ok: boolean; detail: string } {
  if (!levels || !levels.length) return { ok: false, detail: 'levelInfos 없음' };
  const set = new Set(levels.map((l) => l.scoreLevel));
  const gradesOk = GRADE_SCALE.every((g) => set.has(g)) && set.size === GRADE_SCALE.length;
  const sorted = [...levels].sort((a, b) => a.lowScore - b.lowScore);
  let contig = true;
  for (let i = 1; i < sorted.length; i++) if (Math.abs(sorted[i].lowScore - sorted[i - 1].highScore) > 0.001) contig = false;
  const min = Math.min(...levels.map((l) => l.lowScore));
  const max = Math.max(...levels.map((l) => l.highScore));
  const ok = gradesOk && contig && min === 0 && max === 100;
  return { ok, detail: `등급셋 ${gradesOk ? 'OK' : 'X'}·임계연속 ${contig ? 'OK' : 'X'}·범위 ${min}~${max}` };
}

// C2: 최신 평가(lastEvalSheet) 점수→등급 매핑 == 기재 등급(Level). null 레벨(미평가)은 제외.
export function sheetMappingInvariants(sheet: Record<string, unknown>, levels: LevelInfo[]): { area: string; score: number; mapped: string | null; level: string; ok: boolean }[] {
  const out: { area: string; score: number; mapped: string | null; level: string; ok: boolean }[] = [];
  for (const [area, key] of Object.entries(AREA_KEY)) {
    const level = sheet[`${key}Level`];
    const score = sheet[`${key}Score`];
    if (level == null || typeof score !== 'number') continue;   // 미평가 구역 제외
    const mapped = scoreToGrade(score, levels);
    out.push({ area, score, mapped, level: String(level), ok: mapped === String(level) });
  }
  return out;
}

// C3: 추세 최신월 점수 == 최신 평가시트 점수(같은 원천). 구역별.
export function trendLatestMatchesSheet(months: MonthScore[], sheet: Record<string, unknown>): { area: string; trend: number | null; sheet: number | null; ok: boolean }[] {
  const out: { area: string; trend: number | null; sheet: number | null; ok: boolean }[] = [];
  if (!months || !months.length) return out;
  // 최신월 = evalYearMonth 최대
  const latest = [...months].sort((a, b) => String(b.evalYearMonth).localeCompare(String(a.evalYearMonth)))[0];
  for (const [area, key] of Object.entries(AREA_KEY)) {
    const t = latest[`${key}Score`];
    const s = sheet[`${key}Score`];
    const tn = typeof t === 'number' ? t : null;
    const sn = typeof s === 'number' ? s : null;
    if (tn == null && sn == null) continue;
    out.push({ area, trend: tn, sheet: sn, ok: tn != null && sn != null && Math.abs(tn - sn) < 0.01 });
  }
  return out;
}

// C5: monthlyEvalScores 구조 — 각 점수 ∈ [0,100], 월 형식.
export function monthlyStructureInvariants(months: MonthScore[]): { ok: boolean; detail: string } {
  if (!months || !months.length) return { ok: false, detail: '시계열 없음' };
  let bad = 0;
  for (const m of months) {
    if (!/^\d{4}-\d{2}$/.test(String(m.evalYearMonth))) bad++;
    for (const key of Object.values(AREA_KEY)) { const v = m[`${key}Score`]; if (typeof v === 'number' && (v < 0 || v > 100)) bad++; }
  }
  return { ok: bad === 0, detail: `${months.length}개월 · 이상 ${bad}` };
}

// goal 등급 유효성.
export function goalGradeOf(goal: Record<string, unknown>, area: string): string | null {
  const v = goal[AREA_KEY[area]];
  return (typeof v === 'string' && GRADE_SCALE.includes(v)) ? v : null;
}

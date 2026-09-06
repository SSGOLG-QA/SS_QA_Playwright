// ──────────────────────────────────────────────────────────────
//  그래프 카드 롤업 순수 불변식(공용) — "전체 = Σ카테고리" 카드 정합성.
//   예산 분석 연간 그래프·HOME 비용 탭 등 [전체 카드 + 카테고리 카드]가 함께 노출되는 화면 공통.
//   ⚠ 잔여(예산) 표시 관례가 화면마다 다름:
//     · 0-하한(초과 시 잔여 0 + 초과 배지 별도)  → 전체(연간예산−누적사용, 음수 상계) ≠ Σ카드잔여
//     · 음수 표시(-47,810,000)                   → 전체 = Σ카드잔여 성립
//   연간예산·누적사용은 하한이 없어 전체=Σ 성립해야(회귀 감시). 잔여 불일치는 결함이 아니라 표시 관례 차이 → review(확인 필요).
// ──────────────────────────────────────────────────────────────

export interface GraphCard { budget: number | null; used: number | null; remain: number | null; over: number | null; }
export interface RollupCheck { name: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }

const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;
const won = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString() + '원');

export interface RollupOpts {
  total: string;          // 전체(합계) 카드 키
  subs: string[];         // 카테고리 카드 키들
  screen: string;         // 화면 경로(디테일 문구용, 예: '예산 관리>예산 분석>연간 그래프')
  budgetLabel?: string;   // 기본 '연간예산'
  usedLabel?: string;     // 기본 '누적 사용'
  prefix?: string;        // 체크명 프리픽스(기본 '연간 그래프 카드')
}

/** cards(카테고리→{예산·사용·잔여·초과}) → 전체=Σ카테고리 롤업 체크. 파싱 부족 시 na(판정 제외). */
export function graphCardRollup(cards: Record<string, GraphCard>, opts: RollupOpts): RollupCheck[] {
  const { total, subs, screen } = opts;
  const bl = opts.budgetLabel ?? '연간예산';
  const ul = opts.usedLabel ?? '누적 사용';
  const px = opts.prefix ?? '연간 그래프 카드';
  const out: RollupCheck[] = [];
  const tot = cards[total];
  const have = subs.filter((c) => cards[c]);
  if (!tot || have.length < 2) {
    out.push({ name: `★ ${px}: 전체 = Σ카테고리`, ok: true, na: true, detail: `카드 파싱 부족(전체 ${tot ? 'O' : 'X'}·분류 ${have.length}) — 판정 제외(${screen} 탭/카드 구조 확인)` });
    return out;
  }
  const sumOf = (f: 'budget' | 'used' | 'remain') => have.reduce((a, c) => a + (cards[c]![f] ?? 0), 0);
  // 연간예산·누적사용: 하한 없음 → 전체=Σ 성립해야(회귀 감시)
  for (const [f, label] of [['budget', bl], ['used', ul]] as const) {
    const tv = tot[f]; const sv = sumOf(f);
    if (tv == null) { out.push({ name: `${px}: 전체 ${label} = Σ카테고리`, ok: true, na: true, detail: '전체 값 미파싱 — 판정 제외' }); continue; }
    out.push({ name: `${px}: 전체 ${label} = Σ카테고리`, ok: near(tv, sv), detail: near(tv, sv) ? `전체 ${won(tv)} = Σ카테고리 ${won(sv)} ✓` : `불일치: 전체 ${won(tv)} ≠ Σ ${won(sv)}(차 ${won(tv - sv)})` });
  }
  // 잔여 검증 — 표시 관례(0-하한 vs 음수)에 흔들리지 않도록 2단으로 분리(실행마다 판정 뒤집힘 방지):
  //   ① 데이터 정합(표시 무관, 위반만 결함): 전체 잔여 = Σ(예산−사용) uncapped — 참 잔여는 음수 허용, 항상 성립해야.
  //   ② 표시 관례(정보): 카드에 표시된 잔여 합(sR)이 전체와 다르면 review — 초과 분류를 0-하한 표시(+초과 배지)해서 발생. 결함 아님.
  const tR = tot.remain; const sR = sumOf('remain');
  const haveBU = have.filter((c) => cards[c]!.budget != null && cards[c]!.used != null);
  const uncapped = haveBU.reduce((a, c) => a + (cards[c]!.budget! - cards[c]!.used!), 0);
  if (tR == null || haveBU.length < 2) {
    out.push({ name: `★ ${px}: 전체 잔여 = Σ(예산−사용)`, ok: true, na: true, detail: `전체 잔여/구성 미파싱(전체잔여 ${tR == null ? 'X' : 'O'}·예산·사용 쌍 ${haveBU.length}) — 판정 제외` });
  } else {
    out.push({ name: `★ ${px}: 전체 잔여 = Σ(예산−사용)`, ok: near(tR, uncapped), detail: near(tR, uncapped) ? `전체 잔여 ${won(tR)} = Σ(예산−사용) ${won(uncapped)} ✓(데이터 정합·표시 무관)` : `데이터 불일치: 전체 잔여 ${won(tR)} ≠ Σ(예산−사용) ${won(uncapped)}(차 ${won(tR - uncapped)}) — 화면: ${screen}` });
    if (!near(sR, tR)) out.push({ name: `${px}: 카드 잔여 표시 관례(0-하한)`, ok: false, review: true, detail: `표시 관례(확인 필요, 결함 아님): Σ카드 잔여(표시) ${won(sR)} ≠ 전체 잔여 ${won(tR)}(차 ${won(sR - tR)}). 초과 분류의 잔여를 0으로 하한 표시(+초과 배지 별도)해서 발생 — 데이터는 위 ①에서 정합 확인. ⚠ 화면 간 표시 상이 가능(예: HOME 음수 vs 예산 분석 연간 그래프 0-하한). 화면: ${screen}.` });
  }
  // 초과 카드 within-card: 잔여 0 + 초과 = 누적사용 − 연간예산
  const overBad = subs.filter((c) => cards[c] && (cards[c]!.remain ?? -1) === 0 && cards[c]!.over != null && cards[c]!.budget != null && cards[c]!.used != null && !near(cards[c]!.over!, cards[c]!.used! - cards[c]!.budget!));
  if (overBad.length) out.push({ name: `${px}: 초과 = 누적사용 − 연간예산`, ok: false, detail: `불일치: ${overBad.map((c) => `${c}(초과 ${won(cards[c]!.over)} ≠ ${won(cards[c]!.used! - cards[c]!.budget!)})`).join(', ')}` });
  return out;
}

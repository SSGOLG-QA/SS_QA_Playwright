// ──────────────────────────────────────────────────────────────
//  course:cross — 홈 정합성 ↔ 예산/비용 정합성 교차분석 리코셔너(오프라인, 로그인 불필요).
//   입력: analysis/_cross-home.json (course:home-verify 산출) · analysis/_cross-budget.json (course:budget-verify 산출)
//   출력: reports/course-cross.html
//   4개 교차점: ① 연간예산 ② 누적사용/실제발생 ③ 작업지시 비용 ④ (C) 내부정합 국소화
//   실행: npm run course:cross  (각 검증기 라이브 실행 후, 앵커 JSON이 있어야 유효)
// ──────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';

type NumMap = Record<string, number>;
interface HomeAnchors {
  ts?: string; annualByCat?: NumMap; usedByCat?: NumMap; perfByCat?: NumMap; budgetDetailByCat?: NumMap; locByCourse?: NumMap;
  woAllView?: { curTotal: number; curCatSum: number; curHidden: number; cumTotal: number; cumCatSum: number; cumHidden: number } | null;
  woAllByCat?: { cur: NumMap; cum: NumMap; curTotal: number; cumTotal: number };
  taskByCat?: NumMap; taskTotal?: number;
  summary?: { total: number; pass: number; fail: number; review: number; na: number };
}
interface BudgetAnchors {
  ts?: string; detailByCat?: NumMap; perfByCat?: NumMap; aggActualByCat?: NumMap; aggTotal?: number | null; aggByCat?: NumMap; aggCatSum?: number; aggConsistent?: boolean;
  locByCourse?: NumMap; axisTotals?: NumMap; summary?: { total: number; pass: number; fail: number; cross: number };
}

const CATS = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
const loadJson = <T>(p: string): T | null => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return null; } };
const won = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString() + '원');
const nrm = (s: string) => (s || '').replace(/\s+/g, '');
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const nearRel = (a: number, b: number, rel = 0.005) => (Math.abs(b) < 1 ? Math.abs(a - b) <= 1 : Math.abs(a - b) / Math.abs(b) <= rel);
const getCat = (m: NumMap | undefined, c: string): number | undefined => { if (!m) return undefined; const k = Object.keys(m).find((x) => nrm(x) === nrm(c)); return k ? m[k] : undefined; };

type Row = { cat: string; a: number | undefined; b: number | undefined; verdict: string; ok: boolean | null };
function compareByCat(aMap: NumMap | undefined, bMap: NumMap | undefined): Row[] {
  return CATS.map((c) => {
    const a = getCat(aMap, c), b = getCat(bMap, c);
    let ok: boolean | null = null; let verdict = '<span class="mut">대조 불가</span>';
    if (a != null && b != null) { ok = nearRel(a, b); verdict = ok ? '<span class="ok">✅ 일치</span>' : '<span class="rv">🔎 확인 필요</span>'; }
    else if (a != null || b != null) verdict = '<span class="mut">한쪽만 수집</span>';
    return { cat: c, a, b, ok, verdict };
  });
}

function catTable(rows: Row[], aLabel: string, bLabel: string): string {
  const body = rows.map((r) => `<tr><td>${esc(r.cat)}</td><td class="num">${won(r.a)}</td><td class="num">${won(r.b)}</td><td>${r.verdict}</td></tr>`).join('');
  const judged = rows.filter((r) => r.ok !== null); const match = judged.filter((r) => r.ok).length;
  const cap = judged.length ? `${match}/${judged.length} 일치` : '대조 대상 없음';
  return `<table><thead><tr><th>분류</th><th class="num">${esc(aLabel)}</th><th class="num">${esc(bLabel)}</th><th>대조</th></tr></thead><tbody>${body}</tbody></table><div class="cap">${cap}</div>`;
}

// 다중 원천 대조: verdictIdx로 지정한 원천들만 상호 일치 판정(나머지 컬럼은 참고 병기).
function multiTable(sources: { label: string; map: NumMap | undefined; ref?: boolean }[]): string {
  const head = sources.map((s) => `<th class="num">${esc(s.label)}${s.ref ? '<span class="mut"> (참고)</span>' : ''}</th>`).join('');
  let matchCnt = 0, judgedCnt = 0;
  const body = CATS.map((c) => {
    const vals = sources.map((s) => getCat(s.map, c));
    const judgeVals = sources.map((s, i) => (s.ref ? undefined : vals[i])).filter((v): v is number => v != null);
    let verdict = '<span class="mut">—</span>';
    if (judgeVals.length >= 2) {
      judgedCnt++;
      const ok = judgeVals.every((v) => nearRel(v, judgeVals[0]));
      if (ok) matchCnt++;
      verdict = ok ? '<span class="ok">✅ 일치</span>' : '<span class="rv">🔎 불일치</span>';
    } else if (judgeVals.length === 1) verdict = '<span class="mut">1개만 수집</span>';
    const cells = vals.map((v) => `<td class="num">${won(v)}</td>`).join('');
    return `<tr><td>${esc(c)}</td>${cells}<td>${verdict}</td></tr>`;
  }).join('');
  const cap = judgedCnt ? `${matchCnt}/${judgedCnt} 원천 일치(참고 컬럼 제외)` : '대조 대상 없음';
  return `<table><thead><tr><th>분류</th>${head}<th>대조</th></tr></thead><tbody>${body}</tbody></table><div class="cap">${cap}</div>`;
}

// 코스별(South/East/West) 두 원천 대조 — 위치별 비용 두 독립 읽기(둘 다 연간, 스코프 일치).
function courseTable(aMap: NumMap | undefined, bMap: NumMap | undefined, aLabel: string, bLabel: string): string {
  const keys = Array.from(new Set([...Object.keys(aMap || {}), ...Object.keys(bMap || {})]));
  const order = ['South', 'East', 'West']; keys.sort((x, y) => order.indexOf(x) - order.indexOf(y));
  let match = 0, judged = 0;
  const body = (keys.length ? keys : ['South', 'East', 'West']).map((c) => {
    const a = getCat(aMap, c), b = getCat(bMap, c);
    let v = '<span class="mut">—</span>';
    if (a != null && b != null) { judged++; const ok = nearRel(a, b); if (ok) match++; v = ok ? '<span class="ok">✅ 일치</span>' : '<span class="rv">🔎 불일치</span>'; }
    else if (a != null || b != null) v = '<span class="mut">한쪽만 수집</span>';
    return `<tr><td>${esc(c)}</td><td class="num">${won(a)}</td><td class="num">${won(b)}</td><td>${v}</td></tr>`;
  }).join('');
  const cap = judged ? `${match}/${judged} 코스 일치` : '대조 대상 없음(라이브 앵커 필요)';
  return `<table><thead><tr><th>코스</th><th class="num">${esc(aLabel)}</th><th class="num">${esc(bLabel)}</th><th>대조</th></tr></thead><tbody>${body}</tbody></table><div class="cap">${cap}</div>`;
}

function main(): void {
  const home = loadJson<HomeAnchors>(path.join('analysis', '_cross-home.json'));
  const budget = loadJson<BudgetAnchors>(path.join('analysis', '_cross-budget.json'));
  const missing: string[] = [];
  if (!home) missing.push('홈 정합성(course:home-verify → analysis/_cross-home.json)');
  if (!budget) missing.push('예산/비용 정합성(course:budget-verify → analysis/_cross-budget.json)');

  // ① 연간예산: HOME 비용탭 연간예산 ↔ 예산 상세 대분류 연간(budget) / HOME 자체 예산상세 수집(home.budgetDetailByCat)
  const c1 = compareByCat(home?.annualByCat, budget?.detailByCat);
  const c1home = compareByCat(home?.annualByCat, home?.budgetDetailByCat);
  // ② 실적 삼각(실적 home/budget + 비용집계 실제발생)은 HTML에서 multiTable로 직접 렌더.
  // ③ 작업지시 비용: 축 총액(참고 — 스코프 상이)
  const axis = budget?.axisTotals || {};
  // ④ (C) 내부정합 국소화
  const wo = home?.woAllView || null;
  const homeInconsistent = wo ? Math.abs(wo.cumHidden) > Math.max(2, Math.abs(wo.cumTotal) * 0.005) : null;
  const budgetConsistent = budget?.aggConsistent ?? null;
  let localizeVerdict = '<span class="mut">데이터 부족 — 판정 보류</span>'; let localizeClass = 'mut';
  if (homeInconsistent === true && budgetConsistent === true) { localizeVerdict = '✅ 국소화 확정 — 원천(비용집계)은 합계=Σ유형 정합, HOME만 불일치 → HOME 작업지시분석 표시/집계 로직 문제'; localizeClass = 'rv'; }
  else if (homeInconsistent === false) { localizeVerdict = '✅ HOME 내부정합(합계=Σ유형) — 불일치 해소됨'; localizeClass = 'ok'; }
  else if (homeInconsistent === true && budgetConsistent !== true) { localizeVerdict = '🔎 HOME 불일치 확인, 원천(비용집계) 정합 여부 미수집 — budget-verify 재실행 필요'; localizeClass = 'rv'; }

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const banner = missing.length ? `<div class="warn">⚠ 앵커 미수집: ${missing.map(esc).join(' · ')} — 해당 검증기를 먼저 실행하세요(각 라이브 1런). 수집된 부분만 대조합니다.</div>` : '';

  const html = `<title>코스관리 교차분석</title>
<style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--rv:#9a6700;--accent:#0969da}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#d4a72c;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#d4a72c;--accent:#58a6ff}
body{background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;margin:0;padding:20px 22px;max-width:1000px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:15.5px;margin:22px 0 8px;padding-top:14px;border-top:1px solid var(--line)}
.sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}
.hero{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--rv);border-radius:10px;padding:14px 16px;margin:10px 0}
.hero.ok{border-left-color:var(--ok)} .hero .h{font-weight:700;font-size:14px;margin-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:4px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-size:11.5px;background:var(--card)}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:var(--ok);font-weight:600}.ng{color:var(--ng);font-weight:600}.rv{color:var(--rv);font-weight:600}.mut{color:var(--mut)}
.cap{color:var(--mut);font-size:12px;margin:2px 0 8px}.note{color:var(--mut);font-size:12.5px;margin:6px 0}
.warn{background:#fff8e5;color:#7a5200;border:1px solid #f0d98a;border-radius:8px;padding:10px 12px;margin:10px 0;font-size:13px}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) .warn{background:#2b2410;color:#e3c26a;border-color:#5c4a17}}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:720px){.grid2{grid-template-columns:1fr}}
</style>
<h1>코스관리 교차분석 — 홈 ↔ 예산/비용 정합성</h1>
<div class="sub">생성 ${ts} · 오프라인 리코셔너(course:cross) · 홈 앵커 ${home?.ts ? esc(home.ts.slice(0, 16)) : '없음'} · 예산 앵커 ${budget?.ts ? esc(budget.ts.slice(0, 16)) : '없음'}</div>
${banner}

<div class="hero ${localizeClass === 'ok' ? 'ok' : ''}">
<div class="h">④ (C) 내부정합 국소화 — 핵심</div>
<div>${localizeVerdict}</div>
${wo ? `<div class="note">HOME 작업지시분석 전체뷰: 누적 합계 ${won(wo.cumTotal)} vs Σ유형 ${won(wo.cumCatSum)} → 미귀속 ${won(wo.cumHidden)}(당월 ${won(wo.curHidden)}) · 비용집계 합계=Σ유형: ${budgetConsistent == null ? '미수집' : budgetConsistent ? '정합(PASS)' : '불일치'}</div>` : '<div class="note">HOME 작업지시분석 앵커 미수집</div>'}
</div>

<h2>⑤ QA-15497 — HOME 작업지시분석(누적) ↔ 비용관리 작업별 비용(YTD)</h2>
${(() => {
    const wo = home?.woAllByCat; const task = home?.taskByCat;
    if (!wo || !task) return '<div class="note mut">앵커 미수집 — course:home-verify 실행 필요(작업별 YTD 대조 포함).</div>';
    let anyBad = false;
    const body = CATS.map((c) => {
      const a = getCat(wo.cum, c), b = getCat(task, c);
      let v = '<span class="mut">—</span>'; let d = '';
      if (a != null && b != null) { const ok = nearRel(a, b); if (!ok) anyBad = true; d = won(b - a); v = ok ? '<span class="ok">✅ 일치</span>' : '<span class="rv">🔎 상이</span>'; }
      return `<tr><td>${esc(c)}</td><td class="num">${won(a)}</td><td class="num">${won(b)}</td><td class="num">${d || '—'}</td><td>${v}</td></tr>`;
    }).join('');
    const tA = wo.cumTotal, tB = home?.taskTotal; const totalOk = tA != null && tB != null && nearRel(tA, tB); if (tA != null && tB != null && !totalOk) anyBad = true;
    const totalRow = `<tr style="font-weight:700;border-top:2px solid var(--fg)"><td>총액</td><td class="num">${won(tA)}</td><td class="num">${won(tB)}</td><td class="num">${tA != null && tB != null ? won(tB - tA) : '—'}</td><td>${tA != null && tB != null ? (totalOk ? '<span class="ok">✅</span>' : '<span class="rv">🔎 상이</span>') : '—'}</td></tr>`;
    const verdict = anyBad ? '<span class="rv">🔎 QA-15497 재현 — 두 화면 금액 상이</span>' : '<span class="ok">✅ 두 화면 금액 일치(QA-15497 해소 추정)</span>';
    return `<div class="hero ${anyBad ? '' : 'ok'}"><div class="h">등록 버그 QA-15497 회귀 대조</div><div>${verdict}</div></div>
<table><thead><tr><th>분류</th><th class="num">HOME 작업지시분석(누적)</th><th class="num">작업별 비용(YTD)</th><th class="num">차이</th><th>대조</th></tr></thead><tbody>${body}${totalRow}</tbody></table>
<div class="note">QA-15497(버그): HOME&gt;비용&gt;작업지시 분석 금액 ≠ 비용관리&gt;작업별 비용. 같은 스코프(당해 YTD)로 대조 → <b>수정되면 일치(✅)로 회귀 통과</b>. 원인분해: <b>스코프 차 2.8M</b> + <b>미귀속 잔여 5.17M</b>(작업지시분석 유형 미분류, ④ 참조). 링크: <a href="https://smartscoretech.atlassian.net/browse/QA-15497">QA-15497</a></div>`;
  })()}

<h2>① 연간예산 원천 — HOME 비용탭 ↔ 예산 상세(대분류)</h2>
<div class="grid2">
<div><div class="cap"><b>기준 A</b>: 예산/비용 검증기가 읽은 예산 상세</div>${catTable(c1, 'HOME 연간예산', '예산 상세(budget)')}</div>
<div><div class="cap"><b>기준 B</b>: 홈 검증기가 읽은 예산 상세(⑪)</div>${catTable(c1home, 'HOME 연간예산', '예산 상세(home)')}</div>
</div>
<div class="note">두 검증기가 각각 읽은 예산 상세로 HOME 연간예산을 교차 확인 → 양쪽 일치면 원천 확정.</div>

<h2>② 실적 삼각 검증 — 실적 관리 = 비용집계 실제발생 (+ HOME 누적사용 참조)</h2>
${multiTable([
    { label: '실적(home 읽기)', map: home?.perfByCat },
    { label: '실적(budget 읽기)', map: budget?.perfByCat },
    { label: '비용집계 실제발생', map: budget?.aggActualByCat },
    { label: 'HOME 누적사용', map: home?.usedByCat, ref: true },
  ])}
<div class="note"><b>동일 원천 3중 대조</b>: 두 검증기가 각자 읽은 <b>실적 관리</b> + <b>비용집계 실제발생</b>(=실적 집계)은 같은 회계 원천이라 <b>정확 일치</b>해야 함 → 불일치 시 파서/화면 이슈. <b>HOME 누적사용(참고)</b>은 연중 누계라 스코프상 실적 연간합 이하일 수 있어 판정에서 제외(병기만).</div>

<h2>③ 작업지시 비용 — 위치별 코스 교차 + 다축 총액</h2>
<div class="cap"><b>③-1 위치별 비용 코스별 — 두 독립 읽기 대조</b>(둘 다 연간, 스코프 일치)</div>
${courseTable(home?.locByCourse, budget?.locByCourse, '위치별(home 읽기)', '위치별(budget 읽기)')}
<div class="note">home-verify(⑰)와 budget-verify가 각자 <b>위치별 비용</b>을 연간으로 읽은 코스별(South/East/West) 총비용 대조 → 같은 작업지시 집계 원천·같은 스코프라 <b>정확 일치</b>해야 함. 불일치 시 파서/화면 이슈.</div>
<div class="cap" style="margin-top:12px"><b>③-2 다축 총액</b>(참고)</div>
<table><thead><tr><th>축(예산/비용 검증기)</th><th class="num">총액</th></tr></thead><tbody>
${Object.keys(axis).length ? Object.entries(axis).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${won(v as number)}</td></tr>`).join('') : '<tr><td class="mut" colspan="2">앵커 미수집</td></tr>'}
</tbody></table>
<div class="note">⚠ HOME 작업지시분석(당월/누적)과 비용 관리 다축(1년창)은 <b>기간 스코프가 달라 총액 직접 비교는 참고용</b>. 대신 ③-1(위치별 코스 동일스코프 대조)·④(합계=Σ유형 구조 정합)이 판정 기준.</div>

<h2>검증기 현황</h2>
<table><thead><tr><th>검증기</th><th class="num">확인</th><th class="num">정상</th><th class="num">주의</th><th class="num">참고</th></tr></thead><tbody>
<tr><td>홈 정합성(home-verify)</td><td class="num">${home?.summary?.total ?? '—'}</td><td class="num ok">${home?.summary?.pass ?? '—'}</td><td class="num">${home?.summary ? (home.summary.fail + (home.summary.review || 0)) : '—'}</td><td class="num mut">${home?.summary?.na ?? '—'}</td></tr>
<tr><td>예산/비용 정합성(budget-verify)</td><td class="num">${budget?.summary?.total ?? '—'}</td><td class="num ok">${budget?.summary?.pass ?? '—'}</td><td class="num">${budget?.summary?.fail ?? '—'}</td><td class="num mut">교차 ${budget?.summary?.cross ?? '—'}</td></tr>
</tbody></table>
<div class="note">각 검증기 라이브 실행(각 1런) 후 이 리코셔너를 재실행하면 최신 앵커로 교차분석이 갱신됩니다. 리코셔너 자체는 로그인 불필요.</div>`;

  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  const out = path.join('reports', 'course-cross.html');
  fs.writeFileSync(out, html, 'utf8');
  console.log(`[course:cross] ${out}`);
  console.log(`  홈 앵커: ${home ? 'O' : 'X'} · 예산 앵커: ${budget ? 'O' : 'X'}`);
  console.log(`  ④ 국소화: ${localizeVerdict.replace(/<[^>]+>/g, '')}`);
  if (missing.length) console.log(`  ⚠ 미수집: ${missing.join(' · ')}`);
}

main();

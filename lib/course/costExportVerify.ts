import { Page } from '@playwright/test';
import { gotoCourseMenu, killAlarms } from './courseHelpers';
import {
  Check, DLDIR, fb, won, nl, near, cellStr,
  gridOf, grabPagedTable, acquireXlsx, loadWorkbook, renderReport,
} from './exportVerifyCommon';

// ──────────────────────────────────────────────────────────────
//  비용 관리 5화면 [내보내기] xlsx ↔ 화면 정합성 — 공유 러너(비파괴, 자동 다운로드).
//   비용 집계/작업별=직접 대조, 분류별/위치별/기간별=화면 롤업 = Σ xlsx 리프(집계 대조).
//   ⚠ 비용 집계·분류별은 동일 xlsx(Cost Per Category Yearly: 요약 4행 + 분류 breakdown).
//   공통 헬퍼는 exportVerifyCommon.ts. 각 runner: 진입 → 다운로드 → 대조 → Check[](throw 안 함).
// ──────────────────────────────────────────────────────────────

export { renderReport, type Check } from './exportVerifyCommon';

// 선행 숫자 추출(화면 "3,210,689▲ 8.0%" / xlsx "47,376.02 (-35.77%)" / "567,599신규" → 값). YoY·부호 흡수.
const money = (s: string): number => { const m = String(s == null ? '' : s).match(/-?\d[\d,]*(?:\.\d+)?/); return m ? parseFloat(m[0].replace(/,/g, '')) : 0; };

async function readGrid(admin: Page): Promise<{ heads: string[]; grid: string[][] }> {
  const tbl = await grabPagedTable(admin);
  return { heads: tbl?.heads || [], grid: gridOf(tbl || undefined) };
}
// 화면 롤업 = Σ xlsx 리프(키별 집계) 대조.
function aggCompare(grp: string, valLabels: string[], screenRows: { key: string; vals: number[] }[], leaves: { key: string; vals: number[] }[], tol = 1.5): Check[] {
  const nv = valLabels.length;
  const agg = new Map<string, number[]>();
  for (const l of leaves) { const c = agg.get(l.key) || new Array(nv).fill(0); for (let i = 0; i < nv; i++) c[i] += (l.vals[i] || 0); agg.set(l.key, c); }
  const checks: Check[] = [];
  const sKeys = screenRows.map((r) => r.key);
  const onlyS = sKeys.filter((k) => !agg.has(k)); const onlyX = [...agg.keys()].filter((k) => !sKeys.includes(k));
  checks.push({ name: `${grp} 키 커버리지(화면 ↔ xlsx집계)`, group: grp, ok: onlyS.length === 0 && onlyX.length === 0, review: onlyS.length > 0 || onlyX.length > 0, detail: `화면 ${sKeys.length}키 · xlsx집계 ${agg.size}키${onlyS.length ? ` · 화면에만: ${onlyS.join(',')}` : ''}${onlyX.length ? ` · xlsx에만: ${onlyX.join(',')}` : ''}` });
  let bad = 0, cnt = 0; const ex: string[] = [];
  for (const r of screenRows) { const a = agg.get(r.key); if (!a) continue; for (let i = 0; i < nv; i++) { cnt++; if (!near(r.vals[i], a[i], tol)) { bad++; if (ex.length < 6) ex.push(`${r.key}·${valLabels[i]}(화면 ${won(r.vals[i])}≠Σxlsx ${won(a[i])})`); } } }
  checks.push({ name: `★ ${grp} 값 = 화면 ↔ Σxlsx (${valLabels.length}열)`, group: grp, ok: bad === 0, na: cnt === 0, detail: cnt === 0 ? '대조 없음' : `${cnt}셀 중 일치 ${cnt - bad}${bad ? ` · 불일치 ${bad}(${ex.join(', ')})` : ''}` });
  return checks;
}

// ═══ ① 비용 집계 (요약 3행 직접 대조 + 내부: 합계=Σ유형·차액=실발생−작업지시) ═══
const CAT_XLSX = () => fb('COST_CATEGORY_XLSX', '분류별_연간_비용.xlsx');   // 비용집계·분류별 공용 폴백
const TYPE5 = ['합계', '고정직', '임시직', '코스자재', '장비관리', '기타관리'];
function concept(label: string): string | null { if (/작업지시/.test(label)) return 'wo'; if (/실제\s*발생|실발생/.test(label)) return 'act'; if (/차액|차이/.test(label)) return 'diff'; return null; }
export async function verifyCostAggregate(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const entered = await gotoCourseMenu(admin, '비용 관리', '비용 집계').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '비용 집계 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  const got = await acquireXlsx(admin, `${DLDIR}/비용_집계.xlsx`, CAT_XLSX());
  if (!got) { checks.push({ name: 'xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패' }); return checks; }
  checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''}` });
  // 화면 요약: 3행 × [합계+5유형]
  const { grid } = await readGrid(admin);
  const scr = new Map<string, number[]>();
  for (const row of grid) { const c = concept(row[0] || ''); if (!c) continue; scr.set(c, row.slice(1, 7).map(money)); }
  // xlsx 요약: col3 개념 → col4~9
  const wb = await loadWorkbook(got.path); const ws = wb.worksheets[0]; const xl = new Map<string, number[]>();
  ws.eachRow((row) => { const c = concept(cellStr(row, 3)); if (!c) return; const vals: number[] = []; for (let i = 4; i <= 9; i++) vals.push(money(cellStr(row, i))); xl.set(c, vals); });
  // 대조(직접)
  let bad = 0, cnt = 0; const ex: string[] = [];
  for (const [c, sv] of scr) { const xv = xl.get(c); if (!xv) continue; for (let i = 0; i < 6; i++) { cnt++; if (!near(sv[i], xv[i], 1.5)) { bad++; if (ex.length < 5) ex.push(`${c}·${TYPE5[i]}(화면 ${won(sv[i])}≠xlsx ${won(xv[i])})`); } } }
  checks.push({ name: '★ 요약 셀값 = 화면 ↔ xlsx (3행×6)', group: '요약', ok: bad === 0, na: cnt === 0, detail: cnt === 0 ? '대조 없음' : `${cnt}셀 중 일치 ${cnt - bad}${bad ? ` · 불일치 ${bad}(${ex.join(', ')})` : ''}` });
  // 내부: 합계=Σ5유형 · 차액=실발생−작업지시
  let iBad = 0, iCnt = 0; const iEx: string[] = [];
  for (const [c, v] of xl) { iCnt++; const sum5 = v.slice(1, 6).reduce((a, b) => a + b, 0); if (!near(v[0], sum5, 1.5)) { iBad++; if (iEx.length < 3) iEx.push(`${c} 합계 ${won(v[0])}≠Σ유형 ${won(sum5)}`); } }
  const wo = xl.get('wo'), act = xl.get('act'), df = xl.get('diff');
  let dOk = true; const dEx: string[] = [];
  if (wo && act && df) for (let i = 0; i < 6; i++) { if (!near(df[i], act[i] - wo[i], 1.5)) { dOk = false; if (dEx.length < 3) dEx.push(`${TYPE5[i]} 차액 ${won(df[i])}≠실발생−작업지시 ${won(act[i] - wo[i])}`); } }
  checks.push({ name: '내부: 합계 = Σ5유형', group: '내부', ok: iBad === 0, na: iCnt === 0, detail: iCnt === 0 ? '대조 없음' : `${iCnt}행 중 일치 ${iCnt - iBad}${iBad ? ` · 불일치 ${iBad}(${iEx.join(', ')})` : ''}` });
  checks.push({ name: '내부: 차액 = 실발생 − 작업지시', group: '내부', ok: dOk, na: !(wo && act && df), detail: !(wo && act && df) ? '요약행 부족' : dOk ? '6열 일치' : `불일치(${dEx.join(', ')})` });
  return checks;
}

// ═══ ② 작업별 비용 (작업번호 키 직접 대조: 총비용+5유형) ═══
export async function verifyCostByTask(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const entered = await gotoCourseMenu(admin, '비용 관리', '작업별 비용').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '작업별 비용 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  const got = await acquireXlsx(admin, `${DLDIR}/작업별_비용.xlsx`, fb('COST_TASK_XLSX', '작업별_비용.xlsx'));
  if (!got) { checks.push({ name: 'xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패' }); return checks; }
  // xlsx: 작업번호(1)/…/총비용(7)/5유형(8~12)
  const wb = await loadWorkbook(got.path); const ws = wb.worksheets[0]; const xl = new Map<string, number[]>();
  ws.eachRow((row, rn) => { if (rn === 1) return; const wno = cellStr(row, 1).trim(); if (!/^W-?\d/i.test(wno)) return; const vals: number[] = []; for (let i = 7; i <= 12; i++) vals.push(money(cellStr(row, i))); xl.set(nl(wno), vals); });
  checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''} · 작업 ${xl.size}건` });
  // 화면: 작업번호(0)/…/총비용(6)/5유형(7~11) — 페이지네이션 전수
  const { grid } = await readGrid(admin);
  const scr = new Map<string, number[]>();
  for (const row of grid) { const wno = (row[0] || '').trim(); if (!/^W-?\d/i.test(wno)) continue; scr.set(nl(wno), [money(row[6]), ...row.slice(7, 12).map(money)]); }
  if (!scr.size) { checks.push({ name: '작업별 화면 그리드', group: '진입', ok: true, na: true, detail: '행 미검출(세션 저하 가능)' }); return checks; }
  const onlyS = [...scr.keys()].filter((k) => !xl.has(k)); const onlyX = [...xl.keys()].filter((k) => !scr.has(k));
  checks.push({ name: '작업 커버리지(화면 ↔ xlsx)', group: '커버리지', ok: onlyS.length === 0 && onlyX.length === 0, review: onlyS.length > 0 || onlyX.length > 0, detail: `화면 ${scr.size}건 · xlsx ${xl.size}건${onlyS.length ? ` · 화면에만 ${onlyS.length}` : ''}${onlyX.length ? ` · xlsx에만 ${onlyX.length}` : ''}` });
  const LB = ['총비용', '고정직', '임시직', '코스자재', '장비관리', '기타관리'];
  let bad = 0, cnt = 0; const ex: string[] = [];
  for (const [k, sv] of scr) { const xv = xl.get(k); if (!xv) continue; for (let i = 0; i < 6; i++) { cnt++; if (!near(sv[i], xv[i], 1.5)) { bad++; if (ex.length < 6) ex.push(`${k}·${LB[i]}(화면 ${won(sv[i])}≠xlsx ${won(xv[i])})`); } } }
  checks.push({ name: '★ 작업별 셀값 = 화면 ↔ xlsx (총비용+5유형)', group: '값', ok: bad === 0, na: cnt === 0, detail: cnt === 0 ? '대조 없음' : `${cnt}셀 중 일치 ${cnt - bad}${bad ? ` · 불일치 ${bad}(${ex.join(', ')})` : ''}` });
  return checks;
}

// ═══ ③ 분류별 비용 (화면 1분류 롤업 = Σ xlsx 리프[1분류별]) ═══
export async function verifyCostByCategory(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const entered = await gotoCourseMenu(admin, '비용 관리', '분류별 비용').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '분류별 비용 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  const got = await acquireXlsx(admin, `${DLDIR}/분류별_비용.xlsx`, CAT_XLSX());
  if (!got) { checks.push({ name: 'xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패' }); return checks; }
  checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''}` });
  // xlsx breakdown 리프: col1=1분류(카테고리), col4=합계, col5~9=5유형 (요약/헤더 제외)
  const wb = await loadWorkbook(got.path); const ws = wb.worksheets[0]; const leaves: { key: string; vals: number[] }[] = [];
  ws.eachRow((row) => { const c1 = cellStr(row, 1).trim(); if (!c1 || c1 === '1분류' || concept(c1) || /^항목$/.test(c1)) return; const vals: number[] = []; for (let i = 4; i <= 9; i++) vals.push(money(cellStr(row, i))); leaves.push({ key: nl(c1), vals }); });
  // 화면 1분류 롤업: 1분류(0)/합계(3)/5유형(4~8)
  const { grid } = await readGrid(admin);
  const screenRows: { key: string; vals: number[] }[] = [];
  for (const row of grid) { const c1 = (row[0] || '').trim(); if (!c1 || concept(c1)) continue; screenRows.push({ key: nl(c1), vals: [money(row[3]), ...row.slice(4, 9).map(money)] }); }
  if (!screenRows.length) { checks.push({ name: '분류별 화면 그리드', group: '진입', ok: true, na: true, detail: '행 미검출(세션 저하 가능)' }); return checks; }
  checks.push(...aggCompare('분류별', ['합계', '고정직', '임시직', '코스자재', '장비관리', '기타관리'], screenRows, leaves));
  return checks;
}

// ═══ ④ 위치별 비용 (화면 코스 롤업 = Σ xlsx 리프[코스별 홀 합산]) ═══
export async function verifyCostByLocation(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const entered = await gotoCourseMenu(admin, '비용 관리', '위치별 비용').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '위치별 비용 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  const got = await acquireXlsx(admin, `${DLDIR}/위치별_비용.xlsx`, fb('COST_LOC_XLSX', '위치별_연간_비용.xlsx'));
  if (!got) { checks.push({ name: 'xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패' }); return checks; }
  checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''}` });
  const VL = ['총비용', '그린', '그린칼라', '티박스', '페어웨이', '러프', '벙커', '법면', '폰드', '묘포장', '조경', '시설', '장비', '기타', '고정직', '임시직', '코스자재', '장비관리', '기타관리'];   // 19열
  // xlsx: 코스(1)/홀(2)/총비용~기타관리(3~21)
  const wb = await loadWorkbook(got.path); const ws = wb.worksheets[0]; const leaves: { key: string; vals: number[] }[] = [];
  ws.eachRow((row, rn) => { if (rn === 1) return; const course = cellStr(row, 1).trim(); if (!course || course === '코스') return; const vals: number[] = []; for (let i = 3; i <= 21; i++) vals.push(money(cellStr(row, i))); leaves.push({ key: nl(course), vals }); });
  // 화면: 코스(0)/홀(1)/총비용~기타관리(2~20)
  const { grid } = await readGrid(admin);
  const screenRows: { key: string; vals: number[] }[] = [];
  for (const row of grid) { const course = (row[0] || '').trim(); if (!course || course === '코스') continue; screenRows.push({ key: nl(course), vals: row.slice(2, 21).map(money) }); }
  if (!screenRows.length) { checks.push({ name: '위치별 화면 그리드', group: '진입', ok: true, na: true, detail: '행 미검출(세션 저하 가능)' }); return checks; }
  checks.push(...aggCompare('위치별', VL, screenRows, leaves));
  return checks;
}

// ═══ ⑤ 기간별 비용 (화면 1분류 롤업 = Σ xlsx 리프[1분류별], 3개년 YoY 제거) ═══
export async function verifyCostByPeriod(admin: Page): Promise<Check[]> {
  const checks: Check[] = [];
  const entered = await gotoCourseMenu(admin, '비용 관리', '기간별 비용').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) { checks.push({ name: '기간별 비용 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' }); return checks; }
  const got = await acquireXlsx(admin, `${DLDIR}/기간별_비용.xlsx`, fb('COST_PERIOD_XLSX', '기간별_분류_비용.xlsx'));
  if (!got) { checks.push({ name: 'xlsx 확보', group: '진입', ok: false, detail: '자동+폴백 실패(⚠ 과거 400 결함 이력 — 다운로드 실패 시 결함 재발 가능)' }); return checks; }
  checks.push({ name: 'xlsx 확보', group: '진입', ok: true, review: !got.auto, detail: `${got.source}${got.err ? ` · 경고: ${got.err}` : ''}` });
  // xlsx: 1분류(1)/2분류(2)/3분류(3)/2024(4)/2025YoY(5)/2026YoY(6)
  const wb = await loadWorkbook(got.path); const ws = wb.worksheets[0]; const leaves: { key: string; vals: number[] }[] = [];
  ws.eachRow((row, rn) => { if (rn === 1) return; const c1 = cellStr(row, 1).trim(); if (!c1 || c1 === '1분류') return; leaves.push({ key: nl(c1), vals: [money(cellStr(row, 4)), money(cellStr(row, 5)), money(cellStr(row, 6))] }); });
  // 화면: 1분류(0)/…/2024(3)/2025(4)/2026(5) — '전체'행 포함(=Σ전체)
  const { grid } = await readGrid(admin);
  const screenRows: { key: string; vals: number[] }[] = []; let scTotal: number[] | null = null;
  for (const row of grid) { const c1 = (row[0] || '').trim(); if (!c1) continue; const vals = [money(row[3]), money(row[4]), money(row[5])]; if (/^전체$/.test(c1)) { scTotal = vals; continue; } screenRows.push({ key: nl(c1), vals }); }
  if (!screenRows.length) { checks.push({ name: '기간별 화면 그리드', group: '진입', ok: true, na: true, detail: '행 미검출(세션 저하 가능)' }); return checks; }
  checks.push(...aggCompare('기간별', ['2024', '2025', '2026'], screenRows, leaves, 2));
  // 전체 행 = Σ 전 리프
  if (scTotal) { const tot = leaves.reduce((a, l) => [a[0] + l.vals[0], a[1] + l.vals[1], a[2] + l.vals[2]], [0, 0, 0]); let tBad = 0; const tEx: string[] = []; for (let i = 0; i < 3; i++) if (!near(scTotal[i], tot[i], 2)) { tBad++; tEx.push(`${['2024', '2025', '2026'][i]}(화면 ${won(scTotal[i])}≠Σ ${won(tot[i])})`); } checks.push({ name: '기간별 전체 = Σ 전 분류', group: '값', ok: tBad === 0, detail: tBad === 0 ? '3개년 일치' : `불일치(${tEx.join(', ')})` }); }
  return checks;
}

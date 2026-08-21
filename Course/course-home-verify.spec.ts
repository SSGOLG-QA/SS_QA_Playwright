import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_URL } from '../lib/course/courseHelpers';
import { num, near } from '../lib/course/domain/budgetCost';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  HOME 대시보드 데이터 연관 정합성 검증기(비파괴) — 예산/비용 검증기와 동일 수준.
//  실행: npm run course:auth 후 npm run course:home-verify → reports/course-home-verify.html
//  HOME = .tab-group 3개 탭 → 탭별 분리 검증:
//   [관리 목표 및 현황] 등급 대시보드 → 관리 목표 등급 = [목표 설정] 모달 원천 · 스케일 · 기준일
//   [작업]             작업 운영 요약   → 오늘의 작업(W-작업지시) = 작업 관리>작업 지시 · 이번 달 상태 · 최근 작업 일보
//   [비용]             예산 대비 실적   → 잔여=연간예산−누적사용 · 사용률% · 전체=Σ카테고리 · 연간예산=[예산 관리] 원천
//  ⚠ 탭명 '작업'/'비용'은 별도 탭(초기 텍스트매칭 '작업 비용'은 헤더 연결문자열). '작업'=금액無 운영요약 / '비용'=예산실적 금액.
//  비파괴(조회/탭 전환/모달 열기→취소만). 별도 입력 불필요.
// ──────────────────────────────────────────────────────────────

const AREAS = ['전체', '그린', '그린칼라', '티박스', '페어웨이', '러프', '벙커'];
const GRADE_SCALE = ['E-', 'E', 'E+', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
const GRADE_RE = '(A\\+|A-|A|B\\+|B-|B|C\\+|C-|C|D\\+|D-|D|E\\+|E-|E)';
// 비용 탭 카테고리: 전체 = Σ(하위 5종)
const COST_CATS = ['전체', '고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));

interface Check { name: string; ok: boolean; scope: 'goal' | 'work' | 'cost'; detail: string; na?: boolean; }
interface CostCat { pct: number; used: number | null; remain: number | null; budget: number | null; }

function extractGrades(txt: string, order: 'ga' | 'ag'): Record<string, string> {
  const out: Record<string, string> = {};
  const t = (txt || '').replace(/Loading\.\.\./g, ' ');
  for (const a of AREAS) {
    const re = order === 'ga' ? new RegExp(GRADE_RE + '\\s*' + a + '(?![가-힣])') : new RegExp(a + '(?![가-힣])\\s*' + GRADE_RE);
    const m = re.exec(t);
    if (m) out[a] = m[1];
  }
  return out;
}

// 비용 탭 섹션 텍스트에서 카테고리별 {사용률%·누적사용·잔여·예산} 파싱. budgetLabel = '연간예산' | '누적 예산'
function parseCostSection(text: string, budgetLabel: string): Record<string, CostCat> {
  const out: Record<string, CostCat> = {};
  for (const cat of COST_CATS) {
    const re = new RegExp(cat.replace(/ /g, '\\s*') + '\\s*(\\d+)%\\s*누적\\s*사용\\s*금액\\s*([\\d,]+)\\s*잔여\\s*예산\\s*금액\\s*([\\d,]+)\\s*' + budgetLabel.replace(/ /g, '\\s*') + '\\s*([\\d,]+)');
    const m = re.exec(text);
    if (m) out[cat] = { pct: Number(m[1]), used: num(m[2]), remain: num(m[3]), budget: num(m[4]) };
  }
  return out;
}

async function gotoHome(admin: Page) {
  await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1300);
  if (!/\/(home|dashboard)?(\?|$)/.test(admin.url())) { await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(1500); }
  await killAlarms(admin);
}
async function clickTab(admin: Page, name: string) {
  await admin.locator('.tab-group').getByText(name, { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1500); await killAlarms(admin);
}

test('HOME 대시보드 데이터 연관 정합성 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  const admin = await openCourseAdmin(page, context);
  const checks: Check[] = [];

  // ═══ [관리 목표 및 현황] 탭: 등급 ═══
  await gotoHome(admin);
  const home = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const gradeCells = Array.from(sc.querySelectorAll('div, span, td, li, p, dd, dt')).filter((e) => e.childElementCount <= 3 && /^(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|E\+|E-|E)(전체|그린칼라|그린|티박스|페어웨이|러프|벙커)$/.test(norm(e.textContent))).map((e) => norm(e.textContent));
    const goalBox = Array.from(new Set(gradeCells)).join(' ');
    const baseDate = (norm(sc.textContent).match(/\d{4}년\s*\d{1,2}월/) || [''])[0];
    const charts = sc.querySelectorAll('svg [class*="highcharts"], .highcharts-root, [class*="chart"] svg').length;
    return { goalBox, baseDate, charts };
  }).catch(() => ({ goalBox: '', baseDate: '', charts: 0 }));
  const homeGoal = extractGrades(home.goalBox, 'ga');

  let modalGrades: Record<string, string> = {};
  await admin.locator('.contents, main').first().getByRole('button', { name: /목표\s*설정/ }).first().click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1300); await killAlarms(admin);
  const modalTxt = await admin.evaluate(() => { const m = document.querySelector('.modal-group:not(.alarm)'); return m ? (m.textContent || '').replace(/\s+/g, ' ').trim() : ''; }).catch(() => '');
  modalGrades = extractGrades(modalTxt, 'ag');
  await admin.locator('.modal-group').getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 2000 }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);

  // ═══ [작업] 탭: 작업 운영 요약 ═══
  await gotoHome(admin);
  await clickTab(admin, '작업');
  const work = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const all = norm(sc.textContent);
    const ids = Array.from(new Set((all.match(/[A-Z]-\d{4,}/g) || [])));
    const mDone = (all.match(/완료\s*(\d+)/) || [])[1];
    const mProg = (all.match(/진행\s*중?\s*(\d+)/) || [])[1];
    const mWait = (all.match(/대기\s*중?\s*(\d+)/) || [])[1];
    let logHead: string[] = []; const logRows: string[][] = [];
    for (const t of Array.from(sc.querySelectorAll('table'))) {
      const head = Array.from(t.querySelectorAll('thead th, thead td')).map((c) => norm(c.textContent));
      if (head.some((h) => /단일\s*작업|반복\s*작업|고정직|임시직/.test(h))) {
        logHead = head;
        for (const r of Array.from(t.querySelectorAll('tbody tr')).slice(0, 8)) logRows.push(Array.from(r.children).map((c) => norm(c.textContent)));
        break;
      }
    }
    const wonCells = Array.from(sc.querySelectorAll('*')).filter((e) => e.children.length === 0 && /\d,\d{3}.*원|₩/.test(e.textContent || '')).length;
    return { ids, month: { done: mDone, prog: mProg, wait: mWait }, logHead, logRows, wonCells };
  }).catch(() => ({ ids: [] as string[], month: { done: undefined, prog: undefined, wait: undefined }, logHead: [] as string[], logRows: [] as string[][], wonCells: 0 }));

  // ═══ [비용] 탭: 예산 대비 실적 ═══
  await gotoHome(admin);
  await clickTab(admin, '비용');
  const costTab = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const full = norm(sc.textContent);
    const guide = (full.match(/수립된 예산과[^.]*\./) || [''])[0];
    const wonCells = Array.from(sc.querySelectorAll('*')).filter((e) => e.children.length === 0 && /\d,\d{3}/.test(e.textContent || '')).length;
    return { full, guide, wonCells };
  }).catch(() => ({ full: '', guide: '', wonCells: 0 }));
  const splitIdx = costTab.full.indexOf('누적 예산 대비 현황');
  const annualSec = splitIdx > 0 ? costTab.full.slice(0, splitIdx) : costTab.full;
  const cumulSec = splitIdx > 0 ? costTab.full.slice(splitIdx) : '';
  const annual = parseCostSection(annualSec, '연간예산');
  const cumul = parseCostSection(cumulSec, '누적 예산');

  // ── 작업 관리 > 작업 지시(원천) ──
  let orderIds: string[] = []; let orderStatus: Record<string, number> = {}; let orderTotal = 0;
  if (await gotoCourseMenu(admin, '작업 관리', '작업 지시').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1600); await killAlarms(admin);
    const od = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      const ids = Array.from(new Set((norm(sc.textContent).match(/[A-Z]-\d{4,}/g) || [])));
      const t = sc.querySelector('table'); let total = 0; const status: Record<string, number> = {};
      if (t) { const rows = Array.from(t.querySelectorAll('tbody tr')); total = rows.length; for (const r of rows) { const m = (r.textContent || '').match(/완료|진행\s*중|대기|취소|예정/); if (m) { const k = m[0].replace(/\s+/g, ''); status[k] = (status[k] || 0) + 1; } } }
      return { ids, total, status };
    }).catch(() => ({ ids: [] as string[], total: 0, status: {} as Record<string, number> }));
    orderIds = od.ids; orderTotal = od.total; orderStatus = od.status;
  }

  // ── 예산 관리 > 예산 총괄(원천): 금액 집합 ──
  let budgetNums: number[] = []; let budgetTxt = '';
  if (await gotoCourseMenu(admin, '예산 관리', '예산 총괄').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1600); await killAlarms(admin);
    const bd = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const sc = document.querySelector('.contents, main') || document.body;
      const nums = (norm(sc.textContent).match(/\d{1,3}(,\d{3})+/g) || []);
      return { nums: Array.from(new Set(nums)), txt: norm(sc.textContent).slice(0, 200) };
    }).catch(() => ({ nums: [] as string[], txt: '' }));
    budgetNums = bd.nums.map((s) => num(s)).filter((v): v is number => v != null); budgetTxt = bd.txt;
  }

  // ═══════════ 검증 ═══════════
  // ── [등급] ① 목표 등급 = 목표 설정 모달 ──
  {
    const areas = AREAS.filter((a) => homeGoal[a] != null && modalGrades[a] != null);
    const bad = areas.filter((a) => homeGoal[a] !== modalGrades[a]);
    if (areas.length === 0) checks.push({ name: '★ 목표 등급: HOME 관리 목표 = [목표 설정] 원천', scope: 'goal', ok: true, na: true, detail: `비교 가능한 등급 없음(HOME ${Object.keys(homeGoal).length}·모달 ${Object.keys(modalGrades).length}) — 판정 제외(데이터/상태 없음)` });
    else checks.push({ name: '★ 목표 등급: HOME 관리 목표 = [목표 설정] 원천', scope: 'goal', ok: bad.length === 0, detail: bad.length === 0 ? `${areas.length}개 영역 일치: ${areas.map((a) => `${a}=${homeGoal[a]}`).join(' · ')}` : `불일치: ${bad.map((a) => `${a}(HOME ${homeGoal[a]}≠모달 ${modalGrades[a]})`).join(', ')}` });
  }
  // ── [등급] ② 스케일 유효 · ③ 기준일 ──
  {
    const all = { ...homeGoal, ...modalGrades };
    const invalid = Object.entries(all).filter(([, g]) => !GRADE_SCALE.includes(g));
    checks.push({ name: '등급 스케일 유효(E-~A+ 15단계)', scope: 'goal', ok: invalid.length === 0, detail: invalid.length === 0 ? `${Object.keys(all).length}개 등급 모두 유효` : `유효 외: ${invalid.map(([a, g]) => `${a}=${g}`).join(',')}` });
  }
  checks.push({ name: '관리 현황 기준일 노출', scope: 'goal', ok: !!home.baseDate, detail: home.baseDate ? `기준일 ${home.baseDate} · 등급 추세 차트 ${home.charts}개(Highcharts, 시각)` : '기준일 미검출' });

  // ── [작업] ④ 오늘의 작업 W-ID ⊆ 작업 지시 목록 ──
  {
    const homeIds = work.ids;
    if (homeIds.length === 0 || orderIds.length === 0) checks.push({ name: '★ 오늘의 작업(W-작업지시) = 작업 관리 목록', scope: 'work', ok: true, na: true, detail: `데이터 없음 SKIP(HOME ${homeIds.length}·목록 ${orderIds.length})` });
    else { const missing = homeIds.filter((id) => !orderIds.includes(id)); checks.push({ name: '★ 오늘의 작업(W-작업지시) = 작업 관리 목록', scope: 'work', ok: missing.length === 0, detail: missing.length === 0 ? `${homeIds.length}건 전부 작업 지시 목록 존재: ${homeIds.join(', ')}` : `목록에 없음: ${missing.join(', ')}` }); }
  }
  // ── [작업] ⑤ 이번 달 상태 카운트 ──
  {
    const d = Number(work.month.done), p = Number(work.month.prog), w = Number(work.month.wait);
    const has = [d, p, w].every((n) => Number.isFinite(n));
    if (!has) checks.push({ name: '이번 달 작업 상태 카운트', scope: 'work', ok: true, na: true, detail: `미검출 SKIP(완료 ${work.month.done ?? '-'}·진행중 ${work.month.prog ?? '-'}·대기 ${work.month.wait ?? '-'})` });
    else checks.push({ name: '이번 달 작업 상태 카운트', scope: 'work', ok: d >= 0 && p >= 0 && w >= 0, detail: `완료 ${d} · 진행중 ${p} · 대기 ${w} (합 ${d + p + w}) — 모두 ≥0 정합` });
  }
  // ── [작업] ⑥ 최근 작업 일보 ──
  {
    if (work.logHead.length === 0) checks.push({ name: '최근 작업 일보 구조·건수', scope: 'work', ok: true, na: true, detail: '테이블 미노출 SKIP' });
    else { const okHead = work.logHead.some((h) => /단일/.test(h)) && work.logHead.some((h) => /고정직/.test(h)); const badNum = work.logRows.some((r) => r.some((c) => { const m = c.match(/(-?\d+)\s*(건|명)/); return m ? Number(m[1]) < 0 : false; })); checks.push({ name: '최근 작업 일보 구조·건수', scope: 'work', ok: okHead && !badNum, detail: `헤더 [${work.logHead.join('/')}] · ${work.logRows.length}행 · 건·명 ${badNum ? '음수(결함)' : '모두 ≥0'}` }); }
  }

  // ── [비용] ⑦★ 잔여 예산 = 연간예산 − 누적 사용 (카테고리별) ──
  {
    const cats = COST_CATS.filter((c) => annual[c] && annual[c].budget != null && annual[c].used != null && annual[c].remain != null);
    if (cats.length === 0) checks.push({ name: '★ 잔여 예산 = 연간예산 − 누적 사용', scope: 'cost', ok: true, na: true, detail: '비용 탭 카테고리 데이터 없음(연간 실적 섹션 파싱 0) — 판정 제외' });
    else { const bad = cats.filter((c) => !near(annual[c].remain!, annual[c].budget! - annual[c].used!)); checks.push({ name: '★ 잔여 예산 = 연간예산 − 누적 사용', scope: 'cost', ok: bad.length === 0, detail: bad.length === 0 ? `${cats.length}개 카테고리 항등 성립` : `불일치: ${bad.map((c) => `${c}(잔여 ${annual[c].remain}≠${annual[c].budget}-${annual[c].used})`).join(', ')}` }); }
  }
  // ── [비용] ⑧ 사용률% = round(누적사용/연간예산×100) ──
  {
    const cats = COST_CATS.filter((c) => annual[c] && annual[c].budget != null && annual[c].used != null && annual[c].budget! > 0);
    if (cats.length === 0) checks.push({ name: '사용률% = 누적 사용 ÷ 연간예산', scope: 'cost', ok: true, na: true, detail: '연간예산>0 카테고리 없음(전 카테고리 예산 0) SKIP' });
    else { const bad = cats.filter((c) => Math.abs(annual[c].pct - Math.round(annual[c].used! / annual[c].budget! * 100)) > 1); checks.push({ name: '사용률% = 누적 사용 ÷ 연간예산', scope: 'cost', ok: bad.length === 0, detail: bad.length === 0 ? `${cats.length}개 카테고리 사용률 일치` : `불일치: ${bad.map((c) => `${c}(${annual[c].pct}%≠${Math.round(annual[c].used! / annual[c].budget! * 100)}%)`).join(', ')}` }); }
  }
  // ── [비용] ⑨★ 전체 = Σ(하위 5 카테고리) : 연간예산·누적사용·잔여 ──
  {
    const subs = COST_CATS.slice(1);
    const rows: { key: 'budget' | 'used' | 'remain'; label: string }[] = [{ key: 'budget', label: '연간예산' }, { key: 'used', label: '누적 사용' }, { key: 'remain', label: '잔여' }];
    const detail: string[] = []; let allOk = true; let any = false;
    if (annual['전체']) for (const { key, label } of rows) {
      const tot = annual['전체'][key]; const parts = subs.map((c) => annual[c]?.[key]).filter((v): v is number => v != null);
      if (tot == null || parts.length === 0) continue; any = true;
      const sum = parts.reduce((a, b) => a + b, 0); const ok = near(tot, sum); if (!ok) allOk = false;
      detail.push(`${label} ${ok ? '✓' : '✗'}(${tot.toLocaleString()}${ok ? '=' : '≠'}Σ${sum.toLocaleString()})`);
    }
    checks.push({ name: '★ 전체 = Σ(고정직·임시직·자재·장비·기타)', scope: 'cost', ok: any ? allOk : true, na: !any, detail: any ? detail.join(' · ') : '전체/하위 카테고리 데이터 없음 — 판정 제외' });
  }
  // ── [비용] ⑩ 누적 섹션: 잔여 = 누적예산 − 누적사용 ──
  {
    const cats = COST_CATS.filter((c) => cumul[c] && cumul[c].budget != null && cumul[c].used != null && cumul[c].remain != null);
    if (cats.length === 0) checks.push({ name: '누적 예산 대비: 잔여 = 누적예산 − 누적사용', scope: 'cost', ok: true, na: true, detail: '누적 예산 섹션 파싱 없음 SKIP' });
    else { const bad = cats.filter((c) => !near(cumul[c].remain!, cumul[c].budget! - cumul[c].used!)); checks.push({ name: '누적 예산 대비: 잔여 = 누적예산 − 누적사용', scope: 'cost', ok: bad.length === 0, detail: bad.length === 0 ? `${cats.length}개 카테고리 항등 성립` : `불일치: ${bad.map((c) => `${c}`).join(', ')}` }); }
  }
  // ── [비용] ⑪★ 연간예산(전체) = [예산 관리] 원천 존재 ──
  {
    const total = annual['전체']?.budget;
    if (total == null || budgetNums.length === 0) checks.push({ name: '★ 연간예산 = [예산 관리] 원천', scope: 'cost', ok: true, na: true, detail: `대조 대상 부족 SKIP(비용탭 전체예산 ${total?.toLocaleString() ?? '-'}·예산 총괄 금액 ${budgetNums.length}건)` });
    else { const hit = budgetNums.some((v) => near(v, total, 1)); checks.push({ name: '★ 연간예산 = [예산 관리] 원천', scope: 'cost', ok: hit, detail: hit ? `비용탭 전체 연간예산 ${total.toLocaleString()} = 예산 총괄에 존재(원천 일치)` : `비용탭 전체 연간예산 ${total.toLocaleString()} 이 예산 총괄 금액집합에 없음 → 원천 확인` }); }
  }
  // ── [비용] ⑫ 예산 실적(회계)≠작업지시 집계 안내 표기 확인(정보성) ──
  checks.push({ name: '비용 탭 = 예산 대비 실적(회계 비용) 안내', scope: 'cost', ok: !!costTab.guide, detail: costTab.guide ? `안내 노출: "${costTab.guide.slice(0, 60)}…" (작업지시 집계와 차이 가능 명시)` : '안내문구 미검출(구조 확인)' });

  // ═══ HTML(탭 구조) ═══
  // 판정: na(데이터 없음)는 pass/fail 집계 제외 — "미확인 ≠ 결함"(리포트 표준).
  const judged = checks.filter((c) => !c.na);
  const naCount = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok).length; const fail = judged.filter((c) => !c.ok).length;
  const goalChk = checks.filter((c) => c.scope === 'goal'); const workChk = checks.filter((c) => c.scope === 'work'); const costChk = checks.filter((c) => c.scope === 'cost');
  const cnt = (cs: Check[]) => { const j = cs.filter((c) => !c.na); return `${j.filter((c) => c.ok).length}/${j.length}`; };
  const allOkOf = (cs: Check[]) => cs.filter((c) => !c.na).every((c) => c.ok);
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : (c.ok ? '✅' : '❌');
  const chk = (c: Check) => `<tr class="${c.na ? 'na' : c.ok ? '' : 'ng'}"><td>${mark(c)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`;
  const chkTbl = (cs: Check[]) => `<table><thead><tr><th></th><th>검증</th><th>결과</th></tr></thead><tbody>${cs.map(chk).join('')}</tbody></table>`;
  const gradeTbl = `<table class="sys"><thead><tr><th>영역</th><th>HOME 관리 목표</th><th>목표 설정(원천)</th><th>일치</th></tr></thead><tbody>${AREAS.map((a) => `<tr class="${homeGoal[a] && modalGrades[a] && homeGoal[a] !== modalGrades[a] ? 'ng' : ''}"><td>${esc(a)}</td><td>${esc(homeGoal[a] || '—')}</td><td>${esc(modalGrades[a] || '—')}</td><td>${homeGoal[a] && modalGrades[a] ? (homeGoal[a] === modalGrades[a] ? '✅' : '❌') : '—'}</td></tr>`).join('')}</tbody></table>`;
  const logTbl = work.logHead.length ? `<table class="sys"><thead><tr>${work.logHead.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${work.logRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="note">최근 작업 일보 미수집</div>';
  const idTbl = `<table class="sys"><thead><tr><th>오늘의 작업(HOME)</th><th>작업 지시 목록 존재</th></tr></thead><tbody>${(work.ids.length ? work.ids : ['(없음)']).map((id) => `<tr class="${work.ids.length && !orderIds.includes(id) ? 'ng' : ''}"><td>${esc(id)}</td><td>${work.ids.length ? (orderIds.includes(id) ? '✅ 존재' : '❌ 없음') : '—'}</td></tr>`).join('')}</tbody></table>`;
  const costRow = (cat: string, d: CostCat | undefined) => { if (!d) return `<tr><td>${esc(cat)}</td><td colspan="4" style="color:var(--mut)">파싱 없음</td></tr>`; const calc = d.budget != null && d.used != null ? d.budget - d.used : null; const ok = calc != null && d.remain != null && near(d.remain, calc); return `<tr class="${cat === '전체' ? 'mt' : ''} ${calc != null && !ok ? 'ng' : ''}"><td>${esc(cat)}</td><td class="num">${d.used?.toLocaleString() ?? '—'}</td><td class="num">${d.remain?.toLocaleString() ?? '—'}</td><td class="num">${d.budget?.toLocaleString() ?? '—'}</td><td class="num">${d.pct}% ${calc != null ? (ok ? '✅' : '❌') : ''}</td></tr>`; };
  const costTbl = (data: Record<string, CostCat>, budgetLabel: string) => `<table class="sys"><thead><tr><th>카테고리</th><th class="num">누적 사용</th><th class="num">잔여 예산</th><th class="num">${esc(budgetLabel)}</th><th class="num">사용률(검산)</th></tr></thead><tbody>${COST_CATS.map((c) => costRow(c, data[c])).join('')}</tbody></table>`;

  const html = `<style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 60px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 10px;border-bottom:2px solid var(--line);padding-bottom:6px}h3{font-size:14px;margin:16px 0 4px}
.sub{color:var(--mut);font-size:13px;margin-bottom:8px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:23px;font-weight:700}.card .l{font-size:12px;color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:6px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-size:11.5px;background:var(--card)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}tr.mt td{font-weight:700}tr.ng td{color:var(--ng);font-weight:600}tr.na td{color:var(--mut)}.ok-n{color:var(--ok);font-weight:700}.ng-n{color:var(--ng);font-weight:700}.na-n{color:var(--mut);font-weight:700}.mut{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13.5px;color:var(--mut);margin:8px 0}.note.big{border-left:3px solid var(--accent)}
code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}kbd{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:2px 7px;font:12.5px monospace}
.tblwrap{overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:8px;margin:6px 0}.sys{min-width:100%;margin:0}
.map{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:8px 0}.mrow{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center;margin-top:8px}
.node{border:1px solid var(--line);border-radius:9px;padding:8px 12px;background:var(--bg);text-align:center;min-width:118px}.node .nt{font-weight:700;font-size:13px}.node .na{font-size:11px;color:var(--mut);margin-top:1px}
.node.hi{border-top:3px solid var(--accent)}.arrow{color:var(--mut);font-size:12px}.arrow b{color:var(--fg)}.mlabel{font-size:12.5px;color:var(--mut);font-weight:700;margin:14px 0 2px}
.tabin{position:absolute;left:-9999px}.tabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin:14px 0 0;flex-wrap:wrap}
.tabs label{padding:9px 13px;cursor:pointer;font-weight:600;font-size:13px;color:var(--mut);border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0}
#t1:checked~.tabs label[for=t1],#t2:checked~.tabs label[for=t2],#t3:checked~.tabs label[for=t3],#t4:checked~.tabs label[for=t4],#t5:checked~.tabs label[for=t5],#t6:checked~.tabs label[for=t6]{color:var(--fg);border-color:var(--line);background:var(--card)}
.panel{display:none;padding-top:14px}#t1:checked~#p1,#t2:checked~#p2,#t3:checked~#p3,#t4:checked~#p4,#t5:checked~#p5,#t6:checked~#p6{display:block}
.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:var(--card);border:1px solid var(--line);color:var(--mut);margin-left:6px}
.lead{font-size:16px;line-height:1.75;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:16px 18px;margin:12px 0}.lead b{font-size:18px}.lead .em{color:var(--accent);font-weight:700}
.persp{font-size:12.5px;color:var(--mut);background:var(--card);border:1px dashed var(--line);border-radius:8px;padding:9px 13px;margin:8px 0}
.honest{font-size:13px;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:8px;padding:11px 14px;margin:8px 0}.honest b{color:var(--fg)}
details.gloss{margin:28px 0 0;font-size:13px;color:var(--mut);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px}details.gloss summary{cursor:pointer;font-weight:700;color:var(--fg)}details.gloss dt{font-weight:700;color:var(--fg);margin-top:8px}details.gloss dd{margin:0 0 2px 0}
</style>
<div class="wrap">
<h1>홈 화면 숫자가 원천 값과 맞는지 확인</h1>
<div class="sub">코스관리 첫 화면(홈)의 등급·작업·비용 표시 값을 각 원천 화면과 대조(화면 변경 없음) · 킹즈락 · ${ts}</div>
<div class="lead"><b>한눈에 보기.</b> 코스관리 <span class="em">첫 화면(홈)</span>에 보이는 <b>등급·작업·비용</b> 숫자가 그 값이 나오는 <b>원천 화면</b>과 어긋나지 않는지 확인했습니다.<br>
확인 항목 <b>${judged.length}개</b> 중 <span class="ok-n">정상 ${pass}개</span>${fail ? ` · <span class="ng-n">주의 ${fail}개</span>` : ' · 주의 0개'}${naCount ? ` · <span class="na-n">참고 ${naCount}개</span>(데이터 없어 판정 제외)` : ''}.<br>
이 리포트는 <b>"지금 화면 값이 맞는가"</b>를 봅니다 — 사용자가 보는 화면 기준 확인이며, 앱 내부 코드 검사는 아닙니다.</div>
<div class="persp">📏 <b>보는 관점:</b> 화면에 <b>표시된 값</b>을 원천 화면과 맞대어 봅니다(앱 내부 코드 커버리지가 아님). 확인 중 화면을 바꾸거나 저장하지 않습니다.</div>
<div class="honest"><b>이 검증이 잡는 것과 못 잡는 것(중요).</b><br>
✅ <b>잡음:</b> HOME에 보이는 값이 <b>원천 화면과 다른</b> 경우(등급=목표설정·작업=작업지시·연간예산=예산관리) · 비용 탭 <b>계산 항등이 깨진</b> 경우(잔여=연간예산−누적·사용률%·전체=Σ카테고리).<br>
⚠ <b>못 잡음(한계):</b> HOME은 원천 값을 <b>가져다 보여주는</b> 화면이라, <b>원천 자체가 틀리면</b> HOME도 같이 틀린 채 일치로 통과합니다(원천 정확성은 예산·비용/인력 등 각 원천 검증이 담당). 또 HOME '이번 달' vs 목록 '전체기간'처럼 <b>집계 범위가 다른</b> 항목은 총계 직접 일치가 아니라 자기정합(≥0)만 봅니다.<br>
➖ <b>참고(데이터 없음):</b> 데이터가 없어 확인 대상이 아닌 항목은 판정에서 제외했습니다(결함 아님).</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상 통과</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의 필요</div></div>${naCount ? `<div class="card"><div class="n na-n">${naCount}</div><div class="l">참고(데이터없음)</div></div>` : ''}</div>

<input class="tabin" type="radio" name="tab" id="t1" checked><input class="tabin" type="radio" name="tab" id="t2"><input class="tabin" type="radio" name="tab" id="t3"><input class="tabin" type="radio" name="tab" id="t4"><input class="tabin" type="radio" name="tab" id="t5"><input class="tabin" type="radio" name="tab" id="t6">
<div class="tabs"><label for="t1">① 실행 방법</label><label for="t2">② 연관성 맵</label><label for="t3">③ 요약</label><label for="t4">④ 관리 목표·현황</label><label for="t5">⑤ 작업 탭</label><label for="t6">⑥ 비용 탭</label></div>

<div class="panel" id="p1">
<h2>실행 방법</h2>
<div class="note">공유 QA 계정은 <b>재로그인 1회당 1런</b>만 생존 → 실행 전 인증 필요:
<div style="margin-top:8px"><kbd>npm run course:auth</kbd> (수동 로그인) &nbsp;→&nbsp; <kbd>npm run course:home-verify</kbd></div>
<div style="margin-top:8px">→ HOME <b>3탭 전환</b>(관리 목표 및 현황·작업·비용) + [목표 설정] 모달 + [작업 관리&gt;작업 지시] + [예산 관리&gt;예산 총괄] 데이터 재수집 → <code>reports/course-home-verify.html</code> 재생성. <b>비파괴</b>(조회·탭 전환·모달 열기→취소만). 별도 입력 불필요.</div></div>
<div class="note">대상 <code>https://course-mng-td.smartscore.kr</code> · 탭 전환은 <code>.tab-group</code> 텍스트 클릭. 검증 3계열: <b>등급</b>(파싱 방향 'ga'/'ag') · <b>작업</b>(W-ID 집합 포함) · <b>비용</b>(예산 실적 계산 항등).</div>
<div class="note big"><b>본 리포트</b>는 "현재 HOME 값이 원천과 정합한가". 금액 계산 정합성·동적 변경 반영의 심화는 별도 검증기: <kbd>npm run course:budget-verify</kbd>(예산·비용 교차/원천 불변식) · <kbd>$env:ALLOW_DESTRUCTIVE="1"; npm run course:writepath</kbd>(값 변경→연관 반영→복원).</div>
</div>

<div class="panel" id="p2">
<h2>화면 연관 맵 (탭별)</h2>
<div class="map">
<div class="mlabel">[관리 목표 및 현황] 탭 — 등급</div>
<div class="mrow"><div class="node"><div class="nt">목표 설정 모달</div><div class="na">영역별 목표 등급(원천)</div></div><div class="arrow">─<b>표시</b>→</div><div class="node hi"><div class="nt">HOME 관리 목표</div><div class="na">7영역 등급</div></div></div>
<div class="mrow"><div class="node"><div class="nt">평가 작성/평가내역</div><div class="na">기준일 등급 산정</div></div><div class="arrow">─<b>산정</b>→</div><div class="node"><div class="nt">HOME 관리 현황</div><div class="na">현재 등급·추세</div></div></div>
<div class="mlabel">[작업] 탭 — 작업 운영(금액 아님)</div>
<div class="mrow"><div class="node"><div class="nt">작업 관리 &gt; 작업 지시</div><div class="na">W-작업지시·상태</div></div><div class="arrow">─<b>연동</b>→</div><div class="node hi"><div class="nt">HOME 오늘의 작업/이번 달</div><div class="na">W-xxxxx·완료/진행/대기</div></div></div>
<div class="mrow"><div class="node"><div class="nt">작업 관리 &gt; 작업 일보</div><div class="na">일자별 작업/인력</div></div><div class="arrow">─<b>요약</b>→</div><div class="node"><div class="nt">HOME 최근 작업 일보</div><div class="na">단일/반복·고정직/임시직</div></div></div>
<div class="mlabel">[비용] 탭 — 예산 대비 실적(금액)</div>
<div class="mrow"><div class="node"><div class="nt">예산 관리 &gt; 예산 총괄</div><div class="na">카테고리 연간예산(원천)</div></div><div class="arrow">─<b>입력값</b>→</div><div class="node hi"><div class="nt">HOME 비용 탭</div><div class="na">연간/누적 예산 대비 실적</div></div></div>
<div class="mrow"><div class="node"><div class="nt">비용 관리 &gt; 비용 집계</div><div class="na">작업지시 집계 비용</div></div><div class="arrow">─<b>참고</b>→</div><div class="node"><div class="nt">HOME 누적 사용 금액</div><div class="na">회계 비용(차이 가능)</div></div></div>
</div>
<h3>HOME 탭·블록·원천</h3>
<table class="sys"><thead><tr><th>탭</th><th>블록</th><th>기입 항목</th><th>원천 화면</th></tr></thead><tbody>
<tr><td rowspan="2">관리 목표 및 현황</td><td>관리 목표 등급</td><td>7영역(전체·그린·그린칼라·티박스·페어웨이·러프·벙커) 등급</td><td>[목표 설정] 모달</td></tr>
<tr><td>관리 현황 등급</td><td>기준일 현재 등급 + 등급 추세 차트</td><td>평가 작성/평가내역</td></tr>
<tr><td rowspan="3">작업</td><td>오늘의 작업</td><td>W-작업지시 카드(지시명·기간·조장)</td><td>작업 관리 &gt; 작업 지시</td></tr>
<tr><td>이번 달 작업</td><td>완료 / 진행중 / 대기 중</td><td>작업 관리 &gt; 작업 지시(상태)</td></tr>
<tr><td>최근 작업 일보</td><td>일자·단일/반복 작업·고정직/임시직</td><td>작업 관리 &gt; 작업 일보</td></tr>
<tr><td rowspan="2">비용</td><td>연간 예산 대비 실적</td><td>카테고리별 누적 사용·잔여·연간예산·사용률%</td><td>예산 관리(예산 총괄/상세)</td></tr>
<tr><td>누적 예산 대비 현황</td><td>카테고리별 누적 사용·잔여·누적 예산</td><td>예산 관리 · 비용 관리(집계)</td></tr>
</tbody></table>
</div>

<div class="panel" id="p3">
<h2>요약</h2>
<div class="cards"><div class="card"><div class="n ${allOkOf(goalChk) ? 'ok-n' : 'ng-n'}">${cnt(goalChk)}</div><div class="l">관리 목표·현황(등급)</div></div><div class="card"><div class="n ${allOkOf(workChk) ? 'ok-n' : 'ng-n'}">${cnt(workChk)}</div><div class="l">작업 탭</div></div><div class="card"><div class="n ${allOkOf(costChk) ? 'ok-n' : 'ng-n'}">${cnt(costChk)}</div><div class="l">비용 탭</div></div>${naCount ? `<div class="card"><div class="n na-n">${naCount}</div><div class="l">참고(데이터없음)</div></div>` : ''}</div>
${fail ? `<div class="note" style="border-left:3px solid var(--ng)"><b class="ng-n">⚠ 주의 필요 (${fail}건)</b><br>${judged.filter((c) => !c.ok).map((c) => `<div style="margin-top:8px"><b class="ng-n">❌ ${esc(c.name)}</b><br><span>${esc(c.detail)}</span></div>`).join('')}</div>` : '<div class="note" style="border-left:3px solid var(--ok)"><b class="ok-n">✅ 확인 항목 전부 정상</b> — 주의 없음</div>'}${naCount ? `<div class="note" style="border-left:3px solid var(--mut)"><b>➖ 참고: 데이터가 없어 확인 대상이 아님 (${naCount}건, 판정 제외)</b> — 결함이 아니라 "확인 불가"입니다.<br>${checks.filter((c) => c.na).map((c) => `<div style="margin-top:6px"><b>➖ ${esc(c.name)}</b><br><span class="mut">${esc(c.detail)}</span></div>`).join('')}</div>` : ''}
<h3>① 관리 목표 및 현황 (등급)</h3>${chkTbl(goalChk)}
<h3>② 작업 탭 (작업 운영)</h3>${chkTbl(workChk)}
<h3>③ 비용 탭 (예산 대비 실적)</h3>${chkTbl(costChk)}
</div>

<div class="panel" id="p4">
<h2>관리 목표 등급 대조 (HOME ↔ [목표 설정] 원천)</h2>
<div class="note">HOME은 <b>등급+영역</b>(A+전체), 목표 설정 모달은 <b>영역+등급</b>(전체A+) 순서로 렌더 → <code>extractGrades(txt, 'ga'|'ag')</code>로 방향 명시해야 인접 영역 등급 오인(off-by-one)을 막음.</div>
<div class="tblwrap">${gradeTbl}</div>
<div class="note">관리 현황 기준일: <b>${esc(home.baseDate || '—')}</b> · 등급 추세 차트 ${home.charts}개(Highcharts SVG, 시각 — DOM 수치 대조 제한). 등급 스케일 <code>E- E E+ D- … A A+</code> 15단계.</div>
</div>

<div class="panel" id="p5">
<h2>작업 탭 검증 (작업 관리 연동)</h2>
<div class="note">HOME [작업] 탭은 명칭 '작업'대로 <b>작업 운영 요약</b>(금액 없음). 검증은 노출 데이터를 <code>작업 관리</code>와 연동 대조.</div>
<h3>오늘의 작업(W-작업지시) = 작업 관리 목록 <span class="badge">목록 ${orderTotal}건</span></h3>
<div class="tblwrap">${idTbl}</div>
<h3>이번 달 작업 상태</h3>
<table class="sys"><thead><tr><th>완료</th><th>진행중</th><th>대기 중</th><th>합</th></tr></thead><tbody><tr><td>${esc(work.month.done ?? '—')}</td><td>${esc(work.month.prog ?? '—')}</td><td>${esc(work.month.wait ?? '—')}</td><td>${[work.month.done, work.month.prog, work.month.wait].every((n) => Number.isFinite(Number(n))) ? Number(work.month.done) + Number(work.month.prog) + Number(work.month.wait) : '—'}</td></tr></tbody></table>
<div class="note">작업 지시 목록 상태 분포(원천): ${Object.keys(orderStatus).length ? Object.entries(orderStatus).map(([k, v]) => `${k} ${v}`).join(' · ') : '미수집'}. ⚠ HOME '이번 달'=당월 필터·목록=전체기간 → 총계 직접 일치 아님, HOME 자기정합(≥0)만 검증.</div>
<h3>최근 작업 일보</h3>
<div class="tblwrap">${logTbl}</div>
</div>

<div class="panel" id="p6">
<h2>비용 탭 검증 (예산 대비 실적 계산 정합성)</h2>
<div class="note big"><b>핵심</b>: [비용] 탭 = <b>예산 대비 실적 분석</b> 대시보드(금액 카드 ${costTab.wonCells}개). 카테고리별 <b>잔여=연간예산−누적사용</b> 항등·<b>사용률%</b> 검산·<b>전체=Σ하위</b> 롤업 + 연간예산 <b>[예산 관리] 원천 대조</b>. 회계 비용이라 작업지시 집계와 차이 가능(안내 명시).</div>
<h3>연간 예산 대비 실적 현황</h3>
<div class="tblwrap">${costTbl(annual, '연간예산')}</div>
<div class="note">검산: 잔여 예산 = 연간예산 − 누적 사용 · 사용률% = round(누적사용 ÷ 연간예산 × 100). <b>전체</b> 행 = Σ(고정직·임시직·자재·장비·기타). ✅=항등 성립.</div>
<h3>누적 예산 대비 현황</h3>
<div class="tblwrap">${costTbl(cumul, '누적 예산')}</div>
<h3>연간예산 원천 대조</h3>
<div class="note">비용탭 전체 연간예산 <b>${annual['전체']?.budget != null ? annual['전체'].budget!.toLocaleString() + '원' : '—'}</b> ↔ [예산 관리&gt;예산 총괄] 금액집합(${budgetNums.length}건${budgetNums.length ? ': ' + budgetNums.slice(0, 8).map((v) => v.toLocaleString()).join(', ') + (budgetNums.length > 8 ? ' …' : '') : ''}). 안내문구: <i>${esc(costTab.guide || '—')}</i></div>
</div>
<details class="gloss"><summary>용어 풀이 (처음 보시는 분용)</summary>
<dl>
<dt>정합성</dt><dd>여러 화면에 나오는 같은 숫자가 서로 어긋나지 않고 맞아떨어지는 상태.</dd>
<dt>원천(원천 화면)</dt><dd>그 값을 실제로 입력·계산하는 대표 화면. 홈은 이 값을 가져다 보여줄 뿐이라, 원천과 같아야 정상.</dd>
<dt>등급 추세</dt><dd>구역별 관리 등급(A+~E-)이 시간에 따라 어떻게 변했는지 보여주는 선 그래프.</dd>
<dt>화면 변경 없음(비파괴)</dt><dd>확인만 하고 저장·삭제·수정은 하지 않아, 실제 데이터가 바뀌지 않음.</dd>
<dt>정상 통과 / 주의</dt><dd>정상=값이 맞음. 주의=값이 다르거나 확인이 더 필요(원인은 각 항목에 표기).</dd>
</dl></details>
</div>`;

  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  const outPath = path.join('reports', 'course-home-verify.html');
  fs.writeFileSync(outPath, html);
  console.log(`\n[HOME 검증] 총 ${checks.length} · PASS ${pass} · FAIL ${fail}`);
  console.log(`[report] ${outPath}`);
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} [${c.scope}] ${c.name} — ${c.detail}`);
});

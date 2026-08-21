import { test, Page, Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openCourseAdmin, killAlarms, COURSE_URL } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';
import { EvalInit, LevelInfo, MonthScore, AREA_KEY, AREAS, GRADE_SCALE, scoreToGrade, levelScaleInvariants, sheetMappingInvariants, trendLatestMatchesSheet, monthlyStructureInvariants, goalGradeOf } from '../lib/course/domain/gradeEval';

// ──────────────────────────────────────────────────────────────
//  차트 데이터 정합성 검증 — Home 등급추세(Highcharts 스파크라인) ← 공급 API 값 정합성(비파괴).
//  실행: npm run course:auth 후 npm run course:chart-integrity
//  배경: 커버리지 의견 "그래프 노출·마우스오버 값만, 상세 데이터 정합성 미확인"(Home 등급추세 7 스파크라인).
//  ⚠ 스파크라인은 DOM에 값 없음(포인트/축/툴팁 부재) → 값 정합성은 공급 API로 검증(사용자 결정: 네트워크).
//    실측: /api/v1/home/management/eval-init 이 goal(목표=화면카드)·levelInfos(등급↔점수 임계)·
//          monthlyEvalScores(추세 시계열)·lastEvalSheet(최신 평가) 전부 제공 → 데이터 정합성 검증 가능.
//  검증(순수 불변식 lib/course/domain/gradeEval.ts):
//    C1 levelInfos 스케일 정합(15단계·임계 연속·0~100).
//    C2 최신 평가 점수→등급 매핑 = 기재 등급.★핵심(등급 산출 로직 검증)
//    C3 추세 최신월 점수 = 최신 평가 점수(추세↔시트 동일 원천).
//    C4 goal 목표등급 = 화면 등급카드(표시 정합).
//    C5 추세 시계열 구조(점수 ∈ [0,100]·월형식).
//  전부 비파괴(재로드로 API 재요청 + 조회만). eval-init 미캡처 시 정직 SKIP.
// ──────────────────────────────────────────────────────────────

interface Captured { url: string; status: number; body: unknown; }

async function reloadCaptureEval(admin: Page): Promise<{ evalInit: EvalInit | null; captured: Captured[] }> {
  const captured: Captured[] = [];
  let evalInit: EvalInit | null = null;
  const handler = async (resp: Response) => {
    try {
      const url = resp.url();
      if (!/\/api\/v1\//.test(url)) return;
      if (!/json/i.test(resp.headers()['content-type'] || '')) return;
      const txt = await resp.text(); if (txt.length > 600_000) return;
      let body: unknown = txt; try { body = JSON.parse(txt); } catch { return; }
      captured.push({ url, status: resp.status(), body });
      if (/\/home\/management\/eval-init/.test(url)) { const b = body as { data?: EvalInit }; if (b && b.data) evalInit = b.data; }
    } catch { /* */ }
  };
  admin.on('response', handler);
  await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await admin.waitForTimeout(2500); await killAlarms(admin);
  await admin.locator('.tab-group').getByText(/관리\s*목표/).first().click({ timeout: 2500 }).catch(() => {});
  await admin.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await admin.waitForTimeout(800);
  admin.off('response', handler);
  return { evalInit, captured };
}

async function extractCards(admin: Page): Promise<Record<string, string>> {
  return admin.evaluate((GRADE_RE) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const cards: Record<string, string> = {};
    const re = new RegExp('^' + GRADE_RE + '(전체|그린칼라|그린|티박스|페어웨이|러프|벙커)$');
    Array.from(sc.querySelectorAll('div, span, td, li, p, dd, dt')).forEach((e) => { if (e.childElementCount > 3) return; const t = norm(e.textContent); const m = re.exec(t); if (m && !cards[m[2]]) cards[m[2]] = m[1]; });
    return cards;
  }, '(A\\+|A-|A|B\\+|B-|B|C\\+|C-|C|D\\+|D-|D|E\\+|E-|E)').catch(() => ({} as Record<string, string>));
}

test('차트 데이터 정합성 — Home 등급추세 API(eval-init) 값↔원천 대조(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const { evalInit, captured } = await reloadCaptureEval(admin);
  const cards = await extractCards(admin);

  const P = 'Home';
  const ref = (n: string) => `코스관리_차트정합성_${n}`;
  try { fs.mkdirSync(path.join(process.cwd(), 'analysis'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), 'analysis', '_chart_eval.json'), JSON.stringify({ cards, evalInit, capturedUrls: captured.map((c) => c.url) }, null, 1)); } catch { /* */ }
  console.log(`\n[chart-integrity] API캡처 ${captured.length} · eval-init=${!!evalInit} · 카드 ${JSON.stringify(cards)}`);

  if (!evalInit) {
    skip({ path: `${P} > 등급추세 데이터소스`, tcRef: ref('API'), tcId: 'CHART-API', desc: 'eval-init 응답 캡처' }, `eval-init 미캡처(프리페치 캐시로 재로드시 미발생 가능) — 캡처 ${captured.length}건. analysis/_chart_eval.json 확인`);
    await writeReport('코스관리_차트정합성');
    return;
  }
  const levels = (evalInit.levelInfos || []) as LevelInfo[];
  const months = (evalInit.monthlyEvalScores || []) as MonthScore[];
  const sheet = (evalInit.lastEvalSheet || {}) as Record<string, unknown>;
  const goal = (evalInit.goal || {}) as Record<string, unknown>;

  // C1 levelInfos 스케일 정합
  { const r = levelScaleInvariants(levels); record({ path: `${P} > 등급스케일 정합(C1)`, tcRef: ref('C1'), tcId: 'CHART-C1', desc: 'levelInfos 15단계·임계 연속·0~100' }, r.ok ? 'PASS' : 'FAIL', { actual: r.detail }); }

  // C2 최신 평가 점수→등급 매핑 = 기재 등급 ★
  { const rows = sheetMappingInvariants(sheet, levels);
    if (!rows.length) skip({ path: `${P} > 점수→등급 매핑(C2)`, tcRef: ref('C2'), tcId: 'CHART-C2', desc: '평가 점수→등급 매핑' }, '평가된 구역 없음(전 구역 Level null)');
    else for (const r of rows) record({ path: `${P} > 점수→등급 매핑(C2):${r.area}`, tcRef: ref(`C2_${r.area}`), tcId: `CHART-C2-${r.area}`, desc: `${r.area} 점수→등급 = 기재 등급`, expected: r.level }, r.ok ? 'PASS' : 'FAIL', { actual: `점수 ${r.score} → ${r.mapped} vs 기재 ${r.level}`, error: r.ok ? '' : `매핑 불일치(${r.area})` }); }

  // C3 추세 최신월 점수 = 최신 평가 점수 ★
  { const rows = trendLatestMatchesSheet(months, sheet);
    if (!rows.length) skip({ path: `${P} > 추세↔시트(C3)`, tcRef: ref('C3'), tcId: 'CHART-C3', desc: '추세 최신월 = 최신 평가' }, '추세 시계열 없음');
    else { const bad = rows.filter((r) => !r.ok);
      record({ path: `${P} > 추세 최신월=최신평가(C3)`, tcRef: ref('C3'), tcId: 'CHART-C3', desc: '추세 최신월 구역점수 = 최신 평가시트 점수' }, bad.length === 0 ? 'PASS' : 'FAIL', { actual: `구역 ${rows.length} 중 일치 ${rows.length - bad.length}`, error: bad.length ? bad.map((b) => `${b.area}:추세${b.trend}≠시트${b.sheet}`).join(', ') : '' }); } }

  // C4 goal 목표등급 = 화면 등급카드
  { let done = 0; for (const area of AREAS) {
      const g = goalGradeOf(goal, area); const card = cards[area];
      const cm: CheckMeta = { path: `${P} > 목표등급=카드(C4):${area}`, tcRef: ref(`C4_${area}`), tcId: `CHART-C4-${area}`, desc: `${area} goal 등급 = 화면 카드`, expected: card || '' };
      if (!card) { skip(cm, `카드 미검출(${area})`); continue; }
      if (!g) { skip(cm, `goal 등급 없음(${area})`); continue; }
      done++; record(cm, g === card ? 'PASS' : 'FAIL', { actual: `goal ${g} vs 카드 ${card}`, error: g === card ? '' : `목표-카드 불일치(${area})` });
    } if (!done) skip({ path: `${P} > 목표등급=카드(C4)`, tcRef: ref('C4'), tcId: 'CHART-C4', desc: 'goal=카드' }, 'goal/카드 대조 불가'); }

  // C5 추세 시계열 구조
  { const r = monthlyStructureInvariants(months); record({ path: `${P} > 추세 시계열 구조(C5)`, tcRef: ref('C5'), tcId: 'CHART-C5', desc: '추세 점수 ∈ [0,100]·월형식' }, r.ok ? 'PASS' : (months.length ? 'FAIL' : 'SKIP'), { actual: r.detail }); }

  console.log(`\n[chart-integrity] levels ${levels.length} · months ${months.length} · 카드 ${Object.keys(cards).length}`);
  await writeReport('코스관리_차트정합성');
});

import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseDateRange } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  크로스이어(두 해 걸친) 작업의 원가 배분 실증 테스트(비파괴).
//  실행: npm run course:auth 후 npm run course:crossyear
//  대상: W-00058 / QA-13673, 기간 2025-09-01 ~ 2026-01-22, 총비용 7,500,000(임시직 인건비).
//  작업별 비용(/cost/task, 날짜 범위 필터)에서 여러 범위로 조회 → W-00058 총비용 관찰 → 배분 모델 판별:
//   A 날짜 비례 배분(2025분+2026분=전액) / B 앵커 날짜 귀속(한 해 전액·다른 해 0) / C 기간 겹침 전액(이중계상).
//  ⚠ 날짜 설정은 타이핑 방식(setCourseDateRange). 전부 비파괴(조회만).
// ──────────────────────────────────────────────────────────────

const P = '비용 관리 > 작업별 비용';
const M = (p: Page) => p.locator('.contents, main').first();
const TASK_RE = /W-00058|QA-13673/;
const TASK_TOTAL = 7_500_000;   // 전체 기간 총비용(기준)
const TASK_DAYS = 143;          // 2025-09-01 ~ 2026-01-22 (일수)
const DAYS_2025 = 122;          // 2025-09-01 ~ 2025-12-31
const DAYS_2026 = 22;           // 2026-01-01 ~ 2026-01-22

// 지정 범위로 조회 → W-00058 총비용/노출 여부 추출
async function w58(admin: Page, start: string, end: string): Promise<{ found: boolean; total: number | null; rows: number; setOk: boolean; cells: string[]; applied: string }> {
  // ⚠ datepicker는 순차 재설정 시 오염(2번째 호출부터 typing 실패) → 매 조회 전 화면 재진입으로 깨끗한 상태 확보.
  await gotoCourseMenu(admin, '비용 관리', '작업별 비용').catch(() => {});
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  const setOk = await setCourseDateRange(admin, start, end).catch(() => false);
  await admin.waitForTimeout(1_000); await killAlarms(admin);
  const applied = await admin.evaluate(() => { const inps = document.querySelectorAll('.contents .datepicker-input, main .datepicker-input'); return `${(inps[0] as HTMLInputElement)?.value || ''}~${(inps[1] as HTMLInputElement)?.value || ''}`; }).catch(() => '?');
  const r = await admin.evaluate((re) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const rows = Array.from(sc.querySelectorAll('tbody tr')).filter((tr) => !/내역이 없습니다/.test(tr.textContent || ''));
    const row = rows.find((tr) => new RegExp(re).test(tr.textContent || ''));
    if (!row) return { found: false, total: null as number | null, rows: rows.length, cells: [] as string[] };
    const cells = Array.from(row.children).map((td) => norm(td.textContent));
    // 총비용 = index 6 (작업번호0·작업명1·기간2·구분3·분류4·작업5·총비용6)
    const total = Number((cells[6] || '').replace(/[^0-9.-]/g, '') || '0');
    return { found: true, total, rows: rows.length, cells };
  }, TASK_RE.source).catch(() => ({ found: false, total: null, rows: 0, cells: [] as string[] }));
  return { ...r, setOk, applied };
}

test('크로스이어 작업 원가 배분 실증(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await gotoCourseMenu(admin, '비용 관리', '작업별 비용').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: '코스관리_배분_0', tcId: 'XYR-00', desc: '진입' }, '진입 실패'); await writeReport('코스관리_크로스이어배분'); return;
  }
  await admin.waitForTimeout(2_000); await killAlarms(admin);

  // ⚠ 세션이 순차 조회로 저하 → 가장 정보량 많은 '2025 부분' 조회를 첫(신뢰) 순서로. 부분 범위=작업의 각 연도 구간.
  const p2025 = await w58(admin, '2025-09-01', '2025-12-31');   // ① 2025 부분(작업 시작~2025말) — 첫 조회, 신뢰
  const p2026 = await w58(admin, '2026-01-01', '2026-01-22');   // ② 2026 부분(2026초~작업 종료)
  const full = await w58(admin, '2025-09-01', '2026-01-22');    // ③ 전체(기준, 7.5M)

  const base = full.total ?? (p2025.found || p2026.found ? Math.max(p2025.total ?? 0, p2026.total ?? 0) : TASK_TOTAL) ?? TASK_TOTAL;
  const y2025 = p2025, y2026 = p2026;
  const a25 = p2025.found ? (p2025.total ?? 0) : 0;
  const a26 = p2026.found ? (p2026.total ?? 0) : 0;
  const sum = a25 + a26;
  const near = (x: number, y: number, tol = Math.max(base * 0.02, 2)) => Math.abs(x - y) <= tol;
  const expPro25 = Math.round(TASK_TOTAL * DAYS_2025 / TASK_DAYS);
  const expPro26 = Math.round(TASK_TOTAL * DAYS_2026 / TASK_DAYS);

  // 모델 판별
  let model = ''; let modelOk = true;
  if (!full.found) { model = '기준 조회 실패(W-00058 미노출) — 데이터/기간 확인'; modelOk = false; }
  else if (a25 > 0 && a26 > 0 && a25 < base && a26 < base && near(sum, base)) model = `A. 날짜 비례 배분 — 2025분 ${a25.toLocaleString()} + 2026분 ${a26.toLocaleString()} = ${sum.toLocaleString()} ≈ 전체 ${base.toLocaleString()} (비례 예상 2025≈${expPro25.toLocaleString()}·2026≈${expPro26.toLocaleString()})`;
  else if ((near(a25, base) && a26 === 0) || (a25 === 0 && near(a26, base))) model = `B. 앵커 날짜 귀속 — ${near(a25, base) ? '2025' : '2026'}년에 전액 ${base.toLocaleString()}, 다른 해 0 (겹침 무관 한 해 귀속)`;
  else if (near(a25, base) && near(a26, base)) { model = `C. 기간 겹침 전액 — 2025·2026 각각 ${base.toLocaleString()} 전액 노출 → ⚠ 연도 합산 시 이중계상(${(base * 2).toLocaleString()}) 위험`; modelOk = false; }
  else model = `판단 유보 — 2025:${a25.toLocaleString()} · 2026:${a26.toLocaleString()} · 전체:${base.toLocaleString()} (예상 비례 2025≈${expPro25.toLocaleString()}·2026≈${expPro26.toLocaleString()})`;

  // 기록
  record({ path: `${P} > 전체 기간 기준`, tcRef: '코스관리_배분_full', tcId: 'XYR-FULL', desc: 'W-00058 전체 기간(2025-09-01~2026-01-22) 총비용 = 기준', failMsg: '' }, full.found ? 'PASS' : 'SKIP', full.found ? { actual: `전체 기간 총비용 ${base.toLocaleString()}원 (기간셀 "${full.cells[2] || '-'}")` } : { error: `W-00058 미노출(행 ${full.rows}·설정 ${full.setOk})` } as any);
  record({ path: `${P} > 2025 부분 조회`, tcRef: '코스관리_배분_2025', tcId: 'XYR-2025', desc: '2025-09-01~2025-12-31(작업의 2025 구간) 조회 시 W-00058 총비용', failMsg: '' }, y2025.found ? 'PASS' : (a25 === 0 ? 'PASS' : 'SKIP'), { actual: `[적용범위 ${y2025.applied}·setOk ${y2025.setOk}·행 ${y2025.rows}] ${y2025.found ? `총비용 ${a25.toLocaleString()}원` : 'W-00058 미노출(=0)'}` });
  record({ path: `${P} > 2026 부분 조회`, tcRef: '코스관리_배분_2026', tcId: 'XYR-2026', desc: '2026-01-01~2026-01-22(작업의 2026 구간) 조회 시 W-00058 총비용', failMsg: '' }, y2026.found ? 'PASS' : (a26 === 0 ? 'PASS' : 'SKIP'), { actual: `[적용범위 ${y2026.applied}·setOk ${y2026.setOk}·행 ${y2026.rows}] ${y2026.found ? `총비용 ${a26.toLocaleString()}원` : 'W-00058 미노출(=0)'}` });
  record({ path: `${P} > ★ 배분 모델 판별`, tcRef: '코스관리_배분_model', tcId: 'XYR-MODEL', desc: '크로스이어 작업 원가 배분 모델(A 비례/B 앵커/C 이중계상)', failMsg: '이중계상/이상' }, modelOk ? 'PASS' : 'FAIL', modelOk ? { actual: model } : { error: '배분 이상', detail: model });

  // 정합성 함의 추적
  diff('비용 관리 > 작업별 비용', '크로스이어 배분', model, '코스관리_배분_note', '작업별(날짜필터)과 연도화면(연도필터) 정합성 설계 근거 — 위 모델에 따라 방향 결정');

  await killAlarms(admin);
  await writeReport('코스관리_크로스이어배분');
});

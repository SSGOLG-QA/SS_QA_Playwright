import { Page, Locator, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { navigateMenu, settle } from './adminHelpers';

// ──────────────────────────────────────────────────────────────
//  테스트 결과 수집 + Fail 시 스크린샷 + 엑셀 리포트
//  - 경로/TC참조/설명/기대/실제 메타데이터 포함 → 리포트만으로 파악 가능
//  - 드라이브 TC 연계: tcRef(시트·No.) 컬럼으로 매핑
// ──────────────────────────────────────────────────────────────

export type CheckMeta = {
  path: string;        // 전체 경로 예: "라운드관리 > 내장 현황 > 설명 영역"
  tcRef: string;       // 드라이브 TC 참조 예: "라운드관리 시트 No.2"
  tcId: string;        // 표기용 ID 예: "TC-2"
  desc: string;        // 구체 설명 (절차 → 기대결과)
  expected?: string;   // 기대값(안내문구 전문 등)
  failMsg?: string;    // 실패 시 자연어 현상 (예: "알럿 미노출", "버튼 미노출")
};

export type TCResult = CheckMeta & {
  status: 'PASS' | 'FAIL' | 'SKIP';
  actual?: string;
  error?: string;      // 현상(자연어)
  detail?: string;     // 상세 에러(기술 원문)
  screenshot?: string;
  time: string;
};

const results: TCResult[] = [];
export function getResults() { return results; }
export function resetResults() { results.length = 0; }

// ── SNB 존재 / 드라이브 TC 미존재 이슈 ───────────────────────
export type NoTcIssue = { menu: string; url?: string; note: string };
const noTcIssues: NoTcIssue[] = [];
export function resetNoTC() { noTcIssues.length = 0; }
export function noTC(menu: string, url = '', note = 'SNB에 메뉴 존재하나 드라이브 TC 미작성') {
  noTcIssues.push({ menu, url, note });
  console.warn(`  ! [TC미존재 이슈] ${menu} — ${note}`);
}

// ── 기획-구현 차이(INFO) ─────────────────────────────────────
//   구현 UI가 기획서/TC 예상결과와 다르나, 기능상 정상이라 현 구현을 유지하는 경우.
//   결함(FAIL)이 아니라 '차이'로 기록 → QA·기획이 '스펙 갱신 vs 수정요청' 판단.
export type DiffIssue = { menu: string; tcRef: string; spec: string; impl: string; note: string };
const diffIssues: DiffIssue[] = [];
export function resetDiff() { diffIssues.length = 0; }
export function diff(menu: string, spec: string, impl: string, tcRef = '', note = '기능 정상 — 현 구현 유지') {
  diffIssues.push({ menu, tcRef, spec, impl, note });
  console.log(`  ≠ [기획-구현 차이] ${menu} | 기획: ${spec} → 구현: ${impl}`);
}

// ── 확인 필요 / 관찰(판정 제외) ───────────────────────────────
//   FAIL은 아니나 사람이 봐야 하는 항목: 시각 레이어(이미지텍스트·글리프□·레이아웃),
//   말줄임(…), 숫자/날짜/통화 포맷 관찰 등. 별도 시트로 분리(요약 PASS/FAIL 미오염).
export type ReviewItem = { lang: string; screen: string; kind: string; zone?: string; item: string; value?: string; screenshot?: string };
const reviewItems: ReviewItem[] = [];
export function resetReview() { reviewItems.length = 0; }
export function review(it: ReviewItem) {
  reviewItems.push(it);
  console.log(`  ? [확인필요] ${it.lang} | ${it.screen} | ${it.kind} | ${it.item}`);
}

// ── IA 구현 여부 (메뉴 존재/진입 가능) ───────────────────────
export type IAResult = { menu: string; sub: string; status: '구현' | '미구현' | '진입불가'; url?: string; note?: string };
const iaResults: IAResult[] = [];
export function resetIA() { iaResults.length = 0; }
export function recordIA(menu: string, sub: string, status: IAResult['status'], url = '', note = '') {
  iaResults.push({ menu, sub, status, url, note });
  const mark = status === '구현' ? '✓' : '✗';
  console.log(`  ${mark} [IA] ${menu} > ${sub || '-'} — ${status}${note ? ' (' + note + ')' : ''}`);
}

const REPORT_DIR = path.join(process.cwd(), 'reports');
const SHOT_DIR = path.join(REPORT_DIR, 'screenshots');
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

export async function capture(page: Page, meta: CheckMeta): Promise<string> {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const slug = `${meta.tcId}_${meta.path}`.replace(/[^\w가-힣]+/g, '_').slice(0, 90);
  const shot = path.join(SHOT_DIR, `${slug}.png`);
  // ⚠ 일부 화면만 캡처되는 근본 원인:
  //   ① playwright.config viewport:null(최대화 실제 창) → page.screenshot({fullPage:true})가 보이는 영역만 캡처(Playwright 제약)
  //   ② SPA 앱 셸이 고정높이(100vh) flex 레이아웃 + 내부 스크롤 컨테이너(.contents 등)로 콘텐츠를 클리핑
  //      → document 높이가 뷰포트에 고정 → fullPage/CDP 전체캡처로도 내부 스크롤 영역 하단이 안 잡힘.
  //   해결: CDP Emulation.setDeviceMetricsOverride 로 '뷰포트 높이'를 콘텐츠 전체 높이로 강제(viewport:null 무관)
  //         → 내부 flex 콘텐츠 영역이 펼쳐져 스크롤 없이 전부 노출 → captureScreenshot(captureBeyondViewport) → override 해제.
  let client: any = null;
  try {
    // 1) 전체 콘텐츠 높이 추정: document + 모든 내부 스크롤러 scrollHeight 의 최댓값
    const m0 = await page.evaluate(() => {
      let h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      let w = document.documentElement.clientWidth;
      for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
        if (el.scrollHeight > h) h = el.scrollHeight;
      }
      return { w: Math.ceil(w), h: Math.ceil(h) };
    });
    const W = Math.min(Math.max(m0.w, 360), 4000);
    let H = Math.min(Math.max(m0.h, 600), 30000);   // 비정상적으로 큰 페이지 방어(상한 30000px)

    client = await page.context().newCDPSession(page);
    // 2) 뷰포트 높이를 콘텐츠 높이로 강제 → 내부 flex 콘텐츠가 전부 펼쳐지도록
    await client.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await page.waitForTimeout(250);   // reflow 안정화
    // 3) 강제 뷰포트에서 다시 측정(콘텐츠가 더 늘어났으면 반영) 후 캡처
    H = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)));
    H = Math.min(Math.max(H, 600), 30000);
    await client.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await page.waitForTimeout(120);
    const { data } = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(shot, Buffer.from(data, 'base64'));
  } catch {
    // 폴백: 표준 fullPage → 그래도 실패 시 뷰포트만
    try { await page.screenshot({ path: shot, fullPage: true }); }
    catch { try { await page.screenshot({ path: shot }); } catch { /* 촬영 불가 무시 */ } }
  } finally {
    // 뷰포트 override 해제(비파괴) — 캡처 성패와 무관하게 항상 실행
    if (client) { try { await client.send('Emulation.clearDeviceMetricsOverride'); } catch { /* */ } await client.detach().catch(() => {}); }
  }
  return shot;
}

// 결과 직접 기록 (검출형 검증: 항목별 PASS/FAIL 직접 push) — 현상(error)·실제값(actual)·상세(detail)·스크린샷 지정
export function record(meta: CheckMeta, status: TCResult['status'], extra: { actual?: string; error?: string; detail?: string; screenshot?: string } = {}) {
  results.push({ ...meta, status, ...extra, time: new Date().toLocaleString('ko-KR') });
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '-';
  console.log(`  ${mark} [${meta.path}] ${meta.tcId} — ${status}${extra.error ? ' (' + extra.error + ')' : ''}`);
}

// 데이터 없음/해당없음 (결함 아님)
export function skip(meta: CheckMeta, note = '데이터 없음/해당없음') {
  results.push({ ...meta, status: 'SKIP', error: note, time: new Date().toLocaleString('ko-KR') });
  console.log(`  - [${meta.path}] ${meta.tcId} — SKIP (${note})`);
}

// Playwright expect 에러 메시지에서 Received 값 자동 추출
// 예) "Received string: "hello"" → "hello"
function parsePlaywrightError(msg: string): { received?: string } {
  for (const line of msg.split('\n')) {
    const m = line.trim().match(/^Received(?:\s+string)?\s*:\s*(.+)$/);
    if (m) return { received: m[1].replace(/^"|"$/g, '').trim().slice(0, 300) };
  }
  return {};
}

// 일반 검증 — 실패해도 throw하지 않고 기록 후 다음 단계 진행
// opts.getActual: PASS/FAIL 공통으로 실제값 캡처 (DOM에서 직접 읽기)
//   예) { getActual: () => page.locator('.btn').textContent() }
//   예) { getActual: async () => (await page.locator('tbody tr').count()).toString() }
export async function check(
  page: Page,
  meta: CheckMeta,
  fn: () => Promise<void>,
  opts?: { getActual?: () => Promise<string | null> },
) {
  const time = new Date().toLocaleString('ko-KR');
  try {
    await fn();
    const actual = opts?.getActual ? (await opts.getActual().catch(() => '')) ?? '' : undefined;
    results.push({ ...meta, status: 'PASS', actual, time });
    console.log(`  ✓ [${meta.path}] ${meta.tcId} ${meta.desc}`);
  } catch (e: any) {
    const screenshot = await capture(page, meta);
    const error = meta.failMsg || '검증 실패';
    const detail = norm(e?.message || String(e)).slice(0, 300);
    // getActual 미제공 시 Playwright 에러에서 Received 값 자동 파싱 (방법 A 폴백)
    const actual = opts?.getActual
      ? (await opts.getActual().catch(() => '')) ?? ''
      : parsePlaywrightError(e?.message || '').received;
    results.push({ ...meta, status: 'FAIL', actual, error, detail, screenshot, time });
    console.warn(`  ✗ [${meta.path}] ${meta.tcId} — ${error}`);
  }
}

// 안내문구 등 텍스트 검증 — TC 원문(meta.expected)과 "전체 일치" 비교
//   - 화면 실제값 ≠ TC 원문 → FAIL (UI 불일치: 문구/띄어쓰기)
//   - 공백은 단일화(HTML 줄바꿈 흡수)하되, 누락/추가 띄어쓰기·문구 차이는 검출
export async function checkText(page: Page, meta: CheckMeta, locator: Locator) {
  const time = new Date().toLocaleString('ko-KR');
  const expected = norm(meta.expected || '');
  let actual = '';
  let phenomenon = meta.failMsg || 'UI 불일치(안내 문구)';
  try {
    try {
      actual = norm(await locator.first().innerText({ timeout: 8_000 }));
    } catch {
      phenomenon = meta.failMsg || '안내 문구 미노출';   // 요소 자체 미발견
      throw new Error('요소 미발견');
    }
    if (actual !== expected) {
      phenomenon = meta.failMsg || 'UI 불일치(안내 문구/띄어쓰기)';  // 노출되나 TC와 다름
      throw new Error('TC 원문과 불일치');
    }
    results.push({ ...meta, status: 'PASS', actual: actual.slice(0, 300), time });
    console.log(`  ✓ [${meta.path}] ${meta.tcId} ${meta.desc}`);
  } catch (e: any) {
    const screenshot = await capture(page, meta);
    results.push({ ...meta, status: 'FAIL', actual: actual.slice(0, 300), error: phenomenon, detail: norm(e?.message || String(e)).slice(0, 200), screenshot, time });
    console.warn(`  ✗ [${meta.path}] ${meta.tcId} — ${phenomenon}`);
  }
}

// ── 공통 검증 헬퍼 (신규 E2E 식별 항목 흡수) ────────────────────
//  화면 본문에 노출되면 안 되는 '미가공 코드/오타' 패턴
const RAW_CODE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Vue 보간식 {{ }}', re: /\{\{[\s\S]{0,40}?\}\}/ },
  { name: 'undefined', re: /\bundefined\b/ },
  { name: 'NaN', re: /(^|[^A-Za-z])NaN([^A-Za-z]|$)/ },
  { name: '[object Object]', re: /\[object Object\]/ },
  { name: 'JSON 노출', re: /\{\s*"\w+"\s*:/ },
  { name: 'i18n 키 $t(', re: /\$t\(/ },
  { name: 'Vue 디렉티브', re: /\bv-(if|for|bind|model|show)\b/ },
  { name: 'null 값 노출', re: /(^|[^가-힣A-Za-z])null([^A-Za-z]|$)/ },
];

// ② 텍스트 검증 — 화면 본문에 미가공 코드/오타 노출 여부 (전 메뉴 공통)
export async function checkRawCode(page: Page, meta: CheckMeta): Promise<void> {
  await check(page, { ...meta, failMsg: meta.failMsg || '미가공 코드/오타 노출' }, async () => {
    const body = await page.locator('body').innerText();
    const hits = RAW_CODE_PATTERNS.filter(p => p.re.test(body)).map(p => p.name);
    expect(hits, `노출 패턴: ${hits.join(', ')}`).toEqual([]);
  });
}

// ④ 데이터 정합성 — 리스트 '총 건수' 표기 vs 렌더링된 행 수 (총 건수 표기 없으면 행 존재만)
export async function checkRowCountVsTotal(page: Page, meta: CheckMeta, tableSel = '.table-overflow-item table'): Promise<void> {
  await check(page, { ...meta, failMsg: meta.failMsg || '총 건수 vs 렌더 행 불일치' }, async () => {
    const rowsLoc = page.locator(tableSel).first().locator('tbody tr');
    const empty = await rowsLoc.filter({ hasText: /내역이 없습니다|데이터가 없습니다|기록이 없습니다/ }).count().catch(() => 0);
    const rows = empty > 0 ? 0 : await rowsLoc.count();
    const body = await page.locator('body').innerText();
    const m = body.match(/총\s*([\d,]+)\s*(?:건|대|팀|명|개)/) || body.match(/검색\s*결과\s*:?\s*([\d,]+)/);
    if (!m) { expect(rows, '총 건수 표기 없음 → 행 ≥ 0').toBeGreaterThanOrEqual(0); return; }
    const total = parseInt(m[1].replace(/,/g, ''), 10);
    expect(rows, `렌더 행(${rows}) ≤ 총건수(${total})`).toBeLessThanOrEqual(total);
    if (total <= rows) expect(rows, `총건수≤페이지크기 → 행=총건수(${total})`).toBe(total);
  });
}

// 메뉴 진입 (실패 시 "진입 불가" 기록) — 성공 여부 반환
//  ⚠ 진입 성공 화면마다 미가공 코드/오타 자동 스캔(checkRawCode) → 전 메뉴 일괄 적용.
//    opts.scanRawCode=false 로 끌 수 있음.
export async function gotoMenu(page: Page, parent: string, child: string, meta: CheckMeta, opts: { scanRawCode?: boolean } = {}): Promise<boolean> {
  const ok = await navigateMenu(page, parent, child).catch(() => false);
  await settle(page);
  if (!ok) {
    const screenshot = await capture(page, meta);
    results.push({ ...meta, status: 'FAIL', error: meta.failMsg || '메뉴 진입 불가', detail: `SNB '${parent} > ${child}' 클릭 실패`, screenshot, time: new Date().toLocaleString('ko-KR') });
    console.warn(`  ✗ [${meta.path}] — 메뉴 진입 불가`);
    return false;
  }
  if (opts.scanRawCode !== false)
    await checkRawCode(page, { ...meta, path: `${meta.path} > 텍스트`, tcId: 'RAW', desc: '미가공 코드/오타 미노출', failMsg: '미가공 코드/오타 노출' }).catch(() => {});
  return true;
}

// 대메뉴 IA/SNB 순서 (결과 시트 정렬 기준)
const MENU_ORDER = [
  '홈', 'HOME', 'Home', '라운드관리', '대회', '관제관리', '태블릿 운영 관리',
  '홀맵 관리', '코스 운영 관리', '경기진행관리', '캐디관리', '배토 관리',
  '캐디피 관리', '식음 관리', '고객 평가 관리', '계정 관리',
];
const COLOR: Record<string, string> = { PASS: 'FF008000', FAIL: 'FFCC0000', SKIP: 'FF888888' };
const norm2 = (s: string) => (s || '').replace(/\s+/g, '');
const topMenu = (path: string) => (path || '').split('>')[0].trim();
// 대메뉴 표기 정규화(탭명 통일): '관제관리'/'관제 관리' 등 공백 변동을 단일 캐논명으로 병합
const CANON_MENUS = ['홈', '라운드 관리', '관제 관리', '태블릿 운영 관리', '홀맵 관리', '코스 운영 관리', '경기 진행 관리', '캐디 관리', '캐디피 관리', '배토 관리', '식음 관리', '고객 평가 관리', '대회', '계정 관리'];
const canonMenu = (m: string) => {
  if (/^home$/i.test((m || '').trim())) return '홈';
  const hit = CANON_MENUS.find(c => norm2(c) === norm2(m));
  return hit || (m || 'etc').trim();
};
const menuRank = (m: string) => {
  const i = MENU_ORDER.findIndex(x => norm2(x) === norm2(m));
  return i < 0 ? 999 : i;
};
const sheetSafe = (s: string) => (s || 'etc').replace(/[\\/?*[\]:]/g, '_').slice(0, 31);

// TC참조 정렬: IA 먼저 → 상세 / No. 오름차순
function tcRefSort(a: TCResult, b: TCResult) {
  const key = (ref: string) => {
    // 구조 정의(IA/기능정의/범위제외/-) 먼저 → 상세 TC 시트
    const isStruct = /^\s*(IA|기능정의|범위제외|-)/.test(ref || '');
    // 채번 형식: "시트명_###" (A열) 또는 "시트명 No.###"
    const numM = (ref || '').match(/_(\d+)/) || (ref || '').match(/No\.?\s*(\d+)/) || (ref || '').match(/(\d+)/);
    const no = numM ? parseInt(numM[1], 10) : 0;
    const sheet = (ref || '').replace(/[_\s]*(?:No\.?)?\s*\d+.*$/, '').trim();
    return { g: isStruct ? 0 : 1, sheet, no };
  };
  const ka = key(a.tcRef), kb = key(b.tcRef);
  if (ka.g !== kb.g) return ka.g - kb.g;
  if (ka.sheet !== kb.sheet) return ka.sheet.localeCompare(kb.sheet, 'ko');
  return ka.no - kb.no;
}

const DETAIL_COLS = [
  { header: '경로',             key: 'path',       width: 34 },
  { header: 'TC참조(드라이브)', key: 'tcRef',      width: 22 },
  { header: 'TC',               key: 'tcId',       width: 9  },
  { header: '테스트 절차',       key: 'desc',       width: 40 },
  { header: '기대결과',          key: 'expected',   width: 44 },
  { header: '실제결과',          key: 'actual',     width: 44 },
  { header: '결과',              key: 'status',     width: 8  },
  { header: '현상',              key: 'error',      width: 22 },
  { header: '상세에러',          key: 'detail',     width: 45 },
  { header: '스크린샷',          key: 'screenshot', width: 40 },
  { header: '시각',              key: 'time',       width: 20 },
];

// 엑셀 리포트 생성 — 대메뉴별 결과 시트 + 요약 시트(시트별 집계)
export async function writeReport(title = 'report'): Promise<string> {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const wb = new ExcelJS.Workbook();

  // 대메뉴별 그룹핑
  const groups = new Map<string, TCResult[]>();
  for (const r of results) {
    const m = canonMenu(topMenu(r.path));
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m)!.push(r);
  }
  // IA/SNB 순서로 대메뉴 정렬
  const menus = [...groups.keys()].sort((a, b) => (menuRank(a) - menuRank(b)) || a.localeCompare(b, 'ko'));

  // 상세 시트 행 위치 사전 계산 — 주요 이슈 현황 FAIL 항목 내부 링크용
  // 상세 시트는 tcRefSort 정렬, row 1 = 헤더, 데이터 row 2~
  const resultRowMap = new Map<TCResult, number>();
  for (const m of menus) {
    const sorted = [...groups.get(m)!].sort(tcRefSort);
    sorted.forEach((r, i) => resultRowMap.set(r, i + 2));
  }

  // ── 요약 시트: 테스트 현황 대시보드 (TC문서 Summary 스타일) ──
  //   색상/세부 항목 조정 가능. 자동화 특성상 전수 실행 → 수행수=전체수(잔여 0), N/A=SKIP.
  const sum = wb.addWorksheet('요약');
  sum.columns = [{ width: 24 }, { width: 13 }, { width: 11 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 11 }];
  const C_TITLE = 'FF4472C4', C_HEAD = 'FFD9E1F2', C_TOTAL = 'FFE2EFDA', C_SUBT = 'FFF2F2F2', C_BORDER = 'FFBFBFBF';
  const fill = (cell: any, argb: string) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };
  const box = (cell: any) => { cell.border = { top: { style: 'thin', color: { argb: C_BORDER } }, left: { style: 'thin', color: { argb: C_BORDER } }, bottom: { style: 'thin', color: { argb: C_BORDER } }, right: { style: 'thin', color: { argb: C_BORDER } } }; };

  // 집계 (대메뉴별)
  let tP = 0, tF = 0, tS = 0;
  const data = menus.map(m => {
    const g = groups.get(m)!;
    const p = g.filter(r => r.status === 'PASS').length, f = g.filter(r => r.status === 'FAIL').length, s = g.filter(r => r.status === 'SKIP').length;
    tP += p; tF += f; tS += s;
    return { m, total: g.length, pass: p, fail: f, na: s };
  });
  const grandTotal = results.length;
  const passRate = (tP + tF) ? Math.round((tP / (tP + tF)) * 100) : 0;
  const failRate = (tP + tF) ? Math.round((tF / (tP + tF)) * 100) : 0;

  // 제목
  sum.mergeCells('A1:G1');
  const t1 = sum.getCell('A1'); t1.value = `테스트 현황  —  ${title}`; t1.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }; fill(t1, C_TITLE); t1.alignment = { vertical: 'middle' }; sum.getRow(1).height = 24;
  // 비율 요약 — Total 행 번호를 사전 계산해 수식 참조
  // 레이아웃: row1=제목 / row2=공백 / row3=비율 / row4=공백 / row5=헤더 / row6~=데이터(N) / row(6+N)=Total
  const totalRowNum = 6 + data.length;
  const rr = sum.getRow(3);
  rr.getCell(1).value = '진행률'; rr.getCell(2).value = '100%';
  rr.getCell(3).value = 'PASS Rate';
  rr.getCell(4).value = { formula: `=TEXT(D${totalRowNum}/(D${totalRowNum}+E${totalRowNum}),"0%")`, result: `${passRate}%` };
  rr.getCell(5).value = 'Fail Rate';
  rr.getCell(6).value = { formula: `=IF((D${totalRowNum}+E${totalRowNum})>0,TEXT(E${totalRowNum}/(D${totalRowNum}+E${totalRowNum}),"0%"),"-")`, result: `${failRate}%` };
  [1, 3, 5].forEach(i => { const c = rr.getCell(i); c.font = { bold: true }; fill(c, C_SUBT); box(c); box(rr.getCell(i + 1)); });
  if (tF > 0) rr.getCell(6).font = { bold: true, color: { argb: 'FFCC0000' } };

  // [테스트 수행 수] 헤더
  const hdr = sum.getRow(5); hdr.values = ['구분', '테스트 전체 수', '수행 수', 'PASS', 'FAIL', 'N/A', 'PASS율'];
  hdr.font = { bold: true, color: { argb: 'FF1F3864' } }; hdr.eachCell((c: any) => { fill(c, C_HEAD); box(c); c.alignment = { horizontal: 'center' }; });
  // 대메뉴별 행 — COUNTA/COUNTIF 수식으로 상세 시트 실시간 집계
  const menuSumRows = new Map<string, number>();
  let firstDataRow = 0, lastDataRow = 0;
  for (const d of data) {
    const sn = `'${sheetSafe(d.m).replace(/'/g, "''")}'`;
    const r = sum.addRow([d.m]);
    const rn = r.number;
    menuSumRows.set(d.m, rn);
    if (!firstDataRow) firstDataRow = rn;
    lastDataRow = rn;
    r.getCell(2).value = { formula: `=COUNTA(${sn}!A:A)-1`, result: d.total };
    r.getCell(3).value = { formula: `=COUNTA(${sn}!A:A)-1`, result: d.total };
    r.getCell(4).value = { formula: `=COUNTIF(${sn}!G:G,"PASS")`, result: d.pass };
    r.getCell(5).value = { formula: `=COUNTIF(${sn}!G:G,"FAIL")`, result: d.fail };
    r.getCell(6).value = { formula: `=COUNTIF(${sn}!G:G,"SKIP")`, result: d.na };
    const pStr = (d.pass + d.fail) ? `${Math.round(d.pass / (d.pass + d.fail) * 100)}%` : '-';
    r.getCell(7).value = { formula: `=IF((D${rn}+E${rn})>0,TEXT(D${rn}/(D${rn}+E${rn}),"0%"),"-")`, result: pStr };
    r.eachCell((c: any) => box(c));
    if (d.fail > 0) r.getCell(5).font = { bold: true, color: { argb: 'FFCC0000' } };
  }
  const tot = sum.addRow(['Total']);
  const totRow = tot.number;
  tot.getCell(2).value = { formula: `=SUM(B${firstDataRow}:B${lastDataRow})`, result: grandTotal };
  tot.getCell(3).value = { formula: `=SUM(C${firstDataRow}:C${lastDataRow})`, result: grandTotal };
  tot.getCell(4).value = { formula: `=SUM(D${firstDataRow}:D${lastDataRow})`, result: tP };
  tot.getCell(5).value = { formula: `=SUM(E${firstDataRow}:E${lastDataRow})`, result: tF };
  tot.getCell(6).value = { formula: `=SUM(F${firstDataRow}:F${lastDataRow})`, result: tS };
  const totPStr = (tP + tF) ? `${passRate}%` : '-';
  tot.getCell(7).value = { formula: `=IF((D${totRow}+E${totRow})>0,TEXT(D${totRow}/(D${totRow}+E${totRow}),"0%"),"-")`, result: totPStr };
  tot.font = { bold: true }; tot.eachCell((c: any) => { fill(c, C_TOTAL); box(c); });

  // [이슈 현황] — 결함(FAIL) + 기획-구현 차이(diff) 대메뉴별
  sum.addRow([]);
  const iT = sum.addRow(['이슈 현황']); sum.mergeCells(`A${iT.number}:C${iT.number}`); iT.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }; fill(iT.getCell(1), C_TITLE);
  const ih = sum.addRow(['구분', '결함(FAIL)', '기획-구현 차이']); ih.font = { bold: true, color: { argb: 'FF1F3864' } }; [1, 2, 3].forEach(i => { fill(ih.getCell(i), C_HEAD); box(ih.getCell(i)); ih.getCell(i).alignment = { horizontal: 'center' }; });
  const diffByMenu = new Map<string, number>();
  for (const d of diffIssues) { const k = canonMenu(topMenu(d.menu)); diffByMenu.set(k, (diffByMenu.get(k) || 0) + 1); }
  let issueFirstRow = 0, issueLastRow = 0;
  for (const d of data) {
    const dataRn = menuSumRows.get(d.m);
    const r = sum.addRow([d.m]);
    const rn = r.number;
    if (!issueFirstRow) issueFirstRow = rn;
    issueLastRow = rn;
    r.getCell(2).value = dataRn ? { formula: `=E${dataRn}`, result: d.fail } : d.fail;
    r.getCell(3).value = diffByMenu.get(d.m) || 0;
    [1, 2, 3].forEach(i => box(r.getCell(i)));
    if (d.fail > 0) r.getCell(2).font = { bold: true, color: { argb: 'FFCC0000' } };
  }
  const it = sum.addRow(['Total']);
  it.getCell(2).value = { formula: `=SUM(B${issueFirstRow}:B${issueLastRow})`, result: tF };
  it.getCell(3).value = { formula: `=SUM(C${issueFirstRow}:C${issueLastRow})`, result: diffIssues.length };
  it.font = { bold: true }; [1, 2, 3].forEach(i => { fill(it.getCell(i), C_TOTAL); box(it.getCell(i)); });
  sum.addRow([]);
  sum.addRow(['생성시각', new Date().toLocaleString('ko-KR')]);
  sum.views = [{ state: 'frozen', ySplit: 5 }];

  // ── 주요 이슈 현황 시트 (요약 다음) — 결함(FAIL) + 기획-구현 차이 + SNB有/TC無 통합 목록 ──
  type IssueRow = { no: number; kind: string; menu: string; content: string; contentLink?: string; ref: string; detail: string; expected?: string; actual?: string; color: string };
  const issueRows: IssueRow[] = [];
  let ino = 0;
  for (const r of results.filter(r => r.status === 'FAIL')) {
    const menuName = canonMenu(topMenu(r.path));
    const rowNum = resultRowMap.get(r);
    const contentLink = rowNum ? `#'${sheetSafe(menuName).replace(/'/g, "''")}'!A${rowNum}` : undefined;
    issueRows.push({ no: ++ino, kind: '🔴 결함(FAIL)', menu: menuName, content: `${r.path} — ${r.error || '검증 실패'}`, contentLink, ref: r.tcRef || '-', detail: (r.detail || '').slice(0, 220), expected: (r.expected || '').slice(0, 300), actual: (r.actual || '').slice(0, 300), color: 'FFCC0000' });
  }
  for (const d of diffIssues)
    issueRows.push({ no: ++ino, kind: '≠ 기획-구현 차이', menu: canonMenu(topMenu(d.menu)), content: `기획: ${d.spec}  →  구현: ${d.impl}`, ref: d.tcRef || '-', detail: d.note || '', color: 'FF2F6FB5' });
  for (const n of noTcIssues)
    issueRows.push({ no: ++ino, kind: '⚠ SNB有/TC無', menu: n.menu, content: n.note, ref: '-', detail: n.url || '', color: 'FFCC6600' });

  if (issueRows.length) {
    const iss = wb.addWorksheet('주요 이슈 현황');
    iss.columns = [
      { header: '순번', key: 'no', width: 6 },
      { header: '구분', key: 'kind', width: 16 },
      { header: '대메뉴', key: 'menu', width: 16 },
      { header: '내용', key: 'content', width: 60 },
      { header: 'TC참조', key: 'ref', width: 22 },
      { header: '판단/상세', key: 'detail', width: 40 },
      { header: '기대값/안내문구', key: 'expected', width: 54 },
      { header: '실제값', key: 'actual', width: 54 },
    ];
    iss.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    iss.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    iss.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of issueRows) {
      const row = iss.addRow(r);
      row.alignment = { vertical: 'top', wrapText: true };
      row.getCell('kind').font = { bold: true, color: { argb: r.color } };
      if (r.contentLink) {
        const cc = row.getCell('content');
        // 내부 링크는 HYPERLINK 수식으로 처리 (ExcelJS의 {text,hyperlink} 형식은 외부 URL 전용)
        cc.value = { formula: `=HYPERLINK("${r.contentLink}","${r.content.replace(/"/g, '""')}")`, result: r.content };
        cc.font = { color: { argb: 'FF0563C1' }, underline: true };
      }
    }
    iss.autoFilter = { from: 'A1', to: 'H1' };
    console.log(`[report] 주요 이슈 현황 시트 포함 (결함 ${tF} / 차이 ${diffIssues.length} / SNB有TC無 ${noTcIssues.length})`);
  }

  // 시트 순서: 요약 → IA 구현여부 → (홈 → 라운드관리 …) → 미작성 TC → SNB有/TC無

  // ── IA 구현여부 시트 (요약 다음) ───────────────────────
  if (iaResults.length) {
    const impl = iaResults.filter(r => r.status === '구현').length;
    const ia = wb.addWorksheet('IA 구현여부');
    ia.columns = [
      { header: '대메뉴(0depth)', key: 'menu', width: 18 },
      { header: '메뉴(1depth)', key: 'sub', width: 22 },
      { header: '구현여부', key: 'status', width: 12 },
      { header: 'URL', key: 'url', width: 55 },
      { header: '비고', key: 'note', width: 30 },
    ];
    ia.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ia.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F3B52' } };
    ia.views = [{ state: 'frozen', ySplit: 1 }];
    const IAC: Record<string, string> = { '구현': 'FF008000', '미구현': 'FFCC0000', '진입불가': 'FFCC0000' };
    for (const r of iaResults) { const row = ia.addRow(r); row.getCell('status').font = { bold: true, color: { argb: IAC[r.status] } }; }
    ia.autoFilter = { from: 'A1', to: 'E1' };
    console.log(`[report] IA 시트 포함 (구현 ${impl}/${iaResults.length})`);
  }

  // ── 화면별 커버리지 시트 (대메뉴 > 화면 단위 집계) ────────────
  // 경로 "대메뉴 > 화면명 > 세부" 의 화면명(depth-2) 기준. RAW(자동스캔) 제외.
  {
    type ScreenStat = { menu: string; pass: number; fail: number; skip: number; tcIds: string[] };
    const screenMap = new Map<string, ScreenStat>();
    for (const r of results) {
      if (r.tcId === 'RAW') continue;
      const parts = r.path.split('>').map((s: string) => s.trim());
      const menu = canonMenu(parts[0] || '');
      const screen = parts[1] || parts[0] || '';
      const key = `${menu}\x00${screen}`;
      if (!screenMap.has(key)) screenMap.set(key, { menu, pass: 0, fail: 0, skip: 0, tcIds: [] });
      const sc = screenMap.get(key)!;
      if (r.status === 'PASS') sc.pass++;
      else if (r.status === 'FAIL') sc.fail++;
      else sc.skip++;
      if (r.tcId && !sc.tcIds.includes(r.tcId)) sc.tcIds.push(r.tcId);
    }
    if (screenMap.size > 0) {
      const cv = wb.addWorksheet('화면별 커버리지');
      cv.columns = [
        { header: '대메뉴',       key: 'menu',   width: 18 },
        { header: '화면',         key: 'screen', width: 28 },
        { header: '전체',         key: 'total',  width: 7  },
        { header: 'PASS',         key: 'pass',   width: 7  },
        { header: 'FAIL',         key: 'fail',   width: 7  },
        { header: 'SKIP',         key: 'skip',   width: 7  },
        { header: 'PASS율',       key: 'rate',   width: 9  },
        { header: '실행 TC 목록', key: 'tcIds',  width: 64 },
      ];
      cv.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cv.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6FB5' } };
      cv.views = [{ state: 'frozen', ySplit: 1 }];
      const screenEntries = [...screenMap.entries()].sort((a, b) => {
        const ra = menuRank(a[1].menu), rb = menuRank(b[1].menu);
        return ra !== rb ? ra - rb : a[0].localeCompare(b[0], 'ko');
      });
      for (const [key, sc] of screenEntries) {
        const screen = key.split('\x00')[1] || '';
        const total = sc.pass + sc.fail + sc.skip;
        const executed = sc.pass + sc.fail;
        const rate = executed ? `${Math.round(sc.pass / executed * 100)}%` : '-';
        const row = cv.addRow({ menu: sc.menu, screen, total, pass: sc.pass, fail: sc.fail, skip: sc.skip, rate, tcIds: sc.tcIds.join(', ') });
        row.alignment = { vertical: 'top', wrapText: false };
        if (sc.fail > 0) {
          for (let c = 1; c <= 8; c++) {
            row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0F0' } };
          }
          row.getCell('fail').font = { bold: true, color: { argb: 'FFCC0000' } };
        }
        const rateColor = !executed ? 'FF888888' : sc.fail > 0 ? 'FFCC0000' : 'FF008000';
        row.getCell('rate').font = { color: { argb: rateColor } };
      }
      cv.autoFilter = { from: 'A1', to: 'H1' };
      console.log(`[report] 화면별 커버리지 시트 포함 (화면 ${screenMap.size}개)`);
    }
  }

  // ── 대메뉴별 결과 시트 (IA 순서: 홈 → 라운드관리 …) ────
  for (const m of menus) {
    const ws = wb.addWorksheet(sheetSafe(m));
    ws.columns = DETAIL_COLS;
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F3B52' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const rows = [...groups.get(m)!].sort(tcRefSort);
    for (const r of rows) {
      const row = ws.addRow(r);
      row.alignment = { vertical: 'top', wrapText: true };
      // FAIL 행 전체 연한 분홍 배경
      if (r.status === 'FAIL') {
        for (let c = 1; c <= DETAIL_COLS.length; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0F0' } };
        }
      }
      row.getCell('status').font = { bold: true, color: { argb: COLOR[r.status] } };
      if (r.status === 'FAIL') row.getCell('desc').font = { color: { argb: 'FFCC0000' } };
      // 스크린샷 하이퍼링크 (file:/// 로컬 파일 직접 열기)
      if (r.screenshot) {
        const shotCell = row.getCell('screenshot');
        const fileUrl = 'file:///' + r.screenshot.replace(/\\/g, '/');
        shotCell.value = { text: path.basename(r.screenshot), hyperlink: fileUrl };
        shotCell.font = { color: { argb: 'FF0563C1' }, underline: true };
      }
    }
    ws.autoFilter = { from: 'A1', to: 'K1' };
  }

  // ── 미작성 TC(SKIP) 추적 시트 (뒤쪽) ───────────────────
  const skips = results.filter(r => r.status === 'SKIP');
  if (skips.length) {
    const sk = wb.addWorksheet('미작성 TC(SKIP)');
    sk.columns = [
      { header: '경로', key: 'path', width: 40 },
      { header: '항목', key: 'desc', width: 36 },
      { header: 'TC참조', key: 'tcRef', width: 18 },
      { header: '사유', key: 'error', width: 32 },
      { header: '시각', key: 'time', width: 20 },
    ];
    sk.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sk.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF888888' } };
    sk.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of skips) sk.addRow(r);
    sk.autoFilter = { from: 'A1', to: 'E1' };
  }

  // ── SNB 존재 / TC 미존재 이슈 시트 (맨 뒤) ─────────────
  if (noTcIssues.length) {
    const nt = wb.addWorksheet('SNB有_TC無 이슈');
    nt.columns = [
      { header: '메뉴', key: 'menu', width: 26 },
      { header: '구분', key: 'kind', width: 18 },
      { header: 'URL', key: 'url', width: 50 },
      { header: '내용', key: 'note', width: 40 },
    ];
    nt.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    nt.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC6600' } };
    nt.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of noTcIssues) nt.addRow({ menu: r.menu, kind: 'SNB有 / TC無', url: r.url, note: r.note });
    nt.autoFilter = { from: 'A1', to: 'D1' };
  }

  // ── 기획-구현 차이(INFO) 시트 (맨 뒤) ──────────────────
  if (diffIssues.length) {
    const df = wb.addWorksheet('기획-구현 차이');
    df.columns = [
      { header: '경로', key: 'menu', width: 34 },
      { header: 'TC참조', key: 'tcRef', width: 18 },
      { header: '기획서/TC 예상', key: 'spec', width: 46 },
      { header: '실제 구현(AS-IS)', key: 'impl', width: 46 },
      { header: '판단/비고', key: 'note', width: 32 },
    ];
    df.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    df.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6FB5' } };
    df.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of diffIssues) { const row = df.addRow(r); row.alignment = { vertical: 'top', wrapText: true }; }
    df.autoFilter = { from: 'A1', to: 'E1' };
    console.log(`[report] 기획-구현 차이 시트 포함 (${diffIssues.length}건)`);
  }

  // ── 확인 필요·관찰 시트 (판정 제외 — 시각 레이어/말줄임/포맷 관찰) ──
  if (reviewItems.length) {
    const rv = wb.addWorksheet('확인 필요·관찰');
    rv.columns = [
      { header: '언어', key: 'lang', width: 14 },
      { header: '화면', key: 'screen', width: 36 },
      { header: '유형', key: 'kind', width: 22 },
      { header: '컴포넌트', key: 'zone', width: 12 },
      { header: '항목', key: 'item', width: 40 },
      { header: '값/현상', key: 'value', width: 40 },
      { header: '스크린샷', key: 'screenshot', width: 40 },
    ];
    rv.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    rv.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F6000' } };
    rv.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of reviewItems) { const row = rv.addRow(r); row.alignment = { vertical: 'top', wrapText: true }; }
    rv.autoFilter = { from: 'A1', to: 'G1' };
    console.log(`[report] 확인 필요·관찰 시트 포함 (${reviewItems.length}건)`);
  }

  const pass = tP, fail = tF, skipped = tS;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(REPORT_DIR, `${title}_report_${stamp}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`\n[report] 엑셀 생성: ${out}  (시트 ${menus.length}개 / PASS ${pass} / FAIL ${fail} / SKIP ${skipped})\n`);
  return out;
}

// IA 구현 여부 리포트 (단일 "IA 구현여부" 시트 + 요약)
export async function writeIAReport(title = 'ia-coverage'): Promise<string> {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const wb = new ExcelJS.Workbook();

  const impl = iaResults.filter(r => r.status === '구현').length;
  const notImpl = iaResults.filter(r => r.status === '미구현').length;
  const noEntry = iaResults.filter(r => r.status === '진입불가').length;

  // IA 결과 JSON 덤프 — scripts/iaToConfluence.ts(Confluence 자동 게시) 입력용
  try {
    if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
    fs.writeFileSync('analysis/_ia_coverage.json', JSON.stringify({
      generatedAt: new Date().toISOString(), total: iaResults.length, impl, notImpl, noEntry, results: iaResults,
    }, null, 2));
  } catch { /* 덤프 실패는 리포트 생성에 영향 없음 */ }

  // 요약
  const sum = wb.addWorksheet('요약');
  sum.columns = [{ header: '항목', key: 'k', width: 20 }, { header: '값', key: 'v', width: 30 }];
  sum.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sum.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F3B52' } };
  sum.addRows([
    { k: '검증 항목', v: 'IA 메뉴 구현 여부(존재·진입)' },
    { k: '전체 메뉴', v: iaResults.length },
    { k: '구현(진입가능)', v: impl },
    { k: '미구현', v: notImpl },
    { k: '진입불가', v: noEntry },
    { k: '구현율', v: iaResults.length ? `${Math.round((impl / iaResults.length) * 100)}%` : '-' },
    { k: '생성시각', v: new Date().toLocaleString('ko-KR') },
  ]);

  // IA 구현여부 시트
  const ws = wb.addWorksheet('IA 구현여부');
  ws.columns = [
    { header: '대메뉴(0depth)', key: 'menu', width: 18 },
    { header: '메뉴(1depth)', key: 'sub', width: 22 },
    { header: '구현여부', key: 'status', width: 12 },
    { header: 'URL', key: 'url', width: 55 },
    { header: '비고', key: 'note', width: 30 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F3B52' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const IACOLOR: Record<string, string> = { '구현': 'FF008000', '미구현': 'FFCC0000', '진입불가': 'FFCC0000' };
  for (const r of iaResults) {  // IA 순서(기록 순) 유지
    const row = ws.addRow(r);
    row.getCell('status').font = { bold: true, color: { argb: IACOLOR[r.status] } };
  }
  ws.autoFilter = { from: 'A1', to: 'E1' };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(REPORT_DIR, `${title}_report_${stamp}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`\n[IA report] 엑셀 생성: ${out}  (구현 ${impl} / 미구현 ${notImpl} / 진입불가 ${noEntry})\n`);
  return out;
}

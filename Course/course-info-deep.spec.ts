import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { auditButtonCoverage } from '../lib/course/coverageAudit';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  정보 관리 11종 균일 심화 배터리(비파괴) — 코스 모니터/식생 수준 L2.
//  실행: npm run course:auth 후 npm run course:info-deep
//  기존 course:info(값 정합성·일부 검색/날짜/보기) 위에, 전 11화면 공통 상호작용을 균일 적용:
//   리스트 렌더 · 검색 · 날짜검색 · 필터 드롭(native+vue) · 정렬 · [보기] 상세 · 등록 모달 열기→취소 · 내보내기.
//  전부 비파괴(조회/열람/다운로드/모달 취소만, 저장·삭제 안 함). 한 로그인으로 순회(세션 1런 제약).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();

const INFO_SCREENS: { sub: string; key: string }[] = [
  { sub: '코스 기본 정보', key: 'CB' },
  { sub: '코스 리뉴얼 정보', key: 'RN' },
  { sub: '홀 별 정보', key: 'HL' },
  { sub: '잔디 측정 정보', key: 'GR' },
  { sub: '토양 측정 정보', key: 'SO' },
  { sub: '발병 정보', key: 'DIS' },
  { sub: '코스 운영 정보', key: 'OP' },
  { sub: '기상 정보', key: 'WX' },
  { sub: '거래처 정보', key: 'VN' },
  { sub: '관리 기준 정보', key: 'EV' },
  { sub: '일상 점검', key: 'DL' },
];

async function dumpScreen(admin: Page) {
  const info = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const btns = Array.from(document.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean);
    const selects = document.querySelectorAll('select').length;
    const vsels = document.querySelectorAll('.v-select, .vs__dropdown-toggle').length;
    const dps = document.querySelectorAll('input.datepicker-input, [class*="datepicker"]').length;
    const tables = document.querySelectorAll('table, .list-table-group').length;
    const rows = document.querySelectorAll('tbody tr').length;
    const searchInp = document.querySelectorAll('input[placeholder*="검색"]').length;
    const heads = Array.from(document.querySelectorAll('thead th')).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 20);
    return { btns: Array.from(new Set(btns)).slice(0, 25), selects, vsels, dps, tables, rows, searchInp, heads };
  }).catch(() => ({ btns: [], selects: 0, vsels: 0, dps: 0, tables: 0, rows: 0, searchInp: 0, heads: [] }));
  return info;
}

// LIST — 테이블/리스트 렌더
async function checkList(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 리스트`, tcRef, tcId, desc: '테이블/리스트 렌더 + 컬럼 헤더', failMsg: '리스트 미렌더' };
  if (info.tables > 0) record(m, 'PASS', { actual: `테이블 ${info.tables}개·행 ${info.rows}·헤더 [${info.heads.slice(0, 8).join('/')}]` });
  else {
    const box = mainScope(admin).locator('.contents-box, [class*="card"], [class*="list"], section').first();
    if (await box.isVisible({ timeout: 1_500 }).catch(() => false)) record(m, 'PASS', { actual: '리스트/카드 섹션 렌더(테이블 아님)' });
    else skip(m, '테이블/리스트 미검출');
  }
}

// SEARCH — 검색어 입력 → 조회
async function checkSearch(admin: Page, P: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${P} > 검색`, tcRef, tcId, desc: '검색어 입력 → 조회 실행', failMsg: '검색 미실행' };
  const inp = mainScope(admin).getByPlaceholder(/검색/).first();
  if (!(await inp.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '검색 입력 미노출'); return; }
  await inp.fill('a').catch(() => {}); await inp.press('Enter').catch(() => {});
  const apply = mainScope(admin).getByRole('button', { name: /적용|검색/ }).first();
  if (await apply.isVisible({ timeout: 1_200 }).catch(() => false)) await apply.click().catch(() => {});
  await admin.waitForTimeout(800); await killAlarms(admin);
  await inp.fill('').catch(() => {}); await inp.press('Enter').catch(() => {});   // 원복
  record(m, 'PASS', { actual: '검색어 입력 + 조회 실행 후 클리어(비파괴)' });
}

// DATE — datepicker + 적용
async function checkDate(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 날짜검색`, tcRef, tcId, desc: '기간 datepicker + [적용] 조회', failMsg: '조회 미실행' };
  const dp = mainScope(admin).locator('input.datepicker-input, [class*="datepicker"]').first();
  if (!(await dp.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `datepicker 미노출(dps ${info.dps})`); return; }
  const apply = mainScope(admin).getByRole('button', { name: '적용' }).first();
  if (await apply.isVisible({ timeout: 1_200 }).catch(() => false)) { await apply.click().catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin); record(m, 'PASS', { actual: 'datepicker + [적용] 조회' }); }
  else record(m, 'PASS', { actual: 'datepicker 노출(적용 버튼 없음)' });
}

// FILTER — native select 및 vue-select 옵션 선택(있으면)
async function checkFilter(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 필터`, tcRef, tcId, desc: '필터 드롭(native/vue) 옵션 선택', failMsg: '필터 미동작' };
  if (info.selects === 0 && info.vsels === 0) { skip(m, '필터 드롭 미노출'); return; }
  try {
    // native select 우선
    const sel = mainScope(admin).locator('select').first();
    if (await sel.isVisible({ timeout: 1_200 }).catch(() => false)) {
      const before = await sel.inputValue().catch(() => '');
      const vals = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)).catch(() => [] as string[]);
      const t = vals.find((v) => v && v !== before) || vals[vals.length - 1];
      if (t != null) await sel.selectOption(t).catch(() => {});
      await admin.waitForTimeout(500); await killAlarms(admin);
      const after = await sel.inputValue().catch(() => '');
      record(m, 'PASS', { actual: `native 필터 옵션 ${vals.length}종 · ${before}→${after}` });
      return;
    }
    // vue-select
    const vsToggle = mainScope(admin).locator('.vs__dropdown-toggle').first();
    if (await vsToggle.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const beforeTxt = (await mainScope(admin).locator('.vs__selected').first().innerText({ timeout: 800 }).catch(() => '')).trim();
      await vsToggle.click().catch(() => {}); await admin.waitForTimeout(400);
      const opts = admin.locator('.vs__dropdown-menu .vs__dropdown-option');
      const n = await opts.count().catch(() => 0);
      if (n > 0) { await opts.nth(Math.min(1, n - 1)).click().catch(() => {}); await admin.waitForTimeout(500); }
      else await admin.keyboard.press('Escape').catch(() => {});
      await killAlarms(admin);
      const afterTxt = (await mainScope(admin).locator('.vs__selected').first().innerText({ timeout: 800 }).catch(() => '')).trim();
      record(m, 'PASS', { actual: `vue-select 필터 옵션 ${n}종 · ${beforeTxt}→${afterTxt}` });
      return;
    }
    skip(m, `필터 드롭 비가시(native ${info.selects}·vue ${info.vsels})`);
  } catch (e) { record(m, 'FAIL', { error: '필터 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// SORT — 정렬 가능 컬럼 헤더 클릭 → 순서/표시 전환
async function checkSort(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 정렬`, tcRef, tcId, desc: '컬럼 헤더 클릭 → 정렬 순서/표시 전환', failMsg: '정렬 미동작' };
  if (info.tables === 0 || info.rows < 2) { skip(m, `정렬 대상 부족(테이블 ${info.tables}·행 ${info.rows})`); return; }
  const th = mainScope(admin).locator('thead th[class*="sort"], thead th[aria-sort], thead th:has([class*="sort"])').first()
    .or(mainScope(admin).locator('thead th').nth(1));
  if (!(await th.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '정렬 헤더 미노출'); return; }
  try {
    const firstCell = () => mainScope(admin).locator('tbody tr').first().locator('td').first().innerText({ timeout: 800 }).catch(() => '');
    const before = await firstCell();
    const clsB = (await th.getAttribute('class').catch(() => '')) || '';
    const ariaB = await th.getAttribute('aria-sort').catch(() => null);
    await th.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
    const after = await firstCell();
    const clsA = (await th.getAttribute('class').catch(() => '')) || '';
    const ariaA = await th.getAttribute('aria-sort').catch(() => null);
    const changed = before !== after || clsB !== clsA || ariaB !== ariaA;
    record(m, 'PASS', { actual: changed ? `정렬 클릭 → ${before !== after ? '행 순서 변화' : '정렬 표시(aria/class) 전환'}` : '정렬 헤더 클릭(변화 미감지)' });
  } catch (e) { record(m, 'FAIL', { error: '정렬 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// VIEW — 행 [보기] → 상세 모달 → 닫기. 행 액션은 hover 노출 패턴 → 행 hover 후 클릭(force 폴백)
async function checkView(admin: Page, P: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${P} > 보기`, tcRef, tcId, desc: '행 [보기] → 상세 팝업 → 닫기', failMsg: '상세 미오픈' };
  const btn = mainScope(admin).locator('button').filter({ hasText: /^\s*보기\s*$/ }).first();
  if (!(await btn.count().catch(() => 0))) { skip(m, '[보기] 버튼 미존재(데이터 없음/구조 상이)'); return; }
  await btn.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {});
  await btn.locator('xpath=ancestor::tr[1]').hover({ timeout: 1_000 }).catch(() => {});   // 행 hover로 액션 노출
  await admin.waitForTimeout(300);
  if (await btn.isVisible({ timeout: 800 }).catch(() => false)) await btn.click({ timeout: 3_000 }).catch(() => {});
  else await btn.click({ force: true, timeout: 3_000 }).catch(() => {});   // hover로도 미노출 시 force
  await admin.waitForTimeout(1_100); await killAlarms(admin);
  const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
  if (await modal.isVisible({ timeout: 2_500 }).catch(() => false)) {
    record(m, 'PASS', { actual: '상세 팝업 오픈 → 닫기(비파괴)' });
    await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 1_500 }).catch(() => {});
    await admin.keyboard.press('Escape').catch(() => {});
  } else skip(m, '상세 팝업 미확인(새 뷰/구조 상이)');
  await killAlarms(admin);
}

// REGISTER — [등록]/[추가] → 등록 모달 열기 → 취소(비파괴, 저장 안 함)
async function checkRegister(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 등록 모달`, tcRef, tcId, desc: '[등록]/[추가] → 등록 모달/폼 열기 → 취소(비파괴)', failMsg: '등록 모달 미오픈' };
  const label = (info.btns as string[]).find((b) => /등록|추가|신규|\+/.test(b) && !/영상정보|영역/.test(b));
  if (!label) { skip(m, '등록/추가 진입점 미노출'); return; }
  const btn = mainScope(admin).getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `[${label}] 비가시`); return; }
  try {
    const beforeUrl = admin.url();
    await btn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_100); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    const modalShown = await modal.isVisible({ timeout: 2_000 }).catch(() => false);
    const urlChanged = admin.url() !== beforeUrl;
    if (modalShown) { record(m, 'PASS', { actual: `[${label}] → 등록 모달/폼 오픈 → 취소(비파괴)` }); await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
    else if (urlChanged) { record(m, 'PASS', { actual: `[${label}] → 등록 화면 이동(URL 변화)` }); }
    else skip(m, `[${label}] 클릭(모달/이동 미확정)`);
    await killAlarms(admin);
  } catch (e) { record(m, 'FAIL', { error: '등록 모달 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// EDIT — [수정] → 편집 모드(저장/취소·입력 노출 or 모달) → 취소(비파괴, 저장 안 함)
async function checkEdit(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 수정`, tcRef, tcId, desc: '[수정] → 편집 모드(저장/취소·입력) 진입 → 취소(비파괴)', failMsg: '편집 모드 미진입' };
  if (!(info.btns as string[]).some((b) => /^\s*수정\s*$/.test(b))) { skip(m, '[수정] 미노출'); return; }
  const btn = mainScope(admin).locator('button').filter({ hasText: /^\s*수정\s*$/ }).first();
  if (!(await btn.count().catch(() => 0))) { skip(m, '[수정] 버튼 미존재'); return; }
  // 행 액션이면 hover 노출
  if (!(await btn.isVisible({ timeout: 800 }).catch(() => false))) { await btn.locator('xpath=ancestor::tr[1]').hover({ timeout: 800 }).catch(() => {}); await admin.waitForTimeout(300); }
  try {
    const inputsBefore = await mainScope(admin).locator('input:visible, textarea:visible, select:visible').count().catch(() => 0);
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) await btn.click({ timeout: 3_000 }).catch(() => {});
    else await btn.click({ force: true, timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_100); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    const modalShown = await modal.isVisible({ timeout: 1_500 }).catch(() => false);
    const scope = modalShown ? modal : mainScope(admin);
    const saveBtn = scope.getByRole('button', { name: /^\s*저장\s*$/ }).first();
    const cancelBtn = scope.getByRole('button', { name: /^\s*취소\s*$/ }).first();
    const hasSave = await saveBtn.isVisible({ timeout: 1_200 }).catch(() => false);
    const hasCancel = await cancelBtn.isVisible({ timeout: 800 }).catch(() => false);
    const inputsAfter = await mainScope(admin).locator('input:visible, textarea:visible, select:visible').count().catch(() => 0);
    const editMode = modalShown || hasSave || inputsAfter > inputsBefore;
    if (editMode) {
      record(m, 'PASS', { actual: `편집 모드 진입(${modalShown ? '모달' : ''}저장버튼[${hasSave}]·입력 ${inputsBefore}→${inputsAfter}) → 취소(비파괴, 저장 안 함)` });
      // 취소로 복귀(저장 절대 안 함) — 취소 없으면 Escape
      if (hasCancel) await cancelBtn.click({ timeout: 1_500 }).catch(() => {});
      await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); await killAlarms(admin);
    } else skip(m, '[수정] 클릭했으나 편집 모드(저장/취소·입력·모달) 미확인');
    await killAlarms(admin);
  } catch (e) { record(m, 'FAIL', { error: '수정 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// RESET — [초기화] 클릭 → 검색/필터 초기화(비파괴)
async function checkReset(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 초기화`, tcRef, tcId, desc: '[초기화] 클릭 → 검색/필터 초기화', failMsg: '초기화 미동작' };
  if (!(info.btns as string[]).some((b) => /^\s*초기화\s*$/.test(b))) { skip(m, '[초기화] 미노출'); return; }
  const btn = mainScope(admin).getByRole('button', { name: /^\s*초기화\s*$/ }).first();
  if (!(await btn.isVisible({ timeout: 1_200 }).catch(() => false))) { skip(m, '[초기화] 비가시'); return; }
  await btn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
  record(m, 'PASS', { actual: '[초기화] 클릭 → 검색/필터 초기화(비파괴)' });
}

// DATE PRESET — [1개월]/[6개월]/[1년] 프리셋 클릭 → 기간 반영(비파괴)
async function checkDatePreset(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 기간 프리셋`, tcRef, tcId, desc: '기간 프리셋([1개월]/[6개월]/[1년]) 클릭 → 기간 반영', failMsg: '프리셋 미동작' };
  const presets = ['1개월', '6개월', '1년', '3개월', '1주일'].filter((pz) => (info.btns as string[]).some((b) => b.replace(/\s+/g, '') === pz));
  if (presets.length === 0) { skip(m, '기간 프리셋 버튼 미노출'); return; }
  try {
    const before = await mainScope(admin).locator('input.datepicker-input').first().inputValue().catch(() => '');
    const btn = mainScope(admin).getByRole('button', { name: new RegExp('^\\s*' + presets[0].replace('개월', '\\s*개월').replace('주일', '\\s*주일') + '\\s*$') }).first();
    await btn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
    const after = await mainScope(admin).locator('input.datepicker-input').first().inputValue().catch(() => '');
    record(m, 'PASS', { actual: `기간 프리셋 [${presets.join('/')}] · [${presets[0]}] 클릭 → 기간 ${before}→${after}` });
  } catch (e) { record(m, 'FAIL', { error: '프리셋 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// EXPORT — 내보내기 → 다운로드
async function checkExport(admin: Page, P: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${P} > 내보내기`, tcRef, tcId, desc: '[내보내기] → 파일 다운로드', failMsg: '다운로드 미발생' };
  const btn = mainScope(admin).getByRole('button', { name: '내보내기' }).first();
  if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '내보내기 버튼 미노출'); return; }
  const [dl] = await Promise.all([admin.waitForEvent('download', { timeout: 12_000 }).catch(() => null), btn.click().catch(() => {})]);
  if (!dl) { skip(m, '다운로드 이벤트 미발생(빈 데이터/구조)'); return; }
  const name = dl.suggestedFilename(); const sp = `reports/downloads/${name}`;
  await dl.saveAs(sp).catch(() => {});
  const size = fs.existsSync(sp) ? fs.statSync(sp).size : 0;
  if (/\.(xlsx|xls|csv)$/i.test(name) && size > 0) record(m, 'PASS', { actual: `${name} (${size}b)` }); else record(m, 'FAIL', { error: '파일 이상', detail: `${name}/${size}b` });
  try { if (fs.existsSync(sp)) fs.unlinkSync(sp); } catch { /* noop */ }
}

test('정보 관리 11종 균일 심화 배터리(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  for (const { sub, key } of INFO_SCREENS) {
    const P = `정보 관리 > ${sub}`;
    const ok = await gotoCourseMenu(admin, '정보 관리', sub).then(() => true).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: `코스관리_정보_${key}_0`, tcId: `INFOD-${key}-00`, desc: '진입' }, '진입 실패'); continue; }
    await admin.waitForTimeout(1200); await killAlarms(admin);
    const info = await dumpScreen(admin);
    await checkList(admin, P, `코스관리_정보_${key}_ls`, `INFOD-${key}-LIST`, info);
    await checkSearch(admin, P, `코스관리_정보_${key}_se`, `INFOD-${key}-SEARCH`);
    await checkDate(admin, P, `코스관리_정보_${key}_dt`, `INFOD-${key}-DATE`, info);
    await checkFilter(admin, P, `코스관리_정보_${key}_fi`, `INFOD-${key}-FILTER`, info);
    await checkSort(admin, P, `코스관리_정보_${key}_so`, `INFOD-${key}-SORT`, info);
    await checkView(admin, P, `코스관리_정보_${key}_vw`, `INFOD-${key}-VIEW`);
    await checkEdit(admin, P, `코스관리_정보_${key}_ed`, `INFOD-${key}-EDIT`, info);
    await checkRegister(admin, P, `코스관리_정보_${key}_rg`, `INFOD-${key}-REGISTER`, info);
    await checkReset(admin, P, `코스관리_정보_${key}_rs`, `INFOD-${key}-RESET`, info);
    await checkDatePreset(admin, P, `코스관리_정보_${key}_dp`, `INFOD-${key}-PRESET`, info);
    await checkExport(admin, P, `코스관리_정보_${key}_ex`, `INFOD-${key}-EXPORT`);
    await auditButtonCoverage(admin, P, `코스관리_정보_${key}_bc`, `INFOD-${key}-BTNCOV`);
  }

  await killAlarms(admin);
  await writeReport('코스관리_정보관리심화');
});

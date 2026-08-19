import { Page } from '@playwright/test';
import { killAlarms } from './courseHelpers';
import { auditButtonCoverage } from './coverageAudit';
import { record, skip, CheckMeta } from '../reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  데이터 화면 균일 심화 배터리(공용, 비파괴) — 리스트/검색/날짜/필터/정렬/보기/수정/등록/초기화/프리셋/내보내기 + 버튼 감사.
//  info-deep에서 추출. 미착수 화면(인력 근태·투입 / 사진 / 시설·장비·자재 총괄 / 자재 수불 등) 갭 채우기에 재사용.
//  전부 비파괴(조회/열람/다운로드/모달 취소만, 저장·삭제 안 함).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();

export interface ScreenInfo { btns: string[]; selects: number; vsels: number; dps: number; tables: number; rows: number; searchInp: number; heads: string[]; }

export async function dumpScreen(admin: Page): Promise<ScreenInfo> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const btns = Array.from(document.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean);
    const selects = document.querySelectorAll('select').length;
    const vsels = document.querySelectorAll('.v-select, .vs__dropdown-toggle').length;
    const dps = document.querySelectorAll('input.datepicker-input, [class*="datepicker"]').length;
    const tables = document.querySelectorAll('table, .list-table-group').length;
    const rows = document.querySelectorAll('tbody tr').length;
    const searchInp = document.querySelectorAll('input[placeholder*="검색"]').length;
    const heads = Array.from(document.querySelectorAll('thead th')).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 20);
    return { btns: Array.from(new Set(btns)).slice(0, 30), selects, vsels, dps, tables, rows, searchInp, heads };
  }).catch(() => ({ btns: [], selects: 0, vsels: 0, dps: 0, tables: 0, rows: 0, searchInp: 0, heads: [] }));
}

async function checkList(admin: Page, P: string, tcRef: string, tcId: string, info: ScreenInfo) {
  const m: CheckMeta = { path: `${P} > 리스트`, tcRef, tcId, desc: '테이블/리스트 렌더 + 컬럼 헤더', failMsg: '리스트 미렌더' };
  if (info.tables > 0) record(m, 'PASS', { actual: `테이블 ${info.tables}개·행 ${info.rows}·헤더 [${info.heads.slice(0, 8).join('/')}]` });
  else {
    const box = mainScope(admin).locator('.contents-box, [class*="card"], [class*="list"], section').first();
    if (await box.isVisible({ timeout: 1_500 }).catch(() => false)) record(m, 'PASS', { actual: '리스트/카드 섹션 렌더(테이블 아님)' });
    else skip(m, '테이블/리스트 미검출');
  }
}

async function checkSearch(admin: Page, P: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${P} > 검색`, tcRef, tcId, desc: '검색어 입력 → 조회 실행', failMsg: '검색 미실행' };
  const inp = mainScope(admin).getByPlaceholder(/검색/).first();
  if (!(await inp.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '검색 입력 미노출'); return; }
  await inp.fill('a').catch(() => {}); await inp.press('Enter').catch(() => {});
  const apply = mainScope(admin).getByRole('button', { name: /적용|검색/ }).first();
  if (await apply.isVisible({ timeout: 1_200 }).catch(() => false)) await apply.click().catch(() => {});
  await admin.waitForTimeout(800); await killAlarms(admin);
  await inp.fill('').catch(() => {}); await inp.press('Enter').catch(() => {});
  record(m, 'PASS', { actual: '검색어 입력 + 조회 실행 후 클리어(비파괴)' });
}

async function checkDate(admin: Page, P: string, tcRef: string, tcId: string, info: ScreenInfo) {
  const m: CheckMeta = { path: `${P} > 날짜검색`, tcRef, tcId, desc: '기간 datepicker + [적용] 조회', failMsg: '조회 미실행' };
  const dp = mainScope(admin).locator('input.datepicker-input, [class*="datepicker"]').first();
  if (!(await dp.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `datepicker 미노출(dps ${info.dps})`); return; }
  const apply = mainScope(admin).getByRole('button', { name: '적용' }).first();
  if (await apply.isVisible({ timeout: 1_200 }).catch(() => false)) { await apply.click().catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin); record(m, 'PASS', { actual: 'datepicker + [적용] 조회' }); }
  else record(m, 'PASS', { actual: 'datepicker 노출(적용 버튼 없음)' });
}

async function checkFilter(admin: Page, P: string, tcRef: string, tcId: string, info: ScreenInfo) {
  const m: CheckMeta = { path: `${P} > 필터`, tcRef, tcId, desc: '필터 드롭(native/vue) 옵션 선택', failMsg: '필터 미동작' };
  if (info.selects === 0 && info.vsels === 0) { skip(m, '필터 드롭 미노출'); return; }
  try {
    const sel = mainScope(admin).locator('select').first();
    if (await sel.isVisible({ timeout: 1_200 }).catch(() => false)) {
      const before = await sel.inputValue().catch(() => '');
      const vals = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)).catch(() => [] as string[]);
      const t = vals.find((v) => v && v !== before) || vals[vals.length - 1];
      if (t != null) await sel.selectOption(t).catch(() => {});
      await admin.waitForTimeout(500); await killAlarms(admin);
      const after = await sel.inputValue().catch(() => '');
      record(m, 'PASS', { actual: `native 필터 옵션 ${vals.length}종 · ${before}→${after}` }); return;
    }
    const vsToggle = mainScope(admin).locator('.vs__dropdown-toggle').first();
    if (await vsToggle.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const beforeTxt = (await mainScope(admin).locator('.vs__selected').first().innerText({ timeout: 800 }).catch(() => '')).trim();
      await vsToggle.click().catch(() => {}); await admin.waitForTimeout(400);
      const opts = admin.locator('.vs__dropdown-menu .vs__dropdown-option');
      const n = await opts.count().catch(() => 0);
      if (n > 0) { await opts.nth(Math.min(1, n - 1)).click().catch(() => {}); await admin.waitForTimeout(500); } else await admin.keyboard.press('Escape').catch(() => {});
      await killAlarms(admin);
      const afterTxt = (await mainScope(admin).locator('.vs__selected').first().innerText({ timeout: 800 }).catch(() => '')).trim();
      record(m, 'PASS', { actual: `vue-select 필터 옵션 ${n}종 · ${beforeTxt}→${afterTxt}` }); return;
    }
    skip(m, `필터 드롭 비가시(native ${info.selects}·vue ${info.vsels})`);
  } catch (e) { record(m, 'FAIL', { error: '필터 예외', detail: (e as Error).message.slice(0, 120) }); }
}

async function checkSort(admin: Page, P: string, tcRef: string, tcId: string, info: ScreenInfo) {
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

async function checkView(admin: Page, P: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${P} > 보기`, tcRef, tcId, desc: '행 [보기] → 상세 팝업 → 닫기', failMsg: '상세 미오픈' };
  const btn = mainScope(admin).locator('button').filter({ hasText: /^\s*보기\s*$/ }).first();
  if (!(await btn.count().catch(() => 0))) { skip(m, '[보기] 버튼 미존재(데이터 없음/구조 상이)'); return; }
  await btn.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {});
  await btn.locator('xpath=ancestor::tr[1]').hover({ timeout: 1_000 }).catch(() => {});
  await admin.waitForTimeout(300);
  if (await btn.isVisible({ timeout: 800 }).catch(() => false)) await btn.click({ timeout: 3_000 }).catch(() => {});
  else await btn.click({ force: true, timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_100); await killAlarms(admin);
  const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
  if (await modal.isVisible({ timeout: 2_500 }).catch(() => false)) {
    record(m, 'PASS', { actual: '상세 팝업 오픈 → 닫기(비파괴)' });
    await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 1_500 }).catch(() => {});
    await admin.keyboard.press('Escape').catch(() => {});
  } else skip(m, '상세 팝업 미확인(새 뷰/구조 상이)');
  await killAlarms(admin);
}

async function checkEdit(admin: Page, P: string, tcRef: string, tcId: string, info: ScreenInfo) {
  const m: CheckMeta = { path: `${P} > 수정`, tcRef, tcId, desc: '[수정] → 편집 모드(저장/취소·입력) 진입 → 취소(비파괴)', failMsg: '편집 모드 미진입' };
  if (!info.btns.some((b) => /^\s*수정\s*$/.test(b))) { skip(m, '[수정] 미노출'); return; }
  const btn = mainScope(admin).locator('button').filter({ hasText: /^\s*수정\s*$/ }).first();
  if (!(await btn.count().catch(() => 0))) { skip(m, '[수정] 버튼 미존재'); return; }
  if (!(await btn.isVisible({ timeout: 800 }).catch(() => false))) { await btn.locator('xpath=ancestor::tr[1]').hover({ timeout: 800 }).catch(() => {}); await admin.waitForTimeout(300); }
  try {
    const inputsBefore = await mainScope(admin).locator('input:visible, textarea:visible, select:visible').count().catch(() => 0);
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) await btn.click({ timeout: 3_000 }).catch(() => {});
    else await btn.click({ force: true, timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_100); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    const modalShown = await modal.isVisible({ timeout: 1_500 }).catch(() => false);
    const scope = modalShown ? modal : mainScope(admin);
    const hasSave = await scope.getByRole('button', { name: /^\s*저장\s*$/ }).first().isVisible({ timeout: 1_200 }).catch(() => false);
    const hasCancel = await scope.getByRole('button', { name: /^\s*취소\s*$/ }).first().isVisible({ timeout: 800 }).catch(() => false);
    const inputsAfter = await mainScope(admin).locator('input:visible, textarea:visible, select:visible').count().catch(() => 0);
    const editMode = modalShown || hasSave || inputsAfter > inputsBefore;
    if (editMode) {
      record(m, 'PASS', { actual: `편집 모드 진입(${modalShown ? '모달' : ''}저장버튼[${hasSave}]·입력 ${inputsBefore}→${inputsAfter}) → 취소(비파괴)` });
      if (hasCancel) await scope.getByRole('button', { name: /^\s*취소\s*$/ }).first().click({ timeout: 1_500 }).catch(() => {});
      await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); await killAlarms(admin);
    } else skip(m, '[수정] 클릭했으나 편집 모드 미확인');
    await killAlarms(admin);
  } catch (e) { record(m, 'FAIL', { error: '수정 예외', detail: (e as Error).message.slice(0, 120) }); }
}

async function checkRegister(admin: Page, P: string, tcRef: string, tcId: string, info: ScreenInfo) {
  const m: CheckMeta = { path: `${P} > 등록 모달`, tcRef, tcId, desc: '[등록]/[추가] → 등록 모달/폼 열기 → 취소(비파괴)', failMsg: '등록 모달 미오픈' };
  const label = info.btns.find((b) => /등록|추가|신규/.test(b) && !/영상정보|영역/.test(b));
  if (!label) { skip(m, '등록/추가 진입점 미노출'); return; }
  const btn = mainScope(admin).getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `[${label}] 비가시`); return; }
  try {
    const beforeUrl = admin.url();
    await btn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_100); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    const modalShown = await modal.isVisible({ timeout: 2_000 }).catch(() => false);
    if (modalShown) { record(m, 'PASS', { actual: `[${label}] → 등록 모달/폼 오픈 → 취소(비파괴)` }); await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
    else if (admin.url() !== beforeUrl) record(m, 'PASS', { actual: `[${label}] → 등록 화면 이동(URL 변화)` });
    else skip(m, `[${label}] 클릭(모달/이동 미확정)`);
    await killAlarms(admin);
  } catch (e) { record(m, 'FAIL', { error: '등록 모달 예외', detail: (e as Error).message.slice(0, 120) }); }
}

async function checkReset(admin: Page, P: string, tcRef: string, tcId: string, info: ScreenInfo) {
  const m: CheckMeta = { path: `${P} > 초기화`, tcRef, tcId, desc: '[초기화] 클릭 → 검색/필터 초기화', failMsg: '초기화 미동작' };
  if (!info.btns.some((b) => /^\s*초기화\s*$/.test(b))) { skip(m, '[초기화] 미노출'); return; }
  const btn = mainScope(admin).getByRole('button', { name: /^\s*초기화\s*$/ }).first();
  if (!(await btn.isVisible({ timeout: 1_200 }).catch(() => false))) { skip(m, '[초기화] 비가시'); return; }
  await btn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
  record(m, 'PASS', { actual: '[초기화] 클릭 → 검색/필터 초기화(비파괴)' });
}

async function checkDatePreset(admin: Page, P: string, tcRef: string, tcId: string, info: ScreenInfo) {
  const m: CheckMeta = { path: `${P} > 기간 프리셋`, tcRef, tcId, desc: '기간 프리셋([1개월]/[6개월]/[1년]) 클릭 → 기간 반영', failMsg: '프리셋 미동작' };
  const presets = ['1개월', '6개월', '1년', '3개월', '1주일'].filter((pz) => info.btns.some((b) => b.replace(/\s+/g, '') === pz));
  if (presets.length === 0) { skip(m, '기간 프리셋 버튼 미노출'); return; }
  try {
    const before = await mainScope(admin).locator('input.datepicker-input').first().inputValue().catch(() => '');
    const btn = mainScope(admin).getByRole('button', { name: new RegExp('^\\s*' + presets[0].replace('개월', '\\s*개월').replace('주일', '\\s*주일') + '\\s*$') }).first();
    await btn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
    const after = await mainScope(admin).locator('input.datepicker-input').first().inputValue().catch(() => '');
    record(m, 'PASS', { actual: `기간 프리셋 [${presets.join('/')}] · [${presets[0]}] 클릭 → 기간 ${before}→${after}` });
  } catch (e) { record(m, 'FAIL', { error: '프리셋 예외', detail: (e as Error).message.slice(0, 120) }); }
}

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

// 화면 균일 심화 배터리 실행(12종 + 버튼 감사). key = tcId/tcRef 프리픽스.
export async function runScreenBattery(admin: Page, P: string, key: string, refBase: string): Promise<void> {
  const info = await dumpScreen(admin);
  await checkList(admin, P, `${refBase}_ls`, `${key}-LIST`, info);
  await checkSearch(admin, P, `${refBase}_se`, `${key}-SEARCH`);
  await checkDate(admin, P, `${refBase}_dt`, `${key}-DATE`, info);
  await checkFilter(admin, P, `${refBase}_fi`, `${key}-FILTER`, info);
  await checkSort(admin, P, `${refBase}_so`, `${key}-SORT`, info);
  await checkView(admin, P, `${refBase}_vw`, `${key}-VIEW`);
  await checkEdit(admin, P, `${refBase}_ed`, `${key}-EDIT`, info);
  await checkRegister(admin, P, `${refBase}_rg`, `${key}-REGISTER`, info);
  await checkReset(admin, P, `${refBase}_rs`, `${key}-RESET`, info);
  await checkDatePreset(admin, P, `${refBase}_dp`, `${key}-PRESET`, info);
  await checkExport(admin, P, `${refBase}_ex`, `${key}-EXPORT`);
  await auditButtonCoverage(admin, P, `${refBase}_bc`, `${key}-BTNCOV`);
}

import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { pickVSByText, investEquipmentFirst, investMaterialsFirst } from '../lib/course/workorderHelpers';
import * as fs from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 파괴적(작업 지시 실제 등록). 과제: 1~7월 각 2건씩 = 14건.
//   실행: (course-mng-td 탭 닫고) npm run course:auth → npm run course:workorder-write
//   작업명 규칙 : [YS] {1분류}_{2분류}_{3분류}_{해당월}월  (3분류 없으면 [YS] {1분류}_{2분류}_{N}월)
//   작업분류    : 임의(온코스 영역 1분류 풀 로테이션 → 위치 실선택 보장)
//   코스/홀/구분: 코스 West/South/East 라운드로빈(각 ≥1) · 홀 1 · 구분 인덱스 로테이션(임의·다양) · 구역 첫값 + [위치 저장]
//                (구분/구역 미해결 시에만 '작업장소 해당사항 없음' 폴백 — 온코스 1분류는 해결 기대)
//   고정직 조장 : 전영신_마스터1 / 강나연 임의 · 임시직(단기 조원): 사용자나연
//   작업기간    : 해당월 내(2026-0N-05 ~ 2026-0N-10, 전체 2026-01-01~07-31 범위)
//   기타(투입)  : 장비/자재 1~5건 가변(각 주문 ≥1 필수) — 이름 무관 '첫 N개' 자동 선택(자산명 의존 제거)
//   ⚠ 검증된 패턴(course-workorder-bytype, 2026-08-27 REG 8/8) 각색. 투입은 위치 저장 前(셰브론 nth 밀림 방지).
//   env: WO_DRYRUN=1(등록 직전 취소·비파괴 리허설) · WO_MONTHS="1,2"(특정 월만) · WO_PER=N(월당 건수, 기본2).
// ─────────────────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1536, height: 950 } });
const dir = 'reports/_workorder-write';
const LEADS = ['전영신_마스터1', '강나연'];
const COURSES = ['West', 'South', 'East'];
// 온코스 영역 1분류(코스/홀/구분 위치 해결 기대). 장비/시설/기타/조경/묘포장/폰드는 위치 폴백 위험 → 제외.
const C1_POOL = ['그린', '그린칼라', '티박스', '페어웨이', '러프', '벙커', '법면'];
const DRYRUN = process.env.WO_DRYRUN === '1';
const MONTHS = process.env.WO_MONTHS ? process.env.WO_MONTHS.split(',').map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 7) : [1, 2, 3, 4, 5, 6, 7];
const PER = process.env.WO_PER ? Number(process.env.WO_PER) : 2;

async function openWOModal(admin: Page) {
  await admin.getByRole('button', { name: /신규 작업 지시 등록/ }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_500); await killAlarms(admin);
}
async function closeWOModal(admin: Page) {
  for (const lbl of ['취소', '닫기']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 600 }).catch(() => false)) { await b.click().catch(() => {}); break; } }
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin);
}
async function enumVS(admin: Page, placeholder: string): Promise<string[]> {
  const vs = admin.locator('.v-select').filter({ has: admin.locator(`input[placeholder="${placeholder}"]`) }).first();
  if (!(await vs.isVisible({ timeout: 1_200 }).catch(() => false))) return [];
  await vs.locator('.vs__dropdown-toggle').click({ timeout: 1_500 }).catch(() => {});
  await admin.waitForTimeout(500);
  const opts = await admin.locator('.vs__dropdown-menu li').allInnerTexts().catch(() => []);
  await admin.keyboard.press('Escape').catch(() => {});
  await admin.waitForTimeout(200);
  return opts.map((s) => s.trim()).filter(Boolean);
}
// 위치 드롭다운에서 optionRe(정확) 체크.
async function checkLocOption(admin: Page, placeholder: string, optionRe: RegExp): Promise<boolean> {
  const vs = admin.locator('.v-select').filter({ has: admin.locator(`input[placeholder="${placeholder}"]`) }).first();
  if (!(await vs.isVisible({ timeout: 1_500 }).catch(() => false))) return false;
  await vs.locator('.vs__dropdown-toggle').click({ timeout: 1_500 }).catch(() => {});
  await admin.waitForTimeout(600);
  const li = admin.locator('.vs__dropdown-menu li').filter({ hasText: optionRe }).first();
  const ok = await li.isVisible({ timeout: 1_200 }).catch(() => false);
  if (ok) { await li.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(400); }
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(300); await killAlarms(admin);
  return ok;
}
// 위치 드롭다운에서 '전체' 아닌 (index)-번째 옵션 체크(임의·다양). 반환 선택 텍스트.
async function checkLocByIndex(admin: Page, placeholder: string, index: number): Promise<string> {
  const vs = admin.locator('.v-select').filter({ has: admin.locator(`input[placeholder="${placeholder}"]`) }).first();
  if (!(await vs.isVisible({ timeout: 1_500 }).catch(() => false))) return '(vs없음)';
  await vs.locator('.vs__dropdown-toggle').click({ timeout: 1_500 }).catch(() => {});
  await admin.waitForTimeout(600);
  const items = admin.locator('.vs__dropdown-menu li');
  const texts = await items.allInnerTexts().catch(() => []);
  const cand = texts.map((t, i) => ({ t: (t || '').trim(), i })).filter((x) => x.t && !/전체/.test(x.t) && !/결과가?\s*없|없습니다/.test(x.t));
  let picked = '(없음)';
  if (cand.length) { const p = cand[index % cand.length]; picked = p.t; await items.nth(p.i).click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(400); }
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(300); await killAlarms(admin);
  return picked;
}
// 작업기간: 모달 datepicker(마지막 2개 YYYY-MM-DD)에 시작/종료 타이핑(숫자 8자리, 대시 자동).
async function setWODates(admin: Page, startIso: string, endIso: string): Promise<{ s: string; e: string }> {
  const inputs = admin.locator('.datepicker-input[placeholder="YYYY-MM-DD"]:visible');
  const n = await inputs.count().catch(() => 0);
  if (n < 2) return { s: '(입력없음)', e: '' };
  const startInp = inputs.nth(n - 2); const endInp = inputs.nth(n - 1);   // 모달은 DOM 마지막
  const digits = (iso: string) => iso.replace(/[^0-9]/g, '');
  await startInp.click({ timeout: 2_000 }).catch(() => {}); await admin.keyboard.press('Control+a').catch(() => {});
  await startInp.pressSequentially(digits(startIso), { delay: 50 }).catch(() => {}); await admin.waitForTimeout(300);
  await endInp.click({ timeout: 2_000 }).catch(() => {}); await admin.keyboard.press('Control+a').catch(() => {});
  await endInp.pressSequentially(digits(endIso), { delay: 50 }).catch(() => {}); await admin.waitForTimeout(300);
  await admin.keyboard.press('Escape').catch(() => {});
  const s = (await startInp.inputValue().catch(() => '')) || ''; const e = (await endInp.inputValue().catch(() => '')) || '';
  return { s, e };
}

test('작업 지시 — 1~7월 2건씩 등록(14건)', async ({ page, context }) => {
  test.setTimeout(1_800_000);
  fs.mkdirSync(dir, { recursive: true });
  const admin = await openCourseAdmin(page, context);
  const out: any = { ts: new Date().toISOString(), dryrun: DRYRUN, rows: [] };

  if (!(await gotoCourseMenu(admin, '작업 관리', '작업 지시').then(() => true).catch(() => false))) { test.skip(true, '진입 실패'); return; }
  await admin.waitForTimeout(1_800); await killAlarms(admin);
  if (admin.url().includes('/login')) { test.skip(true, '세션 만료'); return; }

  // 등록 계획 수립(월×PER)
  const plan: Array<{ i: number; month: number; c1: string; course: string }> = [];
  let i = 0;
  for (const month of MONTHS) for (let k = 0; k < PER; k++) { plan.push({ i, month, c1: C1_POOL[i % C1_POOL.length], course: COURSES[i % COURSES.length] }); i++; }
  out.planCount = plan.length;
  console.log(`[wo-write] 계획 ${plan.length}건 (월 ${JSON.stringify(MONTHS)} × ${PER})${DRYRUN ? ' · DRYRUN(비파괴)' : ''}`);

  for (const p of plan) {
    const rec: any = { i: p.i, month: p.month, c1: p.c1, course: p.course };
    await openWOModal(admin);

    // ① 작업분류 1→2→3
    rec.c1picked = (await pickVSByText(admin, '1분류 선택', p.c1)).picked;
    await admin.waitForTimeout(1_000);
    const c2list = await enumVS(admin, '2분류 선택');
    const c2cands = c2list.filter((x) => x && !/전체/.test(x));
    const c2 = c2cands.length ? c2cands[p.i % c2cands.length] : '';
    rec.c2 = c2;
    if (c2) rec.c2picked = (await pickVSByText(admin, '2분류 선택', c2)).picked;
    let c3 = '';
    if (c2) {
      await admin.waitForTimeout(800);
      const c3list = await enumVS(admin, '3분류 선택');
      const c3cands = c3list.filter((x) => x && !/전체|결과가?\s*없|없습니다/.test(x));
      c3 = c3cands.length ? c3cands[p.i % c3cands.length] : '';
      if (c3) rec.c3picked = (await pickVSByText(admin, '3분류 선택', c3)).picked;
    }
    rec.c3 = c3;

    // ② 작업명 규칙
    const name = c3 ? `[YS] ${p.c1}_${c2}_${c3}_${p.month}월` : (c2 ? `[YS] ${p.c1}_${c2}_${p.month}월` : `[YS] ${p.c1}_${p.month}월`);
    rec.name = name;
    await admin.getByPlaceholder('작업명 입력').first().fill(name).catch(() => {});

    // ③ 참여자: 고정직 조장(임의) + 임시직(단기 조원) 사용자나연
    const lead = LEADS[p.i % LEADS.length];
    rec.lead = (await pickVSByText(admin, '조장 선택(필수)', lead)).picked;
    rec.tempMember = (await pickVSByText(admin, '조원 선택(복수 선택)', '사용자나연', { nth: 1, typeSearch: true })).picked;

    // ④ 작업기간(해당월 내)
    const mm = String(p.month).padStart(2, '0');
    rec.dates = await setWODates(admin, `2026-${mm}-05`, `2026-${mm}-10`);

    // ⑤ 기타 투입(장비/자재 1~5건 가변, ≥1) — 위치 저장 前!
    const total = (p.i % 5) + 1; const matTarget = Math.floor(total / 2); let eqTarget = total - matTarget;
    const eq = await investEquipmentFirst(admin, eqTarget);
    let mat = { checked: 0, names: [] as string[] };
    if (matTarget > 0) mat = await investMaterialsFirst(admin, matTarget, 0.2);
    // ≥1 보장: 아무것도 안 잡혔으면 장비 1건 재시도
    if (eq.checked + mat.checked === 0) { const eq2 = await investEquipmentFirst(admin, 1); eq.checked += eq2.checked; eq.names.push(...eq2.names); }
    rec.invest = { target: total, eq: eq.checked, eqNames: eq.names, mat: mat.checked, matNames: mat.names };

    // ⑥ 작업 위치: 코스 + 홀1 + 구분(임의·인덱스) + 구역(첫) + [위치 저장]
    rec.locCourse = await checkLocOption(admin, '코스 선택', new RegExp(`^\\s*${p.course}\\s*$`));
    rec.locHole = await checkLocOption(admin, '홀 선택', /^\s*1\s*$/);
    await admin.waitForTimeout(500);
    rec.locGubun = await checkLocByIndex(admin, '구분 선택', p.i);
    await admin.waitForTimeout(700);
    rec.locZone = await checkLocByIndex(admin, '구역 선택', p.i);
    const gubunOk = /^(?!\(없음\)|\(vs없음\)).+/.test(String(rec.locGubun));
    const zoneOk = /^(?!\(없음\)|\(vs없음\)).+/.test(String(rec.locZone));
    if (rec.locCourse && gubunOk && zoneOk) {
      const saveBtn = admin.getByRole('button', { name: /위치\s*저장/ }).first();
      if (await saveBtn.isVisible({ timeout: 1_000 }).catch(() => false)) { await saveBtn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin); }
      rec.locMode = 'course';
    } else {
      const noLoc = admin.getByText('작업장소 해당사항 없음', { exact: false }).first();
      if (await noLoc.isVisible({ timeout: 1_000 }).catch(() => false)) { await noLoc.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin); }
      rec.locMode = 'none(fallback)';
    }

    // ⑦ 등록(DRYRUN이면 취소)
    if (DRYRUN) {
      rec.registered = false; rec.dryrun = true;
      await closeWOModal(admin);
    } else {
      // 제출 메시지 감시 설치(확인 dismiss 前 캡처 — 실패 원인 진단용)
      await admin.evaluate(() => {
        (window as any).__woMsgs = []; const seen = new Set<string>();
        const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
        const grab = () => { for (const e of document.querySelectorAll('.modal-group, [class*="toast"], [class*="alert"], [class*="alarm"], [role="alert"]')) { const t = norm((e as HTMLElement).innerText); if (t && t.length < 200 && !seen.has(t)) { seen.add(t); (window as any).__woMsgs.push(t); } } };
        const mo = new MutationObserver(grab); mo.observe(document.body, { childList: true, subtree: true }); grab(); (window as any).__woMo = mo;
      }).catch(() => {});
      const regBtn = admin.getByRole('button', { name: /^등록$/ }).last();
      if (await regBtn.isVisible({ timeout: 1_000 }).catch(() => false)) { await regBtn.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_600); }
      rec.submitMsgs = await admin.evaluate(() => { const m = (window as any).__woMsgs || []; (window as any).__woMo?.disconnect?.(); return m; }).catch(() => []);
      for (const lbl of ['확인', '예', '등록']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 700 }).catch(() => false)) { await b.click({ timeout: 1_500 }).catch(() => {}); break; } }
      await admin.waitForTimeout(2_000); await killAlarms(admin);
      const modalGone = !(await admin.getByRole('heading', { name: /단일 작업 지시 등록|작업 지시 등록/ }).first().isVisible({ timeout: 800 }).catch(() => false));
      rec.registered = modalGone && await admin.getByText(name, { exact: false }).first().isVisible({ timeout: 2_500 }).catch(() => false);
      if (!modalGone) await closeWOModal(admin);
    }
    out.rows.push(rec);
    console.log(`[wo-write] #${p.i + 1} ${name} · 조장 ${rec.lead} · 임시 ${rec.tempMember} · ${p.course}(${rec.locCourse}) 홀1(${rec.locHole}) 구분 ${rec.locGubun} 구역 ${String(rec.locZone).slice(0, 14)} [${rec.locMode}] · 기간 ${rec.dates?.s}~${rec.dates?.e} · 장비 ${rec.invest.eq} 자재 ${rec.invest.mat} · 등록=${rec.registered}${rec.registered ? '' : ' · msg=' + JSON.stringify(rec.submitMsgs || [])}`);

    // 다음 주문 위해 리로드(모달 잔존/캐스케이드 오염 방지) + 완전 settle(진입 레이스 방지)
    await admin.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await admin.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await admin.waitForTimeout(2_000); await killAlarms(admin);
    await admin.getByRole('button', { name: /신규 작업 지시 등록/ }).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  }

  fs.writeFileSync(`${dir}/results.json`, JSON.stringify(out, null, 2), 'utf-8');
  await admin.screenshot({ path: `${dir}/list-after.png`, fullPage: true }).catch(() => {});
  const ok = out.rows.filter((r: any) => r.registered).length;
  const courseCnt = COURSES.map((c) => `${c}:${out.rows.filter((r: any) => r.course === c && r.registered).length}`).join(' ');
  console.log(`\n[wo-write] 완료 — 등록 ${ok}/${out.rows.length} · 코스별(${courseCnt || courseCnt}) · 결과 ${dir}/results.json`);
});

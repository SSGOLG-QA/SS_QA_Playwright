import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { pickVSByText, investEquipmentWithTime, investMaterials } from '../lib/course/workorderHelpers';
import * as fs from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 파괴적(작업 지시 등록). 1분류당 첫 2분류 1건씩(~13건). 3분류 없음 → 2단계 트리.
//   실행: npm run course:auth (course-mng-td 탭 닫고) → npm run course:workorder-bytype
//   작업명: [YS] {1분류}_{2분류}_0826  (2분류 없으면 [YS] {1분류}_0826)
//   고정직 조장: 전영신_마스터1/강나연 임의 · 단기 조원: 사용자나연 · 작업기간 2026-08-26~09-30
//   작업 위치: 코스 round-robin(West/South/East)+홀 1+구분(첫)+구역(첫)+[위치 저장] · 기타: 장비2+자재1(≥1)
//   ⚠ 모달 필드는 고유 placeholder(선택)로 타겟(리스트 필터는 '전체'). 날짜는 모달=마지막 2개 YYYY-MM-DD.
//   env: WO_ONLY="그린,티박스"(특정 1분류만) · WO_LIMIT=N(앞 N개만).
// ─────────────────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1536, height: 950 } });
const dir = 'reports/_workorder-bytype';
const LEADS = ['전영신_마스터1', '강나연'];
const COURSES = ['West', 'South', 'East'];
// 기타 투입(장비/자재) — 실존 자산명(2026-08-26 등록분). env로 재정의 가능.
const EQUIP_NAMES = (process.env.WO_EQUIP || '[YS] 장비_Test001,[YS] 장비_Test002').split(',').map((s) => s.trim()).filter(Boolean);
const MATERIAL_NAMES = (process.env.WO_MATERIAL || '[YS] 농약_001').split(',').map((s) => s.trim()).filter(Boolean);
const WO_ONLY = process.env.WO_ONLY ? new Set(process.env.WO_ONLY.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const WO_LIMIT = process.env.WO_LIMIT ? Number(process.env.WO_LIMIT) : 0;

async function openWOModal(admin: Page) {
  await admin.getByRole('button', { name: /신규 작업 지시 등록/ }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_500); await killAlarms(admin);
}
async function closeWOModal(admin: Page) {
  for (const lbl of ['취소', '닫기']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 600 }).catch(() => false)) { await b.click().catch(() => {}); break; } }
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin);
}
// 모달 v-select(placeholder) 열어 옵션 텍스트 열거(선택 안 함).
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
// 체크박스형 위치 드롭다운: placeholder로 열어 optionRe(정확) 체크 후 닫기.
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
// 위치 드롭다운에서 '전체' 아닌 첫 옵션 체크. 반환 선택 텍스트.
async function checkLocFirst(admin: Page, placeholder: string): Promise<string> {
  const vs = admin.locator('.v-select').filter({ has: admin.locator(`input[placeholder="${placeholder}"]`) }).first();
  if (!(await vs.isVisible({ timeout: 1_500 }).catch(() => false))) return '(vs없음)';
  await vs.locator('.vs__dropdown-toggle').click({ timeout: 1_500 }).catch(() => {});
  await admin.waitForTimeout(600);
  const items = admin.locator('.vs__dropdown-menu li');
  const texts = await items.allInnerTexts().catch(() => []);
  let picked = '(없음)';
  for (let i = 0; i < texts.length; i++) {
    const t = (texts[i] || '').trim();
    if (!t || /전체/.test(t)) continue;
    picked = t; await items.nth(i).click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(400); break;
  }
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(300); await killAlarms(admin);
  return picked;
}
// 작업기간: 모달 datepicker(마지막 2개 YYYY-MM-DD)에 시작/종료 입력(숫자 8자리 타이핑, 대시 자동).
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

test('작업 지시 — 1분류당 2분류 1건씩 등록', async ({ page, context }) => {
  test.setTimeout(1_400_000);
  fs.mkdirSync(dir, { recursive: true });
  const admin = await openCourseAdmin(page, context);
  const out: any = { ts: new Date().toISOString(), rows: [] };

  if (!(await gotoCourseMenu(admin, '작업 관리', '작업 지시').then(() => true).catch(() => false))) { test.skip(true, '진입 실패'); return; }
  await admin.waitForTimeout(1_800); await killAlarms(admin);
  if (admin.url().includes('/login')) { test.skip(true, '세션 만료'); return; }

  // 1분류 목록 열거(첫 모달)
  await openWOModal(admin);
  let c1list = await enumVS(admin, '1분류 선택');
  await closeWOModal(admin);
  if (WO_ONLY) c1list = c1list.filter((c) => WO_ONLY.has(c));
  if (WO_LIMIT > 0) c1list = c1list.slice(0, WO_LIMIT);
  out.c1list = c1list;
  console.log(`[wo] 대상 1분류 ${c1list.length}종: ${JSON.stringify(c1list)}`);

  let idx = 0;
  for (const c1 of c1list) {
    idx++;
    const rec: any = { idx, c1 };
    await openWOModal(admin);
    // 작업분류 1분류 → 2분류(첫)
    rec.c1picked = (await pickVSByText(admin, '1분류 선택', c1)).picked;
    await admin.waitForTimeout(1_000);   // 2분류 캐스케이드 재로딩 대기
    const c2list = await enumVS(admin, '2분류 선택');
    const c2 = c2list.find((x) => x && !/전체/.test(x)) || '';
    rec.c2 = c2;
    if (c2) rec.c2picked = (await pickVSByText(admin, '2분류 선택', c2)).picked;
    // 3분류 — 있으면 선택(필수인 경우 미선택 시 등록 실패). "결과가 없습니다" 는 옵션 없음.
    let c3 = '';
    if (c2) {
      await admin.waitForTimeout(800);
      const c3list = await enumVS(admin, '3분류 선택');
      c3 = c3list.find((x) => x && !/전체|결과가?\s*없|없습니다/.test(x)) || '';
      if (c3) rec.c3picked = (await pickVSByText(admin, '3분류 선택', c3)).picked;
    }
    rec.c3 = c3;
    const name = c3 ? `[YS] ${c1}_${c2}_${c3}_0826` : (c2 ? `[YS] ${c1}_${c2}_0826` : `[YS] ${c1}_0826`);
    rec.name = name;
    await admin.getByPlaceholder('작업명 입력').first().fill(name).catch(() => {});
    // 참여자: 고정직 조장(임의) + 단기 조원 사용자나연
    const lead = LEADS[idx % LEADS.length];
    rec.lead = (await pickVSByText(admin, '조장 선택(필수)', lead)).picked;
    rec.tempMember = (await pickVSByText(admin, '조원 선택(복수 선택)', '사용자나연', { nth: 1, typeSearch: true })).picked;
    // 작업기간
    rec.dates = await setWODates(admin, '2026-08-26', '2026-09-30');
    // 기타(장비/자재) — ⚠ 위치 저장 전에! (위치 저장이 셰브론 nth를 밀어 카드 매핑 깨짐) · 검증된 by-name 헬퍼 사용
    // ⚠ 장비는 2026-09 신규 필수 '투입시간'(전체작업시간) 설정 포함(미설정 시 picker 등록 막힘)
    const eqRes = await investEquipmentWithTime(admin, EQUIP_NAMES);
    rec.equip = eqRes.sel; rec.timeDiag = eqRes.timeDiag;
    rec.material = await investMaterials(admin, MATERIAL_NAMES, 0.2);
    // 작업 위치: 코스 round-robin + 홀1 + 구분(첫) + 구역(첫) + 위치저장
    const course = COURSES[(idx - 1) % COURSES.length]; rec.course = course;
    rec.locCourse = await checkLocOption(admin, '코스 선택', new RegExp(`^\\s*${course}\\s*$`));
    rec.locHole = await checkLocOption(admin, '홀 선택', /^\s*1\s*$/);
    rec.locGubun = await checkLocFirst(admin, '구분 선택');
    await admin.waitForTimeout(700);   // 구역 로딩 대기
    rec.locZone = await checkLocFirst(admin, '구역 선택');
    // 구분/구역 옵션이 없는 1분류(장비/기타 등)는 코스/홀만으론 위치 미완 → "작업장소 해당사항 없음"으로 우회.
    const locOk = rec.locCourse && /^(?!\(없음\)|\(vs없음\)).+/.test(String(rec.locGubun)) && /^(?!\(없음\)|\(vs없음\)).+/.test(String(rec.locZone));
    if (locOk) {
      const saveBtn = admin.getByRole('button', { name: /위치\s*저장/ }).first();
      if (await saveBtn.isVisible({ timeout: 1_000 }).catch(() => false)) { await saveBtn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin); }
      rec.locMode = 'course';
    } else {
      const noLoc = admin.getByText('작업장소 해당사항 없음', { exact: false }).first();
      if (await noLoc.isVisible({ timeout: 1_000 }).catch(() => false)) { await noLoc.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin); }
      rec.locMode = 'none(fallback)';
    }
    // 최종 등록
    const regBtn = admin.getByRole('button', { name: /^등록$/ }).last();
    if (await regBtn.isVisible({ timeout: 1_000 }).catch(() => false)) { await regBtn.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_800); await killAlarms(admin); }
    for (const lbl of ['확인', '예', '등록']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 700 }).catch(() => false)) { await b.click({ timeout: 1_500 }).catch(() => {}); break; } }
    await admin.waitForTimeout(2_000); await killAlarms(admin);
    // 등록 판정: 모달 사라짐 + 리스트에 작업명
    const modalGone = !(await admin.getByRole('heading', { name: /단일 작업 지시 등록/ }).first().isVisible({ timeout: 800 }).catch(() => false));
    rec.registered = modalGone && await admin.getByText(name, { exact: false }).first().isVisible({ timeout: 2_500 }).catch(() => false);
    if (!modalGone) await closeWOModal(admin);   // 실패 시 모달 정리
    out.rows.push(rec);
    const eqN = rec.equip?.selected?.filter((s: any) => s.found && s.after).length ?? 0;
    const matN = (rec.material || []).reduce((a: number, m: any) => a + (m.sel?.selected?.filter((s: any) => s.found && s.after).length ?? 0), 0);
    rec.eqN = eqN; rec.matN = matN;
    console.log(`[wo] ${name} · 조장 ${rec.lead} · 코스 ${course}(${rec.locCourse}) 홀1(${rec.locHole}) 구분 ${rec.locGubun} 구역 ${String(rec.locZone).slice(0, 12)} · 기간 ${rec.dates?.s}~${rec.dates?.e} · 장비 ${eqN} 자재 ${matN} · 등록=${rec.registered}`);
    // 다음 WO를 위해 페이지 리로드로 상태 초기화(모달 잔존/캐스케이드 오염 방지)
    await admin.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await admin.waitForTimeout(2_000); await killAlarms(admin);
  }

  fs.writeFileSync(`${dir}/results.json`, JSON.stringify(out, null, 2), 'utf-8');
  await admin.screenshot({ path: `${dir}/list-after.png`, fullPage: true }).catch(() => {});
  const ok = out.rows.filter((r: any) => r.registered).length;
  console.log(`\n[wo] 완료 — ${ok}/${out.rows.length} 등록 · 결과 ${dir}/results.json`);
});

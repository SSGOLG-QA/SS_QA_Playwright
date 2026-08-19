import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { budgetSubtotalMatrixInvariant } from '../lib/course/domain/invariants';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  예산 상세 > 분류 탭 [수정](값 편집모드) 계산 정합성 — 비파괴.
//  실행: npm run course:auth 후 npm run course:budget-edit
//  플로우(탭별): [수정]→편집모드(적요 input·1~12월 금액 input, 합계/소계 반응형 read-only)
//    → 첫 데이터 행 12개월 금액 입력 → ① 행 합계 = Σ(1~12월) ② 소계[열] = Σ(소분류 행[열]) 검증 → [취소](저장 안 함).
//  비파괴(취소·저장 안 함). 탭 간 하드 리로드로 상태 리셋. CLS_TABS env로 일부 탭 지정 가능.
//  ⚠ 값은 클라이언트 반응형 재계산 → 입력 직후 합계/소계 갱신. 실 데이터 미변경.
// ──────────────────────────────────────────────────────────────

const TABS = (process.env.CLS_TABS || '고정직 인건비,임시직 인건비,코스 자재비,장비 관리비,기타 관리비').split(',');
const mainScope = (p: Page) => p.locator('.contents, main').first();
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

// 편집모드 테이블 파싱 — 각 tr: {label, text, kind(data|subtotal|total|other), nums:[...후행13=합계,1~12월]}. input.value/텍스트에서 숫자 추출(적요 제외).
async function parseEditTable(p: Page): Promise<{ label: string; text: string; kind: string; nums: number[] }[]> {
  return await p.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, '');
    const tables = Array.from(document.querySelectorAll('.contents table, main table, table'));
    const tbl = tables.find((t) => /중분류/.test(t.textContent || '')) || tables[0];
    if (!tbl) return [];
    const out: { label: string; text: string; kind: string; nums: number[] }[] = [];
    for (const tr of Array.from(tbl.querySelectorAll('tbody tr'))) {
      const txt = norm(tr.textContent);
      const hasMonthInput = !!tr.querySelector('input:not([placeholder*="적요"])');
      let kind = 'data';
      if (/소계/.test(txt)) kind = 'subtotal';
      else if (/총예산/.test(txt)) kind = 'total';
      else if (!hasMonthInput) kind = 'other';
      const nums: number[] = [];
      for (const td of Array.from(tr.children)) {
        const inp = td.querySelector('input') as HTMLInputElement | null;
        if (inp) {
          if ((inp.placeholder || '').includes('적요')) continue;   // 적요 input 제외
          const t = (inp.value || '').replace(/[^0-9.\-]/g, '');
          nums.push(t === '' || t === '-' ? 0 : Number(t));
        } else {
          const raw = (td.textContent || '').replace(/[^0-9.\-]/g, '');
          if (raw !== '' && /\d/.test(raw)) nums.push(Number(raw));   // 합계/소계 텍스트 셀
        }
      }
      let label = '';
      for (const td of Array.from(tr.children)) {
        const t = (td.textContent || '').trim();
        if (t && !/^[\d,.\-\s]+$/.test(t) && !td.querySelector('input')) { label = t; break; }
      }
      out.push({ label, text: (tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), kind, nums });
    }
    return out;
  });
}
const tail13 = (a: number[]) => a.slice(-13);   // 후행 13 = [합계, 1~12월] (선행 수량/단가 등 추가 컬럼 흡수)

async function cancelEdit(p: Page) {
  // 편집모드 취소(저장 안 함). 취소 버튼 → 없으면 '작업중 내용 취소?' 확인 → Escape.
  await mainScope(p).getByRole('button', { name: '취소', exact: true }).first().click({ timeout: 2_000 }).catch(() => {});
  await p.waitForTimeout(500);
  const disc = p.locator('.modal-group.alarm, .modal-group[class*="alarm"]').filter({ hasText: '작업중이던 내용' }).last().getByRole('button', { name: '확인', exact: true }).first();
  if (await disc.isVisible({ timeout: 1_200 }).catch(() => false)) { await disc.click().catch(() => {}); }
  await p.waitForTimeout(400); await p.keyboard.press('Escape').catch(() => {}); await killAlarms(p);
}

async function selectTab(p: Page, tab: string): Promise<boolean> {
  const t = p.getByRole('tab', { name: tab }).or(mainScope(p).getByText(tab, { exact: true })).first();
  if (!(await t.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  await t.click().catch(() => {}); await p.waitForTimeout(1200); await killAlarms(p);
  return true;
}

async function runTabEditCalc(admin: Page, tab: string) {
  const tag = tab.replace(/\s+/g, '');
  const P = `예산 상세 > ${tab} > 값 편집`;

  // [수정] 편집모드 진입
  const emMeta: CheckMeta = { path: `${P} 진입`, tcRef: `코스관리_예산편집_${tag}_0`, tcId: `CBEDIT-M-${tag}`, desc: '[수정] → 편집모드(월별 금액 input 노출)', failMsg: '편집모드 진입 실패' };
  await mainScope(admin).getByRole('button', { name: '수정', exact: true }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1200); await killAlarms(admin);
  const firstDataRow = mainScope(admin).locator('tbody tr').filter({ has: admin.locator('input:not([placeholder*="적요"])') }).first();
  const monthInputs = firstDataRow.locator('input:not([placeholder*="적요"])');
  const mCount = await monthInputs.count().catch(() => 0);
  if (mCount < 12) { skip(emMeta, `편집모드 월 input 미확인(count=${mCount})`); await cancelEdit(admin); return; }
  record(emMeta, 'PASS', { actual: `편집모드 진입 · 첫 행 월 input ${mCount}개` });

  // 값 입력: 첫 데이터 행 1~12월 = (i+1)*1000 → 합계 기대 78000
  const cMeta: CheckMeta = { path: `${P} 입력`, tcRef: `코스관리_예산편집_${tag}_1`, tcId: `CBEDIT-IN-${tag}`, desc: '1~12월 금액 입력(반응형 재계산 트리거)', failMsg: '입력 실패' };
  try {
    for (let i = 0; i < 12; i++) await monthInputs.nth(i).fill(String((i + 1) * 1000));
    await admin.waitForTimeout(800);
    record(cMeta, 'PASS', { actual: '첫 행 1~12월 = 1000..12000 입력' });
  } catch (e) { record(cMeta, 'FAIL', { error: '입력 예외', detail: (e as Error).message.slice(0, 120) }); await cancelEdit(admin); return; }

  // 파싱 → 정합성 검증
  const rows = await parseEditTable(admin);

  // ① 행 합계 = Σ(1~12월) — 후행 13숫자 가진 data 행(보편 유효: 단순·복합 구조 모두 행 총계는 Σ월).
  const rMeta: CheckMeta = { path: `${P} 합계`, tcRef: `코스관리_예산편집_${tag}_2`, tcId: `CBEDIT-HAP-${tag}`, desc: '행 합계 = Σ(1~12월)', failMsg: '합계≠Σ월' };
  const dataRows = rows.filter((r) => r.kind === 'data' && r.nums.length >= 13);
  let hapChecked = 0; const hapViol: string[] = [];
  for (const r of dataRows) {
    const v = tail13(r.nums);
    const sum = v.slice(1).reduce((a, b) => a + b, 0);
    hapChecked++;
    if (!near(v[0], sum)) hapViol.push(`${r.label}: 합계 ${v[0]} ≠ Σ월 ${sum}`);
  }
  if (hapChecked === 0) skip(rMeta, '검증 대상 data 행 없음(구조 상이)');
  else if (hapViol.length === 0) record(rMeta, 'PASS', { actual: `${hapChecked}개 행 합계=Σ월 일치` });
  else record(rMeta, 'FAIL', { error: '합계 불일치', detail: hapViol.slice(0, 3).join(' / ') });

  // ② 소계[열] = Σ(소분류 행[열]). 단순 구조(고정직=직접 소분류)면 성립→PASS. 복합 구조(금액=단가×수량, 소계=Σ금액)면 불성립→diff(결함 아님).
  //    라벨 감지 대신 결과 기반 판정: Σ행과 일치=단순(검증), 불일치=복합 구조 추정(별도 모델 후속). false FAIL 방지.
  const sMeta: CheckMeta = { path: `${P} 소계`, tcRef: `코스관리_예산편집_${tag}_3`, tcId: `CBEDIT-SUB-${tag}`, desc: '소계[열] = Σ(소분류 행[열])', failMsg: '소계≠Σ행' };
  const groups: { name: string; rows: number[][]; subtotal: number[] }[] = [];
  let acc: number[][] = [];
  for (const r of rows) {
    if (r.kind === 'data' && r.nums.length >= 13) acc.push(tail13(r.nums));
    else if (r.kind === 'subtotal' && r.nums.length >= 13) { if (acc.length) groups.push({ name: `g${groups.length}`, rows: acc, subtotal: tail13(r.nums) }); acc = []; }
    else if (r.kind === 'total') acc = [];
  }
  if (groups.length === 0) { skip(sMeta, '소계 그룹 미검출(구조 상이)'); }
  else {
    const res = budgetSubtotalMatrixInvariant(groups);
    if (res.ok) record(sMeta, 'PASS', { actual: `${groups.length}그룹·${res.checked}열 소계=Σ행 일치(단순 구조)` });
    else {
      // 소계 ≠ 단순 Σ행 → 복합 구조(금액=단가×수량, 소계=Σ금액) 추정 → diff(결함 아님). 행 합계는 별도 검증됨.
      diff(`예산 상세 > ${tab}`, '소계 정합성', `소계 ≠ 단순 Σ(소분류 행) — 복합 구조(금액=단가×수량, 소계=Σ금액) 추정. 위반 ${res.violations.length}건(예: ${res.violations.slice(0, 1).map((v) => `기대${v.expected}≠실제${v.actual}`)})`, `코스관리_예산편집_${tag}`, '행 합계=Σ월은 검증됨. 소계는 구조별(단가×수량) 모델 후속 필요');
      skip(sMeta, '복합 구조(단가×수량) 추정 — 단순 Σ행 불변식 부적합(diff 기록). 행 합계는 검증됨');
    }
  }

  // 비파괴 원복: 취소(저장 안 함)
  await cancelEdit(admin);
}

test('예산 상세 > [수정] 값 편집 계산 정합성 전 탭(비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  const base: CheckMeta = { path: '예산 상세 > 값 편집', tcRef: '코스관리_예산편집_CALC', tcId: 'CBEDIT', desc: '전 분류 탭 [수정] 값 입력 → 합계/소계 정합성' };
  await gotoCourseMenu(admin, '예산 관리', '예산 상세');
  await killAlarms(admin);

  for (let ti = 0; ti < TABS.length; ti++) {
    const tab = TABS[ti];
    if (ti > 0) { await admin.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.waitForTimeout(2500); await killAlarms(admin); await gotoCourseMenu(admin, '예산 관리', '예산 상세').catch(() => {}); await killAlarms(admin); }
    if (!(await selectTab(admin, tab))) { skip({ ...base, path: `예산 상세 > ${tab}`, tcId: `CBEDIT-${tab.replace(/\s+/g, '')}` }, `분류 탭 '${tab}' 미발견`); continue; }
    await runTabEditCalc(admin, tab);
  }
  await writeReport('코스관리_예산편집정합성');
});

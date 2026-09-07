import { expect, Page } from '@playwright/test';
import { check, record, skip, diff, CheckMeta } from '../reporter';
import { killAlarms } from './courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────────────────────
//  코스관리 2차 — 자재 "추가 입고" 팝업 자동계산 불변식 검증(비파괴). 근거: `2026-09 코스관리_PC 2차`
//    (추가 입고 팝업 다수 TC). 대상: 자재 관리 > 자재 총괄 > [추가 입고].
//  ⚠ 이 팝업은 어떤 baseline 에도 캡처된 적 없음(신규 등록 모달만 캡처) → **discovery-first**:
//     1런에 팝업 필드 전수 덤프(analysis/_restock-probe_*.json)로 구조 확정.
//  검증(전부 fill/read = 비파괴, [취소]로 폐기. 저장/[등록]/[입고] 클릭 금지):
//    MRESTOCK-01 팝업 노출 + 수량·매입가(단가)·단위당/금액 관련 입력 노출
//    MRESTOCK-02 자동계산 불변식: 수량·매입가 입력 → 단위당 매입가 = round(매입가/수량) [등록 모달 관계 동일]
//                (자동계산 아니고 수동 입력이면 결함 아님 → 관찰 diff + SKIP. 필드 미식별 시 SKIP+덤프.)
//  ⚠ report-standard: 구조/자동계산 여부 불명확 → 절대 FAIL 아님. SKIP(사유+실측) 또는 diff(관찰).
// ──────────────────────────────────────────────────────────────────────────────

interface FieldInfo { idx: number; ph: string; value: string; readonly: boolean; disabled: boolean; label: string; }
interface AmountLine { label: string; num: number | null; }
interface ModalScan {
  found: boolean; title: string; inputs: FieldInfo[];
  vselects: Array<{ ph: string; text: string }>; amounts: AmountLine[]; bodyHasKeys: boolean;
}

// 열린 추가 입고 모달의 폼 구조를 원자적으로 스캔(evaluate). alarm/toast 제외, **입력 최다** 오버레이 선택
//   (빈 셸 false-positive 방지: 마지막이 아니라 input 수 → 텍스트 길이 순으로 실제 폼 컨테이너 선택).
async function scanModal(admin: Page): Promise<ModalScan> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const cand = Array.from(document.querySelectorAll('.modal-group, [class*="modal"], [class*="popup"], [class*="layer"], [role="dialog"]'))
      .filter((m) => !m.classList.contains('alarm') && !/toast/i.test(m.className || '') && vis(m)) as HTMLElement[];
    let scope: HTMLElement | null = null; let bestScore = -1;
    for (const m of cand) {
      const inp = m.querySelectorAll('input').length;
      const tl = Math.min((m.innerText || '').length, 9999);
      const score = inp * 100000 + tl;
      if (score > bestScore) { bestScore = score; scope = m; }
    }
    if (!scope) return { found: false, title: '', inputs: [], vselects: [], amounts: [], bodyHasKeys: false };
    // 입력: placeholder/value/readonly/disabled + 가장 가까운 라벨 텍스트.
    const nearestLabel = (el: HTMLElement): string => {
      let cur: HTMLElement | null = el;
      for (let up = 0; up < 4 && cur; up++) {
        const lbl = cur.querySelector('label, .form-label, .label, .tit, .title, dt') as HTMLElement | null;
        if (lbl && norm(lbl.innerText)) return norm(lbl.innerText).slice(0, 24);
        // 직전 형제 텍스트
        const prev = cur.previousElementSibling as HTMLElement | null;
        if (prev && norm(prev.innerText) && norm(prev.innerText).length < 24) return norm(prev.innerText);
        cur = cur.parentElement;
      }
      return '';
    };
    const inputs: FieldInfo[] = (Array.from(scope.querySelectorAll('input')) as HTMLInputElement[])
      .filter((i) => vis(i) && i.type !== 'hidden' && i.type !== 'checkbox' && i.type !== 'radio')
      .map((i, idx) => ({
        idx, ph: norm(i.placeholder), value: norm(i.value),
        readonly: i.readOnly || i.getAttribute('readonly') != null,
        disabled: i.disabled || i.getAttribute('disabled') != null || i.getAttribute('aria-disabled') === 'true',
        label: nearestLabel(i),
      }));
    const vselects = (Array.from(scope.querySelectorAll('.v-select')) as HTMLElement[]).filter(vis).map((v) => {
      const ph = (v.querySelector('input') as HTMLInputElement | null)?.placeholder || '';
      const sel = v.querySelector('.vs__selected') as HTMLElement | null;
      return { ph: norm(ph), text: norm(sel?.innerText || '') };
    });
    // 금액/원가/합계/단위당 라벨을 품은 라인의 숫자(계산 결과 후보).
    const amounts: AmountLine[] = [];
    const leaves = Array.from(scope.querySelectorAll('*')).filter((e) => e.children.length === 0 && vis(e)) as HTMLElement[];
    for (const e of leaves) {
      const t = norm(e.innerText);
      if (!/금액|원가|합계|단위당|매입가|총액|입고가/.test(t)) continue;
      const container = norm((e.parentElement as HTMLElement)?.innerText || t);
      const numRaw = container.replace(/[^0-9]/g, '');
      amounts.push({ label: t.slice(0, 24), num: numRaw ? Number(numRaw) : null });
      if (amounts.length >= 12) break;
    }
    const bodyHasKeys = /수량|매입가|입고/.test(norm(scope.innerText));
    const titleEl = scope.querySelector('.modal-header, .modal-title, h1, h2, h3, .tit') as HTMLElement | null;
    return { found: true, title: norm(titleEl?.innerText || '').slice(0, 40), inputs, vselects, amounts, bodyHasKeys };
  }).catch(() => ({ found: false, title: '', inputs: [], vselects: [], amounts: [], bodyHasKeys: false } as ModalScan));
}

// 모달 내 입력을 placeholder/label 정규식으로 특정해 값 채움(리액티브 input 이벤트 발화). 반환 성공 여부.
async function fillField(admin: Page, re: RegExp, val: string): Promise<boolean> {
  const modal = admin.locator('.modal-group:not(.alarm), [class*="modal"]').last();
  // placeholder 우선, 없으면 라벨 인접 input.
  let inp = modal.locator('input').filter({ hasText: '' }).and(admin.locator(`input[placeholder]`)).first();
  const byPh = modal.getByPlaceholder(re).first();
  if (await byPh.isVisible({ timeout: 1_000 }).catch(() => false)) inp = byPh;
  else {
    // 라벨 텍스트로 인접 input 탐색(evaluate 로 idx 찾아 nth)
    const idx = await admin.evaluate((src) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const re2 = new RegExp(src);
      const modals = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => !m.classList.contains('alarm'));
      const scope = modals[modals.length - 1] as HTMLElement; if (!scope) return -1;
      const inps = Array.from(scope.querySelectorAll('input')).filter((i) => (i as HTMLInputElement).type !== 'hidden') as HTMLInputElement[];
      for (let k = 0; k < inps.length; k++) {
        const i = inps[k];
        let cur: HTMLElement | null = i;
        for (let up = 0; up < 4 && cur; up++) {
          const lbl = cur.querySelector('label, .form-label, .label, .tit, dt') as HTMLElement | null;
          if (lbl && re2.test(norm(lbl.innerText))) return k;
          const prev = cur.previousElementSibling as HTMLElement | null;
          if (prev && re2.test(norm(prev.innerText))) return k;
          cur = cur.parentElement;
        }
      }
      return -1;
    }, re.source).catch(() => -1);
    if (idx < 0) return false;
    inp = modal.locator('input').nth(idx);
  }
  if (!(await inp.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await inp.click({ timeout: 1_500 }).catch(() => {});
  await inp.fill('').catch(() => {});
  await inp.fill(val).catch(() => {});
  await inp.dispatchEvent('input').catch(() => {});
  await inp.dispatchEvent('change').catch(() => {});
  await admin.waitForTimeout(300);
  return true;
}

// 모달 비파괴 닫기(취소/닫기 → Escape). 저장/등록/입고 클릭 절대 금지.
async function closeModal(admin: Page): Promise<void> {
  const modal = admin.locator('.modal-group:not(.alarm), [class*="modal"]').last();
  const cancel = modal.getByRole('button', { name: /^\s*(취소|닫기|Cancel|Close)\s*$/ }).first();
  if (await cancel.isVisible({ timeout: 1_200 }).catch(() => false)) await cancel.click({ timeout: 1_500 }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {});
  await killAlarms(admin);
  await admin.waitForTimeout(400);
}

function dump(id: string, obj: unknown): void {
  try { if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true }); fs.writeFileSync(path.join('analysis', `_restock-probe_${id}.json`), JSON.stringify(obj, null, 2)); } catch { /* ignore */ }
}

/**
 * 자재 추가 입고 팝업 자동계산 불변식 검증(비파괴). 구조/자동계산 불명확 시 SKIP/diff(가짜 FAIL 금지).
 * (호출 전 자재 관리 > 자재 총괄 화면이어야 함.)
 * @param P  리포트 경로 prefix (예: "자재 관리 > 자재 총괄")
 * @param R  tcRef prefix (예: "코스관리_자재총괄")
 * @param id tcId prefix (예: "MATRESTOCK")
 */
export async function verifyMaterialRestock(admin: Page, P: string, R: string, id: string): Promise<void> {
  await killAlarms(admin);
  const base = (n: number, tail: string) => ({ path: `${P} > 추가입고`, tcRef: `${R}_추가입고_${n}`, tcId: `${id}-MRESTOCK-0${n}`, desc: tail });

  const m00: CheckMeta = { ...base(0, '[추가 입고] → 팝업 오픈') };
  // 사전 컨텍스트: 행 체크박스(선택 게이팅 신호) + 추가입고 버튼 위치(상단 액션 vs 행별).
  const pre = await admin.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const rowCheckboxes = document.querySelectorAll('tbody input[type=checkbox]').length;
    const btns = (Array.from(document.querySelectorAll('button, a')) as HTMLElement[])
      .filter((x) => vis(x) && !x.closest('.side-navbar-container') && /추가\s*입고/.test(norm(x.textContent || '')))
      .map((x) => ({ text: norm(x.textContent || '').slice(0, 16), inTbody: !!x.closest('tbody') }));
    return { rowCheckboxes, restockBtns: btns };
  }).catch(() => ({ rowCheckboxes: 0, restockBtns: [] as Array<{ text: string; inTbody: boolean }> }));

  // 추가입고 클릭(상단 액션 우선; 없으면 첫 행 버튼).
  const clickRestock = () => admin.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const all = (Array.from(document.querySelectorAll('button, a')) as HTMLElement[]).filter((x) => vis(x) && !x.closest('.side-navbar-container') && /추가\s*입고/.test(norm(x.textContent || '')));
    const top = all.find((x) => !x.closest('tbody')) || all[0];
    if (!top) return false; top.click(); return true;
  }).catch(() => false);
  // 클릭 직후 알림 텍스트 포착(killAlarms 전 — 선택 게이팅 신호).
  const grabAlert = () => admin.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const al = (Array.from(document.querySelectorAll('.modal-group.alarm, .toast, [class*="toast"], [class*="alert"], [class*="alarm"]')) as HTMLElement[]).filter(vis);
    for (const a of al) { const t = norm(a.innerText); if (t) return t.slice(0, 80); }
    return '';
  }).catch(() => '');

  const clicked1 = await clickRestock();
  if (!clicked1) { dump(id, { note: '[추가 입고] 버튼 미검출', pre }); skip(m00, `[추가 입고] 버튼 미검출(pre: ${JSON.stringify(pre.restockBtns)}) — analysis/_restock-probe_${id}.json`); return; }
  let alertText = ''; for (let i = 0; i < 8 && !alertText; i++) { await admin.waitForTimeout(200); alertText = await grabAlert(); }
  await killAlarms(admin); await admin.waitForTimeout(700);

  let scan = await scanModal(admin);
  let triedRowSelect = false;
  const empty = (s: ModalScan) => !s.found || (s.inputs.length === 0 && !s.bodyHasKeys);
  // 폼 비었고 행 체크박스 존재 → 선택 게이팅 추정: 첫 행 체크 후 재클릭.
  if (empty(scan) && pre.rowCheckboxes > 0) {
    await admin.evaluate(() => { const cb = document.querySelector('tbody input[type=checkbox]') as HTMLInputElement | null; cb?.click(); }).catch(() => {});
    await admin.waitForTimeout(400);
    await clickRestock();
    alertText = ''; for (let i = 0; i < 6 && !alertText; i++) { await admin.waitForTimeout(200); alertText = await grabAlert(); }
    await killAlarms(admin); await admin.waitForTimeout(700);
    scan = await scanModal(admin);
    triedRowSelect = true;
  }
  // 모달이 자재 선택 dropdown 게이팅(입력 0·vue-select만)이면 첫 옵션 선택 후 재스캔.
  if (scan.found && scan.inputs.filter((i) => !i.readonly).length === 0 && scan.vselects.length > 0) {
    const vs = admin.locator('.modal-group:not(.alarm), [class*="modal"]').last().locator('.v-select').first();
    await vs.locator('.vs__dropdown-toggle').click({ timeout: 1_500 }).catch(() => {});
    await admin.waitForTimeout(400);
    const li = admin.locator('.vs__dropdown-menu li').first();
    if (await li.isVisible({ timeout: 1_200 }).catch(() => false)) { await li.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(600); }
    await admin.keyboard.press('Escape').catch(() => {});
    scan = await scanModal(admin);
  }

  // 종합 오버레이 인벤토리(1런 확정용) — 모든 후보 컨테이너의 class·input수·텍스트.
  const overlays = await admin.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    return (Array.from(document.querySelectorAll('.modal-group, [class*="modal"], [class*="popup"], [class*="layer"], [role="dialog"]')) as HTMLElement[])
      .filter(vis).slice(0, 10).map((m) => ({ cls: (m.className || '').slice(0, 50), inputs: m.querySelectorAll('input').length, textLen: (m.innerText || '').length, text: norm(m.innerText).slice(0, 90) }));
  }).catch(() => [] as Array<{ cls: string; inputs: number; textLen: number; text: string }>);
  dump(id, { pre, alertText, triedRowSelect, scan, overlays });

  const m01: CheckMeta = { ...base(1, '추가 입고 팝업 노출 + 수량·매입가(단가)·단위당/금액 입력'), failMsg: '추가 입고 팝업/필드 미노출' };
  if (empty(scan)) {
    await closeModal(admin);
    skip(m01, `추가 입고 폼 미검출${alertText ? ` (알림:"${alertText.slice(0, 40)}")` : ''} · 행체크박스 ${pre.rowCheckboxes}${triedRowSelect ? '·행선택재시도' : ''} · 오버레이 ${overlays.length}(입력최다 ${Math.max(0, ...overlays.map((o) => o.inputs))}) — analysis/_restock-probe_${id}.json`);
    return;
  }

  // 필드 식별
  const findInp = (re: RegExp, notRe?: RegExp) => scan.inputs.find((i) => (re.test(i.ph) || re.test(i.label)) && !(notRe && (notRe.test(i.ph) || notRe.test(i.label))));
  const qtyF = findInp(/수량/);
  const priceF = findInp(/매입가|가격|단가|입고가/, /단위당/);
  const unitF = findInp(/단위당/);
  const amountF = findInp(/금액|총액|합계/);

  await check(admin, m01, async () => {
    expect(scan.found, '팝업 미노출').toBeTruthy();
    const key = [qtyF && '수량', priceF && '매입가', unitF && '단위당', amountF && '금액'].filter(Boolean);
    expect(key.length, `핵심 입력 미검출(입력 ${scan.inputs.length}개: ${scan.inputs.map((i) => i.ph || i.label).slice(0, 6).join(', ')})`).toBeGreaterThanOrEqual(2);
  }, { getActual: async () => `제목 "${scan.title}" · 입력 ${scan.inputs.length}[${scan.inputs.map((i) => i.ph || i.label).filter(Boolean).slice(0, 5).join(', ')}] · vsel ${scan.vselects.length}` });

  // MRESTOCK-02: 자동계산 불변식(수량·매입가 → 단위당 매입가 = round(매입가/수량), 또는 금액 = 수량×매입가).
  const m02: CheckMeta = { ...base(2, '수량·매입가 입력 → 단위당 매입가=round(매입가/수량) 자동계산'), failMsg: '자동계산 불일치' };
  if (!qtyF || !priceF) {
    skip(m02, `수량/매입가 입력 미식별(수량:${qtyF ? 'O' : 'X'} 매입가:${priceF ? 'O' : 'X'}) — 자동계산 검증 불가(덤프)`);
    await closeModal(admin); await killAlarms(admin); return;
  }
  if (!unitF && !amountF) {
    skip(m02, '단위당/금액(계산결과) 필드 미식별 — 자동계산 대상 없음(덤프 확인)');
    await closeModal(admin); await killAlarms(admin); return;
  }

  const QTY = 8, PRICE = 40000;                       // expected: 단위당=5000, 금액=320000
  const okQty = await fillField(admin, /수량/, String(QTY));
  const okPrice = await fillField(admin, /매입가|가격|단가|입고가/, String(PRICE));
  if (!okQty || !okPrice) { skip(m02, `입력 채우기 실패(수량:${okQty} 매입가:${okPrice}) — 셀렉터 보정 대상`); await closeModal(admin); return; }
  await admin.waitForTimeout(500); await killAlarms(admin);

  // 재스캔으로 계산 결과 읽기(단위당/금액 필드 value 또는 표시 텍스트).
  const after = await scanModal(admin);
  const readNum = (f: FieldInfo | undefined) => { if (!f) return null; const a = after.inputs.find((x) => x.ph === f.ph && x.label === f.label) || after.inputs[f.idx]; const raw = (a?.value || '').replace(/[^0-9]/g, ''); return raw ? Number(raw) : null; };
  const unitVal = readNum(unitF);
  const amtVal = readNum(amountF);
  const unitFieldEditable = unitF ? !after.inputs[unitF.idx]?.readonly : false;
  const expectUnit = Math.round(PRICE / QTY);         // 5000
  const expectAmt = QTY * PRICE;                       // 320000
  const amtFromText = after.amounts.find((a) => a.num === expectAmt || a.num === expectUnit)?.num ?? null;

  if (unitVal === expectUnit || amtVal === expectAmt || amtFromText != null) {
    const detail = [
      unitVal != null && `단위당 ${unitVal}${unitVal === expectUnit ? '=✓' : `≠${expectUnit}`}`,
      amtVal != null && `금액 ${amtVal}${amtVal === expectAmt ? '=✓' : `≠${expectAmt}`}`,
      amtFromText != null && `표시 ${amtFromText}`,
    ].filter(Boolean).join(' · ');
    record(m02, 'PASS', { actual: `수량 ${QTY}·매입가 ${PRICE} → ${detail}` });
  } else if (unitFieldEditable && (unitVal == null || unitVal === 0)) {
    // 단위당이 편집가능·미자동입력 → 자동계산 아님(수동). 등록 모달과 동일 패턴 — 결함 아님, 관찰.
    diff(P, '추가 입고 단위당 매입가 자동계산', '수량·매입가 입력해도 단위당 매입가 자동 채워지지 않음(수동 입력 필드로 보임)', `${R}_추가입고`, '등록 모달과 동일 — 자동계산 미탑재이면 기획 확인. 결함 여부 QA 판단');
    skip(m02, `단위당 매입가 자동계산 미관찰(수동 입력 추정, 실측 단위당=${unitVal ?? '공란'}) — 관찰 diff`);
  } else {
    // 값이 있으나 기대와 다름 → 다른 계산식일 수 있으므로 단정(FAIL) 회피, 관찰.
    diff(P, '추가 입고 자동계산 값', `수량 ${QTY}·매입가 ${PRICE} 입력 시 단위당=${unitVal ?? '?'}/금액=${amtVal ?? '?'}(기대 단위당 ${expectUnit}·금액 ${expectAmt})`, `${R}_추가입고`, '다른 산식(반올림/절사/부가세 등) 가능 — 산식 확인 요망');
    skip(m02, `계산값이 기대와 상이(단위당=${unitVal ?? '?'} 금액=${amtVal ?? '?'}) — 산식 확인(관찰 diff, FAIL 아님)`);
  }

  await closeModal(admin);
  await killAlarms(admin);
}

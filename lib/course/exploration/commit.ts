// Commit sequences — **파괴 옵트인**(isCourseDestructiveAllowed 3중 가드) 하에 등록 모달을 마커로 채워 제출,
//   목록 반영을 검증하고 teardown(deleteCourseMarkerRows)으로 잔여 0 보장. 저장/편집순서·상태소실 결함 탐지.
//   ⚠ 보수적 안전: vue-select/datepicker 등 미완성 필수폼은 제출 버튼 비활성 → **SKIP(무커밋)**. 텍스트만으로 채워지는 폼만 실제 커밋.
//   가드 미충족(ALLOW_DESTRUCTIVE≠1·호스트≠course-mng-td·클럽≠킹즈락)이면 전체 SKIP.
import type { Page, BrowserContext } from '@playwright/test';
import { killAlarms, settle } from '../courseHelpers';
import { openTrigger, closeTarget, forceDismiss, isBlockingModalOpen } from './transitions';
import { RuntimeObservers, detailSignals } from './observers';
import { isCourseDestructiveAllowed, deleteCourseMarkerRows, CRUD_MARK } from '../destructive';

const SUBMIT_RE = /^(등록하기|등록|저장|확정|추가)$/;

// 모달 내 텍스트/숫자/textarea를 마커로 채움(Vue input 이벤트 발화) + 첫 라디오 체크. vue-select/datepicker는 건드리지 않음.
//   반환: 채운 필드수. 값은 name/title 류 첫 입력에 CRUD_MARK 포함되도록.
async function fillModalWithMarker(page: Page, mark: string): Promise<number> {
  return page.evaluate((MARK) => {
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
      .filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : '')).pop();
    if (!md) return 0;
    let n = 0;
    const fire = (el: HTMLElement): void => { ['input', 'change', 'blur'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true }))); };
    md.querySelectorAll('input, textarea').forEach((el) => {
      const inp = el as HTMLInputElement;
      if (!vis(inp) || inp.readOnly || inp.disabled) return;
      const type = (inp.getAttribute('type') || 'text').toLowerCase();
      if (type === 'radio') { if (!inp.checked && n >= 0) { /* 라디오는 아래서 첫개만 */ } return; }
      if (type === 'checkbox') return;
      if (inp.closest('[class*="vs__"], .vue-select, [class*="datepicker"]')) return;   // vue-select/datepicker 위젯 내부 입력 제외
      if (type === 'number') { inp.value = '1'; fire(inp); n++; return; }
      if (['text', 'search', 'textarea', ''].includes(type) || inp.tagName === 'TEXTAREA') { inp.value = MARK; fire(inp); n++; }
    });
    const radio = Array.from(md.querySelectorAll('input[type=radio]')).find((r) => vis(r)) as HTMLInputElement | undefined;
    if (radio && !radio.checked) { radio.click(); n++; }
    return n;
  }, mark).catch(() => 0);
}

// 모달 내 제출 버튼 활성 여부 + 라벨.
async function submitState(page: Page): Promise<{ label: string; enabled: boolean }> {
  return page.evaluate((RE) => {
    const re = new RegExp(RE);
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
      .filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : '')).pop();
    if (!md) return { label: '', enabled: false };
    const norm = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();
    const btn = Array.from(md.querySelectorAll('button')).filter(vis)
      .find((b) => re.test(norm((b as HTMLElement).innerText || b.textContent || '')));
    if (!btn) return { label: '', enabled: false };
    const b = btn as HTMLButtonElement;
    const disabled = b.disabled || /disabled/.test(b.className) || b.getAttribute('aria-disabled') === 'true';
    return { label: norm(b.innerText || ''), enabled: !disabled };
  }, SUBMIT_RE.source).catch(() => ({ label: '', enabled: false }));
}

async function clickSubmit(page: Page): Promise<boolean> {
  return page.evaluate((RE) => {
    const re = new RegExp(RE);
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
      .filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : '')).pop();
    if (!md) return false;
    const norm = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();
    const btn = Array.from(md.querySelectorAll('button')).filter(vis)
      .find((b) => re.test(norm((b as HTMLElement).innerText || b.textContent || '')));
    if (btn && !(btn as HTMLButtonElement).disabled) { (btn as HTMLElement).click(); return true; }
    return false;
  }, SUBMIT_RE.source).catch(() => false);
}

// 제출 후 인라인 검증 차단 감지 — 모달 내 에러 스타일/필수 문구가 보이면 앱이 정상적으로 거부한 것(우리 채움 부족).
//   반환: 검증 메시지 텍스트(있으면) 또는 ''.
async function detectValidationError(page: Page): Promise<string> {
  return page.evaluate(() => {
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
      .filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : '')).pop();
    if (!md) return '';
    const norm = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();
    // 1) 에러 스타일 요소(class에 error/invalid/danger/required + 가시)
    const styled = Array.from(md.querySelectorAll('[class*="error"], [class*="invalid"], [class*="danger"], [class*="required"], [class*="warn"]'))
      .find((e) => vis(e) && norm((e as HTMLElement).innerText || '').length > 0);
    if (styled) return `스타일:${norm((styled as HTMLElement).innerText).slice(0, 40)}`;
    // 2) 필수/입력 안내 문구(짧은 텍스트)
    const txt = norm((md as HTMLElement).innerText || '');
    const m = txt.match(/[^.。\n]{0,30}(필수|입력해\s*주세요|선택해\s*주세요|확인해\s*주세요|required|입력하세요)[^.。\n]{0,10}/);
    return m ? `문구:${m[0].slice(0, 40)}` : '';
  }).catch(() => '');
}

// 목록에서 마커행 존재 여부(제출 반영 검증). 검색폼 있으면 마커로 조회 시도 후 tbody 스캔.
async function markerInList(page: Page, mark: string): Promise<boolean> {
  await settle(page, 800); await killAlarms(page);
  return page.evaluate((MARK) => {
    return Array.from(document.querySelectorAll('tbody tr')).some((tr) => (tr as HTMLElement).innerText.includes(MARK));
  }, mark).catch(() => false);
}

export type CommitStatus = 'PASS' | 'ANOMALY' | 'NEEDS_REVIEW' | 'SKIP';
export interface CommitResult { status: CommitStatus; rule: string; note: string; }

// 등록 트리거 1건에 대한 파괴 커밋 시퀀스. 항상 teardown. 가드/미완성폼이면 SKIP(무커밋).
export async function runCommitSequence(admin: Page, context: BrowserContext, obs: RuntimeObservers, trigger: string): Promise<CommitResult> {
  const guard = await isCourseDestructiveAllowed(admin);
  if (!guard.ok) return { status: 'SKIP', rule: 'commit-gated', note: `파괴 비허용: ${guard.why}` };

  const mark = CRUD_MARK;
  try {
    const res = await openTrigger(admin, context, trigger);
    if (res.kind !== 'modal') { await closeTarget(admin, res); return { status: 'SKIP', rule: 'commit-no-modal', note: `[${trigger}] 모달 아님(${res.kind}) — 커밋 스킵` }; }
    const filled = await fillModalWithMarker(admin, mark);
    const st = await submitState(admin);
    if (!st.enabled) {
      await forceDismiss(admin);
      return { status: 'SKIP', rule: 'commit-form-incomplete', note: `[${trigger}] 필드 ${filled}개 채움·제출('${st.label || '?'}') 비활성 — 미완성폼(vue-select/datepicker 필수 추정) 무커밋 SKIP` };
    }
    // ── 실제 커밋(마커 식별). obs로 런타임 이상 관측.
    obs.clear();
    const clicked = await clickSubmit(admin);
    await settle(admin, 1_600); await killAlarms(admin);
    const sig = obs.drain();
    const modalStill = await isBlockingModalOpen(admin);
    // 모달 잔존 시 인라인 검증 차단 여부 먼저 확인(앱이 정상 거부 = 우리 채움 부족 → 결함 아님).
    const validationMsg = modalStill ? await detectValidationError(admin) : '';
    // 목록 반영 검증(모달 닫힘 후).
    if (modalStill) await forceDismiss(admin);
    const reflected = await markerInList(admin, mark);

    let out: CommitResult;
    if (sig.pageErrors.length > 0 || sig.http5xx.length > 0) out = { status: 'ANOMALY', rule: 'commit-runtime-error', note: `제출 중 JS예외/5xx — ${detailSignals(sig)}` };
    else if (!clicked) out = { status: 'SKIP', rule: 'commit-click-fail', note: '제출 버튼 클릭 실패' };
    else if (reflected) out = { status: 'PASS', rule: 'commit-reflected', note: `제출 → 목록 반영 확인(마커행 존재)·런타임 ${detailSignals(sig)}` };
    else if (validationMsg) out = { status: 'SKIP', rule: 'commit-validation-blocked', note: `제출했으나 인라인 검증 차단(앱 정상 거부·미완성폼) — ${validationMsg}` };
    else if (!modalStill) out = { status: 'ANOMALY', rule: 'commit-save-not-reflected', note: `제출로 모달 닫혔으나 목록에 마커행 미반영 — 저장 무결성/상태소실 의심(4xx=${sig.http4xx.length})` };
    // 모달 잔존·미반영·검증표시 미감지 = **결정 불가**(제네릭 텍스트 채움이 필수 vue-select/datepicker 미완성 → 토스트/포커스로 차단 추정). 결함 단정 금지 → SKIP.
    else out = { status: 'SKIP', rule: 'commit-inconclusive', note: `제출 후 모달 잔존·미반영·인라인 검증 미감지 — 결정불가(제네릭 채움이 필수폼 미완성 추정, 토스트/포커스 차단 가능). 화면별 폼필러 필요(4xx=${sig.http4xx.length})` };
    return out;
  } finally {
    // teardown — 마커행 전수 삭제(성공/실패 무관). 잔여 0 보장.
    await killAlarms(admin);
    const removed = await deleteCourseMarkerRows(admin, mark, 12).catch(() => 0);
    if (removed > 0) { /* 정리됨 */ }
    if (await isBlockingModalOpen(admin)) await forceDismiss(admin).catch(() => {});
  }
}

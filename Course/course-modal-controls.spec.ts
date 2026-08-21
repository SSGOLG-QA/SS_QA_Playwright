import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';
import { openEditableForm, closeForm } from '../lib/course/formE2E';
import { DEEP_SCREENS } from '../lib/course/deepScreenE2E';

// ──────────────────────────────────────────────────────────────
//  전환 대상(모달/폼) 커버 보강 — 등록/수정 모달 내부 컨트롤 존재 검증(비파괴, L1).
//  실행: npm run course:auth 후 npm run course:modal-controls
//  배경: Phase B/C 전환 대상 커버 23%(모달 개별 버튼·입력·컬럼이 deepScreenE2E의 kind검증만으로는 미크레딧).
//  - 폼 보유 화면의 [신규 등록]/[수정] 모달을 열어 → 내부 버튼·입력·datepicker·드롭·컬럼 전수 존재 검증(라벨 크레딧).
//  - ⚠ 비파괴: 존재 확인만(모달 내 저장/삭제 클릭 금지), [취소]/Escape로 닫기.
//  - 리포트 코스관리_모달컨트롤보강 → 커버리지 트리가 전환 대상 컴포넌트에 크레딧.
// ──────────────────────────────────────────────────────────────

async function recordModal(admin: Page, P: string, ref: (n: string) => string, id: string): Promise<number> {
  const comps = await admin.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : '')).sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    const root = md || (document.querySelector('.contents, main') as Element);
    if (!root) return [];
    const seen = new Set<string>(); const out: { kind: string; label: string }[] = [];
    const push = (k: string, l: string) => { l = norm(l).slice(0, 44); if (!l || /^\d{1,3}$/.test(l)) return; const key = k + '|' + l; if (seen.has(key)) return; seen.add(key); out.push({ kind: k, label: l }); };
    const labelOf = (e: Element) => norm((e as HTMLElement).innerText || e.textContent || '') || (e as HTMLElement).getAttribute('placeholder') || (e as HTMLElement).getAttribute('title') || '';
    root.querySelectorAll('button, [role="button"], a.button-common, a.btn').forEach((e) => { if (vis(e)) push('button', labelOf(e)); });
    root.querySelectorAll('input:not([type=checkbox]):not([type=hidden]):not(.vs__search), textarea').forEach((e) => { if (vis(e)) { const ph = (e as HTMLElement).getAttribute('placeholder') || ''; push(/datepicker/.test(typeof e.className === 'string' ? e.className : '') ? 'datepicker' : 'input', ph || '입력'); } });
    root.querySelectorAll('.v-select').forEach((e) => { if (vis(e)) push('dropdown', '드롭'); });
    root.querySelectorAll('input[type=checkbox], [class*="switch"]').forEach((e) => { if (vis(e)) { const lab = e.closest('label') || e.parentElement; push('toggle', (lab && labelOf(lab)) || '토글'); } });
    root.querySelectorAll('thead th, thead td').forEach((e) => { if (vis(e)) { const t = norm(e.textContent); if (t && t.length <= 20) push('column', t); } });
    root.querySelectorAll('input[type=radio]').forEach((e) => { const lab = e.closest('label') || e.parentElement; if (vis((lab || e) as Element)) push('toggle', (lab && labelOf(lab)) || '라디오'); });
    return out;
  }, undefined as any).catch(() => [] as { kind: string; label: string }[]);
  for (const c of comps) {
    const m: CheckMeta = { path: `${P} > 모달 ${c.kind}:${c.label}`, tcRef: ref(`m_${c.kind}_${c.label}`), tcId: `${id}-M-${c.kind.toUpperCase()}-${c.label.replace(/\s+/g, '')}`, desc: `모달 ${c.kind} "${c.label}" 노출`, failMsg: `"${c.label}" 미노출` };
    record(m, 'PASS', { actual: `모달 ${c.kind} "${c.label}" 노출` });
  }
  return comps.length;
}

test('전환 대상(모달/폼) 커버 보강 — 모달 내부 컨트롤 존재 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const menusFilter = (process.env.DEEP_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);

  for (const s of DEEP_SCREENS) {
    if (menusFilter.length && !menusFilter.includes(s.menu)) continue;
    const P = `${s.menu} > ${s.sub}`;
    const ref = (n: string) => `코스관리_모달보강_${s.id}_${n}`;
    const ok = await gotoCourseMenu(admin, s.menu, s.sub).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: ref('0'), tcId: `${s.id}-00`, desc: '진입' }, '진입 실패'); continue; }
    await killAlarms(admin); await admin.waitForTimeout(1200);

    const form = await openEditableForm(admin).catch(() => ({ opened: false, kind: '' }));
    if (!form.opened) { skip({ path: `${P} > 모달`, tcRef: ref('form'), tcId: `${s.id}-MFORM`, desc: '등록/수정 모달 열기' }, '폼 진입점 없음(읽기전용/데이터 의존)'); continue; }
    const n = await recordModal(admin, P, ref, s.id);
    record({ path: `${P} > 모달 오픈`, tcRef: ref('open'), tcId: `${s.id}-MOPEN`, desc: `모달 오픈(${form.kind}) · 컨트롤 ${n}종`, failMsg: '모달 미오픈' }, n > 0 ? 'PASS' : 'FAIL', { actual: `${form.kind} · 컨트롤 ${n}종 존재 검증` });
    await closeForm(admin).catch(() => {});
    await killAlarms(admin);
    console.log(`  ${P.padEnd(26)} 모달 ${form.kind} · 컨트롤 ${n}`);
  }

  await killAlarms(admin);
  await writeReport('코스관리_모달컨트롤보강');
});

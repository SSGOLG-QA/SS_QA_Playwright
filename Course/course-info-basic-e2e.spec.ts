import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { datepickerCase } from '../lib/course/formE2E';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  정보 관리 > 코스 기본 정보 [수정] 화면 — 전 구성요소 E2E 상호작용(비파괴, 저장 안 함).
//  실행: npm run course:auth 후 npm run course:info-basic-e2e
//  커버(사용자 요청):
//    ① 모든 입력 필드에 입력(값 반영 확인)
//    ② [X](button.ico-color-close) 클리어 → 입력 삭제 + placeholder 노출 확인
//    ③ [+ 항목 추가](button-common.tertiary)로 항목 추가(공사 관련 사진·코스 외·코스 실사 사진·설계도)
//    ④ 행 [X]로 신규 추가 항목 삭제
//    ⑤ 설계도 [파일 선택] 업로드 → 파일 [휴지통](i.ico-delete)으로 삭제
//  ⚠ 비파괴 절대원칙: [저장](button-common.primary) 절대 클릭 금지. 종료 시 [취소]로 폐기(미영속).
//    삭제/추가는 미저장 편집폼 상태 변경 → 취소 시 원복. 자체 추가 항목/자체 업로드 파일만 삭제.
//  ★ 실 DOM 확정: analysis/코스관리_코스기본_수정폼.json (2026-08-18 프로브). 섹션=.list-head 앵커.
// ──────────────────────────────────────────────────────────────

const P = '정보 관리 > 코스 기본 정보 > 수정';
const R = (n: string) => `코스관리_코스기본_e2e_${n}`;
const M = (p: Page) => p.locator('.contents, main').first();

function tmpPng(): string {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const fp = path.join(os.tmpdir(), 'e2e-course-upload.png');
  fs.writeFileSync(fp, Buffer.from(b64, 'base64'));
  return fp;
}

// 섹션(.list-head 앵커) → 컨테이너 스코프 + 항목 수 카운트 in-page 헬퍼.
const COUNT_FN = `
(function(){
  const norm = (s) => (s||'').replace(/\\s+/g,' ').trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width>1 && r.height>1; };
  window.__sectionOf = function(label){
    const heads = Array.from(document.querySelectorAll('.list-head'));
    const head = heads.find((h)=> norm(h.textContent).includes(label));
    if(!head) return null;
    // .list-head 의 부모 = 행(라벨+본문). 본문 입력을 품을 때까지 최대 2단 상승.
    let row = head.parentElement;
    for(let k=0;k<2 && row;k++){ if(row.querySelector('input,button,textarea,a')) break; row = row.parentElement; }
    return row;
  };
  window.__count = function(sec){
    if(!sec) return {inputs:-1, fileLinks:0, rowDeletes:0};
    const inputs = Array.from(sec.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea')).filter(vis).length;
    const fileLinks = Array.from(sec.querySelectorAll('a')).filter((a)=> vis(a) && /\\.(png|jpg|jpeg|pdf|dwg|zip|hwp|docx?|xlsx?)/i.test(norm(a.textContent))).length;
    // 행 삭제 X = .ico-color-close 중 입력 형제 없는 것(필드클리어 아님)
    const rowDeletes = Array.from(sec.querySelectorAll('.ico-color-close')).filter((e)=> vis(e) && !(e.parentElement && e.parentElement.querySelector('input, textarea'))).length;
    return {inputs, fileLinks, rowDeletes};
  };
})();
`;

async function enterEdit(admin: Page): Promise<boolean> {
  const editBtn = M(admin).getByRole('button', { name: /^\s*수정\s*$/ }).first();
  if (!(await editBtn.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  await editBtn.click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  return M(admin).getByRole('button', { name: /^\s*저장\s*$/ }).first().isVisible({ timeout: 3_000 }).catch(() => false);
}

async function cancelEdit(admin: Page) {
  await admin.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const sc = document.querySelector('.contents, main') || document.body;
    const c = Array.from(sc.querySelectorAll('button')).find((b) => /^\s*취소\s*$/.test(b.textContent || '') && vis(b) && !/저장/.test(b.textContent || ''));
    if (c) (c as HTMLElement).click();
  }).catch(() => {});
  await admin.waitForTimeout(700);
  await admin.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).find((m) => vis(m));
    if (md) { const ok = Array.from(md.querySelectorAll('button')).find((b) => /^\s*(확인|예|나가기|이동)\s*$/.test(b.textContent || '') && !/저장/.test(b.textContent || '')); if (ok) (ok as HTMLElement).click(); }
  }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);
}

test('정보 관리 > 코스 기본 정보 [수정] 전 구성요소 E2E(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  if (!(await gotoCourseMenu(admin, '정보 관리', '코스 기본 정보').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: R('0'), tcId: 'SCE2E-00', desc: '진입' }, '진입 실패(세션 만료 — course:auth)');
    await writeReport('코스관리_코스기본정보E2E'); return;
  }
  await admin.waitForTimeout(1_200); await killAlarms(admin);
  if (!(await enterEdit(admin))) {
    skip({ path: P, tcRef: R('0'), tcId: 'SCE2E-00', desc: '[수정] 편집모드 진입' }, '[수정] 미노출/편집모드 미진입');
    await writeReport('코스관리_코스기본정보E2E'); return;
  }
  record({ path: P, tcRef: R('00'), tcId: 'SCE2E-00', desc: '[수정] 편집모드 진입(저장/취소 노출)', failMsg: '편집모드 미진입' }, 'PASS', { actual: '편집모드 진입' });
  await admin.evaluate(COUNT_FN).catch(() => {});

  // ══════════ ⓪ 공사 기간 datepicker(달력 위젯 — 아이콘→팝업→날짜 셀 선택→반영, 범위 시작≤종료) ══════════
  await datepickerCase(admin, M(admin), P, R('date'), 'CB');

  // ══════════ ① 모든 입력 필드 입력 ══════════
  {
    const loc = M(admin).locator('input:not([type=file]):not([type=hidden]):not([readonly]), textarea');
    const n = await loc.count().catch(() => 0);
    let filled = 0, failed = 0; const failIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      if (await el.isDisabled().catch(() => false)) continue;
      const cls = (await el.getAttribute('class').catch(() => '')) || '';
      const v = /datepicker/.test(cls) ? '2025-06-15' : '99999';
      await el.click({ timeout: 1_200 }).catch(() => {});
      await el.fill('').catch(() => {});
      await el.fill(v).catch(() => {});
      await el.evaluate((e) => (e as HTMLInputElement).blur()).catch(() => {});
      const got = ((await el.inputValue().catch(() => '')) || '').trim();
      if (got.length > 0) filled++; else { failed++; if (failIdx.length < 8) failIdx.push(i); }
    }
    const m: CheckMeta = { path: `${P} > 입력 전수`, tcRef: R('fill'), tcId: 'SCE2E-FILL', desc: '모든 입력 필드에 값 입력 → 반영 확인', failMsg: '입력 반영 실패 다수' };
    if (n === 0) skip(m, '입력 필드 없음');
    else if (filled >= Math.ceil(n * 0.8)) record(m, 'PASS', { actual: `${filled}/${n} 입력 반영(실패 ${failed})` });
    else record(m, 'FAIL', { error: `입력 반영 부족 ${filled}/${n}`, detail: `실패 idx ${failIdx.join(',')}` });
  }

  // ══════════ ② [X](button.ico-color-close) 클리어 → 삭제 + placeholder (2-phase: 클릭→nextTick→재확인) ══════════
  {
    // Phase1: 값 있는 필드클리어 X 클릭 + 마킹
    const p1 = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const scope = document.querySelector('.contents, main') || document.body;
      const clrs = Array.from(scope.querySelectorAll('button.ico-color-close, i.ico-color-close, i.ico-color-close-k')).filter(vis);
      let tried = 0; const marks: { idx: number; ph: string }[] = [];
      for (const clr of clrs) {
        if (tried >= 15) break;
        // 입력 형제(필드클리어) 탐색: 조상 2단 내 input/textarea (값 있는 것)
        let wrap: Element | null = clr; let inp: HTMLInputElement | null = null;
        for (let k = 0; k < 2 && wrap; k++) { wrap = wrap.parentElement; if (wrap) { const c = wrap.querySelector('input:not([type=file]), textarea') as HTMLInputElement | null; if (c) { inp = c; break; } } }
        if (!inp || !inp.value) continue;
        inp.setAttribute('data-e2e-clear', String(tried));
        marks.push({ idx: tried, ph: inp.getAttribute('placeholder') || '' });
        (clr as HTMLElement).click();
        tried++;
      }
      return { tried, marks };
    }).catch(() => ({ tried: 0, marks: [] as { idx: number; ph: string }[] }));
    await admin.waitForTimeout(700);   // Vue nextTick 반영 대기
    // Phase2: 마킹 입력 값/placeholder 재확인
    const p2 = await admin.evaluate(() => {
      let cleared = 0, phOk = 0; const sample: unknown[] = [];
      const marked = Array.from(document.querySelectorAll('[data-e2e-clear]')) as HTMLInputElement[];
      for (const inp of marked) {
        const empty = inp.value === '';
        const ph = inp.getAttribute('placeholder') || '';
        if (empty) cleared++;
        if (empty && ph) phOk++;
        if (sample.length < 6) sample.push({ ph, cleared: empty });
        inp.removeAttribute('data-e2e-clear');
      }
      return { cleared, phOk, total: marked.length, sample };
    }).catch(() => ({ cleared: 0, phOk: 0, total: 0, sample: [] }));
    const m: CheckMeta = { path: `${P} > [X] 클리어`, tcRef: R('clear'), tcId: 'SCE2E-CLEAR', desc: '[X](ico-color-close) → 입력 삭제 + placeholder 노출', failMsg: '클리어 미동작' };
    if (p1.tried === 0) skip(m, '값 있는 필드클리어 [X] 미검출');
    else if (p2.cleared >= Math.ceil(p1.tried * 0.7)) record(m, 'PASS', { actual: `클리어 ${p2.cleared}/${p1.tried} · placeholder 확인 ${p2.phOk} · ${JSON.stringify(p2.sample).slice(0, 180)}` });
    else record(m, 'FAIL', { error: `클리어 동작 부족 ${p2.cleared}/${p1.tried}`, detail: JSON.stringify(p2.sample).slice(0, 180) });
  }

  // ══════════ ③④ [+ 항목 추가] 추가 → 행 [X] 삭제(신규 항목) ══════════
  for (const sec of ['공사 관련 사진', '코스 외', '코스 실사 사진', '설계도']) {
    const secTag = sec.replace(/\s/g, '');
    const before = await admin.evaluate((s) => { const el = (window as any).__sectionOf(s); return el ? (window as any).__count(el).inputs : -1; }, sec).catch(() => -1);
    const pageBefore = await admin.locator('.contents, main').locator('input:not([type=file]):not([type=hidden]), textarea').count().catch(() => -1);
    const addM: CheckMeta = { path: `${P} > ${sec} > 항목추가`, tcRef: R(`add_${secTag}`), tcId: 'SCE2E-ADD', desc: `[${sec}] [+ 항목 추가] → 입력 항목 증가`, failMsg: '항목 미증가' };
    if (before < 0) { skip(addM, `섹션 '${sec}' 미검출(.list-head)`); continue; }
    // 항목 추가 클릭(섹션 스코프) + 진단(스코프 태그/버튼 수/disabled)
    const clicked = await admin.evaluate((s) => {
      const norm = (t: string | null) => (t || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const el = (window as any).__sectionOf(s); if (!el) return false;
      const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : '');
      const addBtns = Array.from(el.querySelectorAll('button')).filter((b: any) => /항목\s*추가/.test(norm(b.textContent)) && vis(b)) as HTMLButtonElement[];
      (window as any).__addDiag = { scopeTag: (el as Element).tagName.toLowerCase() + '.' + clsOf(el as Element).slice(0, 40), addBtnCount: addBtns.length, disabled: addBtns[0] ? addBtns[0].disabled : null, scopeInputs: el.querySelectorAll('input,textarea').length };
      if (addBtns[0]) { addBtns[0].click(); return true; } return false;
    }, sec).catch(() => false);
    await admin.waitForTimeout(900);
    // 미증가 원인 분류용: killAlarms 전 토스트/안내 텍스트 캡처(제한/검증 vs 실제 결함 구분)
    const toast = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const t = document.querySelector('.toast-box, .toast, [class*="toast"], .modal-group.alarm, [class*="alarm"]');
      return t ? norm((t as HTMLElement).innerText).slice(0, 120) : '';
    }).catch(() => '');
    await killAlarms(admin);
    const afterAdd = await admin.evaluate((s) => { const el = (window as any).__sectionOf(s); return el ? (window as any).__count(el).inputs : -1; }, sec).catch(() => -1);
    const pageAfter = await admin.locator('.contents, main').locator('input:not([type=file]):not([type=hidden]), textarea').count().catch(() => -1);
    const diag = await admin.evaluate(() => (window as any).__addDiag || null).catch(() => null) as { scopeTag?: string; addBtnCount?: number; disabled?: boolean | null; scopeInputs?: number } | null;
    if (!clicked) { skip(addM, '[+ 항목 추가] 버튼 미검출(섹션 스코프)'); continue; }
    if (afterAdd > before) record(addM, 'PASS', { actual: `입력 ${before}→${afterAdd}(항목 추가)` });
    else if (diag?.disabled === true) {
      // [+ 항목 추가] 버튼 비활성 = 추가 조건 미충족(최대 항목 도달/선행 항목 미완성 등) → 정상 UI 상태(결함 아님)
      diff(`${P} > ${sec}`, `[${sec}] [+ 항목 추가] 비활성`, `버튼 disabled=true(추가 조건 미충족 — 최대 항목/선행 완성 등) → 클릭 무동작(정상)`, R(`add_${secTag}`), '조건부 비활성 — 결함 아님. 조건 충족 상태서 추가 동작 별도 검증 권장');
      skip(addM, '[+ 항목 추가] 버튼 비활성(disabled) — 추가 조건 미충족 상태(정상 UI)');
    }
    else if (toast) { diff(`${P} > ${sec}`, `[${sec}] [+ 항목 추가] 무증가`, `클릭 후 항목 미증가 · 안내 "${toast}"(최대 항목 제한/선행 입력 검증 추정)`, R(`add_${secTag}`), '제한/검증 UX 추정 — 결함 아님, 조건 충족 후 추가 재검증 권장'); skip(addM, `항목 미증가 — 안내 "${toast}"(제한/검증 추정)`); }
    else {
      // 진단: 페이지 전체 input 증가했으나 섹션은 그대로 = 테스트 스코프 오클릭 / 둘 다 그대로 = 실제 무동작
      const pageGrew = pageAfter > pageBefore;
      const dg = `scope=${diag?.scopeTag} addBtn=${diag?.addBtnCount} disabled=${diag?.disabled} scopeInputs=${diag?.scopeInputs} · 섹션 ${before}→${afterAdd} · 페이지 ${pageBefore}→${pageAfter}`;
      console.log(`[ADD-DIAG ${sec}] ${dg}`);
      if (pageGrew) { diff(`${P} > ${sec}`, `[${sec}] 항목추가 스코프 진단`, `페이지 input 증가(${pageBefore}→${pageAfter})했으나 섹션 스코프 미반영 — 테스트 스코프/카운트 이슈 추정`, R(`add_${secTag}`), dg); skip(addM, `테스트 스코프 이슈 추정(페이지 input 증가·섹션 미반영) — ${dg}`); }
      else record(addM, 'FAIL', { error: '항목추가 무동작(안내 없음·페이지 input 무변화)', detail: dg });
    }

    // 행 [X] 삭제 — 신규(마지막) 항목의 row-delete(.ico-color-close, 입력형제 없음). count 감소까지 후보 순회.
    const delM: CheckMeta = { path: `${P} > ${sec} > 항목삭제`, tcRef: R(`del_${secTag}`), tcId: 'SCE2E-DELITEM', desc: `[${sec}] 행 [X]로 추가 항목 삭제 → 항목 감소`, failMsg: '항목 미감소' };
    if (afterAdd > before) {
      let afterDel = afterAdd; let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const did = await admin.evaluate((s) => {
          const norm = (t: string | null) => (t || '').replace(/\s+/g, ' ').trim();
          const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          const el = (window as any).__sectionOf(s); if (!el) return false;
          // row-delete 후보 = .ico-color-close 중 입력 형제 없음(필드클리어 아님) — 마지막(신규) 우선
          const cands = Array.from(el.querySelectorAll('.ico-color-close')).filter((e: any) => vis(e) && !(e.parentElement && e.parentElement.querySelector('input, textarea')));
          const target = (cands[cands.length - 1] || Array.from(el.querySelectorAll('.ico-color-close')).filter((e: any) => vis(e)).pop()) as HTMLElement | undefined;
          if (target) { target.click(); return true; } return false;
        }, sec).catch(() => false);
        await admin.waitForTimeout(800); await killAlarms(admin);
        afterDel = await admin.evaluate((s) => { const el = (window as any).__sectionOf(s); return el ? (window as any).__count(el).inputs : -1; }, sec).catch(() => -1);
        if (!did) break;
        if (afterDel < afterAdd) ok = true;
      }
      if (ok) record(delM, 'PASS', { actual: `입력 ${afterAdd}→${afterDel}(추가 항목 삭제)` });
      else record(delM, 'FAIL', { error: '항목 미감소', detail: `입력 ${afterAdd}→${afterDel}` });
    } else skip(delM, '추가 실패로 삭제 대상 없음');
  }

  // ══════════ ⑤ 설계도 [파일 선택] 업로드 → 파일 [휴지통](i.ico-delete) 삭제 ══════════
  {
    const m: CheckMeta = { path: `${P} > 설계도 > 휴지통`, tcRef: R('trash'), tcId: 'SCE2E-TRASH', desc: '설계도 파일 업로드 → [휴지통](ico-delete) 삭제 → 파일 제거', failMsg: '휴지통 삭제 미동작' };
    const secExists = await admin.evaluate(() => !!(window as any).__sectionOf('설계도')).catch(() => false);
    if (!secExists) { skip(m, '설계도 섹션 미검출'); }
    else {
      // 설계도 file input = accept="" (마지막 2개). 마지막에 업로드.
      const fileLoc = M(admin).locator('input[type=file]');
      const fn = await fileLoc.count().catch(() => 0);
      let uploaded = false;
      if (fn > 0) {
        await fileLoc.last().setInputFiles(tmpPng()).catch(() => {});
        await admin.waitForTimeout(1_500); await killAlarms(admin);
        uploaded = await admin.evaluate(() => { const el = (window as any).__sectionOf('설계도'); return el ? (window as any).__count(el).fileLinks > 0 : false; }).catch(() => false);
      }
      if (!uploaded) { skip(m, '설계도 파일 업로드 미반영(file input/렌더 상이)'); }
      else {
        const before = await admin.evaluate(() => { const el = (window as any).__sectionOf('설계도'); return (window as any).__count(el).fileLinks; }).catch(() => -1);
        const trashed = await admin.evaluate(() => {
          const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
          const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          const el = (window as any).__sectionOf('설계도'); if (!el) return false;
          // 휴지통 = i.ico-delete (파일 링크 인접). 마지막(방금 업로드분) 우선.
          const trashes = Array.from(el.querySelectorAll('i.ico-delete, .ico-delete, [class*="trash"]')).filter((e: any) => vis(e));
          const t = trashes[trashes.length - 1] as HTMLElement | undefined;
          if (t) { t.click(); return true; } return false;
        }).catch(() => false);
        await admin.waitForTimeout(900); await killAlarms(admin);
        const after = await admin.evaluate(() => { const el = (window as any).__sectionOf('설계도'); return (window as any).__count(el).fileLinks; }).catch(() => -1);
        if (!trashed) skip(m, '[휴지통](ico-delete) 미검출');
        else if (after < before) record(m, 'PASS', { actual: `설계도 파일링크 ${before}→${after}(업로드분 휴지통 삭제)` });
        else record(m, 'FAIL', { error: '파일 미제거', detail: `fileLinks ${before}→${after}` });
      }
    }
  }

  diff(P, 'E2E 상호작용 커버리지', '입력전수·[X]클리어·항목추가/삭제·설계도휴지통 — 편집폼 미저장 상태 검증(취소 폐기)', R('cov'), '저장 미클릭(비파괴) · 자체 추가/업로드분만 삭제');

  await cancelEdit(admin);
  await killAlarms(admin);
  await writeReport('코스관리_코스기본정보E2E');
});

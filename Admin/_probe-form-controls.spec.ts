import { test } from '../lib/fixtures';
import { navigateMenu, settle } from '../lib/adminHelpers';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  td17 경기관제 — 폼 컨트롤 셀렉터 규명 프로브(진단 전용, 비파괴). [P1 L6 배터리 이식 준비]
//  실행: npm run auth 후 npx playwright test --project=admin-chromium Admin/_probe-form-controls.spec.ts --no-deps
//  목적: 코스관리 formE2E 배터리를 td17에 이식하려면 td17 디자인 시스템의 실제 셀렉터가 필요 —
//    ① 입력 clear-[X] ② datepicker(td17=달력 전용, 코스관리 fill형과 다름) ③ 섹션 컨테이너
//    ④ 모달(.modal-group) ⑤ 저장/취소/등록 버튼 클래스 ⑥ 토글(즉시반영 여부 판단용)
//  산출: analysis/td17_form_controls.json
//  ⚠ 비파괴: 스캔 + datepicker 1회 열기(달력 구조 확인)→Escape. 저장/삭제 클릭 금지.
// ──────────────────────────────────────────────────────────────

const SCREENS: [string, string, string][] = [
  ['태블릿 운영 관리', '태블릿 기능 설정', 'TABLET'],
  ['경기 진행 관리', '진행시간 표준 설정', 'TIMESTD'],
  ['라운드 관리', '스코어 출력 설정', 'SCOUT'],
  ['코스 운영 관리', '그린 스피드', 'GREEN'],
  ['코스 운영 관리', '골프장 소식', 'NEWS'],
];

async function scan(admin: import('@playwright/test').Page) {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const cls = (el: Element) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''));
    const scope = document.querySelector('.contents, main') || document.body;

    const buttons = [...new Set(Array.from(scope.querySelectorAll('button')).filter(vis).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 30);
    const saveCancel = Array.from(scope.querySelectorAll('button')).filter((b) => vis(b) && /저장|취소|등록|초기화|적용/.test(norm(b.textContent))).map((b) => ({ t: norm(b.textContent), c: cls(b).slice(0, 45) }));

    const inputs = Array.from(scope.querySelectorAll('input:not([type=hidden]), textarea')).filter(vis).slice(0, 40).map((e) => ({
      tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '', ph: e.getAttribute('placeholder') || '', maxlength: e.getAttribute('maxlength') || '',
      cls: cls(e).slice(0, 40), readonly: e.hasAttribute('readonly'), isDate: /datepicker/.test(cls(e)),
    }));

    // clear-[X] 후보: 입력 래퍼(조상 3단) 내 텍스트없는 클릭요소
    const clearCandidates: unknown[] = [];
    for (const inp of Array.from(scope.querySelectorAll('input:not([type=file]):not([type=hidden])')).filter(vis).slice(0, 20)) {
      let w: Element | null = inp;
      for (let k = 0; k < 3 && w; k++) {
        w = w.parentElement; if (!w) break;
        const cand = Array.from(w.querySelectorAll('button, i, span, svg, [class*="delete"], [class*="close"], [class*="clear"], [class*="ico"]'))
          .find((c) => c !== inp && vis(c) && !norm(c.textContent) && (c.tagName === 'BUTTON' || getComputedStyle(c).cursor === 'pointer' || /delete|close|clear|ico|del/i.test(cls(c))));
        if (cand && clearCandidates.length < 6) { clearCandidates.push({ inpPh: inp.getAttribute('placeholder') || '', wrap: cls(w).slice(0, 40), cand: { tag: cand.tagName.toLowerCase(), cls: cls(cand).slice(0, 45), html: cand.outerHTML.replace(/\s+/g, ' ').slice(0, 120) } }); break; }
      }
    }

    const toggles = Array.from(scope.querySelectorAll('[class*="toggle"], [class*="switch"], input[type=checkbox], [id^="tgv-"]')).filter(vis)
      .map((e) => ({ cls: cls(e).slice(0, 50), txt: norm((e as HTMLElement).innerText).slice(0, 30), id: (e as HTMLElement).id })).slice(0, 12);
    const sections = Array.from(scope.querySelectorAll('.contents-box, .sub-title-box')).filter(vis)
      .map((b) => norm((b.querySelector('.sub-title-box, h2,h3,.title') || b).textContent).slice(0, 40)).filter(Boolean).slice(0, 15);
    const datepickers = scope.querySelectorAll('.datepicker-input, [class*="datepicker"]').length;
    const fileInputs = scope.querySelectorAll('input[type=file]').length;
    const addBtns = Array.from(scope.querySelectorAll('button')).filter((b) => vis(b) && /추가|\+/.test(norm(b.textContent))).map((b) => norm(b.textContent)).slice(0, 8);

    return { url: location.pathname, buttons, saveCancel, inputs, clearCandidates, toggles, sections, datepickers, fileInputs, addBtns };
  }).catch((e) => ({ ERROR: String(e).slice(0, 200) }));
}

test('td17 폼 컨트롤 셀렉터 규명(비파괴)', async ({ admin }) => {
  test.setTimeout(300_000);
  const out: Record<string, unknown> = { ts: new Date().toISOString().slice(0, 19).replace('T', ' ') };

  for (const [menu, sub, key] of SCREENS) {
    const rec: Record<string, unknown> = {};
    const ok = await navigateMenu(admin, menu, sub).catch(() => false) as boolean;
    if (!ok) { rec['_진입'] = false; out[`${menu} > ${sub}`] = rec; continue; }
    await settle(admin, 1800);
    rec['scan'] = await scan(admin);

    // datepicker 1회 열어 달력 레이어 구조 확인(td17 달력 전용)
    const dp = admin.locator('.datepicker-input').first();
    if (await dp.isVisible({ timeout: 1500 }).catch(() => false)) {
      await dp.click({ timeout: 2000 }).catch(() => {});
      await admin.waitForTimeout(700);
      rec['datepickerLayer'] = await admin.evaluate(() => {
        const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
        const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
        const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
        const layer = Array.from(document.querySelectorAll('.datepicker-layer, [class*="datepicker"], [class*="calendar"], [class*="picker"]')).filter((l) => vis(l) && Array.from(l.querySelectorAll('*')).some((c) => /^\d{1,2}$/.test(norm(c.textContent))));
        const l = layer.sort((a, b) => b.querySelectorAll('*').length - a.querySelectorAll('*').length)[0];
        if (!l) return { found: false };
        const dayCells = Array.from(l.querySelectorAll('*')).filter((c) => vis(c) && /^\d{1,2}$/.test(norm(c.textContent)) && !Array.from(c.children).some((ch) => /^\d{1,2}$/.test(norm(ch.textContent))));
        return { found: true, layerCls: cls(l).slice(0, 50), dayCellSample: dayCells.slice(0, 3).map((c) => ({ tag: c.tagName.toLowerCase(), cls: cls(c).slice(0, 40) })), dayCount: dayCells.length };
      }).catch(() => ({ found: false }));
      await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(300);
    }

    // 등록형(골프장 소식 등): [등록] 클릭 → 모달 구조 → 취소
    if (key === 'NEWS') {
      const reg = admin.locator('.contents, main').getByRole('button', { name: /^\s*등록\s*$/ }).first();
      if (await reg.isVisible({ timeout: 1500 }).catch(() => false)) {
        await reg.click({ timeout: 2500 }).catch(() => {});
        await admin.waitForTimeout(1000);
        rec['regModal'] = await admin.evaluate(() => {
          const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
          const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
          const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m) && !/alarm/.test(cls(m))).sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
          if (!md) return { found: false };
          return { found: true, cls: cls(md).slice(0, 40), inputs: md.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea').length, fileInputs: md.querySelectorAll('input[type=file]').length, btns: [...new Set(Array.from(md.querySelectorAll('button')).filter(vis).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 12) };
        }).catch(() => ({ found: false }));
        // 취소(비파괴)
        await admin.evaluate(() => { const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; const md = Array.from(document.querySelectorAll('.modal-group')).filter(vis).pop(); const c = md ? Array.from(md.querySelectorAll('button')).find((b) => /^\s*(취소|닫기)\s*$/.test(b.textContent || '') && !/저장|등록/.test(b.textContent || '')) : null; if (c) (c as HTMLElement).click(); }).catch(() => {});
        await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400);
      }
    }
    out[`${menu} > ${sub}`] = rec;
  }

  if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
  fs.writeFileSync('analysis/td17_form_controls.json', JSON.stringify(out, null, 2));
  for (const [menu, sub] of SCREENS) {
    const r = out[`${menu} > ${sub}`] as any; if (!r) continue; const s = r.scan || {};
    console.log(`\n══ ${menu} > ${sub} ══ url=${s.url} datepicker ${s.datepickers} file ${s.fileInputs} 토글 ${(s.toggles || []).length}`);
    console.log(`  저장/취소/등록: ${JSON.stringify(s.saveCancel)}`);
    console.log(`  clear-X 후보: ${JSON.stringify(s.clearCandidates)}`);
    if (r.datepickerLayer) console.log(`  달력 레이어: ${JSON.stringify(r.datepickerLayer)}`);
    if (r.regModal) console.log(`  등록 모달: ${JSON.stringify(r.regModal)}`);
  }
  console.log('\n[out] analysis/td17_form_controls.json');
});

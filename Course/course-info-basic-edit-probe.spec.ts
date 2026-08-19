import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  정보 관리 > 코스 기본 정보 [수정] 폼 — 상호작용 컨트롤 정밀 프로브(진단 전용, 비파괴).
//  실행: npm run course:auth 후 npm run course:info-basic-edit-probe
//  목적: E2E(모든 입력 채우기·[X]클리어→placeholder·[+항목추가]·행[X]삭제·설계도[휴지통]삭제)를
//    정밀 구현하기 위해 각 컨트롤의 실제 셀렉터/구조를 전수 덤프.
//  산출: analysis/코스관리_코스기본_수정폼.json
//  ⚠ 비파괴: 수정 진입 → 스캔만 → [취소](저장 절대 안 함). 클릭 액션 없음(순수 DOM 관찰).
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

test('코스 기본 정보 [수정] 폼 — 상호작용 컨트롤 정밀 프로브(진단)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin = await openCourseAdmin(page, context);
  const out: Record<string, unknown> = { ts: new Date().toISOString().slice(0, 19).replace('T', ' ') };

  const finish = async () => {
    if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
    fs.writeFileSync(path.join('analysis', '코스관리_코스기본_수정폼.json'), JSON.stringify(out, null, 2));
    console.log('\n══ 수정 폼 컨트롤 프로브 요약 ══');
    console.log(JSON.stringify(out['summary'] ?? out['_note'] ?? {}, null, 1).slice(0, 1500));
    console.log('[out] analysis/코스관리_코스기본_수정폼.json');
  };

  if (!(await gotoCourseMenu(admin, '정보 관리', '코스 기본 정보').then(() => true).catch(() => false))) { out['_note'] = '진입 실패(세션 만료 — course:auth)'; await finish(); return; }
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  const editBtn = M(admin).getByRole('button', { name: /^\s*수정\s*$/ }).first();
  if (!(await editBtn.isVisible({ timeout: 2_500 }).catch(() => false))) { out['_note'] = '[수정] 버튼 미노출'; await finish(); return; }
  await editBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin);

  out['scan'] = await M(admin).evaluate((scope) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (el: Element) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''));
    const html = (el: Element | null | undefined, n = 600) => el ? el.outerHTML.replace(/\s+/g, ' ').replace(/__token__=[^"&]+/g, '__token__=…').slice(0, n) : '';

    // 1) 입력 필드 인벤토리
    const inputs = Array.from(scope.querySelectorAll('input:not([type=hidden]), textarea')).filter(vis);
    const inputInv = inputs.slice(0, 60).map((e, i) => ({
      i, tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '', ph: e.getAttribute('placeholder') || '',
      readonly: e.hasAttribute('readonly'), maxlength: e.getAttribute('maxlength') || '', value: (e as HTMLInputElement).value || '',
      cls: clsOf(e).slice(0, 40), isDate: /datepicker/.test(clsOf(e)) || e.getAttribute('type') === 'date',
    }));

    // 2) [X] 클리어 버튼 후보 — 입력 래퍼 내부의 클릭가능 아이콘(텍스트 없음). 첫 5개 구조 덤프
    const clearCandidates: unknown[] = [];
    for (const inp of inputs.slice(0, 30)) {
      let wrap: Element | null = inp;
      for (let k = 0; k < 3 && wrap; k++) { wrap = wrap.parentElement; if (wrap && wrap.querySelector('button, i, svg, [class*="delete"], [class*="close"], [class*="clear"], [class*="icon"]')) break; }
      if (!wrap) continue;
      const cand = Array.from(wrap.querySelectorAll('button, i, span, svg, [class*="delete"], [class*="close"], [class*="clear"]'))
        .filter((c) => c !== inp && vis(c) && !norm(c.textContent) && (c.tagName === 'BUTTON' || getComputedStyle(c).cursor === 'pointer' || /delete|close|clear|ic-|icon/i.test(clsOf(c))));
      if (cand.length && clearCandidates.length < 5) clearCandidates.push({ inpPh: inp.getAttribute('placeholder') || '', wrapCls: clsOf(wrap).slice(0, 40), cand: cand.slice(0, 2).map((c) => ({ tag: c.tagName.toLowerCase(), cls: clsOf(c).slice(0, 50), html: html(c, 160) })) });
    }

    // 3) [+ 항목 추가] / [사진 선택] / [파일 선택] 버튼 — 라벨+구조
    const namedBtns = Array.from(scope.querySelectorAll('button')).filter(vis).map((b) => ({ text: norm(b.textContent), cls: clsOf(b).slice(0, 50) }))
      .filter((b) => /항목\s*추가|사진\s*선택|파일\s*선택|저장|취소/.test(b.text));

    // 4) 행/항목 삭제 [X] (반복 그룹의 우측 원형 X) + 설계도 [휴지통]
    const iconDeletes = Array.from(scope.querySelectorAll('button, [class*="delete"], [class*="trash"], [class*="remove"], i, svg'))
      .filter((e) => vis(e) && !norm(e.textContent) && (e.tagName === 'BUTTON' || /delete|trash|remove|ic-/i.test(clsOf(e)) || getComputedStyle(e).cursor === 'pointer'));
    const delInv: Record<string, number> = {};
    for (const d of iconDeletes) { const key = (d.tagName.toLowerCase() + '.' + clsOf(d).split(/\s+/).filter((c) => /del|trash|remove|close|ic-/i.test(c)).join('.')).slice(0, 40); delInv[key] = (delInv[key] || 0) + 1; }

    // 5) 파일 input(숨김)
    const fileInputs = Array.from(scope.querySelectorAll('input[type=file]')).map((e) => ({ cls: clsOf(e).slice(0, 40), accept: e.getAttribute('accept') || '' }));

    // 6) 섹션별 outerHTML 샘플(라벨 → 조상 행)
    const sectionLabels = ['공사 기간', '공사 업체', '공사 관련 사진', '코스 공사 비용', '시설 공사 비용', '총 사업 부지', '코스 외', '잔디 기초 정보', '폰드 기초 정보', '코스 실사 사진', '설계도'];
    const sections: Record<string, string> = {};
    const all = Array.from(scope.querySelectorAll('*'));
    for (const lb of sectionLabels) {
      const holder = all.find((e) => { const t = norm(e.textContent); return t.includes(lb) && !Array.from(e.children).some((c) => (c.textContent || '').includes(lb)); });
      let row: Element | null = holder || null; for (let k = 0; k < 5 && row; k++) { if (row.parentElement && /row|field|form-item|contents-box|list/i.test(clsOf(row.parentElement))) { row = row.parentElement; break; } row = row.parentElement; }
      sections[lb] = html(row || holder, 700);
    }

    return {
      counts: { inputs: inputs.length, fillable: inputs.filter((e) => !e.hasAttribute('readonly') && !/datepicker/.test(clsOf(e))).length, datepickers: scope.querySelectorAll('.datepicker-input').length, fileInputs: scope.querySelectorAll('input[type=file]').length, iconDeletes: iconDeletes.length },
      inputInv, clearCandidates, namedBtns, delInv, fileInputs, sections,
    };
  }).catch((e) => ({ ERROR: String(e).slice(0, 200) }));

  out['summary'] = (out['scan'] as { counts?: unknown })?.counts ?? null;

  // 취소(비파괴)
  await admin.evaluate(() => { const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; const sc = document.querySelector('.contents, main'); const c = sc ? Array.from(sc.querySelectorAll('button')).find((b) => /^\s*취소\s*$/.test(b.textContent || '') && vis(b)) : null; if (c) (c as HTMLElement).click(); }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);
  await finish();
});

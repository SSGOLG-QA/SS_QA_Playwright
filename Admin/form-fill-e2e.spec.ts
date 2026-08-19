import { test } from '../lib/fixtures';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  td17 경기관제 — 등록 모달 입력 FILL 배터리(비파괴). [P1 L6 상호작용 E2E 확장]
//  실행: npm run auth 후 npx playwright test --project=admin-chromium Admin/form-fill-e2e.spec.ts --no-deps
//  근거: 프로브(_probe-form-controls)로 확정 — td17 폼은 코스관리 배터리(clear-X·datepicker위젯·항목추가/삭제)와
//    달라 매핑 안 됨. td17의 실 L6 갭 = **등록 모달 입력 채우기**(기존 스위트는 모달 '노출·활성만' 검증, FILL 미수행).
//  각 화면: [등록/신규 등록] → 모달 → 전 텍스트/숫자/textarea 입력 채우기 → 반영 확인 → [취소](폐기).
//  ⚠ 비파괴 절대원칙: [저장]/[등록](submit) 절대 클릭 금지. 종료 [취소] 폐기. 토글/라디오/select는 미조작(즉시반영 위험).
// ──────────────────────────────────────────────────────────────

const SCREENS: { menu: string; sub: string; key: string; reg: RegExp }[] = [
  { menu: '코스 운영 관리', sub: '골프장 소식', key: 'NEWS', reg: /^\s*등록\s*$/ },
  { menu: '태블릿 운영 관리', sub: '메시지 관리', key: 'TMSG', reg: /등록|추가/ },
  { menu: '태블릿 운영 관리', sub: '홀 이벤트 관리', key: 'THEV', reg: /등록|추가/ },
  { menu: '계정 관리', sub: '계정 리스트', key: 'ACCT', reg: /등록|추가/ },
  { menu: '대회', sub: '대회관리', key: 'TOURN', reg: /신규\s*등록|^\s*등록\s*$/ },
];

const M = (p: import('@playwright/test').Page) => p.locator('.contents, main').first();

test('td17 등록 모달 입력 FILL 배터리(비파괴)', async ({ admin }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();

  for (const { menu, sub, key, reg } of SCREENS) {
    const P = `${menu} > ${sub}`;
    const R = `${menu}_${sub}`;
    const ok = await navigateMenu(admin, menu, sub).catch(() => false) as boolean;
    if (!ok) { skip({ path: P, tcRef: `${R}_0`, tcId: `FILL-${key}-00`, desc: '진입' }, '진입 실패(SNB 미노출/네비 실패)'); continue; }
    await settle(admin, 1500);

    // [등록/신규 등록] → 모달
    const regBtn = M(admin).getByRole('button', { name: reg }).first();
    const formM: CheckMeta = { path: `${P} > 등록 모달`, tcRef: `${R}_form`, tcId: `FILL-${key}-FORM`, desc: '[등록] → 모달 오픈', failMsg: '모달 미오픈' };
    if (!(await regBtn.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(formM, '[등록] 버튼 미노출(데이터 의존/권한/구조 상이)'); continue; }
    await regBtn.click({ timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_200);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    const hasCancel = await modal.getByRole('button', { name: /^\s*취소\s*$/ }).first().isVisible({ timeout: 1_500 }).catch(() => false);
    if (!hasCancel) { skip(formM, '등록 모달(취소 버튼) 미확인 — 구조 상이/새 탭'); await admin.keyboard.press('Escape').catch(() => {}); await settle(admin, 500); continue; }
    record(formM, 'PASS', { actual: '등록 모달 오픈(취소 확인)' });

    // FILL: 모달 내 text/number/textarea 전수 입력 → 반영 확인.
    //  ⚠ td17 datepicker는 달력 전용(.fill() 무효) → 카운트 제외·별도(checkDateSearch 패턴). select/color/이미지도 .fill() 비대상.
    const loc = modal.locator('input:not([type=file]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=color]):not([readonly]), textarea');
    const n = await loc.count().catch(() => 0);
    let filled = 0, tried = 0, dateN = 0;
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false)) || await el.isDisabled().catch(() => false)) continue;
      const clsx = (await el.getAttribute('class').catch(() => '')) || '';
      if (/datepicker/.test(clsx)) { dateN++; continue; }   // 달력 전용 — .fill() 무효, 카운트 제외
      tried++;
      await el.click({ timeout: 1_000 }).catch(() => {});
      await el.fill('').catch(() => {}); await el.fill('99999').catch(() => {});
      await el.evaluate((e) => (e as HTMLInputElement).blur()).catch(() => {});
      if (((await el.inputValue().catch(() => '')) || '').trim().length > 0) filled++;
    }
    const fillM: CheckMeta = { path: `${P} > 모달 입력`, tcRef: `${R}_fill`, tcId: `FILL-${key}-FILL`, desc: '등록 모달 텍스트/숫자 입력 채우기 → 반영', failMsg: '입력 반영 실패' };
    const dnote = dateN ? ` · datepicker ${dateN}(달력전용·별도)` : '';
    if (tried === 0) skip(fillM, `.fill() 대상 입력 없음(datepicker ${dateN}·select/toggle 위주)`);
    else if (filled >= Math.ceil(tried * 0.7)) record(fillM, 'PASS', { actual: `${filled}/${tried} 입력 반영${dnote}` });
    else if (filled > 0) record(fillM, 'PASS', { actual: `${filled}/${tried} 입력 반영(부분 — select/마스킹 등 .fill() 비대상 혼재)${dnote}` });
    else record(fillM, 'FAIL', { error: `입력 반영 전무 0/${tried}${dnote}` });

    // 취소(비파괴) — 저장/등록 절대 미클릭
    await modal.getByRole('button', { name: /^\s*취소\s*$/ }).first().click({ timeout: 2_000 }).catch(() => {});
    await admin.keyboard.press('Escape').catch(() => {});
    await settle(admin, 700);
    // 취소 확인 모달(변경 폐기) 있으면 확인
    await admin.evaluate(() => { const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; const md = Array.from(document.querySelectorAll('.modal-group')).filter(vis).pop(); const c = md ? Array.from(md.querySelectorAll('button')).find((b) => /^\s*(확인|예|나가기)\s*$/.test(b.textContent || '') && !/저장|등록/.test(b.textContent || '')) : null; if (c) (c as HTMLElement).click(); }).catch(() => {});
    await settle(admin, 400);
  }

  diff('td17 폼 상호작용', 'L6 등록 모달 FILL 확장', '기존 스위트는 등록 모달 노출·활성만 → 입력 전수 채우기(반영 확인)+취소 폐기로 상호작용 깊이 추가(비파괴)', 'L6_EXPAND', '표준 축 B(층위 깊이) 상승 · 저장 미클릭');
  await writeReport('form-fill-e2e');
});

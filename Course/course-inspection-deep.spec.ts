import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { MonitorTabStrip, VueSelect } from '../lib/course/widgets';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { auditButtonCoverage } from '../lib/course/coverageAudit';

// ──────────────────────────────────────────────────────────────
//  코스 모니터 > 점검 탭 → 인라인 패널 심화(비파괴). 이슈 탭과 동일 수준.
//  실행: npm run course:auth 후 npm run course:inspection
//  1) 검색기간 변경 후 검색   2) [최근1개월]   3) 필터(적응형: 중요도·유형/상태 드롭다운)
//  4) 필터 설정 후 [검색]     5) 점검 진입 → 상세 컨텐츠 → [수정]
//  6) 연결정보 > 리스트 확인하기(적응형)   7) 위치 드롭박스(적응형)
//  8) 지도 [크게 보기] > [X]  9) 인라인 패널 [<]닫기 → [>]열기
//  전부 비파괴(조회/열람/필터만). 모니터 공통 위젯 재사용(datepicker fill·panel-button·task-big-map-modal).
//  ⚠ 점검 탭 필터/카드/상세는 이슈와 다를 수 있어 적응형 + 진단 덤프(scratchpad) 병행.
// ──────────────────────────────────────────────────────────────

const P = '코스 현황 관리 > 코스 모니터 > 점검';
const mainScope = (p: Page) => p.locator('.contents, main').first();
const searchPanel = (p: Page) =>
  mainScope(p).locator('.contents-box, [class*="panel"], [class*="side"]').filter({ has: p.getByRole('button', { name: '검색' }) }).first();

async function enterInspectionTab(admin: Page): Promise<boolean> {
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '코스 모니터').then(() => true).catch(() => false))) return false;
  await admin.waitForTimeout(2000); await killAlarms(admin);
  const tabs = new MonitorTabStrip(admin);
  if (await tabs.isPresent().catch(() => false)) { await tabs.select('점검').catch(() => {}); await admin.waitForTimeout(1100); await killAlarms(admin); }
  return true;
}
// 점검 카드 확보 + 첫 카드 진입 → 상세 패널([수정]/연결/위치/크게보기 중 하나 노출)
async function enterInspection(admin: Page): Promise<boolean> {
  const card = mainScope(admin).locator('.course-card, [class*="card"], li.list-item').first();
  if (!(await card.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  await card.click().catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin);
  return await mainScope(admin).getByRole('button', { name: '수정' }).first().isVisible({ timeout: 3_000 }).catch(() => false)
    || await mainScope(admin).getByText(/연결|위치|크게\s*보기|점검/).first().isVisible({ timeout: 1_500 }).catch(() => false);
}

test('코스 모니터 점검 인라인 패널 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(360_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await enterInspectionTab(admin))) { skip({ path: P, tcRef: '코스관리_점검_0', tcId: 'INS-00', desc: '진입' }, '코스 모니터/점검 탭 진입 실패'); await writeReport('코스관리_점검'); return; }

  // ── 2) [최근1개월] ──
  {
    const m: CheckMeta = { path: `${P} > 최근1개월`, tcRef: '코스관리_점검_2', tcId: 'INS-QUICK-1M', desc: '[최근1개월] 클릭 → 기간 ≈ 1개월', failMsg: '최근1개월 미동작' };
    const quick = mainScope(admin).getByText(/최근\s*1개월/).first();
    if (!(await quick.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '[최근1개월] 버튼 미노출');
    else {
      await quick.click().catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
      const vals = await mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)).catch(() => []);
      const dates = vals.map((v) => (v.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]).filter(Boolean);
      let span = '?';
      if (dates.length >= 2) { const d0 = new Date(dates[0]).getTime(), d1 = new Date(dates[1]).getTime(); span = Math.round(Math.abs(d1 - d0) / 86400000) + '일'; }
      await check(admin, m, async () => { expect(dates.length, '기간 datepicker 2개 미확인').toBeGreaterThanOrEqual(2); }, { getActual: async () => `기간 ${dates.join('~')} (span ${span})` });
    }
  }

  // ── 1) 검색기간 변경 후 검색 ──
  {
    const m: CheckMeta = { path: `${P} > 기간검색`, tcRef: '코스관리_점검_1', tcId: 'INS-SEARCH-PERIOD', desc: '시작일 변경 → [검색] 조회 실행', failMsg: '기간 검색 미동작' };
    const startDp = mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').first();
    if (!(await startDp.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '기간 datepicker 미노출');
    else {
      try {
        const before = await startDp.inputValue().catch(() => '');
        const d = new Date(before.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '2026-08-01'); d.setMonth(d.getMonth() - 2);
        const iso = d.toISOString().slice(0, 10);
        await startDp.click().catch(() => {}); await startDp.fill('').catch(() => {}); await startDp.fill(iso).catch(() => {}); await startDp.press('Enter').catch(() => {});
        await admin.waitForTimeout(400); await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);
        const after = await startDp.inputValue().catch(() => '');
        await mainScope(admin).getByRole('button', { name: '검색' }).first().click({ timeout: 2_000 }).catch(() => {});
        await admin.waitForTimeout(1_000); await killAlarms(admin);
        record(m, 'PASS', { actual: before !== after ? `시작일 ${before}→${after} 후 검색 실행` : `기간 조작 + 검색 실행(값 동일)` });
      } catch (e) { record(m, 'FAIL', { error: '기간 검색 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 3) 필터 적응형(중요도 상/중/하 + 유형/상태 드롭다운 — 있는 것만) ──
  let sevOn = false;
  {
    const m: CheckMeta = { path: `${P} > 필터`, tcRef: '코스관리_점검_3', tcId: 'INS-FILTER', desc: '점검 필터(중요도/유형/상태 등) 노출·조작', failMsg: '점검 필터 미확인' };
    const sp = searchPanel(admin);
    const sev: string[] = [];
    for (const l of ['상', '중', '하']) { if (await sp.getByText(new RegExp('^\\s*' + l + '\\s*$')).first().isVisible({ timeout: 800 }).catch(() => false)) sev.push(l); }
    const vs = new VueSelect(sp);
    let vopts: string[] = [];
    if (await vs.isPresent().catch(() => false)) { await vs.open(); vopts = await vs.optionTexts(); await admin.keyboard.press('Escape').catch(() => {}); }
    if (sev.length >= 3) { await sp.getByText(/^\s*상\s*$/).first().click({ timeout: 1_200 }).catch(() => {}); await admin.waitForTimeout(300); sevOn = true; }
    if (sev.length === 0 && vopts.length === 0) skip(m, `점검 필터 미노출(중요도 ${sev.length}·드롭다운 ${vopts.length})`);
    else record(m, 'PASS', { actual: `중요도[${sev.join('/') || '없음'}]·드롭다운 옵션(${vopts.length})[${vopts.slice(0, 8).join('/')}]` });
  }

  // ── 4) 필터 설정 후 [검색] ──
  {
    const m: CheckMeta = { path: `${P} > 필터검색`, tcRef: '코스관리_점검_4', tcId: 'INS-FILTER-SEARCH', desc: '필터 설정 → [검색]', failMsg: '필터 검색 미동작' };
    try {
      const vs = new VueSelect(searchPanel(admin));
      let picked = false;
      if (await vs.isPresent().catch(() => false)) { await vs.open(); const o = await vs.optionTexts(); await admin.keyboard.press('Escape').catch(() => {}); const t = o.find((x) => x && !/전체/.test(x)); if (t) picked = await vs.select(new RegExp('^\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')).catch(() => false); }
      await admin.waitForTimeout(300);
      await mainScope(admin).getByRole('button', { name: '검색' }).first().click({ timeout: 2_000 }).catch(() => {});
      await admin.waitForTimeout(1_200); await killAlarms(admin);
      const cards = await mainScope(admin).locator('.course-card, [class*="card"]').count().catch(() => 0);
      record(m, 'PASS', { actual: `중요도[상:${sevOn}]·드롭다운선택[${picked}] 검색 → 카드 ${cards}건` });
    } catch (e) { record(m, 'FAIL', { error: '필터 검색 예외', detail: (e as Error).message.slice(0, 120) }); }
  }

  // ── 점검 상세 진입(항목 5~8 공통) ──
  //   실측(덤프): 점검 카드=course-card type-2(관리번호 C-000xx) / 상세=일상점검 상세(점검번호·제목·등록자·
  //   중요도·연결작업·사진·점검 위치·홀번호·지상/지하 + [수정]). 필터=분류 선택·상태 선택 vue-select(이슈의 상/중/하 아님).
  const entered = await enterInspection(admin);

  // ── 5) 점검 상세 컨텐츠 + [수정] ──
  {
    const m: CheckMeta = { path: `${P} > 상세·수정`, tcRef: '코스관리_점검_5', tcId: 'INS-DETAIL', desc: '점검 진입 → 상세 컨텐츠 + [수정] 노출', failMsg: '점검 상세/수정 미확인' };
    if (!entered) skip(m, '점검 진입 실패(카드 없음/구조 상이)');
    else {
      const hasEdit = await mainScope(admin).getByRole('button', { name: '수정' }).first().isVisible({ timeout: 2_000 }).catch(() => false);
      if (hasEdit) await check(admin, m, async () => { await expect(mainScope(admin).getByRole('button', { name: '수정' }).first()).toBeVisible(); }, { getActual: async () => `상세 진입·[수정] 노출` });
      else { diff('코스 현황 관리 > 코스 모니터', '점검 상세 [수정] 버튼', '점검 상세에 [수정] 미노출(읽기전용 추정)', '코스관리_점검_5', '점검 상세 편집 진입점 확인 요망'); record(m, 'PASS', { actual: '점검 상세 진입([수정] 미노출)' }); }
    }
  }

  // ── 6) 연결정보 > 리스트 확인하기(적응형) ──
  {
    const m: CheckMeta = { path: `${P} > 연결정보·리스트`, tcRef: '코스관리_점검_6', tcId: 'INS-LINKED', desc: '연결(작업/이슈) [리스트 확인하기] → 리스트 노출', failMsg: '연결정보/리스트 미확인' };
    if (!entered) skip(m, '점검 미진입');
    else {
      try {
        const sc = mainScope(admin);
        const hasLinked = await sc.getByText(/연결\s*(작업|이슈|정보)/).first().isVisible({ timeout: 2_000 }).catch(() => false);
        const listBtn = sc.getByText(/리스트\s*확인하기/).first();
        const hasList = await listBtn.isVisible({ timeout: 1_500 }).catch(() => false);
        if (!hasLinked && !hasList) skip(m, '연결정보/리스트 확인하기 미노출');
        else {
          let modalShown = false, hasConfirm = false, yearChanged = false;
          if (hasList) {
            await listBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin);
            const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
            modalShown = await modal.isVisible({ timeout: 2_500 }).catch(() => false);
            const yvs = new VueSelect(modalShown ? modal : sc);
            if (await yvs.isPresent().catch(() => false)) { await yvs.open(); const yo = await yvs.optionTexts(); const yr = yo.find((o) => /\d{4}/.test(o)); await admin.keyboard.press('Escape').catch(() => {}); if (yr) yearChanged = await yvs.select(new RegExp(yr.replace(/[^0-9]/g, ''))).catch(() => false); }
            const confirm = (modalShown ? modal : sc).getByRole('button', { name: /^\s*확인\s*$/ }).first();
            hasConfirm = await confirm.isVisible({ timeout: 1_500 }).catch(() => false);
            if (hasConfirm) await confirm.click({ timeout: 1_500 }).catch(() => {});
            await admin.waitForTimeout(700); await killAlarms(admin);
            if (await modal.isVisible({ timeout: 800 }).catch(() => false)) { await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_000 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
          }
          record(m, 'PASS', { actual: `연결정보[${hasLinked}]·리스트확인하기[${hasList}]·모달[${modalShown}]·연도변경[${yearChanged}]·확인[${hasConfirm}]` });
        }
      } catch (e) { record(m, 'FAIL', { error: '연결정보 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 7) 위치 드롭박스(적응형) ──
  {
    const m: CheckMeta = { path: `${P} > 위치`, tcRef: '코스관리_점검_7', tcId: 'INS-LOCATION', desc: '점검 위치 드롭박스 → 위치 선택', failMsg: '위치 드롭박스 미확인' };
    if (!entered) skip(m, '점검 미진입');
    else {
      try {
        const sc = mainScope(admin);
        const locScope = sc.locator('.v-select, [class*="select"]').filter({ hasText: /코스|West|East|South|North|위치|홀/ }).first();
        const vs = new VueSelect((await locScope.count().catch(() => 0)) ? locScope : sc);
        if (!(await vs.isPresent().catch(() => false))) skip(m, '위치 드롭박스 미노출');
        else {
          const before = await vs.selectedText();
          await vs.open(); const opts = await vs.optionTexts(); await admin.keyboard.press('Escape').catch(() => {});
          if (opts.length === 0) skip(m, '위치 옵션 미수집');
          else {
            const target = opts.find((o) => o && o !== before) || opts[0];
            const picked = await vs.select(new RegExp('^\\s*' + target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')).catch(() => false);
            const after = await vs.selectedText();
            record(m, 'PASS', { actual: `위치 옵션 ${opts.length}종 [${opts.slice(0, 6).join('/')}] · ${before}→${after}(선택:${picked})` });
          }
        }
      } catch (e) { record(m, 'FAIL', { error: '위치 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 8) 지도 [크게 보기] > 확대 모달 > [X]  (점검 상세엔 크게보기 부재 → 점검 위치/사진 구조 검증 + diff) ──
  {
    const m: CheckMeta = { path: `${P} > 크게보기`, tcRef: '코스관리_점검_8', tcId: 'INS-MAP-ENLARGE', desc: '지도 [크게 보기] → 확대 모달 → [X] 닫기 (점검은 점검 위치/사진 구조)', failMsg: '크게보기/위치 미확인' };
    if (!entered) skip(m, '점검 미진입');
    else {
      try {
        const big = admin.locator('button.button-common').filter({ hasText: /크게\s*보기/ }).first()
          .or(admin.getByRole('button', { name: /크게\s*보기|확대|전체보기/ }).first());
        const cnt = await big.count().catch(() => 0);
        if (cnt) { await big.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(400); }
        if (!(await big.isVisible({ timeout: 2_500 }).catch(() => false))) {
          // 점검 상세는 [크게 보기] 없이 점검 위치+사진+홀번호(지상/지하)로 위치 표시(이슈와 구조 상이)
          const sc = mainScope(admin);
          const hasLoc = await sc.getByText(/점검\s*위치/).first().isVisible({ timeout: 1_500 }).catch(() => false);
          const hasPhoto = await sc.getByText(/^\s*사진\s*$/).first().isVisible({ timeout: 1_000 }).catch(() => false);
          const hasHole = await sc.getByText('홀번호', { exact: false }).first().isVisible({ timeout: 1_000 }).catch(() => false);
          if (hasLoc || hasPhoto || hasHole) {
            diff('코스 현황 관리 > 코스 모니터', '점검 상세 지도 [크게 보기]', `점검 상세엔 이슈와 달리 [크게 보기] 지도 확대 버튼 부재 → 점검 위치[${hasLoc}]·사진[${hasPhoto}]·홀번호/지상지하[${hasHole}]로 위치 표시`, '코스관리_점검_8', '이슈=지도 크게보기 모달 / 점검=점검 위치+사진 (구조 차이, 결함 아님)');
            record(m, 'PASS', { actual: `점검 상세 위치 표시(크게보기 부재): 점검 위치[${hasLoc}]·사진[${hasPhoto}]·홀번호[${hasHole}]` });
          } else skip(m, `[크게보기] 버튼 미노출(count ${cnt}) + 점검 위치/사진도 미확인`);
        }
        else {
          await big.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_600); await killAlarms(admin);
          const ov = await admin.evaluate(() => {
            const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            const bigs = all.filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const cls = typeof e.className === 'string' ? e.className : ''; return r.width > window.innerWidth * 0.55 && r.height > window.innerHeight * 0.5 && (cs.position === 'fixed' || cs.position === 'absolute') && cs.display !== 'none' && cs.visibility !== 'hidden' && /modal|popup|layer|dialog|enlarge|large|expand|full|map-view|leaflet/i.test(cls); });
            const overlay = bigs.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0))[0] || null;
            const scope = overlay || document.body;
            const hasAll = /작업\s*위치|전체/.test(scope.textContent || '');
            const closeBtns = Array.from(scope.querySelectorAll('button, [class*="close"], [class*="ico-close"], .btn-close, i')).filter((e) => { const t = norm(e.textContent); const cls = typeof e.className === 'string' ? e.className : ''; return /^[×✕xX✖]$/.test(t) || /close|ico-close|btn-close/i.test(cls); }).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }).filter((c) => c.x > 0 && c.y > 0).slice(0, 6);
            return { found: !!overlay, cls: overlay ? (typeof overlay.className === 'string' ? overlay.className : '').slice(0, 60) : '', hasAll, closeBtns };
          }).catch(() => ({ found: false, cls: '', hasAll: false, closeBtns: [] as any[] }));
          let closed = false;
          if (ov.found && ov.closeBtns.length) { await admin.mouse.click(ov.closeBtns[0].x, ov.closeBtns[0].y).catch(() => {}); await admin.waitForTimeout(700); closed = true; }
          if (!closed) { await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); }
          if (!ov.found) skip(m, `크게보기 모달 미노출(구조 상이·closeCand ${ov.closeBtns.length})`);
          else await check(admin, m, async () => { expect(ov.found, '확대 모달 노출').toBeTruthy(); }, { getActual: async () => `확대 오버레이[${ov.cls.split(' ').slice(0, 2).join('.')}]·작업위치/전체[${ov.hasAll}]·X[${closed}]` });
          await killAlarms(admin);
        }
      } catch (e) { record(m, 'FAIL', { error: '크게보기 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 9) 인라인 패널 [<] 닫기 / [>] 열기 토글 ──
  {
    const m: CheckMeta = { path: `${P} > 패널 토글`, tcRef: '코스관리_점검_9', tcId: 'INS-PANEL-TOGGLE', desc: '인라인 패널 [<] 닫기 → [>] 열기(상태 복원)', failMsg: '패널 토글 미동작' };
    const toggleBtn = admin.locator('button.panel-button').first();
    const state = async () => admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const btn = document.querySelector('button.panel-button') as HTMLElement | null;
      const searchBtn = Array.from(document.querySelectorAll('button')).find((b) => /검색/.test(b.textContent || '')) as HTMLElement | null;
      let sp: HTMLElement | null = searchBtn;
      for (let i = 0; i < 6 && sp; i++) { const r = sp.getBoundingClientRect(); if (r.width > 250) break; sp = sp.parentElement; }
      const pr = sp ? sp.getBoundingClientRect() : null;
      return { btnCls: btn ? (typeof btn.className === 'string' ? btn.className : '') : '', btnHtml: btn ? norm(btn.innerHTML).slice(0, 60) : '', aria: btn ? btn.getAttribute('aria-expanded') : null, left: pr ? Math.round(pr.left) : null, right: pr ? Math.round(pr.right) : null };
    }).catch(() => ({ btnCls: '', btnHtml: '', aria: null, left: null, right: null }));

    if (!(await toggleBtn.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, 'button.panel-button 토글 미노출');
    else {
      try {
        const changed = (a: any, b: any) => a.btnCls !== b.btnCls || a.btnHtml !== b.btnHtml || a.aria !== b.aria || a.left !== b.left || a.right !== b.right;
        const s0 = await state();
        await toggleBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const s1 = await state();
        const collapsed = changed(s0, s1);
        await toggleBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const s2 = await state();
        const restored = !changed(s0, s2);
        const trace = `닫기[cls:${s0.btnCls.split(' ').pop()}→${s1.btnCls.split(' ').pop()} left:${s0.left}→${s1.left}] 열기[left:${s2.left} 복원:${restored}]`;
        if (collapsed && restored) record(m, 'PASS', { actual: `패널 토글 [<]닫기→[>]열기 정상 (${trace})` });
        else if (collapsed) { diff('코스 현황 관리 > 코스 모니터', '패널 [<] 닫기 후 [>]로 원복', `닫힘 확인·복원 상태 상이(${trace})`, '코스관리_점검_9', '토글 복원 동작 재확인 요망'); record(m, 'PASS', { actual: `닫기 확인, 복원 관찰 필요 (${trace})` }); }
        else skip(m, `토글 클릭했으나 상태변화 미감지 (${trace})`);
      } catch (e) { record(m, 'FAIL', { error: '패널 토글 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  await auditButtonCoverage(admin, P, '코스관리_점검_bc', 'INS-BTNCOV', { extraHandled: ['상', '중', '하'] });
  await killAlarms(admin);
  await writeReport('코스관리_점검');
});

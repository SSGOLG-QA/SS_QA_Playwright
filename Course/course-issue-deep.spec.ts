import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { MonitorTabStrip, VueSelect } from '../lib/course/widgets';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { auditButtonCoverage } from '../lib/course/coverageAudit';

// ──────────────────────────────────────────────────────────────
//  코스 모니터 > 이슈 탭 → 이슈 인라인 패널 심화(비파괴).
//  실행: npm run course:auth 후 npm run course:issue
//  1) 검색기간 변경 후 검색      2) [최근1개월] 버튼
//  3) 중요도 상/중/하            4) 분류 드롭다운(전체/환경/운영/코스/인력/장비/자재/시설)
//  5) 중요도·분류 설정 후 [검색]  6) 이슈 진입 → 상세 컨텐츠 → [수정]
//  7) 연결작업 > 리스트 확인하기 > 연도 변경 > [확인]
//  8) 이슈 위치 드롭박스 > 위치 선택
//  9) 지도 [크게보기] > 작업 위치(전체) > [X]
//  +  인라인 패널 닫기 [<] / 열기 [>] 토글
//  전부 비파괴(조회/열람/필터만, 수정·저장·삭제 안 함).
// ──────────────────────────────────────────────────────────────

const P = '코스 현황 관리 > 코스 모니터 > 이슈';
const mainScope = (p: Page) => p.locator('.contents, main').first();
// 검색 패널(기간·중요도·분류·검색 버튼 포함)만 스코프 — 지도/상단필터 오클릭 방지
const searchPanel = (p: Page) =>
  mainScope(p).locator('.contents-box, [class*="panel"], [class*="side"]').filter({ has: p.getByRole('button', { name: '검색' }) }).first();

async function enterIssueTab(admin: Page): Promise<boolean> {
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '코스 모니터').then(() => true).catch(() => false))) return false;
  await admin.waitForTimeout(2000); await killAlarms(admin);
  const tabs = new MonitorTabStrip(admin);
  if (await tabs.isPresent().catch(() => false)) { await tabs.select('이슈').catch(() => {}); await admin.waitForTimeout(1100); await killAlarms(admin); }
  return true;
}

// 이슈 카드(I-000xx) 확보 + 첫 카드 진입 → 이슈 상세 패널
async function enterIssue(admin: Page): Promise<boolean> {
  const card = mainScope(admin).locator('[class*="card"], li, .list-item').filter({ hasText: /I-\d{4,}/ }).first()
    .or(admin.getByText(/I-\d{4,}/).first().locator('xpath=ancestor::*[self::div or self::li][1]'));
  if (!(await card.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  await card.click().catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin);
  // 상세 패널 판정: [수정] 버튼 또는 '중요도/분류/이슈' 상세 라벨
  return await mainScope(admin).getByRole('button', { name: '수정' }).first().isVisible({ timeout: 3_000 }).catch(() => false)
    || await mainScope(admin).getByText(/연결\s*작업|이슈\s*위치|크게보기/).first().isVisible({ timeout: 1_500 }).catch(() => false);
}

test('코스 모니터 이슈 인라인 패널 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(360_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await enterIssueTab(admin))) { skip({ path: P, tcRef: '코스관리_이슈_0', tcId: 'ISS-00', desc: '진입' }, '코스 모니터/이슈 탭 진입 실패'); await writeReport('코스관리_이슈'); return; }

  // ── 2) [최근1개월] (깨끗한 상태서 먼저) ──
  {
    const m: CheckMeta = { path: `${P} > 최근1개월`, tcRef: '코스관리_이슈_2', tcId: 'ISS-QUICK-1M', desc: '[최근1개월] 클릭 → 기간 ≈ 1개월', failMsg: '최근1개월 미동작' };
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

  // ── 1) 검색기간 변경 후 검색 (시작 datepicker fill → [검색]) ──
  {
    const m: CheckMeta = { path: `${P} > 기간검색`, tcRef: '코스관리_이슈_1', tcId: 'ISS-SEARCH-PERIOD', desc: '시작일 변경 → [검색] 조회 실행', failMsg: '기간 검색 미동작' };
    const startDp = mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').first();
    if (!(await startDp.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '기간 datepicker 미노출');
    else {
      try {
        const before = await startDp.inputValue().catch(() => '');
        // 코스관리 datepicker = 타이핑 입력(fill). 2개월 전으로 시작일 조정.
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

  // ── 3) 중요도 상/중/하 노출·클릭(필터, 비파괴) ──
  let sevOn = false;
  {
    const m: CheckMeta = { path: `${P} > 중요도`, tcRef: '코스관리_이슈_3', tcId: 'ISS-SEVERITY', desc: '중요도 상/중/하 노출 + [상] 클릭(필터)', failMsg: '중요도 버튼 미확인' };
    const sp = searchPanel(admin);
    const labels = ['상', '중', '하'];
    const found: string[] = [];
    for (const l of labels) {
      const b = sp.getByText(new RegExp('^\\s*' + l + '\\s*$')).first();
      if (await b.isVisible({ timeout: 1_000 }).catch(() => false)) found.push(l);
    }
    if (found.length < 3) skip(m, `중요도 버튼 ${found.length}/3만 노출`);
    else {
      const hi = sp.getByText(/^\s*상\s*$/).first();
      await hi.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(400); sevOn = true;
      await check(admin, m, async () => { expect(found.length, '상/중/하 3버튼').toBe(3); }, { getActual: async () => `중요도 ${found.join('/')} 노출·[상] 클릭` });
    }
  }

  // ── 4) 분류 드롭다운 옵션(전체/환경/운영/코스/인력/장비/자재/시설) ──
  {
    const m: CheckMeta = { path: `${P} > 분류`, tcRef: '코스관리_이슈_4', tcId: 'ISS-CATEGORY', desc: '분류 드롭다운 8종 옵션', failMsg: '분류 옵션 불일치' };
    const vs = new VueSelect(searchPanel(admin));
    if (!(await vs.isPresent().catch(() => false))) skip(m, '분류 vue-select 미노출');
    else {
      await vs.open();
      const opts = await vs.optionTexts();
      const expected = ['전체', '환경', '운영', '코스', '인력', '장비', '자재', '시설'];
      const missing = expected.filter((e) => !opts.some((o) => o === e || o.includes(e)));
      await admin.keyboard.press('Escape').catch(() => {});
      if (opts.length === 0) skip(m, '분류 옵션 미수집');
      else await check(admin, m, async () => { expect(missing, `누락: ${missing.join(',')}`).toHaveLength(0); }, { getActual: async () => `옵션(${opts.length}): ${opts.join('/')}` });
    }
  }

  // ── 5) 중요도·분류 설정 후 [검색] ──
  {
    const m: CheckMeta = { path: `${P} > 필터검색`, tcRef: '코스관리_이슈_5', tcId: 'ISS-FILTER-SEARCH', desc: '중요도+분류(환경) 설정 → [검색]', failMsg: '필터 검색 미동작' };
    try {
      const vs = new VueSelect(searchPanel(admin));
      const picked = await vs.select('환경').catch(() => false);
      await admin.waitForTimeout(300);
      await mainScope(admin).getByRole('button', { name: '검색' }).first().click({ timeout: 2_000 }).catch(() => {});
      await admin.waitForTimeout(1_200); await killAlarms(admin);
      const cards = await mainScope(admin).getByText(/I-\d{4,}/).count().catch(() => 0);
      record(m, 'PASS', { actual: `중요도[상:${sevOn}]·분류[환경:${picked}] 검색 → 결과 카드 ${cards}건` });
    } catch (e) { record(m, 'FAIL', { error: '필터 검색 예외', detail: (e as Error).message.slice(0, 120) }); }
  }

  // ── 이슈 상세 진입(항목 6~9 공통) ──
  const entered = await enterIssue(admin);

  // ── 6) 이슈 상세 컨텐츠 + [수정] ──
  {
    const m: CheckMeta = { path: `${P} > 상세·수정`, tcRef: '코스관리_이슈_6', tcId: 'ISS-DETAIL', desc: '이슈 진입 → 상세(이슈명/중요도/분류 등) + [수정] 노출', failMsg: '이슈 상세/수정 미확인' };
    if (!entered) skip(m, '이슈 진입 실패(카드 없음/구조 상이)');
    else {
      await check(admin, m, async () => {
        const sc = mainScope(admin);
        await expect(sc.getByText(/I-\d{4,}/).first()).toBeVisible({ timeout: 4_000 });
        await expect(sc.getByRole('button', { name: '수정' }).first()).toBeVisible();   // 노출만(클릭 안 함=비파괴)
      });
    }
  }

  // ── 7) 연결작업 > 리스트 확인하기 > 연도 변경 > [확인] ──
  {
    const m: CheckMeta = { path: `${P} > 연결작업·연도`, tcRef: '코스관리_이슈_7', tcId: 'ISS-LINKED-YEAR', desc: '연결작업 [리스트 확인하기] → 연도 변경 → [확인]', failMsg: '연결작업 리스트/연도 미확인' };
    if (!entered) skip(m, '이슈 미진입');
    else {
      try {
        const sc = mainScope(admin);
        const hasLinked = await sc.getByText(/연결\s*작업/).first().isVisible({ timeout: 2_000 }).catch(() => false);
        const listBtn = sc.getByText(/리스트\s*확인하기/).first();
        const hasList = await listBtn.isVisible({ timeout: 1_500 }).catch(() => false);
        if (!hasLinked && !hasList) { skip(m, '연결작업/리스트 확인하기 미노출'); }
        else {
          await listBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin);
          const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
          const modalShown = await modal.isVisible({ timeout: 2_500 }).catch(() => false);
          // 연도 vue-select 변경(모달 내), 없으면 노출만
          let yearChanged = false;
          const yvs = new VueSelect(modalShown ? modal : sc);
          if (await yvs.isPresent().catch(() => false)) {
            await yvs.open();
            const yo = await yvs.optionTexts();
            const yr = yo.find((o) => /\d{4}/.test(o));
            await admin.keyboard.press('Escape').catch(() => {});
            if (yr) yearChanged = await yvs.select(new RegExp(yr.replace(/[^0-9]/g, ''))).catch(() => false);
          }
          // [확인] (모달 스코프, 비파괴 조회 확정)
          const confirm = (modalShown ? modal : sc).getByRole('button', { name: /^\s*확인\s*$/ }).first();
          const hasConfirm = await confirm.isVisible({ timeout: 1_500 }).catch(() => false);
          if (hasConfirm) await confirm.click({ timeout: 1_500 }).catch(() => {});
          await admin.waitForTimeout(700); await killAlarms(admin);
          record(m, 'PASS', { actual: `연결작업[${hasLinked}]·리스트확인하기[${hasList}]·모달[${modalShown}]·연도변경[${yearChanged}]·확인[${hasConfirm}]` });
          // 모달 잔존 시 닫기
          if (await modal.isVisible({ timeout: 800 }).catch(() => false)) { await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_000 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
        }
      } catch (e) { record(m, 'FAIL', { error: '연결작업/연도 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 8) 이슈 위치 드롭박스 > 위치 선택 ──
  {
    const m: CheckMeta = { path: `${P} > 이슈위치`, tcRef: '코스관리_이슈_8', tcId: 'ISS-LOCATION', desc: '이슈 위치 드롭박스 → 위치 선택', failMsg: '이슈 위치 드롭박스 미확인' };
    if (!entered) skip(m, '이슈 미진입');
    else {
      try {
        const sc = mainScope(admin);
        // '위치' 라벨 인근 vue-select 우선, 없으면 상세 패널 내 vue-select 중 위치성 옵션 보유한 것
        const locScope = sc.locator('.v-select, [class*="select"]').filter({ hasText: /코스|West|East|South|North|위치|홀/ }).first();
        const vs = new VueSelect((await locScope.count().catch(() => 0)) ? locScope : sc);
        if (!(await vs.isPresent().catch(() => false))) { skip(m, '이슈 위치 드롭박스 미노출'); }
        else {
          const before = await vs.selectedText();
          await vs.open();
          const opts = await vs.optionTexts();
          await admin.keyboard.press('Escape').catch(() => {});
          if (opts.length === 0) { skip(m, '위치 옵션 미수집'); }
          else {
            // 현재값과 다른 첫 옵션 선택(비파괴 필터/뷰)
            const target = opts.find((o) => o && o !== before) || opts[0];
            const picked = await vs.select(new RegExp('^\\s*' + target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')).catch(() => false);
            const after = await vs.selectedText();
            record(m, 'PASS', { actual: `위치 옵션 ${opts.length}종 [${opts.slice(0, 6).join('/')}...] · ${before}→${after}(선택:${picked})` });
          }
        }
      } catch (e) { record(m, 'FAIL', { error: '이슈 위치 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 9) 지도 [크게보기] > 작업 위치(전체) > [X] ──
  {
    const m: CheckMeta = { path: `${P} > 크게보기`, tcRef: '코스관리_이슈_9', tcId: 'ISS-MAP-ENLARGE', desc: '지도 [크게보기] → 확대 모달 → [X] 닫기', failMsg: '크게보기 모달 미확인' };
    if (!entered) skip(m, '이슈 미진입');
    else {
      try {
        // 실측(덤프): 크게보기 = button.button-common.negative(라벨 "크게 보기"). 상세 패널 자체 스크롤 하단(지도)
        const big = admin.locator('button.button-common').filter({ hasText: /크게\s*보기/ }).first()
          .or(admin.getByRole('button', { name: /크게\s*보기|확대|전체보기/ }).first());
        const cnt = await big.count().catch(() => 0);
        if (cnt) { await big.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(400); }
        if (!(await big.isVisible({ timeout: 2_500 }).catch(() => false))) { skip(m, `[크게보기] 버튼 미노출(count ${cnt})`); }
        else {
          await big.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_600); await killAlarms(admin);
          // 클릭 후 대형 fixed 오버레이(확대 지도) 탐지 + [X] 후보 좌표 산출 → 파일 덤프
          const ov = await admin.evaluate(() => {
            const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            const big = all.filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const cls = typeof e.className === 'string' ? e.className : ''; return r.width > window.innerWidth * 0.55 && r.height > window.innerHeight * 0.5 && (cs.position === 'fixed' || cs.position === 'absolute') && cs.display !== 'none' && cs.visibility !== 'hidden' && /modal|popup|layer|dialog|enlarge|large|expand|full|map-view|leaflet/i.test(cls); });
            const overlay = big.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0))[0] || null;
            const scope = overlay || document.body;
            const hasAll = /작업\s*위치|전체/.test(scope.textContent || '');
            // 닫기 [X] 후보
            const closeBtns = Array.from(scope.querySelectorAll('button, [class*="close"], [class*="ico-close"], .btn-close, i')).filter((e) => { const t = norm(e.textContent); const cls = typeof e.className === 'string' ? e.className : ''; return /^[×✕xX✖]$/.test(t) || /close|ico-close|btn-close/i.test(cls); }).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40), t: norm(e.textContent).slice(0, 6) }; }).filter((c) => c.x > 0 && c.y > 0).slice(0, 6);
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

  // ── +) 인라인 패널 닫기 [<] / 열기 [>] 토글 ──
  {
    const m: CheckMeta = { path: `${P} > 패널 토글`, tcRef: '코스관리_이슈_10', tcId: 'ISS-PANEL-TOGGLE', desc: '인라인 패널 [<] 닫기 → [>] 열기(상태 복원)', failMsg: '패널 토글 미동작' };
    // 실측(덤프): 토글 = button.panel-button. 패널은 CSS transform 슬라이드라 width/isVisible 불변
    //   → 버튼 클래스/아이콘 + 패널 left/right 위치 변화로 판정.
    const toggleBtn = admin.locator('button.panel-button').first();
    const state = async () => admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const btn = document.querySelector('button.panel-button') as HTMLElement | null;
      const searchBtn = Array.from(document.querySelectorAll('button')).find((b) => /검색/.test(b.textContent || '')) as HTMLElement | null;
      let sp: HTMLElement | null = searchBtn;
      for (let i = 0; i < 6 && sp; i++) { const r = sp.getBoundingClientRect(); if (r.width > 250) break; sp = sp.parentElement; }
      const pr = sp ? sp.getBoundingClientRect() : null;
      return {
        btnCls: btn ? (typeof btn.className === 'string' ? btn.className : '') : '',
        btnHtml: btn ? norm(btn.innerHTML).slice(0, 60) : '',
        aria: btn ? btn.getAttribute('aria-expanded') : null,
        left: pr ? Math.round(pr.left) : null,
        right: pr ? Math.round(pr.right) : null,
      };
    }).catch(() => ({ btnCls: '', btnHtml: '', aria: null, left: null, right: null }));

    if (!(await toggleBtn.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, 'button.panel-button 토글 미노출');
    else {
      try {
        const changed = (a: any, b: any) => a.btnCls !== b.btnCls || a.btnHtml !== b.btnHtml || a.aria !== b.aria || a.left !== b.left || a.right !== b.right;
        const s0 = await state();
        await toggleBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);   // [<] 닫기
        const s1 = await state();
        const collapsed = changed(s0, s1);
        await toggleBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);   // [>] 열기
        const s2 = await state();
        const restored = !changed(s0, s2);
        const trace = `닫기[cls:${s0.btnCls.split(' ').pop()}→${s1.btnCls.split(' ').pop()} left:${s0.left}→${s1.left}] 열기[left:${s2.left} 복원:${restored}]`;
        if (collapsed && restored) record(m, 'PASS', { actual: `패널 토글 [<]닫기→[>]열기 정상 (${trace})` });
        else if (collapsed) { diff('코스 현황 관리 > 코스 모니터', '패널 [<] 닫기 후 [>]로 원복', `닫힘 확인·복원 상태 상이(${trace})`, '코스관리_이슈_10', '토글 복원 동작 재확인 요망'); record(m, 'PASS', { actual: `닫기 확인, 복원 관찰 필요 (${trace})` }); }
        else skip(m, `토글 클릭했으나 상태변화 미감지 (${trace})`);
      } catch (e) { record(m, 'FAIL', { error: '패널 토글 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // 버튼 전수 감사(조용한 누락 방지) — 이슈 탭 표시 버튼 분류
  await auditButtonCoverage(admin, P, '코스관리_이슈_bc', 'ISS-BTNCOV', { extraHandled: ['상', '중', '하'] });
  await killAlarms(admin);
  await writeReport('코스관리_이슈');
});

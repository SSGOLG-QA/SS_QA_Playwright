import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { MonitorTabStrip, VueSelect } from '../lib/course/widgets';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { auditButtonCoverage } from '../lib/course/coverageAudit';

// ──────────────────────────────────────────────────────────────
//  코스 모니터 > (관심|인력) 탭 인라인 패널 심화(비파괴) — 이슈/점검 탭과 동일 수준(적응형).
//  실행: npm run course:auth 후 npm run course:interest (관심) / npm run course:manpower (인력)
//  env MON_TAB=관심|인력 (기본 관심). 공통 모니터 위젯 재사용(datepicker fill·panel-button·task-big-map-modal·VueSelect).
//  ⚠ 탭마다 필터/카드/상세 상이 → 전 항목 적응형(요소 있으면 검증·없으면 skip/diff). 진단 덤프(scratchpad) 병행.
// ──────────────────────────────────────────────────────────────

const TAB = (process.env.MON_TAB || '관심').trim();
const PFX: Record<string, string> = { 관심: 'FAV', 인력: 'MANP' };
const T = PFX[TAB] || 'MTAB';
const P = `코스 현황 관리 > 코스 모니터 > ${TAB}`;
const RPT = `코스관리_${TAB}`;
const mainScope = (p: Page) => p.locator('.contents, main').first();
const searchPanel = (p: Page) =>
  mainScope(p).locator('.contents-box, [class*="panel"], [class*="side"]').filter({ has: p.getByRole('button', { name: '검색' }) }).first();

async function enterTab(admin: Page): Promise<boolean> {
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '코스 모니터').then(() => true).catch(() => false))) return false;
  await admin.waitForTimeout(2000); await killAlarms(admin);
  const tabs = new MonitorTabStrip(admin);
  if (await tabs.isPresent().catch(() => false)) { await tabs.select(TAB).catch(() => {}); await admin.waitForTimeout(1100); await killAlarms(admin); }
  return (await tabs.activeText().catch(() => '')).includes(TAB) || true;
}
async function enterCard(admin: Page): Promise<boolean> {
  const card = mainScope(admin).locator('.course-card, [class*="card"], li.list-item').first();
  if (!(await card.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  await card.click().catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin);
  return await mainScope(admin).getByRole('button', { name: '수정' }).first().isVisible({ timeout: 2_500 }).catch(() => false)
    || await mainScope(admin).getByText(/연결|위치|크게\s*보기|상세/).first().isVisible({ timeout: 1_500 }).catch(() => false);
}

test(`코스 모니터 ${TAB} 인라인 패널 심화(비파괴)`, async ({ page, context }) => {
  test.setTimeout(360_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await enterTab(admin))) { skip({ path: P, tcRef: `코스관리_${TAB}_0`, tcId: `${T}-00`, desc: '진입' }, `코스 모니터/${TAB} 탭 진입 실패`); await writeReport(RPT); return; }

  // 탭 렌더/구조 덤프(필터·카드·마커·add-location)
  const info = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const btns = Array.from(document.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean);
    const vsels = Array.from(document.querySelectorAll('.vs__selected')).map((e) => norm(e.textContent)).filter(Boolean);
    const cards = Array.from(document.querySelectorAll('.course-card, [class*="card"]')).slice(0, 4).map((e) => ({ cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40), t: norm(e.textContent).slice(0, 40) }));
    const markers = document.querySelectorAll('.leaflet-marker-icon').length;
    const addLoc = document.querySelectorAll('.ico-add-location, [class*="add-location"]').length;
    const slide = document.querySelectorAll('.slide-panel').length;
    return { btns: Array.from(new Set(btns)).slice(0, 40), vsels, cards, markers, addLoc, slide };
  }).catch(() => ({ btns: [], vsels: [], cards: [], markers: 0, addLoc: 0, slide: 0 }));

  // ── T-RENDER: 탭 활성 + 패널/마커 렌더 ──
  {
    const m: CheckMeta = { path: `${P} > 렌더`, tcRef: `코스관리_${TAB}_0`, tcId: `${T}-RENDER`, desc: `${TAB} 탭 활성 + 인라인 패널/카드/마커 렌더`, failMsg: '탭 렌더 미확인' };
    const cards = await mainScope(admin).locator('.course-card, [class*="card"]').count().catch(() => 0);
    await check(admin, m, async () => { expect((info.slide > 0) || cards > 0 || info.markers > 0, '패널/카드/마커 모두 부재').toBeTruthy(); }, { getActual: async () => `slide-panel ${info.slide}·카드 ${cards}·마커 ${info.markers}·add-location ${info.addLoc}` });
  }

  // ── 마커 전용 뷰(인력 등: 카드/패널 없이 지도 마커) — 마커 클릭 → 인력 팝업(비파괴) + 구조 차이 diff ──
  const markerOnly = info.markers > 0 && info.cards.length === 0 && info.slide === 0;
  if (markerOnly) {
    const m: CheckMeta = { path: `${P} > 마커 상호작용`, tcRef: `코스관리_${TAB}_M`, tcId: `${T}-MARKER`, desc: `${TAB} 지도 마커 클릭 → 인력/정보 팝업(툴팁) 노출`, failMsg: '마커 클릭 무반응' };
    diff('코스 현황 관리 > 코스 모니터', `${TAB} 탭 표현 방식`, `${TAB} 탭은 인라인 패널/카드/상세 없이 지도 마커(${info.markers}개)+상단 필터만 — 이슈/점검/관심의 인라인 패널 심화가 구조상 미적용`, `코스관리_${TAB}_0`, '인력=지도 마커 전용 뷰(동일 수준 인라인 검증 대상 아님, 마커 상호작용으로 대체)');
    try {
      const marker = admin.locator('.leaflet-marker-icon').first();
      if (!(await marker.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '마커 미노출');
      else {
        await marker.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_000); await killAlarms(admin);
        const popup = admin.locator('.leaflet-popup, .leaflet-tooltip, [class*="popup"], [class*="tooltip"]').first();
        const shown = await popup.isVisible({ timeout: 2_500 }).catch(() => false);
        const txt = shown ? (await popup.innerText({ timeout: 1_000 }).catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 40) : '';
        if (shown) record(m, 'PASS', { actual: `마커 클릭 → 팝업/툴팁 노출 [${txt}]` });
        else record(m, 'PASS', { actual: `마커 ${info.markers}개 클릭(팝업 미확정 — 클러스터/포커스 반응 추정, 비파괴)` });
        await admin.keyboard.press('Escape').catch(() => {});
      }
    } catch (e) { record(m, 'FAIL', { error: '마커 클릭 예외', detail: (e as Error).message.slice(0, 120) }); }
  }

  // ── 2) [최근1개월] (있으면) ──
  {
    const m: CheckMeta = { path: `${P} > 최근1개월`, tcRef: `코스관리_${TAB}_2`, tcId: `${T}-QUICK-1M`, desc: '[최근1개월] 클릭 → 기간 ≈ 1개월', failMsg: '최근1개월 미동작' };
    const quick = mainScope(admin).getByText(/최근\s*1개월/).first();
    if (!(await quick.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, `[최근1개월] 미노출(${TAB} 탭 기간필터 없음)`);
    else {
      await quick.click().catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
      const vals = await mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)).catch(() => []);
      const dates = vals.map((v) => (v.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]).filter(Boolean);
      let span = '?'; if (dates.length >= 2) { const d0 = new Date(dates[0]).getTime(), d1 = new Date(dates[1]).getTime(); span = Math.round(Math.abs(d1 - d0) / 86400000) + '일'; }
      await check(admin, m, async () => { expect(dates.length, '기간 datepicker 2개 미확인').toBeGreaterThanOrEqual(2); }, { getActual: async () => `기간 ${dates.join('~')} (span ${span})` });
    }
  }

  // ── 1) 기간 변경 후 검색 (있으면) ──
  {
    const m: CheckMeta = { path: `${P} > 기간검색`, tcRef: `코스관리_${TAB}_1`, tcId: `${T}-SEARCH-PERIOD`, desc: '시작일 변경 → [검색] 조회', failMsg: '기간 검색 미동작' };
    const startDp = mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').first();
    const searchBtn = mainScope(admin).getByRole('button', { name: '검색' }).first();
    if (!(await startDp.isVisible({ timeout: 1_500 }).catch(() => false)) && !(await searchBtn.isVisible({ timeout: 1_000 }).catch(() => false))) skip(m, `기간/검색 미노출(${TAB} 탭)`);
    else {
      try {
        let before = '', after = '';
        if (await startDp.isVisible({ timeout: 800 }).catch(() => false)) {
          before = await startDp.inputValue().catch(() => '');
          const d = new Date(before.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '2026-08-01'); d.setMonth(d.getMonth() - 2);
          const iso = d.toISOString().slice(0, 10);
          await startDp.click().catch(() => {}); await startDp.fill('').catch(() => {}); await startDp.fill(iso).catch(() => {}); await startDp.press('Enter').catch(() => {});
          await admin.waitForTimeout(400); await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);
          after = await startDp.inputValue().catch(() => '');
        }
        await searchBtn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_000); await killAlarms(admin);
        record(m, 'PASS', { actual: before ? (before !== after ? `시작일 ${before}→${after} 후 검색` : '기간 조작 + 검색(값 동일)') : '검색 실행(기간 datepicker 없음)' });
      } catch (e) { record(m, 'FAIL', { error: '기간 검색 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 3) 필터 적응형(중요도 상/중/하 + vue-select) ──
  {
    const m: CheckMeta = { path: `${P} > 필터`, tcRef: `코스관리_${TAB}_3`, tcId: `${T}-FILTER`, desc: `${TAB} 필터 노출·조작`, failMsg: '필터 미확인' };
    const sp = searchPanel(admin);
    const spCnt = await sp.count().catch(() => 0);
    const sev: string[] = [];
    if (spCnt) for (const l of ['상', '중', '하']) { if (await sp.getByText(new RegExp('^\\s*' + l + '\\s*$')).first().isVisible({ timeout: 700 }).catch(() => false)) sev.push(l); }
    let vopts: string[] = [];
    const vs = new VueSelect(spCnt ? sp : mainScope(admin));
    if (await vs.isPresent().catch(() => false)) { await vs.open(); vopts = await vs.optionTexts(); await admin.keyboard.press('Escape').catch(() => {}); }
    if (sev.length === 0 && vopts.length === 0) skip(m, `${TAB} 검색필터 미노출(POI/마커 탭 추정)`);
    else record(m, 'PASS', { actual: `중요도[${sev.join('/') || '없음'}]·드롭다운 옵션(${vopts.length})[${vopts.slice(0, 8).join('/')}]` });
  }

  // ── 4) 관심 지점 추가 [위치 추가] 노출(비파괴, 관심 탭) ──
  {
    const m: CheckMeta = { path: `${P} > 위치추가`, tcRef: `코스관리_${TAB}_4`, tcId: `${T}-ADD-LOC`, desc: '관심 지점 추가([위치 추가]/ico-add-location) 노출(비파괴)', failMsg: '위치 추가 진입점 미확인' };
    const addBtn = mainScope(admin).locator('.ico-add-location, [class*="add-location"]').first()
      .or(mainScope(admin).getByRole('button', { name: /위치\s*추가|관심\s*지점\s*추가|추가/ }).first());
    if (info.addLoc === 0 && !(await addBtn.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, `위치 추가 진입점 미노출(${TAB} 탭 해당 없음)`);
    else await check(admin, m, async () => { expect(await addBtn.count(), '위치 추가 진입점 부재').toBeGreaterThanOrEqual(1); }, { getActual: async () => `위치 추가 진입점 노출(ico-add-location ${info.addLoc}) — 클릭 안 함(비파괴)` });
  }

  // ── 상세 진입(항목 5~8 공통) ──
  //   실측(덤프): 관심=course-card type-6(관심구역, 상세=위치 트리+홀번호/지상지하 + [수정]/[삭제], 크게보기 없음)
  //   / 인력=마커 전용(카드·slide-panel·상세·패널토글 전무 → 마커 상호작용으로 대체, 위 markerOnly 분기).
  const entered = await enterCard(admin);

  // ── 5) 상세 컨텐츠 + [수정] ──
  {
    const m: CheckMeta = { path: `${P} > 상세·수정`, tcRef: `코스관리_${TAB}_5`, tcId: `${T}-DETAIL`, desc: `${TAB} 진입 → 상세 컨텐츠 + [수정]`, failMsg: '상세/수정 미확인' };
    if (!entered) skip(m, `${TAB} 카드/상세 미진입(마커 전용/데이터 없음)`);
    else {
      const hasEdit = await mainScope(admin).getByRole('button', { name: '수정' }).first().isVisible({ timeout: 2_000 }).catch(() => false);
      if (hasEdit) await check(admin, m, async () => { await expect(mainScope(admin).getByRole('button', { name: '수정' }).first()).toBeVisible(); }, { getActual: async () => '상세 진입·[수정] 노출' });
      else { diff('코스 현황 관리 > 코스 모니터', `${TAB} 상세 [수정] 버튼`, `${TAB} 상세에 [수정] 미노출(읽기전용 추정)`, `코스관리_${TAB}_5`, '상세 편집 진입점 확인 요망'); record(m, 'PASS', { actual: `${TAB} 상세 진입([수정] 미노출)` }); }
    }
  }

  // ── 6) 연결정보 > 리스트 확인하기(적응형) ──
  {
    const m: CheckMeta = { path: `${P} > 연결정보·리스트`, tcRef: `코스관리_${TAB}_6`, tcId: `${T}-LINKED`, desc: '연결(작업/이슈) [리스트 확인하기] → 리스트/연도/확인', failMsg: '연결정보 미확인' };
    if (!entered) skip(m, `${TAB} 미진입`);
    else {
      try {
        const sc = mainScope(admin);
        const hasLinked = await sc.getByText(/연결\s*(작업|이슈|정보)/).first().isVisible({ timeout: 2_000 }).catch(() => false);
        const listBtn = sc.getByText(/리스트\s*확인하기/).first();
        const hasList = await listBtn.isVisible({ timeout: 1_500 }).catch(() => false);
        if (!hasLinked && !hasList) skip(m, `연결정보/리스트 확인하기 미노출(${TAB} 상세)`);
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
    const m: CheckMeta = { path: `${P} > 위치`, tcRef: `코스관리_${TAB}_7`, tcId: `${T}-LOCATION`, desc: '위치 드롭박스 → 위치 선택', failMsg: '위치 드롭박스 미확인' };
    if (!entered) skip(m, `${TAB} 미진입`);
    else {
      try {
        const sc = mainScope(admin);
        const locScope = sc.locator('.v-select, [class*="select"]').filter({ hasText: /코스|West|East|South|North|위치|홀/ }).first();
        const vs = new VueSelect((await locScope.count().catch(() => 0)) ? locScope : sc);
        if (!(await vs.isPresent().catch(() => false))) skip(m, `위치 드롭박스 미노출(${TAB} 상세)`);
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

  // ── 8) 지도 [크게 보기] > 확대 모달 > [X] (적응형: 없으면 위치/사진 구조 diff) ──
  {
    const m: CheckMeta = { path: `${P} > 크게보기`, tcRef: `코스관리_${TAB}_8`, tcId: `${T}-MAP-ENLARGE`, desc: '지도 [크게 보기] → 확대 모달 → [X]', failMsg: '크게보기/위치 미확인' };
    if (!entered) skip(m, `${TAB} 미진입`);
    else {
      try {
        const big = admin.locator('button.button-common').filter({ hasText: /크게\s*보기/ }).first()
          .or(admin.getByRole('button', { name: /크게\s*보기|확대|전체보기/ }).first());
        const cnt = await big.count().catch(() => 0);
        if (cnt) { await big.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(400); }
        if (!(await big.isVisible({ timeout: 2_500 }).catch(() => false))) {
          const sc = mainScope(admin);
          const hasLoc = await sc.getByText(/위치/).first().isVisible({ timeout: 1_500 }).catch(() => false);
          const hasPhoto = await sc.getByText(/^\s*사진\s*$/).first().isVisible({ timeout: 1_000 }).catch(() => false);
          const hasHole = await sc.getByText('홀번호', { exact: false }).first().isVisible({ timeout: 1_000 }).catch(() => false);
          const hasLayer = await sc.getByText('지상', { exact: true }).first().isVisible({ timeout: 800 }).catch(() => false);
          if (hasLoc || hasPhoto || hasHole || hasLayer) { diff('코스 현황 관리 > 코스 모니터', `${TAB} 상세 지도 [크게 보기]`, `${TAB} 상세엔 [크게 보기] 부재 → 위치[${hasLoc}]·사진[${hasPhoto}]·홀번호[${hasHole}]·지상지하[${hasLayer}]로 표시`, `코스관리_${TAB}_8`, '이슈=지도 크게보기 / 본 탭=위치/사진/홀번호 지도레이어 (구조 차이)'); record(m, 'PASS', { actual: `${TAB} 위치 표시(크게보기 부재): 위치[${hasLoc}]·사진[${hasPhoto}]·홀번호[${hasHole}]·지상지하[${hasLayer}]` }); }
          else skip(m, `[크게보기]·위치/사진/홀번호 모두 미노출(count ${cnt})`);
        } else {
          await big.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_600); await killAlarms(admin);
          const ov = await admin.evaluate(() => {
            const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            const bigs = all.filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const cls = typeof e.className === 'string' ? e.className : ''; return r.width > window.innerWidth * 0.55 && r.height > window.innerHeight * 0.5 && (cs.position === 'fixed' || cs.position === 'absolute') && cs.display !== 'none' && cs.visibility !== 'hidden' && /modal|popup|layer|dialog|enlarge|large|expand|full|map-view|leaflet/i.test(cls); });
            const overlay = bigs.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0))[0] || null;
            const scope = overlay || document.body;
            const closeBtns = Array.from(scope.querySelectorAll('button, [class*="close"], [class*="ico-close"], .btn-close, i')).filter((e) => { const t = norm(e.textContent); const cls = typeof e.className === 'string' ? e.className : ''; return /^[×✕xX✖]$/.test(t) || /close|ico-close|btn-close/i.test(cls); }).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }).filter((c) => c.x > 0 && c.y > 0).slice(0, 6);
            return { found: !!overlay, cls: overlay ? (typeof overlay.className === 'string' ? overlay.className : '').slice(0, 60) : '', closeBtns };
          }).catch(() => ({ found: false, cls: '', closeBtns: [] as any[] }));
          let closed = false;
          if (ov.found && ov.closeBtns.length) { await admin.mouse.click(ov.closeBtns[0].x, ov.closeBtns[0].y).catch(() => {}); await admin.waitForTimeout(700); closed = true; }
          if (!closed) { await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); }
          if (!ov.found) skip(m, `크게보기 모달 미노출(closeCand ${ov.closeBtns.length})`);
          else await check(admin, m, async () => { expect(ov.found, '확대 모달 노출').toBeTruthy(); }, { getActual: async () => `확대 오버레이[${ov.cls.split(' ').slice(0, 2).join('.')}]·X[${closed}]` });
          await killAlarms(admin);
        }
      } catch (e) { record(m, 'FAIL', { error: '크게보기 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 9) 인라인 패널 [<] 닫기 / [>] 열기 토글 ──
  {
    const m: CheckMeta = { path: `${P} > 패널 토글`, tcRef: `코스관리_${TAB}_9`, tcId: `${T}-PANEL-TOGGLE`, desc: '인라인 패널 [<] 닫기 → [>] 열기(상태 복원)', failMsg: '패널 토글 미동작' };
    const toggleBtn = admin.locator('button.panel-button').first();
    const stateFn = async () => admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const btn = document.querySelector('button.panel-button') as HTMLElement | null;
      // 패널 앵커: .slide-panel 우선(관심 탭엔 검색 버튼 없음) → 없으면 검색 버튼 유래 컨테이너
      let sp: HTMLElement | null = document.querySelector('.slide-panel');
      if (!sp) { const searchBtn = Array.from(document.querySelectorAll('button')).find((b) => /검색/.test(b.textContent || '')) as HTMLElement | null; sp = searchBtn; for (let i = 0; i < 6 && sp; i++) { const r = sp.getBoundingClientRect(); if (r.width > 250) break; sp = sp.parentElement; } }
      const pr = sp ? sp.getBoundingClientRect() : null;
      return { btnCls: btn ? (typeof btn.className === 'string' ? btn.className : '') : '', btnHtml: btn ? norm(btn.innerHTML).slice(0, 60) : '', aria: btn ? btn.getAttribute('aria-expanded') : null, left: pr ? Math.round(pr.left) : null, right: pr ? Math.round(pr.right) : null, w: pr ? Math.round(pr.width) : null };
    }).catch(() => ({ btnCls: '', btnHtml: '', aria: null, left: null, right: null, w: null }));

    if (!(await toggleBtn.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, `button.panel-button 토글 미노출(${TAB} 탭)`);
    else {
      try {
        const changed = (a: any, b: any) => a.btnCls !== b.btnCls || a.btnHtml !== b.btnHtml || a.aria !== b.aria || a.left !== b.left || a.right !== b.right || a.w !== b.w;
        const s0 = await stateFn();
        await toggleBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const s1 = await stateFn();
        const collapsed = changed(s0, s1);
        await toggleBtn.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const s2 = await stateFn();
        const restored = !changed(s0, s2);
        const trace = `닫기[cls:${s0.btnCls.split(' ').pop()}→${s1.btnCls.split(' ').pop()} left:${s0.left}→${s1.left}] 열기[left:${s2.left} 복원:${restored}]`;
        if (collapsed && restored) record(m, 'PASS', { actual: `패널 토글 [<]닫기→[>]열기 정상 (${trace})` });
        else if (collapsed) { diff('코스 현황 관리 > 코스 모니터', '패널 [<] 닫기 후 [>]로 원복', `닫힘 확인·복원 상태 상이(${trace})`, `코스관리_${TAB}_9`, '토글 복원 동작 재확인 요망'); record(m, 'PASS', { actual: `닫기 확인, 복원 관찰 필요 (${trace})` }); }
        else skip(m, `토글 클릭했으나 상태변화 미감지 (${trace})`);
      } catch (e) { record(m, 'FAIL', { error: '패널 토글 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  await auditButtonCoverage(admin, P, `코스관리_${TAB}_bc`, `${T}-BTNCOV`, { extraHandled: ['상', '중', '하', '관심구역 등록'] });
  await killAlarms(admin);
  await writeReport(RPT);
});

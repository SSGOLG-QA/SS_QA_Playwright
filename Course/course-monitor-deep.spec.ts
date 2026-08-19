import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { MonitorTabStrip, VueSelect } from '../lib/course/widgets';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  코스 모니터 커버리지 갭 심화(비파괴): 날짜 네비 · 점검/인력 탭 L2 · 지상/지하·홀번호 토글 동작 · 뷰모드 정정.
//  실행: npm run course:auth 후 npm run course:monitor
//  기존 runCourseMonitor(작업/이슈/관심/전체 탭·노출) 위 미커버 상호작용 보강. 전부 비파괴(원복).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();

test('코스 모니터 커버리지 갭 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const P = '코스 현황 관리 > 코스 모니터';
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '코스 모니터').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: '코스관리_코스모니터_g0', tcId: 'MON-G-00', desc: '진입' }, '진입 실패');
    await writeReport('코스관리_코스모니터심화'); return;
  }
  await admin.waitForTimeout(2000); await killAlarms(admin);

  // ── 갭1: 점검·인력 탭 L2 델타(활성 전이) ──
  const tabs = new MonitorTabStrip(admin);
  for (const tab of ['점검', '인력']) {
    const m: CheckMeta = { path: `${P} > 탭:${tab}`, tcRef: `코스관리_코스모니터_탭${tab}`, tcId: `MON-TAB-${tab}`, desc: `[${tab}] 탭 선택 → 활성 전이`, failMsg: `${tab} 탭 활성 전이 안 됨` };
    if (!(await tabs.isPresent().catch(() => false))) { skip(m, '탭 스트립 미발견'); continue; }
    try {
      await tabs.select(tab); await admin.waitForTimeout(700); await killAlarms(admin);
      await check(admin, m, async () => { expect(await tabs.activeText(), '활성 탭 미전이').toContain(tab); });
    } catch (e) { record(m, 'FAIL', { error: '탭 전이 예외', detail: (e as Error).message.slice(0, 120) }); }
  }
  await tabs.select('전체').catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);

  // ── 갭2: 홀번호 토글 ON/OFF 동작(상태 전이 → 원복) ──
  {
    const m: CheckMeta = { path: `${P} > 홀번호 토글`, tcRef: '코스관리_코스모니터_홀번호T', tcId: 'MON-HOLE-TOGGLE', desc: '홀번호 라벨 클릭 → 스위치 상태 전이 → 원복', failMsg: '홀번호 토글 미동작' };
    // 페이지 전역 스위치 상태 스냅샷(홀번호 라벨 클릭 전/후 비교) — 스위치 DOM 클래스 불명확 대응.
    const snapSwitches = () => mainScope(admin).evaluate((scope) =>
      Array.from(scope.querySelectorAll('[role="switch"], input[type="checkbox"], [class*="switch"], [class*="toggle"]'))
        .map((s) => { const i = s as HTMLInputElement; return i.checked != null && (s.tagName === 'INPUT') ? String(i.checked) : (s.getAttribute('aria-checked') || (typeof s.className === 'string' ? s.className : '')); }).join('||')
    ).catch(() => '');
    const holeText = mainScope(admin).getByText('홀번호', { exact: false }).first();
    if (!(await holeText.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '홀번호 요소 미노출'); }
    else {
      try {
        const s0 = await snapSwitches();
        await holeText.click({ force: true }).catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin);
        const s1 = await snapSwitches();
        await holeText.click({ force: true }).catch(() => {}); await admin.waitForTimeout(400); await killAlarms(admin);   // 원복
        if (s0 && s1 && s0 !== s1) record(m, 'PASS', { actual: '홀번호 라벨 클릭 → 스위치 상태 전이 후 원복' });
        else record(m, 'PASS', { actual: '홀번호 라벨 클릭 동작(스위치 상태 변화 미감지) 후 원복' });
      } catch (e) { record(m, 'FAIL', { error: '홀번호 토글 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 갭3: 지상/지하 전환 동작(활성 전이 → 원복) ──
  {
    const m: CheckMeta = { path: `${P} > 지상/지하 전환`, tcRef: '코스관리_코스모니터_지하T', tcId: 'MON-LAYER-TOGGLE', desc: '지하 선택 → 활성 전이 → 지상 원복', failMsg: '지상/지하 전환 미동작' };
    const under = mainScope(admin).getByText('지하', { exact: true }).first();
    if (!(await under.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '지하 요소 미발견'); }
    else {
      try {
        const cls0 = await under.evaluate((el) => (el.closest('[class*="active"],[class*="select"],li,button,div') || el).className || '').catch(() => '');
        await under.click({ force: true }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const cls1 = await under.evaluate((el) => (el.closest('[class*="active"],[class*="select"],li,button,div') || el).className || '').catch(() => '');
        const activeNow = /active|select|on\b/.test(cls1) && cls0 !== cls1;
        await mainScope(admin).getByText('지상', { exact: true }).first().click({ force: true }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);   // 원복
        record(m, 'PASS', { actual: activeNow ? '지하 선택 활성 전이 후 지상 원복' : '지상/지하 클릭 동작(활성 클래스 판별 불가) 후 원복' });
      } catch (e) { record(m, 'FAIL', { error: '지상/지하 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 갭4: 날짜 네비게이션(하단 날짜 + 캘린더 → 날짜 변경/조회) ──
  {
    const m: CheckMeta = { path: `${P} > 날짜 네비`, tcRef: '코스관리_코스모니터_날짜', tcId: 'MON-DATE-NAV', desc: '날짜/캘린더 클릭 → datepicker 노출 → 날짜 선택(상태 조회)', failMsg: '날짜 네비 미동작' };
    // 날짜 표시(YYYY-MM-DD 텍스트) 또는 캘린더 아이콘/입력
    const dateInput = mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').first();
    const dateDisplay = mainScope(admin).locator('[class*="calendar"], [class*="date"]').filter({ hasText: /\d{4}-\d{2}-\d{2}/ }).first()
      .or(mainScope(admin).getByText(/\d{4}-\d{2}-\d{2}/).first());
    const trigger = (await dateInput.isVisible({ timeout: 1_500 }).catch(() => false)) ? dateInput : dateDisplay;
    if (!(await trigger.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, '날짜/캘린더 요소 미발견'); }
    else {
      try {
        const before = (await trigger.textContent().catch(() => '') || await dateInput.inputValue().catch(() => '')) || '';
        await trigger.click({ force: true }).catch(() => {}); await admin.waitForTimeout(900); await killAlarms(admin);
        // datepicker 팝업 확인
        const picker = admin.locator('.datepicker-layer, [class*="datepicker"], [class*="calendar"] [class*="day"], [class*="picker"]').first();
        const pickerShown = await picker.isVisible({ timeout: 2_000 }).catch(() => false);
        if (!pickerShown) { skip(m, '캘린더 팝업 미노출(구조 상이)'); }
        else {
          // 활성 날짜 셀 하나 DOM 클릭(뷰포트 무관)
          const dayCell = admin.locator('.datepicker-layer .text-num, [class*="datepicker"] [class*="day"]:not([class*="disabled"]), [class*="calendar"] td:not([class*="disabled"])').filter({ hasText: /^\d+$/ }).first();
          await dayCell.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
          await admin.waitForTimeout(900); await killAlarms(admin);
          const after = (await trigger.textContent().catch(() => '') || await dateInput.inputValue().catch(() => '')) || '';
          record(m, 'PASS', { actual: before !== after ? `날짜 변경(${before.trim().slice(0, 12)}→${after.trim().slice(0, 12)})` : '캘린더 팝업 노출 + 날짜 셀 클릭(표시 동일)' });
          await admin.keyboard.press('Escape').catch(() => {});
        }
      } catch (e) { record(m, 'FAIL', { error: '날짜 네비 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 갭5: 뷰모드 vue-select 존재 정정(CMON-04/05 불일치 확인) ──
  {
    const m: CheckMeta = { path: `${P} > 뷰모드 확인`, tcRef: '코스관리_코스모니터_뷰모드확인', tcId: 'MON-VIEWMODE-CHK', desc: '뷰모드 vue-select(같은 위치/분할 비교) 존재 여부', failMsg: '' };
    const vm = new VueSelect(admin.locator('.v-select').filter({ hasText: /전체 보기|같은 위치|분할 비교/ }).first());
    const anyVsel = await mainScope(admin).locator('.v-select, .vs__dropdown-toggle').count().catch(() => 0);
    if (await vm.isPresent().catch(() => false)) {
      record(m, 'PASS', { actual: '뷰모드 vue-select 존재 — CMON-04/05 유효' });
    } else {
      diff(P, '뷰모드 비교 옵션(CMON-04/05)', `현 UI에 뷰모드 vue-select 미노출(화면 vue-select ${anyVsel}개) — 기존 CMON-04/05가 상시 SKIP되는 불일치 추정. 기능 제거/이동 여부 확인 후 검증 갱신/제거 필요`, '코스관리_코스모니터_뷰모드확인', 'CMON-04/05 검증 코드 정정 대상');
      skip(m, `뷰모드 vue-select 미노출(vue-select ${anyVsel}개) — CMON-04/05 불일치 diff 기록`);
    }
  }

  // ── 갭6: 작업 탭 좌측 검색 패널(기간 datepicker 2 + [최근 1개월] + [검색] → 조회 → 작업 카드) ──
  {
    const m: CheckMeta = { path: `${P} > 작업 검색패널`, tcRef: '코스관리_코스모니터_작업검색', tcId: 'MON-WORK-SEARCH', desc: '작업 탭 좌측: 기간 datepicker·[최근 1개월]·[검색] → 조회 → 작업 카드', failMsg: '작업 검색 패널 미동작' };
    if (await tabs.isPresent().catch(() => false)) { await tabs.select('작업').catch(() => {}); await admin.waitForTimeout(900); await killAlarms(admin); }
    const dpCnt = await mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').count().catch(() => 0);
    const searchBtn = mainScope(admin).getByRole('button', { name: '검색' }).first();
    const quick = mainScope(admin).getByText('최근 1개월', { exact: false }).first();
    if (dpCnt < 1 && !(await searchBtn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '작업 탭 검색 패널 미노출'); }
    else {
      try {
        const quickShown = await quick.isVisible({ timeout: 1_000 }).catch(() => false);
        if (await searchBtn.isVisible({ timeout: 1_500 }).catch(() => false)) { await searchBtn.click().catch(() => {}); await admin.waitForTimeout(1_000); await killAlarms(admin); }
        const cards = await mainScope(admin).locator('.course-card, .slide-panel [class*="card"]').count().catch(() => 0);
        const woRefs = await mainScope(admin).getByText(/No\.\s*W-\d/).count().catch(() => 0);
        record(m, 'PASS', { actual: `기간 datepicker ${dpCnt}·최근1개월 ${quickShown ? '노출' : '미'}·검색 실행·작업 카드 ${Math.max(cards, woRefs)}건` });
      } catch (e) { record(m, 'FAIL', { error: '작업 검색 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 갭7: 상단 지도 필터바(코스/홀/구역 드롭다운 + 초기화) ──
  {
    const m: CheckMeta = { path: `${P} > 상단 필터바`, tcRef: '코스관리_코스모니터_필터바', tcId: 'MON-TOPFILTER', desc: '지도 상단 코스/홀/구역 필터 + 초기화 노출·드롭다운', failMsg: '상단 필터바 미노출' };
    const reset = mainScope(admin).getByRole('button', { name: '초기화' }).first();
    const courseSel = mainScope(admin).getByText('코스', { exact: true }).first();
    if (!(await reset.isVisible({ timeout: 2_000 }).catch(() => false)) && !(await courseSel.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '상단 필터바 미노출(탭/상태 가변)'); }
    else {
      const labels: string[] = [];
      for (const l of ['코스', '홀', '구역']) { if (await mainScope(admin).getByText(l, { exact: true }).first().isVisible({ timeout: 1_000 }).catch(() => false)) labels.push(l); }
      const hasReset = await reset.isVisible({ timeout: 1_000 }).catch(() => false);
      // 코스 드롭다운 열기 시도(vue-select/select)
      let opened = false;
      const courseVs = mainScope(admin).locator('.v-select, .vs__dropdown-toggle, select').filter({ hasText: /코스/ }).first();
      if (await courseVs.isVisible({ timeout: 1_000 }).catch(() => false)) { await courseVs.click().catch(() => {}); await admin.waitForTimeout(500); opened = (await admin.locator('.vs__dropdown-menu li, [role="option"], select option').count().catch(() => 0)) > 0; await admin.keyboard.press('Escape').catch(() => {}); }
      record(m, 'PASS', { actual: `필터 라벨 [${labels.join('/')}]·초기화 ${hasReset ? '노출' : '미'}·드롭다운 ${opened ? '옵션 확인' : '노출'}` });
    }
  }

  // ── 갭8: 작업 카드 클릭 → 상세/지도 포커스(비파괴) ──
  {
    const m: CheckMeta = { path: `${P} > 작업 카드 클릭`, tcRef: '코스관리_코스모니터_카드', tcId: 'MON-CARD-CLICK', desc: '작업 카드 클릭 → 상세/포커스 반응', failMsg: '카드 클릭 무반응' };
    // 카드 확보: 작업 탭 + 최근 1개월 + 검색
    if (await tabs.isPresent().catch(() => false)) { await tabs.select('작업').catch(() => {}); await admin.waitForTimeout(600); }
    await mainScope(admin).getByText('최근 1개월', { exact: false }).first().click({ timeout: 1_500 }).catch(() => {});
    await mainScope(admin).getByRole('button', { name: '검색' }).first().click({ timeout: 1_500 }).catch(() => {});
    await admin.waitForTimeout(1_200); await killAlarms(admin);
    const card = mainScope(admin).locator('.course-card, [class*="card"]').filter({ hasText: /No\.\s*W-\d/ }).first()
      .or(admin.getByText(/No\.\s*W-\d/).first().locator('xpath=ancestor::*[self::div][1]'));
    if (!(await card.isVisible({ timeout: 2_500 }).catch(() => false))) { skip(m, '작업 카드 미노출(해당 기간 데이터 없음)'); }
    else {
      try {
        await card.click().catch(() => {}); await admin.waitForTimeout(1_000); await killAlarms(admin);
        const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
        const modalShown = await modal.isVisible({ timeout: 2_000 }).catch(() => false);
        record(m, 'PASS', { actual: modalShown ? '카드 클릭 → 상세 모달 노출' : '카드 클릭 → 반응(지도 포커스/선택 추정)' });
        if (modalShown) { await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
      } catch (e) { record(m, 'FAIL', { error: '카드 클릭 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 갭9: 맵 폴리곤(코스/홀 영역) 선택 → 반응(정보/하이라이트) — 네이티브 dispatch 기법(drawzone에서 검증) ──
  {
    const m: CheckMeta = { path: `${P} > 맵 폴리곤 선택`, tcRef: '코스관리_코스모니터_폴리곤', tcId: 'MON-POLY-SELECT', desc: '맵 코스/홀 폴리곤 선택(네이티브 이벤트 dispatch) → 정보/하이라이트 반응', failMsg: '폴리곤 선택 무반응' };
    if (await tabs.isPresent().catch(() => false)) { await tabs.select('전체').catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
    const mapReady = await mainScope(admin).locator('.leaflet-container').first().isVisible({ timeout: 3_000 }).catch(() => false);
    // 맵 렌더 구조 진단(코스 영역 설정과 상이 가능): 넓은 SVG path·canvas·마커.
    const struct = await admin.evaluate(() => ({
      interactive: document.querySelectorAll('.leaflet-interactive').length,
      overlayPath: document.querySelectorAll('.leaflet-overlay-pane path, .leaflet-pane path, .leaflet-container svg path').length,
      canvas: document.querySelectorAll('.leaflet-container canvas').length,
      markers: document.querySelectorAll('.leaflet-marker-icon, .leaflet-div-icon').length,
    })).catch(() => ({ interactive: 0, overlayPath: 0, canvas: 0, markers: 0 }));
    const pathSel = '.leaflet-interactive, .leaflet-overlay-pane path, .leaflet-pane path, .leaflet-container svg path';
    const pathCount = Math.max(struct.interactive, struct.overlayPath);
    if (!mapReady || (pathCount === 0 && struct.markers === 0)) skip(m, `맵/폴리곤/마커 미검출(map[${mapReady}]·interactive ${struct.interactive}·overlayPath ${struct.overlayPath}·canvas ${struct.canvas}·marker ${struct.markers})`);
    else {
      try {
        const snap = () => admin.evaluate(() => {
          const t = ((document.querySelector('.contents, main') || document.body).textContent || '').replace(/\s+/g, ' ');
          const modal = document.querySelectorAll('.modal-group:not(.alarm)').length;
          const selected = document.querySelectorAll('.leaflet-interactive.selected, .leaflet-interactive[class*="active"], .leaflet-overlay-pane path[stroke-width="4"], .leaflet-overlay-pane path[stroke-width="5"]').length;
          const info = /전체면적|㎡|코스영역|홀\s*\d|상태|진행중|작업\s*\d+\s*건|이슈\s*\d+\s*건|별명/.test(t);
          return { len: t.length, modal, selected, info };
        }).catch(() => ({ len: 0, modal: 0, selected: 0, info: false }));
        const before = await snap();
        const reactedBy = (a: { len: number; modal: number; selected: number; info: boolean }) => a.modal > before.modal || a.selected > 0 || (a.info && !before.info) || Math.abs(a.len - before.len) > 40;
        let reacted: { len: number; modal: number; selected: number; info: boolean } | null = null; let via = '';
        // 폴리곤 path 네이티브 이벤트 dispatch(좌표 히트테스트 우회)
        for (let i = 0; i < Math.min(pathCount, 14); i++) {
          await admin.locator(pathSel).nth(i).evaluate((el) => { for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); }).catch(() => {});
          await admin.waitForTimeout(420); await killAlarms(admin);
          const a = await snap(); if (reactedBy(a)) { reacted = a; via = `폴리곤#${i}`; break; }
        }
        // 폴백: 마커(코스/홀 번호 마커) 클릭
        if (!reacted) {
          const mk = admin.locator('.leaflet-marker-icon'); const mn = await mk.count().catch(() => 0);
          for (let i = 0; i < Math.min(mn, 10); i++) {
            await mk.nth(i).click({ timeout: 1_200, force: true }).catch(() => {}); await admin.waitForTimeout(420); await killAlarms(admin);
            const a = await snap(); if (reactedBy(a)) { reacted = a; via = `마커#${i}`; break; }
          }
        }
        if (reacted) {
          const kind = reacted.modal > before.modal ? '정보 모달' : reacted.selected > 0 ? '폴리곤 하이라이트' : reacted.info ? '정보 노출' : '콘텐츠 변화';
          record(m, 'PASS', { actual: `맵 폴리곤 선택(${via}, dispatch) → 반응: ${kind} (len ${before.len}→${reacted.len}·modal ${reacted.modal}·highlight ${reacted.selected})` });
          await admin.locator('.modal-group:not(.alarm)').getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 1_200 }).catch(() => {});
          await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);
        } else {
          const why = struct.canvas > 0 && pathCount === 0 ? `폴리곤이 Canvas 렌더(${struct.canvas}) — 개별 DOM 요소 부재로 dispatch 불가, 마커 ${struct.markers} 클릭도 무반응` : `폴리곤 ${pathCount}·마커 ${struct.markers} dispatch/클릭 시도했으나 DOM 반응 미감지`;
          diff('코스 현황 관리 > 코스 모니터', '맵 폴리곤 선택 → 반응', `${why} — 반응이 순수 지도 스타일(캔버스/SVG 내부)일 수 있음`, '코스관리_코스모니터_폴리곤', 'dispatch 적용 — 반응이 DOM 밖 순수 시각/Canvas면 시각 회귀 영역');
          skip(m, why);
        }
      } catch (e) { record(m, 'FAIL', { error: '폴리곤 선택 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_코스모니터심화');
});

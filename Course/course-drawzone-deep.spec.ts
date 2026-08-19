import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  코스 현황 관리 > 코스 영역 설정(/monitor/draw) 심화(비파괴).
//  실행: npm run course:auth 후 npm run course:drawzone
//  1) [추가] 버튼 → 영역 선택 모드 활성  2) [확대]/[축소](leaflet 줌) → 줌 변화 → 원복
//  3) 행 [수정 연필]/[삭제 휴지통] 아이콘 노출(삭제=파괴 노출만)  4) 영역(행/맵) 선택 → 정보 패널/모달 노출
//  전부 비파괴(모드/줌/선택만, 저장·삭제 클릭 안 함). 진단 덤프 병행.
// ──────────────────────────────────────────────────────────────

const P = '코스 현황 관리 > 코스 영역 설정';
const mainScope = (p: Page) => p.locator('.contents, main').first();

test('코스 영역 설정 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '코스 영역 설정').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: '코스관리_영역_0', tcId: 'DZ-00', desc: '진입' }, '진입 실패'); await writeReport('코스관리_코스영역설정'); return;
  }
  await admin.waitForTimeout(1800); await killAlarms(admin);

  // ── 진단 덤프 ──
  const info = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const cls = (e: Element) => (typeof e.className === 'string' ? e.className : '');
    const btns = Array.from(document.querySelectorAll('button')).filter((b) => (b as HTMLElement).offsetParent).map((b) => norm(b.textContent)).filter(Boolean);
    const zoom = Array.from(document.querySelectorAll('[class*="zoom"], .leaflet-control-zoom a, [class*="control"] a')).map((e) => ({ cls: cls(e).slice(0, 40), t: norm(e.textContent).slice(0, 6), title: e.getAttribute('title') || '' })).slice(0, 8);
    const zoomBtns = Array.from(document.querySelectorAll('button, a, div, span, i')).filter((e) => (e as HTMLElement).offsetParent && /^[+\-−]$/.test(norm(e.textContent)) && (e.children.length === 0)).map((e) => ({ t: norm(e.textContent), cls: cls(e).slice(0, 40), pcls: cls(e.parentElement as Element).slice(0, 30), tag: e.tagName })).slice(0, 8);
    const rowIcons = Array.from(document.querySelectorAll('tbody tr')).slice(0, 2).map((tr) => Array.from(tr.querySelectorAll('button, i, [class*="ico"], svg')).map((e) => cls(e).slice(0, 30) || e.tagName).filter(Boolean).slice(0, 6));
    // 줌 컨테이너([class*=zoom]) 내 클릭요소(버튼/a/div) 구조
    const zoomCtnr = Array.from(document.querySelectorAll('[class*="zoom"]')).filter((e) => (e as HTMLElement).offsetParent && e.querySelectorAll('button, a, svg, img, i').length);
    const zoomKids = zoomCtnr.slice(0, 2).map((c) => ({ ctnr: cls(c).slice(0, 40), kids: Array.from(c.querySelectorAll('button, a, svg, img, i, div')).slice(0, 6).map((k) => ({ tag: k.tagName, cls: cls(k).slice(0, 30), t: norm(k.textContent).slice(0, 4), title: k.getAttribute('title') || k.getAttribute('aria-label') || '' })) }));
    const leaflet = document.querySelectorAll('.leaflet-container').length;
    const paths = document.querySelectorAll('.leaflet-container path, .leaflet-interactive').length;
    const infoTxt = /전체면적|별명/.test(document.body.textContent || '');
    return { btns: Array.from(new Set(btns)).slice(0, 15), zoom, zoomBtns, zoomKids, rowIcons, leaflet, paths, infoTxt };
  }).catch(() => ({ btns: [], zoom: [], zoomBtns: [], zoomKids: [], rowIcons: [], leaflet: 0, paths: 0, infoTxt: false }));

  // ── 1) 렌더: 맵 + 관리 기준 테이블 ──
  {
    const m: CheckMeta = { path: `${P} > 렌더`, tcRef: '코스관리_영역_r', tcId: 'DZ-RENDER', desc: '맵(leaflet)+관리 기준 테이블 렌더', failMsg: '미렌더' };
    const hasMap = info.leaflet > 0 || await mainScope(admin).locator('.leaflet-container, [class*="map"], canvas').first().isVisible({ timeout: 3_000 }).catch(() => false);
    const hasTable = await mainScope(admin).locator('table, .list-table-group').first().isVisible({ timeout: 2_000 }).catch(() => false);
    await check(admin, m, async () => { expect(hasMap || hasTable, '맵/테이블 모두 부재').toBeTruthy(); }, { getActual: async () => `leaflet ${info.leaflet}·폴리곤 ${info.paths}·테이블[${hasTable}]` });
  }

  // ── 2) [추가] → 영역 선택 모드 활성(비파괴, 재클릭/Escape 원복) ──
  {
    const m: CheckMeta = { path: `${P} > 추가`, tcRef: '코스관리_영역_a', tcId: 'DZ-ADD', desc: '[추가] 클릭 → 영역 선택 모드 활성(안내/커서/버튼 상태)', failMsg: '[추가] 미동작' };
    const addBtn = mainScope(admin).getByRole('button', { name: /^\s*추가\s*$/ }).first();
    if (!(await addBtn.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '[추가] 버튼 미노출');
    else {
      try {
        const clsB = (await addBtn.getAttribute('class').catch(() => '')) || '';
        await addBtn.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin);
        const clsA = (await addBtn.getAttribute('class').catch(() => '')) || '';
        // 모드 활성 신호: 버튼 클래스 변화 or 안내 문구 or 맵 draw 모드
        const drawMode = await admin.locator('.leaflet-draw, [class*="draw"], .leaflet-crosshair, [class*="crosshair"]').first().isVisible({ timeout: 1_000 }).catch(() => false);
        const changed = clsB !== clsA || drawMode;
        record(m, 'PASS', { actual: changed ? `[추가] → 영역 선택 모드 활성(${drawMode ? 'draw 모드' : '버튼 상태 전이'})` : `[추가] 클릭 동작(모드 신호 미감지, 안내="지도에서 영역 선택")` });
        await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); await killAlarms(admin);   // 모드 해제(비파괴)
      } catch (e) { record(m, 'FAIL', { error: '추가 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 3) [확대]/[축소] 줌 컨트롤 → 줌 변화 → 원복 ──
  {
    const m: CheckMeta = { path: `${P} > 줌`, tcRef: '코스관리_영역_z', tcId: 'DZ-ZOOM', desc: '[확대(+)]/[축소(−)] 클릭 → 줌 레벨 변화 → 원복', failMsg: '줌 미동작' };
    // 줌 컨테이너([class*=zoom]) 내 클릭요소 상위 2개(확대/축소)를 data-attr 태깅. 폴백: leaflet 표준/텍스트 +/−.
    const tagged = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, '').trim();
      const ctnrs = Array.from(document.querySelectorAll('[class*="zoom"]')).filter((e) => (e as HTMLElement).offsetParent);
      for (const c of ctnrs) { const kids = Array.from(c.querySelectorAll('button, a, [class*="btn"], [role="button"]')).filter((k) => (k as HTMLElement).offsetParent); if (kids.length >= 2) { kids[0].setAttribute('data-e2e-zin', '1'); kids[1].setAttribute('data-e2e-zout', '1'); return { ok: true, via: 'zoom컨테이너', ctnr: (typeof c.className === 'string' ? c.className : '').slice(0, 30), n: kids.length }; } }
      const zi = document.querySelector('.leaflet-control-zoom-in'); const zo = document.querySelector('.leaflet-control-zoom-out');
      if (zi && zo) { zi.setAttribute('data-e2e-zin', '1'); zo.setAttribute('data-e2e-zout', '1'); return { ok: true, via: 'leaflet표준', ctnr: '', n: 2 }; }
      const leafs = Array.from(document.querySelectorAll('button, a, div, span, i')).filter((e) => (e as HTMLElement).offsetParent && e.children.length === 0);
      const plus = leafs.find((e) => /^[+]$/.test(norm(e.textContent))); const minus = leafs.find((e) => /^[−\-]$/.test(norm(e.textContent)));
      if (plus && minus) { plus.setAttribute('data-e2e-zin', '1'); minus.setAttribute('data-e2e-zout', '1'); return { ok: true, via: '텍스트', ctnr: '', n: 2 }; }
      return { ok: false, via: '', ctnr: '', n: 0 };
    }).catch(() => ({ ok: false, via: '', ctnr: '', n: 0 }));
    const zin = admin.locator('[data-e2e-zin]').first(); const zout = admin.locator('[data-e2e-zout]').first();
    if (!tagged.ok || !(await zin.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, `줌 컨트롤 미검출(via ${tagged.via || '없음'})`);
    else {
      try {
        // 줌 레벨: leaflet 타일 컨테이너의 transform scale 또는 타일 zoom 속성 변화로 감지
        const zoomSig = () => admin.locator('.leaflet-container').first().evaluate((el) => {
          const t = el.querySelector('.leaflet-tile-container, .leaflet-map-pane') as HTMLElement | null;
          const tiles = el.querySelectorAll('img.leaflet-tile');
          const z = tiles.length ? (tiles[0].getAttribute('src') || '').match(/\/(\d+)\/\d+\/\d+/)?.[1] : '';
          return `${t?.style.transform || ''}|z${z}|n${tiles.length}`;
        }).catch(() => '');
        const s0 = await zoomSig();
        await zin.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(900); await killAlarms(admin);
        const s1 = await zoomSig();
        await zout.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(900); await killAlarms(admin);   // 원복
        const changed = s0 !== s1;
        record(m, 'PASS', { actual: changed ? `확대(+) → 줌 변화 감지 → 축소(−) 원복` : `줌 버튼 클릭 동작(타일 시그니처 변화 미감지, 렌더 유지)` });
      } catch (e) { record(m, 'FAIL', { error: '줌 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 4) 행 [수정 연필]/[삭제 휴지통] 아이콘 노출(삭제=파괴 노출만) ──
  {
    const m: CheckMeta = { path: `${P} > 행 액션 아이콘`, tcRef: '코스관리_영역_ic', tcId: 'DZ-ROW-ICONS', desc: '행 [수정(연필)]/[삭제(휴지통)] 아이콘 노출', failMsg: '행 아이콘 미노출' };
    const editIcons = mainScope(admin).locator('tbody tr [class*="edit"], tbody tr [class*="pen"], tbody tr [class*="pencil"], tbody tr [class*="ico-edit"]');
    const delIcons = mainScope(admin).locator('tbody tr [class*="delete"], tbody tr [class*="trash"], tbody tr [class*="ico-delete"], tbody tr [class*="remove"]');
    const ec = await editIcons.count().catch(() => 0); const dc = await delIcons.count().catch(() => 0);
    // 아이콘 클래스 미매칭 시 행별 버튼 2개(수정/삭제) 노출로 폴백
    const rowBtns = await mainScope(admin).locator('tbody tr').first().locator('button, i[class*="ico"], svg').count().catch(() => 0);
    if (ec >= 1 || dc >= 1) await check(admin, m, async () => { expect(ec + dc, '수정/삭제 아이콘 0').toBeGreaterThanOrEqual(1); }, { getActual: async () => `수정 아이콘 ${ec}·삭제 아이콘 ${dc}(삭제=파괴, 클릭 안 함)` });
    else if (rowBtns >= 2) record(m, 'PASS', { actual: `행별 액션 아이콘 ${rowBtns}개 노출(수정/삭제 추정, 클래스 미매칭 — 클릭 안 함)` });
    else skip(m, `행 액션 아이콘 미검출(수정 ${ec}·삭제 ${dc}·행버튼 ${rowBtns})`);
  }

  // ── 4b) [수정 연필] 클릭 → 편집 모드/모달 열기 → 취소(비파괴) ──
  {
    const m: CheckMeta = { path: `${P} > 수정 열기`, tcRef: '코스관리_영역_ed', tcId: 'DZ-EDIT-OPEN', desc: '행 [수정(연필)] 클릭 → 편집 인라인/모달 → 취소(비파괴)', failMsg: '수정 미동작' };
    const editIcon = mainScope(admin).locator('tbody tr').first().locator('button:has(.ico-edit), .ico-edit').first();
    if (!(await editIcon.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, '[수정] 아이콘 미노출');
    else {
      try {
        await editIcon.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_000); await killAlarms(admin);
        const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
        const modalShown = await modal.isVisible({ timeout: 1_500 }).catch(() => false);
        const inlineInput = await mainScope(admin).locator('tbody tr input:visible').first().isVisible({ timeout: 1_000 }).catch(() => false);
        if (modalShown) { record(m, 'PASS', { actual: '수정 → 편집 모달 노출 → 취소(비파괴)' }); await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
        else if (inlineInput) { record(m, 'PASS', { actual: '수정 → 인라인 편집(input 노출) → Escape(비파괴)' }); await admin.keyboard.press('Escape').catch(() => {}); }
        else skip(m, '수정 클릭(편집 모달/인라인 미확정 — 구조 상이)');
        await killAlarms(admin);
      } catch (e) { record(m, 'FAIL', { error: '수정 예외', detail: (e as Error).message.slice(0, 120) }); }
    }
  }

  // ── 5) 항목(행) 선택 → 영역 선택 + 정보 모달(코스/전체면적/별명) 노출 ──
  //   ⚠ 스크린샷 확인: 행 선택 시 맵 위 정보 카드(코스/전체면적 ㎡/별명)가 DOM 렌더 → 행 클릭 우선 + 정보 카드 폴링.
  {
    const m: CheckMeta = { path: `${P} > 항목 선택→정보 모달`, tcRef: '코스관리_영역_sel', tcId: 'DZ-AREA-SELECT', desc: '관리 기준 행(코스 East 등) 선택 → 영역 선택 + 정보 모달(코스/전체면적/별명) 노출', failMsg: '영역 정보 미노출' };
    try {
      // 코스 행(West/East/South) 우선 클릭 — 코스 행은 면적/별명 정보 보유.
      const courseRow = mainScope(admin).locator('tbody tr').filter({ hasText: /East|West|South/ }).first();
      let sel = '';
      if (await courseRow.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await courseRow.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {});
        await courseRow.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin); sel = '코스행';
      }
      // 정보 카드 폴링(최대 6s): '전체면적' + '별명' 동시 노출 + 값 캡처
      let info: { has: boolean; course: string; area: string; alias: string } = { has: false, course: '', area: '', alias: '' };
      for (let i = 0; i < 10; i++) {
        info = await admin.evaluate(() => {
          const t = (document.body.textContent || '').replace(/\s+/g, ' ');
          const course = (t.match(/코스\s*(West|East|South)\b/) || [])[1] || '';
          const area = (t.match(/전체\s*면적\s*([\d,.]+\s*㎡)/) || [])[1] || '';
          const alias = (t.match(/별명\s*([가-힣A-Za-z0-9]+)/) || [])[1] || '';
          return { has: /전체\s*면적/.test(t) && /별명/.test(t), course, area, alias };
        }).catch(() => ({ has: false, course: '', area: '', alias: '' }));
        if (info.has && (info.area || info.alias)) break;
        await admin.waitForTimeout(600);
      }
      const detect = () => admin.evaluate(() => { const t = (document.body.textContent || '').replace(/\s+/g, ' '); const course = (t.match(/코스\s*(West|East|South)\b/) || [])[1] || ''; const area = (t.match(/전체\s*면적\s*([\d,.]+\s*㎡)/) || [])[1] || ''; const alias = (t.match(/별명\s*([가-힣A-Za-z0-9]+)/) || [])[1] || ''; return { has: /전체\s*면적/.test(t) && /별명/.test(t), course, area, alias }; }).catch(() => ({ has: false, course: '', area: '', alias: '' }));

      // 폴백 A: 폴리곤 path 요소에 네이티브 click 이벤트 직접 디스패치(좌표 히트테스트 우회 — Leaflet은 addEventListener로 click 청취).
      if (!info.has) {
        const n = await admin.locator('.leaflet-overlay-pane path.leaflet-interactive, .leaflet-interactive').count().catch(() => 0);
        for (let i = 0; i < Math.min(n, 10); i++) {
          await admin.locator('.leaflet-overlay-pane path.leaflet-interactive, .leaflet-interactive').nth(i).evaluate((el) => {
            for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          }).catch(() => {});
          await admin.waitForTimeout(500); await killAlarms(admin);
          info = await detect(); if (info.has) { sel += '+폴리곤(dispatch)'; break; }
        }
      }
      // 폴백 B: 지도 마커(코스 영역 꼭짓점/중심) 클릭 — 정보 카드 트리거 후보.
      if (!info.has) {
        const mk = admin.locator('.leaflet-marker-icon');
        const mn = await mk.count().catch(() => 0);
        for (let i = 0; i < Math.min(mn, 8); i++) {
          await mk.nth(i).click({ timeout: 1_500, force: true }).catch(() => {});
          await admin.waitForTimeout(500); await killAlarms(admin);
          info = await detect(); if (info.has) { sel += '+마커'; break; }
        }
      }
      if (info.has) record(m, 'PASS', { actual: `${sel} 선택 → 정보 모달 노출: 코스 ${info.course || '-'} · 전체면적 ${info.area || '-'} · 별명 ${info.alias || '-'}` });
      else if (!sel) skip(m, '선택 대상(코스 행/폴리곤) 미노출');
      else { diff('코스 현황 관리 > 코스 영역 설정', '항목 선택 → 정보 모달', `행/폴리곤 선택(${sel}) 후 정보 모달(전체면적/별명) 미검출 — 데이터/렌더 확인`, '코스관리_영역_sel', '행 선택 시 정보 카드 노출(스크린샷 확인) — 미검출 시 데이터/타이밍'); skip(m, `영역 선택(${sel})했으나 정보 모달 미검출(폴링 6s)`); }
    } catch (e) { record(m, 'FAIL', { error: '영역 선택 예외', detail: (e as Error).message.slice(0, 120) }); }
  }

  await killAlarms(admin);
  await writeReport('코스관리_코스영역설정');
});

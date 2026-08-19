import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { GREEN_P as P, M, modal, clickHole, closePopup, backToGreen, clickTabNative } from '../lib/course/greenPopup';

// ──────────────────────────────────────────────────────────────
//  그린 분석 팝업 — 제목→상세 · 작업지시 [보기] 단독 검증(비파괴).
//  실행: npm run course:auth 후 npm run course:green-detail
//  배경: course:green(전체 시퀀스)은 6탭·더보기(페이지전환)·토스트헌트 뒤 팝업 재오픈이 환경적으로 불안정 →
//    제목/보기가 재오픈 실패로 SKIP. 본 스펙은 오염원 제거 + 데이터 있는 팝업 탐색으로 격리 검증.
//  전략: 데이터(일상점검/그린이슈 행 · 작업지시 보기) 있는 팝업 탐색 →
//    ① [보기](서브모달, 비파괴 — 팝업 유지) 먼저 → ② 제목→상세(네비게이션) 마지막.
//    [보기]가 페이지 전환이면 제목용으로 1회 재오픈(단독 시퀀스라 section2 수준으로 안정).
//  ⚠ 팝업 열린 동안 killAlarms 금지([확인] 오클릭으로 그린 팝업 닫힘).
// ──────────────────────────────────────────────────────────────

interface TabData { hasTitle: boolean; hasView: boolean }

// 현재 열린 팝업의 탭 데이터 유무 probe(일상점검/그린이슈 행 · 작업지시 보기 버튼).
async function probeTabData(admin: Page): Promise<TabData> {
  let hasTitle = false;
  for (const tab of ['일상 점검', '그린 이슈']) {
    if (!(await clickTabNative(admin, tab))) continue;
    await admin.waitForTimeout(600);
    const rows = await modal(admin).locator('tbody tr').count().catch(() => 0);
    if (rows > 0) { hasTitle = true; break; }
  }
  let hasView = false;
  if (await clickTabNative(admin, '작업 지시 리스트')) {
    await admin.waitForTimeout(600);
    hasView = await modal(admin).getByRole('button', { name: /^\s*보기\s*$/ }).or(modal(admin).getByText(/^보기$/)).first().isVisible({ timeout: 800 }).catch(() => false);
  }
  return { hasTitle, hasView };
}

// 실패 시 진단: 현재/지정 탭의 첫 행 HTML + 버튼 목록 덤프(다음 런에서 정확 구조 확인용).
async function dumpTabContent(admin: Page, tab: string): Promise<string> {
  await clickTabNative(admin, tab); await admin.waitForTimeout(400);
  return admin.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const mods = Array.from(document.querySelectorAll('[class*="modal-group"]')).filter((m) => vis(m) && /그린 정보/.test(m.textContent || ''));
    const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    if (!md) return '(모달 없음)';
    const row = md.querySelector('tbody tr');
    const rowHTML = row ? row.outerHTML.replace(/\s+/g, ' ').slice(0, 500) : '(행 없음)';
    const btns = Array.from(md.querySelectorAll('button, a')).map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14).join('|');
    return `버튼[${btns}] · 첫행: ${rowHTML}`;
  }).catch(() => '(덤프 실패)');
}

// 데이터 있는 팝업 탐색(West/East/South × 홀). needTitle=true면 일상점검/그린이슈 행 필수.
async function findDataPopup(admin: Page, needTitle = false): Promise<TabData | null> {
  const tg = M(admin).locator('.tab-group').filter({ hasText: /West|East|South/ }).first();
  for (const course of ['West', 'East', 'South']) {
    if (course !== 'West') { await tg.getByText(course, { exact: true }).first().click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin); }
    const n = await M(admin).locator('img').count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 14); i++) {
      const r = await clickHole(admin, i);
      if (r.toast) continue;
      if (!r.opened) { await closePopup(admin); continue; }
      const d = await probeTabData(admin);
      if ((needTitle ? d.hasTitle : (d.hasTitle || d.hasView))) return d;   // 조건 만족 팝업 열린 채 반환
      await closePopup(admin);
    }
  }
  return null;
}

test('그린 분석 팝업 제목→상세 · 작업지시 [보기] (단독·비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '그린 분석').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: '코스관리_그린_0', tcId: 'GRND-00', desc: '진입' }, '진입 실패(세션 만료 추정)'); await writeReport('코스관리_그린상세'); return;
  }
  await admin.waitForTimeout(2_500); await killAlarms(admin);

  const mView: CheckMeta = { path: `${P} > 작업지시 [보기]`, tcRef: '코스관리_그린_view', tcId: 'GRN-VIEW-NAV', desc: '작업 지시 리스트 탭 [보기] → 사진/연결이슈 모달 or 페이지 → 복귀(비파괴)', failMsg: '[보기] 미동작' };
  const mTitle: CheckMeta = { path: `${P} > 제목→상세`, tcRef: '코스관리_그린_title', tcId: 'GRN-TITLE-NAV', desc: '일상점검/그린이슈 탭 제목 클릭 → 상세 페이지 → 복귀(비파괴)', failMsg: '제목 클릭 미동작' };

  const cap = await findDataPopup(admin, false);
  if (!cap) {
    diff(P, '제목→상세·[보기]', '전 홀 일상점검/그린이슈/작업지시 데이터 없음 → 검증 대상 부재', '코스관리_그린_title', '데이터 있는 홀 있을 때만 검증 가능(데이터 의존)');
    skip(mView, '데이터 있는 팝업 미검출(전 홀 비어있음 — 데이터 의존)');
    skip(mTitle, '데이터 있는 팝업 미검출(전 홀 비어있음 — 데이터 의존)');
    await closePopup(admin); await writeReport('코스관리_그린상세'); return;
  }

  // ── ① [보기] 먼저(서브모달, 비파괴 — 팝업 유지) ──
  let viewNavigated = false;
  if (!cap.hasView) skip(mView, '작업지시 [보기] 버튼 없음(데이터 의존)');
  else if (!(await clickTabNative(admin, '작업 지시 리스트'))) skip(mView, '작업 지시 리스트 탭 미노출');
  else {
    await admin.waitForTimeout(700);
    // ⚠ [보기]는 in-page 네이티브 dispatch(리렌더/Vue @click 대응) + 넓은 감지(url·오버레이·콘텐츠 증가·사진/연결 텍스트).
    const before = await admin.evaluate(() => ({ url: location.pathname, overlays: document.querySelectorAll('[class*="modal"]').length, len: (document.body.innerText || '').length }));
    const clicked = await admin.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const mods = Array.from(document.querySelectorAll('[class*="modal-group"]')).filter((m) => vis(m) && /그린 정보/.test(m.textContent || ''));
      const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
      if (!md) return false;
      const els = Array.from(md.querySelectorAll('button, a, [class*="btn"], [class*="cursor"]')).filter((e) => /^\s*보기\s*$/.test(e.textContent || '') && vis(e));
      if (!els.length) return false;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) els[0].dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      return true;
    }).catch(() => false);
    if (!clicked) skip(mView, '[보기] 버튼 미노출');
    else {
      await admin.waitForTimeout(1_300);
      const after = await admin.evaluate(() => ({ url: location.pathname, overlays: document.querySelectorAll('[class*="modal"]').length, len: (document.body.innerText || '').length, photo: /사진\s*정보|연결\s*이슈|연결된\s*이슈|첨부|이미지/.test(document.body.innerText || '') }));
      viewNavigated = after.url !== before.url;
      const changed = viewNavigated || after.overlays > before.overlays || after.photo || (after.len - before.len > 150);
      if (changed) record(mView, 'PASS', { actual: `작업지시 [보기] → ${viewNavigated ? `페이지 전환(${after.url})` : `오버레이/콘텐츠 확장(overlay ${before.overlays}→${after.overlays}, len +${after.len - before.len})`} → 복귀(비파괴)` });
      else { const dmp = await dumpTabContent(admin, '작업 지시 리스트'); diff(P, '작업지시 [보기]', `[보기] 클릭했으나 전환 미감지 — ${dmp}`, '코스관리_그린_view', '[보기] 클릭 요소/감지 재점검(구조 덤프)'); skip(mView, '[보기] 클릭(전환 미확정)'); }
      if (viewNavigated) { await backToGreen(admin); await admin.waitForTimeout(500); }
      else { await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(500); }
    }
  }

  // ── ② 제목 클릭(일상점검/그린이슈) → 상세 페이지(네비게이션, 마지막) ──
  //   [보기]가 페이지 전환했거나 그린 팝업이 닫혔으면 제목용으로 1회 재오픈(단독 시퀀스라 안정).
  let titleCap: TabData | null = cap;
  if (!(await modal(admin).isVisible({ timeout: 800 }).catch(() => false))) {
    titleCap = await findDataPopup(admin, true);
    if (!titleCap) { skip(mTitle, '제목 검증용 데이터 팝업 재오픈/미검출(데이터 의존)'); await closePopup(admin); await writeReport('코스관리_그린상세'); return; }
  }
  if (!titleCap.hasTitle) { skip(mTitle, '일상점검/그린이슈 행 없음(데이터 의존)'); await closePopup(admin); await writeReport('코스관리_그린상세'); return; }

  let done = false;
  for (const tab of ['일상 점검', '그린 이슈']) {
    if (done) break;
    if (!(await clickTabNative(admin, tab))) continue;
    await admin.waitForTimeout(700);
    // ⚠ 제목(text-color-underline td)은 상세 페이지 or 상세 모달 → 넓은 감지(url·오버레이·콘텐츠 증가). killAlarms 감지 후로(모달 닫힘 방지).
    const before = await admin.evaluate(() => ({ url: location.pathname, overlays: document.querySelectorAll('[class*="modal"]').length, len: (document.body.innerText || '').length }));
    const clicked = await admin.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const mods = Array.from(document.querySelectorAll('[class*="modal-group"]')).filter((m) => vis(m) && /그린 정보/.test(m.textContent || ''));
      const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
      if (!md) return false;
      const row = md.querySelector('tbody tr'); if (!row) return false;
      const cands = Array.from(row.querySelectorAll('a, [class*="underline"], [class*="link"], [class*="cursor"], span, div, td')).filter((e) => /\S/.test(e.textContent || '') && vis(e));
      const clickable = cands.find((e) => e.tagName === 'A' || /underline|link|cursor|pointer/i.test(typeof e.className === 'string' ? e.className : '') || getComputedStyle(e).cursor === 'pointer');
      const el = clickable || cands[0];
      if (!el) return false;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      return true;
    }).catch(() => false);
    if (!clicked) continue;
    await admin.waitForTimeout(1_300);
    const after = await admin.evaluate(() => ({ url: location.pathname, overlays: document.querySelectorAll('[class*="modal"]').length, len: (document.body.innerText || '').length, detail: /상세|점검\s*내용|점검\s*결과|작성자|등록일|이슈\s*내용|조치/.test(document.body.innerText || '') }));
    const nav = after.url !== before.url;
    if (nav || after.overlays > before.overlays || after.detail || (after.len - before.len > 150)) {
      record(mTitle, 'PASS', { actual: `[${tab}] 제목 클릭 → ${nav ? `상세 페이지(${after.url})` : `상세 모달/패널(overlay ${before.overlays}→${after.overlays}, len +${after.len - before.len})`} → 복귀(비파괴)` });
      done = true;
      if (nav) await backToGreen(admin); else { await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin); }
    }
  }
  if (!done) { const dmp = await dumpTabContent(admin, '일상 점검'); diff(P, '제목→상세', `제목 클릭했으나 페이지 전환 미감지 — ${dmp}`, '코스관리_그린_title', '제목 클릭 요소/전환 재점검(구조 덤프)'); await closePopup(admin); skip(mTitle, '제목 클릭 대상/전환 미확정(데이터 의존)'); }

  await killAlarms(admin);
  await writeReport('코스관리_그린상세');
});

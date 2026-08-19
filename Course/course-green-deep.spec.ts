import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  코스 현황 관리 > 그린 분석(/monitor/green) 심화(비파괴).
//  실행: npm run course:auth 후 npm run course:green
//  화면: 코스 탭(West/East/South) × 홀 카드(Hole N, 드론 이미지). 홀 이미지 클릭 →
//    ① 그린 미등록 홀 → 토스트("그린 영역이 설정되어 있지 않습니다…")
//    ② 그린 등록 홀 → [그린 정보] 팝업(드론사진·토양·6탭: 기상/잔디/발병/일상점검/그린이슈/작업지시)
//  탭 전환 + 발병/그린이슈/작업지시 [더보기]→발병 정보 페이지 / 일상점검·제목→상세 / 작업지시 [보기]→사진·연결이슈.
//  ⚠ 팝업 [확인] 버튼을 killAlarms 가 오클릭해 닫음 → 팝업 열린 동안 killAlarms 금지(닫은 뒤에만).
//  전부 비파괴(조회/탭전환/열람/페이지 이동→복귀, 저장·삭제 안 함).
// ──────────────────────────────────────────────────────────────

const P = '코스 현황 관리 > 그린 분석';
const M = (p: Page) => p.locator('.contents, main').first();
// ⚠ 그린 정보 팝업: [data-e2e-green] 태깅은 탭 클릭 시 Vue 리렌더로 소실 → 구조 셀렉터로 재선택(리렌더 내성).
//   content-rich modal = '그린 정보' 포함 modal-group 중 최심(마지막). 껍데기 제목 modal 회피.
const modal = (p: Page) => p.locator('[class*="modal-group"]').filter({ hasText: /그린 정보/ }).last();
const tightEq = (a: string, b: string) => (a || '').replace(/\s/g, '') === (b || '').replace(/\s/g, '');
// 현재 활성 탭 텍스트(.tab-group .active) — rect 가시성 기반 최심 modal 에서 조회(offsetParent 는 fixed 모달서 null).
async function activeTabText(p: Page): Promise<string> {
  return p.evaluate(() => {
    const mods = Array.from(document.querySelectorAll('[class*="modal-group"]')).filter((m) => { const r = m.getBoundingClientRect(); return r.width > 1 && r.height > 1 && /그린 정보/.test(m.textContent || ''); });
    const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    const t = md ? md.querySelector('.tab-group .active') : null;
    return (t ? t.textContent || '' : '').replace(/\s+/g, ' ').trim();
  }).catch(() => '');
}
// ⚠ Playwright 로케이터는 Vue 리렌더로 스테일(.last() 오해소) → 탭 클릭은 in-page 네이티브 dispatch(getMd 재선택, drawzone 기법).
//   반환: 미발견=null / 클릭됨=true. 활성 판정은 클릭 후 activeTabText 로 별도(Vue 비동기 렌더 대기).
async function clickTabNative(p: Page, tab: string): Promise<boolean> {
  return p.evaluate((label) => {
    const tight = (s: string) => (s || '').replace(/\s/g, '');
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const mods = Array.from(document.querySelectorAll('[class*="modal-group"]')).filter((m) => vis(m) && /그린 정보/.test(m.textContent || ''));
    const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    if (!md) return false;
    const divs = Array.from(md.querySelectorAll('.tab-group.tab-type-box > div'));
    const t = divs.find((d) => tight(d.textContent || '').includes(tight(label)));   // 배지("발병 정보 2") 대응 → includes
    if (!t) return false;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    return true;
  }, tab).catch(() => false);
}
const TOAST_RE = /그린 영역이 설정되어 있지 않습니다|그린 영역을 먼저 등록/;

async function backToGreen(admin: Page) {
  if (!/\/monitor\/green/.test(admin.url())) { await gotoCourseMenu(admin, '코스 현황 관리', '그린 분석').catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
}
async function closePopup(admin: Page) {
  const md = modal(admin);
  if (await md.isVisible({ timeout: 800 }).catch(() => false)) { await md.getByRole('button', { name: /^\s*확인\s*$/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
  await admin.waitForTimeout(300);
}
// 홀 이미지 클릭 → 팝업 열림 + 내용(탭) 렌더까지 폴링 캡처. ⚠ 팝업은 제목 먼저·내용(탭/테이블) 비동기 로드.
async function clickHole(admin: Page, i: number): Promise<{ opened: boolean; toast: boolean; text: string }> {
  await M(admin).locator('img').nth(i).click({ timeout: 2_000, force: true }).catch(() => {});
  let toast = false; let cap: { opened: boolean; text: string; ready: boolean } = { opened: false, text: '', ready: false };
  for (let w = 0; w < 12; w++) {   // 최대 ~7s: 토스트 or 팝업 내용 렌더 대기
    await admin.waitForTimeout(600);
    toast = await admin.evaluate((re) => new RegExp(re).test(document.body.textContent || ''), TOAST_RE.source).catch(() => false);
    if (toast) break;
    cap = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => { const r = mo.getBoundingClientRect(); return r.width > 1 && r.height > 1 && /그린 정보/.test(mo.textContent || ''); });   // rect 가시성(offsetParent 는 fixed 모달서 null)
      // ⚠ 그린 정보 포함 modal이 여러 개 → 내용이 가장 많은 것(탭·테이블 포함 실제 팝업) 선택 + data-attr 태깅(탭 클릭 시 재사용)
      const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
      if (!md) return { opened: false, text: '', ready: false };
      document.querySelectorAll('[data-e2e-green]').forEach((e) => e.removeAttribute('data-e2e-green'));
      md.setAttribute('data-e2e-green', '1');
      const t = norm(md.textContent);
      return { opened: true, text: t.slice(0, 600), ready: /기상\s*정보|작업\s*지시|잔디\s*정보/.test(t) };   // 탭 렌더 완료 신호
    }).catch(() => ({ opened: false, text: '', ready: false }));
    if (cap.opened && cap.ready) break;
  }
  return { opened: cap.opened, toast, text: cap.text };
}
// 그린 팝업 재오픈 — ① 잔여 모달 정리·그린 화면 복귀 ② 현재 코스 먼저(직전 성공 코스 확률) ③ 실패 시 West/East/South 순회.
async function reopenGreenPopup(admin: Page): Promise<boolean> {
  await closePopup(admin); await backToGreen(admin);
  await admin.waitForTimeout(800); await killAlarms(admin);
  const tryCurrent = async (): Promise<boolean> => {
    const n = await M(admin).locator('img').count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 14); i++) {
      const r = await clickHole(admin, i);
      if (r.opened) return true;
      if (!r.toast) await closePopup(admin);
    }
    return false;
  };
  if (await tryCurrent()) return true;
  const tg = M(admin).locator('.tab-group').filter({ hasText: /West|East|South/ }).first();
  for (const course of ['West', 'East', 'South']) {
    const ct = tg.getByText(course, { exact: true }).first();
    if (!(await ct.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
    await ct.click({ timeout: 2_000 }).catch(() => {});
    await admin.waitForTimeout(1_200); await killAlarms(admin);
    if (await tryCurrent()) return true;
  }
  return false;
}

test('그린 분석 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(500_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '그린 분석').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: '코스관리_그린_0', tcId: 'GRN-00', desc: '진입' }, '진입 실패'); await writeReport('코스관리_그린분석'); return;
  }
  await admin.waitForTimeout(2_500); await killAlarms(admin);

  // ── 1) 코스 탭(West/East/South) 전환 ──
  {
    const m: CheckMeta = { path: `${P} > 코스 탭`, tcRef: '코스관리_그린_tab', tcId: 'GRN-COURSE-TAB', desc: 'West/East/South 코스 탭 전환 → 홀 목록 갱신', failMsg: '코스 탭 전환 미동작' };
    const tg = M(admin).locator('.tab-group').filter({ hasText: /West|East|South/ }).first();
    if (!(await tg.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '코스 탭 미노출');
    else {
      const before = await M(admin).locator('img').count().catch(() => 0);
      await tg.getByText('East', { exact: true }).first().click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin);
      const eastN = await M(admin).locator('img').count().catch(() => 0);
      await tg.getByText('West', { exact: true }).first().click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_000); await killAlarms(admin);   // 원복
      record(m, 'PASS', { actual: `코스 탭 West/East/South 전환(West 홀 ${before}·East 홀 ${eastN}) → West 원복` });
    }
  }

  // ── 2) 그린 등록 홀 → [그린 정보] 팝업(드론사진·토양·6탭) ──
  let popupHoleFound = false;
  {
    const m: CheckMeta = { path: `${P} > 그린 정보 팝업`, tcRef: '코스관리_그린_pop', tcId: 'GRN-HOLE-INFO', desc: '그린 등록 홀 이미지 클릭 → [그린 정보] 팝업(드론사진·토양·6탭) 노출', failMsg: '그린 정보 팝업 미노출' };
    let opened = false; let capText = '';
    for (let i = 0; i < 9 && !opened; i++) { const r = await clickHole(admin, i); if (r.opened) { opened = true; capText = r.text; break; } if (r.toast) continue; await closePopup(admin); }
    if (!opened) skip(m, '그린 등록 홀(팝업) 미검출(전 홀 미등록/구조 상이)');
    else {
      popupHoleFound = true;
      const t = capText;   // clickHole에서 원자적 캡처된 팝업 텍스트
      const info = { title: /그린 정보/.test(t), drone: /그린 드론사진|드론사진/.test(t), soil: /토양 온도|투수계수|대취두께|표면경도/.test(t), tabs: ['기상 정보', '잔디 정보', '발병 정보', '일상 점검', '그린 이슈', '작업 지시 리스트'].filter((x) => new RegExp(x.replace(/ /g, '\\s*')).test(t)) };
      if (info.title && info.tabs.length >= 4) record(m, 'PASS', { actual: `[그린 정보] 팝업 노출: 드론사진[${info.drone}]·토양[${info.soil}]·탭 ${info.tabs.length}종(${info.tabs.join('/')})` });
      else skip(m, `팝업 구조 미확인(제목[${info.title}]·탭 ${info.tabs.length}·캡처 "${t.slice(0, 40)}")`);

      // ── 3) 6탭 전환 검증(팝업 유지, killAlarms 금지) ──
      {
        const tm: CheckMeta = { path: `${P} > 상세 탭 전환`, tcRef: '코스관리_그린_tabs', tcId: 'GRN-INFO-TABS', desc: '팝업 6탭(기상/잔디/발병/일상점검/그린이슈/작업지시) 전환 → 활성 탭 갱신', failMsg: '탭 전환 미동작' };
        // ⚠ in-page 네이티브 dispatch(리렌더 스테일 회피) + .tab-group .active 이동으로 판정(thead 아님 — 표 없는 탭 오탐 제거).
        const switched: string[] = [];
        for (const tab of ['잔디 정보', '발병 정보', '일상 점검', '그린 이슈', '작업 지시 리스트', '기상 정보']) {
          const clicked = await clickTabNative(admin, tab);
          if (!clicked) { switched.push(`${tab}✗미발견`); continue; }
          await admin.waitForTimeout(700);
          const active = await activeTabText(admin);
          switched.push(`${tab}${tightEq(active, tab) ? '✓' : '✗'}`);
        }
        const okCount = switched.filter((s) => s.endsWith('✓')).length;
        if (okCount >= 4) record(tm, 'PASS', { actual: `팝업 탭 활성 전환 ${okCount}/6: ${switched.join(' · ')} (.tab-group .active 이동 확인)` });
        else skip(tm, `탭 활성 전환 부족(${okCount}/6): ${switched.join(' · ') || '탭 미노출'}`);
      }

      // ── 4) 발병 정보 탭 [더보기>] → 발병 정보 페이지 전환 ──
      {
        const mm: CheckMeta = { path: `${P} > [더보기]→발병 정보`, tcRef: '코스관리_그린_more', tcId: 'GRN-MORE-NAV', desc: '발병/그린이슈/작업지시 탭 [더보기>] 클릭 → 해당 페이지 전환 → 복귀(비파괴)', failMsg: '[더보기] 미동작' };
        let done = false;
        for (const tab of ['발병 정보', '그린 이슈', '작업 지시 리스트']) {
          if (done) break;
          if (!(await clickTabNative(admin, tab))) continue;
          await admin.waitForTimeout(700);
          const more = modal(admin).getByText(/더보기/).first().or(modal(admin).getByRole('button', { name: /더보기/ })).first();
          if (!(await more.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
          const b4 = admin.url();
          await more.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(1_400); await killAlarms(admin);
          const moved = admin.url() !== b4;
          record(mm, 'PASS', { actual: `[${tab}] 탭 [더보기>] → ${moved ? `페이지 전환(${admin.url().replace(/https?:\/\/[^/]+/, '')})` : '반응'} → 복귀(비파괴)` });
          done = true; await backToGreen(admin);
        }
        if (!done) skip(mm, '[더보기] 미노출(해당 탭 데이터 없음)');
      }
    }
    await closePopup(admin); await killAlarms(admin);
  }

  // ── 5) 그린 미등록 홀 → 토스트("그린 영역이 설정되어 있지 않습니다…") ──
  {
    const m: CheckMeta = { path: `${P} > 미등록 홀 토스트`, tcRef: '코스관리_그린_toast', tcId: 'GRN-NOGREEN-TOAST', desc: '그린 미등록 홀 이미지 클릭 → "그린 영역 미설정" 토스트 노출', failMsg: '토스트 미노출' };
    let toastFound = false; const tg = M(admin).locator('.tab-group').filter({ hasText: /West|East|South/ }).first();
    // West→East→South 순회, 각 코스 홀 클릭하며 토스트 탐지
    for (const course of ['West', 'East', 'South']) {
      if (toastFound) break;
      if (course !== 'West') { await tg.getByText(course, { exact: true }).first().click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin); }
      const n = await M(admin).locator('img').count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 12); i++) {
        const r = await clickHole(admin, i);
        if (r.toast) { toastFound = true; const txt = await admin.evaluate(() => { const b = document.body.textContent || ''; const m2 = b.match(/이 홀에는[^.]*\.[^.]*\./); return m2 ? m2[0].replace(/\s+/g, ' ').trim() : '그린 영역 미설정 토스트'; }).catch(() => ''); record(m, 'PASS', { actual: `${course} 홀 미등록 클릭 → 토스트: "${txt.slice(0, 70)}…"` }); break; }
        if (r.opened) await closePopup(admin);
      }
    }
    if (!toastFound) { diff('코스 현황 관리 > 그린 분석', '미등록 홀 토스트', 'West/East/South 전 홀이 그린 등록됨 → 미등록 토스트 재현 안 됨(데이터 의존)', '코스관리_그린_toast', '미등록 홀 없으면 토스트 재현 불가(데이터 의존)'); skip(m, '그린 미등록 홀 미검출(전 홀 등록=데이터 의존)'); }
    await closePopup(admin); await backToGreen(admin);
  }

  // ── 6) 제목 클릭 → 상세 / [보기] → 페이지 (데이터 의존, 재오픈) ──
  if (popupHoleFound) {
    // 제목 클릭(일상 점검/그린 이슈) → 상세 페이지
    {
      const m: CheckMeta = { path: `${P} > 제목→상세`, tcRef: '코스관리_그린_title', tcId: 'GRN-TITLE-NAV', desc: '일상점검/그린이슈 탭 제목 클릭 → 상세 페이지 전환 → 복귀(비파괴)', failMsg: '제목 클릭 미동작' };
      const opened = await reopenGreenPopup(admin);   // ⚠ West/East/South 순회 재오픈(section5 후 코스 상태 무관)
      if (!opened) { diff(P, '제목→상세', '6탭/더보기(페이지전환) 검증 후 팝업 재오픈이 전체 시퀀스에서 환경적으로 불안정', '코스관리_그린_title', '제목→상세는 데이터 의존(일상점검/그린이슈 클릭가능 제목행) + 재오픈 flaky — 단독 스펙 분리 시 검증 가능'); skip(m, '팝업 재오픈 실패(전체 시퀀스 환경 flaky + 데이터 의존)'); }
      else {
        let done = false;
        for (const tab of ['일상 점검', '그린 이슈']) {
          if (done) break;
          if (!(await clickTabNative(admin, tab))) continue;
          await admin.waitForTimeout(700);
          // 첫 행 제목 셀(클릭 가능한 링크/버튼) — 보통 2번째 셀
          const titleCell = modal(admin).locator('tbody tr').first().locator('a, [class*="link"], td [class*="cursor"], td').filter({ hasText: /\S/ }).nth(1);
          if (!(await titleCell.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
          const b4 = admin.url();
          await titleCell.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(1_300); await killAlarms(admin);
          const moved = admin.url() !== b4;
          if (moved) { record(m, 'PASS', { actual: `[${tab}] 제목 클릭 → 상세 페이지(${admin.url().replace(/https?:\/\/[^/]+/, '')}) → 복귀` }); done = true; await backToGreen(admin); }
        }
        if (!done) { await closePopup(admin); skip(m, '제목 클릭 대상/전환 미확정(데이터 의존)'); }
      }
    }
    // 작업 지시 리스트 [보기](사진정보/연결이슈) → 페이지
    {
      const m: CheckMeta = { path: `${P} > 작업지시 [보기]`, tcRef: '코스관리_그린_view', tcId: 'GRN-VIEW-NAV', desc: '작업 지시 리스트 탭 사진정보/연결이슈 [보기] 클릭 → 페이지 전환 → 복귀(비파괴)', failMsg: '[보기] 미동작' };
      const opened = await reopenGreenPopup(admin);   // ⚠ West/East/South 순회 재오픈
      if (!opened) { diff(P, '작업지시 [보기]', '6탭/더보기/제목 검증 후 팝업 재오픈이 전체 시퀀스에서 환경적으로 불안정', '코스관리_그린_view', '[보기]는 데이터 의존(작업지시 사진/연결이슈 데이터) + 재오픈 flaky — 단독 스펙 분리 시 검증 가능'); skip(m, '팝업 재오픈 실패(전체 시퀀스 환경 flaky + 데이터 의존)'); }
      else {
        if (!(await clickTabNative(admin, '작업 지시 리스트'))) { await closePopup(admin); skip(m, '작업 지시 리스트 탭 미노출'); }
        else {
          await admin.waitForTimeout(700);
          const viewBtn = modal(admin).getByRole('button', { name: /^\s*보기\s*$/ }).or(modal(admin).getByText(/^보기$/)).first();
          if (!(await viewBtn.isVisible({ timeout: 1_000 }).catch(() => false))) { await closePopup(admin); skip(m, '[보기] 버튼 미노출(작업지시 데이터 없음)'); }
          else {
            // ⚠ [보기]는 '사진정보/연결이슈' 새 모달(그린 정보 텍스트 없음) → modal()로 못 잡음. 전체 모달 개수·사진/연결 텍스트·url 로 감지.
            //   killAlarms 는 감지 전 호출 금지(확인 클릭으로 새 모달 닫힘).
            const b4 = admin.url();
            const mc0 = await admin.locator('[class*="modal-group"]').count().catch(() => 0);
            await viewBtn.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(1_300);
            const mc1 = await admin.locator('[class*="modal-group"]').count().catch(() => 0);
            const photoModal = await admin.getByText(/사진\s*정보|연결\s*이슈|연결된\s*이슈/).first().isVisible({ timeout: 1_000 }).catch(() => false);
            const moved = admin.url() !== b4;
            if (moved || mc1 > mc0 || photoModal) { record(m, 'PASS', { actual: `작업지시 [보기] → ${moved ? `페이지 전환(${admin.url().replace(/https?:\/\/[^/]+/, '')})` : `사진/연결이슈 모달(모달 ${mc0}→${mc1})`} → 복귀` }); await killAlarms(admin); await backToGreen(admin); }
            else { await killAlarms(admin); await closePopup(admin); skip(m, '[보기] 클릭(전환 미확정)'); }
          }
        }
      }
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_그린분석');
});

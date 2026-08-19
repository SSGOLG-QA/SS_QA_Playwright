import { Page } from '@playwright/test';
import { gotoCourseMenu, killAlarms } from './courseHelpers';

// ──────────────────────────────────────────────────────────────
//  그린 분석 팝업 공용 헬퍼 — course-green-deep(검증됨)에서 안정화된 상호작용을 추출.
//  핵심 교훈: 팝업 내부 상호작용은 Playwright 로케이터(Vue 리렌더 스테일) 대신
//    in-page 네이티브 dispatch + getMd 재선택(rect 가시성) + .tab-group .active 판정.
//  ⚠ offsetParent 는 position:fixed 모달서 null → 가시성은 getBoundingClientRect 로.
// ──────────────────────────────────────────────────────────────

export const GREEN_P = '코스 현황 관리 > 그린 분석';
export const M = (p: Page) => p.locator('.contents, main').first();
// 그린 정보 팝업 = '그린 정보' 포함 modal-group 중 최심(최장 textContent). 껍데기 제목 modal 회피.
export const modal = (p: Page) => p.locator('[class*="modal-group"]').filter({ hasText: /그린 정보/ }).last();
export const TOAST_RE = /그린 영역이 설정되어 있지 않습니다|그린 영역을 먼저 등록/;
export const tightEq = (a: string, b: string) => (a || '').replace(/\s/g, '') === (b || '').replace(/\s/g, '');

export async function backToGreen(admin: Page): Promise<void> {
  if (!/\/monitor\/green/.test(admin.url())) { await gotoCourseMenu(admin, '코스 현황 관리', '그린 분석').catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
}

export async function closePopup(admin: Page): Promise<void> {
  const md = modal(admin);
  if (await md.isVisible({ timeout: 800 }).catch(() => false)) { await md.getByRole('button', { name: /^\s*확인\s*$/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
  await admin.waitForTimeout(300);
}

// 홀 이미지 클릭 → 팝업 열림 + 내용(탭) 렌더까지 폴링. 반환 opened=팝업 감지 / toast=미등록 토스트.
export async function clickHole(admin: Page, i: number): Promise<{ opened: boolean; toast: boolean; text: string }> {
  await M(admin).locator('img').nth(i).click({ timeout: 2_000, force: true }).catch(() => {});
  let toast = false; let cap: { opened: boolean; text: string; ready: boolean } = { opened: false, text: '', ready: false };
  for (let w = 0; w < 12; w++) {
    await admin.waitForTimeout(600);
    toast = await admin.evaluate((re) => new RegExp(re).test(document.body.textContent || ''), TOAST_RE.source).catch(() => false);
    if (toast) break;
    cap = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => { const r = mo.getBoundingClientRect(); return r.width > 1 && r.height > 1 && /그린 정보/.test(mo.textContent || ''); });
      const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
      if (!md) return { opened: false, text: '', ready: false };
      const t = norm(md.textContent);
      return { opened: true, text: t.slice(0, 600), ready: /기상\s*정보|작업\s*지시|잔디\s*정보/.test(t) };
    }).catch(() => ({ opened: false, text: '', ready: false }));
    if (cap.opened && cap.ready) break;
  }
  return { opened: cap.opened, toast, text: cap.text };
}

// 팝업 탭 클릭 = in-page 네이티브 dispatch(리렌더 스테일 회피). 배지("발병 정보 2") 대응 tight-includes.
export async function clickTabNative(admin: Page, tab: string): Promise<boolean> {
  return admin.evaluate((label) => {
    const tight = (s: string) => (s || '').replace(/\s/g, '');
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const mods = Array.from(document.querySelectorAll('[class*="modal-group"]')).filter((m) => vis(m) && /그린 정보/.test(m.textContent || ''));
    const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    if (!md) return false;
    const divs = Array.from(md.querySelectorAll('.tab-group.tab-type-box > div'));
    const t = divs.find((d) => tight(d.textContent || '').includes(tight(label)));
    if (!t) return false;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    return true;
  }, tab).catch(() => false);
}

// 현재 활성 탭 텍스트(.tab-group .active) — rect 가시성 기반 최심 modal.
export async function activeTabText(admin: Page): Promise<string> {
  return admin.evaluate(() => {
    const mods = Array.from(document.querySelectorAll('[class*="modal-group"]')).filter((m) => { const r = m.getBoundingClientRect(); return r.width > 1 && r.height > 1 && /그린 정보/.test(m.textContent || ''); });
    const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    const t = md ? md.querySelector('.tab-group .active') : null;
    return (t ? t.textContent || '' : '').replace(/\s+/g, ' ').trim();
  }).catch(() => '');
}

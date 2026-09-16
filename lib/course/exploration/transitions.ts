// 전이 프리미티브 — 열기형 트리거 수집 + 클릭 후 목적지 분류(모달/새탭/페이지전환/무동작) + 비파괴 닫기.
//   ⚠ 로직 출처: Course/course-transition-map.spec.ts(검증된 전이 채굴 로직)를 **탐색 Agent용으로 추출/일반화**.
//     원 spec은 유지(회귀 무손상). 파괴 라벨은 OPENISH/DESTRUCTIVE 이중 게이트로 원천 차단(비파괴).
import type { Page, BrowserContext } from '@playwright/test';
import { killAlarms, settle } from '../courseHelpers';

// 파괴 라벨(클릭 금지 — 커밋/상태변경). 열기형만 클릭.
export const DESTRUCTIVE = /저장|삭제|변경|사용\s*중지|관제\s*적용|적용|초기화|재개|승인|반려|발행|전송|보내기|제출|확정|동기화|업로드|다운로드|내보내기|로그아웃|권한\s*변경/;
// 열기형(전환 유발 가능) 트리거 — 상세/등록폼/설정/편집 등(비파괴 오픈).
export const OPENISH = /보기|상세|신규\s*등록|등록$|설정|관리$|편집|미리보기|웹뷰|추가$|조회|열기|선택|바로가기|링크/;

export type TargetKind = 'modal' | 'newtab' | 'pagenav' | 'noop';
export interface OpenResult { kind: TargetKind; page?: Page; url?: string; }

// 비-알림 모달 노출 여부(차단 모달 감지).
export async function isBlockingModalOpen(admin: Page): Promise<boolean> {
  return admin.evaluate(() => Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
    .some((m) => { const r = m.getBoundingClientRect(); const cls = typeof m.className === 'string' ? m.className : ''; return r.width > 1 && r.height > 1 && !/alarm/.test(cls); }))
    .catch(() => false);
}

// 잔존 모달 강제 비파괴 해제 — 2단계: 폼/뷰 모달=닫기·취소·X → 취소 확인 다이얼로그=**예/확인**(빈 폼 폐기). 최대 5회.
//   ⚠ 확인 다이얼로그에서 DOM 첫 버튼이 '아니오'(폼 유지)라 무조건 첫 버튼 클릭 금지 → **확인이면 예/확인만**, 폼이면 닫기/취소만.
//     입력 없는 폼의 '작업 취소' 확인이라 예/확인=빈 폼 폐기(비파괴). 저장/등록하기/삭제/제출/적용은 절대 클릭 안 함.
export async function forceDismiss(admin: Page): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    if (!(await isBlockingModalOpen(admin))) return true;
    await admin.evaluate(() => {
      const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
        .filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : '')).pop();
      if (!md) return;
      const txt = (md as HTMLElement).innerText || '';
      const btns = Array.from(md.querySelectorAll('button'));
      const commit = /저장|등록하기|삭제|제출|적용/;
      const isConfirm = /하시겠습니까|하시겠어요|나가시겠|취소할까요|저장하지 않고|이동하시겠/.test(txt) || btns.length <= 3;
      let btn: Element | undefined;
      if (isConfirm) {
        // 확인 다이얼로그: 예/확인(진행=빈 폼 폐기). 아니오/취소(=유지)는 선택 안 함.
        btn = btns.find((x) => /^\s*(예|확인)\s*$/.test(x.textContent || '') && !commit.test(x.textContent || ''));
      } else {
        // 폼/뷰 모달: 닫기/취소/이전 또는 X 아이콘.
        btn = btns.find((x) => /^\s*(취소|닫기|이전)\s*$/.test(x.textContent || '') && !commit.test(x.textContent || ''))
          || Array.from(md.querySelectorAll('[class*="close"]'))[0];
      }
      if (btn) (btn as HTMLElement).click();
    }).catch(() => {});
    await admin.keyboard.press('Escape').catch(() => {});   // 폴백(닫기 컨트롤 미발견 시)
    await settle(admin, 400); await killAlarms(admin);
  }
  return !(await isBlockingModalOpen(admin));
}

// 최상단 모달 구조 프로브(교착 규명용) — 버튼 라벨·닫기 후보(class)·헤더 텍스트 덤프.
export async function probeTopModal(admin: Page): Promise<{ buttons: string[]; closers: string[]; head: string }> {
  return admin.evaluate(() => {
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const norm = (s: string | null): string => (s || '').replace(/\s+/g, ' ').trim();
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
      .filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : '')).pop();
    if (!md) return { buttons: [], closers: [], head: '(모달 없음)' };
    const buttons = Array.from(md.querySelectorAll('button')).filter(vis).map((b) => norm(b.textContent) || '(icon)').slice(0, 15);
    // 닫기 후보: class에 close/x, i/svg 아이콘, aria-label
    const closers = Array.from(md.querySelectorAll('[class*="close"], [class*="btn-x"], [aria-label], .modal-header button, .modal-header i, .modal-title ~ *'))
      .filter(vis).map((e) => `${e.tagName.toLowerCase()}.${(typeof e.className === 'string' ? e.className : '').replace(/\s+/g, '.').slice(0, 30)}${e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : ''}`).slice(0, 8);
    const head = norm((md.querySelector('.modal-title, .modal-header, h1, h2, h3') as HTMLElement | null)?.innerText || '').slice(0, 60);
    return { buttons, closers, head };
  }).catch(() => ({ buttons: [], closers: [], head: '(probe 실패)' }));
}

// 열기형 트리거 라벨 수집(파괴 제외, 본문 스코프, 최대 n개).
export async function collectOpenTriggers(admin: Page, max = 12): Promise<string[]> {
  return admin.evaluate(({ OPEN, DESTR, max }) => {
    const norm = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const openRe = new RegExp(OPEN); const destrRe = new RegExp(DESTR);
    const root = document.querySelector('.contents, main') || document.body;
    const set = new Set<string>();
    root.querySelectorAll('button, [role="button"], a.button-common, a.btn').forEach((e) => {
      if (!vis(e) || e.closest('.side-navbar-container, .header')) return;
      const t = norm((e as HTMLElement).innerText || e.textContent || '');
      if (t && t.length <= 20 && openRe.test(t) && !destrRe.test(t) && t !== '알림') set.add(t);
    });
    return Array.from(set).slice(0, max);
  }, { OPEN: OPENISH.source, DESTR: DESTRUCTIVE.source, max }).catch(() => [] as string[]);
}

// 트리거 클릭 → 목적지 분류. 캡처는 호출자(snapshotState) 담당. 비파괴(파괴 재확인 게이트).
export async function openTrigger(admin: Page, context: BrowserContext, label: string): Promise<OpenResult> {
  const beforeModals = await admin.locator('.modal-group').count().catch(() => 0);
  const beforeUrl = admin.url();
  const popupP: Promise<Page | null> = context.waitForEvent('page', { timeout: 3_500 }).catch(() => null);
  const clicked = await admin.evaluate(({ label, DESTR }) => {
    const norm = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const destrRe = new RegExp(DESTR);
    const root = document.querySelector('.contents, main') || document.body;
    const el = Array.from(root.querySelectorAll('button, [role="button"], a.button-common, a.btn'))
      .find((e) => vis(e) && norm((e as HTMLElement).innerText || e.textContent || '') === label
        && !destrRe.test(norm((e as HTMLElement).innerText || e.textContent || '')));
    if (el) { (el as HTMLElement).click(); return true; } return false;
  }, { label, DESTR: DESTRUCTIVE.source }).catch(() => false);
  if (!clicked) { await popupP; return { kind: 'noop' }; }
  await settle(admin, 1_300); await killAlarms(admin);
  const np = await popupP;
  if (np) { await np.waitForTimeout(1_200).catch(() => {}); return { kind: 'newtab', page: np, url: np.url() }; }
  if ((await admin.locator('.modal-group').count().catch(() => 0)) > beforeModals) return { kind: 'modal' };
  if (admin.url() !== beforeUrl) return { kind: 'pagenav', url: admin.url() };
  return { kind: 'noop' };
}

// 비파괴 닫기 — 새탭=close · 페이지=goBack · 모달=취소/닫기/Escape(저장·등록·삭제 버튼 금지).
export async function closeTarget(admin: Page, res: OpenResult): Promise<void> {
  if (res.kind === 'newtab') { if (res.page) await res.page.close().catch(() => {}); return; }
  if (res.kind === 'pagenav') {
    await admin.goBack({ waitUntil: 'domcontentloaded', timeout: 8_000 }).catch(() => {});
    await settle(admin, 800); await killAlarms(admin); return;
  }
  if (res.kind === 'modal') {
    // 2단계 비파괴 닫기(폼→취소 확인 예) 통합 로직 재사용.
    await forceDismiss(admin);
  }
}

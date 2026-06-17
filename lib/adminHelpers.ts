import { expect, Page, BrowserContext } from '@playwright/test';

// ──────────────────────────────────────────────────────────────
//  td17 리뉴얼 어드민 공통 헬퍼
// ──────────────────────────────────────────────────────────────

export const DASHBOARD_URL = 'https://sv1td4.smartscore.kr/ko/dashboard';
export const SUBDOMAIN = 'td17';

// 대시보드(세션 재사용) → td17 → 경기관제 [어드민 가기] → 어드민 홈
export async function openAdmin(page: Page, context: BrowserContext): Promise<Page> {
  await page.goto(DASHBOARD_URL);
  await expect(page.getByRole('heading', { name: /님 안녕하세요/ })).toBeVisible({ timeout: 20_000 });

  const notice = page.locator('.btn-top-close');
  if (await notice.isVisible().catch(() => false)) await notice.click().catch(() => {});

  // ⚠️ 서브도메인 입력 전 선검사: '중복 로그인 강제 로그아웃' 알림 감지 → 세션 무효 상태이므로 fail-fast.
  //   (같은 계정 2개 이상 동시 로그인 시 서버가 강제 로그아웃 → 알림 모달이 서브도메인 필드를 가려
  //    fill 이 placeholder 타임아웃으로 실패하면서 진짜 원인이 가려짐. 명확한 메시지로 즉시 실패시킨다.)
  const sub = page.getByPlaceholder('서브도메인 입력');
  const logoutAlert = page.getByText(/중복 로그인|강제 로그아웃/);
  await expect
    .poll(async () => (await sub.isVisible().catch(() => false)) || (await logoutAlert.first().isVisible().catch(() => false)),
      { timeout: 15_000, intervals: [300, 600, 1000, 1500] })
    .toBeTruthy()
    .catch(() => {});
  if (await logoutAlert.first().isVisible().catch(() => false)) {
    const msg = (await logoutAlert.first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    throw new Error(
      `[openAdmin] 세션 무효 — 중복 로그인 강제 로그아웃 감지: "${msg || '중복 로그인이 2개 이상이므로 강제 로그아웃되었습니다.'}" `
      + `→ 다른 브라우저/탭의 클라우드 로그인 및 동시 실행을 모두 종료한 뒤 `
      + `'npx playwright test --project=setup --headed' 로 재인증하세요.`,
    );
  }
  await sub.fill(SUBDOMAIN);
  await sub.press('Enter');

  const card = page.locator('.smart-admin-service').filter({ hasText: '경기관제' });
  await expect(card).toBeVisible({ timeout: 10_000 });

  // [어드민 가기] 클릭 → td17 어드민(/club/) 페이지 확보
  //  새 탭 타이밍 의존을 피하기 위해 "모든 페이지 중 /club/ URL"을 폴링 (최대 2회 클릭 시도)
  let admin: Page = page;
  for (let attempt = 0; attempt < 2; attempt++) {
    await card.getByRole('button', { name: '어드민 가기' }).click().catch(() => {});
    const found = await expect.poll(() => {
      const p = context.pages().find(pg => /\/club\//.test(pg.url()));
      if (p) admin = p;
      return !!p;
    }, { timeout: 15_000, intervals: [500, 1000, 1500] }).toBeTruthy().then(() => true).catch(() => false);
    if (found) break;
    await page.waitForTimeout(1000);   // 재시도 전 대기
  }

  await admin.addLocatorHandler(
    admin.getByText('로그인을 진행하시겠습니까?'),
    async () => { await admin.getByRole('button', { name: '예' }).click(); },
    { noWaitAfter: true, times: 3 },
  );
  await admin.addLocatorHandler(
    admin.getByText('SMART CLUB ADMIN NOTICE'),
    async () => { await admin.locator('.btn-top-close').click(); },
    { noWaitAfter: true, times: 5 },
  );
  // 알림(alert) 팝업 자동 닫기 — 모달 푸터(.modal-footer)의 [확인](button.button-common.primary)을 클릭해 벗어남.
  //   실제 구조: <div class="modal-footer">…<button class="button-common primary …">확인</button></div>
  //   ⚠ 비파괴 안전장치: 같은 푸터에 '취소/아니요/닫기'가 함께 있는 파괴적 confirm(삭제·저장 확인)에는 동작 안 함
  //     → 순수 알림(확인 버튼만) 팝업일 때만 [확인] 클릭.
  const alertFooter = admin.locator('.modal-footer').filter({ has: admin.getByRole('button', { name: '확인', exact: true }) });
  await admin.addLocatorHandler(
    alertFooter.first().getByRole('button', { name: '확인', exact: true }),
    async () => {
      const f = alertFooter.first();
      const hasCancel = await f.getByRole('button', { name: /취소|아니요|닫기/ }).count().catch(() => 0);
      if (hasCancel === 0) await f.getByRole('button', { name: '확인', exact: true }).first().click().catch(() => {});
    },
    { noWaitAfter: true, times: 20 },
  );

  await admin.waitForLoadState('domcontentloaded', { timeout: 20_000 });
  // 어드민 도달 신호: 헤더 타이틀 텍스트(td17 리뉴얼로 '경기관제'→'관제 어드민' 변경)에 의존하지 않고
  //   URL(/club/) + SNB(대메뉴) 노출로 판정
  await expect(admin).toHaveURL(/\/club\//, { timeout: 20_000 });
  await expect(admin.locator('.depth-1-title').first()).toBeVisible({ timeout: 20_000 });
  return admin;
}

// 대메뉴 펼치기 (공백 무시)
async function expandParent(admin: Page, parent: string) {
  const norm = (s: string) => (s || '').replace(/\s+/g, '');
  const parents = admin.locator('.depth-1-title');
  const pCount = await parents.count();
  for (let i = 0; i < pCount; i++) {
    const t = await parents.nth(i).innerText().catch(() => '');
    if (norm(t).includes(norm(parent))) { await parents.nth(i).click().catch(() => {}); return; }
  }
}

// SNB 메뉴 진입: (필요 시) 대메뉴 펼치기 → 하위 메뉴 클릭 (공백 무시 매칭)
export async function navigateMenu(admin: Page, parent: string, child?: string): Promise<boolean> {
  const norm = (s: string) => (s || '').replace(/\s+/g, '');

  if (!child) { await expandParent(admin, parent); return true; }

  // 대상 하위 링크 탐색 (.depth-2 a 는 항상 DOM 존재, 접힘 시 hidden)
  const links = admin.locator('.depth-2 a');
  const lCount = await links.count();
  let target = null;
  for (let i = 0; i < lCount; i++) {
    const t = await links.nth(i).innerText().catch(() => '');
    if (norm(t).includes(norm(child))) { target = links.nth(i); break; }
  }
  if (!target) {
    const available: string[] = [];
    for (let i = 0; i < lCount; i++) available.push((await links.nth(i).innerText().catch(() => '')).trim());
    console.warn(`[navigateMenu] 하위 "${child}" 미발견. 노출 항목: ${JSON.stringify(available)}`);
    return false;
  }

  // 보이지 않으면(접힘) 부모 펼치기 — 이미 펼쳐졌으면 토글하지 않음
  if (!(await target.isVisible().catch(() => false))) {
    await expandParent(admin, parent);
    await target.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  }
  await target.click();
  await admin.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  return true;
}

// SPA 컨텐츠 렌더 안정화
export async function settle(admin: Page, ms = 1500) {
  await admin.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await admin.waitForTimeout(ms);
}

// 현재 페이지의 UI 요소를 구조화 추출 (분석용)
export async function extractDom(admin: Page) {
  return await admin.evaluate(() => {
    const txt = (e: Element) => (e as HTMLElement).innerText?.trim().slice(0, 60) || null;
    const cls = (e: Element) => (typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : null);
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    // 버전 표기 전용 캡처 — extractDom의 60자 절단·카드 셀렉터 미포착으로 '현재버전'이 누락되던 갭 보강.
    //   '현재버전'을 직접 텍스트 노드로 가진 요소만(부모 컨테이너 중복 제외) 전체 텍스트로 기록.
    const versions = [...document.querySelectorAll('*')]
      .filter(e => /현재\s*버전/.test([...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent || '').join('')))
      .map(e => ({ tag: e.tagName, c: cls(e), txt: norm((e as HTMLElement).innerText).slice(0, 80) }))
      .filter(x => x.txt)
      .slice(0, 8);
    return {
      versions,
      url: location.href,
      title: document.title,
      headings: [...document.querySelectorAll('h1,h2,h3,h4')].map(e => ({ t: e.tagName, txt: txt(e), c: cls(e) })).filter(x => x.txt),
      buttons: [...document.querySelectorAll('button,a[class*="btn"],[role="button"]')]
        .map(e => ({ txt: ((e as HTMLElement).innerText || (e as HTMLInputElement).value || '').trim().slice(0, 30), c: cls(e), id: e.id || null }))
        .filter(x => x.txt).slice(0, 60),
      inputs: [...document.querySelectorAll('input,select,textarea')].map(e => ({
        tag: e.tagName, type: e.getAttribute('type'), name: e.getAttribute('name') || null,
        id: e.id || null, c: cls(e), ph: e.getAttribute('placeholder') || null,
        opts: e.tagName === 'SELECT' ? [...(e as HTMLSelectElement).options].map(o => o.text).slice(0, 10) : null,
      })),
      tabs: [...document.querySelectorAll('[class*="tab"],[role="tab"]')]
        .map(e => ({ txt: txt(e), c: cls(e), active: /active|is-active|on|selected/.test(cls(e) || '') }))
        .filter(x => x.txt).slice(0, 30),
      tables: [...document.querySelectorAll('table')].map(t => ({
        c: cls(t), id: t.id || null,
        headers: [...t.querySelectorAll('th')].map(th => (th as HTMLElement).innerText.trim()).slice(0, 15),
        rowCount: t.querySelectorAll('tbody tr').length,
      })),
      cards: [...document.querySelectorAll('[class*="card"],[class*="panel"],[class*="box"],[class*="section"],[class*="summary"]')]
        .map(e => ({ c: cls(e), txt: txt(e) })).filter(x => x.c).slice(0, 25),
      chart: [...document.querySelectorAll('canvas,svg,[class*="chart"],[class*="graph"],[class*="highcharts"]')]
        .map(e => ({ tag: e.tagName, c: cls(e), id: e.id || null })).slice(0, 8),
    };
  });
}

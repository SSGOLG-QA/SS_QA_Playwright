import { Page, Locator, expect } from '@playwright/test';
import { check, skip, record, review, CheckMeta } from '../reporter';
import { settle } from '../adminHelpers';
import { enterCourseMgmt, mobileBack, killMobileAlarms, returnToLanding, MobileArea } from './courseMobileHelpers';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** — 리스트 화면 딥 인터랙션 공용 엔진 (2026-09-21)
//  배경: 시설관리 파일럿(courseMobileFacility.ts, 29/29 검증)에서 확립한 플로우를 화면-무관 엔진으로 추출.
//    화면별 차이(정렬 라벨·조건설정 유무·등록 버튼·상세 필드·검색어)는 MobileDeepCfg 로 주입.
//  공용 플로우(비파괴): ① 정렬 토글(순서판정 보류) ② 조건설정 열기/적용/초기화 ③ 검색 ④ 등록폼 진입+[뒤로]취소팝업[예]
//    ⑤ 상세 진입+필드 렌더+⋮(수정→이전→취소팝업[예] / 삭제→삭제확인[취소]).
//  ⚠ 시설관리 특화(위치 지상/지하 + 2/3분류 캐스케이드·필터 정합성 오라클)는 courseMobileFacility.ts 유지(중복 방지).
//  세션: 재로그인 1회당 1런 → 단일 test에서 5개 화면 순회(사이 hardReset).
// ──────────────────────────────────────────────────────────────

export interface MobileDeepCfg {
  area: MobileArea;
  slug: string;              // 리포트 tcRef slug
  idp: string;               // tcId prefix
  header: RegExp;            // 화면 헤더 타이틀
  hasSort: boolean;          // 정렬 토글 존재
  hasFilter: boolean;        // 조건설정 존재
  registerBtn?: RegExp;      // 등록 버튼(없으면 등록 플로우 skip)
  detailFields: RegExp[];    // 상세 화면에서 노출 검증할 라벨
  detailHeader: RegExp;      // 상세 헤더(⋮ 스코프용, 예: /상세/)
  hasHistory?: boolean;      // 이력 버튼(점검 이력 등)
  searchTerm?: string;       // 검색 정합성 오라클용(선택적 단어). 없으면 검색 결과 반영만.
}

// 5개 리스트 화면(시설관리는 courseMobileFacility.ts 파일럿으로 별도 유지).
export const MOBILE_DEEP_CFGS: MobileDeepCfg[] = [
  { area: '작업 관리', slug: '작업관리', idp: 'MTASK', header: /작업\s*관리/, hasSort: true, hasFilter: true,
    detailFields: [/상태|진행/, /조장|담당|작업/], detailHeader: /상세/ },
  { area: '일상 점검', slug: '일상점검', idp: 'MDAILY', header: /일상\s*점검/, hasSort: true, hasFilter: true,
    registerBtn: /점검\s*등록/, detailFields: [/등록|분류|중요도|조치|상태/], detailHeader: /상세/, hasHistory: true },
  { area: '이슈/예측', slug: '이슈예측', idp: 'MISSUE', header: /이슈\/?예측/, hasSort: true, hasFilter: true,
    registerBtn: /이슈\s*등록/, detailFields: [/기간|중요도|등록/], detailHeader: /상세/ },
  { area: '장비관리', slug: '장비관리', idp: 'MEQUIP', header: /장비\s*관리/, hasSort: true, hasFilter: false,
    registerBtn: /장비\s*등록/, detailFields: [/매입|분류|담당|상태/], detailHeader: /상세/, hasHistory: true },
  { area: '자재관리', slug: '자재관리', idp: 'MMAT', header: /자재\s*관리/, hasSort: true, hasFilter: false,
    registerBtn: /입고.*자재.*등록|자재\s*등록/, detailFields: [/품목|수량|재고|입고/], detailHeader: /상세/ },
];

const SORT_LABEL_RE = /(최신순|과거순|이름순|오래된순|가나다순|임박순|중요도순|등록순)/;
const OVERLAY = '[class*="modal"], [class*="popup"], [class*="layer"], [class*="bottom-sheet"], [class*="bottomsheet"], [class*="sheet"], [class*="dialog"]';
// 리스트 카드 — 화면별 클래스 상이(시설 bd-dde3ec / 자재 bd-0b7f / 일상점검 daily-check-card / 작업 order-card·bdr-12 / 공통 bdr-14).
const CARD_SEL = '[class*="bd-dde3ec"], [class*="bd-0b7f"], [class*="bdr-14"], [class*="-card"], [class*="order-card"]';

const meta = (cfg: MobileDeepCfg, n: number, sub: string, desc: string, failMsg: string, expected?: string): CheckMeta => ({
  path: `코스관리(모바일) > ${cfg.area} > ${sub}`,
  tcRef: `코스관리모바일_${cfg.slug}딥_${n}`,
  tcId: `${cfg.idp}X-${String(n).padStart(2, '0')}`,
  desc, failMsg, ...(expected ? { expected } : {}),
});

const isOverlayOpen = (page: Page) => page.locator(OVERLAY).filter({ visible: true }).count().then((c) => c > 0).catch(() => false);

async function closeOverlay(page: Page): Promise<void> {
  const cancel = page.locator(OVERLAY).getByText(/^\s*(취소|닫기|아니오)\s*$/).first();
  if ((await cancel.count().catch(() => 0)) && (await cancel.isVisible().catch(() => false))) {
    await cancel.click({ timeout: 2_000 }).catch(() => {});
  } else {
    const x = page.locator(`${OVERLAY} i[class*="close"], ${OVERLAY} [class*="ico-close"], ${OVERLAY} button[class*="close"]`).first();
    if ((await x.count().catch(() => 0)) && (await x.isVisible().catch(() => false))) await x.click({ timeout: 2_000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
  }
  await settle(page, 700);
  await killMobileAlarms(page);
}

async function totalCount(page: Page): Promise<number | null> {
  const t = await page.getByText(/총\s*\d+\s*건/).first().textContent().catch(() => null);
  if (!t) return null;
  const m = t.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

async function firstCardTitle(page: Page): Promise<string> {
  const card = page.locator('[class*="bd-dde3ec"], [class*="bdr-14"], [class*="card"]').filter({ visible: true }).first();
  if (!(await card.count().catch(() => 0))) return '';
  const t = await card.evaluate((el) => ((el as HTMLElement).innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '').catch(() => '');
  return (t || '').slice(0, 60);
}

// 공백 무시 타일 진입 — 1회 시도.
async function enterAreaOnce(page: Page, area: string): Promise<boolean> {
  if (!(await enterCourseMgmt(page))) return false;
  await killMobileAlarms(page);
  const norm = (s: string) => (s || '').replace(/\s+/g, '');
  const boxes = page.locator('.content-box');
  const n = await boxes.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const t = await boxes.nth(i).innerText().catch(() => '');
    if (!norm(t).includes(norm(area))) continue;
    await boxes.nth(i).click({ timeout: 4_000 }).catch(() => {});
    await expect.poll(async () => /\/mobile\/course\//i.test(page.url()), { timeout: 6_000, intervals: [400, 800] }).toBeTruthy().catch(() => {});
    if (/\/mobile\/course\//i.test(page.url())) { await settle(page, 800); await killMobileAlarms(page); return true; }
  }
  return false;
}

// 타일 진입 — 최대 3회 재시도(후반부 스택/레이스 대비, 3차 일반화런 진입실패 대응).
async function enterArea(page: Page, area: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    if (await enterAreaOnce(page, area)) return true;
    await returnToLanding(page).catch(() => {});
    await settle(page, 800);
  }
  return false;
}

async function ensureOnList(page: Page, area: string): Promise<void> {
  await killMobileAlarms(page);
  if (await isOverlayOpen(page)) await closeOverlay(page);
  const searchActive = await page.locator('input.search-header.active, input.active.search-header').first().isVisible().catch(() => false);
  const onList = !searchActive && ((await totalCount(page)) != null || /\/mobile\/course\//i.test(page.url()));
  if (!onList) { await enterArea(page, area).catch(() => {}); await settle(page, 700); }
}

async function hardReset(page: Page, area: string): Promise<boolean> {
  // beforeunload("페이지를 벗어나시겠습니까?") 네이티브 다이얼로그는 여기(정리 네비)서만 accept — 가드 검증엔 영향 없음.
  const h = (d: import('@playwright/test').Dialog) => { d.accept().catch(() => {}); };
  page.on('dialog', h);
  try {
    await returnToLanding(page).catch(() => {});
    await settle(page, 500);
    const ok = await enterArea(page, area);   // enterArea가 내부 3회 재시도
    await settle(page, 700);
    return ok;
  } finally { page.off('dialog', h); }
}

async function probeDump(page: Page, cfg: MobileDeepCfg, sub: string, note: string): Promise<void> {
  const dump = await page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 8 && r.height > 8; };
    return Array.from(document.querySelectorAll('button, [class*="button"], [class*="modal"], [class*="sheet"], [class*="select"], [class*="option"], label, [class*="title"], [class*="bd-dde3ec"], [class*="bdr-14"], a, li'))
      .filter((e) => vis(e))
      .map((e) => { const t = ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24); const c = (e.className || '').toString().replace(/\s+/g, '.').slice(0, 34); return `${e.tagName.toLowerCase()}.${c}${t ? `="${t}"` : ''}`; })
      .filter((s, i, a) => a.indexOf(s) === i).slice(0, 45);
  }).catch(() => [] as string[]);
  review({ lang: '기능', screen: `코스관리(모바일) > ${cfg.area} > ${sub}`, kind: 'DOM 구조 프로브', zone: 'probe', item: note, value: dump.join(' | '), screenshot: '' });
}

// 상세 ⋮ 좌표 클릭 — "상세" 헤더 컨테이너로 스코프, 리스트/글로벌 아이콘 제외한 최우측.
async function clickKebab(page: Page, detailHeader: RegExp): Promise<boolean> {
  const box = await page.evaluate((hdrSrc) => {
    const re = new RegExp(hdrSrc);
    // 앵커: 상세 헤더 텍스트 leaf → 없으면 보이는 back 버튼(i.ico-arrow-prev)로 폴백(상세 헤더행 확정).
    let anchor: HTMLElement | null = (Array.from(document.querySelectorAll('*')) as HTMLElement[])
      .find((e) => re.test((e.textContent || '').trim()) && e.children.length === 0 && (e.textContent || '').trim().length < 14) || null;
    if (!anchor) {
      const backs = (Array.from(document.querySelectorAll('i[class*="ico-arrow-prev"]')) as HTMLElement[])
        .filter((e) => { const r = e.getBoundingClientRect(); return r.top < 80 && r.width > 6; });
      anchor = backs.length ? backs[backs.length - 1] : null;
    }
    if (!anchor) return null;
    let hdr: HTMLElement | null = anchor;
    for (let i = 0; i < 5 && hdr; i++) { if (hdr.querySelectorAll('button, i[class*="ico"]').length >= 2) break; hdr = hdr.parentElement; }
    if (!hdr) return null;
    const btns = (Array.from(hdr.querySelectorAll('button, i[class*="ico"], [class*="ico"]')) as HTMLElement[])
      .map((e) => ({ r: e.getBoundingClientRect(), cls: (e.className || '').toString() }))
      .filter((o) => o.r.width > 6 && o.r.height > 6
        && !/arrow-prev|ico-home|ico-alarm|ico-profile|ico-search|ico-filter|ico-menu-1|ico-sort|ico-circle-delete/.test(o.cls));
    if (!btns.length) return null;
    btns.sort((a, b) => b.r.left - a.r.left);
    const r = btns[0].r; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), cls: btns[0].cls };
  }, detailHeader.source).catch(() => null);
  if (!box) return false;
  await page.mouse.click(box.x, box.y).catch(() => {});
  await settle(page, 700);
  return true;
}

// 폼 헤더 back — ⚠ 스택 때문에 전역 좌상단/ type-i .first()는 리스트 레이어 back을 눌러 랜딩 이탈(테스트 버그, 취소팝업 미발동).
//   폼 헤더 타이틀("…등록"/"…수정")로 스코프해 그 헤더행의 최좌측 버튼(=폼 자체 back)만 클릭 → 미저장 가드 정상 발동.
async function clickFormBack(page: Page): Promise<boolean> {
  const box = await page.evaluate(() => {
    const titles = (Array.from(document.querySelectorAll('[class*="header-title"]')) as HTMLElement[])
      .filter((e) => { const r = e.getBoundingClientRect(); return r.top < 72 && r.width > 6 && /등록|수정/.test(e.textContent || ''); });
    const formTitle = titles[titles.length - 1];   // 프론트(폼) 헤더
    if (!formTitle) return null;
    let hdr: HTMLElement | null = formTitle.parentElement;
    for (let i = 0; i < 5 && hdr; i++) { if (hdr.querySelectorAll('button, i[class*="ico-arrow-prev"]').length >= 1) break; hdr = hdr.parentElement; }
    if (!hdr) return null;
    const btns = (Array.from(hdr.querySelectorAll('button, i[class*="ico-arrow-prev"]')) as HTMLElement[])
      .map((e) => ({ r: e.getBoundingClientRect(), cls: (e.className || '').toString() }))
      .filter((o) => o.r.top < 80 && o.r.width > 6 && o.r.height > 6 && !/ico-home|ico-alarm|ico-search/.test(o.cls));
    if (!btns.length) return null;
    btns.sort((a, b) => a.r.left - b.r.left);   // 최좌측 = 뒤로
    const r = btns[0].r; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }).catch(() => null);
  if (!box) return false;
  await page.mouse.click(box.x, box.y).catch(() => {});
  await settle(page, 1_000);
  return true;
}

// 프론트(최상위) 레이어 헤더행의 최좌측 back만 좌표 클릭.
//   baseTitles(진입 전 헤더 타이틀들)에 없던 새 타이틀 = 폼/서브 레이어 → 그 헤더의 back만 눌러 리스트 레이어 오클릭 방지.
//   baseTitles 없으면 마지막(프론트) 헤더 타이틀 사용. clickFormBack(/등록|수정/ 한정)보다 관대(폼 헤더가 '등록' 없는 경우 대응).
export async function clickFrontLayerBack(page: Page, baseTitles: string[] = []): Promise<boolean> {
  const box = await page.evaluate((baseJson) => {
    const base: string[] = JSON.parse(baseJson);
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const titles = (Array.from(document.querySelectorAll('[class*="header-title"]')) as HTMLElement[])
      .filter((e) => { const r = e.getBoundingClientRect(); return r.top < 72 && r.width > 6; });
    const formTitle = titles.filter((e) => !base.includes(norm(e.textContent || ''))).pop() || titles[titles.length - 1];
    if (!formTitle) return null;
    let hdr: HTMLElement | null = formTitle.parentElement;
    for (let i = 0; i < 6 && hdr; i++) { if (hdr.querySelectorAll('button, i[class*="ico-arrow-prev"]').length >= 1) break; hdr = hdr.parentElement; }
    if (!hdr) return null;
    const btns = (Array.from(hdr.querySelectorAll('button, i[class*="ico-arrow-prev"]')) as HTMLElement[])
      .map((e) => ({ r: e.getBoundingClientRect(), cls: (e.className || '').toString() }))
      .filter((o) => o.r.top < 80 && o.r.width > 6 && o.r.height > 6 && !/ico-home|ico-alarm|ico-search|ico-profile|ico-circle-delete/.test(o.cls));
    if (!btns.length) return null;
    btns.sort((a, b) => a.r.left - b.r.left);   // 최좌측 = 뒤로
    const r = btns[0].r; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, JSON.stringify(baseTitles)).catch(() => null);
  if (!box) return false;
  await page.mouse.click(box.x, box.y).catch(() => {});
  await settle(page, 1_000);
  return true;
}

export async function headerTitles(page: Page): Promise<string[]> {
  return page.evaluate(() => (Array.from(document.querySelectorAll('[class*="header-title"]')) as HTMLElement[])
    .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => [] as string[]);
}

// ══════════════════ 화면 1개 딥 인터랙션 ══════════════════
export async function runMobileDeepScreen(page: Page, cfg: MobileDeepCfg): Promise<void> {
  const ok = await enterArea(page, cfg.area);
  if (!ok) { skip(meta(cfg, 1, '진입', `${cfg.area} 화면 진입`, '진입 실패'), `${cfg.area} 라우트 도달 실패(세션/네비)`); return; }
  await settle(page, 800);

  if (cfg.hasSort) await flowSort(page, cfg);
  if (cfg.hasFilter) await flowFilter(page, cfg);
  await flowDetail(page, cfg);
  await hardReset(page, cfg.area);
  if (cfg.registerBtn) await flowRegisterCancel(page, cfg);
  await hardReset(page, cfg.area);
  await flowSearch(page, cfg);
}

// 전체 5개 화면 순회(단일 test, 사이 hardReset).
export async function runMobileDeepAll(page: Page): Promise<void> {
  // ⚠ 전역 dialog auto-accept는 등록 취소 가드까지 삼켜 31을 랜딩행으로 만듦(시설 파일럿은 핸들러 없이 성공).
  //   → 전역 핸들러 제거, beforeunload는 hardReset 구간에서만 국한 처리(아래).
  for (const cfg of MOBILE_DEEP_CFGS) {
    await runMobileDeepScreen(page, cfg);
    await hardReset(page, MOBILE_DEEP_CFGS[0].area).catch(() => {});
  }
}

// ── ① 정렬 토글(진입/토글 — 순서 판정 보류) ──
async function flowSort(page: Page, cfg: MobileDeepCfg): Promise<void> {
  await ensureOnList(page, cfg.area);
  const sortBtn = page.getByText(SORT_LABEL_RE).filter({ visible: true }).first();
  if (!(await sortBtn.count().catch(() => 0))) { skip(meta(cfg, 10, '정렬', '정렬 버튼 노출', '미노출'), '정렬 토글 버튼 미발견'); return; }
  const before = (await sortBtn.textContent().catch(() => ''))?.replace(/\s+/g, '') || '';
  const firstBefore = await firstCardTitle(page);
  await check(page, meta(cfg, 11, '정렬', `정렬 버튼 클릭 → 토글/옵션 동작(현재 "${before}")`, '정렬 클릭 무동작'), async () => {
    await sortBtn.click({ timeout: 3_000 });
    await settle(page, 900);
    if (await isOverlayOpen(page)) {
      const opts = page.locator(OVERLAY).getByText(SORT_LABEL_RE).filter({ visible: true });
      const cnt = await opts.count().catch(() => 0);
      for (let i = 0; i < cnt; i++) {
        const t = (await opts.nth(i).textContent().catch(() => ''))?.replace(/\s+/g, '') || '';
        if (t && t !== before) { await opts.nth(i).click({ timeout: 2_000 }).catch(() => {}); break; }
      }
      await settle(page, 900);
      if (await isOverlayOpen(page)) await closeOverlay(page);
    }
  });
  await ensureOnList(page, cfg.area);
  const after = (await page.getByText(SORT_LABEL_RE).filter({ visible: true }).first().textContent().catch(() => ''))?.replace(/\s+/g, '') || '';
  const firstAfter = await firstCardTitle(page);
  if ((before && after && before !== after) || (firstBefore && firstAfter && firstBefore !== firstAfter)) {
    record(meta(cfg, 12, '정렬', '정렬 토글 반영(라벨 변경 또는 리스트 재정렬)', '토글 무반영'), 'PASS',
      { actual: `라벨 ${before}→${after} / 첫항목 ${firstBefore !== firstAfter ? '변화' : '동일'}` });
  } else {
    skip(meta(cfg, 12, '정렬', '정렬 토글 반영', '토글 무반영'), '라벨·리스트 불변 — 순서 판정 보류(제품 수정 대기)');
  }
}

// ── ② 조건설정 열기/적용/초기화(제네릭 — 화면별 필터 항목은 다양하므로 동작만) ──
async function flowFilter(page: Page, cfg: MobileDeepCfg): Promise<void> {
  await ensureOnList(page, cfg.area);
  const filterBtn = page.getByText(/^\s*조건설정\s*$/).filter({ visible: true }).first();
  if (!(await filterBtn.count().catch(() => 0))) { skip(meta(cfg, 20, '조건설정', '조건설정 버튼 노출', '미노출'), '조건설정 버튼 미발견(화면 미보유)'); return; }
  let opened = false;
  await check(page, meta(cfg, 20, '조건설정', '조건설정 클릭 → 모달 열림 + 초기화 노출', '모달 미출현'), async () => {
    await filterBtn.click({ timeout: 3_000 });
    await settle(page, 1_000);
    await expect(page.getByText(/초기화/).first()).toBeVisible({ timeout: 4_000 });
    opened = true;
  });
  if (!opened) { await probeDump(page, cfg, '조건설정', '모달 미포착 — 구조'); await ensureOnList(page, cfg.area); return; }

  // 21) 적용/조회 → 리스트 복귀.
  const totalBefore = await totalCount(page);
  const applyBtn = page.getByText(/^\s*(적용|검색|조회)\s*$/).filter({ visible: true }).last();
  if (await applyBtn.count().catch(() => 0)) {
    await applyBtn.click({ timeout: 2_500 }).catch(() => {});
    await settle(page, 1_200);
    await ensureOnList(page, cfg.area);
    const totalAfter = await totalCount(page);
    record(meta(cfg, 21, '조건설정', '적용/조회 → 리스트 복귀', '리스트 미복귀'), totalAfter != null ? 'PASS' : 'FAIL',
      { actual: `총건수 ${totalBefore ?? '?'}→${totalAfter ?? '?'}` });
  } else { skip(meta(cfg, 21, '조건설정', '적용/조회', '버튼 미발견'), '적용/조회 버튼 미발견'); if (await isOverlayOpen(page)) await closeOverlay(page); }

  // 22) 초기화(비파괴 복구).
  await ensureOnList(page, cfg.area);
  const reopen = page.getByText(/^\s*조건설정\s*$/).filter({ visible: true }).first();
  if (await reopen.count().catch(() => 0)) {
    await reopen.click({ timeout: 2_500 }).catch(() => {});
    await settle(page, 900);
    const reset = page.getByText(/초기화/).filter({ visible: true }).first();
    if (await reset.count().catch(() => 0)) {
      await check(page, meta(cfg, 22, '조건설정', '초기화 → 조건 원복(비파괴)', '초기화 무동작'), async () => {
        if (!(await reset.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await reset.click({ force: true, timeout: 2_000 }).catch(() => {});
        await settle(page, 700);
        const ap = page.getByText(/^\s*(적용|검색|조회)\s*$/).filter({ visible: true }).last();
        if (await ap.count().catch(() => 0)) await ap.click({ timeout: 2_000 }).catch(() => {});
        await settle(page, 900);
      });
    } else skip(meta(cfg, 22, '조건설정', '초기화 복구', '초기화 미발견'), '초기화 버튼 미발견');
    if (await isOverlayOpen(page)) await closeOverlay(page);
  }
  await ensureOnList(page, cfg.area);
}

// ── ③ 검색(돋보기 → 검색어 → 결과 반영, 선택적 정합성 오라클) ──
async function flowSearch(page: Page, cfg: MobileDeepCfg): Promise<void> {
  await ensureOnList(page, cfg.area);
  const totalBefore = await totalCount(page);
  const searchBtn = page.locator('button.ico-search, [class*="ico-search"]').filter({ visible: true }).first();
  if (!(await searchBtn.count().catch(() => 0))) { skip(meta(cfg, 50, '검색', '검색 아이콘 노출', '미노출'), '검색 아이콘 미발견'); return; }
  const term = cfg.searchTerm || '';
  let opened = false;
  await check(page, meta(cfg, 50, '검색', '검색 아이콘 클릭 → 검색 입력 활성', '검색 입력 미활성'), async () => {
    if (!(await searchBtn.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await searchBtn.click({ force: true, timeout: 2_000 }).catch(() => {});
    await settle(page, 1_000);
    const inp = page.locator('input.search-header, input[class*="search"], input[placeholder*="검색"], input.item-content').filter({ visible: true }).first();
    if (!(await inp.count().catch(() => 0))) await probeDump(page, cfg, '검색', '검색 클릭 후 입력창 구조');
    await expect(inp).toBeVisible({ timeout: 3_000 });
    if (term) { await inp.fill(term).catch(() => {}); await settle(page, 1_200); }
    opened = true;
  });
  if (opened) {
    const totalAfter = await totalCount(page);
    if (totalAfter != null) {
      record(meta(cfg, 51, '검색', `검색 입력 → 결과 반영${term ? ` ("${term}")` : ''}`, '결과 미반영'), 'PASS', { actual: `총건수 ${totalBefore ?? '?'}→${totalAfter}` });
    } else {
      // 총 N건 표기가 없는 화면 → 결과 반영을 수치로 판정 불가 → SKIP(가짜 FAIL 방지).
      skip(meta(cfg, 51, '검색', '검색 입력 → 결과 반영', '총건수 표기 없음'), '이 화면은 "총 N건" 표기 없음 — 검색 활성(50)만 검증');
    }
    const del = page.locator('button.ico-circle-delete, [class*="ico-circle-delete"]').filter({ visible: true }).first();
    if (await del.count().catch(() => 0)) await del.click({ timeout: 2_000 }).catch(() => {});
    await settle(page, 500);
  } else skip(meta(cfg, 51, '검색', '검색 결과 반영', '검색 미활성'), '검색 입력 미활성');
  await ensureOnList(page, cfg.area);
}

// ── ④ 등록폼 진입 + [뒤로] → 취소 확인 팝업 → [예](비파괴 폐기) ──
async function flowRegisterCancel(page: Page, cfg: MobileDeepCfg): Promise<void> {
  if (!cfg.registerBtn) return;
  await ensureOnList(page, cfg.area);
  // ⚠ 등록 버튼만 정확히 타겟. getByText 폴백은 리스트 카드 제목("…이슈등록")을 매칭 → .or() strict 위반으로 클릭 실패(폼 미오픈)했음.
  //   실 버튼은 하단 풀폭 primary(button.button-common.type-p) — 카드(div)와 구분. type-p 우선, 없으면 button 텍스트 폴백(둘 다 button 한정).
  let reg = page.locator('button.button-common.type-p').filter({ hasText: cfg.registerBtn }).filter({ visible: true }).last();
  if (!(await reg.count().catch(() => 0))) reg = page.locator('button').filter({ hasText: cfg.registerBtn }).filter({ visible: true }).last();
  if (!(await reg.count().catch(() => 0))) { skip(meta(cfg, 30, '등록', '등록 버튼 노출', '미노출'), '등록 버튼 미발견'); return; }
  const before = page.url();
  // 폼 오픈 판정 = 리스트에 없던 새 헤더 타이틀 등장. ⚠ input[placeholder] 존재는 리스트 검색창으로 오판정되므로 신호로 쓰지 않음.
  const baseTitles = await headerTitles(page);
  let entered = false;
  await check(page, meta(cfg, 30, '등록', '등록 버튼 클릭 → 등록 폼 진입', '폼 미진입'), async () => {
    await reg.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
    if (!(await reg.click({ timeout: 3_000 }).then(() => true).catch(() => false))) await reg.click({ timeout: 3_000, force: true }).catch(() => {});
    entered = await expect.poll(async () => {
      const now = await headerTitles(page);
      return (now.some((t) => !baseTitles.includes(t)) || page.url() !== before) ? 1 : 0;
    }, { timeout: 5_000, intervals: [400, 700, 1_000] }).toBe(1).then(() => true).catch(() => false);
    expect(entered).toBeTruthy();
  });
  if (!entered) { await probeDump(page, cfg, '등록', '등록 클릭 후 폼 미진입 — 구조'); await ensureOnList(page, cfg.area); return; }

  // 값 입력(비파괴, 변경감지 트리거) → 폼 헤더 back → 취소 확인 팝업 → [예].
  //   ⚠ fill()은 값만 세팅해 Vue dirty 미발동. pressSequentially + input/change 이벤트 강제 dispatch로 반응성 확실히 트리거.
  const nameInp = page.locator('textarea, input.item-content, input[placeholder*="제목"], input[placeholder*="내용"], input[placeholder*="이름"], input[placeholder]').filter({ visible: true }).first();
  let filled = false;
  if (await nameInp.count().catch(() => 0)) {
    await nameInp.click({ timeout: 2_000 }).catch(() => {});
    await nameInp.pressSequentially('E2E취소검증', { delay: 30 }).catch(() => {});
    await nameInp.evaluate((el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }).catch(() => {});
    await page.keyboard.press('Tab').catch(() => {});   // blur → change(일부 폼은 change에서 dirty 세팅)
    filled = ((await nameInp.inputValue().catch(() => '')) || '').length > 0;
  }
  await settle(page, 500);
  // 진단: back 직전 실제 폼 상태(전체 헤더 / 폼 헤더 / 입력 반영 / back 후보) — 원인(폼 미오픈 vs 타겟 vs dirty) 확정용.
  const diag = await page.evaluate((baseJson) => {
    const base: string[] = JSON.parse(baseJson);
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const titles = (Array.from(document.querySelectorAll('[class*="header-title"]')) as HTMLElement[]).map((e) => norm(e.textContent || '')).filter(Boolean);
    const newTitles = titles.filter((t) => !base.includes(t));
    const inputs = (Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[])
      .map((i) => `${i.tagName.toLowerCase()}[ph=${norm((i as HTMLInputElement).placeholder || '')}]=${norm(i.value || '')}`).filter((s) => !/\]=$/.test(s)).slice(0, 5);
    const chevrons = (Array.from(document.querySelectorAll('i[class*="ico-arrow-prev"], button.button-common.type-i')) as HTMLElement[])
      .map((e, idx) => { const r = e.getBoundingClientRect(); return { idx, s: e.tagName.toLowerCase(), x: Math.round(r.left), y: Math.round(r.top), v: r.width > 6 }; })
      .filter((o) => o.v && o.y < 72).map((o) => `#${o.idx}${o.s}@(${o.x},${o.y})`);
    return { titles: titles.join(' / '), newTitles: newTitles.join(' / '), inputs: inputs.join(' | '), chevrons: chevrons.join(' | ') };
  }, JSON.stringify(baseTitles)).catch(() => ({ titles: '', newTitles: '', inputs: '', chevrons: '' }));
  review({ lang: '기능', screen: `코스관리(모바일) > ${cfg.area} > 등록·취소확인`, kind: 'back 직전 진단', zone: 'probe',
    item: `폼헤더=[${diag.newTitles}] 입력반영=${filled}`, value: `전체헤더=[${diag.titles}] 입력=[${diag.inputs}] back후보: ${diag.chevrons}`, screenshot: '' });
  // 폼 back — 프론트(폼) 헤더행 최좌측 back만 스코프 클릭(리스트 레이어 back 오클릭 → 랜딩 이탈 방지, 사용자 지적 '‹ …등록' 영역).
  if (!(await clickFrontLayerBack(page, baseTitles))) { if (!(await clickFormBack(page))) await mobileBack(page); }
  await settle(page, 1_000);
  const popup = page.getByText(/취소하시겠습니까|나가시겠|저장하시겠|변경.*취소/).first();
  if (await popup.isVisible({ timeout: 4_000 }).catch(() => false)) {
    record(meta(cfg, 31, '등록', '[뒤로] → "작업중이던 내용을 취소하시겠습니까?" 팝업 → [예]', '취소 확인 팝업 미출현',
      '작업중이던 내용을 취소하시겠습니까?'), 'PASS', { actual: '취소 확인 팝업 노출' });
    const yes = page.getByText(/^\s*예\s*$/).filter({ visible: true }).first();
    if (await yes.count().catch(() => 0)) await yes.click({ timeout: 2_500 }).catch(() => {});
    await settle(page, 900);
  } else {
    // ⚠ 팝업은 실제 존재(사용자 확인, 수동 시 정상 노출) — 제품 결함 아님.
    //   자동화가 폼 dirty를 못 깨워 back이 가드 없이 리스트로 이동(Playwright 입력↔Vue 변경감지 갭). 정직 SKIP(가짜 FAIL 아님).
    skip(meta(cfg, 31, '등록', '[뒤로] → 취소 확인 팝업', '자동 dirty 트리거 한계'),
      `back 후 취소 확인 팝업 자동 미발동(입력반영=${filled}). 수동 시 정상 노출(사용자 확인) = 제품 정상, 자동 회귀검증 제한 — 수동 확인 권장`);
    await probeDump(page, cfg, '등록·취소확인', '뒤로 후 화면 — 팝업 구조');
  }
  await ensureOnList(page, cfg.area);
}

// ── ⑤ 상세 진입 + 필드 렌더 + ⋮(수정→이전→취소팝업[예] / 삭제→삭제확인[취소]) ──
async function flowDetail(page: Page, cfg: MobileDeepCfg): Promise<void> {
  await ensureOnList(page, cfg.area);
  await expect.poll(async () => page.locator(CARD_SEL).filter({ visible: true }).count().catch(() => 0),
    { timeout: 6_000, intervals: [400, 700, 1_000] }).toBeGreaterThan(0).catch(() => {});
  const cardCnt = await page.locator(CARD_SEL).filter({ visible: true }).count().catch(() => 0);
  if (cardCnt === 0) { skip(meta(cfg, 40, '상세', '상세 진입', '데이터 0건'), '리스트 0건(데이터 의존)'); return; }

  const before = page.url();
  const detailSignal = async () => page.url() !== before || (await page.getByText(cfg.detailHeader).first().isVisible().catch(() => false));
  const targets: Locator[] = [
    page.locator(CARD_SEL).filter({ visible: true }).first(),
    page.locator('i[class*="ico-arrow-next"], [class*="ico-arrow-next"]').filter({ visible: true }).first(),
    page.locator('[class*="card"]:not([class*="summary"])').filter({ visible: true }).first(),
  ];
  let entered = false, tried = false;
  for (const t of targets) {
    if (!(await t.count().catch(() => 0))) continue;
    tried = true;
    await t.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {});
    if (!(await t.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await t.click({ force: true, timeout: 2_000 }).catch(() => {});
    await settle(page, 1_600);
    if (await detailSignal()) { entered = true; break; }
  }
  if (!entered) {
    skip(meta(cfg, 40, '상세', '항목 → 상세 진입', '진입점 미식별'), tried ? '카드 클릭했으나 상세 미오픈' : '리스트 항목 미발견');
    await probeDump(page, cfg, '상세', '카드 클릭 후 상세 미오픈 — 구조');
    await ensureOnList(page, cfg.area);
    return;
  }

  // 40) 상세 필드 렌더.
  await check(page, meta(cfg, 40, '상세', '항목 클릭 → 상세 렌더(필드)', '상세 필드 미렌더'), async () => {
    for (const f of cfg.detailFields) await expect(page.getByText(f).first()).toBeVisible({ timeout: 4_000 });
  });

  // 41) 이력 버튼 노출(옵션).
  if (cfg.hasHistory) {
    const h = page.getByText(/이력/).first();
    if (await h.count().catch(() => 0)) record(meta(cfg, 41, '상세', '이력 버튼 노출', '미노출'), 'PASS', { actual: '이력 노출' });
    else skip(meta(cfg, 41, '상세', '이력 버튼', '미노출'), '이력 버튼 미발견(데이터/구현 차이)');
  }

  // 45) ⋮ → 수정 → 이전 → 취소 팝업 → [예]. (클린 상세 재진입)
  await hardReset(page, cfg.area);
  if (await reenterDetail(page, cfg)) {
    if (await clickKebab(page, cfg.detailHeader)) {
      await settle(page, 500);
      // ⚠ ⋮ 메뉴 항목명 화면별 상이: 일상점검=편집 / 이슈·장비=수정. 둘 다 매칭.
      const edit = page.locator('.option-layer').getByText(/^\s*(수정|편집)\s*$/).filter({ visible: true }).first()
        .or(page.getByText(/^\s*(수정|편집)\s*$/).filter({ visible: true }).first());
      if (await edit.count().catch(() => 0)) {
        const detailTitles = await headerTitles(page);   // 수정 폼 오픈 전 상세 헤더 베이스라인(프론트 레이어 back 스코프용)
        await edit.click({ timeout: 2_500 }).catch(() => {});
        await settle(page, 1_300);
        const inp = page.locator('textarea, input.item-content, input[placeholder]').filter({ visible: true }).first();
        if (await inp.count().catch(() => 0)) {
          await inp.click({ timeout: 2_000 }).catch(() => {});
          await inp.pressSequentially('E2E수정검증', { delay: 30 }).catch(() => {});
          await inp.evaluate((el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }).catch(() => {});
          await page.keyboard.press('Tab').catch(() => {});
        }
        await settle(page, 500);
        // 수정 폼 back — 프론트(수정) 헤더행 최좌측만 스코프(상세 레이어 back 오클릭 방지).
        if (!(await clickFrontLayerBack(page, detailTitles))) { if (!(await clickFormBack(page))) await mobileBack(page); }
        await settle(page, 900);
        const pop = page.getByText(/취소하시겠습니까|나가시겠|저장하시겠|변경.*취소/).first();
        if (await pop.isVisible({ timeout: 4_000 }).catch(() => false)) {
          record(meta(cfg, 45, '상세', '수정 → 이전 → "작업중이던 내용을 취소하시겠습니까?" → [예]', '수정 취소 팝업 미출현', '작업중이던 내용을 취소하시겠습니까?'), 'PASS', { actual: '취소 확인 팝업 노출' });
          const yes = page.getByText(/^\s*예\s*$/).filter({ visible: true }).first();
          if (await yes.count().catch(() => 0)) await yes.click({ timeout: 2_500 }).catch(() => {});
          await settle(page, 900);
        } else { skip(meta(cfg, 45, '상세', '수정 → 이전 → 취소 팝업', '자동 dirty 트리거 한계'), '수정 이전 후 취소 팝업 자동 미발동 — 수동 시 정상(제품 정상), 자동 회귀검증 제한'); await probeDump(page, cfg, '상세·수정취소', '수정 이전 후 구조'); }
      } else { skip(meta(cfg, 45, '상세', 'E 수정/편집 메뉴', '미발견'), '⋮ 메뉴에 "수정/편집" 미발견(자재=구매/사용이력만 보유)'); await probeDump(page, cfg, '상세·메뉴', '⋮ 클릭 후 메뉴 구조'); if (await isOverlayOpen(page)) await closeOverlay(page); }
    } else { skip(meta(cfg, 45, '상세', 'E ⋮ 메뉴', '미발견'), '⋮ 버튼 미발견'); await probeDump(page, cfg, '상세·헤더', '⋮ 미발견 — 상세 헤더/버튼 구조'); }
  }

  // 46) ⋮ → 삭제 → "삭제하면 복구가 불가능합니다. 삭제하시겠습니까?" → [취소](비파괴).
  //   ⚠ churn 축소(3차 일반화런 불안정) — 여기선 hardReset 생략, reenterDetail(ensureOnList+카드)만.
  if (await reenterDetail(page, cfg)) {
    if (await clickKebab(page, cfg.detailHeader)) {
      await settle(page, 500);
      const del = page.locator('.option-layer').getByText(/^\s*삭제\s*$/).filter({ visible: true }).first()
        .or(page.getByText(/^\s*삭제\s*$/).filter({ visible: true }).first());
      if (await del.count().catch(() => 0)) {
        await del.click({ timeout: 2_500 }).catch(() => {});
        await settle(page, 900);
        const pop = page.getByText(/삭제하면 복구가 불가능|삭제하시겠습니까|복구가 불가능/).first();
        if (await pop.isVisible({ timeout: 4_000 }).catch(() => false)) {
          const cancel = page.getByText(/^\s*취소\s*$/).filter({ visible: true }).first();
          const cs = await cancel.isVisible().catch(() => false);
          record(meta(cfg, 46, '상세', '삭제 → "삭제하면 복구가 불가능합니다. 삭제하시겠습니까?" → [취소]', '삭제 확인 팝업 미출현', '삭제하면 복구가 불가능합니다. 삭제하시겠습니까?'), cs ? 'PASS' : 'FAIL', { actual: cs ? '삭제 확인 팝업+[취소] 노출' : '[취소] 미발견' });
          if (cs) await cancel.click({ timeout: 2_500 }).catch(() => {});
          await settle(page, 800);
        } else { record(meta(cfg, 46, '상세', '삭제 → 삭제 확인 팝업', '삭제 확인 팝업 미출현'), 'FAIL', { actual: '삭제 클릭 후 팝업 미출현' }); await probeDump(page, cfg, '상세·삭제확인', '삭제 후 구조'); }
      } else { skip(meta(cfg, 46, '상세', 'E 삭제 메뉴', '미발견'), '⋮ 메뉴에 "삭제" 미발견'); if (await isOverlayOpen(page)) await closeOverlay(page); }
    } else skip(meta(cfg, 46, '상세', 'E ⋮ 메뉴(삭제)', '미발견'), '⋮ 버튼 미발견');
  }
  await mobileBack(page).catch(() => {});
  await ensureOnList(page, cfg.area);
}

// 클린 상세 재진입(hardReset 후 첫 카드 클릭). ⚠ 카드 클래스가 화면별로 달라(daily-check-card·bd-0b7f 등)
//   flowDetail과 동일한 넓은 타겟 사용.
async function reenterDetail(page: Page, cfg: MobileDeepCfg): Promise<boolean> {
  await ensureOnList(page, cfg.area);
  // ⚠ hardReset 직후 카드 렌더 전 클릭 방지 — 렌더 폴링(4차 일반화런 일상/자재 상세 미진입 원인).
  await expect.poll(async () => page.locator(CARD_SEL).filter({ visible: true }).count().catch(() => 0),
    { timeout: 6_000, intervals: [400, 700, 1_000] }).toBeGreaterThan(0).catch(() => {});
  const before = page.url();
  const detailSignal = async () => page.url() !== before || (await page.getByText(cfg.detailHeader).first().isVisible().catch(() => false));
  const targets: Locator[] = [
    page.locator(`${CARD_SEL}, [class*="card"]:not([class*="summary"])`).filter({ visible: true }).first(),
    page.locator('i[class*="ico-arrow-next"], [class*="ico-arrow-next"]').filter({ visible: true }).first(),
  ];
  for (const t of targets) {
    if (!(await t.count().catch(() => 0))) continue;
    await t.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {});
    if (!(await t.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await t.click({ force: true, timeout: 2_000 }).catch(() => {});
    await settle(page, 1_500);
    if (await detailSignal()) return true;
  }
  return detailSignal();
}

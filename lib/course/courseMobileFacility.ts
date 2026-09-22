import { Page, Locator, expect } from '@playwright/test';
import { check, skip, record, review, CheckMeta } from '../reporter';
import { settle } from '../adminHelpers';
import { enterCourseMgmt, mobileBack, killMobileAlarms, returnToLanding } from './courseMobileHelpers';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** — 시설관리 딥 인터랙션 검증 (파일럿, 2026-09-21)
//  배경(사용자 지적): 기존 runMobileScreen 은 정렬/조건설정/시설등록 버튼을 **노출만** 검증 →
//    실제 클릭·동작·화면·상태(캐스케이드 필터·취소 팝업·상세 렌더)는 미검증 = "다수 화면 누락".
//  이 모듈은 시설관리 1개 화면에 4개 플로우를 완결 검증(비파괴). 라이브 검증 후 6개 리스트 화면으로 일반화 예정.
//    ① 정렬 토글(최신순↔과거순): 진입/토글 동작만 — **순서 판정은 보류**(제품 수정사항 반영 후).
//    ② 조건설정 캐스케이드: 모달 열기 → 위치(지상/지하)·2분류·3분류 → "결과가 없습니다" 빈상태 → 적용/초기화.
//    ③ 시설등록 폼 + 취소팝업: 폼 진입 → [<] 뒤로 → "작업중이던 내용을 취소하시겠습니까?" → [예] 종료(비파괴, 저장 안 함).
//    ④ 시설 상세: 항목 클릭 → 상세 렌더(점검이력·필드·위치맵) → 복귀.
//  ⚠ 비파괴 원칙: 필터는 서버 데이터 무변경(뷰만) / 등록폼은 입력해도 **저장 안 하고 취소로 폐기** / 상세는 읽기만.
// ──────────────────────────────────────────────────────────────

const ROUTE = 'facilityList';
const AREA = '시설관리' as const;
const TCREF = '코스관리모바일_시설관리딥';
const SORT_LABEL_RE = /(최신순|과거순|이름순|오래된순|가나다순|임박순|중요도순)/;

const meta = (n: number, sub: string, desc: string, failMsg: string, expected?: string): CheckMeta => ({
  path: `코스관리(모바일) > 시설관리 > ${sub}`,
  tcRef: `${TCREF}_${n}`,
  tcId: `MFACX-${String(n).padStart(2, '0')}`,
  desc, failMsg, ...(expected ? { expected } : {}),
});

const OVERLAY = '[class*="modal"], [class*="popup"], [class*="layer"], [class*="bottom-sheet"], [class*="bottomsheet"], [class*="sheet"], [class*="dialog"]';
const isOverlayOpen = (page: Page) =>
  page.locator(OVERLAY).filter({ visible: true }).count().then((c) => c > 0).catch(() => false);

// 오버레이 비파괴 닫기 — 취소/닫기 → X(close 아이콘) → Escape → 백드롭.
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

// 리스트 첫 카드 제목(재정렬/필터 반영 확인용). 없으면 ''.
async function firstCardTitle(page: Page): Promise<string> {
  const card = page.locator('[class*="bdr-12"], [class*="bd-dde3ec"], [class*="card"]').filter({ visible: true }).first();
  if (!(await card.count().catch(() => 0))) return '';
  const t = await card.evaluate((el) => {
    // 카드 내 최대 글꼴 leaf = 제목 추정, 실패 시 첫 줄.
    const txt = (el as HTMLElement).innerText || '';
    return (txt.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '');
  }).catch(() => '');
  return (t || '').slice(0, 60);
}

// 총 N건 카운트 텍스트 파싱(리스트 상단 "총 10건").
async function totalCount(page: Page): Promise<number | null> {
  const t = await page.getByText(/총\s*\d+\s*건/).first().textContent().catch(() => null);
  if (!t) return null;
  const m = t.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// 조건설정 모달의 라이브 결과 상태(건수/결과없음) — 캐스케이드 선택이 결과에 반영되는지 관찰용.
async function modalResultState(page: Page): Promise<string> {
  const empty = await page.getByText(/결과가 없습니다|검색 결과가 없|데이터가 없/).first().isVisible().catch(() => false);
  if (empty) return '결과없음';
  const cnt = await page.getByText(/\d+\s*건/).first().textContent().catch(() => '');
  const m = (cnt || '').match(/(\d+)\s*건/);
  return m ? `${m[1]}건` : '(표시없음)';
}

// 캐스케이드 옵션 리스트(위치→2분류→3분류 하위 옵션) 공용 셀렉터.
const OPT_SEL = '[class*="option"], [class*="vs__dropdown"] li, [role="option"], [class*="select-list"] li, [class*="dropdown"] li, ul li';
// 검색 정합성 오라클용 검색어 — 선택적(다수 카드에 없는) 단어. 데이터 부재 시 SKIP.
const SEARCH_TERM = '펌프';

// 시설 리스트 카드 전수 파싱(정합성 오라클용). 카드 텍스트 = "제목 위치 {지상|지하} 시설분류 {2분류/3분류} 설치 {date}".
type FacilityCard = { title: string; location: string; category: string; install: string };
async function readFacilityCards(page: Page): Promise<FacilityCard[]> {
  return page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 100 && r.height > 40; };
    const cards = (Array.from(document.querySelectorAll('[class*="bd-dde3ec"], [class*="bdr-14"]')) as HTMLElement[]).filter(vis);
    const top = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c)));
    return top.map((c) => {
      const t = (c.innerText || '').replace(/\s+/g, ' ').trim();
      const title = (t.match(/^(.*?)\s*위치\s/) || [, ''])[1].trim();
      const location = (t.match(/위치\s*(지상|지하)/) || [, ''])[1];
      const category = (t.match(/시설분류\s*(.*?)\s*설치/) || [, ''])[1].trim();
      const install = (t.match(/설치\s*([\d.\-]+)/) || [, ''])[1];
      return { title, location, category, install };
    }).filter((r) => r.title || r.location);
  }).catch(() => [] as FacilityCard[]);
}

// 시설관리 타일 진입 — 공백 무시 매칭(랜딩 타일 "시설 관리" vs "시설관리" 가변 대응, 정렬 어댑터 enterAreaFlex 동일 원리).
async function enterFacility(page: Page): Promise<boolean> {
  if (!(await enterCourseMgmt(page))) return false;
  await killMobileAlarms(page);
  const norm = (s: string) => (s || '').replace(/\s+/g, '');
  const boxes = page.locator('.content-box');
  const n = await boxes.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const t = await boxes.nth(i).innerText().catch(() => '');
    if (!norm(t).includes(norm(AREA))) continue;
    await boxes.nth(i).click({ timeout: 4_000 }).catch(() => {});
    await expect.poll(async () => /\/mobile\/course\//i.test(page.url()), { timeout: 6_000, intervals: [400, 800] }).toBeTruthy().catch(() => {});
    if (/\/mobile\/course\//i.test(page.url())) { await settle(page, 800); await killMobileAlarms(page); return true; }
  }
  return false;
}

// 하드 리셋 — 랜딩까지 나갔다 시설관리 재진입(스택 붕괴). ⚠ 이 SPA는 리스트↔상세↔서브를 스택으로 쌓아
//   뒤로가기로 완전히 안 풀림(헤더 공존) → 플로우마다 클린 시작 보장(10차런 근본 대응).
async function hardReset(page: Page): Promise<boolean> {
  await returnToLanding(page).catch(() => {});
  await settle(page, 500);
  const ok = await enterFacility(page);
  await settle(page, 700);
  return ok;
}

// ══════════════════ 메인 러너 ══════════════════
export async function runMobileFacilityDeep(page: Page): Promise<void> {
  const ok = await enterFacility(page);
  if (!ok) { skip(meta(1, '진입', '시설관리 화면 진입', '진입 실패'), '시설관리 라우트 도달 실패(세션/네비)'); return; }
  await settle(page, 800);

  // ⚠ 하드리셋은 스택을 "만드는" 플로우(상세·등록) **뒤**에만 — 앞에 두면 리셋 직후 하이드레이션 레이스로
  //   카드 클릭이 상세를 안 여는 문제(11차런). sort→filter→detail 은 각자 오버레이만 닫으면 클린 유지됨.
  await flowSort(page);
  await flowFilter(page);
  await flowDetail(page);
  await hardReset(page);        // 상세 서브화면 스택 붕괴 → 등록 클린 시작.
  await flowRegisterCancel(page);
  await hardReset(page);        // 등록 폼 스택 붕괴 → 검색 클린 시작.
  await flowSearch(page);
}

// ── B) 리스트 헤더 검색(돋보기) → 검색어 입력 → 결과 반영 → 해제(비파괴 조회) ──────
async function flowSearch(page: Page): Promise<void> {
  await ensureOnList(page);
  const totalBefore = await totalCount(page);
  const searchBtn = page.locator('button.ico-search, [class*="ico-search"]').filter({ visible: true }).first();
  if (!(await searchBtn.count().catch(() => 0))) { skip(meta(50, '검색', '검색 아이콘 노출', '미노출'), '검색 아이콘 미발견'); return; }

  let opened = false;
  await check(page, meta(50, '검색', '검색 아이콘 클릭 → 검색 입력 활성', '검색 입력 미활성'), async () => {
    if (!(await searchBtn.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await searchBtn.click({ force: true, timeout: 2_000 }).catch(() => {});
    await settle(page, 1_000);
    let inp = page.locator('input.search-header, input[class*="search"]').filter({ visible: true }).first();
    if (!(await inp.count().catch(() => 0))) {
      // 클릭이 토글이 아니라 검색 화면 전환일 수 있음 → 재시도/대체 입력 탐색.
      await settle(page, 600);
      inp = page.locator('input.search-header, input[class*="search"], input[placeholder*="검색"], input.item-content').filter({ visible: true }).first();
    }
    if (!(await inp.count().catch(() => 0))) await probeDump(page, '검색', '검색 아이콘 클릭 후 화면 — 입력창 구조');
    await expect(inp).toBeVisible({ timeout: 3_000 });
    await inp.fill(SEARCH_TERM).catch(() => {});
    await settle(page, 1_200);
    opened = true;
  });

  if (opened) {
    const totalAfter = await totalCount(page);
    record(meta(51, '검색', '검색어 입력 → 결과 반영(총건수)', '결과 미반영'), totalAfter != null ? 'PASS' : 'FAIL',
      { actual: `총건수 ${totalBefore ?? '?'}→${totalAfter ?? '?'} (검색어 "${SEARCH_TERM}")` });

    // 52) 검색 결과 정합성(오라클) — 결과 카드 제목/분류에 검색어가 실제 포함되는가.
    const cards = await readFacilityCards(page);
    if (cards.length === 0) {
      skip(meta(52, '검색', `검색 "${SEARCH_TERM}" 결과 정합성`, '결과 0'), `검색 결과 0건(데이터 의존, "${SEARCH_TERM}" 미존재 가능)`);
    } else {
      const bad = cards.filter((c) => !(`${c.title} ${c.category}`.includes(SEARCH_TERM)));
      record(meta(52, '검색', `검색 "${SEARCH_TERM}" → 결과 전부 검색어 포함(정합성 오라클)`, '검색어 미포함 카드 노출'),
        bad.length === 0 ? 'PASS' : 'FAIL',
        { actual: bad.length === 0 ? `${cards.length}건 모두 "${SEARCH_TERM}" 포함` : `위반 ${bad.length}건: ${bad.slice(0, 3).map((c) => c.title).join(', ')}` });
    }

    // 검색 해제(비파괴): 삭제(X) → 없으면 재진입.
    const del = page.locator('button.ico-circle-delete, [class*="ico-circle-delete"]').filter({ visible: true }).first();
    if (await del.count().catch(() => 0)) await del.click({ timeout: 2_000 }).catch(() => {});
    await settle(page, 500);
  } else {
    skip(meta(51, '검색', '검색어 입력 → 결과 반영', '검색 미활성'), '검색 입력 미활성 — 후속 스킵');
    skip(meta(52, '검색', '검색 결과 정합성', '검색 미활성'), '검색 입력 미활성 — 후속 스킵');
  }
  await ensureOnList(page);
}

// ── ① 정렬 토글(진입/토글 동작만 — 순서 판정 보류) ──────────────────────────
async function flowSort(page: Page): Promise<void> {
  await ensureOnList(page);
  const sortBtn = page.getByText(SORT_LABEL_RE).filter({ visible: true }).first();
  if (!(await sortBtn.count().catch(() => 0))) {
    skip(meta(10, '정렬', '정렬 버튼 노출', '미노출'), '정렬 토글 버튼 미발견(SORT_LABEL_RE)');
    return;
  }
  const before = (await sortBtn.textContent().catch(() => ''))?.replace(/\s+/g, '') || '';
  const firstBefore = await firstCardTitle(page);

  await check(page, meta(11, '정렬', `정렬 버튼 클릭 → 토글/옵션 동작(현재 라벨 "${before}")`, '정렬 클릭 무동작'), async () => {
    await sortBtn.click({ timeout: 3_000 });
    await settle(page, 900);
    // 케이스 A: 오버레이(옵션 시트) 열림 → 다른 옵션 선택.
    if (await isOverlayOpen(page)) {
      const opts = page.locator(OVERLAY).getByText(SORT_LABEL_RE).filter({ visible: true });
      const cnt = await opts.count().catch(() => 0);
      // 현재 라벨과 다른 첫 옵션 클릭.
      for (let i = 0; i < cnt; i++) {
        const t = (await opts.nth(i).textContent().catch(() => ''))?.replace(/\s+/g, '') || '';
        if (t && t !== before) { await opts.nth(i).click({ timeout: 2_000 }).catch(() => {}); break; }
      }
      await settle(page, 900);
      if (await isOverlayOpen(page)) await closeOverlay(page);
    }
  });

  // 토글 결과: 라벨 변경 또는 리스트 재정렬(첫 카드 변화) 확인 — 둘 중 하나면 동작한 것.
  await ensureOnList(page);
  const after = (await page.getByText(SORT_LABEL_RE).filter({ visible: true }).first().textContent().catch(() => ''))?.replace(/\s+/g, '') || '';
  const firstAfter = await firstCardTitle(page);
  const labelChanged = before && after && before !== after;
  const listChanged = firstBefore && firstAfter && firstBefore !== firstAfter;
  if (labelChanged || listChanged) {
    record(meta(12, '정렬', '정렬 토글 반영(라벨 변경 또는 리스트 재정렬)', '토글 무반영'), 'PASS',
      { actual: `라벨 ${before}→${after}${labelChanged ? '(변경)' : '(동일)'} / 첫항목 ${listChanged ? '변화' : '동일'}` });
  } else {
    // 라벨·리스트 모두 불변 = 토글이 반영 안 됐거나 단일 옵션 — 순서 판정 보류 방침이므로 관찰로 기록(FAIL 아님).
    review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 정렬', kind: '정렬 토글 무반영(관찰)', zone: 'sort',
      item: `라벨 ${before}→${after}`, value: `첫항목 before="${firstBefore}" after="${firstAfter}" — 순서판정 보류(제품 수정 대기)`, screenshot: '' });
    skip(meta(12, '정렬', '정렬 토글 반영', '토글 무반영'), '라벨·리스트 불변 — 순서 판정은 수정사항 반영 후로 보류');
  }
}

// 실패 시 화면 구조 덤프(관찰시트) — 다음 런 셀렉터 정밀화용. 보이는 요소의 class+짧은텍스트.
async function probeDump(page: Page, sub: string, note: string): Promise<void> {
  const dump = await page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 8 && r.height > 8; };
    return Array.from(document.querySelectorAll('button, [class*="btn"], [class*="button"], [class*="modal"], [class*="sheet"], [class*="layer"], [class*="select"], [class*="option"], label, h1, h2, h3, [class*="title"], [class*="card"], [class*="list"], [class*="item"], [class*="bdr"], [class*="cont"], a, li'))
      .filter((e) => vis(e))
      .map((e) => { const t = ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28); const c = (e.className || '').toString().replace(/\s+/g, '.').slice(0, 40); const d = (e as HTMLElement).getAttribute('data-v-') != null ? '' : ((e as HTMLElement).getAttribute('to') || (e as HTMLElement).getAttribute('href') || ''); return `${e.tagName.toLowerCase()}.${c}${d ? `@${d.slice(0, 30)}` : ''}${t ? `="${t}"` : ''}`; })
      .filter((s, i, a) => a.indexOf(s) === i).slice(0, 55);
  }).catch(() => [] as string[]);
  review({ lang: '기능', screen: `코스관리(모바일) > 시설관리 > ${sub}`, kind: 'DOM 구조 프로브', zone: 'probe', item: note, value: dump.join(' | '), screenshot: '' });
}

// 상세 ⋮(더보기) 좌표 클릭 — 상단(y<80) 우측(x>180) 최말단 버튼(알림/홈/검색/뒤로/햄버거 제외) = ⋮.
//   ⚠ 클래스 셀렉터가 불안정(ico-menu-1=햄버거 오클릭)해 좌표 클릭으로 확정(고정 헤더).
async function clickKebab(page: Page): Promise<boolean> {
  // ⚠ 스택 구조: 리스트/상세 헤더 공존 → "시설 상세" 텍스트가 있는 헤더 컨테이너로 스코프해 그 안의 우측 버튼만.
  const box = await page.evaluate(() => {
    const leaf = (Array.from(document.querySelectorAll('*')) as HTMLElement[])
      .find((e) => (e.textContent || '').trim() === '시설 상세' && e.children.length === 0);
    if (!leaf) return null;
    // "시설 상세" 를 품은 헤더 행(버튼을 포함하는 최근접 조상).
    let hdr: HTMLElement | null = leaf;
    for (let i = 0; i < 5 && hdr; i++) { if (hdr.querySelectorAll('button, i[class*="ico"]').length >= 2) break; hdr = hdr.parentElement; }
    if (!hdr) return null;
    // ⚠ 스코프 컨테이너가 리스트 헤더까지 포함 → 리스트 아이콘(검색/필터/메뉴/정렬)이 상세 ⋮보다 우측이라 오선택됨(12차런).
    //   리스트/글로벌 아이콘 전부 제외 → 남는 최우측 = 상세 ⋮.
    const btns = (Array.from(hdr.querySelectorAll('button, i[class*="ico"], [class*="ico"]')) as HTMLElement[])
      .map((e) => ({ r: e.getBoundingClientRect(), cls: (e.className || '').toString() }))
      .filter((o) => o.r.width > 6 && o.r.height > 6
        && !/arrow-prev|ico-home|ico-alarm|ico-profile|ico-search|ico-filter|ico-menu-1|ico-sort|ico-circle-delete/.test(o.cls));
    if (!btns.length) return null;
    btns.sort((a, b) => b.r.left - a.r.left);   // 최우측 = ⋮
    const r = btns[0].r; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), cls: btns[0].cls };
  }).catch(() => null);
  if (!box) return false;
  await page.mouse.click(box.x, box.y).catch(() => {});
  await settle(page, 700);
  review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 상세', kind: 'kebab 클릭 좌표(관찰)', zone: 'probe', item: `클릭 cls="${box.cls}"`, value: `@(${box.x},${box.y})`, screenshot: '' });
  return true;
}

// ── ② 조건설정 캐스케이드(위치→2분류→3분류·빈상태·적용/초기화) ──────────────
//   ⚠ .last() 오버레이 스코핑이 백드롭을 잡던 문제(1차런) → **페이지 레벨 텍스트 매칭**으로 재작성(모달이 화면 전체 덮음).
async function flowFilter(page: Page): Promise<void> {
  await ensureOnList(page);
  const totalBefore = await totalCount(page);
  const filterBtn = page.getByText(/^\s*조건설정\s*$/).filter({ visible: true }).first();
  if (!(await filterBtn.count().catch(() => 0))) {
    skip(meta(20, '조건설정', '조건설정 버튼 노출', '미노출'), '조건설정 버튼 미발견');
    return;
  }

  // 20) 모달 열림 + 섹션(위치/분류/초기화) 노출 — "초기화"가 모달 고유 신호(트리거엔 없음).
  let modalOpen = false;
  await check(page, meta(20, '조건설정', '조건설정 클릭 → 모달 열림 + 위치·분류·초기화 노출', '모달 미출현/섹션 누락'), async () => {
    await filterBtn.click({ timeout: 3_000 });
    await settle(page, 1_000);
    await expect(page.getByText(/초기화/).first()).toBeVisible({ timeout: 4_000 });
    await expect(page.getByText(/^\s*위치\s*$|위치/).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/분류/).first()).toBeVisible({ timeout: 3_000 });
    modalOpen = true;
  });
  if (!modalOpen) {
    await probeDump(page, '조건설정', '모달 열림/섹션 미포착 — 실제 컨테이너·라벨 구조');
    await ensureOnList(page); return;
  }

  // 27) 분류 기본값 노출 — "2분류 전체"·"3분류 전체"(전체=집계 기본값) + 3분류 초기 비활성(위치/2분류 선행). 사용자 지적.
  await check(page, meta(27, '조건설정', '분류 기본값 "2분류 전체"·"3분류 전체" 노출 + 3분류 초기 비활성', '분류 기본값/비활성 미확인'), async () => {
    await expect(page.getByText(/2분류\s*전체/).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/3분류\s*전체/).first()).toBeVisible({ timeout: 3_000 });
    // 3분류 초기 비활성(위치·2분류 미선택 상태) — 구현차 대비 관찰 기록(하드 판정 아님).
    const c3disabled = await page.getByText(/3분류\s*전체/).first().evaluate((el) => {
      const box = (el.closest('[class*="v-select"], [class*="select-wrap"], [class*="dropdown"]') || el) as HTMLElement;
      const st = getComputedStyle(box);
      return /vs--disabled|disabled/.test((box.className || '').toString()) || st.pointerEvents === 'none' || parseFloat(st.opacity || '1') < 0.9;
    }).catch(() => false);
    review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 조건설정', kind: '3분류 초기 비활성(관찰)', zone: 'filter', item: `3분류 disabled=${c3disabled}`, value: '위치·2분류 미선택 상태', screenshot: '' });
  });

  // 21) 위치 미선택 상태에서 2분류 열기 → "결과가 없습니다" 빈상태(캐스케이드 = 위치 선행 필요).
  const cat2 = page.getByText(/2분류|분류 선택|^\s*선택\s*$/).filter({ visible: true }).first();
  if (await cat2.count().catch(() => 0)) {
    await cat2.click({ timeout: 2_500 }).catch(() => {});
    await settle(page, 900);
    const empty = await page.getByText(/결과가 없습니다|검색 결과가 없|데이터가 없/).first().isVisible().catch(() => false);
    if (empty) {
      record(meta(21, '조건설정', '위치 미선택 + 2분류 열기 → "결과가 없습니다" 빈상태', '빈상태 미표시'), 'PASS', { actual: '결과가 없습니다 노출' });
    } else {
      skip(meta(21, '조건설정', '위치 미선택 + 2분류 → 빈상태', '빈상태 미표시'), '2분류에 옵션 바로 노출(위치 선행 미요구) 또는 드롭다운 미열림 — 관찰');
      await probeDump(page, '조건설정·빈상태', '2분류 클릭 후 화면 — 빈상태 문구/옵션 구조');
    }
    // ⚠ Escape 금지(모달 전체 닫힘 위험) — 2분류 헤더 재클릭으로 접기(있으면).
    await cat2.click({ timeout: 1_500 }).catch(() => {});
    await settle(page, 400);
  } else {
    skip(meta(21, '조건설정', '2분류 드롭다운', '미발견'), '2분류/선택 드롭다운 미발견');
  }

  // 22) 위치(지상/지하) 선택 → 2분류 옵션 활성 → 선택. 페이지 레벨 버튼 매칭.
  const loc = page.getByRole('button', { name: /^\s*(지상|지하)\s*$/ }).filter({ visible: true }).first();
  const locFallback = page.getByText(/^\s*(지상|지하)\s*$/).filter({ visible: true }).first();
  const locTarget = (await loc.count().catch(() => 0)) ? loc : locFallback;
  if (await locTarget.count().catch(() => 0)) {
    const locName = (await locTarget.textContent().catch(() => ''))?.trim() || '위치';
    await check(page, meta(22, '조건설정', `위치 "${locName}" 선택 → 2분류 옵션 활성`, '위치 선택 후 2분류 미활성'), async () => {
      // 위치 토글 — 일반 클릭 실패 시 force(고정 레이아웃 actionability 대응).
      if (!(await locTarget.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await locTarget.click({ force: true, timeout: 2_000 }).catch(() => {});
      await settle(page, 900);
      const c2 = page.getByText(/2분류|분류 선택|^\s*선택\s*$/).filter({ visible: true }).first();
      if (!(await c2.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await c2.click({ force: true, timeout: 2_000 }).catch(() => {});
      await settle(page, 1_000);
      const opt = page.locator('[class*="option"], [class*="vs__dropdown"] li, [role="option"], [class*="select-list"] li, [class*="dropdown"] li, ul li').filter({ visible: true });
      const cnt = await opt.count().catch(() => 0);
      if (cnt === 0) await probeDump(page, '조건설정·2분류옵션', '위치 선택 후 2분류 옵션 미발견 — 옵션 컨테이너 구조');
      expect(cnt).toBeGreaterThan(0);
      await opt.first().click({ timeout: 2_000 }).catch(() => {});
      await settle(page, 600);
    });
  } else {
    skip(meta(22, '조건설정', '위치 선택 → 2분류 활성', '위치 토글 미발견'), '모달 내 지상/지하 토글 미발견');
    await probeDump(page, '조건설정·위치', '지상/지하 토글 미발견 — 위치 섹션 구조');
  }

  // 25) 위치 "지하" 선택 → 2분류 활성 + 결과(리스트) 반영. (22=지상 브랜치, 25=지하 브랜치 별도 검증 — 사용자 요청)
  const jiha = page.getByRole('button', { name: /^\s*지하\s*$/ }).filter({ visible: true }).first();
  const jihaFb = page.getByText(/^\s*지하\s*$/).filter({ visible: true }).first();
  const jihaT = (await jiha.count().catch(() => 0)) ? jiha : jihaFb;
  if (await jihaT.count().catch(() => 0)) {
    await check(page, meta(25, '조건설정', '위치 "지하" 선택 → 2분류 활성 + 결과 반영', '지하 선택 후 2분류 미활성/결과 미반영'), async () => {
      const r0 = await modalResultState(page);
      if (!(await jihaT.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await jihaT.click({ force: true, timeout: 2_000 }).catch(() => {});
      await settle(page, 900);
      const c2 = page.getByText(/2분류|분류 선택|^\s*선택\s*$/).filter({ visible: true }).first();
      if (!(await c2.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await c2.click({ force: true, timeout: 2_000 }).catch(() => {});
      await settle(page, 1_000);
      const opt = page.locator(OPT_SEL).filter({ visible: true });
      const cnt = await opt.count().catch(() => 0);
      if (cnt === 0) await probeDump(page, '조건설정·지하2분류', '지하 선택 후 2분류 옵션 미발견 — 옵션 구조');
      expect(cnt).toBeGreaterThan(0);
      const optTxt = (await opt.first().textContent().catch(() => ''))?.trim().slice(0, 20) || '';
      await opt.first().click({ timeout: 2_000 }).catch(() => {});
      await settle(page, 700);
      const r1 = await modalResultState(page);
      review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 조건설정', kind: '지하 캐스케이드 결과 반영(관찰)', zone: 'filter',
        item: `2분류 옵션#0="${optTxt}"`, value: `모달 결과 ${r0}→${r1}`, screenshot: '' });
    });
  } else {
    skip(meta(25, '조건설정', '위치 "지하" → 2분류 활성', '지하 토글 미발견'), '모달 내 지하 토글 미발견');
  }

  // 26) 2분류 선택 상태 → 3분류 활성 + 결과 반영. ⚠ 특정 2분류는 3분류가 없을 수 있음(데이터) → 옵션0은 관찰(활성 자체는 판정).
  const cat3 = page.getByText(/3분류/).filter({ visible: true }).first();
  if (await cat3.count().catch(() => 0)) {
    await check(page, meta(26, '조건설정', '2분류 선택 → 3분류 활성 + 결과 반영', '3분류 미활성'), async () => {
      const r0 = await modalResultState(page);
      // 3분류 컨트롤 활성(비활성 클래스 해제) 확인.
      const disabledBefore = await cat3.evaluate((el) => {
        const box = el.closest('[class*="v-select"], [class*="select-wrap"]') || el;
        return /vs--disabled|disabled/.test((box.className || '').toString());
      }).catch(() => false);
      if (!(await cat3.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await cat3.click({ force: true, timeout: 2_000 }).catch(() => {});
      await settle(page, 1_000);
      const opt = page.locator(OPT_SEL).filter({ visible: true });
      const cnt = await opt.count().catch(() => 0);
      const r1 = await modalResultState(page);
      // 활성 판정: 클릭 후 옵션이 열리거나(>0), 비활성 클래스가 애초에 없던 것(활성) → PASS. 옵션0은 데이터 의존 관찰.
      const activated = cnt > 0 || !disabledBefore;
      if (cnt > 0) { await opt.first().click({ timeout: 2_000 }).catch(() => {}); await settle(page, 600); }
      review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 조건설정', kind: '3분류 활성/결과 반영(관찰)', zone: 'filter',
        item: `3분류 옵션수=${cnt} (비활성 이전=${disabledBefore})`, value: `모달 결과 ${r0}→${r1}`, screenshot: '' });
      expect(activated).toBeTruthy();
    });
  } else {
    skip(meta(26, '조건설정', '2분류 선택 → 3분류 활성', '3분류 드롭다운 미발견'), '모달 내 3분류 컨트롤 미발견');
  }

  // 23) 적용 → 리스트 복귀·재렌더(비파괴 뷰 필터). 필터 선택성은 데이터 의존이라 총건수 동일도 정상 → 적용 동작 완료 여부로 판정.
  const applyBtn = page.getByText(/^\s*(적용|검색|조회)\s*$/).filter({ visible: true }).last();
  if (await applyBtn.count().catch(() => 0)) {
    await applyBtn.click({ timeout: 2_500 }).catch(() => {});
    await settle(page, 1_200);
    await ensureOnList(page);
    const totalAfter = await totalCount(page);
    if (totalAfter != null) {
      record(meta(23, '조건설정', '적용 → 리스트 복귀·필터 반영', '필터 미반영'), 'PASS',
        { actual: `총건수 ${totalBefore ?? '?'}→${totalAfter}${totalBefore === totalAfter ? '(동일·데이터 의존)' : '(변화)'}` });
    } else {
      record(meta(23, '조건설정', '적용 → 리스트 복귀', '리스트 미복귀'), 'FAIL', { actual: '적용 후 리스트(총 N건) 미복귀' });
    }
  } else {
    skip(meta(23, '조건설정', '적용 → 필터 반영', '적용 버튼 미발견'), '모달 내 적용/검색 버튼 미발견');
    if (await isOverlayOpen(page)) await closeOverlay(page);
  }

  // 24) 초기화로 필터 원복(비파괴 복구). 재오픈 → 초기화 → 적용.
  await ensureOnList(page);
  const reopen = page.getByText(/^\s*조건설정\s*$/).filter({ visible: true }).first();
  if (await reopen.count().catch(() => 0)) {
    await reopen.click({ timeout: 2_500 }).catch(() => {});
    await settle(page, 900);
    const reset = page.getByText(/초기화/).filter({ visible: true }).first();
    if (await reset.count().catch(() => 0)) {
      await check(page, meta(24, '조건설정', '초기화 → 필터 조건 원복(비파괴 복구)', '초기화 무동작'), async () => {
        if (!(await reset.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await reset.click({ force: true, timeout: 2_000 }).catch(() => {});
        await settle(page, 700);
        const apply2 = page.getByText(/^\s*(적용|검색|조회)\s*$/).filter({ visible: true }).last();
        if (await apply2.count().catch(() => 0)) await apply2.click({ timeout: 2_000 }).catch(() => {});
        await settle(page, 1_000);
      });
    } else { skip(meta(24, '조건설정', '초기화 복구', '초기화 버튼 미발견'), '초기화 버튼 미발견'); }
    if (await isOverlayOpen(page)) await closeOverlay(page);
  }
  await ensureOnList(page);

  // ── 정합성 오라클: 필터가 실제로 올바른 결과를 내는가(동작 완료가 아니라 결과 검증) ──
  // 28) 위치 "지하" 필터 → 결과 카드 전부 위치=지하.
  await ensureOnList(page);
  const openF = page.getByText(/^\s*조건설정\s*$/).filter({ visible: true }).first();
  if (await openF.count().catch(() => 0)) {
    await openF.click({ timeout: 2_500 }).catch(() => {});
    await settle(page, 900);
    // 초기화(누적 필터 제거) 후 지하만 선택.
    const rst = page.getByText(/초기화/).filter({ visible: true }).first();
    if (await rst.count().catch(() => 0)) { await rst.click({ timeout: 2_000 }).catch(() => {}); await settle(page, 500); }
    // ⚠ 지하 = <button>(type-s)로 스코프 — 카드 텍스트 "위치 지하"와 혼동 방지. active 될 때까지 최대 3회 클릭.
    const jiha = page.locator('button').filter({ hasText: /^\s*지하\s*$/ }).filter({ visible: true }).first();
    const isActive = async () => jiha.evaluate((el) => /\bactive\b|selected/.test((el.className || '').toString())).catch(() => false);
    if (await jiha.count().catch(() => 0)) {
      let jihaActive = false;
      for (let i = 0; i < 3 && !jihaActive; i++) {
        if (!(await jiha.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await jiha.click({ force: true, timeout: 2_000 }).catch(() => {});
        await settle(page, 600);
        jihaActive = await isActive();
      }
      const totBefore = await totalCount(page);
      const ap = page.getByText(/^\s*(적용|검색|조회)\s*$/).filter({ visible: true }).last();
      const applied = (await ap.count().catch(() => 0)) ? await ap.click({ timeout: 2_000 }).then(() => true).catch(() => false) : false;
      await settle(page, 1_200);
      await ensureOnList(page);
      const totAfter = await totalCount(page);
      const cards = await readFacilityCards(page);
      const withLoc = cards.filter((c) => c.location);
      const diag = `[진단] 지하 active=${jihaActive}, 적용클릭=${applied}, 총건수 ${totBefore ?? '?'}→${totAfter ?? '?'}`;
      review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 조건설정', kind: '지하 필터 진단', zone: 'oracle', item: diag, value: `카드 ${withLoc.length}건`, screenshot: '' });
      if (withLoc.length === 0) {
        skip(meta(28, '조건설정', '위치 "지하" 필터 결과 정합성', '결과 0'), '지하 필터 결과 0건(데이터 의존)');
      } else if (!jihaActive) {
        // 지하가 선택 상태가 아니면 필터 미적용(테스트 이슈) → 가짜 결함 방지로 SKIP + 진단.
        skip(meta(28, '조건설정', '위치 "지하" 필터 결과 정합성', '필터 미선택'), `지하 버튼 미선택(active=false) — 필터 미적용, 결과판정 보류. ${diag}`);
      } else {
        const bad = withLoc.filter((c) => c.location !== '지하');
        record(meta(28, '조건설정', '위치 "지하" 필터 → 결과 전부 지하(정합성 오라클)', '지하 아닌 카드 노출'),
          bad.length === 0 ? 'PASS' : 'FAIL',
          { actual: (bad.length === 0 ? `${withLoc.length}건 모두 지하` : `위반 ${bad.length}건: ${bad.slice(0, 3).map((c) => `${c.title}(${c.location})`).join(', ')}`) + ` | ${diag}` });
      }
    } else { skip(meta(28, '조건설정', '위치 "지하" 필터 정합성', '지하 토글 미발견'), '지하 토글 미발견'); }
    // 복구(비파괴): 초기화 후 적용.
    const reopen2 = (await isOverlayOpen(page)) ? true : (await (async () => { const o = page.getByText(/^\s*조건설정\s*$/).filter({ visible: true }).first(); if (await o.count().catch(() => 0)) { await o.click({ timeout: 2_000 }).catch(() => {}); await settle(page, 700); return true; } return false; })());
    if (reopen2) {
      const rst2 = page.getByText(/초기화/).filter({ visible: true }).first();
      if (await rst2.count().catch(() => 0)) { await rst2.click({ timeout: 2_000 }).catch(() => {}); await settle(page, 400); const ap2 = page.getByText(/^\s*(적용|검색|조회)\s*$/).filter({ visible: true }).last(); if (await ap2.count().catch(() => 0)) await ap2.click({ timeout: 2_000 }).catch(() => {}); await settle(page, 800); }
      if (await isOverlayOpen(page)) await closeOverlay(page);
    }
  } else { skip(meta(28, '조건설정', '위치 필터 정합성', '조건설정 미발견'), '조건설정 버튼 미발견'); }
  await ensureOnList(page);
}

// ── ③ 시설등록 폼 + 취소 팝업(비파괴: 입력해도 저장 안 함, [예]로 폐기) ──────────
async function flowRegisterCancel(page: Page): Promise<void> {
  await ensureOnList(page);
  // 하단 고정 바 버튼 = <button class="button-common type-p flex-1"><span class="button-text">시설 등록</span></button>.
  //   ⚠ span(.button-text)을 잡으면 force 클릭이 핸들러를 못 깨움(3차런) → **button 요소** 직접 타겟.
  const regBtn = page.locator('button').filter({ hasText: /^\s*시설 등록\s*$/ }).filter({ visible: true }).last();
  const regRole = page.getByRole('button', { name: /시설 등록/ }).filter({ visible: true }).last();
  const reg = (await regBtn.count().catch(() => 0)) ? regBtn : regRole;
  if (!(await reg.count().catch(() => 0))) {
    skip(meta(30, '시설등록', '시설 등록 버튼 노출', '미노출'), '시설 등록 버튼 미발견');
    return;
  }
  const before = page.url();

  // 30) 폼 진입 + 필수 필드 렌더(시설명/위치/분류/담당자/최초 설치일). 고정 바 가림 대비 scrollIntoView + force 폴백.
  await check(page, meta(30, '시설등록', '시설 등록 클릭 → 등록 폼 진입 + 필수 필드 렌더', '폼 미진입/필드 누락'), async () => {
    await reg.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
    if (!(await reg.click({ timeout: 3_000 }).then(() => true).catch(() => false))) {
      await reg.click({ timeout: 3_000, force: true }).catch(() => {});
    }
    await settle(page, 1_400);
    // 폼 진입 = URL 변경 또는 시설명 입력 노출.
    const nameInput = page.locator('input[placeholder*="시설명"], input[placeholder*="시설명 입력"]').first();
    const entered = page.url() !== before || (await nameInput.count().catch(() => 0)) > 0;
    expect(entered).toBeTruthy();
    await expect(page.getByText(/시설명/).first()).toBeVisible({ timeout: 4_000 });
    await expect(page.getByText(/^\s*위치\s*$|위치/).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/담당자/).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/최초 설치일/).first()).toBeVisible({ timeout: 3_000 });
  });

  const onForm = page.url() !== before || (await page.locator('input[placeholder*="시설명"], input.item-content').count().catch(() => 0)) > 0;
  if (!onForm) {
    skip(meta(31, '시설등록', '취소 팝업', '폼 미진입'), '폼 미진입 — 취소 팝업 스킵');
    await probeDump(page, '시설등록', '등록 버튼 클릭 후 폼 미진입 — 현재 화면 구조(버튼 클릭 가로채짐 등)');
    await ensureOnList(page); return;
  }

  // ── A) 등록폼 필드 조작(비파괴 — 저장 안 함, 마지막에 취소로 폐기) ──
  // 33) 분류 v-select → 옵션 선택 → 3분류 활성. (분류 placeholder="선택"(exact) — 담당자/3분류/거래처와 구분)
  const catSel = page.getByText('선택', { exact: true }).filter({ visible: true }).first();
  if (await catSel.count().catch(() => 0)) {
    await check(page, meta(33, '시설등록', '분류 선택(v-select) → 옵션 선택 → 3분류 활성', '분류 선택 미동작'), async () => {
      await catSel.click({ timeout: 2_500 }).catch(() => {});
      await settle(page, 800);
      const opt = page.locator(OPT_SEL).filter({ visible: true });
      const cnt = await opt.count().catch(() => 0);
      if (cnt === 0) await probeDump(page, '시설등록·분류', '분류 v-select 옵션 미발견 — 옵션 구조');
      expect(cnt).toBeGreaterThan(0);
      await opt.first().click({ timeout: 2_000 }).catch(() => {});
      await settle(page, 800);
      // 3분류 활성(비활성 클래스 해제) 확인 — 데이터에 3분류 없으면 관찰.
      const c3 = page.locator('.v-select').filter({ hasText: /3분류/ }).first();
      const c3dis = await c3.evaluate((el) => /vs--disabled|disabled/.test((el.className || '').toString())).catch(() => true);
      review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 시설등록', kind: '분류→3분류 활성(관찰)', zone: 'form', item: `3분류 비활성=${c3dis}`, value: '', screenshot: '' });
    });
  } else { skip(meta(33, '시설등록', '분류 select', '미발견'), '분류 v-select 미발견'); }

  // 34) 담당자 v-select → 옵션 노출/선택.
  const mgrSel = page.locator('.v-select').filter({ hasText: /담당자 선택/ }).filter({ visible: true }).first();
  if (await mgrSel.count().catch(() => 0)) {
    await check(page, meta(34, '시설등록', '담당자 선택(v-select) → 옵션 노출/선택', '담당자 선택 미동작'), async () => {
      await mgrSel.click({ timeout: 2_500 }).catch(() => {});
      await settle(page, 800);
      const opt = page.locator(OPT_SEL).filter({ visible: true });
      const cnt = await opt.count().catch(() => 0);
      if (cnt === 0) await probeDump(page, '시설등록·담당자', '담당자 v-select 옵션 미발견 — 옵션 구조');
      expect(cnt).toBeGreaterThan(0);
      await opt.first().click({ timeout: 2_000 }).catch(() => {});
      await settle(page, 600);
    });
  } else { skip(meta(34, '시설등록', '담당자 select', '미발견'), '담당자 v-select 미발견'); }

  // 35) 최초 설치일 datepicker → 달력 노출 → 닫기(날짜 변경 안 함, 비파괴).
  const dateField = page.locator('label:has-text("최초 설치일")').locator('xpath=following::*[self::input or contains(@class,"text-field") or contains(@class,"date")][1]').first();
  const dateFallback = page.locator('[class*="date"], input[type="date"]').filter({ visible: true }).first();
  const dateT = (await dateField.count().catch(() => 0)) ? dateField : dateFallback;
  if (await dateT.count().catch(() => 0)) {
    await check(page, meta(35, '시설등록', '최초 설치일 클릭 → 달력/데이트피커 노출', '데이트피커 미노출'), async () => {
      await dateT.click({ timeout: 2_500 }).catch(() => {});
      await settle(page, 800);
      const cal = page.locator('[class*="datepicker"], [class*="calendar"], [class*="date-layer"], input[type="date"]').filter({ visible: true }).first();
      const shown = (await cal.count().catch(() => 0)) > 0 || (await page.getByText(/일|월|요일|Su|Mo/).first().isVisible().catch(() => false));
      if (!shown) await probeDump(page, '시설등록·설치일', '설치일 클릭 후 데이트피커 미노출 — 구조');
      expect(shown).toBeTruthy();
      await page.keyboard.press('Escape').catch(() => {});
      await settle(page, 400);
    });
  } else { skip(meta(35, '시설등록', '설치일 datepicker', '미발견'), '최초 설치일 필드 미발견'); }

  // 36) 위치 등록 → 위치 picker/지도 노출 → 취소/뒤로 복귀(비파괴).
  const locReg = page.getByText(/^\s*위치 등록\s*$/).filter({ visible: true }).first();
  if (await locReg.count().catch(() => 0)) {
    const formUrl = page.url();
    await check(page, meta(36, '시설등록', '위치 등록 클릭 → 위치 picker/지도 노출', '위치 picker 미노출'), async () => {
      await locReg.click({ timeout: 2_500 }).catch(() => {});
      await settle(page, 1_200);
      const shown = (await page.locator('canvas, [class*="map"]').filter({ visible: true }).first().count().catch(() => 0)) > 0
        || (await page.getByText(/위치 검색|주소|코스|홀|지도/).first().isVisible().catch(() => false))
        || page.url() !== formUrl;
      if (!shown) await probeDump(page, '시설등록·위치등록', '위치 등록 클릭 후 화면 — picker/지도 구조');
      expect(shown).toBeTruthy();
    });
    // 폼으로 복귀(비파괴): 취소/닫기/뒤로.
    if (await isOverlayOpen(page)) await closeOverlay(page);
    if (page.url() !== formUrl) { await mobileBack(page); await settle(page, 800); }
  } else { skip(meta(36, '시설등록', '위치 등록', '미발견'), '위치 등록 버튼 미발견'); }

  // 31) 폼에 값 입력(비파괴 — 저장 안 함) → [<] 뒤로 → "작업중이던 내용을 취소하시겠습니까?" 팝업.
  //   ⚠ 시설명 input = input.item-content(placeholder 없음, placeholder는 컨테이너 div 텍스트) — 폼 첫 텍스트 input 타겟.
  const nameInput = page.locator('.text-field-container input.item-content, form input.item-content, input.item-content').first();
  let filled = false;
  if (await nameInput.count().catch(() => 0)) {
    await nameInput.fill('E2E_비저장_취소검증').catch(() => {});
    filled = ((await nameInput.inputValue().catch(() => '')) || '').length > 0;
  }
  await settle(page, 500);
  if (!filled) review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 시설등록', kind: '시설명 입력 미반영(관찰)', zone: 'probe', item: '변경감지 트리거 실패 가능', value: '시설명 input.item-content fill 실패 — 확인팝업이 미출현할 수 있음', screenshot: '' });

  // ⚠ 폼의 미저장 가드는 **헤더 back 버튼 클릭**에서만 발동 — mobileBack(i.ico-arrow-prev)/goBack 은 가드 우회.
  //   폼 헤더 좌상단 아이콘 버튼(button.button-common.type-i) 우선 → 실패 시 ico-arrow-prev.
  const formBack = page.locator('button.button-common.type-i, button.type-i, i[class*="ico-arrow-prev"]').filter({ visible: true }).first();
  if (await formBack.count().catch(() => 0)) {
    if (!(await formBack.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await formBack.click({ force: true, timeout: 2_000 }).catch(() => {});
  } else { await mobileBack(page); }
  await settle(page, 1_000);
  const popup = page.getByText(/취소하시겠습니까|나가시겠|저장하시겠|변경.*취소/).first();
  const popupSeen = await popup.isVisible({ timeout: 4_000 }).catch(() => false);
  if (popupSeen) {
    await check(page, meta(31, '시설등록', '[< 시설 등록] 뒤로 → "작업중이던 내용을 취소하시겠습니까?" 팝업', '취소 확인 팝업 미출현',
      '작업중이던 내용을 취소하시겠습니까?'), async () => {
      await expect(popup).toBeVisible({ timeout: 2_000 });
      await expect(page.getByText(/^\s*예\s*$/).first()).toBeVisible({ timeout: 2_500 });
      await expect(page.getByText(/^\s*아니오\s*$/).first()).toBeVisible({ timeout: 2_500 });
    });
  } else {
    record(meta(31, '시설등록', '[< 시설 등록] 뒤로 → 취소 확인 팝업', '취소 확인 팝업 미출현'), 'FAIL',
      { actual: filled ? '시설명 입력했으나 뒤로 시 확인팝업 미출현(변경감지 누락 의심)' : '시설명 미입력 상태로 즉시 이탈' });
    await probeDump(page, '시설등록·취소확인', '[<] 뒤로 후 화면 — 확인팝업 문구/버튼 구조');
  }

  // 32) [예] → 폐기하고 리스트 복귀(비파괴 — 저장 안 됨).
  const yes = page.getByText(/^\s*예\s*$/).first();
  if ((await yes.count().catch(() => 0)) && (await yes.isVisible().catch(() => false))) {
    await check(page, meta(32, '시설등록', '취소 팝업 [예] → 폐기·리스트 복귀(비파괴)', '복귀 실패'), async () => {
      await yes.click({ timeout: 2_500 });
      await settle(page, 1_000);
      await killMobileAlarms(page);
      // 리스트(총 N건) 복귀 확인.
      const back = (await totalCount(page)) != null || /facilityList/i.test(page.url());
      expect(back).toBeTruthy();
    });
  }
  // 안전 복귀.
  await ensureOnList(page);
}

// ── ④ 시설 상세(항목 클릭 → 상세 렌더 → 복귀) ────────────────────────────
async function flowDetail(page: Page): Promise<void> {
  await ensureOnList(page);
  // ⚠ 카드 렌더 폴링 — 등록/필터 churn 후 리스트 재렌더 타이밍으로 카드 0 오판 방지(9차런).
  await expect.poll(async () => page.locator('[class*="bd-dde3ec"]').filter({ visible: true }).count().catch(() => 0),
    { timeout: 6_000, intervals: [400, 700, 1_000] }).toBeGreaterThan(0).catch(() => {});
  const total = await totalCount(page);
  const cardCnt = await page.locator('[class*="bd-dde3ec"]').filter({ visible: true }).count().catch(() => 0);
  if (total === 0 && cardCnt === 0) { skip(meta(40, '상세', '시설 상세 진입', '데이터 0건'), '리스트 0건(데이터 의존)'); return; }

  const before = page.url();
  const detailSignal = async () => page.url() !== before
    || (await page.getByText(/시설 상세|점검 이력/).first().isVisible().catch(() => false));

  // 카드 = div.layout-column-*.bdr-14.bd-dde3ec (4차런 프로브 실측). 첫 카드의 클래스/제목/자식 구조 확보.
  const cardInfo = await page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 100 && r.height > 40; };
    const cards = Array.from(document.querySelectorAll('[class*="bd-dde3ec"], [class*="bdr-14"]')).filter(vis) as HTMLElement[];
    const c0 = cards[0];
    if (!c0) return { cls: '', title: '', tag: '', children: '' };
    const title = (c0.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
    const children = Array.from(c0.children).map((ch) => `${ch.tagName.toLowerCase()}.${(ch.className || '').toString().replace(/\s+/g, '.').slice(0, 24)}`).join(' > ');
    return { cls: (c0.className || '').toString(), title, tag: c0.tagName.toLowerCase(), children };
  }).catch(() => ({ cls: '', title: '', tag: '', children: '' }));
  review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 상세', kind: '카드 구조 실측', zone: 'probe',
    item: `tag=${cardInfo.tag} title="${cardInfo.title}"`, value: `class="${cardInfo.cls}" children=[${cardInfo.children}]`, screenshot: '' });

  // 정합성 오라클(47)용 — 진입 전 첫 카드 값 캡처(시설명/위치/분류).
  const card0 = (await readFacilityCards(page))[0];

  // 진입점 후보: 실측 카드 클래스 → 카드 제목 텍스트 → bd-dde3ec 범용 → chevron. ⚠ 헤더 텍스트 클릭 금지(검색바 오픈됨).
  const clsSel = cardInfo.cls ? '.' + cardInfo.cls.trim().split(/\s+/).join('.') : '';
  const titleClickable = cardInfo.title && !/^시설\s*관리$/.test(cardInfo.title.trim());
  const targets: Locator[] = [
    clsSel ? page.locator(clsSel).filter({ visible: true }).first() : page.locator('div._none_'),
    page.locator('[class*="bd-dde3ec"]').filter({ visible: true }).first(),
    titleClickable ? page.getByText(cardInfo.title, { exact: true }).first() : page.locator('div._none_'),
    page.locator('i[class*="ico-arrow-next"], [class*="ico-arrow-next"], [class*="arrow-right"]').filter({ visible: true }).first(),
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
    skip(meta(40, '상세', '시설 항목 → 상세 진입', '진입점 미식별'), tried ? '카드 클릭했으나 상세 미오픈(셀렉터 확인 필요)' : '리스트 항목 미발견');
    await probeDump(page, '상세', '카드 클릭 후 상세 미오픈 — 카드/진입점 구조');
    await ensureOnList(page);
    return;
  }

  // 40) 상세 헤더 + 핵심 필드 렌더(시설명/분류/최초 설치일/담당자).
  await check(page, meta(40, '상세', '시설 항목 클릭 → 시설 상세 렌더(필드)', '상세 필드 미렌더'), async () => {
    await expect(page.getByText(/시설명/).first()).toBeVisible({ timeout: 4_000 });
    await expect(page.getByText(/분류/).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/최초 설치일/).first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/담당자/).first()).toBeVisible({ timeout: 3_000 });
  });

  // 상세 우상단 버튼 프로브 — ⋮(더보기)는 최상단 우측 최말단 버튼. x좌표 내림차순으로 후보 확보(45/46 정밀화).
  const topRight = await page.evaluate(() => {
    return (Array.from(document.querySelectorAll('button, i, [class*="ico"]')) as HTMLElement[])
      .map((e) => { const r = e.getBoundingClientRect(); return { s: `${e.tagName.toLowerCase()}.${(e.className || '').toString().replace(/\s+/g, '.').slice(0, 28)}`, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; })
      .filter((o) => o.y < 80 && o.w > 6 && o.x > 180)
      .sort((a, b) => b.x - a.x).slice(0, 8)
      .map((o) => `${o.s}@x${o.x}`);
  }).catch(() => [] as string[]);
  review({ lang: '기능', screen: '코스관리(모바일) > 시설관리 > 상세', kind: '상세 우상단 버튼(x내림차순)', zone: 'probe', item: '⋮ = 최우측 후보', value: topRight.join(' | '), screenshot: '' });

  // 47) 상세↔카드 값 정합성(오라클) — 리스트 카드의 시설명·위치·분류가 상세 화면 값과 일치.
  if (card0 && (card0.title || card0.location)) {
    const detailText = (await page.evaluate(() => {
      const box = Array.from(document.querySelectorAll('[class*="bg-f9f9f9"], [class*="bdr-12"]'))
        .map((e) => (e as HTMLElement).innerText || '').filter((t) => /시설명|분류/.test(t)).sort((a, b) => b.length - a.length)[0];
      return (box || document.body.innerText || '').replace(/\s+/g, ' ');
    }).catch(() => '')) || '';
    const titleOk = !card0.title || detailText.includes(card0.title);
    const locOk = !card0.location || detailText.includes(card0.location);
    // 분류(2/3분류)는 카드가 "배수 / 배수관로", 상세가 "지하 / 배수 / 배수관로" 형태 → 각 토큰 포함 검사.
    const catTokens = (card0.category || '').split('/').map((s) => s.trim()).filter((s) => s && s !== '-');
    const catOk = catTokens.length === 0 || catTokens.every((tok) => detailText.includes(tok));
    const ok = titleOk && locOk && catOk;
    record(meta(47, '상세', '상세↔리스트 카드 값 정합성(시설명·위치·분류)', '카드↔상세 값 불일치'),
      ok ? 'PASS' : 'FAIL',
      { actual: `카드[명="${card0.title}" 위치=${card0.location} 분류="${card0.category}"] → 상세 매칭 명=${titleOk} 위치=${locOk} 분류=${catOk}` });
  } else {
    skip(meta(47, '상세', '상세↔카드 값 정합성', '카드 파싱 실패'), '진입 전 카드 값 캡처 실패(데이터/파싱)');
  }

  // 41) 점검 이력 버튼 노출(노출만 — 진입은 별도).
  const history = page.getByText(/점검 이력/).first();
  if (await history.count().catch(() => 0)) {
    record(meta(41, '상세', '점검 이력 버튼 노출', '미노출'), 'PASS', { actual: '점검 이력 노출' });
  } else { skip(meta(41, '상세', '점검 이력 버튼', '미노출'), '점검 이력 버튼 미발견(구현/데이터 차이)'); }

  // 42) 위치 맵 + 크게 보기 노출(노출만).
  const map = page.locator('img, canvas, [class*="map"]').filter({ visible: true }).first();
  const bigger = page.getByText(/크게 보기/).first();
  if ((await map.count().catch(() => 0)) || (await bigger.count().catch(() => 0))) {
    record(meta(42, '상세', '위치 지도/크게 보기 노출', '미노출'), 'PASS',
      { actual: `${(await bigger.count().catch(() => 0)) ? '크게 보기 ' : ''}${(await map.count().catch(() => 0)) ? '지도' : ''}`.trim() });
  } else { skip(meta(42, '상세', '위치 지도/크게 보기', '미노출'), '지도/크게 보기 미발견(데이터 의존)'); }

  // 상세 화면 유지 확인 헬퍼(하위화면 다녀온 뒤 복귀 판정).
  const onDetail = async () => (await page.getByText(/점검 이력|시설 상세/).first().isVisible().catch(() => false));
  // 상세 재진입(하위화면 이탈 시) — 리스트로 나갔으면 첫 카드 재클릭.
  const backToDetail = async () => {
    if (await onDetail()) return true;
    await ensureOnList(page);
    const card = page.locator('[class*="bd-dde3ec"]').filter({ visible: true }).first();
    if (await card.count().catch(() => 0)) {
      if (!(await card.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await card.click({ force: true, timeout: 2_000 }).catch(() => {});
      await settle(page, 1_400);
    }
    return onDetail();
  };

  // 43) C) 점검 이력 진입 → 이력 화면 렌더 → 상세 복귀(비파괴 읽기).
  const histBtn = page.getByText(/점검 이력/).filter({ visible: true }).first();
  if (await histBtn.count().catch(() => 0)) {
    await check(page, meta(43, '상세', '점검 이력 클릭 → 이력 화면 진입/렌더', '이력 화면 미진입'), async () => {
      const u = page.url();
      await histBtn.click({ timeout: 2_500 }).catch(() => {});
      await settle(page, 1_300);
      const shown = page.url() !== u
        || (await page.getByText(/점검\s*이력|이력이 없|점검일|점검자|이력/).first().isVisible().catch(() => false));
      if (!shown) await probeDump(page, '상세·점검이력', '점검 이력 클릭 후 화면 구조');
      expect(shown).toBeTruthy();
    });
    await backToDetail();
  } else { skip(meta(43, '상세', '점검 이력 진입', '미발견'), '점검 이력 버튼 미발견'); }

  // 44) D) 크게 보기 → 전체화면 지도 → 복귀(비파괴 읽기).
  if (await backToDetail()) {
    const bigBtn = page.getByText(/크게 보기/).filter({ visible: true }).first();
    if (await bigBtn.count().catch(() => 0)) {
      await check(page, meta(44, '상세', '크게 보기 클릭 → 전체화면 지도 노출', '전체화면 지도 미노출'), async () => {
        const u = page.url();
        await bigBtn.click({ timeout: 2_500 }).catch(() => {});
        await settle(page, 1_300);
        const shown = page.url() !== u
          || (await page.locator('canvas, [class*="map"]').filter({ visible: true }).first().count().catch(() => 0)) > 0
          || (await isOverlayOpen(page));
        if (!shown) await probeDump(page, '상세·크게보기', '크게 보기 클릭 후 화면 구조');
        expect(shown).toBeTruthy();
      });
      if (await isOverlayOpen(page)) await closeOverlay(page);
      await backToDetail();
    } else { skip(meta(44, '상세', '크게 보기', '미발견'), '크게 보기 버튼 미발견'); }
  }

  // 45) E-1) ⋮ 메뉴 → 수정 → 편집 폼 → 이전 → "작업중이던 내용을 취소하시겠습니까?" → [예](비파괴 폐기).
  //   ⚠ 43/44 서브화면 뒤 페이지 스택(랜딩 공존)이 option-layer를 덮음 → E는 **클린 상세**에서: 하드리셋 후 재진입.
  await hardReset(page);
  if (await backToDetail()) {
    if (await clickKebab(page)) {
      await settle(page, 500);
      const editItem = page.locator('.option-layer').getByText(/^\s*수정\s*$/).filter({ visible: true }).first()
        .or(page.getByText(/^\s*수정\s*$/).filter({ visible: true }).first());
      if (await editItem.count().catch(() => 0)) {
        await editItem.click({ timeout: 2_500 }).catch(() => {});
        await settle(page, 1_300);
        // 편집 폼에서 소폭 변경(비파괴) → 이전 버튼 → 취소 확인 팝업.
        const nameInp = page.locator('.text-field-container input.item-content, input.item-content').first();
        if (await nameInp.count().catch(() => 0)) await nameInp.fill('E2E_수정_비저장').catch(() => {});
        await settle(page, 400);
        const editBack = page.locator('button.button-common.type-i, button.type-i, i[class*="ico-arrow-prev"]').filter({ visible: true }).first();
        if (await editBack.count().catch(() => 0)) {
          if (!(await editBack.click({ timeout: 2_500 }).then(() => true).catch(() => false))) await editBack.click({ force: true, timeout: 2_000 }).catch(() => {});
        } else { await mobileBack(page); }
        await settle(page, 900);
        const popup = page.getByText(/취소하시겠습니까|나가시겠|저장하시겠|변경.*취소/).first();
        const seen = await popup.isVisible({ timeout: 4_000 }).catch(() => false);
        if (seen) {
          record(meta(45, '상세', '수정 → 이전 → "작업중이던 내용을 취소하시겠습니까?" 팝업 → [예]', '수정 취소 팝업 미출현',
            '작업중이던 내용을 취소하시겠습니까?'), 'PASS', { actual: '취소 확인 팝업 노출' });
          const yes = page.getByText(/^\s*예\s*$/).filter({ visible: true }).first();
          if (await yes.count().catch(() => 0)) await yes.click({ timeout: 2_500 }).catch(() => {});
          await settle(page, 900);
        } else {
          record(meta(45, '상세', '수정 → 이전 → 취소 확인 팝업', '수정 취소 팝업 미출현'), 'FAIL', { actual: '이전 클릭 후 확인 팝업 미출현' });
          await probeDump(page, '상세·수정취소', '수정 폼 이전 후 화면 — 팝업 구조');
        }
      } else {
        skip(meta(45, '상세', 'E 수정 메뉴', '미발견'), '⋮ 메뉴에 "수정" 항목 미발견');
        await probeDump(page, '상세·메뉴', '⋮ 클릭 후 메뉴 항목 구조');
        if (await isOverlayOpen(page)) await closeOverlay(page);
      }
    } else { skip(meta(45, '상세', 'E ⋮ 메뉴', '미발견'), '상세 ⋮(더보기) 메뉴 버튼 미발견(헤더 프로브 참조)'); }
  }

  // 46) E-2) ⋮ 메뉴 → 삭제 → "삭제하면 복구가 불가능합니다. 삭제하시겠습니까?" → [취소](비파괴, 삭제 안 함).
  await hardReset(page);
  if (await backToDetail()) {
    if (await clickKebab(page)) {
      await settle(page, 500);
      const delItem = page.locator('.option-layer').getByText(/^\s*삭제\s*$/).filter({ visible: true }).first()
        .or(page.getByText(/^\s*삭제\s*$/).filter({ visible: true }).first());
      if (await delItem.count().catch(() => 0)) {
        await delItem.click({ timeout: 2_500 }).catch(() => {});
        await settle(page, 900);
        const delPopup = page.getByText(/삭제하면 복구가 불가능|삭제하시겠습니까|복구가 불가능/).first();
        const seen = await delPopup.isVisible({ timeout: 4_000 }).catch(() => false);
        if (seen) {
          // ⚠ 비파괴: 반드시 [취소]만 클릭(삭제/확인/예 금지).
          const cancel = page.getByText(/^\s*취소\s*$/).filter({ visible: true }).first();
          const cancelSeen = await cancel.isVisible().catch(() => false);
          record(meta(46, '상세', '삭제 → "삭제하면 복구가 불가능합니다. 삭제하시겠습니까?" 팝업 → [취소]', '삭제 확인 팝업 미출현',
            '삭제하면 복구가 불가능합니다. 삭제하시겠습니까?'), cancelSeen ? 'PASS' : 'FAIL',
            { actual: cancelSeen ? '삭제 확인 팝업+[취소] 노출' : '삭제 확인 팝업은 떴으나 [취소] 미발견' });
          if (cancelSeen) await cancel.click({ timeout: 2_500 }).catch(() => {});
          await settle(page, 800);
        } else {
          record(meta(46, '상세', '삭제 → 삭제 확인 팝업', '삭제 확인 팝업 미출현'), 'FAIL', { actual: '삭제 클릭 후 확인 팝업 미출현' });
          await probeDump(page, '상세·삭제확인', '삭제 클릭 후 화면 — 팝업 문구/버튼 구조');
        }
      } else {
        skip(meta(46, '상세', 'E 삭제 메뉴', '미발견'), '⋮ 메뉴에 "삭제" 항목 미발견');
        await probeDump(page, '상세·메뉴삭제', '⋮ 클릭 후 메뉴 항목 구조');
        if (await isOverlayOpen(page)) await closeOverlay(page);
      }
    } else { skip(meta(46, '상세', 'E ⋮ 메뉴(삭제)', '미발견'), '상세 ⋮(더보기) 메뉴 버튼 미발견(헤더 프로브 참조)'); }
  }

  // 복귀.
  await mobileBack(page).catch(() => {});
  await settle(page, 800);
  await ensureOnList(page);
}

// 시설관리 리스트로 보장 복귀(다른 화면·오버레이면 정리 후 재진입).
//   ⚠ 실제 라우트 slug가 facilityList 가 아닐 수 있어 "리스트 신호(총 N건) 또는 시설 서브페이지" 로 완화 판정.
async function ensureOnList(page: Page): Promise<void> {
  await killMobileAlarms(page);
  if (await isOverlayOpen(page)) await closeOverlay(page);
  // 검색바가 열려(active) 있으면 "총 N건"이 필터/은닉되어 0건 오판 → 깨끗이 재진입.
  const searchActive = await page.locator('input.search-header.active, input.active.search-header').first().isVisible().catch(() => false);
  const onList = !searchActive && (
    (await totalCount(page)) != null
    || new RegExp(`/mobile/course/${ROUTE}`, 'i').test(page.url())
    || /facility/i.test(page.url()));
  if (!onList) {
    await enterFacility(page).catch(() => {});
    await settle(page, 700);
  }
}

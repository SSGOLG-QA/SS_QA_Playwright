import { Page, expect } from '@playwright/test';
import { settle, navigateMenu } from './adminHelpers';
import { check, skip, diff, record, review, capture, CheckMeta } from './reporter';

// ──────────────────────────────────────────────────────────────
//  언어 검증 (번역 결함 검출) — 일본어/인도네시아어 등 비한국어 모드에서
//  '정적 UI'의 번역 결함을 검출. 올바른 번역 여부(정확성)는 검증하지 않음.
//   검증 방식: 한국어 baseline 캡처 → 언어 전환 → 동일 요소 대조하여 분류(모두 FAIL):
//     ① 한글 노출    — 전환 후에도 한글이 그대로 노출(미번역)
//     ② 미노출(미번역) — 전환 후 해당 요소가 빈값/공란(번역 누락으로 텍스트 사라짐)
//   ⚠ 실데이터(공지 내용·이름·후기 등 한국어 입력값)는 비한국어 모드여도 한글이 정상 →
//      false positive 방지: '정적 UI' 셀렉터만 대상 + 데이터 영역 배제 + 한국어 baseline에 한글이 있는 요소만 대상.
//   ⚠ 비파괴: 언어 전환만 수행(데이터 변경 없음), 종료 전 한국어로 원복.
// ──────────────────────────────────────────────────────────────

// 언어 드롭다운에 노출되는 8개 언어 라벨(자체 스크립트 표기 — 모드와 무관하게 고정)
const LANG_LABELS = ['한국어', 'English', 'Tiếng Việt', 'ภาษาไทย', '繁體中文', '简体中文', '日本語', 'Bahasa Indonesia'];
export const KOREAN = '한국어';
export type Lang = { label: string; ko: string };
// 시스템 공식 지원 언어 전체(한국어=baseline 제외) = 타깃 7개
export const TARGET_LANGS: Lang[] = [
  { label: 'English', ko: '영어' },
  { label: 'Tiếng Việt', ko: '베트남어' },
  { label: 'ภาษาไทย', ko: '태국어' },
  { label: '繁體中文', ko: '번체중문' },
  { label: '简体中文', ko: '간체중문' },
  { label: '日本語', ko: '일본어' },
  { label: 'Bahasa Indonesia', ko: '인도네시아어' },
];

const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

// 언어 드롭다운 트리거(.title) — 현재 어떤 언어든 라벨로 식별
function langTrigger(admin: Page) {
  const re = new RegExp(LANG_LABELS.join('|'));
  return admin.locator('.title', { hasText: re }).first();
}

// 현재 노출 언어 라벨 읽기
async function currentLang(admin: Page): Promise<string> {
  const t = norm(await langTrigger(admin).innerText().catch(() => ''));
  return LANG_LABELS.find(l => t.includes(l)) || t;
}

// 언어 전환: 드롭다운 열기 → 대상 .slot-item 클릭 → 안정화. 성공 시 true.
export async function switchLanguage(admin: Page, toLabel: string): Promise<boolean> {
  const cur = await currentLang(admin);
  if (cur === toLabel) return true;
  await langTrigger(admin).click({ force: true }).catch(() => {});
  const item = admin.locator('.slot-item', { hasText: toLabel }).first();
  await item.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  await item.click({ force: true }).catch(() => {});
  await settle(admin, 1200);
  await admin.keyboard.press('Escape').catch(() => {}); // 드롭다운 오버레이 닫기(스캔/스크린샷 정합)
  await admin.waitForTimeout(300);
  const now = await currentLang(admin);
  return now === toLabel;
}

// ── 진입 안정화 헬퍼 (cascade 차단 + 미구현/진입실패/렌더 구분) ──────────────
//  근본 원인(2026-06-19 분석): 언어 원복(switchLanguage(KOREAN)) 실패 시 SNB가 외국어로 잔존 →
//  다음 메뉴 navigateMenu(한국어명) 매칭 실패 → 구현된 메뉴가 'SKIP 미구현/범위제외'로 오분류(연쇄).
//  + 빈 화면/진입실패가 모두 SKIP로 뭉뚱그려져 FAIL에서 누락. 아래 헬퍼로 자가치유·구분.

// 비파괴 오버레이 닫기 — 헤더 언어 트리거를 가리는 모달/드롭다운/달력 제거(언어 무관·클래스 기반).
//  Escape 우선(대부분 닫힘) → 잔존 모달은 클래스 close 버튼(modal 스코프, 파괴 confirm 회피).
async function closeOverlays(admin: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const open = await admin.locator('.modal-group, .modal-box, .vs__dropdown-menu, .datepicker-layer, .slot-list')
      .filter({ visible: true }).count().catch(() => 0);
    if (!open) return;
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(250);
    if (await admin.locator('.modal-group, .modal-box').filter({ visible: true }).count().catch(() => 0)) {
      const x = admin.locator('.modal-group [class*="close"], .modal-box [class*="close"]').filter({ visible: true }).first();
      if (await x.isVisible().catch(() => false)) await x.click({ force: true }).catch(() => {});
      await admin.waitForTimeout(250);
    }
  }
}

// 오버레이 z-index 우회 DOM 클릭 전환(force click이 오버레이에 가로채일 때 폴백). 성공 시 true.
async function domSwitchLang(admin: Page, toLabel: string): Promise<boolean> {
  await langTrigger(admin).evaluate((el: HTMLElement) => el.click()).catch(() => {});
  await admin.waitForTimeout(400);
  await admin.locator('.slot-item', { hasText: toLabel }).first().evaluate((el: HTMLElement) => el.click()).catch(() => {});
  await settle(admin, 800);
  await admin.keyboard.press('Escape').catch(() => {});
  await admin.waitForTimeout(200);
  return (await currentLang(admin)) === toLabel;
}

// #1·#2: 외국어 잔존 시 한국어로 확실히 원복. 3단 복구: ①오버레이 닫고 일반 전환 ②DOM클릭(z-index 우회)
//   ③홈 리셋(스턱 팝업/라우트 해제) 후 전환. cascade 차단의 핵심.
async function ensureKorean(admin: Page): Promise<boolean> {
  if ((await currentLang(admin)) === KOREAN) return true;
  for (let attempt = 0; attempt < 3; attempt++) {
    await closeOverlays(admin);
    if (await switchLanguage(admin, KOREAN)) return true;     // ① 일반 전환
    if (await domSwitchLang(admin, KOREAN)) return true;       // ② 오버레이 우회 DOM 클릭
    // ③ 홈으로 리셋 — 닫히지 않는 팝업/맵에디터/스턱 라우트를 SPA 네비로 해제 후 재시도
    await admin.locator('.depth-1-title').first().evaluate((el: HTMLElement) => el.click()).catch(() => {});
    await settle(admin, 800);
    await closeOverlays(admin);
    if (await switchLanguage(admin, KOREAN)) return true;
    await admin.waitForTimeout(400);
  }
  return (await currentLang(admin)) === KOREAN;
}

// #3: 한국어 SNB에 해당 하위 메뉴 링크가 존재하는지(=구현 여부). navigateMenu와 동일 매칭(공백무시 includes).
async function snbLinkExists(admin: Page, sub: string): Promise<boolean> {
  const n = (s: string) => (s || '').replace(/\s+/g, '');
  const texts = await admin.locator('.depth-2 a').allInnerTexts().catch(() => []);
  return texts.some(t => n(t).includes(n(sub)));
}

// #4: 진입했으나 본문이 비었는지(렌더 실패). 시스템 콘텐츠/시각요소가 하나도 안 보이면 blank.
//  시각 도구(canvas/svg/map/preview)는 정상 렌더로 인정. ⚠ 즉시 스냅샷은 순회 중 렌더 지연에 오탐
//  (2026-06-22: 정상 화면 24건 false-blank) → 콘텐츠가 나타날 때까지 폴링(positive-wait).
//  진짜 빈 화면(예: 홀맵 미리보기 외국어)은 timeout까지 안 나타나 blank=true로 정확 검출.
const CONTENT_SELS = '.contents-box, .info-box-text, table, .list-table-group, .summary-card, .card-col, canvas, svg, [class*="map"], [class*="preview"], [class*="chart"], [class*="viewer"]';
async function hasVisibleContent(admin: Page): Promise<boolean> {
  return await admin.evaluate((sel: string) => {
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      return r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    return Array.from(document.querySelectorAll(sel)).some(vis);
  }, CONTENT_SELS);
}
async function isContentBlank(admin: Page, timeout = 6000): Promise<boolean> {
  const present = await expect.poll(() => hasVisibleContent(admin), { timeout, intervals: [200, 400, 800, 1500, 2500] })
    .toBe(true).then(() => true).catch(() => false);
  return !present;
}

// #3·#4·#5: 메뉴 진입을 언어상태 자가치유 + 미구현/진입실패/렌더 구분으로 수행.
//  반환: {ok:true} 진입성공 / {ok:false, reason, defect} (defect=true면 결함으로 FAIL, false면 정당 SKIP)
export type LangEntry = { ok: true } | { ok: false; reason: string; defect: boolean };
async function enterMenuChecked(admin: Page, menu: string, sub: string): Promise<LangEntry> {
  // #1·#2: 진입 전 한국어 보장(연쇄 자가치유). 원복 자체가 실패하면 외국어 잔존 결함으로 surfacing.
  if (!(await ensureKorean(admin)))
    return { ok: false, reason: '언어 원복 실패 — SNB 외국어 잔존(진입 차단)', defect: true };
  const exists = await snbLinkExists(admin, sub);                 // #3: 구현 여부(한국어 SNB 링크)
  const navOk = exists && await navigateMenu(admin, menu, sub).catch(() => false);
  await settle(admin);
  if (!navOk) {
    if (!exists) return { ok: false, reason: '미구현(SNB 링크 없음)', defect: false };          // 진짜 미구현 → 정당 SKIP
    return { ok: false, reason: '진입 실패(구현된 메뉴인데 네비 실패)', defect: true };           // #3 결함 → FAIL
  }
  // ⚠ 진입(한국어) 시점 blank 검사는 제거(2026-06-22): navigate 직후 최이른 시점이라 데이터 로딩 화면
  //   (캐디 리스트/고객 평가 등)이 폴링으로도 false-blank 오탐. 실제 i18n 렌더 결함은 외국어 전환 후
  //   `failForeignBlank`가 검출(captureSlots·전환 후라 콘텐츠 로드 완료 시점 → 오탐 없음).
  return { ok: true };
}

// #4(외국어 모드): 언어 전환 후 본문이 비었는지 검출. KO는 enterMenuChecked에서 정상 확인됨 →
//  외국어에서만 백지면 i18n 렌더 결함(FAIL). 전환 직후 렌더 지연 대비 1회 재확인. 결함이면 true.
//  ⚠ 사라진 슬롯은 'KO↔FG 미매칭→skip' 규칙에 흡수되어 PASS로 묻히므로, 화면 단위 백지 검사가 별도 필요.
async function failForeignBlank(admin: Page, lang: Lang, screen: string, tcRef: string, tcId: string, desc: string, shot: string): Promise<boolean> {
  if (!(await isContentBlank(admin))) return false;
  await admin.waitForTimeout(1000);
  if (!(await isContentBlank(admin))) return false;
  record({ path: `${screen} > 언어검증`, tcRef, tcId, desc: `${lang.ko} ${desc}`, failMsg: '외국어 모드 화면 미노출' }, 'FAIL',
    { error: '외국어 모드 화면 미노출(렌더 실패)', actual: `${lang.label} 모드 본문 빈 화면(한국어는 정상 렌더)`, detail: '언어 전환 후 콘텐츠 미렌더 — i18n 렌더 결함 의심', screenshot: shot });
  return true;
}

// 진입 실패 결과를 리포트에 기록(#5: 사유별 분리 — 결함은 FAIL, 정당 미구현/범위제외는 SKIP).
function recordEntryFailure(screen: string, menu: string, lang: Lang, descSuffix: string, entry: Extract<LangEntry, { ok: false }>) {
  const meta: CheckMeta = { path: `${screen} > 언어검증`, tcRef: `언어검증_${menu}`, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} ${descSuffix}`, failMsg: entry.reason };
  if (entry.defect) record(meta, 'FAIL', { error: entry.reason, detail: `${lang.ko} 모드 진입 단계 — ${entry.reason}` });
  else skip(meta, entry.reason);
}

// ── '정적 UI' 영역 정의 ────────────────────────────────────────
//  INCLUDE: 메뉴/버튼/탭/테이블헤더/안내문구/섹션제목/폼라벨/placeholder
//  EXCLUDE: 테이블 본문(td)·공지 본문·대화창·입력값 등 사용자 데이터(한국어 입력이 정상)
//  keepInData=true 인 zone은 tbody 등 데이터 영역 안이라도 스캔(시스템 요소: 행 버튼/요약 라벨/드롭다운 값).
//   → 사용자 데이터(이름·내용)는 여전히 배제하되, 표 안의 시스템 버튼·enum·요약 라벨은 검출.
const SCAN_ZONES: { zone: string; sel: string; attr?: string; keepInData?: boolean; optScan?: boolean }[] = [
  { zone: '메뉴(대)', sel: '.depth-1-title' },
  { zone: '메뉴(소)', sel: '.depth-2 a' },
  { zone: '버튼', sel: 'button, a[class*="btn"], [role="button"], .button-common' },
  { zone: '행버튼', sel: 'tbody button, .list-table-group button, .table-overflow-item button', keepInData: true }, // 표 행 액션(삭제/스코어/보내기 등)
  { zone: '탭', sel: '[role="tab"], .tab-item, .tabs li, [class*="tab-"] li' },
  { zone: '테이블헤더', sel: 'thead th' },
  { zone: '안내문구', sel: '.info-box-text, [class*="guide"], [class*="info-text"], [class*="desc"]' },
  // 섹션제목 — h1~h4/.box-title/.section-title 외에 실제로 많이 쓰이는 .sub-title(61건)·.title-20/16·.setting-name 보강(2026-06-10 census)
  { zone: '섹션제목', sel: '.contents-box h1, .contents-box h2, .contents-box h3, .contents-box h4, .box-title, .section-title, .sub-title, .sub-title-box, .title-20, .title-16, .setting-name, .sub-title-text' },
  { zone: '요약카드', sel: '.summary-card__label, .summary-card__days, .summary-card__sub, [class*="summary"] [class*="label"], [class*="stat"] [class*="label"]', keepInData: true }, // 라벨/단위(값=__value 제외)
  // 카드/차트 범례 라벨(시스템) — 값(__value)·데이터는 제외하고 라벨/이름만(2026-06-10 census)
  { zone: '카드/범례', sel: '.card-label, .card-sub, .legend-item, .legend-value, .donut-legend__name, .cbc-label, [class*="legend"] [class*="name"]', keepInData: true },
  // 상태 뱃지(사용중·완료 등 시스템 enum) — .badge-label 등(2026-06-10 census)
  { zone: '뱃지/상태', sel: '.badge-label, [class*="badge"] > span, [class*="status-label"], [class*="state-label"]', keepInData: true },
  // 빈 상태 안내(시스템) — "내역이 없습니다" 등
  { zone: '빈상태', sel: '.no-data, [class*="no-data"], [class*="empty-text"], [class*="no-result"]', keepInData: true },
  { zone: '폼라벨', sel: 'label, .form-label, .input-label, dt' },
  { zone: '드롭다운값', sel: '.vs__selected', keepInData: true },  // vue-select 표시값(시스템 기본값 예: 코스 전체)
  // native <select> 옵션(닫힘 상태로 비가시 → optScan으로 가시성 우회, textContent 읽기)
  { zone: 'select옵션', sel: 'select option', keepInData: true, optScan: true },
  { zone: 'placeholder', sel: 'input[placeholder], textarea[placeholder]', attr: 'placeholder' },
];

// 컨텐츠/데이터 영역(배제) — '시스템 요소만 검증'. 공지·게시판 글 등 컨텐츠의 한글은 결함 아님(PASS 취급).
//  위 셀렉터가 잡더라도 이 조상 안이면 제외.
const EXCLUDE_ANCESTORS = [
  'tbody', '.list-table-group tbody', '[contenteditable]',
  '.notice-content', '.notice-detail', '.notice-view', '.message-box',  // 공지/대화 컨텐츠
  '.snb-toggle', '.depth-2-toggle',  // SNB 토글 컴포넌트 내부 접근성 레이블(Snb 스위치 등) 오탐 방지
  '.msg-message-left', '.msg-message-right', '.msg-message-top', '[class*="msg-message"]', // 메시지 기록 대화 버블(사용자 채팅 — 한글 정상, 2026-06-10)
  '.board', '.board-view', '.post-view', '.content-view', '.viewer', '.editor', '.ck-content', '.fr-view', // 게시판/리치텍스트 컨텐츠
];

export type Hit = { zone: string; text: string };

// 현재 화면의 정적 UI에서 한글 노출 항목 수집
export async function scanHangul(admin: Page): Promise<Hit[]> {
  return await admin.evaluate(({ zones, excl, hangulSrc }) => {
    const HANGUL = new RegExp(hangulSrc);
    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      if (r.width <= 1 && r.height <= 1) return false; // sr-only 제외
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const inExcluded = (el: Element) => excl.some(sel => el.closest(sel));
    const seen = new Set<string>();
    const hits: { zone: string; text: string }[] = [];
    for (const z of zones) {
      const nodes = Array.from(document.querySelectorAll(z.sel));
      for (const el of nodes) {
        if (inExcluded(el)) continue;
        if (!(z as any).optScan && !isVisible(el)) continue;   // select 옵션은 닫힘 상태로 비가시 → 가시성 우회
        let text = '';
        if (z.attr) text = (el.getAttribute(z.attr) || '').trim();
        else if ((z as any).optScan) text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        else text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
        text = text.slice(0, 80);
        if (!text || !HANGUL.test(text)) continue;
        const key = z.zone + '|' + text;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ zone: z.zone, text });
      }
    }
    return hits;
  }, { zones: SCAN_ZONES, excl: EXCLUDE_ANCESTORS, hangulSrc: HANGUL.source });
}

// 정적 UI 슬롯 전체 캡처(한글 필터 없음) — '영역|DOM경로' 키로 KO↔외국어 대조용.
//  키를 구조적 DOM 경로(tag + nth-of-type 체인)로 잡아 순번 밀림(reflow)에 견고.
//   - nth-of-type은 숨김 형제 포함 전체 DOM 위치로 계산 → 가시성 변동에 불변.
//   - i18n은 보통 텍스트만 교체하므로 동일 요소의 경로는 전환 후에도 동일 → 1:1 정확 매칭.
//  attr 슬롯(placeholder 등)은 경로 뒤에 @attr 표기로 구분(동일 요소 다중 슬롯 충돌 방지).
//  추가 메트릭: clip(글자 잘림: leaf 텍스트가 박스 넘쳐 overflow 클리핑), ell(말줄임 ellipsis 적용+잘림).
export type Slot = { key: string; zone: string; text: string; clip: boolean; ell: boolean };
export async function captureSlots(admin: Page): Promise<Slot[]> {
  return await admin.evaluate(({ zones, excl }) => {
    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      // sr-only 패턴(1×1px, clip, 음수 margin 등) 제외 — 접근성 전용 숨김 레이블이 오탐되지 않도록
      if (r.width <= 1 && r.height <= 1) return false;
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const inExcluded = (el: Element) => excl.some(sel => el.closest(sel));
    // 안정 식별자: 루트(body)까지 tag[:nth-of-type] 체인 (최대 14단계)
    const domPath = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      let depth = 0;
      while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML' && depth < 14) {
        let seg = node.tagName.toLowerCase();
        const parent: Element | null = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(c => c.tagName === node!.tagName);
          if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
        parts.unshift(seg);
        node = node.parentElement;
        depth++;
      }
      return parts.join('>');
    };
    const slots: { key: string; zone: string; text: string }[] = [];
    const seenKey = new Set<string>();
    for (const z of zones) {
      const nodes = Array.from(document.querySelectorAll(z.sel));
      for (const el of nodes) {
        if (!z.keepInData && inExcluded(el)) continue;   // 시스템 zone(keepInData)은 데이터 영역도 스캔
        if (!(z as any).optScan && !isVisible(el)) continue;   // select 옵션은 닫힘 상태로 비가시 → 가시성 우회
        const text = (z.attr ? (el.getAttribute(z.attr) || '') : ((z as any).optScan ? (el.textContent || '') : ((el as HTMLElement).innerText || ''))).replace(/\s+/g, ' ').trim();
        const key = z.zone + '|' + domPath(el) + (z.attr ? '@' + z.attr : '');
        if (seenKey.has(key)) continue;   // 동일 경로 중복(같은 셀렉터 다중 매칭) 방지
        seenKey.add(key);
        // 글자 잘림/말줄임: leaf 텍스트 요소만(자식 요소 레이아웃 오탐 방지)
        let clip = false, ell = false;
        if (!z.attr && text) {
          const he = el as HTMLElement;
          const st = getComputedStyle(he);
          const leaf = he.children.length === 0;
          const overW = he.scrollWidth > he.clientWidth + 2;
          const ovHidden = /hidden|clip/.test(st.overflowX) || /hidden|clip/.test(st.overflow);
          ell = leaf && overW && st.textOverflow === 'ellipsis';
          clip = leaf && overW && ovHidden && st.textOverflow !== 'ellipsis';
        }
        slots.push({ key, zone: z.zone, text: text.slice(0, 120), clip, ell });
      }
    }
    return slots;
  }, { zones: SCAN_ZONES, excl: EXCLUDE_ANCESTORS });
}

// 한 화면을 대상 언어 전부로 스캔 → 결과 기록 → 한국어 원복
//  screen: 화면 경로(리포트 path 접두), metaBase: tcRef 등
export async function scanScreenAllLangs(admin: Page, screen: string, tcRef: string) {
  for (const lang of TARGET_LANGS) {
    const ok = await switchLanguage(admin, lang.label);
    const meta: CheckMeta = {
      path: `${screen} > 언어검증`,
      tcRef,
      tcId: `LANG-${lang.ko}`,
      desc: `${lang.ko}(${lang.label}) 모드 — 정적 UI 한글 미노출`,
      expected: '한글 노출 0건',
      failMsg: '한글 노출(미번역 의심)',
    };
    if (!ok) { skip(meta, `${lang.label} 전환 실패(드롭다운/항목 미발견)`); continue; }

    const hits = await scanHangul(admin);
    await check(admin, meta, async () => {
      const list = hits.map(h => `[${h.zone}] ${h.text}`);
      expect(hits.length, list.join('  |  ').slice(0, 290) || '없음').toBe(0);
    });
    // 검출 항목을 기획-구현 차이(추적축)에도 풀어서 남김(검출 목록 가독)
    for (const h of hits.slice(0, 40))
      diff(`${screen}`, `${lang.ko} 번역`, `[${h.zone}] "${h.text}" (한글 노출)`, tcRef, `${lang.label} 모드 미번역 의심`);
  }
  await ensureKorean(admin); // 비파괴 원복(#2: 검증·재시도)
}

// ── 전체 메뉴 순회(단일 언어) ──────────────────────────────────
//  전략: 한국어로 진입 → 화면에서 언어 전환 → 스캔 → 한국어 원복(다음 메뉴 한글 네비 가능).
//  전역요소 중복 제거: seen 집합으로 화면별 '신규' 한글만 검출(전역 SNB/레이아웃은 홈에서 1회 귀속).
//  언어별 파일 분리: 각 언어 1회씩 별도 test에서 runLangCheckAll → writeReport(언어명).
export const MENU_LIST: { menu: string; subs: string[] }[] = [
  { menu: '라운드관리', subs: ['내장 현황', '내장 통계', '전체 라운드', '라운드 설정', '카트 관리', '홀별 정산 관리'] },
  { menu: '관제관리', subs: ['메시지 기록 조회', '라이브채팅 공지 조회', '아이콘 관리', '카트 이동경로 확인'] },
  { menu: '태블릿 운영 관리', subs: ['태블릿 기능 설정', '메시지 관리', '홀 이벤트 관리'] },
  { menu: '홀맵 관리', subs: ['홀맵 구역 설정', '카트패스 진입여부 설정', '티샷 유의 거리 설정', '홀맵 미리보기'] },
  { menu: '코스 운영 관리', subs: ['핀 포지션 관리', '핀 포지션 변경이력', '핀 포지션 분석', '코스 분석', '그린 스피드', '골프장 소식'] },
  { menu: '경기 진행 관리', subs: ['진행시간 표준 설정', '진행시간 실시간', '진행시간 조회', '진행시간 통계'] },
  { menu: '캐디 관리', subs: ['캐디 리스트', '캐디 등록 관리', '캐디 실적'] },
  { menu: '캐디피 관리', subs: ['캐디피 설정', '캐디피 통계', '캐디피 결제 내역', '캐디 자료/신고서'] },
  { menu: '배토 관리', subs: ['배토 기록 조회', '배토 통계'] },
  { menu: '식음 관리', subs: ['버전 및 설정', '그늘집 및 TOS관리', '식당 관리', '상품 등록 관리', '식당·품목 매핑', '주문 내역 관리'] },   // ✎ '버전 업데이트'→'버전 및 설정'(실 SNB, 2026-06-09 정정)
  { menu: '고객 평가 관리', subs: ['캐디 평가', '고객 평가', '식음료 평가', '후기 리스트', '후기 통계'] },
  { menu: '대회', subs: ['대회관리'] },
  { menu: '계정 관리', subs: ['계정 리스트', '계정 권한 관리'] },
];

// 다른 스크립트(라틴/태국/CJK/가나) 문자 포함 여부 — 한글 제거 후 잔여 글자 검사(언어 혼재 판정)
function hasOtherScript(s: string): boolean {
  const stripped = s.replace(/[가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
  return /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ฀-๿぀-ヿ㄰-㆏㐀-䶿一-鿿]/.test(stripped);
}
// 인코딩 깨짐(리터럴): �(U+FFFD)·□(U+25A1)·연속 ? . (폰트 글리프 누락 tofu는 DOM 불가 → 시각 확인필요)
const ENCODING_BROKEN = /[�□]|\?{2,}/;

// 타 언어 노출 감지 — 대상 언어 스크립트와 맞지 않는 외국 스크립트가 주를 이룰 때.
//  보수적 감지(false positive 방지): 스크립트가 명확히 불일치하는 케이스만 FAIL.
//  - 태국어 모드에서 일본어/중국어/영어 노출, 일본어 모드에서 태국어 노출,
//    중국어 모드에서 태국어·순수가나 노출, 라틴계 모드에서 태국어·비라틴 스크립트 노출.
//  반환: 감지된 타 언어 설명(예: '태국어'), null=해당 없음/감지 불가
function detectWrongLanguage(text: string, targetLabel: string): string | null {
  if (!text || HANGUL.test(text)) return null; // 한글은 별도('한글 노출'/'언어 혼재')
  // 날짜/시간 포맷 플레이스홀더(YYYY.MM.DD, HH:mm:ss 등) — Y·M·D·H·m·s 포맷 코드는 국제 공통이므로 제외
  if (/^[YMDHhmsAa\d.\-/: ]+$/.test(text.trim())) return null;
  const hasThai  = /[฀-๿]/.test(text);
  const hasKana  = /[぀-ヿ]/.test(text);                  // 히라가나/가타카나
  const hasCJK   = /[一-鿿㐀-䶿]/.test(text);    // 한자(CJK)
  const hasLatin = /[A-Za-z]/.test(text);
  const latinCnt = (text.match(/[A-Za-z]/g) || []).length;        // 라틴 글자 총 수
  switch (targetLabel) {
    // 태국어 모드: 태국 문자 없이 다른 스크립트가 주를 이루면 타 언어
    case 'ภาษาไทย':
      if (!hasThai) {
        if (hasKana) return '일본어(가나)';
        if (hasCJK) return '중국어/일본어(한자)';
        if (hasLatin && latinCnt >= 4) {
          // 태국어 UI에서 영어 그대로 쓰는 고정/국제 용어 제외
          //  Home = 홈 네비게이션, IN/OUT/TOTAL = 스코어카드 고정 단어
          if (/^(Home|IN|OUT|TOTAL)$/i.test(text.trim())) return null;
          return '영어/라틴계';  // ≥4: OK·ID·URL 등 국제 약어 오탐 방지
        }
      }
      break;
    // 일본어 모드: 태국어 문자가 있으면 타 언어 (CJK·Latin은 일본어에서 혼용 허용)
    case '日本語':
      if (hasThai) return '태국어';
      break;
    // 중국어 모드(번체/간체): 태국어 또는 순수 가나(한자 없음)가 있으면 타 언어
    case '繁體中文': case '简体中文':
      if (hasThai) return '태국어';
      if (hasKana && !hasCJK) return '일본어(가나)';
      break;
    // 라틴계 모드(영어/베트남어/인도네시아어): 비라틴 스크립트(태국·가나·한자)가 라틴 없이 있으면 타 언어
    case 'English': case 'Tiếng Việt': case 'Bahasa Indonesia':
      if (hasThai) return '태국어';
      if (hasKana && !hasLatin) return '일본어(가나)';
      if (hasCJK && !hasLatin) return '중국어/일본어(한자)';
      break;
  }
  return null;
}
// 숫자/날짜 패턴(포맷 관찰용)
const DATE_RE = /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}/g;
const NUM_RE = /\d{1,3}([.,]\d{3})+(\.\d+)?/g;
const fmtShape = (s: string) => s.replace(/\d/g, '0'); // 2026.03.11 → 0000.00.00

// 단일 화면 검증(단일 언어): KO baseline ↔ 외국어 대조 + 외국어 화면 상태 점검.
//  FAIL 분류: 한글 노출 / 언어 혼재 / 미노출(미번역) / 인코딩 깨짐 / 글자 잘림 / 타 언어 노출.
//  확인 필요(판정 제외): 말줄임(…) / 시각 레이어(이미지텍스트·글리프□·레이아웃).  관찰: 날짜·숫자 포맷.
//  종료 시 한국어 원복. seen으로 전역요소(SNB/레이아웃) 중복 제거(홈에서 1회 귀속).
// KO baseline ↔ FG 슬롯 비교 공통 로직. scanScreen 과 runLangCheckUnified 에서 공유.
//  seen 중복 제거: 전역 SNB 등 같은 슬롯이 여러 메뉴에서 반복될 때 1회만 기록.
function applySlotComparison(
  ko: { key: string; text: string; zone: string; clip?: boolean; ell?: boolean }[],
  fg: { key: string; text: string; zone: string; clip?: boolean; ell?: boolean }[],
  lang: Lang, screen: string, tcRef: string, shot: string, seen: Set<string>
) {
  const koMap = new Map(ko.map(s => [s.key, s.text]));
  const fresh = (k: string) => { if (seen.has(k)) return false; seen.add(k); return true; };
  const fail = (zone: string, koText: string, fgText: string, phen: string) => {
    if (!fresh(`${zone}|${phen}|${koText || fgText}`)) return;
    record(
      { path: `${screen} > 언어검증 > ${zone}`, tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} ${phen}: "${(koText || fgText).slice(0, 40)}"`, expected: koText ? `한국어 원문: "${koText}"` : '-' },
      'FAIL',
      { actual: fgText ? `${lang.label}: "${fgText}"` : '(빈값/미노출)', error: phen, detail: `${lang.label} 모드 표시값`, screenshot: shot },
    );
  };
  const pass = (zone: string, koText: string, fgText: string) => {
    if (!fresh(`PASS|${zone}|${koText}`)) return;
    record(
      { path: `${screen} > 언어검증 > ${zone}`, tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} 번역 정상: "${koText.slice(0, 40)}"`, expected: `한국어 원문: "${koText}"` },
      'PASS',
      { actual: `${lang.label}: "${fgText}"`, screenshot: shot },
    );
  };
  // ① 번역 카테고리
  for (const s of ko) {
    if (!HANGUL.test(s.text)) continue;
    // DB-연동 드롭다운 선택값(vs__selected) — 해당 화면은 DB 카테고리명이 그대로 표시됨(번역 불필요)
    if (s.zone === '드롭다운값' && SKIP_VS_SELECTED_SCREENS.some(sc => screen.includes(sc))) continue;
    const f = fg.find(x => x.key === s.key);
    if (!f) continue;
    const ft = f.text;
    if (ft.trim() === '') fail(s.zone, s.text, '', '미노출(미번역)');
    else if (HANGUL.test(ft)) fail(s.zone, s.text, ft, hasOtherScript(ft) ? '언어 혼재' : '한글 노출');
    else { const wl = detectWrongLanguage(ft, lang.label); if (wl) fail(s.zone, s.text, ft, `타 언어 노출(${wl})`); else pass(s.zone, s.text, ft); }
  }
  // ② 외국어 화면 상태 카테고리
  const fmtSeen = new Set<string>();
  for (const f of fg) {
    const ft = f.text;
    if (!ft) continue;
    if (ENCODING_BROKEN.test(ft)) fail(f.zone, koMap.get(f.key) || '', ft, '인코딩 깨짐');
    if (f.clip) fail(f.zone, koMap.get(f.key) || '', ft, '글자 잘림');
    if (f.ell && fresh(`${f.zone}|말줄임|${ft}`))
      review({ lang: lang.ko, screen, kind: '말줄임(…)', zone: f.zone, item: ft.slice(0, 60), value: '말줄임 처리 — 전체 텍스트 노출 확인 필요', screenshot: shot });
    for (const re of [DATE_RE, NUM_RE]) {
      const m = ft.match(re);
      if (m) for (const tok of m) { const shape = fmtShape(tok); const k = `${lang.ko}|fmt|${shape}`; if (!fmtSeen.has(k) && fresh(k)) { fmtSeen.add(k); review({ lang: lang.ko, screen, kind: '포맷 관찰(날짜/숫자)', zone: f.zone, item: shape, value: `예: ${tok}`, screenshot: '' }); } }
    }
  }
}

async function scanScreen(admin: Page, lang: Lang, screen: string, tcRef: string, seen: Set<string>) {
  const base: CheckMeta = { path: `${screen} > 언어검증`, tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko}(${lang.label}) 모드 — UI 표기 검증` };
  const ko = await captureSlots(admin);
  const ok = await switchLanguage(admin, lang.label);
  if (!ok) { skip(base, `${lang.label} 전환 실패`); return; }
  const shot = await capture(admin, { ...base, path: `${screen}_${lang.ko}` });
  if (await failForeignBlank(admin, lang, screen, tcRef, `LANG-${lang.ko}`, '모드 — 화면 미노출 점검', shot)) { await ensureKorean(admin); return; }
  const fg = await captureSlots(admin);
  applySlotComparison(ko, fg, lang, screen, tcRef, shot, seen);
  // (글리프 깨짐 □·이미지 내 텍스트·픽셀 레이아웃은 검증 범위 제외)
  await ensureKorean(admin);   // #2: 원복 검증·재시도(실패 시 다음 메뉴 cascade 방지)
}

// ════════════════ 토스트·에러 메시지 언어 검증 ════════════════
//  토스트(.toast-box, 자동소멸)·에러/알림(.modal-box) 텍스트를 캡처해 언어 카테고리 적용.
//   미노출(공란)은 baseline 불가 → 한글 노출/언어 혼재/인코딩 깨짐 + 정상(실제값)만.
//   ⚠ 비파괴 액션으로는 토스트가 거의 안 뜸(실측) → 성공 토스트는 Tier2(저장, 옵트인)에서.

// 토스트 전용 컨테이너(.toast-box)가 채워질 때까지 대기 후 텍스트 수집. 알림 모달(입력요소 없는 modal)도 포함.
//  ⚠ 폼 모달(textarea/input/vue-select 포함)은 제외 — 입력 폼 텍스트를 토스트로 오인하지 않도록.
export async function captureToast(admin: Page, timeoutMs = 4000): Promise<string[]> {
  await admin.locator('.toast-box').filter({ hasText: /\S/ }).first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {});
  return await admin.evaluate(() => {
    const out: string[] = [];
    for (const e of Array.from(document.querySelectorAll('.toast-box'))) {
      const t = (e as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
      if (t) out.push(t.slice(0, 150));
    }
    for (const e of Array.from(document.querySelectorAll('.modal-box, .modal-content, .modal-body'))) {
      if (e.querySelector('textarea, input:not([type=checkbox]), .vs__dropdown-toggle')) continue; // 폼 모달 제외
      const t = (e as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
      if (t) out.push(t.slice(0, 150));
    }
    return [...new Set(out)];
  });
}

// 찰나에 떴다 사라지는 토스트 포착: 액션 실행 전 MutationObserver 설치 → 추가된 노드 텍스트 수집.
//  폼 입력요소(textarea/input/vue-select) 포함 노드는 제외(폼 모달 오인 방지). 짧은 메시지만(≤120자).
export async function withToastObserver(admin: Page, action: () => Promise<void>): Promise<string[]> {
  await admin.evaluate(() => {
    (window as any).__toasts = [];
    const seen = new Set<string>();
    const obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of Array.from(m.addedNodes)) {
        if (n.nodeType !== 1) continue;
        const el = n as HTMLElement;
        if (el.querySelector && el.querySelector('textarea, input:not([type=checkbox]), .vs__dropdown-toggle')) continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 120 && !seen.has(t)) { seen.add(t); (window as any).__toasts.push(t.slice(0, 150)); }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    (window as any).__toastObs = obs;
  });
  await action();
  await admin.waitForTimeout(1800);
  return await admin.evaluate(() => { const o = (window as any).__toastObs; if (o) o.disconnect(); return ((window as any).__toasts || []) as string[]; });
}

// 캡처된 토스트/에러 텍스트를 언어 카테고리로 분류·기록(중복 제거).
export function classifyToastText(lang: Lang, screen: string, kind: string, texts: string[], shot: string, seen: Set<string>) {
  for (const t of texts) {
    let phen = '';
    if (ENCODING_BROKEN.test(t)) phen = '인코딩 깨짐';
    else if (HANGUL.test(t)) phen = hasOtherScript(t) ? '언어 혼재' : '한글 노출';
    else { const wl = detectWrongLanguage(t, lang.label); if (wl) phen = `타 언어 노출(${wl})`; }
    const key = `토스트|${phen || 'PASS'}|${screen}|${t}`;
    if (seen.has(key)) continue; seen.add(key);
    const meta = { path: `${screen} > 토스트/에러 > ${kind}`, tcRef: `언어검증_토스트`, tcId: `LANGTOAST-${lang.ko}`, desc: `${lang.ko} 토스트/에러 ${phen || '정상'}: "${t.slice(0, 36)}"`, expected: '-' };
    if (phen) record(meta, 'FAIL', { actual: `${lang.label}: "${t}"`, error: phen, detail: `${kind} 메시지`, screenshot: shot });
    else record(meta, 'PASS', { actual: `${lang.label}: "${t}"`, screenshot: shot });
  }
}

// ════════════════ 동적 요소 언어 검증 (드롭다운 옵션 / 클릭 팝업) ════════════════
//  정적 스캔이 놓치는 ① 펼친 드롭다운 옵션목록 ② 행 버튼 클릭 시 뜨는 .modal-group 팝업의
//   문구·버튼명·라벨을 대상 언어 모드에서 캡처 → 언어 카테고리 분류(한글노출/혼재/인코딩/정상).
//   baseline 불필요(classifyToastText 와 동일 전략) — 외국어 모드에 한글 잔존이면 결함.
//  ⚠ 비파괴: 드롭다운은 Escape 로 닫음. 팝업은 '보기'성만 열고 취소/닫기/Escape 로 닫음.
//     삭제 등 파괴적 confirm 은 ALLOW_DESTRUCTIVE 일 때만(스캔 후 반드시 [취소]).

// 동적 스캔(드롭다운/팝업/라디오) 전체 제외 화면 — 사용자 가변 데이터가 대부분이라 false positive 발생.
//  정적 슬롯 비교는 계속 수행. 부분일치(screen.includes) 로 매칭하므로 소메뉴명 일부만 기입 가능.
const DYNAMIC_SKIP_SCREENS: string[] = [
  '캐디 리스트',  // 캐디 이름·ID 등 가변 데이터 위주 — 동적 스캔 false positive
];

// 라디오 상태 내 드롭다운 스캔만 제외 — 해당 라디오 선택 시 나타나는 드롭박스에 가변 데이터 포함.
//  텍스트 스캔(안내문구·라디오 옵션 등)은 정상 수행, 드롭다운 열기·옵션 분류만 건너뜀.
//  형식: [소메뉴명_부분일치, 라디오라벨_부분일치]
const SKIP_RADIO_DROPDOWN_PATTERNS: [string, string][] = [
  ['진행시간 통계', '캐디기준'],  // 캐디기준 선택 시 전체캐디 드롭박스에 캐디 이름(가변) 포함
];

// 드롭박스 스캔을 화면 단위로 전체 제외 — 라벨 수집이 실패하거나 화면의 모든 드롭박스가 가변 데이터.
//  (SKIP_DROPDOWN_CONTENT_PATTERNS 패턴 매칭이 불가능한 경우의 폴백)
//  ⚠ 이 목록은 드롭다운 옵션 목록 스캔만 제외 — 정적 슬롯 비교(captureSlots)는 계속 수행.
const SKIP_DROPDOWN_SCREENS: string[] = [
  '배토 기록 조회',     // contextLabel이 "조회기간"으로 수집 실패 — 유일한 드롭박스가 캐디 이름 목록
  // ── 경기 진행 관리 ────────────────────────────────────────────
  '진행시간 표준 설정', // 코스 선택 드롭박스(코스명 가변 데이터)
  '진행시간 실시간',    // 캐디 필터 드롭박스(가변)
  '진행시간 조회',      // 전체캐디 드롭박스 — contextLabel 매칭 불확실(probe 미실행), 화면단위 폴백
  '진행시간 통계',      // 코스 드롭박스(selected="코스전체", contextLabel="코스기준" → 전체캐디 패턴 비매칭) + 캐디기준 후 드롭박스
  // ── 식음 관리 ─────────────────────────────────────────────────
  '버전 및 설정',       // 코스별 기본 식당 드롭박스 — 패턴 폴백(food 서브메뉴 전용)
  '식당 관리',          // 식당 이름 목록(가변 데이터)
  '상품 등록 관리',     // 카테고리/식당 드롭박스(가변 데이터)
  '주문 내역 관리',     // 식당/캐디 필터 드롭박스(가변 데이터)
  // ── 고객 평가 관리 ────────────────────────────────────────────
  '고객 평가',          // 평가 카테고리(코스/식음/그린/페어웨이/직원/서비스) — DB-linked, 번역 불필요
];

// .vs__selected(드롭다운 선택값) 정적 슬롯 비교 제외 화면 — DB-연동 카테고리/코스명이 선택값으로 표시됨.
//  applySlotComparison 내 '드롭다운값' zone에 적용.
const SKIP_VS_SELECTED_SCREENS: string[] = [
  '고객 평가',  // 평가 카테고리(코스/식음/그린/페어웨이/직원/서비스) — DB 저장값, 번역 불필요
];

// 특정 화면의 특정 드롭박스 옵션 목록 스캔 제외 — 가변 데이터(캐디명/카트번호/식당명/권한그룹 등).
//  드롭박스 라벨 판별 순서: placeholder → 선택값 → 인접 label/title 텍스트 중 하나라도 매칭 시 제외.
//  형식: [소메뉴명_부분일치, 드롭박스라벨_부분일치]
//  ⚠ 인접 라벨이 의도한 필드가 아닌 다른 요소 텍스트로 잡힐 수 있음 — probe(_probe-langgap) 확인 후 패턴 기입.
const SKIP_DROPDOWN_CONTENT_PATTERNS: [string, string][] = [
  ['진행시간 조회', '전체캐디'],     // 캐디 이름 목록
  ['진행시간 통계', '전체캐디'],     // 캐디기준 라디오 후 나타나는 캐디 목록(라디오 패턴으로도 커버)
  ['카트 이동경로', 'Caddie'],       // 캐디 이름 목록(영문 placeholder)
  ['카트 이동경로', '캐디'],         // 캐디 이름 목록(한글 라벨)
  ['캐디 등록 관리', '하우스 캐디'], // 카트번호 드롭박스 — contextLabel이 인접 구분 라벨("하우스 캐디")로 수집됨(probe 확인)
  ['버전 및 설정', '식당'],          // 코스별 기본 식당 설정 드롭박스(contextLabel "코스별 기본 식당 설정" ⊇ "식당")
  ['계정 리스트', '권한 그룹'],      // 권한 그룹 목록(가변)
  ['계정 권한 관리', '권한 그룹'],   // 권한 그룹 목록(가변)
];

// 보기/확인성 팝업을 여는 행 버튼(비파괴). '보내기'(전송)·'Live'(새 탭/추적)는 제외.
const SAFE_POPUP_BTNS = ['스코어', '클럽체크', '보기', '상세', '카트확인서', '캐디수첩', '중대재해 확인서', '추가 확인서'];
const CONFIRM_POPUP_BTNS = ['삭제'];   // 파괴적 confirm — ALLOW_DESTRUCTIVE 시에만, 스캔 후 [취소]
// 페이지 레벨(비행) 팝업 트리거 — 테이블 행 밖의 버튼으로 .modal-group 여는 패턴(비파괴: 열고 캡처 후 닫기)
// '보내기'·'동기화'·'내보내기'·'저장'·'적용' 등 서버액션 버튼은 제외.
const PAGE_POPUP_BTNS = ['등록', '신규 등록', '미리보기', '수정', '추가'];

// 숫자·기호만으로 이루어진 항목 판별: 한글/로마자/기타 스크립트 문자가 전혀 없으면 true.
//  "1", "2025-06", "10:30", "100%" 등 → 번역 대상 없음 → 동적 범위 제외.
const SCRIPT_CHAR = /[가-힣A-Za-zÀ-ɏͰ-ϿЀ-ӿ฀-๿぀-ヿ㄰-㆏㐀-鿿]/;
const isNumericOnly = (s: string) => !SCRIPT_CHAR.test(s);
// DB에서 영문 그대로 저장된 코스 방향/위치명 — 골프장 코스명, 번역 대상 아님(전 언어 공통)
const DB_DIRECTION_TERMS = /^(South|East|West|North)$/i;

// 동적 캡처 텍스트를 언어 카테고리로 분류·기록(classifyToastText 의 동적요소판).
function classifyDynamic(lang: Lang, screen: string, kind: string, texts: string[], shot: string, seen: Set<string>) {
  for (const raw of texts) {
    const t = (raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) continue;
    // 한글에서도 숫자·기호만인 항목은 번역 대상 아님 → 범위 제외
    if (isNumericOnly(t)) continue;
    // DB 저장 코스방향명(South/East/West/North) — 번역 불필요, 전 언어 제외
    if (DB_DIRECTION_TERMS.test(t)) continue;
    let phen = '';
    if (ENCODING_BROKEN.test(t)) phen = '인코딩 깨짐';
    else if (HANGUL.test(t)) phen = hasOtherScript(t) ? '언어 혼재' : '한글 노출';
    else { const wl = detectWrongLanguage(t, lang.label); if (wl) phen = `타 언어 노출(${wl})`; }
    const key = `동적|${phen || 'PASS'}|${screen}|${kind}|${t}`;
    if (seen.has(key)) continue; seen.add(key);
    const meta = { path: `${screen} > 동적요소 > ${kind}`, tcRef: `언어검증_동적`, tcId: `LANGDYN-${lang.ko}`, desc: `${lang.ko} ${kind} ${phen || '정상'}: "${t.slice(0, 36)}"`, expected: '-' };
    if (phen) record(meta, 'FAIL', { actual: `${lang.label}: "${t}"`, error: phen, detail: `${kind}`, screenshot: shot });
    else record(meta, 'PASS', { actual: `${lang.label}: "${t}"`, screenshot: shot });
  }
}

// 드롭박스(vue-select) 컨텍스트 라벨 수집: placeholder → 선택값 → 인접 label/title.
//  SKIP_DROPDOWN_CONTENT_PATTERNS 매칭에 사용.
async function collectDropdownLabels(admin: Page): Promise<string[]> {
  return admin.evaluate(() => {
    const toggles = Array.from(document.querySelectorAll('.vs__dropdown-toggle'));
    return toggles.map(toggle => {
      const placeholder = toggle.querySelector('input')?.getAttribute('placeholder') || '';
      const selected = ((toggle.querySelector('.vs__selected') as HTMLElement)?.innerText || '').replace(/\s+/g, ' ').trim();
      let contextLabel = '';
      let el: Element | null = toggle.parentElement;
      for (let d = 0; d < 5 && el && !contextLabel; d++) {
        for (const sel of ['label', '.box-title', '.sub-title', 'h3', 'h4', '.form-label', '.label', '.title-text']) {
          const found = el.querySelector(sel) as HTMLElement | null;
          if (!found || found.contains(toggle)) continue;
          const txt = (found.innerText || '').replace(/\s+/g, ' ').trim();
          if (txt && txt.length >= 2 && txt.length <= 30 && !txt.includes('\n')) { contextLabel = txt; break; }
        }
        el = el.parentElement;
      }
      return [placeholder, selected, contextLabel].join('|||');
    });
  }).catch(() => []);
}

// 펼친 드롭다운(vue-select) 옵션목록 텍스트 수집(열기→읽기→Escape). native select 는 정적 optScan 으로 커버.
//  koLabels: 한국어 모드에서 미리 수집한 라벨 목록. 외국어 전환 후 라벨이 번역되면 한국어 패턴이 매칭 안 되므로
//   반드시 switchLanguage 전에 collectDropdownLabels()로 수집해 전달. 미전달 시 현재 모드로 수집(라디오 상태 등).
async function scanDropdownsInLang(admin: Page, lang: Lang, screen: string, seen: Set<string>, shot: string, koLabels?: string[]) {
  // 화면 단위 제외 — 라벨 수집 실패로 SKIP_DROPDOWN_CONTENT_PATTERNS 적용 불가한 경우의 폴백
  if (SKIP_DROPDOWN_SCREENS.some(s => screen.includes(s))) return;
  const toggles = admin.locator('.vs__dropdown-toggle');
  const n = Math.min(await toggles.count().catch(() => 0), 8);
  // 한국어 라벨이 전달된 경우 우선 사용 — 외국어 모드에서는 번역되어 한국어 패턴 매칭 불가
  const ddLabels = koLabels ?? await collectDropdownLabels(admin);
  for (let i = 0; i < n; i++) {
    const t = toggles.nth(i);
    if (!(await t.isVisible().catch(() => false))) continue;
    // 가변 데이터 드롭박스 제외: placeholder/선택값/인접라벨 중 하나라도 패턴 매칭 시 skip
    const parts = (ddLabels[i] || '|||').split('|||');
    if (SKIP_DROPDOWN_CONTENT_PATTERNS.some(([scr, lbl]) =>
        screen.includes(scr) && parts.some(p => p.includes(lbl)))) continue;
    await t.click().catch(() => {});
    await admin.waitForTimeout(450);
    const opts = await admin.locator('.vs__dropdown-menu li, .vs__dropdown-option, ul[id*="listbox"] li').allInnerTexts().catch(() => []);
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(200);
    if (opts.length) classifyDynamic(lang, screen, `드롭다운옵션#${i + 1}`, opts, shot, seen);
  }
}

// 현재 열린 최상위 모달의 구조적 텍스트(제목·버튼·라벨·confirm문구) 수집. tbody 사용자데이터는 제외.
async function captureModal(admin: Page): Promise<{ found: boolean; isAlarm?: boolean; title?: string; texts?: string[] }> {
  return await admin.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('.modal-group, .modal-box, .modal-content, [class*="-pop"]'))
      .filter(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const pick = roots[roots.length - 1] as HTMLElement | undefined;
    if (!pick) return { found: false };
    const cls = (pick.className || '').toString();
    const fullText = (pick.innerText || '').replace(/\s+/g, ' ').trim();
    const isAlarm = /alarm|alert|confirm/.test(cls) || fullText.length < 80;
    const out: string[] = [];
    if (isAlarm) {
      out.push(fullText);   // 알림/confirm: 짧은 전문(시스템 문구)
    } else {
      // 큰 팝업: 구조적 시스템 텍스트만(제목/버튼/라벨/컬럼명) — tbody 데이터 제외
      const sysSel = 'h1,h2,h3,h4,.modal-title,.pop-title,[class*="title"],button,[role="button"],a[class*="btn"],.label,.form-label,thead th,.sub-title,.col-name,dt';
      for (const el of Array.from(pick.querySelectorAll(sysSel))) {
        if (el.closest('tbody')) continue;
        const t = (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim();
        if (t && t.length <= 60) out.push(t);
      }
    }
    const title = (pick.querySelector('h1,h2,h3,h4,.modal-title,.pop-title') as HTMLElement)?.innerText?.replace(/\s+/g, ' ').trim() || '';
    return { found: true, isAlarm, title, texts: [...new Set(out)].slice(0, 40) };
  });
}

// 현재 열린(가시·텍스트 있는) 모달 개수 — 닫힘 판정용.
async function openModalCount(admin: Page): Promise<number> {
  return await admin.locator('.modal-group, .modal-box, .modal-content, [class*="-pop"]').filter({ hasText: /\S/ }).count().catch(() => 0);
}

// 비파괴 모달 닫기 — ⚠ 언어 무관(텍스트 금지). 닫힐 때까지 에스컬레이션(최대 5회):
//   ① 비-primary/비-danger 푸터버튼(취소/닫기)  ② X/close 아이콘
//   ② .5 모달 루트 내 button.button-common(비primary·danger) — 비표준 footer 컨테이너 대응
//   ③ 순수 알림(취소·danger 없이 [확인]만) → primary 클릭은 안전한 dismiss
//   ④ Escape.  danger/primary(삭제·저장 실행)는 ②③ 외엔 클릭 안 함(파괴 방지).
async function closeModalNonDestructive(admin: Page) {
  // 모달 푸터 셀렉터 — SPA별로 컨테이너 이름이 다양함(배토팝업 등 비표준 footer 포함)
  const FOOTER_BTN = [
    '.modal-footer button:not(.primary):not(.danger)',
    '.btn-area button:not(.primary):not(.danger)',
    '.button-area button:not(.primary):not(.danger)',
    '.pop-footer button:not(.primary):not(.danger)',
    '.popup-footer button:not(.primary):not(.danger)',
    '.layer-btn button:not(.primary):not(.danger)',
    '.layer-footer button:not(.primary):not(.danger)',
    '.footer-wrap button:not(.primary):not(.danger)',
    '.ctrl-area button:not(.primary):not(.danger)',
  ].join(', ');
  for (let attempt = 0; attempt < 5 && (await openModalCount(admin)) > 0; attempt++) {
    // ① 취소/닫기(비-primary·비-danger) — 다양한 footer 컨테이너 커버
    const cancel = admin.locator(FOOTER_BTN).last();
    if (await cancel.isVisible().catch(() => false)) { await cancel.click().catch(() => {}); await admin.waitForTimeout(450); continue; }
    // ② X/close 아이콘 + 닫기 전용 버튼 — 모달 컨테이너 내부로 스코프 한정(페이지 전역 오매칭 방지)
    //   배토팝업: route-close-btn(.primary) → ".modal-group button[class*="close"]"로 매칭
    //   ⚠ button[class*="close"] 를 페이지 전역으로 쓰면 이전홀/다음홀 등 비-close 버튼 오클릭 위험
    const x = admin.locator([
      '.modal-group button[class*="close"]',   // 배토팝업 route-close-btn 등 모달 내 close class 버튼
      '.modal-box button[class*="close"]',
      '.modal-content button[class*="close"]',
      '[class*="-pop"] button[class*="close"]',
      '[class*="popup"] button[class*="close"]',
      '[class*="layer"] button[class*="close"]',
      '.modal-group [class*="close"]:not(button)',  // 비-button close 아이콘(div/span/i)
      '.modal-box [class*="close"]:not(button)',
      '[class*="-pop"] [class*="close"]:not(button)',
      '[aria-label*="close" i]',
      '[title*="close" i]',
      '.ico-close', '.icon-close', '.btn-x',
    ].join(', ')).last();
    if (await x.isVisible().catch(() => false)) { await x.click({ force: true }).catch(() => {}); await admin.waitForTimeout(450); continue; }
    // ② .5 제거됨 — button.button-common:not(.primary):not(.danger)은 이전홀/다음홀 등 오클릭 유발
    //   → Escape(④)로 폴백하는 것이 더 안전(대부분 팝업이 Escape에 반응)
    // ③ 순수 알림([확인]만, danger 없음) → 안전 dismiss
    const footer = admin.locator('.modal-footer, .btn-area, .button-area, .pop-footer, .popup-footer, .layer-btn, .ctrl-area').last();
    const dangerCnt = await footer.locator('button.danger, button[class*="danger"]').count().catch(() => 0);
    if (dangerCnt === 0) {
      const primary = footer.locator('button.primary').last();
      if (await primary.isVisible().catch(() => false)) { await primary.click().catch(() => {}); await admin.waitForTimeout(450); continue; }
    }
    // ④ Escape
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(450);
  }
}

// 스코어카드 팝업: 가로/세로(회전) 전환 버튼이 있으면 전환 후 재스캔(전환 후 다국어 노출 확인).
async function scorecardOrientInLang(admin: Page, lang: Lang, screen: string, seen: Set<string>, shot: string) {
  const orient = admin.locator('.modal-group, .modal-box').locator('button, [role="button"]')
    .filter({ hasText: /가로|세로|회전|rotate|landscape|portrait/i }).first();
  if (!(await orient.isVisible().catch(() => false))) return;
  await orient.click().catch(() => {});
  await admin.waitForTimeout(800);
  const data = await captureModal(admin);
  if (data.found) classifyDynamic(lang, screen, '스코어카드(전환후)', data.texts || [], shot, seen);
}

// ⚠ 언어 전환 후엔 버튼 텍스트도 번역됨 → 한국어 모드(전환 전)에 트리거 '위치'(행/버튼 인덱스)를 식별.
//  화면당 대상 버튼유형 1회(앞 행부터 데이터 있는 행 탐색). 반환: 위치 + 한국어 라벨.
//  ① 행 버튼(r,bi): SAFE_POPUP_BTNS + CONFIRM_POPUP_BTNS → 기존 행 버튼 스캔
//  ② 페이지 레벨 버튼(pi≥0): PAGE_POPUP_BTNS → 테이블 밖의 모달 오프너(등록/미리보기 등)
const ROW_SEL = '.table-overflow-item table tbody tr, .list-table-group tbody tr';
type PopupTrigger = { r: number; bi: number; pi: number; label: string };
async function findPopupTriggers(admin: Page, allowDestructive: boolean): Promise<PopupTrigger[]> {
  const rowTargets = allowDestructive ? [...SAFE_POPUP_BTNS, ...PAGE_POPUP_BTNS, ...CONFIRM_POPUP_BTNS] : [...SAFE_POPUP_BTNS, ...PAGE_POPUP_BTNS];
  const triggers: PopupTrigger[] = [];
  const tried = new Set<string>();

  // ① 테이블 행 버튼 — SAFE + PAGE_POPUP_BTNS 모두 적용(행 [수정]/[등록] 도 모달 오프너)
  const rows = admin.locator(ROW_SEL);
  const rc = Math.min(await rows.count().catch(() => 0), 6);
  for (let r = 0; r < rc; r++) {
    const btns = rows.nth(r).locator('button, [role="button"]');
    const bc = await btns.count().catch(() => 0);
    for (let bi = 0; bi < bc; bi++) {
      const label = (await btns.nth(bi).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      const match = rowTargets.find(t => label === t || label.includes(t));
      if (!match || tried.has(match)) continue;
      if (!(await btns.nth(bi).isVisible().catch(() => false))) continue;
      tried.add(match);
      triggers.push({ r, bi, pi: -1, label: match });
    }
  }

  // ② 페이지 레벨(비행) 버튼 — SAFE + PAGE_POPUP_BTNS (행 스캔과 동일 후보; 행에서 이미 tried 된 것은 건너뜀)
  const pageTargets = allowDestructive ? [...SAFE_POPUP_BTNS, ...PAGE_POPUP_BTNS, ...CONFIRM_POPUP_BTNS] : [...SAFE_POPUP_BTNS, ...PAGE_POPUP_BTNS];
  const allBtns = admin.locator('button, [role="button"]');
  const totalBtns = Math.min(await allBtns.count().catch(() => 0), 60);
  for (let pi = 0; pi < totalBtns; pi++) {
    const btn = allBtns.nth(pi);
    const inRow = await btn.evaluate((el, rowSel) => !!el.closest(rowSel), ROW_SEL).catch(() => true);
    if (inRow) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    const label = (await btn.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const match = pageTargets.find(t => label === t || label.includes(t));
    if (!match || tried.has(match)) continue;
    tried.add(match);
    triggers.push({ r: -1, bi: -1, pi, label: match });
  }

  return triggers;
}

// 식별된 트리거를 '위치'로 클릭(전환 후 텍스트 무관) → 팝업 캡처 → 분류 → 비파괴 닫기.
//  pi≥0: 페이지 레벨 버튼(언어 전환 후 nth(pi) 인덱스는 DOM 구조 불변으로 안정).
//         네비게이션 가드: 클릭 후 URL 변경 시 뒤로 이동 후 continue(모달 아닌 페이지 이동 방어).
async function scanPopupTriggers(admin: Page, lang: Lang, screen: string, seen: Set<string>, shot: string, triggers: PopupTrigger[]) {
  const rows = admin.locator(ROW_SEL);
  for (const tg of triggers) {
    // 직전 팝업이 안 닫혔으면 먼저 닫고, 그래도 열려 있으면 잔존 모달 오염 방지 위해 이 화면 팝업 스캔 중단
    if ((await openModalCount(admin)) > 0) { await closeModalNonDestructive(admin); if ((await openModalCount(admin)) > 0) break; }
    try {
      let b;
      if (tg.pi >= 0) {
        b = admin.locator('button, [role="button"]').nth(tg.pi);   // 페이지 레벨 버튼
      } else {
        b = rows.nth(tg.r).locator('button, [role="button"]').nth(tg.bi);   // 행 버튼
      }
      if (!(await b.isVisible().catch(() => false))) continue;

      const urlBefore = admin.url();
      await b.click().catch(() => {});
      await admin.waitForTimeout(1200);

      // 페이지 레벨 버튼이 네비게이션을 유발했으면(모달 아님) → 뒤로 이동 후 skip
      if (tg.pi >= 0 && admin.url() !== urlBefore) {
        await admin.goBack().catch(() => {});
        await settle(admin, 800);
        continue;
      }

      const data = await captureModal(admin);
      if (data.found) {
        classifyDynamic(lang, screen, `팝업[${tg.label}]`, data.texts || [], shot, seen);
        if (tg.label === '스코어') await scorecardOrientInLang(admin, lang, screen, seen, shot);
      }
    } catch { /* 비파괴: 무시 */ }
    await closeModalNonDestructive(admin);
  }
}

// ════════════════ 라디오 버튼 상태별 동적 UI 스캔 ════════════════
//  라디오 버튼 선택 시 동적으로 변경되는 고정 UI(안내문구·버튼·드롭다운값·섹션제목 등)를 검증.
//  ⚠ 비파괴: 클릭 후 Escape·원래 라디오로 복구(저장 안 함). 사용자 가변 데이터(이름·금액 등)는
//     EXCLUDE_ANCESTORS + SCAN_ZONES 범위 설정으로 이미 배제됨.

// 현재 화면의 가시 시스템 텍스트 전체 수집(SCAN_ZONES 기반, 한글 필터 없음). 라디오 상태별 캡처용.
async function captureVisibleSysTexts(admin: Page): Promise<string[]> {
  return await admin.evaluate(({ zones, excl }) => {
    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      if (r.width <= 1 && r.height <= 1) return false; // sr-only 제외
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const inExcluded = (el: Element) => excl.some(sel => el.closest(sel));
    const texts = new Set<string>();
    for (const z of zones) {
      const nodes = Array.from(document.querySelectorAll(z.sel));
      for (const el of nodes) {
        if (!z.keepInData && inExcluded(el)) continue;
        if (!(z as any).optScan && !isVisible(el)) continue;
        let text = '';
        if (z.attr) text = (el.getAttribute(z.attr) || '').trim();
        else if ((z as any).optScan) text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        else text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
        if (text) texts.add(text.slice(0, 80));
      }
    }
    return [...texts];
  }, { zones: SCAN_ZONES, excl: EXCLUDE_ANCESTORS });
}

// 한국어 모드에서 라디오 그룹 식별. 반환: 각 옵션의 전역 인덱스 + 라벨 + 그룹명.
//  prereq: 이 옵션이 나타나기 위해 먼저 클릭해야 하는 1차 라디오의 ri (없으면 undefined).
//  동작: ① 초기 가시 그룹 수집 → ② 각 1차 옵션 클릭 후 새로 나타난 2차 그룹 탐색(depth=1).
//  단일 토글 제외. 그룹당 최대 6옵션, 최대 4그룹(1·2차 합산).
type RadioTrigger = { ri: number; label: string; groupName: string; prereq?: number };

async function findRadioTriggers(admin: Page): Promise<RadioTrigger[]> {
  // 현재 DOM의 라디오 그룹 스냅샷
  const getGroups = () => admin.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
    const groupCount = new Map<string, number>();
    radios.forEach(r => { const g = r.getAttribute('name') || ''; groupCount.set(g, (groupCount.get(g) || 0) + 1); });
    const result: { ri: number; label: string; groupName: string }[] = [];
    const seenPG = new Map<string, number>();
    radios.forEach((inp, ri) => {
      const he = inp as HTMLInputElement;
      const groupName = inp.getAttribute('name') || `__noname_${ri}`;
      if ((groupCount.get(groupName) || 0) < 2) return;
      if ((seenPG.get(groupName) || 0) >= 6) return;
      seenPG.set(groupName, (seenPG.get(groupName) || 0) + 1);
      // hidden input 허용(label 로만 클릭 가능한 경우) — label 없으면 제외
      const bRect = he.getBoundingClientRect();
      const hasLabel = !!(he.id && document.querySelector(`label[for="${he.id}"]`));
      if (bRect.width === 0 && bRect.height === 0 && !hasLabel) return;
      const id = inp.id;
      const labelEl = id ? document.querySelector(`label[for="${id}"]`) as HTMLElement | null : null;
      const label = (labelEl?.innerText || '').replace(/\s+/g, ' ').trim() || inp.value || '';
      result.push({ ri, label, groupName });
    });
    const groups = [...new Set(result.map(r => r.groupName))].slice(0, 4);
    return result.filter(r => groups.includes(r.groupName));
  });

  // 라디오를 label 우선으로 클릭(한국어 모드 탐색용)
  const clickByRi = async (ri: number) => {
    const radio = admin.locator('input[type="radio"]').nth(ri);
    const id = await radio.getAttribute('id').catch(() => '');
    const lbl = id ? admin.locator(`label[for="${id}"]`).first() : null;
    if (lbl && await lbl.isVisible().catch(() => false)) await lbl.click().catch(() => {});
    else await radio.click({ force: true }).catch(() => {});
    await admin.waitForTimeout(600);
  };

  const initial = await getGroups();
  const allTriggers: RadioTrigger[] = initial.map(t => ({ ...t }));
  const initialGroupNames = new Set(initial.map(t => t.groupName));

  // depth-1 탐색: 각 1차 옵션 클릭 → 신규 그룹 발견 시 prereq 첨부
  for (const tg of initial) {
    try {
      await clickByRi(tg.ri);
      const after = await getGroups();
      for (const newTg of after) {
        if (!initialGroupNames.has(newTg.groupName) && !allTriggers.some(t => t.ri === newTg.ri)) {
          allTriggers.push({ ...newTg, prereq: tg.ri });
        }
      }
    } catch { /* 비파괴 탐색 */ }
  }
  return allTriggers;
}

// 언어 전환 후 라디오 상태별 시스템 텍스트 + 변동 드롭다운 옵션 캡처 → 분류.
//  prereq 있는 트리거: 1차 라디오 클릭 후 → 2차 옵션 순환.
//  seen 중복 제거: 이미 스캔된 항목은 재기록 안 함 → 라디오 상태별 신규 노출분만 포착.
async function scanRadioStatesInLang(admin: Page, lang: Lang, screen: string, seen: Set<string>, shot: string, triggers: RadioTrigger[]) {
  if (!triggers.length) return;

  const clickByRi = async (ri: number) => {
    const radio = admin.locator('input[type="radio"]').nth(ri);
    const id = await radio.getAttribute('id').catch(() => '');
    const lbl = id ? admin.locator(`label[for="${id}"]`).first() : null;
    if (lbl && await lbl.isVisible().catch(() => false)) await lbl.click().catch(() => {});
    else await radio.click({ force: true }).catch(() => {});
    await admin.waitForTimeout(700);
  };

  const scanCurrentState = async (kind: string) => {
    const texts = await captureVisibleSysTexts(admin);
    classifyDynamic(lang, screen, kind, texts, shot, seen);
    // 특정 라디오 상태에서 드롭다운 스캔 제외(SKIP_RADIO_DROPDOWN_PATTERNS) — 가변 데이터 드롭박스 false positive 방지
    const skipDd = SKIP_RADIO_DROPDOWN_PATTERNS.some(([scr, lbl]) => screen.includes(scr) && kind.includes(lbl));
    if (!skipDd) await scanDropdownsInLang(admin, lang, screen, seen, shot);
  };

  // 1차 트리거(prereq 없음)와 그에 딸린 2차 트리거를 prereq ri로 묶어 처리
  const primaries = triggers.filter(t => t.prereq === undefined);
  const secondariesMap = new Map<number, RadioTrigger[]>();
  for (const t of triggers.filter(t => t.prereq !== undefined)) {
    const list = secondariesMap.get(t.prereq!) || [];
    list.push(t);
    secondariesMap.set(t.prereq!, list);
  }

  for (const tg of primaries) {
    try {
      await clickByRi(tg.ri);
      await scanCurrentState(`라디오[${tg.label || tg.groupName}]`);

      // 이 1차 옵션 선택 시 나타나는 2차 라디오 순환
      const secondaries = secondariesMap.get(tg.ri) || [];
      for (const sec of secondaries) {
        try {
          await clickByRi(sec.ri);
          await scanCurrentState(`라디오[${tg.label}>${sec.label || sec.groupName}]`);
        } catch { /* 비파괴 */ }
      }
    } catch { /* 비파괴 */ }
  }
}

// 전체 메뉴 순회(단일 언어) — 동적 요소(드롭다운/팝업/라디오상태) 전용. openAdmin 직후 호출.
//  비파괴(보기 팝업·드롭다운 Escape). 삭제 confirm 은 allowDestructive=true 시에만(스캔 후 취소).
export async function runLangCheckDynamic(admin: Page, lang: Lang, allowDestructive = false) {
  const seen = new Set<string>();
  // 부분 실행: LANGDYN_MENUS="라운드관리,카트 관리" (대메뉴/소메뉴명 부분일치) — 미지정 시 전체
  const filt = (process.env.LANGDYN_MENUS || '').split(',').map(s => s.replace(/\s+/g, '')).filter(Boolean);
  const want = (menu: string, sub: string) => !filt.length || filt.some(f => menu.replace(/\s+/g, '').includes(f) || sub.replace(/\s+/g, '').includes(f));
  for (const { menu, subs } of MENU_LIST) {
    for (const sub of subs) {
      if (!want(menu, sub)) continue;
      const screen = `${menu} > ${sub}`;
      const entry = await enterMenuChecked(admin, menu, sub);   // #1~#5: 자가치유 + 미구현/진입실패/렌더 구분
      if (!entry.ok) {
        const m: CheckMeta = { path: `${screen} > 동적요소`, tcRef: `언어검증_동적`, tcId: `LANGDYN-${lang.ko}`, desc: `${lang.ko} 동적 요소 검증`, failMsg: entry.reason };
        if (entry.defect) record(m, 'FAIL', { error: entry.reason, detail: `${lang.ko} 모드 진입 단계 — ${entry.reason}` }); else skip(m, entry.reason);
        continue;
      }
      // 가변 데이터 위주 화면 동적 스캔 제외(false positive 방지)
      if (DYNAMIC_SKIP_SCREENS.some(s => screen.includes(s))) {
        skip({ path: `${screen} > 동적요소`, tcRef: `언어검증_동적`, tcId: `LANGDYN-${lang.ko}`, desc: `${lang.ko} 동적 요소 검증` }, '가변 데이터 화면 — 동적 스캔 제외(DYNAMIC_SKIP_SCREENS)');
        continue;
      }
      // ⚠ 전환 전(한국어)에 트리거 '위치' + 드롭박스 라벨 식별(전환 후 번역되어 한국어 패턴 매칭 불가)
      const popupTriggers = await findPopupTriggers(admin, allowDestructive).catch(() => []);
      const radioTriggers = await findRadioTriggers(admin).catch(() => []);
      const koDropdownLabels = await collectDropdownLabels(admin);
      const switched = await switchLanguage(admin, lang.label);
      if (!switched) { skip({ path: `${screen} > 동적요소`, tcRef: `언어검증_동적`, tcId: `LANGDYN-${lang.ko}`, desc: `${lang.ko} 동적 요소 검증` }, `${lang.label} 전환 실패`); continue; }
      const shot = await capture(admin, { path: `${screen}_동적_${lang.ko}`, tcRef: `언어검증_동적`, tcId: `LANGDYN-${lang.ko}`, desc: `${lang.ko} 동적요소` });
      if (await failForeignBlank(admin, lang, screen, `언어검증_동적`, `LANGDYN-${lang.ko}`, '동적 — 화면 미노출 점검', shot)) { await ensureKorean(admin); continue; }
      await scanDropdownsInLang(admin, lang, screen, seen, shot, koDropdownLabels);
      await scanRadioStatesInLang(admin, lang, screen, seen, shot, radioTriggers);
      await scanPopupTriggers(admin, lang, screen, seen, shot, popupTriggers);
      await ensureKorean(admin);   // #2: 다음 메뉴 한글 네비 위해 원복(검증·재시도 — cascade 차단)
    }
  }
  await ensureKorean(admin);
}

// 전체 메뉴 순회(단일 언어). openAdmin 직후(한국어·홈 랜딩) 호출.
export async function runLangCheckAll(admin: Page, lang: Lang) {
  const seen = new Set<string>();
  // ① 홈(랜딩) — 전역 SNB/레이아웃 결함이 여기로 1회 귀속됨
  await scanScreen(admin, lang, '홈', '언어검증_홈', seen);
  // ② 전 대메뉴 × 하위 메뉴
  for (const { menu, subs } of MENU_LIST) {
    for (const sub of subs) {
      const screen = `${menu} > ${sub}`;
      const entry = await enterMenuChecked(admin, menu, sub);   // #1~#5: 자가치유 + 미구현/진입실패/렌더 구분
      if (!entry.ok) { recordEntryFailure(screen, menu, lang, '번역 검증', entry); continue; }
      await scanScreen(admin, lang, screen, `언어검증_${menu}`, seen);
    }
  }
  await ensureKorean(admin); // 비파괴 최종 원복(#2: 검증·재시도)
}

// 전체 메뉴 단일 패스 통합 검증(단일 언어): 정적 슬롯 비교 + 동적 스캔(드롭다운/라디오/팝업)을
//  메뉴당 1회 방문으로 처리. runLangCheckAll + runLangCheckDynamic 를 합친 효율적 대안.
//  리포트: lang-check-unified-<언어>_report_*.xlsx (정적·동적 항목 통합)
export async function runLangCheckUnified(admin: Page, lang: Lang, allowDestructive = false) {
  const seen = new Set<string>();
  const filt = (process.env.LANGDYN_MENUS || '').split(',').map(s => s.replace(/\s+/g, '')).filter(Boolean);
  const want = (menu: string, sub: string) => !filt.length || filt.some(f => menu.replace(/\s+/g, '').includes(f) || sub.replace(/\s+/g, '').includes(f));

  // ① 홈(랜딩) — 전역 SNB/레이아웃 결함 귀속(정적 슬롯만; 동적 트리거 없음)
  await scanScreen(admin, lang, '홈', '언어검증_홈', seen);

  // ② 전 메뉴: 한국어 모드에서 슬롯·트리거 동시 수집 → 전환 → 정적비교 + 동적스캔 → 복귀
  for (const { menu, subs } of MENU_LIST) {
    for (const sub of subs) {
      if (!want(menu, sub)) continue;
      const screen = `${menu} > ${sub}`;
      const entry = await enterMenuChecked(admin, menu, sub);   // #1~#5: 자가치유 + 미구현/진입실패/렌더 구분
      if (!entry.ok) { recordEntryFailure(screen, menu, lang, '통합 검증', entry); continue; }
      const skipDynamic = DYNAMIC_SKIP_SCREENS.some(s => screen.includes(s));
      // 한국어 모드: 정적 슬롯 캡처 + 동적 트리거·드롭박스 라벨 수집(전환 후 번역되어 패턴 매칭 불가)
      const ko = await captureSlots(admin);
      const popupTriggers = skipDynamic ? [] : await findPopupTriggers(admin, allowDestructive).catch(() => []);
      const radioTriggers = skipDynamic ? [] : await findRadioTriggers(admin).catch(() => []);
      const koDropdownLabels = skipDynamic ? [] : await collectDropdownLabels(admin);

      // 언어 전환
      const switched = await switchLanguage(admin, lang.label);
      if (!switched) {
        skip({ path: `${screen} > 언어검증`, tcRef: `언어검증_${menu}`, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} 통합 검증` }, `${lang.label} 전환 실패`);
        continue;
      }
      const shot = await capture(admin, { path: `${screen}_통합_${lang.ko}`, tcRef: `언어검증_${menu}`, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} 통합(정적+동적) 검증` });

      // #4(외국어 모드): 전환 후 본문 백지면 i18n 렌더 결함 FAIL 후 다음 메뉴로
      if (await failForeignBlank(admin, lang, screen, `언어검증_${menu}`, `LANG-${lang.ko}`, '통합 — 화면 미노출 점검', shot)) { await ensureKorean(admin); continue; }

      // 정적 슬롯 비교
      const fg = await captureSlots(admin);
      applySlotComparison(ko, fg, lang, screen, `언어검증_${menu}`, shot, seen);

      // 동적 스캔 — 드롭다운 옵션목록 / 라디오 상태별 텍스트 / 팝업 내 문구
      //  DYNAMIC_SKIP_SCREENS 해당 화면은 가변 데이터 위주 → 동적 스캔 건너뜀(정적 슬롯 비교는 수행)
      if (!skipDynamic) {
        await scanDropdownsInLang(admin, lang, screen, seen, shot, koDropdownLabels);
        await scanRadioStatesInLang(admin, lang, screen, seen, shot, radioTriggers);
        await scanPopupTriggers(admin, lang, screen, seen, shot, popupTriggers);
      }

      await ensureKorean(admin);   // #2: 다음 메뉴 한글 네비 위해 원복(검증·재시도 — cascade 차단)
    }
  }
  await ensureKorean(admin);
}

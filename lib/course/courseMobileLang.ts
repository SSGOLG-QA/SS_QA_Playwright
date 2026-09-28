import { Page, expect } from '@playwright/test';
import { Slot } from '../langCheck';
import { CourseLang, COURSE_LANGS } from './courseLangCheck';
import { COURSE_MOBILE_URL } from './courseHelpers';
import { skip, review, diff, record, CheckMeta } from '../reporter';

// ── 모바일 전용 대조 이미터(2026-09-15, 사용자 피드백: 경로 가독성·중복 제거) ─────────
//   · 경로 = `${tab} > ${sub} > ${zone}`(중복어 '언어검증' 제거, tab은 부모탭 편입 유지, sub=기본/조건설정/상세/기간 등)
//   · **런-전역 dedup**(gSeen, koText 기준) — 같은 항목이 base·조건설정·최신순·상세에 반복되던 것 1건화(사용자 지적).
//   · 판정: FG 한글잔존=한글노출/혼재, 빈값=미노출, 그 외=번역 정상(PASS). 한국어 원문↔대상값 병기.
const HANGUL_RE = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
const OTHER_SCRIPT_RE = /[A-Za-z฀-๿぀-ヿ㐀-鿿Ā-ɏ]/;
function emitMobileComparison(ko: Slot[], fg: Slot[], lang: CourseLang, tab: string, sub: string, tcRef: string, gSeen: Set<string>) {
  const fgByKey = new Map(fg.map((s) => [s.key, s.text]));
  for (const s of dedupByText(ko)) {
    const t = s.text;
    if (!HANGUL_RE.test(t)) continue;             // 번역 대상(한국어 원문 포함)만
    if (gSeen.has(t)) continue; gSeen.add(t);      // 런-전역 중복 제거
    const ft = (fgByKey.get(s.key) || '').trim();
    let phen = '';
    if (ft === '') phen = '미노출(미번역)';
    else if (HANGUL_RE.test(ft)) phen = OTHER_SCRIPT_RE.test(ft) ? '언어 혼재' : '한글 노출';
    const meta: CheckMeta = {
      path: `${tab} > ${sub} > ${s.zone}`, tcRef, tcId: `MLANG-${lang.ko}`,
      desc: phen ? `${lang.ko} ${phen}: "${t.slice(0, 40)}"` : `${lang.ko} 번역 정상: "${t.slice(0, 40)}"`,
      expected: `한국어 원문: "${t}"`, failMsg: phen || undefined,
    };
    if (phen) record(meta, 'FAIL', { actual: `${lang.label}: "${ft}"`, error: phen, detail: `${lang.label} 모드 표시값` });
    else record(meta, 'PASS', { actual: `${lang.label}: "${ft}"` });
  }
}
import { settle } from '../adminHelpers';
import { killMobileAlarms, enterCourseMgmt, returnToLanding, mobileBack } from './courseMobileHelpers';
import { clickFrontLayerBack, headerTitles } from './courseMobileDeep';   // 딥 인터랙션서 확정된 스택 back 스코프 재사용
import { isCourseDestructiveAllowed } from './destructive';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** 다국어 검증 — 미해결 블로커 해소 구현 (2026-09-14)
//
//  ⚠ 핵심 제약(2026-09-11 IA 실측): 모바일 앱은 **앱 내 언어 스위처가 전무**(홈·헤더·설정 어디에도 없음).
//     언어는 로그인 화면에서만 선택. i18n=localStorage.lang.map(활성언어=map 유일키)/Vue i18n(getLocaleMessage).
//     따라서 데스크톱식 "헤더 드롭다운으로 전환→대조"를 직접 재사용할 수 없음.
//
//  ⇒ **자기발견형 이중 전략**(런타임에 메커니즘을 감지해 자동 분기):
//     · 전략 A (런타임 주입 전환 가능): 활성=한국어 상태에서 KO 슬롯 캡처 → i18n.locale 주입 전환(사전 로드/복제) →
//        재캡처 → applySlotComparison(데스크톱 엔진 **무수정 재사용**)로 한글잔존/미번역/혼재/타언어/인코딩/잘림 검출. 종료 시 KO 원복.
//     · 전략 B (세션 활성언어가 이미 외국어): 전환 없이 **활성언어 누수 스캔**(오라클 없이 단일언어) —
//        시스템 텍스트에 한글 잔존·i18n 키 누출(ui.2971)·인코딩 깨짐 검출.
//     · 둘 다 불가 (한국어 로그인 + 런타임 전환 미지원): **정직 SKIP** + 진단(프로브 course:mobile-lang / 언어별 로그인 안내).
//
//  비파괴: 언어 주입은 클라이언트 런타임 상태만 변경(서버 반영 없음)·읽기/스캔만. 종료 시 한국어 원복.
//  선결: course:auth-mobile. 실행: (전체) npm run course:mobile-lang-verify / (단일) $env:LANGS="일본어"; npm run course:mobile-lang-verify
// ──────────────────────────────────────────────────────────────

// CourseLang.ko → 후보 i18n locale 코드(앱마다 표기 상이 → 여러 후보 시도, 사전 존재하는 첫 코드 채택).
const LANG_CODE_CANDIDATES: Record<string, string[]> = {
  영어: ['en', 'en-US', 'en_US', 'US', 'eng'],
  베트남어: ['vi', 'vi-VN', 'vi_VN', 'VN', 'vn'],
  태국어: ['th', 'th-TH', 'th_TH', 'TH'],
  번체중문: ['zh-TW', 'zh_TW', 'zh-Hant', 'TW', 'zhTW'],
  간체중문: ['zh-CN', 'zh_CN', 'zh-Hans', 'CN', 'zh', 'zhCN'],
  일본어: ['ja', 'ja-JP', 'ja_JP', 'JP', 'jp'],
  인도네시아어: ['id', 'id-ID', 'id_ID', 'ID', 'idn'],
};
const KO_CODES = ['ko', 'ko-KR', 'ko_KR', 'KR', 'kr'];

// ── 언어 독립 진입/내비게이션(⚠ 핵심: 외국어 로그인 세션 대응) ───────────────────
//   기능 스위트의 openCourseMobile/enterCourseMgmt/gotoMobileArea 는 한국어 텍스트('코스관리'·영역명)에
//   의존 → **외국어 로그인 세션(전략 B)에선 타일 텍스트가 번역되어 매칭 실패**(예 태국어 홈: 코스관리='จัดการคอร์ส')
//   → openCourseMobile 이 "세션 만료"로 오판(false negative). 언어 검증은 **URL/라우트 직접 내비**로 언어 독립 확보.
//   판정은 오직 URL(로그인 리다이렉트 여부)로 — 텍스트 불문.

// 로그인 상태 확인(언어 독립) — /mobile/ 로드 후 Login 리다이렉트면 진짜 만료. 아니면 유효.
export async function openCourseMobileLangSafe(page: Page): Promise<Page> {
  await page.goto(COURSE_MOBILE_URL, { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (/\/mobile\/Login/i.test(page.url()) ? 'login' : (/\/mobile\//i.test(page.url()) ? 'ok' : 'wait')),
    { timeout: 20_000, intervals: [400, 800, 1200, 1600] }).not.toBe('wait').catch(() => {});
  if (/\/mobile\/Login/i.test(page.url())) {
    throw new Error(`[openCourseMobileLangSafe] 모바일 세션 만료(${page.url()}) — \`npm run course:auth-mobile\` 재인증 후 재실행(1런/로그인).`);
  }
  await settle(page, 700); await killMobileAlarms(page);
  return page;
}

// 랜딩(/mobile/course) 직접 내비(언어 독립) — URL goto.
async function gotoMobileLanding(page: Page): Promise<boolean> {
  await page.goto(COURSE_MOBILE_URL + 'course', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const want = /\/mobile\/course(\?|$|\/?$)/i;
  await expect.poll(async () => want.test(page.url()), { timeout: 8_000, intervals: [400, 800, 1200] }).toBeTruthy().catch(() => {});
  await settle(page, 900); await killMobileAlarms(page);
  return want.test(page.url());
}

// 서브화면 진입 — ⚠ 직접 URL 딥링크(reload)·위치 nth 클릭은 URL만 바꾸고 **랜딩 타일을 그대로 재렌더**(2026-09-15 실측:
//   전 서브화면이 동일 12타일 반복). 해결: **한국어로 전환 후 검증된 기능 내비 `gotoMobileArea`(텍스트 필터 타일클릭)** 사용
//   — 기능 스위트 81 PASS로 서브페이지 실제 콘텐츠 렌더 확인된 경로. 텍스트 매칭 위해 KO 전환 선행.
// 공백 무시 타일 매칭 + route 검증(언어 독립 아님 — 한국어 상태 전제). 타일 텍스트≠area명 공백차 대응.
async function gotoMobileAreaFlex(page: Page, match: string, route: string): Promise<boolean> {
  const norm = (s: string) => (s || '').replace(/\s+/g, '');
  const want = new RegExp(`/mobile/course/${route}`, 'i');
  const boxes = page.locator('.content-box');
  const n = await boxes.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const t = await boxes.nth(i).innerText().catch(() => '');
    if (!norm(t).includes(norm(match))) continue;
    await boxes.nth(i).click({ timeout: 4_000 }).catch(() => {});
    await expect.poll(async () => want.test(page.url()), { timeout: 7_000, intervals: [400, 800, 1200] }).toBeTruthy().catch(() => {});
    if (want.test(page.url())) { await settle(page, 900); await killMobileAlarms(page); return true; }
  }
  return false;
}

async function enterMobileScreenKorean(page: Page, match: string | null, route: string): Promise<boolean> {
  // ⚠ 캐스케이드 차단(2026-09-15): 오버레이 스캔 후 팝업 잔존이 다음 화면 진입을 연쇄 실패시킴 → **진입 전 오버레이 강제 정리**.
  await killMobileAlarms(page);
  for (let i = 0; i < 3 && (await isOverlayOpen(page)); i++) { await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); }
  // ⚠ 캐스케이드 결정적 차단(2026-09-16, 파괴형 크롤 회귀 실측): client-nav returnToLanding 은 URL만 랜딩이고
  //   라우터/오버레이/로케일 상태가 오염된 채 남아 타일 매칭이 7화면 연쇄 실패(베트남어 실측 — 작업관리 파괴형 크롤
  //   직후 코스뷰~자재관리 전부 enter=false). → **매 화면 진입 전 랜딩 URL 하드 goto(신선 SPA 부팅)** 로 이전 화면
  //   오염을 결정적으로 격리한 뒤 한국어 재적용. 비파괴(reload 만) · 화면당 ~2s 추가는 커버리지 회복 대비 수용.
  await restoreMobileKorean(page);                 // 오염 오버레이/로케일 우선 정리
  await settle(page, 300);
  await gotoMobileLanding(page);                    // 하드 goto = 신선 부팅(파괴형 크롤 잔재 격리)
  await restoreMobileKorean(page); await settle(page, 400);
  if (!/\/mobile\/course\/?$/i.test(page.url())) {  // 하드 goto 조차 실패 시 client-nav 폴백
    await returnToLanding(page); await restoreMobileKorean(page); await settle(page, 300);
  }
  if (match == null) return /\/mobile\/course\/?$/i.test(page.url()) || enterCourseMgmt(page);
  return gotoMobileAreaFlex(page, match, route);    // 공백 무시 매칭 + route 검증
}

// ── 모바일 i18n 런타임 상태 채취(전환 가능성 판정용) ─────────────────────────
export interface MobileI18nState {
  hasI18n: boolean;
  locale: string | null;
  available: string[];
  msgCounts: Record<string, number>;   // locale → 로드된 메시지 키 수(0=미로드→전환해도 fallback)
  lsLangKeys: string[] | null;         // localStorage.lang.map 키(활성언어 도출원)
  activeIsKorean: boolean;
}
export async function readMobileI18n(page: Page): Promise<MobileI18nState> {
  const raw = await page.evaluate(({ koCodes }) => {
    const res: any = { hasI18n: false, locale: null, available: [], msgCounts: {}, lsLangKeys: null };
    try {
      const L = JSON.parse(localStorage.getItem('lang') || '{}');
      res.lsLangKeys = L?.map ? Object.keys(L.map) : null;
    } catch { /* */ }
    try {
      const app: any = (document.querySelector('#app') as any)?.__vue_app__;
      const i18n = app?.config?.globalProperties?.$i18n;
      if (i18n) {
        res.hasI18n = true;
        res.locale = i18n.locale?.value ?? i18n.locale ?? null;
        res.available = i18n.availableLocales || [];
        for (const lc of res.available) {
          try { res.msgCounts[lc] = Object.keys(i18n.getLocaleMessage(lc) || {}).length; } catch { res.msgCounts[lc] = 0; }
        }
      }
    } catch { /* */ }
    res.activeIsKorean = koCodes.includes(String(res.locale)) || (res.lsLangKeys?.length === 1 && koCodes.includes(res.lsLangKeys[0]));
    return res;
  }, { koCodes: KO_CODES }).catch(() => null);
  return raw || { hasI18n: false, locale: null, available: [], msgCounts: {}, lsLangKeys: null, activeIsKorean: false };
}

// ── 런타임 로케일 전환 — 비파괴(클라이언트 i18n 상태만) ─────────────────────────
//   ⚠ 이 앱 i18n(vue-i18n v9 추정)은 getLocaleMessage()가 0을 반환해도 실제 렌더는 정상 → **사전 로드 판정은
//     `availableLocales` 멤버십으로**(msgCount 게이트 폐기, 2026-09-15 태국어 실측 오차단 수정). $i18n 과 $i18n.global
//     양쪽 핸들에 로케일 설정(composition/legacy 대응). 런타임 반응성 여부는 caller가 캡처 비교로 판정.
export interface SwitchResult { ok: boolean; code: string | null; why: string; avail?: string[] }
async function setMobileLocale(page: Page, codes: string[]): Promise<SwitchResult> {
  return await page.evaluate(({ codes }) => {
    const out: any = { ok: false, code: null, why: '' };
    const app: any = (document.querySelector('#app') as any)?.__vue_app__;
    const root: any = app?.config?.globalProperties?.$i18n;
    if (!root) { out.why = 'Vue i18n 미노출'; return out; }
    const handles = [root, root.global].filter(Boolean);
    const avail: string[] = Array.from(new Set(handles.flatMap((h: any) => h.availableLocales || [])));
    out.avail = avail;
    let lsMap: any = {};
    try { lsMap = (JSON.parse(localStorage.getItem('lang') || '{}')?.map) || {}; } catch { /* */ }
    // 대상 코드: availableLocales 우선, 없으면 lang.map 키.
    let picked: string | null = codes.find((c) => avail.includes(c)) || codes.find((c) => lsMap[c] && Object.keys(lsMap[c] || {}).length) || null;
    if (!picked) { out.why = `로케일 미등록(available=[${avail.join(',')}] · lang.map=[${Object.keys(lsMap).join(',')}] · 후보 ${codes.join('/')})`; return out; }
    // lang.map에만 있으면 등록 주입(모든 핸들).
    if (!avail.includes(picked) && lsMap[picked]) { for (const h of handles) { try { h.setLocaleMessage?.(picked, lsMap[picked]); } catch { /* */ } } }
    for (const h of handles) { try { if (h.locale && typeof h.locale === 'object' && 'value' in h.locale) h.locale.value = picked; else h.locale = picked; } catch { /* */ } }
    out.ok = true; out.code = picked; return out;
  }, { codes }).catch((e) => ({ ok: false, code: null, why: 'evaluate 예외: ' + String(e) }));
}

// 대상 언어로 전환(availableLocales 기반). 반환 SwitchResult.
export async function switchMobileLangRuntime(page: Page, lang: CourseLang): Promise<SwitchResult> {
  const r = await setMobileLocale(page, LANG_CODE_CANDIDATES[lang.ko] || []);
  if (r.ok) await settle(page, 900);
  return r;
}

// 한국어로 전환(availableLocales 기반, 다중 핸들). KO 기준 캡처 직전 사용.
export async function restoreMobileKorean(page: Page): Promise<void> {
  await setMobileLocale(page, KO_CODES);
  await settle(page, 900);
}

// ── 모바일 시스템 텍스트 슬롯 캡처 ────────────────────────────────────────────
//   ⚠ 데스크톱 captureSlots(SCAN_ZONES)는 데스크톱 DOM 전용 → 모바일 전용 캡처 신설.
//   보수적(가짜 FAIL 방지, report-standard): **시스템 chrome만** — 제목(.fs-20)·버튼(.button-common 텍스트)·
//   필터칩·필드 라벨(짧은 회색 라벨). 데이터(카드 본문·리스트 행·뱃지값·입력값·인명/날짜/숫자행·[소유자]태그)는 제외.
//   KO↔FG 매칭키 = zone|domPath(요소 고유경로) — 번역은 텍스트만 바꿔 경로 불변(데스크톱 원리 동일).
// 동일 KO 텍스트 중복 제거(zone 다른 같은 라벨 반복 노이즈 차단 — 번역은 텍스트 단위라 1건이면 충분).
function dedupByText(slots: Slot[]): Slot[] {
  const seen = new Set<string>(); const out: Slot[] = [];
  for (const s of slots) { if (seen.has(s.text)) continue; seen.add(s.text); out.push(s); }
  return out;
}

export async function captureMobileSlots(page: Page, rootSel?: string, keepDatepicker = false): Promise<Slot[]> {
  return await page.evaluate(({ rootSel, keepDatepicker }) => {
    // rootSel 지정 시 그 컨테이너(오버레이/모달/캘린더) 내부만 스캔 — 딥 인터랙션 전용. keepDatepicker: 캘린더 검증 시 datepicker 제외 해제.
    const roots: Element[] = rootSel ? Array.from(document.querySelectorAll(rootSel)) : [document.body];
    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      if (r.width <= 1 && r.height <= 1) return false;
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    // 데이터/사용자 컨텐츠 조상 제외.
    // ⚠ `[class*="row"]` 제거(2026-09-15 프로브): 앱의 **layout-row-* 유틸 클래스**를 매칭해 설명문구·요약·서브페이지
    //   콘텐츠를 통째로 과다제외 → 타일 메뉴만 남아 전 화면 반복됐음. 데이터 행은 list-item/tbody + looksData(숫자)로 제외.
    // ⚠ badge 제외에서 **badge-content 예외**(2026-09-27 구조진단): 상세 상단 라벨(작업명/종류/상태/분류/월간계획)이
    //   span.fs-16 < div.badge-content(회색 칩)로 렌더 → 기존 [class*="badge"]가 라벨 칩을 값 배지로 오인해 통째 제외.
    //   badge-content(라벨/enum 칩)는 시스템 텍스트라 유지, 그 외 값 배지만 제외.
    const EXCL = ['input', 'textarea', 'table', 'tbody', '[class*="badge"]:not([class*="badge-content"])', '.vs__selected', '.vs__dropdown-menu',
      '[class*="list-item"]', '[class*="list__item"]', ...(keepDatepicker ? [] : ['[class*="datepicker"]'])];
    // ⚠ **데이터 카드 제외**(2026-09-15 프로브): 리스트 카드는 사용자 데이터(작업제목·이름·뱃지). bd-dde3ec/bdr-12 는
    //   랜딩 타일에도 쓰여 class로는 구분 불가 → **핵심 구분자 = 날짜(YYYY-MM-DD/YYYY.MM.DD)를 담은 카드만 데이터**
    //   (시스템 chrome·랜딩 타일은 날짜 없음). 날짜 품은 테두리 카드 하위 전부 제외 → 오탐(작업제목 FAIL) 근본 차단.
    const DATE_RE = /\d{4}[-.]\d{2}[-.]\d{2}/;
    const dataCards = (Array.from(document.querySelectorAll('[class*="bd-dde3ec"], [class*="bdr-12"], [class*="card"]')) as HTMLElement[])
      .filter((c) => DATE_RE.test(c.innerText || ''));
    // ⚠ **작업 카드 시스템 chrome 커버(2026-09-16, 사용자: 작업 카드 영역 미검증)**: 이전엔 날짜보유 카드를 통째 제외 →
    //   조장/지시/상태 필드라벨·단일/반복 뱃지·상태 enum(완료 확정…) 같은 **시스템 텍스트도 함께 소실**. 개선: 카드를 통째
    //   제외하지 않고 **데이터(작업명 제목·인명·날짜·수량)만** 제외. 카드 **제목=카드 내 최대 폰트 leaf**(사용자 입력 작업명)를
    //   cardTitles 로 지목 제외. 나머지 데이터는 looksData(날짜·[태그]·계정ID)·nearPersonLabel(인명값)이 담당.
    //   (report-standard: 데이터 오탐 방지 ↔ 사용자 요청 카드 chrome 커버의 절충 — 잔여 오탐은 사용자 플래그로 조정)
    const cardTitles = new Set<Element>();
    for (const c of dataCards) {
      let best: Element | null = null; let bestPx = 0;
      for (const el of Array.from(c.querySelectorAll('*'))) {
        const h = el as HTMLElement;
        if (h.children.length && !Array.from(h.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim())) continue;  // leaf/ownText만
        const t = (h.innerText || '').trim(); if (!t || t.length > 90) continue;
        const px = parseFloat(getComputedStyle(h).fontSize) || 0;
        if (px > bestPx) { bestPx = px; best = el; }   // 최대 폰트 = 카드 제목(작업명)
      }
      if (best) cardTitles.add(best);
    }
    const inExcl = (el: Element) => EXCL.some((s) => el.closest(s)) || cardTitles.has(el);
    const inDataCard = (el: Element) => dataCards.some((c) => c.contains(el));
    const domPath = (el: Element): string => {
      const parts: string[] = []; let node: Element | null = el; let depth = 0;
      while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML' && depth < 14) {
        let seg = node.tagName.toLowerCase(); const p: Element | null = node.parentElement;
        if (p) { const same = Array.from(p.children).filter((c) => c.tagName === node!.tagName); if (same.length > 1) seg += `:nth-of-type(${same.indexOf(node) + 1})`; }
        parts.unshift(seg); node = node.parentElement; depth++;
      }
      return parts.join('>');
    };
    // 데이터 텍스트 휴리스틱: **매우 길거나(≥90, 설명문구는 통과)** · 숫자군 2+(날짜/수량 행) · 소유자태그 ·
    //   계정ID(밑줄결합 예 전영신_마스터1) → 제외. (설명문구 "드론 촬영된 코스상태…"는 시스템 텍스트라 포함)
    const looksData = (t: string) => t.length >= 90 || (t.match(/\d+/g) || []).length >= 2 || /\[[가-힣a-z]{1,3}\]/i.test(t)
      || /[가-힣A-Za-z0-9]_[가-힣A-Za-z0-9]/.test(t) || /(마스터|관리자|master|admin|매니저)\s*\d*$/i.test(t)
      || /^킹즈락(\s|$)/.test(t) || /(^|\s)QA(\s|$)/.test(t)   // 골프장명(킹즈락)·계정팀(QA) = 환경/사용자 정보 제외
      // ⚠ **위치(코스-홀) 데이터 제외(2026-09-17 일본어 오탐)**: "그린 [East #-러프] (East #번홀)"·"티박스 [East 티박스]"
      //   처럼 대괄호 태그·홀번호·코스명(East/South/West/North)을 담은 것 = 위치 인스턴스 데이터(시스템 enum 아님).
      || /\[.+\]/.test(t) || /번\s*홀|#번홀/.test(t) || /\b(East|South|West|North)\b/.test(t);
    // ── **전수 캡처(2026-09-16, 사용자: "화면 노출 모든 구성요소")**: 특정 class zone만 보던 방식 폐기 →
    //   **직접 텍스트를 담은 모든 가시 요소**를 잡고 데이터만 제외. 섹션제목·필드라벨·빈상태메시지·안내문구·버튼·enum 전수.
    //   zone은 표기용으로만 추론(버튼/입력라벨/텍스트).
    const slots: { key: string; zone: string; text: string; clip: boolean; ell: boolean }[] = [];
    const seen = new Set<string>();
    // '직접 텍스트 노드'를 가진 요소만(순수 컨테이너 제외) — 부모/자식 중복 방지 + 라벨·제목·문장 포착.
    const ownText = (el: Element) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
    const zoneOf = (el: Element): string => {
      if (el.closest('button, .button-common, [role="button"], .check-wrap')) return '버튼/선택';
      if (el.matches('label, dt, [class*="label"]')) return '입력라벨';
      if (/^(h\d|strong)$/i.test(el.tagName) || (el as HTMLElement).matches('.fs-20, .fs-18')) return '제목';
      return '텍스트';
    };
    // ⚠ **인명 값 제외**(2026-09-16): 조장/조원/등록자 등 인물 라벨 옆 값=사용자 데이터(인명). 라벨 자신은 시스템이라 유지.
    const PERSON_LABELS = ['조장', '조원', '지시', '지시자', '등록자', '담당자', '작업자', '신청자', '작성자', '조치자', '점검자'];
    const nearPersonLabel = (el: Element): boolean => {
      const self = ((el as HTMLElement).innerText || '').trim();
      if (PERSON_LABELS.includes(self)) return false;   // 라벨 자신은 유지
      let p: Element | null = el.parentElement;
      for (let i = 0; i < 3 && p; i++) {
        const sibs = Array.from(p.children).map((c) => ((c as HTMLElement).innerText || '').trim());
        if (sibs.some((s) => PERSON_LABELS.includes(s))) return true;   // 같은 행/그룹에 인물 라벨 → el은 인명 값
        p = p.parentElement;
      }
      return false;
    };
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (inExcl(el)) continue;
        const he = el as HTMLElement;
        const leaf = he.children.length === 0;
        if (!leaf && !ownText(el)) continue;            // 순수 컨테이너(직접 텍스트 없음) 제외 → 중복 방지
        if (!isVisible(el)) continue;
        const text = (he.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 1 || text.length > 90) continue;   // 90자↑=문단/데이터(looksData가 재차 컷)
        if (looksData(text)) continue;                  // 데이터(날짜·숫자다수·[태그]·계정ID·골프장명) 제외
        if (nearPersonLabel(el)) continue;              // 인물 라벨 옆 인명 값 제외
        // ⚠ 카드 내부 **라벨:값·분류/인스턴스 concat 제외**(2026-09-16 오탐 실측): "브랜드 : 무전기"·"통신선로 / S/K 통신선"
        //   처럼 시스템 라벨/분류 뒤에 사용자 값이 한 노드로 붙은 것=데이터. 순수 enum/라벨(지상·조장·완료 확정·단일)은 구분자 없음.
        if (inDataCard(el) && /[:：]|\//.test(text)) continue;
        const zone = zoneOf(el);
        const key = zone + '|' + domPath(el);
        if (seen.has(key)) continue; seen.add(key);
        let clip = false, ell = false;
        const st = getComputedStyle(he); const overW = he.scrollWidth > he.clientWidth + 2;
        ell = leaf && overW && st.textOverflow === 'ellipsis';
        clip = leaf && overW && (/hidden|clip/.test(st.overflowX) || /hidden|clip/.test(st.overflow)) && st.textOverflow !== 'ellipsis';
        // 숫자 템플릿화(총 #명·#월) — 데이터는 looksData가 raw로 선제외.
        slots.push({ key, zone, text: text.replace(/\d+/g, '#').slice(0, 90), clip, ell });
      }
    }
    // ── 상세 라벨 칩(badge-content) 명시 캡처(2026-09-27 구조진단 확정) — 상단 라벨(작업명/종류/상태/분류/월간계획)이
    //   span.fs-16 < div.badge-content(회색 칩)로, 값 배지 제외 규칙(EXCL [class*=badge])에 걸려 통째 누락됐음.
    //   badge-content = 라벨/enum 시스템 칩 → **inExcl 우회 직접 캡처**(상위 badge 조상 유무 무관). 값·인명·데이터 concat 만 컷.
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll('[class*="badge-content"] *, [class*="badge-content"]'))) {
        const he = el as HTMLElement;
        if (he.children.length) continue;                 // leaf만(칩 텍스트)
        if (!isVisible(el)) continue;
        const text = (he.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 40 || looksData(text)) continue;   // 라벨/짧은 enum만(긴 값·데이터 제외)
        if (nearPersonLabel(el)) continue;
        if (inDataCard(el) && /[:：]|\//.test(text)) continue;
        const zone = zoneOf(el);
        const key = zone + '|' + domPath(el);
        if (seen.has(key)) continue; seen.add(key);
        slots.push({ key, zone, text: text.replace(/\d+/g, '#').slice(0, 40), clip: false, ell: false });
      }
    }
    // ── placeholder(입력 안내문구) 캡처: input/textarea 는 EXCL이지만 placeholder 는 **시스템 텍스트**(검색창·폼 안내).
    //   값(value)이 아닌 placeholder 속성만 → 데이터 아님. 폼/검색 커버리지 확장.
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll('[placeholder]'))) {
        const ph = ((el as HTMLElement).getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
        if (!ph || ph.length > 60 || looksData(ph)) continue;
        const r = (el as HTMLElement).getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) continue;
        const key = 'placeholder|' + domPath(el);
        if (seen.has(key)) continue; seen.add(key);
        slots.push({ key, zone: 'placeholder', text: ph.replace(/\d+/g, '#').slice(0, 120), clip: false, ell: false });
      }
    }
    return slots;
  }, { rootSel, keepDatepicker }).catch(() => [] as Slot[]);
}

// ── 딥 인터랙션: 오버레이(팝업/드롭다운/시트) 열기 → KO↔대상 대조 → 닫기(비파괴) ──────
//   커버리지 확장(사용자 요청): 조건설정·최신순·나의 작업 보기 등 클릭 유발 UI의 다국어 텍스트 검증.
const OVERLAY_SEL = '[class*="modal"], [class*="popup"], [class*="layer"], [class*="bottom-sheet"], [class*="bottomsheet"], [class*="sheet"], [class*="dialog"], [class*="dropdown"], [class*="picker"], [class*="select-list"], [class*="option"]';
const isOverlayOpen = (page: Page) => page.locator(OVERLAY_SEL).filter({ visible: true }).count().then((c) => c > 0).catch(() => false);

// 오버레이 비파괴 닫기 — 취소/닫기 텍스트 → Escape → 바깥(백드롭) 클릭 순.
async function closeOverlay(page: Page): Promise<void> {
  // ⚠ 비파괴: **취소/닫기만**(확인/적용 클릭 금지 — 상태 변경 방지). 없으면 Escape.
  const cancel = page.locator(`${OVERLAY_SEL}`).getByText(/^\s*(취소|닫기)\s*$/).first();
  if (await cancel.count().catch(() => 0) && await cancel.isVisible().catch(() => false)) { await cancel.click({ timeout: 2_000 }).catch(() => {}); }
  else { await page.keyboard.press('Escape').catch(() => {}); }
  await settle(page, 500); await killMobileAlarms(page);
  // 여전히 열려있으면 Escape 재시도.
  if (await isOverlayOpen(page)) { await page.keyboard.press('Escape').catch(() => {}); await settle(page, 400); }
}

// 한 오버레이 검증: openFn(한국어서 열기) → 오버레이 스코프 KO 캡처 → 대상 전환 → FG → applySlotComparison → 닫기.
//   반환 tab = `모바일-${screenLabel}·${openerName}` → 별도 탭. 오버레이 미출현/미대조 시 정직 SKIP.
async function scanOverlay(
  page: Page, lang: CourseLang, screenLabel: string, openerName: string, tcRef: string,
  openFn: () => Promise<boolean>, gSeen: Set<string>,
): Promise<void> {
  const tab = `모바일-${screenLabel}`;   // 부모 탭 편입, sub=오프너명
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${openerName}`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} ${openerName} 팝업 — ${note}` });
  await restoreMobileKorean(page); await settle(page, 300);
  const opened = await openFn();
  if (!opened || !(await isOverlayOpen(page))) { skip(meta('열기'), `${openerName} 오버레이 미출현(트리거 미발견/데이터 의존)`); await closeOverlay(page); return; }
  await settle(page, 500);
  const ko = await captureMobileSlots(page, OVERLAY_SEL);
  if (!ko.length) { skip(meta('캡처'), '오버레이 시스템 슬롯 0'); await closeOverlay(page); return; }
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), `전환 실패: ${sw.why}`); await restoreMobileKorean(page); await closeOverlay(page); return; }
  const fg = await captureMobileSlots(page, OVERLAY_SEL);
  const koByKey = new Map(ko.map((s) => [s.key, s.text]));
  let common = 0, changed = 0;
  for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
  if (common > 0 && changed >= Math.max(1, Math.floor(common * 0.2))) emitMobileComparison(ko, fg, lang, tab, openerName, tcRef, gSeen);
  else skip(meta('대조'), `대상 전환 미반영(공통 ${common}·변경 ${changed})`);
  await restoreMobileKorean(page);
  await closeOverlay(page);
}

// ── 화면 내 버튼→하위화면 크롤러(2026-09-16, 사용자: 버튼 진입 화면 미커버) ─────────
//   현재 도달 화면에서 **뷰형(비파괴 조회) 버튼만** 순회 클릭 → 하위 화면/모달 스캔 → 복귀. 파괴형(저장·삭제·등록·수정) 제외.
//   ⚠ E2E 재사용 설계: "버튼으로 모든 화면 순회"의 뼈대 = E2E 내비 백본. 다국어는 각 도달 화면 대조를 얹음.
const VIEW_BTN = /상세\s*보기|크게\s*보기|일자별|개인별|투입\s*시간|미리\s*보기|더\s*보기|현황|내역/;
//   순수 내비/닫기(항상 제외 — 클릭해도 새 화면 없음, 크롤 흐름만 깸): 취소·닫기·이전·다음·로그아웃·뒤로·홈·확인(다이얼로그는 별도 처리).
const NAV_BTN = /^취소$|^닫기$|^이전$|^다음$|로그아웃|^뒤로$|^홈$|모두 선택/;
//   파괴형(커밋): 저장·삭제·등록하기·완료·수정·제출·적용·초기화·추가. 파괴모드에선 **화면 도달용으로 클릭**하되 커밋 다이얼로그는 취소로 복귀(다국어=화면 텍스트 커버, 되돌릴 수 없는 커밋 회피).
const DESTRUCTIVE_BTN = /저장|삭제|등록하기|^등록$|완료|수정|적용|초기화|제출|보내기|^추가$/;
async function crawlSubButtons(page: Page, lang: CourseLang, tab: string, parentSub: string, tcRef: string, gSeen: Set<string>, destructive: boolean): Promise<void> {
  const cand: string[] = await page.evaluate(({ viewSrc, destSrc, navSrc, destructive }) => {
    const view = new RegExp(viewSrc), dest = new RegExp(destSrc), nav = new RegExp(navSrc);
    const out: string[] = [];
    // ⚠ 후보 = 버튼류 + **클릭 가능한 div/컨테이너**(2026-09-23 사용자: "일자별/개인별 상세 작업시간"이 <div>로 렌더돼
    //   button 셀렉터에서 누락됨). cursor:pointer 또는 button/a/role 인 요소만 → 정적 텍스트 과다매칭 방지.
    const clickable = (el: Element): boolean => {
      if (el.matches('button, .button-common, [role="button"], a')) return true;
      const cls = (el.className || '').toString();
      if (/button|btn|cursor-pointer|clickable/.test(cls)) return true;
      return getComputedStyle(el as HTMLElement).cursor === 'pointer';
    };
    // own-text 리프성(직접 텍스트 보유) — 부모 컨테이너 중복 방지 + "일자별/개인별 상세 작업시간" 박스 포착.
    const ownLeaf = (el: Element): boolean => Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
    for (const el of Array.from(document.querySelectorAll('button, .button-common, [role="button"], a, div, li, span'))) {
      const t = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 24 || nav.test(t)) continue;
      const isView = view.test(t), isDest = destructive && dest.test(t);
      if (!(isView || isDest)) continue;
      // ⚠ 뷰형(VIEW_BTN=제한적 정규식)은 own-text 블록도 후보(클릭은 getByText로 어떤 요소든 동작, 무동작이면 크롤이 skip
      //   기록). 파괴형은 오클릭 위험 커 clickable 요소로 한정. (2026-09-23: "일자별/개인별 상세 작업시간" div 미포착 해소)
      if (isDest && !isView && !clickable(el)) continue;
      if (isView && !clickable(el) && !ownLeaf(el)) continue;
      const r = (el as HTMLElement).getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) continue;
      out.push(t);
    }
    return Array.from(new Set(out)).slice(0, 8);
  }, { viewSrc: VIEW_BTN.source, destSrc: DESTRUCTIVE_BTN.source, navSrc: NAV_BTN.source, destructive }).catch(() => [] as string[]);
  // ⚠ 진단 계측(2026-09-16, 사용자: 나의작업보기 상세 하위화면 미수행) — 각 버튼의 실제 결과(미발견/무동작/열림·대조/슬롯0)를
  //   review에 남겨 "왜 하위화면이 리포트에 안 보이는가"를 다음 런에서 규명. dedup(gSeen)에 눌려 안 보이는 것과 실제 무동작을 구분.
  const diag: string[] = [];
  for (const t of cand) {
    const before = page.url();
    const b = page.getByText(new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)).first();
    if (!(await b.count().catch(() => 0)) || !(await b.isVisible().catch(() => false))) { diag.push(`${t}=미발견`); continue; }
    await b.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 1_300); await killMobileAlarms(page);
    const overlay = await isOverlayOpen(page);
    if (page.url() === before && !overlay) { diag.push(`${t}=무동작(인라인/게이트)`); continue; }   // 새 화면 안 열림
    const sub = `${parentSub}·${t}`.slice(0, 40);
    // ⚠ 오버레이로 감지됐어도 실제 콘텐츠가 OVERLAY_SEL 클래스 밖일 수 있음(2026-09-16 나의작업보기 KO0 실측) →
    //   오버레이 스코프 캡처 0이면 **전체 body 재캡처 폴백**.
    let rootSel = overlay ? OVERLAY_SEL : undefined;
    let ko = await captureMobileSlots(page, rootSel);
    if (!ko.length && overlay) { rootSel = undefined; ko = await captureMobileSlots(page); }   // 오버레이 스코프 미스 → 전체 폴백
    let note = `열림·KO${ko.length}`;
    if (ko.length) {
      const sw = await switchMobileLangRuntime(page, lang);
      if (sw.ok) {
        const fg = await captureMobileSlots(page, rootSel);
        const koByKey = new Map(ko.map((s) => [s.key, s.text]));
        let common = 0, changed = 0;
        for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
        if (common > 0 && changed >= Math.max(1, Math.floor(common * 0.2))) { emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen); note += `·공통${common}·변경${changed}·대조✓`; }
        else note += `·공통${common}·변경${changed}·미반영`;
      } else note += `·전환실패`;
      await restoreMobileKorean(page);
    } else note += `·슬롯0`;
    diag.push(`${t}=${note}`);
    // 복귀: 오버레이(확인 다이얼로그 포함)면 **취소/닫기로** 닫기(커밋 회피), 새 화면이면 뒤로. 여전히 열려있으면 Escape.
    if (overlay) await closeOverlay(page); else { await mobileBack(page); await settle(page, 500); }
    for (let i = 0; i < 2 && (await isOverlayOpen(page)); i++) { await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); }
    await killMobileAlarms(page);
  }
  review({ lang: lang.ko, screen: `${tab} > ${parentSub}`, kind: '버튼 크롤', zone: 'crawl',
    item: `${cand.length}후보${destructive ? '(파괴형 포함)' : ''}`, value: diag.join('  |  ') || '뷰형/파괴형 버튼 후보 없음', screenshot: '' });
}

// 네비게이션형 딥 인터랙션(클릭→새 화면): [나의 작업 보기]·항목→상세 등. 부모 탭 편입, KO↔대상 대조 후 뒤로가기 복귀.
//   crawl=true 면 도달 화면에서 다시 뷰형 버튼 크롤(2단계 중첩 화면 커버).
async function scanNavScreen(
  page: Page, lang: CourseLang, parentLabel: string, subName: string, tcRef: string,
  navFn: () => Promise<boolean>, landingTexts: Set<string>, gSeen: Set<string>, crawl = false, destructive = false,
  ownSeen = false,   // true=상세/나의작업보기: 별도 dedup(기본/등록폼과 겹쳐도 재노출) → 상세 화면 완결 커버리지(사용자 요청)
): Promise<void> {
  // ⚠ 상세 화면은 기본/등록폼과 라벨이 겹쳐 per-screen gSeen 에 눌리면 리포트에 안 보임(2026-09-17 사용자 지적).
  //   ownSeen=true 면 이 서브 전용 Set 으로 emit → 상세의 작업번호·월간계획·작업일시 등이 온전히 노출됨. 크롤은 공유 gSeen 유지.
  const emitSeen = ownSeen ? new Set<string>() : gSeen;
  const tab = `모바일-${parentLabel}`;
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${subName}`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} ${subName} — ${note}` });
  await restoreMobileKorean(page); await settle(page, 300);
  const before = page.url();
  if (!(await navFn())) { skip(meta('진입'), `${subName} 트리거 미발견/데이터 의존`); return; }
  await settle(page, 1_100); await killMobileAlarms(page);
  const moved = page.url() !== before || await isOverlayOpen(page);
  if (!moved) { skip(meta('진입'), `${subName} 화면 전환 없음`); return; }
  let ko = await captureMobileSlots(page);
  if (landingTexts.size) ko = ko.filter((s) => !landingTexts.has(s.text));   // 상주 랜딩 메뉴 제외
  // ▶ 상세 라벨 캡처 자가진단(2026-09-23) — 캡처된 라벨 + **누락 라벨의 실 DOM 구조**(병합/CSS ::before/조상)를 덤프.
  //   자가진단으로 확정: 나의작업보기 상세 53슬롯에 작업명/종류/상태/분류/월간계획 부재 = **캡처 문제**(dedup 아님).
  //   누락 라벨이 leaf 텍스트가 아니라 병합/pseudo인지 구조를 노출 → 캡처 규칙 정밀 보강.
  {
    const koSet = new Set(ko.map((s) => s.text));
    const CAND = ['작업명', '종류', '상태', '분류', '월간계획', '작업번호', '투입 시간', '브랜드', '점검번호', '위치', '중요도'];
    const missing = CAND.filter((w) => !koSet.has(w));
    const struct = await page.evaluate((want) => {
      const out: string[] = [];
      for (const w of want) {
        // textContent 포함(병합 케이스) or ::before/::after content 매칭 요소 탐색.
        const hits = (Array.from(document.querySelectorAll('*')) as HTMLElement[]).filter((el) => {
          const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim();
          if (own === w || own.includes(w)) return true;
          const bef = getComputedStyle(el, '::before').content || ''; const aft = getComputedStyle(el, '::after').content || '';
          return bef.includes(w) || aft.includes(w);
        });
        if (!hits.length) { out.push(`"${w}"=DOM부재(렌더전/데이터)`); continue; }
        const el = hits[0];
        const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').replace(/\s+/g, ' ').trim();
        const bef = (getComputedStyle(el, '::before').content || '').replace(/^"|"$/g, '');
        const cls = (el.className || '').toString().replace(/\s+/g, '.').slice(0, 40);
        const par = el.parentElement; const pcls = par ? (par.className || '').toString().replace(/\s+/g, '.').slice(0, 34) : '';
        const kids = el.children.length;
        out.push(`"${w}"=${el.tagName.toLowerCase()}.${cls}[kids=${kids} own="${own.slice(0, 24)}" before="${bef.slice(0, 16)}"] < ${par?.tagName.toLowerCase()}.${pcls}`);
      }
      return out;
    }, missing).catch(() => [] as string[]);
    review({ lang: lang.ko, screen: `${tab} > ${subName}`, kind: '상세 라벨 캡처 진단', zone: 'capture',
      item: `KO ${ko.length}·누락 ${missing.join('/') || '없음'}`, value: struct.join('  ||  ') || '전 후보 캡처됨', screenshot: '' });
  }
  if (!ko.length) { skip(meta('캡처'), '고유 시스템 슬롯 0(데이터 화면)'); await mobileBack(page); return; }
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), sw.why); await restoreMobileKorean(page); await mobileBack(page); return; }
  let fg = await captureMobileSlots(page);
  if (landingTexts.size) fg = fg.filter((s) => !landingTexts.has(s.text));
  const koByKey = new Map(ko.map((s) => [s.key, s.text]));
  let common = 0, changed = 0;
  for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
  if (common > 0 && changed >= Math.max(1, Math.floor(common * 0.2))) emitMobileComparison(ko, fg, lang, tab, subName, tcRef, emitSeen);
  else skip(meta('대조'), `대상 전환 미반영(공통 ${common}·변경 ${changed})`);
  await restoreMobileKorean(page);
  // 도달 화면(상세/나의작업보기)에서 뷰형(+파괴가드 시 파괴형) 버튼→하위화면 크롤(2단계 중첩 커버). 복귀는 크롤러가 처리.
  // ⚠ 크롤도 emitSeen 사용(2026-09-23): ownSeen 화면은 서브화면(일자별/개인별 상세 작업시간 등)도 전용 Set으로 완결 커버
  //   (기본 화면은 emitSeen===gSeen이라 동작 불변). 서브화면 라벨이 앞 화면 dedup에 눌리지 않음.
  if (crawl) await crawlSubButtons(page, lang, tab, subName, tcRef, emitSeen, destructive);
  await mobileBack(page); await settle(page, 500); await killMobileAlarms(page);
}

// 캘린더 전용 캡처 — 요일(일월화…)/월·년 헤더/AM·PM 등 **짧은 텍스트 leaf**만(숫자 날짜셀 제외). 언어 무관 스크립트 포함.
//   ⚠ 일반 zone 셀렉터(.fs-20 등)로는 요일(span.datepicker-weekday 등)이 안 잡혀 0건 → 캘린더 컨테이너 내부 leaf 텍스트 직접 채취.
async function captureCalendarSlots(page: Page, calSel: string): Promise<Slot[]> {
  return await page.evaluate((calSel) => {
    const domPath = (el: Element): string => {
      const parts: string[] = []; let node: Element | null = el; let depth = 0;
      while (node && node.nodeType === 1 && node.tagName !== 'BODY' && depth < 14) {
        let seg = node.tagName.toLowerCase(); const p: Element | null = node.parentElement;
        if (p) { const same = Array.from(p.children).filter((c) => c.tagName === node!.tagName); if (same.length > 1) seg += `:nth-of-type(${same.indexOf(node) + 1})`; }
        parts.unshift(seg); node = node.parentElement; depth++;
      }
      return parts.join('>');
    };
    const roots = Array.from(document.querySelectorAll(calSel));
    const slots: any[] = []; const seen = new Set<string>();
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if ((el as HTMLElement).children.length) continue;                 // leaf만
        const t = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 15) continue;
        if (/^\d{1,2}$/.test(t)) continue;                                 // 날짜 숫자(데이터) 제외
        if (!/[가-힣A-Za-z฀-๿぀-ヿ一-鿿]/.test(t)) continue;   // 요일/월/AM·PM 등 글자만
        const r = (el as HTMLElement).getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) continue;
        const key = 'cal|' + domPath(el); if (seen.has(key)) continue; seen.add(key);
        slots.push({ key, zone: '달력', text: t.replace(/\d+/g, '#').slice(0, 40), clip: false, ell: false });   // 월/년 숫자 템플릿화(#월)
      }
    }
    return slots;
  }, calSel).catch(() => [] as Slot[]);
}

// 검색 딥 인터랙션 — 헤더 검색 아이콘 클릭 → 검색 입력/UI 노출 → placeholder·라벨 대조. 부모 탭 편입, 비파괴.
//   화면별 gSeen에 base가 이미 들어있어 **검색으로 새로 나타난 것만**(입력 placeholder 등) 기록됨.
async function scanSearch(page: Page, lang: CourseLang, screenLabel: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const tab = `모바일-${screenLabel}`; const sub = '검색';
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${sub}`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 검색 — ${note}` });
  await restoreMobileKorean(page); await settle(page, 300);
  const si = page.locator('i[class*="ico-search"], [class*="search-icon"], [class*="ico-search"], header i[class*="search"], button:has(i[class*="search"])').filter({ visible: true }).first();
  if (!(await si.count().catch(() => 0))) { skip(meta('열기'), '검색 아이콘 미발견(화면에 검색 없음)'); return; }
  await si.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 800); await killMobileAlarms(page);
  const ko = await captureMobileSlots(page);
  if (!ko.length) { skip(meta('캡처'), '검색 UI 슬롯 0'); await page.keyboard.press('Escape').catch(() => {}); return; }
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), sw.why); await restoreMobileKorean(page); await page.keyboard.press('Escape').catch(() => {}); return; }
  const fg = await captureMobileSlots(page);
  const koByKey = new Map(ko.map((s) => [s.key, s.text]));
  let common = 0, changed = 0;
  for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
  if (common > 0 && changed >= Math.max(1, Math.floor(common * 0.2))) emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen);
  else skip(meta('대조'), `대상 전환 미반영(공통 ${common}·변경 ${changed})`);
  await restoreMobileKorean(page);
  await page.keyboard.press('Escape').catch(() => {}); await settle(page, 400); await killMobileAlarms(page);
}

// datepicker(캘린더) 딥 인터랙션 — 요일/월/년 표기의 다국어 검증(로케일 번역 대상). 부모 탭 편입, 비파괴(날짜 선택 안 함).
//   ⚠ 캘린더는 EXCL의 [class*="datepicker"]로 평소 제외됨 → keepDatepicker=true 로 해제하고 캘린더 컨테이너 스코프 캡처.
async function scanDatepicker(page: Page, lang: CourseLang, screenLabel: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const tab = `모바일-${screenLabel}`; const sub = '기간(달력)';
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${sub}`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 달력 — ${note}` });
  const CAL_SEL = '[class*="calendar"], [class*="datepicker-layer"], [class*="datepicker-body"], [class*="picker"], [class*="datepicker"]';
  await restoreMobileKorean(page); await settle(page, 300);
  // 열기: 날짜 필드 클릭(비파괴 — 날짜 셀 선택 안 함, 헤더/요일만 스캔).
  const trig = page.locator('.text-field.datepicker, [class*="datepicker"]:not([class*="layer"])').filter({ visible: true }).first();
  if (!(await trig.count().catch(() => 0))) { skip(meta('열기'), 'datepicker 필드 미발견(화면에 기간 필터 없음)'); return; }
  await trig.click({ timeout: 3_000 }).catch(() => {});
  await settle(page, 900);
  const calVisible = await page.locator(CAL_SEL).filter({ visible: true }).count().then((c) => c > 0).catch(() => false);
  if (!calVisible) { skip(meta('열기'), '캘린더 미출현(트리거 반응 없음)'); await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); return; }
  const ko = await captureCalendarSlots(page, CAL_SEL);
  if (!ko.length) {
    // 캘린더 텍스트 미포착 → 실 구조 프로브(요일/월 요소 tag.class 덤프) 남기고 SKIP.
    const dump = await page.evaluate((sel) => {
      const out: string[] = [];
      for (const root of Array.from(document.querySelectorAll(sel))) for (const el of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
        const t = (el.innerText || '').trim(); if (t && t.length < 12 && el.children.length === 0 && !/^\d+$/.test(t)) out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().replace(/\s+/g, '.').slice(0, 35)}="${t}"`);
      }
      return Array.from(new Set(out)).slice(0, 12);
    }, CAL_SEL).catch(() => [] as string[]);
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '캘린더 DOM 프로브', zone: 'capture', item: `${dump.length}후보`, value: dump.join(' | '), screenshot: '' });
    skip(meta('캡처'), '캘린더 요일/월 텍스트 미포착(프로브 참조)'); await page.keyboard.press('Escape').catch(() => {}); return;
  }
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), sw.why); await restoreMobileKorean(page); await page.keyboard.press('Escape').catch(() => {}); return; }
  const fg = await captureCalendarSlots(page, CAL_SEL);
  const koByKey = new Map(ko.map((s) => [s.key, s.text]));
  let common = 0, changed = 0;
  for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
  if (common > 0 && changed >= Math.max(1, Math.floor(common * 0.2))) emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen);
  else skip(meta('대조'), `대상 전환 미반영(공통 ${common}·변경 ${changed}) — 캘린더 요일/월 표기 확인 필요`);
  await restoreMobileKorean(page);
  await page.keyboard.press('Escape').catch(() => {}); await settle(page, 400); await killMobileAlarms(page);
  for (let i = 0; i < 2 && (await isOverlayOpen(page)); i++) { await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); }
}

// 공백 무시 텍스트 클릭 — 버튼 라벨의 화면 공백 가변("작업 지시 등록"↔"작업지시 등록") 대응(2026-09-16 등록폼 SKIP 근본원인).
async function clickByTextFlex(page: Page, text: string): Promise<boolean> {
  const norm = (s: string) => (s || '').replace(/\s+/g, '');
  const want = norm(text);
  const loc = page.locator('button, .button-common, [role="button"], a').filter({ visible: true });
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const t = await loc.nth(i).innerText().catch(() => '');
    if (norm(t) === want || (want.length >= 3 && norm(t).includes(want))) { await loc.nth(i).click({ timeout: 3_000 }).catch(() => {}); return true; }
  }
  // 폴백: 텍스트 노드(버튼 아닌 클릭 요소) — 공백을 \s* 로 완화.
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const bt = page.getByText(new RegExp(`^\\s*${esc}\\s*$`)).first();
  if ((await bt.count().catch(() => 0)) && (await bt.isVisible().catch(() => false))) { await bt.click({ timeout: 3_000 }).catch(() => {}); return true; }
  return false;
}

// 등록 폼 딥 인터랙션(2026-09-16, 사용자: [작업지시 등록] 화면·[<] 모달 미검증) — 공백무시 [등록] 클릭 → 폼 스캔 →
//   [<] 뒤로 → "작업중이던 내용을 취소하시겠습니까?" 확인모달 스캔 → [예]로 종료. **비파괴**(입력 안 함=빈 폼 취소, 데이터 무변경).
async function scanRegForm(
  page: Page, lang: CourseLang, screenLabel: string, regText: string, tcRef: string,
  landingTexts: Set<string>, gSeen: Set<string>,
): Promise<void> {
  const tab = `모바일-${screenLabel}`;
  const meta = (s: string, note: string): CheckMeta => ({ path: `${tab} > ${s}`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} ${s} — ${note}` });
  const cmp = (ko: Slot[], fg: Slot[], sub: string, note: string): void => {
    const m = new Map(ko.map((s) => [s.key, s.text]));
    let c = 0, ch = 0;
    for (const f of fg) { if (m.has(f.key)) { c++; if (m.get(f.key) !== f.text) ch++; } }
    if (c > 0 && ch >= Math.max(1, Math.floor(c * 0.2))) emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen);
    else skip(meta(sub, note), `대상 전환 미반영(공통 ${c}·변경 ${ch})`);
  };
  await restoreMobileKorean(page); await settle(page, 300);
  const before = page.url();
  const baseTitles = await headerTitles(page);   // 폼 오픈 전 헤더(스택 back 스코프용 — 프론트 폼 헤더 식별)
  if (!(await clickByTextFlex(page, regText))) { skip(meta('등록폼', '진입'), '등록폼 트리거 미발견/데이터 의존'); return; }
  await settle(page, 1_100); await killMobileAlarms(page);
  if (page.url() === before && !(await isOverlayOpen(page))) { skip(meta('등록폼', '진입'), '등록폼 화면 전환 없음'); return; }
  // 1) 폼 스캔(필드라벨·placeholder·라디오/체크·섹션·버튼·안내문구).
  let ko = await captureMobileSlots(page);
  if (landingTexts.size) ko = ko.filter((s) => !landingTexts.has(s.text));
  if (ko.length) {
    const sw = await switchMobileLangRuntime(page, lang);
    if (sw.ok) {
      let fg = await captureMobileSlots(page);
      if (landingTexts.size) fg = fg.filter((s) => !landingTexts.has(s.text));
      cmp(ko, fg, '등록폼', '대조');
    } else skip(meta('등록폼', '대상 렌더'), sw.why);
    await restoreMobileKorean(page);
  } else skip(meta('등록폼', '캡처'), '폼 시스템 슬롯 0');
  // 1.5) 폼 내 딥(2026-09-17, 사용자: ? 툴팁·작업분류 드롭다운 누락) — 폼이 열린 상태에서 도움말 툴팁·드롭다운 옵션 스캔(비파괴).
  await scanTooltips(page, lang, tab, '등록폼', tcRef, gSeen);
  await scanSelectOptions(page, lang, tab, '등록폼', tcRef, gSeen);
  // 2) [<] 뒤로 → 취소 확인 모달 스캔 → [예]로 종료(비파괴).
  //   ⚠ 딥 인터랙션 확정 반영(2026-09-23): ① 빈 폼은 변경감지(dirty) 없어 back 시 모달 미출현 → 첫 입력에 값 타이핑
  //   (input/change 강제 dispatch)해 dirty 유발(값은 [예]로 폐기=비파괴). ② back은 스택 뒤 리스트 레이어 오클릭 방지 위해
  //   프론트(폼) 헤더행으로 스코프(clickFrontLayerBack). 이전 ico-arrow-prev.first()는 랜딩 이탈로 모달 놓침.
  const backSub = '등록폼·취소확인';
  const dirtyInp = page.locator('textarea, input.item-content, input[placeholder*="제목"], input[placeholder*="내용"], input[placeholder]').filter({ visible: true }).first();
  if (await dirtyInp.count().catch(() => 0)) {
    await dirtyInp.click({ timeout: 2_000 }).catch(() => {});
    await dirtyInp.pressSequentially('E2E취소검증', { delay: 30 }).catch(() => {});
    await dirtyInp.evaluate((el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }).catch(() => {});
    await page.keyboard.press('Tab').catch(() => {});
    await settle(page, 400);
  }
  const backOk = await clickFrontLayerBack(page, baseTitles);
  if (!backOk) {
    const back = page.locator('i[class*="ico-arrow-prev"], [class*="arrow-prev"], header i[class*="prev"], [class*="back"]').filter({ visible: true }).first();
    if (await back.count().catch(() => 0)) await back.click({ timeout: 3_000 }).catch(() => {});
  }
  {
    await settle(page, 900); await killMobileAlarms(page);
    const confirmTxt = await page.getByText(/취소하시겠|나가시겠|저장하시겠|변경.*취소|삭제하시겠/).first().isVisible().catch(() => false);
    const overlay = await isOverlayOpen(page);
    if (overlay || confirmTxt) {
      const rootSel = overlay ? OVERLAY_SEL : undefined;
      const kc = await captureMobileSlots(page, rootSel);
      if (kc.length) {
        const sw2 = await switchMobileLangRuntime(page, lang);
        if (sw2.ok) { const fc = await captureMobileSlots(page, rootSel); cmp(kc, fc, backSub, '대조'); }
        else skip(meta(backSub, '대상 렌더'), sw2.why);
        await restoreMobileKorean(page);
      } else {
        // 확인모달이 OVERLAY_SEL로 안 잡힘 → 실 구조 프로브(다음 이터레이션 셀렉터 보정용) 남기고 SKIP.
        const dump = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => /취소하시겠|나가시겠/.test((e as HTMLElement).innerText || '') && (e as HTMLElement).children.length <= 3).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().replace(/\s+/g, '.').slice(0, 40)}`)).catch(() => [] as string[]);
        review({ lang: lang.ko, screen: `${tab} > ${backSub}`, kind: '확인모달 DOM 프로브', zone: 'capture', item: `${dump.length}후보`, value: dump.join(' | '), screenshot: '' });
        skip(meta(backSub, '캡처'), '확인 모달 슬롯 0(프로브 참조)');
      }
      // [예]/[확인]으로 폼 종료(입력 없어 비파괴). 없으면 Escape.
      const yes = page.locator(overlay ? OVERLAY_SEL : 'body').getByText(/^\s*(예|확인)\s*$/).first();
      if ((await yes.count().catch(() => 0)) && (await yes.isVisible().catch(() => false))) await yes.click({ timeout: 2_000 }).catch(() => {});
      else await page.keyboard.press('Escape').catch(() => {});
      await settle(page, 700);
    } else {
      skip(meta(backSub, '출현'), '[<] 후 취소 확인 모달 미출현(폼 변경감지 없음/바로 종료)');
    }
  }
  await restoreMobileKorean(page); await killMobileAlarms(page);
}

// ── 딥: `?` 도움말 툴팁 스캐너(2026-09-17, 사용자: ? 버튼 툴팁 전체 누락) ──────────
//   화면/폼 내 물음표 도움말 아이콘을 순회 클릭 → 노출 툴팁 텍스트 KO↔대상 대조 → 닫기(비파괴).
//   ⚠ 셀렉터 미확정 → 후보 광범위(아이콘 class + 텍스트 '?') + 미발견/미출현 시 DOM 프로브(관찰 시트)로 실 구조 노출.
const TOOLTIP_SEL = '[class*="tooltip"], [class*="popover"], [class*="help-layer"], [class*="guide-layer"], [class*="hint"], [role="tooltip"]';
async function scanTooltips(page: Page, lang: CourseLang, tab: string, sub: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${sub}·툴팁`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 툴팁 — ${note}` });
  await restoreMobileKorean(page); await settle(page, 200);
  const trig = page.locator('i[class*="question"], i[class*="help"], i[class*="ico-info"], [class*="ico-question"], [class*="tooltip-btn"], [class*="help-btn"], button:has(i[class*="question"])').filter({ visible: true });
  let n = await trig.count().catch(() => 0);
  // 폴백: 텍스트가 정확히 '?' 인 작은 클릭 요소.
  const qMark = page.getByText(/^\?$/).filter({ visible: true });
  const nq = await qMark.count().catch(() => 0);
  if (!n && !nq) {
    // 프로브: 화면에 도움말 후보 자체가 없음(구조 확인).
    const dump = await page.evaluate(() => Array.from(document.querySelectorAll('i, [class*="ico"]')).filter((e) => /q|help|info|hint/i.test((e.className || '').toString()) && (e as HTMLElement).offsetParent).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().replace(/\s+/g, '.').slice(0, 40)}`)).catch(() => [] as string[]);
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '툴팁 DOM 프로브', zone: 'tooltip', item: '트리거 0', value: dump.length ? dump.join(' | ') : '도움말/? 아이콘 후보 없음', screenshot: '' });
    return;
  }
  const total = Math.min((n || 0) + (nq || 0), 6);
  for (let i = 0; i < total; i++) {
    const el = i < n ? trig.nth(i) : qMark.nth(i - n);
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.click({ timeout: 2_500 }).catch(() => {}); await settle(page, 600);
    const tip = page.locator(TOOLTIP_SEL).filter({ visible: true }).first();
    if (!(await tip.count().catch(() => 0))) {
      // 툴팁이 별도 컨테이너가 아닐 수 있음(인라인 span) → 프로브 후 Escape.
      const dump = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => /반복작업|의미합니다|참고|안내|입력할 수/.test((e as HTMLElement).innerText || '') && (e as HTMLElement).children.length <= 2).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().replace(/\s+/g, '.').slice(0, 40)}`)).catch(() => [] as string[]);
      if (dump.length) review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '툴팁 DOM 프로브', zone: 'tooltip', item: `트리거#${i} 컨테이너 미포착`, value: dump.join(' | '), screenshot: '' });
      await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); continue;
    }
    const ko = await captureMobileSlots(page, TOOLTIP_SEL);
    if (ko.length) {
      const sw = await switchMobileLangRuntime(page, lang);
      if (sw.ok) {
        const fg = await captureMobileSlots(page, TOOLTIP_SEL);
        const m = new Map(ko.map((s) => [s.key, s.text])); let c = 0, ch = 0;
        for (const f of fg) { if (m.has(f.key)) { c++; if (m.get(f.key) !== f.text) ch++; } }
        if (c > 0) emitMobileComparison(ko, fg, lang, tab, `${sub}·툴팁`, tcRef, gSeen);
        else skip(meta('대조'), `툴팁 공통 슬롯 0(변경 ${ch})`);
      } else skip(meta('대상 렌더'), sw.why);
      await restoreMobileKorean(page);
    }
    // 닫기(비파괴): 트리거 재클릭/Escape/바깥.
    await page.keyboard.press('Escape').catch(() => {}); await settle(page, 250);
    if (await page.locator(TOOLTIP_SEL).filter({ visible: true }).count().catch(() => 0)) { await page.mouse.click(5, 5).catch(() => {}); await settle(page, 200); }
  }
  await killMobileAlarms(page);
}

// ── 딥: vue-select 드롭다운 옵션 스캐너(2026-09-17, 사용자: 작업 분류 드롭리스트 누락) ──
//   .v-select 토글을 순회 열어 옵션 리스트를 캡처. ⚠ **작업 분류 옵션(그린 예초·티박스 등)은 다국어 번역 대상**
//   (사용자 확정 2026-09-17) → 데이터 아님. 대상 전환 반영 시 KO↔대상 대조(PASS/FAIL, 한글잔존=미번역 결함).
//   전환 미반영(런타임 리렌더 실패) 시엔 **데이터로 오판 금지** → 정직 SKIP(재시도/재로그인 필요, 진단 기록).
async function scanSelectOptions(page: Page, lang: CourseLang, tab: string, sub: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${sub}·드롭다운`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 드롭다운 — ${note}` });
  await restoreMobileKorean(page); await settle(page, 200);
  const toggles = page.locator('.v-select .vs__dropdown-toggle, .vs__dropdown-toggle').filter({ visible: true });
  const n = Math.min(await toggles.count().catch(() => 0), 5);
  if (!n) return;
  // 열린 드롭다운의 옵션 텍스트 리스트 채취(li innerText).
  const readOpts = async (): Promise<string[]> => page.evaluate(() =>
    Array.from(document.querySelectorAll('.vs__dropdown-menu li, .vs__dropdown-option, li[role="option"]'))
      .filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1; })
      .map((e) => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30)).catch(() => [] as string[]);
  // ⚠ **위치/데이터 옵션 제외(2026-09-17 일본어 오탐)**: 작업분류(그린/티박스)는 번역대상이나, 코스/홀 위치 옵션
  //   ("그린 [East #-러프] (East #번홀)")은 **데이터 인스턴스**(홀 위치) → 대괄호태그·번홀·코스명 담은 옵션은 감산.
  const isDataOpt = (t: string): boolean => /\[.+\]/.test(t) || /번\s*홀|#번홀/.test(t) || /\b(East|South|West|North)\b/.test(t) || (t.match(/\d+/g) || []).length >= 2 || t.length >= 90;
  for (let i = 0; i < n; i++) {
    const tg = toggles.nth(i);
    if (!(await tg.isVisible().catch(() => false))) continue;
    await tg.click({ timeout: 2_500 }).catch(() => {}); await settle(page, 600);
    let koOpts = await readOpts();
    const sw = await switchMobileLangRuntime(page, lang);
    let fgOpts = sw.ok ? await readOpts() : [];
    await restoreMobileKorean(page);
    // 데이터 옵션(위치 인스턴스) 감산 — koOpts 기준으로 index 정렬 유지하며 양쪽 동시 제거.
    { const keep: number[] = []; for (let k = 0; k < koOpts.length; k++) if (!isDataOpt(koOpts[k])) keep.push(k);
      koOpts = keep.map((k) => koOpts[k]); fgOpts = keep.map((k) => fgOpts[k] ?? ''); }
    if (!koOpts.length) { await page.keyboard.press('Escape').catch(() => {}); await settle(page, 250); continue; }
    // 반응성 판정: 같은 인덱스 옵션이 바뀌었는가.
    let changed = 0; const cmpLen = Math.min(koOpts.length, fgOpts.length);
    for (let k = 0; k < cmpLen; k++) if (koOpts[k] !== fgOpts[k]) changed++;
    const reactive = cmpLen > 0 && changed >= Math.max(1, Math.floor(cmpLen * 0.2));
    if (reactive) {
      // 시스템 번역 옵션 → KO↔대상 대조(PASS/FAIL). 한글원문만.
      const koSlots: Slot[] = koOpts.map((t, k) => ({ key: `opt|${i}|${k}`, zone: '드롭다운옵션', text: t.replace(/\d+/g, '#').slice(0, 60), clip: false, ell: false }));
      const fgSlots: Slot[] = fgOpts.map((t, k) => ({ key: `opt|${i}|${k}`, zone: '드롭다운옵션', text: t.replace(/\d+/g, '#').slice(0, 60), clip: false, ell: false }));
      emitMobileComparison(koSlots, fgSlots, lang, tab, `${sub}·드롭다운`, tcRef, gSeen);
    } else {
      // ⚠ 옵션은 번역 대상(사용자 확정) → 반영 안 됨은 데이터가 아니라 **런타임 리렌더 실패** → 정직 SKIP + 진단.
      skip(meta(`드롭다운#${i + 1} 대조`), `옵션 전환 미반영(공통 ${cmpLen}·변경 ${changed}) — 런타임 리렌더 실패, 재시도/재로그인 필요`);
      review({ lang: lang.ko, screen: `${tab} > ${sub}·드롭다운#${i + 1}`, kind: '드롭다운 옵션(리렌더 미반영)', zone: 'select',
        item: `${koOpts.length}옵션·반응성X`, value: koOpts.slice(0, 12).join(' / '), screenshot: '' });
    }
    await page.keyboard.press('Escape').catch(() => {}); await settle(page, 250);
    if (await page.locator('.vs__dropdown-menu').filter({ visible: true }).count().catch(() => 0)) { await page.mouse.click(5, 5).catch(() => {}); await settle(page, 200); }
  }
  await killMobileAlarms(page);
}

// ── 누락 오라클 ①: FG(대상언어) 한글 잔존 스캔(2026-09-17, 사용자: 누락 자가검출) ──────
//   ⚠ 원리: 대상언어 모드에서 UI가 정상이면 대상언어여야 함 → **한글이 남아있다 = 놓친 시스템 텍스트 OR 미번역**.
//     언어 전환 자체를 오라클로 사용 → 사람이 화면 실물과 대조할 필요 없이 누락을 기계 검출.
//   ⚠ 데이터 제외: 작업명·인명·골프장명은 대상 모드에서도 한글이 정상(번역대상 아님) → 데이터 감산 후 남은 것만 후보.
//   ⚠ accountedKo(이미 검증/캡처한 KO 텍스트 + 랜딩)에 매칭되면 제외 → **한 번도 안 잡힌 한글**만 = 순수 누락.
//   판정 아님(관찰 시트 '누락 후보') — 사람은 전체가 아니라 이 짧은 목록만 검토.
async function auditForeignHangulResidue(page: Page, lang: CourseLang, tab: string, sub: string, tcRef: string, accountedKo: Set<string>): Promise<void> {
  // page 는 **대상언어(FG) 모드** 상태에서 호출. 가시 leaf/ownText 중 한글 포함 + 데이터 제외 전수 채취.
  const residue: { text: string; hint: string }[] = await page.evaluate(() => {
    const HAN = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
    const isVis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const st = getComputedStyle(el as HTMLElement); return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const DATE = /\d{4}[-.]\d{2}[-.]\d{2}/;
    const dataCards = (Array.from(document.querySelectorAll('[class*="bd-dde3ec"], [class*="bdr-12"], [class*="card"]')) as HTMLElement[]).filter((c) => DATE.test(c.innerText || ''));
    const inDataCard = (el: Element) => dataCards.some((c) => c.contains(el));
    // 데이터 휴리스틱(captureMobileSlots와 동일 계열): 길이≥120·숫자2+·[태그]·밑줄ID·킹즈락/QA·위치(코스-홀).
    const looksData = (t: string) => t.length >= 120 || (t.match(/\d+/g) || []).length >= 2 || /\[[가-힣a-z]{1,3}\]/i.test(t)
      || /[가-힣A-Za-z0-9]_[가-힣A-Za-z0-9]/.test(t) || /(마스터|관리자|master|admin|매니저)\s*\d*$/i.test(t) || /^킹즈락(\s|$)/.test(t) || /(^|\s)QA(\s|$)/.test(t)
      || /\[.+\]/.test(t) || /번\s*홀|#번홀/.test(t) || /\b(East|South|West|North)\b/.test(t);
    // ⚠ **한국어 인명 제외(2026-09-17)**: FG(대상언어) 모드라 nearPerson(한국어 라벨 '조장')이 번역 라벨(組長) 옆
    //   인명(전영신·강빛찬)을 못 걸름 → 성씨+1~3자 무공백 토큰을 인명으로 배제(전체/조건 등 시스템어는 accountedKo가 이미 보호).
    const SURNAME = '김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구민류';
    const SYSWORD = /(정보|관리|전체|설정|점검|작업|장비|자재|시설|이슈|등록|상태|분류|조건|자동|입고|확정|완료|진행|대기|반복|단일)/;
    const looksName = (t: string) => new RegExp(`^[${SURNAME}][가-힣]{1,3}$`).test(t) && !SYSWORD.test(t);
    // 계정/기기/파편/문장형 데이터 배제 — audit 전용(시스템어는 accountedKo가 보호).
    const looksAccount = (t: string) => /^[ㄱ-ㅎㅏ-ㅣ\s]+$/.test(t)                    // 자모 파편(ㅀㄹㅇㅎ)
      || /아이폰|안드|갤럭시|외부|마스터|관리자|경선|사용자|테스트/.test(t)            // 기기/계정/테스트명(사용자나연2)
      || (/^킹즈락/.test(t) && !SYSWORD.test(t))                                        // 킹즈락박 등
      || (/\s/.test(t) && new RegExp(`^[${SURNAME}]\\s`).test(t))                       // "박 외부" 성씨+공백
      || t.trim().split(/\s+/).length >= 5                                              // 5어절+ = 문장형(테스트 입력·안내문구는 accountedKo 보호)
      || /(상세|확인|연결|되나|업뎃|업데이트)\s*\d*[?!.]?$/.test(t);                    // 사용자 작성 작업/장비 제목("그린만 상세"·"장비 자동 업뎃 되나?")
    const PERSON = ['조장', '조원', '지시', '지시자', '등록자', '담당자', '작업자', '신청자', '작성자', '조치자', '점검자'];
    const nearPerson = (el: Element): boolean => {
      const self = ((el as HTMLElement).innerText || '').trim(); if (PERSON.includes(self)) return false;
      let p = el.parentElement;
      for (let i = 0; i < 3 && p; i++) { const sibs = Array.from(p.children).map((c) => ((c as HTMLElement).innerText || '').trim()); if (sibs.some((s) => PERSON.includes(s))) return true; p = p.parentElement; }
      return false;
    };
    const ownText = (el: Element) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
    // ⚠ 핵심 정밀화(2026-09-17): 데이터 리스트(인명·작업명·분류인스턴스)는 전부 한글이라 오탐. **번역된 이웃 판별** —
    //   대상언어 스크립트(라틴/타이/가나·한자/키릴)를 담은 형제/조상이 있으면 "이 영역은 번역됐는데 이 텍스트만 한글" =
    //   진짜 누락/미번역. 전부 한글인 영역(데이터 행)은 이웃 스크립트 없음 → 제외. → 인명·작업명 노이즈 급감.
    const TRANS_SCRIPT = /[A-Za-z฀-๿぀-ヿ一-鿿Ѐ-ӿ]/;   // 라틴·타이·가나/한자·키릴
    const hasTranslatedNeighbor = (el: Element): boolean => {
      let p: Element | null = el.parentElement;
      for (let i = 0; i < 3 && p; i++) {
        for (const c of Array.from(p.children)) {
          if (c === el || c.contains(el)) continue;
          if (TRANS_SCRIPT.test((c as HTMLElement).innerText || '')) return true;   // 형제가 번역됨 → el만 한글=누락
        }
        p = p.parentElement;
      }
      return false;
    };
    const out: { text: string; hint: string }[] = []; const seen = new Set<string>();
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const he = el as HTMLElement;
      if (he.children.length && !ownText(el)) continue;               // 컨테이너 제외
      if (!isVis(el)) continue;
      const text = (he.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text || !HAN.test(text) || text.length > 120) continue;    // 한글 포함만
      if (TRANS_SCRIPT.test(text)) continue;                           // 한글+번역 혼재는 여기 아닌 본 대조가 처리
      if (looksData(text) || nearPerson(el) || looksName(text) || looksAccount(text)) continue;   // 데이터(인명·계정·기기·파편) 감산
      if (inDataCard(el) && /[:：]|\//.test(text)) continue;            // 카드 내 라벨:값 concat 제외
      if (/[-–]/.test(text) && /[가-힣]-[가-힣A-Za-z]/.test(text)) continue;   // 분류-인스턴스(러프-버티컷·그린-관수) 데이터 제외
      if (!hasTranslatedNeighbor(el)) continue;                        // ★ 번역된 이웃 없음(전부 한글 영역=데이터) → 제외
      if (seen.has(text)) continue; seen.add(text);
      const cls = (el.className || '').toString().replace(/\s+/g, '.').slice(0, 30);
      const par = el.parentElement ? el.parentElement.tagName.toLowerCase() + '.' + (el.parentElement.className || '').toString().replace(/\s+/g, '.').slice(0, 24) : '';
      out.push({ text: text.slice(0, 60), hint: `${el.tagName.toLowerCase()}.${cls} < ${par}` });
    }
    return out;
  }).catch(() => [] as { text: string; hint: string }[]);
  // accountedKo(검증/캡처 완료 KO 텍스트)에 없는 한글 = 순수 누락 후보. 숫자 정규화 비교(캡처는 #로 저장).
  const norm = (t: string) => t.replace(/\d+/g, '#');
  const missed = residue.filter((r) => !accountedKo.has(r.text) && !accountedKo.has(norm(r.text)));
  if (!missed.length) return;
  review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '누락 후보(FG 한글잔존)', zone: 'audit',
    item: `${missed.length}건 미검증 한글`, value: missed.slice(0, 20).map((m) => `"${m.text}"`).join(' / '), screenshot: '' });
  // 상세 힌트(구조)는 별도 행으로(셀렉터 보정용).
  for (const m of missed.slice(0, 12)) {
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '누락 후보 상세', zone: 'audit', item: `"${m.text}"`, value: m.hint, screenshot: '' });
  }
}

// ── 누락 오라클 ②: 상호작용 요소 인벤토리 + 미처리 검출(2026-09-17, 사용자: 누락 자가검출) ──
//   화면의 **모든 트리거**(버튼·?·드롭다운·탭·카드 chevron·입력)를 열거 → 스캐너가 다루는 패턴과 대조 →
//   **미처리 트리거 = 상호작용 누락 후보**를 관찰 시트에 자동 신고. "요소는 있는데 안 열어봤다"를 구조적으로 검출.
//   판정 아님(관찰) — 사람은 이 짧은 '미처리' 목록만 보고 스캐너 확장 여부 결정.
const HANDLED_RE = [
  VIEW_BTN, DESTRUCTIVE_BTN, NAV_BTN,
  /조건\s*설정|최신순|이름순|정렬/,          // openers(오버레이)
  /등록|추가|점검\s*등록|이슈\s*등록|장비\s*등록|시설\s*등록|자재/,   // reg 폼
  /^\?$|도움말|question|help/,               // 툴팁
  /검색/,                                     // 검색
  /나의\s*작업\s*보기/,                        // 나의작업보기
];
async function auditTriggerInventory(page: Page, lang: CourseLang, tab: string, sub: string): Promise<void> {
  const inv: { kind: string; label: string; handled: boolean }[] = await page.evaluate(({ handledSrc }) => {
    const handled = handledSrc.map((s) => new RegExp(s));
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const out: { kind: string; label: string; handled: boolean }[] = []; const seen = new Set<string>();
    const push = (kind: string, label: string, autoHandled: boolean) => {
      const lab = label.slice(0, 30) || '(무라벨)'; const key = kind + '|' + lab;
      if (seen.has(key)) return; seen.add(key);
      // ⚠ 데이터/무의미 라벨 제외(2026-09-17): 숫자만(지도 카운트 2·38·42)·무라벨·1글자·LOG 류는 상호작용 누락 신호 아님 → handled 처리.
      const noise = kind === '버튼' && (/^\(무라벨\)$/.test(lab) || /^[\d\s]+$/.test(lab) || lab.length <= 1 || /^(LOG|log)$/.test(lab));
      const h = autoHandled || noise || handled.some((re) => re.test(lab));
      out.push({ kind, label: lab, handled: h });
    };
    // 버튼/역할버튼
    for (const el of Array.from(document.querySelectorAll('button, .button-common, [role="button"]'))) {
      if (!vis(el)) continue; push('버튼', norm((el as HTMLElement).innerText || ''), false);
    }
    // ? / 도움말 아이콘
    for (const el of Array.from(document.querySelectorAll('i[class*="question"], i[class*="help"], i[class*="ico-info"], [class*="ico-question"]'))) {
      if (!vis(el)) continue; push('툴팁트리거', norm((el as HTMLElement).innerText || '') || '?', false);
    }
    // vue-select 드롭다운
    for (const el of Array.from(document.querySelectorAll('.v-select .vs__dropdown-toggle, .vs__dropdown-toggle'))) {
      if (!vis(el)) continue; push('드롭다운', norm((el as HTMLElement).innerText || '') || '(select)', false);
    }
    // 탭
    for (const el of Array.from(document.querySelectorAll('[class*="tab"] [class*="item"], [role="tab"], .tab-item'))) {
      if (!vis(el)) continue; const t = norm((el as HTMLElement).innerText || ''); if (t) push('탭', t, true);   // 탭 전환은 화면 내 텍스트라 기본캡처 커버
    }
    // 카드 상세 chevron — scanNavScreen(상세)이 이미 커버 → autoHandled.
    for (const el of Array.from(document.querySelectorAll('i[class*="ico-arrow-next"], [class*="arrow-next"]'))) {
      if (!vis(el)) continue; push('상세진입', 'chevron', true);
    }
    // 입력(placeholder)
    for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
      if (!vis(el)) continue; const ph = norm((el as HTMLElement).getAttribute('placeholder') || ''); if (ph) push('입력', ph, true);   // placeholder 는 기본캡처 커버
    }
    return out;
  }, { handledSrc: HANDLED_RE.map((r) => r.source) }).catch(() => [] as { kind: string; label: string; handled: boolean }[]);
  if (!inv.length) return;
  const unhandled = inv.filter((t) => !t.handled);
  // 인벤토리 요약(전체 트리거 수·유형별) — 커버리지 파악용.
  const byKind: Record<string, number> = {};
  for (const t of inv) byKind[t.kind] = (byKind[t.kind] || 0) + 1;
  review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '트리거 인벤토리', zone: 'audit',
    item: `총 ${inv.length}개 (미처리 ${unhandled.length})`, value: Object.entries(byKind).map(([k, v]) => `${k}:${v}`).join(' · '), screenshot: '' });
  if (unhandled.length) {
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '미처리 트리거(누락 후보)', zone: 'audit',
      item: `${unhandled.length}개 미커버`, value: unhandled.slice(0, 20).map((t) => `[${t.kind}]${t.label}`).join(' / '), screenshot: '' });
  }
}

// ── 화면 대상(랜딩 + 시스템 텍스트가 풍부한 대표 영역) ──────────────────────────
//   전 9영역은 세션 1런/로그인 한계상 과다 → 랜딩 + 대표 4영역(시스템 chrome 밀집). tile=-1=랜딩(URL), 그 외=타일 nth 클릭.
// 랜딩 + **전 9영역**(사용자 요청 전수). ⚠ 세션 1런/로그인 한계상 길어짐 → 중간 만료 시 후반 SKIP(정직).
//   ⚠ 진입은 **공백 무시 타일 매칭 + route 검증**(gotoMobileAreaFlex) — 타일 텍스트가 area명과 공백 다름
//   (시설관리↔"시설 관리"·코스정보↔"코스 정보 입력"·코스뷰↔"코스뷰") → hasText 정확매칭 실패 방지.
//   openers = 화면 내 **비파괴 오버레이 트리거**(조건설정 모달·정렬 드롭다운) → 딥 인터랙션 팝업 다국어 검증(별도 탭).
//   reg = [등록] 버튼(비파괴 폼 스캔 — 열어서 필드라벨·placeholder만 대조, 저장 안 함). 최신순/이름순은 팝업 없어(정렬 토글) 제외.
const MOBILE_LANG_SCREENS: { label: string; match: string | null; route: string; openers?: string[]; date?: boolean; reg?: string }[] = [
  { label: '랜딩', match: null, route: 'course' },
  { label: '작업 지시', match: '작업지시', route: 'orderMain', date: true, reg: '작업지시 등록' },
  { label: '작업 관리', match: '작업관리', route: 'orderList', openers: ['조건설정'], date: true },
  { label: '코스 뷰', match: '코스뷰', route: 'monitorMap' },
  { label: '일상 점검', match: '일상점검', route: 'dailyCheck', openers: ['조건설정'], reg: '점검 등록' },
  { label: '코스정보', match: '코스정보', route: 'submission' },
  { label: '이슈/예측', match: '이슈/예측', route: 'issuePrediction', openers: ['조건설정'], reg: '이슈 등록' },
  { label: '장비관리', match: '장비관리', route: 'equipmentList', reg: '장비등록' },
  { label: '시설관리', match: '시설관리', route: 'facilityList', openers: ['조건설정'], reg: '시설 등록' },
  { label: '자재관리', match: '자재관리', route: 'materialList', reg: '입고된 자재 등록' },
];

// 한 화면 검증(KO 기준 ↔ 대상언어 대조). ⚠ 외국어 로그인 세션은 ko+대상 사전 동시 적재 → 양방향 주입 가능(2026-09-15 실측).
//   대상(FG) 캡처 → KO 주입 후 기준 캡처 → 데스크톱 applySlotComparison(무수정) → 리포트에 "한국어 원문 → 대상값" + PASS/FAIL.
async function verifyMobileScreen(
  page: Page, lang: CourseLang, screenLabel: string, tcRef: string,
  enter: () => Promise<boolean>,
  landingTexts: Set<string>,   // 랜딩 메뉴 텍스트(서브화면서 상주 재캡처 제외용). 랜딩 자신은 빈 Set.
  gSeen: Set<string>,          // 런-전역 중복 제거(같은 항목 반복 방지).
): Promise<string[]> {         // 반환: 이 화면 KO 텍스트(랜딩이면 상위에서 landingTexts로 축적)
  // ⚠ path 첫 세그먼트 = 화면명(tab) → 화면별 탭 분리. sub="기본" → 경로 `모바일-<화면> > 기본 > <zone>`(언어검증 제거).
  const tab = `모바일-${screenLabel}`;
  const sMeta = (note: string): CheckMeta => ({ path: `${tab} > 기본`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 모바일 언어검증 — ${note}` });
  const okEnter = await enter();   // enter 는 한국어 상태로 서브페이지 진입시킴(gotoMobileArea, 검증된 경로)
  const diag = (extra: string) => review({ lang: lang.ko, screen: `코스관리(모바일) > ${screenLabel}`, kind: '화면 진단', zone: 'nav',
    item: `enter=${okEnter} url=${page.url().replace(/^https?:\/\/[^/]+/, '')}`, value: extra, screenshot: '' });
  if (!okEnter) { diag('진입 실패'); skip(sMeta('진입'), `${screenLabel} 진입 실패(내비 — 진단 시트 참조)`); return []; }
  await settle(page, 700); await killMobileAlarms(page);

  // 1) KO 기준 캡처(진입 직후 = 한국어).
  let ko = await captureMobileSlots(page);
  if (!ko.length) { diag('KO 슬롯 0'); skip(sMeta('KO 캡처'), '시스템 슬롯 0(캡처 대상 없음)'); return []; }
  const koTexts = ko.map((s) => s.text);
  // ▶ 프로브(2026-09-16, 사용자: 상단 카드 필드라벨 누락) — 캡처된 KO에 없는 기대 라벨의 실 DOM 구조(tag.class·조상) 덤프.
  //   블라인드 EXCL 수정 대신 실 구조 확인 후 정밀 보강. 나의작업보기=작업명/종류/상태/분류/월간계획, 리스트=조장/지시/상태.
  {
    const wantLbl = screenLabel === '나의 작업 보기' ? ['작업명', '종류', '상태', '분류', '월간계획'] : ['조장', '지시', '상태', '분류'];
    const koSet = new Set(koTexts);
    const missing = wantLbl.filter((w) => !koSet.has(w));
    if (missing.length) {
      const dump = await page.evaluate((want) => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const t = ((el as HTMLElement).innerText || '').trim();
          if (!want.includes(t) || (el as HTMLElement).children.length) continue;   // leaf만
          const cls = (el.className || '').toString().replace(/\s+/g, '.').slice(0, 45);
          const anc: string[] = []; let p = el.parentElement;
          for (let i = 0; i < 4 && p; i++) { anc.push(p.tagName.toLowerCase() + '.' + (p.className || '').toString().replace(/\s+/g, '.').slice(0, 30)); p = p.parentElement; }
          out.push(`"${t}"=${el.tagName.toLowerCase()}.${cls} < ${anc.join(' < ')}`);
        }
        return out.slice(0, 10);
      }, missing).catch(() => [] as string[]);
      review({ lang: lang.ko, screen: `코스관리(모바일) > ${screenLabel}`, kind: '라벨 누락 프로브', zone: 'capture',
        item: `누락 ${missing.join('/')}`, value: dump.length ? dump.join('  ||  ') : 'DOM에 해당 leaf 텍스트 없음(합쳐짐/렌더 전)', screenshot: '' });
    }
  }
  // 2) 대상 언어로 전환 후 FG 캡처.
  // 누락 오라클 ②: KO 모드에서 화면의 전 트리거 인벤토리 → 미처리(스캐너 미커버) 트리거 자동 신고(한글 라벨 기준 → 전환 전).
  await auditTriggerInventory(page, lang, tab, '기본');
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { diag(`대상 렌더 실패: ${sw.why}`); skip(sMeta('대상 렌더'), `${lang.ko} 렌더 실패: ${sw.why}`); return koTexts; }
  let fg = await captureMobileSlots(page);

  // 2.5) 서브화면: **상주 랜딩 메뉴 제외**(랜딩 타일/설명이 서브페이지에 재캡처됨 — 중복·"누락처럼 보임" 근본).
  //   랜딩에서 수집한 텍스트를 서브화면 슬롯에서 필터(자신 화면의 고유 콘텐츠만 남김). 랜딩 자신은 landingTexts 비어있어 무영향.
  if (landingTexts.size) { ko = ko.filter((s) => !landingTexts.has(s.text)); fg = fg.filter((s) => !landingTexts.has(s.text)); }

  // 3) 반응성 판정(대상 전환이 실제 리렌더 됐는지).
  const koByKey = new Map(ko.map((s) => [s.key, s.text]));
  let common = 0, changed = 0;
  for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
  const reactive = common > 0 && changed >= Math.max(2, Math.floor(common * 0.2));
  diag(`KO ${ko.length}·FG ${fg.length}·공통 ${common}·변경 ${changed}·반응성 ${reactive ? 'O(대조)' : 'X'}`);

  if (!ko.length) { skip(sMeta('고유콘텐츠'), '랜딩 메뉴 제외 후 고유 슬롯 0(서브페이지 고유 시스템텍스트 없음/데이터화면)'); return koTexts; }
  if (reactive) {
    // 모바일 이미터 — PASS=한국어 원문↔대상값, FAIL=한글잔존/미번역/혼재. 경로 `모바일-<화면> > 기본 > zone`, 런-전역 dedup.
    emitMobileComparison(ko, fg, lang, tab, '기본', tcRef, gSeen);
    // 누락 오라클 ①: FG(대상언어) 모드에서 **검증 안 된 한글 잔존** = 놓친 시스템텍스트/미번역. accountedKo=이 화면 KO + 랜딩.
    //   ⚠ 반응성 O 일 때만(전환 미반영이면 전 화면이 한글이라 무의미). 지금 page 는 FG 모드 → restoreKorean 전에 실행.
    const accounted = new Set<string>([...koTexts, ...landingTexts]);
    await auditForeignHangulResidue(page, lang, tab, '기본', tcRef, accounted);
  } else {
    // 대상 전환이 반영 안 됨 → FG가 여전히 한국어일 수 있어 누수 스캔은 false FAIL 위험 → 정직 SKIP(진단 기록).
    skip(sMeta('대조'), `대상 전환 미반영(공통 ${common} 중 변경 ${changed}) — 런타임 리렌더 실패, 재시도 필요`);
  }
  await restoreMobileKorean(page);   // 다음 화면 위해 KO 원복
  return koTexts;
}

// ── 엔트리: 한 언어 모바일 다국어 검증 ────────────────────────────────────────
//   ⚠ 대상 언어로 로그인된 세션 필요(외국어 로그인 = ko+대상 사전 동시 적재 → KO 기준 대조 가능).
//   한국어 로그인(ko 사전만) 세션은 대상 미렌더 → 정직 SKIP + 재로그인 안내.
export async function runCourseMobileLang(page: Page, lang: CourseLang): Promise<void> {
  const tcRef = `코스관리모바일_다국어_${lang.ko}`;
  const st = await readMobileI18n(page);

  // 대상 언어 렌더 가능성 프로브(진단 review 겸용).
  await gotoMobileLanding(page); await settle(page, 600); await killMobileAlarms(page);
  const probe = await switchMobileLangRuntime(page, lang);
  review({ lang: lang.ko, screen: '코스관리(모바일)', kind: '언어 사전 적재', zone: 'i18n',
    item: `locale=${st.locale} available=[${st.available.join(',')}] lang.map=[${(st.lsLangKeys || []).join(',')}]`,
    value: probe.ok ? `대상(${lang.ko}) 렌더 가능(code=${probe.code}) — KO 기준 대조 수행` : `대상 미렌더: ${probe.why}`, screenshot: '' });
  if (!probe.ok) {
    skip({ path: `코스관리(모바일) > 언어검증(${lang.ko})`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 모바일 언어검증 — 사전 적재 프로브` },
      `${lang.ko} 사전 미적재(${probe.why}) · 앱 내 스위처 부재 → **대상 언어로 course:auth-mobile 재로그인** 필요(외국어 로그인 세션은 ko+대상 사전 동시 적재)`);
    diff('코스관리(모바일) > 언어검증', '앱 내 언어 스위처', '부재(로그인 시에만 언어 선택)', tcRef,
      `현 세션에 ${lang.ko} 사전 없음 → 대상 언어 재로그인 없이는 대조 검증 불가`);
    return;
  }
  await restoreMobileKorean(page);
  // ⚠ 파괴형 버튼 크롤 게이트(사용자: 파괴형 포함, 테스트서버 무영향) — ALLOW_DESTRUCTIVE=1 + course-mng-td + 킹즈락.
  //   허용 시 크롤러가 저장/삭제/등록/수정 버튼도 클릭해 그 화면(편집폼·확인다이얼로그·유효성)을 커버(복귀는 취소/뒤로=커밋 회피).
  const dGuard = await isCourseDestructiveAllowed(page);
  const destructiveOk = dGuard.ok;
  review({ lang: lang.ko, screen: '코스관리(모바일)', kind: '파괴형 크롤', zone: 'guard', item: destructiveOk ? '허용' : '비허용', value: dGuard.why, screenshot: '' });

  // 화면 순회: 랜딩 + 전 9영역. 랜딩 텍스트를 축적해 서브화면서 상주 메뉴 제외.
  const landingTexts = new Set<string>();
  for (const scr of MOBILE_LANG_SCREENS) {
    // ⚠ **화면 단위 중복 제거**(2026-09-15 재조정): 런-전역 dedup은 공통 폼필드(제목·상세·중요도…)를 앞 화면서 1회 검증 후
    //   뒤 화면 폼을 통째로 비워 "폼 검증 안 됨"처럼 보이게 함 → gSeen을 **화면마다 리셋**. 화면 내 세그먼트 간 중복만 제거,
    //   각 화면은 자기 폼·검색·상세를 온전히 노출(화면 간 공통 문자열은 화면별로 반복 허용 = 화면별 완결 커버리지).
    const gSeen = new Set<string>();
    const koTexts = await verifyMobileScreen(page, lang, scr.label, tcRef, async () => enterMobileScreenKorean(page, scr.match, scr.route), landingTexts, gSeen);
    if (scr.match == null) koTexts.forEach((t) => landingTexts.add(t));   // 랜딩 텍스트 축적(이후 서브화면 필터 기준)
    if (!koTexts.length) continue;   // 진입 실패 화면은 딥 인터랙션 생략
    // 딥①: 오버레이 오프너(조건설정·정렬) 순회 → 팝업 다국어 검증(부모 탭 편입).
    for (const op of scr.openers || []) {
      await scanOverlay(page, lang, scr.label, op, tcRef, async () => {
        const b = page.getByText(new RegExp(`^\\s*${op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)).first();
        if (!(await b.count().catch(() => 0)) || !(await b.isVisible().catch(() => false))) return false;
        await b.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 900); return true;
      }, gSeen);
    }
    // ⚠ **딥 인터랙션 순서(2026-09-16 재배치)**: 리스트-복귀형(등록폼·검색·달력)을 **먼저**, 드리프트 유발원인인
    //   **상세/나의작업보기 파괴형 크롤을 맨 마지막**에. 이전엔 상세 크롤이 페이지를 리스트 밖으로 이동시켜 이후 등록폼이
    //   "트리거 미발견"으로 SKIP(작업지시 실측). 크롤 잔재는 다음 화면 진입 하드리셋이 흡수하므로 last 배치가 안전.
    // 딥①: [등록] 폼 — 비파괴 스캔(공백무시 트리거 + 폼 필드/placeholder/라디오/섹션/버튼 대조 + [<] 취소확인 모달). 저장 안 함.
    if (scr.reg) await scanRegForm(page, lang, scr.label, scr.reg, tcRef, landingTexts, gSeen);
    // 딥②: 검색(헤더 검색 아이콘) — 리스트형 화면.
    if (scr.match != null) await scanSearch(page, lang, scr.label, tcRef, gSeen);
    // 딥③: datepicker(달력) — 기간 필터 보유 화면.
    if (scr.date) await scanDatepicker(page, lang, scr.label, tcRef, gSeen);
    // 딥④(LAST): 네비게이션형 파괴형 크롤 — 랜딩=[나의 작업 보기], 리스트 화면=항목→상세(카드 우측 chevron). 드리프트 격리 위해 맨 끝.
    if (scr.match == null) {
      // ⚠ 나의 작업 보기 = **별도 탭**(사용자 요청): parentLabel 자체를 화면명으로 → tab=`모바일-나의 작업 보기`.
      await scanNavScreen(page, lang, '나의 작업 보기', '기본', tcRef, async () => {
        const b = page.getByText('나의 작업 보기', { exact: true }).first();
        if (!(await b.count().catch(() => 0))) return false;
        await b.click({ timeout: 3_000 }).catch(() => {}); return true;
      }, landingTexts, gSeen, true, destructiveOk, true);   // crawl+파괴가드+ownSeen(2026-09-23 사용자: 상단 라벨 작업명/종류/상태/분류/월간계획이 앞 화면 dedup에 눌려 누락 → 나의작업보기는 전용 Set으로 완결 커버)
    } else {   // 리스트형 화면: 항목→상세 진입(카드 우측 chevron → 없으면 **작업 카드**(날짜 포함) 본문 클릭 폴백)
      await scanNavScreen(page, lang, scr.label, '상세', tcRef, async () => {
        const chev = page.locator('i[class*="ico-arrow-next"], [class*="arrow-next"]').filter({ visible: true }).first();
        if (await chev.count().catch(() => 0)) { await chev.click({ timeout: 3_000 }).catch(() => {}); return true; }
        // ⚠ 폴백 개선(2026-09-17, 작업지시 상세 오진입 실측): nth(0) 카드는 **요약/통계 카드**(완료확정 N건…)일 수
        //   있어 상세 미진입/등록화면 오진입. **날짜(작업기간)를 담은 실제 작업 카드**만 클릭(요약카드는 날짜 없음).
        const before = page.url();
        const clicked = await page.evaluate(() => {
          const DATE = /\d{4}[-.]\d{2}[-.]\d{2}/;
          const cards = Array.from(document.querySelectorAll('[class*="bd-dde3ec"], [class*="bdr-12"], [class*="card"]'))
            .filter((c) => { const r = (c as HTMLElement).getBoundingClientRect(); return r.width > 40 && r.height > 40 && DATE.test((c as HTMLElement).innerText || ''); });
          if (!cards.length) return false;
          (cards[0] as HTMLElement).click(); return true;   // 첫 실제 작업 카드
        }).catch(() => false);
        if (clicked) { await settle(page, 900); if (page.url() !== before) return true; }
        const card = page.locator('[class*="bd-dde3ec"], [class*="bdr-12"]').filter({ visible: true }).nth(0);   // 최후 폴백
        if (!(await card.count().catch(() => 0))) return false;
        await card.click({ timeout: 3_000 }).catch(() => {}); return true;
      }, landingTexts, gSeen, true, destructiveOk, true);   // crawl+파괴가드+ownSeen(2026-09-23 일반화: 나의작업보기와 동일한 상단 라벨-값 형태가 전 상세 화면(작업지시/작업관리/일상/이슈/장비/시설/자재)에 있음 → 각 상세도 전용 Set으로 완결 커버, 앞 화면 dedup에 눌리지 않음)
    }
  }
  await restoreMobileKorean(page);
}

// 언어 선택 헬퍼(LANGS env). 미지정 시 전체 7개.
export function pickMobileLangs(): CourseLang[] {
  const raw = (process.env.LANGS || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  if (!raw.length) return COURSE_LANGS;
  return COURSE_LANGS.filter((l) => raw.some((r) => l.ko.includes(r) || l.clickLabel.toLowerCase().includes(r.toLowerCase()) || l.label.includes(r)));
}

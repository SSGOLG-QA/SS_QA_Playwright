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
// ── (P1) i18n 키 누출 정규식(2026-09-30 QA-15704 #13: 과거등록순=constants.139, #관찰 ui.2971) ──
//   번역 실패 시 vue-i18n 이 원시 키를 그대로 렌더(`constants.139`·`ui.2971`·`label.foo.bar`). Latin이라 기존 분류(한글/빈값)를
//   못 걸러 "번역 정상" PASS 로 오판됨 → 전용 판정. 원시 키는 명백한 결함(비반응성 stale 아님) → freshFg 무관 즉시 FAIL.
//   ⚠ 정상 영단어 오탐 방지: `네임스페이스.식별자` 또는 `접두.숫자` 형태(공백 없음·점 포함)만 매칭. 문장·정상 라벨은 제외.
const KEY_LEAK_RE = /^(constants|const|ui|common|comm|msg|message|label|enum|code|key|i18n|lang|text|str|str)\.[\w.-]+$|^[a-z][a-z_]*\.\d[\w.-]*$/i;
// ⚠ 비반응성 거짓 FAIL 근절(2026-09-29, 사용자: "모든 항목이 오검출"): 이 모바일 앱은 i18n 런타임 전환이
//   **반응성 텍스트**(월→MON)만 즉시 교체하고, **비반응성 요소**(확인모달 예/아니오·상태뱃지 진행중/완료확정·
//   섹션제목 기상정보·요일·필터칩 상/중/하)는 **마운트 시점 로케일로 baked** → 스위치-인-플레이스 FG가 한글 잔존 = 거짓 FAIL.
//   ▶ 정책: 잔존 한글(한글노출/혼재)은 **FG가 대상 언어로 신선 마운트(reload boot)됐을 때만** 실제 미번역 FAIL.
//     그 외(스위치-인-플레이스=비반응성 오판 가능)는 **판정 보류(관찰 시트)**. 미노출(FG 빈값)은 슬롯 매칭 아티팩트 → 항상 관찰.
//   freshFg=true 는 captureFgFresh(대상 부팅 reload)로 캡처한 경우만 caller 가 전달(verifyMobileScreen 기본).
function emitMobileComparison(ko: Slot[], fg: Slot[], lang: CourseLang, tab: string, sub: string, tcRef: string, gSeen: Set<string>, freshFg = false) {
  const fgByKey = new Map(fg.map((s) => [s.key, s.text]));
  for (const s of dedupByText(ko)) {
    const t = s.text;
    if (!HANGUL_RE.test(t)) continue;             // 번역 대상(한국어 원문 포함)만
    if (gSeen.has(t)) continue; gSeen.add(t);      // 런-전역 중복 제거
    const ft = (fgByKey.get(s.key) || '').trim();
    let phen = '';
    let keyLeak = false;
    if (ft === '') phen = '미노출(미번역)';
    else if (HANGUL_RE.test(ft)) phen = OTHER_SCRIPT_RE.test(ft) ? '언어 혼재' : '한글 노출';
    else if (KEY_LEAK_RE.test(ft)) { phen = 'i18n 키 누출'; keyLeak = true; }   // (P1) constants.139·ui.2971 등 원시 키 노출
    const meta: CheckMeta = {
      path: `${tab} > ${sub} > ${s.zone}`, tcRef, tcId: `MLANG-${lang.ko}`,
      desc: phen ? `${lang.ko} ${phen}: "${t.slice(0, 40)}"` : `${lang.ko} 번역 정상: "${t.slice(0, 40)}"`,
      expected: `한국어 원문: "${t}"`, failMsg: phen || undefined,
    };
    if (!phen) { record(meta, 'PASS', { actual: `${lang.label}: "${ft}"` }); continue; }
    // 실제 미번역 FAIL 은 **신선 대상 렌더에서 한글 잔존(혼재 포함)** 일 때만. 미노출/비신선은 관찰(보류).
    // ⚠ i18n 키 누출은 예외 — 원시 키는 어떤 렌더에서도 정상값이 될 수 없음(비반응성 stale 무관) → freshFg 무관 즉시 FAIL.
    const realDefect = keyLeak || (freshFg && phen !== '미노출(미번역)');
    if (realDefect) {
      record(meta, 'FAIL', { actual: `${lang.label}: "${ft}"`, error: phen, detail: `${lang.label} 신선 렌더 표시값(비반응성 오판 배제)` });
    } else {
      review({ lang: lang.ko, screen: tab, kind: `번역 판정 보류(${phen})`, zone: sub,
        item: `"${t.slice(0, 40)}"`,
        value: `${lang.label} 표시=${ft === '' ? '(빈값/슬롯 미매칭)' : `"${ft}"`} · ${freshFg ? '미노출=매칭 아티팩트' : '비반응성 요소 가능(런타임 전환 미반영) — 신선 렌더 미확보, 실앱 확인 요망'}`,
        screenshot: '' });
    }
  }
}
import { settle } from '../adminHelpers';
import { killMobileAlarms, enterCourseMgmt, returnToLanding, mobileBack } from './courseMobileHelpers';

// ── 월클록 데드라인(2026-09-28, 타임아웃 유실 방지) ─────────────────────────────
//   커버리지 확장(코스정보 허브·전화면 [?]·예측달력 등)으로 한 세션이 test timeout(900s)을 초과 → writeReport 미실행·리포트 통째 유실.
//   런 시작 시 예산 설정, 초과 시 남은 화면/딥스캔을 정직 SKIP하고 **반환 → writeReport 도달 보장**. env MLANG_BUDGET_MS 로 조정.
let gDeadline = 0;
const overBudget = (): boolean => gDeadline > 0 && Date.now() > gDeadline;

// ── chrome-only 모드(2026-09-28, 사용자 확정: 데이터 중심 모듈은 레코드 값 제외) ──────────
//   거래처정보/거래내역 등은 레코드 값(거래처명·대표·업종·금액·테스트데이터)이 대량 → 미번역 false FAIL.
//   이 플래그 ON 시 captureMobileSlots가 **필드 라벨 옆 값·링크(제목) 텍스트를 추가 제외**하고 시스템 chrome(라벨·버튼·헤더·안내문구)만 남김.
let gChromeOnly = false;
// ── 레이아웃 결함 감사 dedup(2026-09-28, 사용자: 버튼 겹침·글자 잘림·영역 벗어남 검출 요청) ──────
//   버튼/요소 겹침·가로 영역 벗어남·글자 잘림을 DOM 지오메트리로 결정론적 검출(픽셀 비교·베이스라인 불요).
//   런 전역 dedup(같은 결함이 화면 재진입·언어 반복마다 중복 기록되지 않게). runCourseMobileLang 시작 시 리셋.
let gLayoutSeen = new Set<string>();
// ── 세션 반응성 플래그(2026-09-28, 사용자: "변경0 SKIP 오판 점검") ──────────────────
//   랜딩 base에서 i18n 런타임 전환이 확인되면(reactive) 이 세션은 전환 메커니즘이 작동하는 것 → 이후 서브뷰(정렬·취소확인·드롭다운·상세·모달)에서
//   "공통>0·변경0"은 "전환 미반영"이 아니라 **그 서브뷰가 전체 미번역인 실결함** → emit(정직 FAIL). 미확인 세션에선 보수적(changed≥1)만.
let gSessionReactive = false;
const shouldEmitFg = (common: number, changed: number): boolean => common > 0 && (changed >= 1 || gSessionReactive);
// ── 부팅 로케일=대상 여부(2026-09-29, FG-우선 캡처) ─────────────────────────────
//   런타임 전환(setMobileLocale)은 **메모리만**(localStorage.lang 미기록) → page.reload() 는 항상 **부팅=localStorage 로케일**.
//   대상 언어로 로그인(=부팅=대상)한 세션이면 reload 로 **대상 언어 신선 마운트**(비반응성 요소도 대상 렌더) 확보 가능.
//   runCourseMobileLang 시작 시 st.locale ↔ 대상 코드 후보 대조로 설정. 한국어 로그인 세션은 false → reload-신선 미사용(폴백=관찰).
let gBootIsTarget = false;
import { clickFrontLayerBack, headerTitles } from './courseMobileDeep';   // 딥 인터랙션서 확정된 스택 back 스코프 재사용
import { isCourseDestructiveAllowed } from './destructive';
import * as fs from 'fs';
import * as path from 'path';

// 레이아웃 결함 증거 스크린샷 — **현재 뷰포트 그대로**(리포터 capture()는 CDP로 뷰포트를 콘텐츠 높이로 리사이즈+mobile:false
//   → 겹침/오버플로 상태 자체가 바뀌므로 부적합). reports/screenshots 저장, 실패 시 ''.
//   ⚠ clip 지정 시 **결함 영역만** 잘라 저장(2026-09-28 사용자: 전체 뷰포트라 같은 화면만 반복됨 → 결함 위치별로 구분되게).
async function captureShot(page: Page, slugBase: string, clip?: { x: number; y: number; w: number; h: number }): Promise<string> {
  try {
    const dir = path.join(process.cwd(), 'reports', 'screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const slug = `${slugBase}_${Date.now()}`.replace(/[^\w가-힣]+/g, '_').slice(0, 90);
    const shot = path.join(dir, `${slug}.png`);
    let opt: any = { path: shot };
    if (clip) {
      const vp = page.viewportSize();   // 뷰포트 경계로 클램프(clip 벗어나면 screenshot 예외)
      const W = vp?.width ?? 390, H = vp?.height ?? 844;
      const pad = 16;
      const x = Math.max(0, Math.floor(clip.x - pad)), y = Math.max(0, Math.floor(clip.y - pad));
      const w = Math.min(W - x, Math.ceil(clip.w + pad * 2)), h = Math.min(H - y, Math.ceil(clip.h + pad * 2));
      if (w > 4 && h > 4) opt.clip = { x, y, width: w, height: h };
    }
    await page.screenshot(opt).catch(async () => { await page.screenshot({ path: shot }).catch(() => {}); });   // 클립 실패 시 전체 폴백
    return shot;
  } catch { return ''; }
}

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

// ── FG(대상 언어) 신선 캡처(2026-09-29, FG-우선) ──────────────────────────────
//   비반응성 요소(확인모달·상태뱃지·섹션제목·요일·필터칩)는 마운트 시점 로케일로 baked → 스위치-인-플레이스로는 대상 렌더 불가.
//   localStorage.lang=대상 이 유지되므로 **page.reload() = 대상 언어로 SPA 재부팅** → 전 요소가 대상 언어로 신선 마운트.
//   gBootIsTarget(부팅=대상) 일 때만 신선 캡처 시도. reload 후 **동일 경로**(pathname) 확인 실패/빈 슬롯 → 비신선 폴백(관찰 처리).
//   ⚠ URL 주소지정 가능한 풀페이지 전용(base 화면). in-place 콘텐츠 스왑(scanNavScreen 상세 등)은 reload 시 상태 유실 → 호출 금지.
async function captureFgFresh(page: Page, rootSel?: string, keepDatepicker = false): Promise<{ slots: Slot[]; fresh: boolean }> {
  if (gBootIsTarget) {
    const beforePath = page.url().replace(/[?#].*$/, '');
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await settle(page, 1_000); await killMobileAlarms(page);
      if (page.url().replace(/[?#].*$/, '') === beforePath) {
        const slots = await captureMobileSlots(page, rootSel, keepDatepicker);
        if (slots.length) return { slots, fresh: true };
      }
    } catch { /* reload 실패(세션/타임아웃) → 비신선 폴백 */ }
  }
  return { slots: await captureMobileSlots(page, rootSel, keepDatepicker), fresh: false };
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
  return await page.evaluate(({ rootSel, keepDatepicker, chromeOnly }) => {
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
    // ⚠ datepicker 제외 축소(2026-09-29 사용자 스크린샷: 잔디측정 등록폼 '잔디 측정일' 라벨 누락).
    //   기존 `[class*="datepicker"]`는 **접힌 날짜 필드의 라벨까지** 통째 삼킴(잔디 측정일/작업일 등 시스템 라벨 소실).
    //   → 캘린더 팝업(day-cell 노이즈가 사는 -layer/-body)만 제외로 좁힘. 접힌 필드의 날짜 값은 한글無라 emit 안 됨(무해),
    //   라벨·요일(월/화 등)은 살아 검증됨. 캘린더 딥스캔(scanCalendarDayDetail)은 keepDatepicker=true라 무영향.
    const EXCL = ['input', 'textarea', 'table', 'tbody', '[class*="badge"]:not([class*="badge-content"])', '.vs__selected', '.vs__dropdown-menu',
      '[class*="list-item"]', '[class*="list__item"]', ...(keepDatepicker ? [] : ['[class*="datepicker-layer"]', '[class*="datepicker-body"]', '[class*="datepicker-calendar"]'])];
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
      || /^킹즈락(\s|$)/.test(t) || /(^|\s)QA(\s|$)/.test(t) || /QA[-\s]?\d/i.test(t)   // 골프장명(킹즈락)·계정팀(QA)·이슈코드(QA-####) = 환경/사용자 정보 제외
      // ⚠ **레코드 코드 프리픽스 제외**(2026-09-28 실측: "코스뷰 이슈 확인용(QA-#)" 누수) — [W-####]/[I-####]/(QA-####) 등 테스트·이슈 채번 코드를 담은 사용자 데이터.
      || /\(?\s*(QA|W|I)\s*[-#]\s*\d/i.test(t)
      // ⚠ **위치(코스-홀) 데이터 제외(2026-09-17 일본어 오탐)**: "그린 [East #-러프] (East #번홀)"·"티박스 [East 티박스]"
      //   처럼 대괄호 태그·홀번호·코스명(East/South/West/North)을 담은 것 = 위치 인스턴스 데이터(시스템 enum 아님).
      || /\[.+\]/.test(t) || /번\s*홀|#번홀/.test(t) || /\b(East|South|West|North)\b/.test(t)
      // ⚠ **반복 문자 사용자 입력 제외(2026-09-29 사용자 스크린샷: 이슈 상세 "하하하"/"하하하하하" 거짓 FAIL)** — 단일 문자
      //   2회↑ 반복(하하하·ㅋㅋㅋ·ㅎㅎ·ㅠㅠ)은 사용자가 타이핑한 내용(제목/본문). 시스템 텍스트엔 이런 패턴 없음 → 무위험 제외.
      || /^(.)\1+$/.test(t.replace(/\s+/g, ''));
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
    // ⚠ **명칭 값 제외**(2026-09-28 실측: 시설 상세 "스맛흐슥호어"·"시설지하" 누수) — 시설명/장비명/자재명/제목 등 **명칭 라벨 옆 값=사용자 입력 고유명사**.
    //   순수 한글 명칭은 숫자·괄호·마커가 없어 looksData로 못 잡음 → 라벨 근접으로 제외(라벨 자신은 시스템이라 유지). 전 경로 공통 적용(chromeOnly 무관).
    //   ⚠ **사용자 추가 항목 값 제외**(2026-09-28 사용자: "공사 업체 스맛흐슥호어 = 사용자 추가 항목 → 항목명만 확인·값 제외").
    //     업체/시공사 등 사용자 입력 고유명사 라벨 추가 → 그 옆 값은 데이터로 제외(라벨 자신=chrome은 유지).
    const NAME_LABELS = ['시설명', '장비명', '자재명', '자재 명', '품목명', '제품명', '이름', '명칭', '제목', '작업명', '작업 제목', '이슈명', '이슈 제목', '거래처명',
      '공사업체', '공사 업체', '업체', '업체명', '시공사', '시공업체', '협력업체', '공급업체', '담당업체', '제조사', '제조업체', '판매처', '구매처', '설치업체', '관리업체',
      // ⚠ 사용자 자유입력 내용 필드 라벨(2026-09-29 사용자 스크린샷: 이슈 상세 '이슈 요약' 값 "하하하" 누수) — 라벨 옆 값=사용자 입력 본문/요약/메모 제외.
      '이슈 요약', '요약', '내용', '설명', '비고', '메모', '작업 내용', '상세 내용', '조치 내용', '특이사항'];
    const nearNameLabel = (el: Element): boolean => {
      const self = ((el as HTMLElement).innerText || '').trim();
      if (NAME_LABELS.includes(self)) return false;   // 라벨 자신은 유지
      let p: Element | null = el.parentElement;
      for (let i = 0; i < 4 && p; i++) {   // depth 3→4(2026-09-29: 작업 관리 상세 작업명 값 "썸네일확인" 누수 — 라벨이 형제 아닌 더 깊은 구조)
        const sibs = Array.from(p.children).map((c) => ((c as HTMLElement).innerText || '').trim());
        if (sibs.some((s) => NAME_LABELS.includes(s))) return true;   // 같은 행/그룹에 명칭 라벨 → el은 명칭 값(데이터)
        // 가까운 조상(i<2, 필드 행 스코프)에선 라벨류 요소(label/dt/label·tit 클래스)의 **정확 매칭**도 확인(라벨이 중첩된 행 대응).
        if (i < 2) {
          const lbls = Array.from(p.querySelectorAll('label, dt, [class*="label"], [class*="tit"]')).map((l) => ((l as HTMLElement).innerText || '').replace(/\s+/g, '').trim());
          if (lbls.some((s) => NAME_LABELS.map((x) => x.replace(/\s+/g, '')).includes(s))) return true;
        }
        p = p.parentElement;
      }
      return false;
    };
    // ⚠ chrome-only: 필드 라벨 옆 **값** 제외(라벨 자신 유지) + 링크(제목=거래처명 등) 제외. 데이터 중심 모듈(거래처)용.
    const FIELD_LABELS = ['거래처명', '거래처', '사업자', '사업자번호', '대표자', '대표', '업종', '업태', '연락처', '전화', '전화번호', '휴대폰', '주소', '주요거래항목', '거래일', '거래금액', '금액', '공급가', '부가세', '품목', '수량', '단가', '비고', '거래유형', '유형', '담당', '담당자', '등록일', '등록자', '그린스피드', '예지물량', '예고', '밀도', '뿌리 길이', '관수량'];
    const nearFieldLabel = (el: Element): boolean => {
      const self = ((el as HTMLElement).innerText || '').trim();
      if (FIELD_LABELS.includes(self)) return false;   // 라벨 자신은 유지(시스템)
      let p: Element | null = el.parentElement;
      for (let i = 0; i < 3 && p; i++) {
        const sibs = Array.from(p.children).map((c) => ((c as HTMLElement).innerText || '').trim());
        if (sibs.some((s) => FIELD_LABELS.includes(s))) return true;   // 같은 행에 필드 라벨 → el은 값(데이터)
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
        if (nearNameLabel(el)) continue;                // 명칭 라벨(시설명/장비명/제목…) 옆 값 = 사용자 입력 고유명사 제외(전 경로)
        if (chromeOnly) {                               // 데이터 중심 모듈: 값·링크 제외, 라벨/버튼/헤더/안내만
          if (el.closest('a')) continue;                // 링크(카드 제목=거래처명 등) = 데이터
          // ⚠ 제목 zone 통째 제외(2026-09-28 실측): 거래처 기본/상세의 제목 zone은 100% 거래처명(사용자 데이터·고유명사).
          //   시스템 chrome(최근거래일순·조건설정·업태·대표자·placeholder)은 전부 버튼/입력라벨 zone이라 손실 없음.
          //   05-25-45 리포트서 거래처명 86건(코스조경·펌프실관리·(주)인인퍼블릭…)이 제목 zone으로 FAIL 오탐 → 근본 차단.
          if (zoneOf(el) === '제목') continue;           // 카드/리스트/상세 제목 = 거래처명 등 데이터
          if (nearFieldLabel(el)) continue;             // 필드 라벨 옆 값 = 데이터
          if (zoneOf(el) === '텍스트' && !FIELD_LABELS.includes(text) && text.length < 12 && !/[.]$|습니다|하세요|하십시오/.test(text)) continue;   // 짧은 비-라벨 텍스트=레코드 값 추정(안내문구·라벨 제외)
        }
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
    // ── **(A) 상태/우선순위 enum 배지 확장 캡처(2026-09-30 QA-15704: 이슈 상세 상태 라벨 "종료" 미검출)**:
    //   status/priority 칩이 badge-content 아닌 순수 [class*="badge"] 로 렌더되면 EXCL(`[class*=badge]:not(badge-content)`)에
    //   걸려 통째 누락됐음. 상태(종료·진행중·완료확정·대기중)·우선순위(상/중/하·높음/보통/낮음)는 **시스템 enum** → 캡처 필수.
    //   ⚠ 값 배지(수량·명칭·데이터) 재유입 방지: badge-content 는 기존 규칙(≤40), 순수 badge 는 **엄격 enum 게이트**
    //   (숫자 없음·구분자 없음·≤12자·명칭/인물/필드 라벨 근접 아님)로만 통과. base 는 FG-first reload(freshFg)라 비반응성 안전.
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll('[class*="badge"] *, [class*="badge"]'))) {
        const he = el as HTMLElement;
        if (he.children.length) continue;                 // leaf만(칩 텍스트)
        if (!isVisible(el)) continue;
        const text = (he.innerText || '').replace(/\s+/g, ' ').trim();
        if (!text || looksData(text)) continue;
        if (nearPersonLabel(el) || nearNameLabel(el)) continue;
        if (inDataCard(el) && /[:：]|\//.test(text)) continue;
        const isContent = !!el.closest('[class*="badge-content"]');
        if (isContent) {
          if (text.length > 40) continue;                 // badge-content: 기존 라벨/짧은 enum 규칙
        } else {
          // 순수 badge(값 배지 EXCL 대상) — status/priority enum 만 엄격 통과.
          if (text.length > 12 || /[:：/,]/.test(text) || /\d/.test(text)) continue;
          if (nearFieldLabel(el)) continue;
        }
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
  }, { rootSel, keepDatepicker, chromeOnly: gChromeOnly }).catch(() => [] as Slot[]);
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
  // ⚠ 스코프 폴백(2026-09-29 사용자 스크린샷: 이슈 조건설정=중요도/상태/분류/위치/조회 시스템라벨 가득한데 '슬롯0' SKIP).
  //   이 앱 조건설정 시트는 OVERLAY_SEL 클래스(modal/sheet/popup…) 밖 컨테이너 → 스코프 캡처 0 → 전체 body 폴백(map-modal crawl과 동일 선례 line 1155).
  //   landingTexts로 배경 상주 chrome 제외, gSeen dedup으로 배경 리스트 chrome 중복 흡수. KO·FG 동일 스코프라 키 정합.
  let ovRoot: string | undefined = OVERLAY_SEL;
  let ko = await captureMobileSlots(page, ovRoot);
  if (!ko.length) { ovRoot = undefined; ko = await captureMobileSlots(page); }
  if (!ko.length) { skip(meta('캡처'), '오버레이 시스템 슬롯 0(스코프·body 폴백 모두 0)'); await closeOverlay(page); return; }
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), `전환 실패: ${sw.why}`); await restoreMobileKorean(page); await closeOverlay(page); return; }
  const fg = await captureMobileSlots(page, ovRoot);
  const koByKey = new Map(ko.map((s) => [s.key, s.text]));
  let common = 0, changed = 0;
  for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
  // ⚠ 진단(2026-09-28, 사용자: "시설관리 조건설정 모달 누락") — 오버레이가 열렸는데 리포트서 안 보이는 원인 규명용.
  review({ lang: lang.ko, screen: `모바일-${screenLabel} > ${openerName}`, kind: '오버레이 진단', zone: 'crawl',
    item: `열림·KO${ko.length}·공통${common}·변경${changed}`, value: reactiveVerdict(common, changed), screenshot: '' });
  if (shouldEmitFg(common, changed)) emitMobileComparison(ko, fg, lang, tab, openerName, tcRef, gSeen);
  else if (common > 0 && changed === 0) {
    // sw.ok(전환 API 성공)인데 오버레이 텍스트가 하나도 안 바뀜 = **전체 미번역 의심**(FAIL 후보) 또는 모달 비반응.
    //   비반응이면 false FAIL 위험 → 단정 대신 NEEDS_REVIEW 로 가시화(정직). 실기기/다음 런 진단으로 확정.
    review({ lang: lang.ko, screen: `모바일-${screenLabel} > ${openerName}`, kind: '전체 미번역 의심', zone: 'i18n',
      item: `공통 ${common} 중 변경 0`, value: `한글 잔존 예: ${ko.slice(0, 6).map((s) => s.text).join(' / ')}`, screenshot: '' });
    skip(meta('대조'), `대상 전환 미반영 또는 전체 미번역(공통 ${common}·변경 0) — 진단/미번역 의심 시트 참조`);
  } else skip(meta('대조'), `대상 전환 미반영(공통 ${common}·변경 ${changed})`);
  // (P2) 오버레이 레이아웃 감사(FG 상태) — QA-15704 #12 구역칩 잘림·#6 조건설정 버튼 오버플로. 조건설정 시트는 body 폴백이라 rootSel 미지정 시 전체.
  await auditLayout(page, lang, tab, openerName, tcRef, ovRoot).catch(() => {});
  await restoreMobileKorean(page);
  // 딥: 조건설정 등 필터 모달 내 **분류 드롭다운** 옵션 대조(모달 열린·KO 상태에서). 분류 없으면 조용히 통과.
  await scanModalDropdowns(page, lang, tab, openerName, tcRef, gSeen).catch(() => {});
  await closeOverlay(page);
}

// 반응성 판정 문구(진단 review 용).
function reactiveVerdict(common: number, changed: number): string {
  if (common === 0) return '공통 슬롯 0(대조 기준 없음 — 모달 고유 시스템텍스트 부재/캡처 실패)';
  if (changed === 0) return '변경 0(전체 미번역 의심 또는 모달 비반응 — NEEDS_REVIEW)';
  return `반응성 OK(대조 수행)`;
}

// ── 코스 뷰(지도) 컨트롤 모달 스캔(2026-09-28, 사용자: "코스뷰 버튼 선택시에 노출되는 화면 누락") ──
//   코스 뷰는 지도 화면 → base 캡처만으로는 우상단 컨트롤 버튼이 여는 3개 모달이 검증에서 빠짐:
//     · 코스뷰 모달(지상/지하/3D · 전체/작업/이슈/시설/점검/관심)  · 보기옵션 모달(전체/같은위치/2분할)
//     · 관리 모달(작업 지시/일상 점검/이슈 등록 + 안내문구)
//   ⚠ 트리거 셀렉터 미상(코드에 지식 없음·라이브 불가) → **자가 탐색형 오프너**: 텍스트 트리거(관리) 우선,
//     아이콘형(코스뷰/보기옵션)은 우상단 컨트롤 클러스터의 아이콘 후보를 좌표 클릭하며 **대상 모달 제목 확인 시에만 채택**.
//     실패 시 정직 SKIP + 진단(발견 오버레이 클래스·후보 수) 기록 → 다음 런에서 셀렉터 정밀화. 비파괴(모달 view→닫기).
const MAP_MODAL_SEL = '[class*="modal"], [class*="popup"], [class*="bottom-sheet"], [class*="bottomsheet"], [class*="sheet"], [class*="dialog"]';

// 우상단 컨트롤 클러스터의 아이콘형 클릭 후보 중심좌표(좌상단 back·큰 지도·텍스트 라벨 제외).
async function mapControlCenters(page: Page): Promise<{ cx: number; cy: number }[]> {
  return page.evaluate(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const clickable = (el: Element): boolean => {
      if (el.matches('button, [role="button"], a')) return true;
      const cls = (el.className || '').toString();
      if (/button|btn|cursor-pointer|clickable|ico/.test(cls)) return true;
      return getComputedStyle(el as HTMLElement).cursor === 'pointer';
    };
    const out: { cx: number; cy: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('button, [role="button"], a, i, img, div, span'))) {
      if (!clickable(el)) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 12 || r.height < 12 || r.width > 130 || r.height > 130) continue;   // 아이콘 크기대
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < W * 0.55 || cy > H * 0.45) continue;   // 우상단 클러스터만(좌상단 back 제외)
      const t = ((el as HTMLElement).innerText || '').trim();
      if (t.length > 3) continue;                     // 텍스트 라벨(관리 등) 제외 — 아이콘 트리거만
      out.push({ cx: Math.round(cx), cy: Math.round(cy) });
    }
    const uniq: { cx: number; cy: number }[] = [];
    for (const c of out) if (!uniq.some((u) => Math.abs(u.cx - c.cx) < 8 && Math.abs(u.cy - c.cy) < 8)) uniq.push(c);
    return uniq.slice(0, 10);
  }).catch(() => [] as { cx: number; cy: number }[]);
}

// ⚠ 지도는 **Leaflet**(leaflet-layer/leaflet-pane 상주 → OVERLAY_SEL·MAP_MODAL_SEL 상시 매칭)이고, 컨트롤 시트 클래스가
//   modal/sheet류가 아님(2026-09-28 진단 확정) → **클래스 무관 위치기반 탐지**: fixed/absolute 패널 중 선두 텍스트가 제목
//   titleRe 이고 닫기(X/초기화) 어피던스를 가진 가장 안쪽(작은) 패널을 실제 시트로 보고 data-attr 태깅. 캡처는 그 태그 스코프.
//   matchAnywhere=true 면 제목(선두 줄) 대신 패널 **전체 innerText**에서 titleRe 매칭(관리 모달처럼 제목 없이 액션 항목만 있는 시트 대응).
async function tagTargetModal(page: Page, titleRe: RegExp, matchAnywhere = false): Promise<boolean> {
  return page.evaluate(({ src, anywhere }) => {
    document.querySelectorAll('[data-mlang-modal]').forEach((e) => e.removeAttribute('data-mlang-modal'));
    const re = new RegExp(src);
    const cands: { el: Element; area: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('div, section, aside'))) {
      const he = el as HTMLElement; const r = he.getBoundingClientRect();
      if (r.width < 120 || r.height < 70) continue;
      const pos = getComputedStyle(he).position;
      if (pos !== 'fixed' && pos !== 'absolute') continue;
      if (/leaflet/.test((el.className || '').toString())) continue;   // 지도 레이어 제외
      const all = (he.innerText || '');
      const first = (all.trim().split(/\n/)[0] || '').trim();
      if (anywhere ? !re.test(all) : !re.test(first)) continue;
      if (!/[×✕xX✖]|초기화|닫기/.test(all) && !he.querySelector('[class*="close"], [class*="ico-x"], [class*="btn-close"]')) continue;
      cands.push({ el: he, area: r.width * r.height });
    }
    if (!cands.length) return false;
    cands.sort((a, b) => a.area - b.area);         // 가장 안쪽(작은) 매칭 = 실제 시트(부모 래퍼 아님)
    cands[0].el.setAttribute('data-mlang-modal', '1');
    return true;
  }, { src: titleRe.source, anywhere: matchAnywhere }).catch(() => false);
}

// 언어무관 재태깅 폴백(2026-09-28): 전환 후 태그 소실(remount) 시 제목 대신 **구조**로 재확정 —
//   leaflet 아닌 fixed/absolute 패널 중 닫기 어피던스 보유·가장 안쪽(작은) 것. 모달이 열려있는 동안만 유효(비파괴 view 중).
async function tagTargetModalLangAgnostic(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    document.querySelectorAll('[data-mlang-modal]').forEach((e) => e.removeAttribute('data-mlang-modal'));
    const cands: { el: Element; area: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('div, section, aside'))) {
      const he = el as HTMLElement; const r = he.getBoundingClientRect();
      if (r.width < 120 || r.height < 70) continue;
      const pos = getComputedStyle(he).position;
      if (pos !== 'fixed' && pos !== 'absolute') continue;
      if (/leaflet/.test((el.className || '').toString())) continue;
      const all = (he.innerText || '');
      if (!/[×✕xX✖]|초기화|닫기/.test(all) && !he.querySelector('[class*="close"], [class*="ico-x"], [class*="btn-close"]')) continue;
      cands.push({ el: he, area: r.width * r.height });
    }
    if (!cands.length) return false;
    cands.sort((a, b) => a.area - b.area);
    cands[0].el.setAttribute('data-mlang-modal', '1');
    return true;
  }).catch(() => false);
}

// 대상 모달 열기 — 텍스트 트리거 우선, 없으면 아이콘 후보 좌표 클릭. tagTargetModal 로 제목 확인(클래스 무관) 시에만 true.
async function openMapControlModal(page: Page, titleRe: RegExp, textTrigger?: RegExp, matchAnywhere = false): Promise<boolean> {
  if (await tagTargetModal(page, titleRe, matchAnywhere)) return true;
  if (textTrigger) {
    const b = page.getByText(textTrigger).filter({ visible: true }).first();
    if (await b.count().catch(() => 0)) {
      await b.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 800); await killMobileAlarms(page);
      if (await tagTargetModal(page, titleRe, matchAnywhere)) return true;
      await closeMapModal(page);   // 잘못 열림 → 견고 닫기 후 아이콘 후보 시도
    }
  }
  for (const c of await mapControlCenters(page)) {
    await page.mouse.click(c.cx, c.cy).catch(() => {}); await settle(page, 700); await killMobileAlarms(page);
    if (await tagTargetModal(page, titleRe, matchAnywhere)) return true;
    await closeMapModal(page);   // 잘못 열림(3D/potree 등)은 Escape로 안 닫히는 우측 드로어 → 견고 닫기 후 다음 후보(비파괴)
  }
  return false;
}

// 태그된 모달 닫기 — **우측 드로어 견고 닫기**(2026-09-28 실측: 코스뷰/보기옵션/관리/위치선택은 우측 드로어라 트리거를 덮음 →
//   불완전 닫기 시 다음 모달 클릭 차단). ① 태그 스코프 X → ② 클래스 무관 X → ③ 우상단 X 좌표 → ④ 지도 좌측 탭 + Escape. 전부 비파괴.
async function closeMapModal(page: Page): Promise<void> {
  const tryClick = async (sel: string): Promise<boolean> => {
    const x = page.locator(sel).filter({ visible: true }).first();
    if (await x.count().catch(() => 0)) { await x.click({ timeout: 1_500 }).catch(() => {}); return true; }
    return false;
  };
  if (!(await tryClick('[data-mlang-modal] [class*="close"], [data-mlang-modal] [class*="ico-x"], [data-mlang-modal] [class*="btn-close"]'))
    && !(await tryClick('[class*="drawer"] [class*="close"], aside [class*="close"], [class*="modal"] [class*="close"], [class*="ico-x"]'))) {
    const vp = page.viewportSize(); const W = vp?.width ?? 390;
    await page.mouse.click(W - 22, 31).catch(() => {});   // 드로어 우상단 X 좌표 폴백
  }
  await settle(page, 300);
  await page.mouse.click(24, 420).catch(() => {});   // 지도 좌측(드로어 밖) 단일 탭 = dismiss(롱프레스 아님 → 비파괴)
  await page.keyboard.press('Escape').catch(() => {});
  await settle(page, 300); await killMobileAlarms(page);
  await page.evaluate(() => document.querySelectorAll('[data-mlang-modal]').forEach((e) => e.removeAttribute('data-mlang-modal'))).catch(() => {});
}

// 한 지도 컨트롤 모달 검증 — 캡처는 태그된 패널([data-mlang-modal]) 스코프.
async function scanMapModal(
  page: Page, lang: CourseLang, screenLabel: string, modalName: string, titleRe: RegExp,
  tcRef: string, gSeen: Set<string>, textTrigger?: RegExp, matchAnywhere = false,
): Promise<void> {
  const tab = `모바일-${screenLabel}`;
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${modalName}`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} ${modalName} — ${note}` });
  await restoreMobileKorean(page); await settle(page, 300); await killMobileAlarms(page);
  if (!(await openMapControlModal(page, titleRe, textTrigger, matchAnywhere))) {
    skip(meta('열기'), `${modalName} 미출현(트리거 미발견/제목 패널 부재 — 진단 시트의 '지도 fixed 패널' 참조)`); await closeMapModal(page); return;
  }
  await settle(page, 400);
  const ko = await captureMobileSlots(page, '[data-mlang-modal]');
  if (!ko.length) { skip(meta('캡처'), '모달 시스템 슬롯 0(태그 스코프 캡처 미스)'); await closeMapModal(page); return; }
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), `전환 실패: ${sw.why}`); await restoreMobileKorean(page); await closeMapModal(page); return; }
  // ⚠ 재태깅 금지(2026-09-28 진단): 이 앱 i18n은 reactive 텍스트 스왑(remount 아님) → 모달 요소·data-mlang-modal 유지됨.
  //   한국어 titleRe 재태깅은 전환 후 제목이 외국어라 매칭 실패→기존 태그 제거→스코프 소실→공통0(코스뷰/보기옵션 SKIP 근본원인).
  //   태그 잔존 시 그대로 사용, 드물게 소실(remount) 시에만 **언어무관 구조 재태깅** 폴백.
  if (!(await page.locator('[data-mlang-modal]').count().catch(() => 0))) await tagTargetModalLangAgnostic(page);
  const fg = await captureMobileSlots(page, '[data-mlang-modal]');
  const koByKey = new Map(ko.map((s) => [s.key, s.text]));
  let common = 0, changed = 0;
  for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
  // ⚠ 게이트 완화(2026-09-28 실측: 코스뷰 모달 공통10·변경1 → 20% 게이트에 걸려 SKIP인데, 랜딩 100% 번역으로 전환은 확실히 동작).
  //   전환이 이 모달에 **1개라도 도달(changed≥1)**하면 나머지 한글 잔존은 스위치 미스가 아니라 **진짜 미번역** → emit(정직 FAIL).
  //   changed==0(전혀 미반영)만 SKIP(전체 데이터 모달/스위치 미도달 구분 불가 → 보수적).
  if (shouldEmitFg(common, changed)) emitMobileComparison(ko, fg, lang, tab, modalName, tcRef, gSeen);
  else skip(meta('대조'), `대상 전환 미반영/전체 미번역 의심(공통 ${common}·변경 ${changed}) — changed 0`);
  await auditLayout(page, lang, tab, modalName, tcRef, '[data-mlang-modal]').catch(() => {});   // 모달 내 겹침/잘림/오버플로
  await restoreMobileKorean(page);
  await closeMapModal(page);
}

// 실 DOM 진단(2026-09-28): 각 우상단 아이콘/트리거 클릭 → 열리는 fixed/absolute 비-leaflet 패널의 **선두 텍스트·클래스·닫기여부** 덤프 → 닫기.
//   보기옵션/관리 모달이 "미출현"(제목 매칭 실패)인 원인을 실측으로 규명 → 다음 이터레이션서 titleRe 정밀화. 비파괴(열고 즉시 Escape).
async function diagnoseMapTriggers(page: Page): Promise<string[]> {
  const dumpPanels = async (): Promise<string[]> => page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('div, section, aside'))) {
      const he = el as HTMLElement; const r = he.getBoundingClientRect();
      if (r.width < 120 || r.height < 70) continue;
      const pos = getComputedStyle(he).position; if (pos !== 'fixed' && pos !== 'absolute') continue;
      const cls = (el.className || '').toString(); if (/leaflet/.test(cls)) continue;
      const first = ((he.innerText || '').trim().split(/\n/).slice(0, 3).join(' ⏎ ') || '').slice(0, 60);
      if (!first) continue;
      const hasClose = /[×✕xX✖]|초기화|닫기/.test(he.innerText || '') || !!he.querySelector('[class*="close"],[class*="ico-x"],[class*="btn-close"]');
      out.push(`"${first}" [${cls.slice(0, 30)}]${hasClose ? '·닫기O' : ''}`);
    }
    return Array.from(new Set(out)).slice(0, 8);
  }).catch(() => [] as string[]);
  const notes: string[] = [];
  // ⓪ **전 화면 클릭가능 요소 인벤토리**(2026-09-28 실측: 우상단 아이콘 4개는 전부 "3D 코스뷰"=potree → 보기옵션/관리는 다른 위치).
  //   클릭 없이 button/역할버튼/링크/cursor-pointer/ico 아이콘의 텍스트·위치(x,y)·클래스를 전수 덤프 → 보기옵션/관리 트리거 소재 규명.
  const inv = await page.evaluate(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const out: string[] = []; const seen = new Set<string>();
    const clickableSel = 'button, [role="button"], a, .button-common, [class*="btn"], i[class*="ico"], [class*="cursor-pointer"], [class*="control"], [class*="toolbar"] *';
    for (const el of Array.from(document.querySelectorAll(clickableSel))) {
      const he = el as HTMLElement; const r = he.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.width > W * 0.97) continue;
      if (getComputedStyle(he).visibility === 'hidden' || getComputedStyle(he).display === 'none') continue;
      if (/leaflet/.test((el.className || '').toString())) continue;
      const t = norm(he.innerText || he.getAttribute('aria-label') || '');
      const cls = (el.className || '').toString().replace(/\s+/g, '.').slice(0, 24);
      const label = t.slice(0, 18) || `(아이콘:${el.tagName.toLowerCase()}.${cls || '?'})`;
      const zone = `${r.left < W * 0.33 ? 'L' : r.left > W * 0.66 ? 'R' : 'C'}${r.top < H * 0.33 ? 'T' : r.top > H * 0.66 ? 'B' : 'M'}`;   // 9분할 위치
      const key = label + '|' + zone;
      if (seen.has(key)) continue; seen.add(key);
      out.push(`${label}@${zone}(${Math.round(r.left)},${Math.round(r.top)})`);
    }
    return out.slice(0, 40);
  }).catch(() => [] as string[]);
  if (inv.length) notes.push(`[클릭가능 인벤토리 ${inv.length}] ${inv.join(' · ')}`);
  // ① 우상단 아이콘 클릭-프로브(3D 코스뷰 등 확인용).
  const centers = await mapControlCenters(page);
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    await page.mouse.click(c.cx, c.cy).catch(() => {}); await settle(page, 600); await killMobileAlarms(page);
    const panels = await dumpPanels();
    if (panels.length) notes.push(`아이콘#${i}(${c.cx},${c.cy})→ ${panels.join(' || ')}`);
    await page.keyboard.press('Escape').catch(() => {}); await settle(page, 250);
  }
  // ② 텍스트 트리거 프로브 — 보기옵션/관리/옵션/보기 계열.
  for (const re of [/^\s*관리\s*$/, /보기\s*옵션/, /^\s*옵션\s*$/, /^\s*보기\s*$/]) {
    const b = page.getByText(re).filter({ visible: true }).first();
    if (!(await b.count().catch(() => 0))) continue;
    const bx = await b.boundingBox().catch(() => null);
    await b.click({ timeout: 2_000 }).catch(() => {}); await settle(page, 600); await killMobileAlarms(page);
    const panels = await dumpPanels();
    notes.push(`텍스트'${re.source}'@(${bx ? Math.round(bx.x) + ',' + Math.round(bx.y) : '?'})→ ${panels.join(' || ') || '패널 무출현'}`);
    await page.keyboard.press('Escape').catch(() => {}); await settle(page, 250);
  }
  return notes;
}

// ── 지도 작업/일상점검/이슈 마커 → 정보 모달 딥 스캔(2026-09-29, 사용자: 위치선택→[선택]→작업 모음 클러스터→개별 마커→정보 모달) ──
//   ⚠ **네이티브 지도 상호작용**(Leaflet 마커·클러스터 부채꼴)이라 취약·데이터 의존 → **best-effort + 정직 SKIP/진단**([[course-mobile-explore-design]] 에뮬 한계).
//   비파괴: 위치선택 [선택]=지도 필터(뷰만)·마커 클릭=정보 조회. 정보 모달 내 '상세보기'/링크·'선택' 이후 저장류는 클릭 안 함. 정보 모달 chrome(상태/기간/조장/등록자/중요도/작업No 라벨·enum·제목)만 대조, 데이터(작업명·인명·날짜·번호) 제외.
async function scanMapWorkMarkers(page: Page, lang: CourseLang, screenLabel: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const tab = `모바일-${screenLabel}`;
  const meta = (sub: string, note: string): CheckMeta => ({ path: `${tab} > ${sub}`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} ${sub} — ${note}` });
  await restoreMobileKorean(page); await settle(page, 400); await killMobileAlarms(page);

  // ① (best-effort) 위치선택으로 코스/홀 필터 — 드롭다운 선택 후 [선택](비파괴 필터). 옵션 없거나 실패해도 base 마커로 진행.
  const locNote: string[] = [];
  try {
    if (await openMapControlModal(page, /^위치\s*선택/, /코스\s*\/\s*홀\s*\/\s*구역/)) {
      // vue-select 드롭다운 순서대로 첫 유효 옵션 선택(코스→홀). South/1번홀 우선, 없으면 첫 옵션.
      const picks = ['South', '1'];
      const toggles = page.locator('[data-mlang-modal] .vs__dropdown-toggle, [data-mlang-modal] [class*="select"]').filter({ visible: true });
      const n = Math.min(await toggles.count().catch(() => 0), 2);
      for (let i = 0; i < n; i++) {
        await toggles.nth(i).click({ timeout: 2_000 }).catch(() => {}); await settle(page, 500);
        const opts = page.locator('.vs__dropdown-menu li, [class*="option"]').filter({ visible: true });
        const oc = await opts.count().catch(() => 0);
        if (!oc) continue;
        let picked = -1;
        for (let k = 0; k < oc; k++) { const t = (await opts.nth(k).innerText().catch(() => '')).trim(); if (t.includes(picks[i])) { picked = k; break; } }
        await opts.nth(picked >= 0 ? picked : 0).click({ timeout: 2_000 }).catch(() => {}); await settle(page, 500);
      }
      const selBtn = page.locator('[data-mlang-modal]').getByText(/^\s*선택\s*$/).filter({ visible: true }).first();
      if (await selBtn.count().catch(() => 0)) { await selBtn.click({ timeout: 2_000 }).catch(() => {}); await settle(page, 1_200); locNote.push('위치선택 필터 적용'); }
      else { locNote.push('[선택] 버튼 미발견'); await closeMapModal(page); }
    } else locNote.push('위치선택 모달 미출현');
  } catch (e) { locNote.push('위치선택 예외:' + String(e).slice(0, 40)); }
  await killMobileAlarms(page); await settle(page, 600);

  // ② 지도 마커 구조 진단 + 클러스터 클릭 대상 좌표 수집(숫자 배지 = 작업 모음 클러스터).
  const markerProbe = await page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 6 && r.height > 6; };
    const icons = Array.from(document.querySelectorAll('.leaflet-marker-icon, [class*="marker"], [class*="cluster"]')).filter(vis);
    const sample = icons.slice(0, 10).map((e) => { const r = (e as HTMLElement).getBoundingClientRect(); const t = ((e as HTMLElement).innerText || '').trim().slice(0, 6); const c = (e.className || '').toString().slice(0, 26); return `${t || '·'}@${Math.round(r.left + r.width / 2)},${Math.round(r.top + r.height / 2)}[${c}]`; });
    // 숫자 배지(작업 모음 클러스터) 중심 좌표
    const clusters = icons.filter((e) => /^\d+$/.test(((e as HTMLElement).innerText || '').trim())).map((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; });
    return { total: icons.length, sample, clusters };
  }).catch(() => ({ total: 0, sample: [] as string[], clusters: [] as { cx: number; cy: number }[] }));
  review({ lang: lang.ko, screen: tab, kind: '지도 마커 진단', zone: 'marker',
    item: `위치선택: ${locNote.join('·') || '미수행'} · 마커 ${markerProbe.total}개·클러스터 ${markerProbe.clusters.length}개`,
    value: markerProbe.sample.join(' / ') || '마커 미발견(데이터 없음/canvas 렌더)', screenshot: '' });

  if (!markerProbe.clusters.length) {
    skip(meta('작업/일상점검/이슈 정보', '마커'), `작업 모음 클러스터 마커 미발견(해당 위치 데이터 없음 또는 canvas 마커 — 진단 시트 참조)`);
    return;
  }

  // ③ 클러스터 클릭 → 부채꼴 펼침 → 개별 마커 순회 클릭 → 정보 모달(작업/일상점검/이슈 정보) 3종 캡처·대조.
  const INFO_TITLES: { name: string; re: RegExp }[] = [
    { name: '작업 정보', re: /^작업\s*정보/ }, { name: '일상점검 정보', re: /^일상\s*점검\s*정보/ }, { name: '이슈 정보', re: /^이슈\s*정보/ },
  ];
  const done = new Set<string>();
  for (const cl of markerProbe.clusters.slice(0, 3)) {
    if (done.size >= INFO_TITLES.length) break;
    await page.mouse.click(cl.cx, cl.cy).catch(() => {}); await settle(page, 900); await killMobileAlarms(page);
    // 펼쳐진 개별 마커(숫자 아닌 아이콘) 좌표 재수집.
    const spread = await page.evaluate(() => {
      const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 6 && r.height > 6; };
      return Array.from(document.querySelectorAll('.leaflet-marker-icon, [class*="marker"]')).filter(vis)
        .filter((e) => !/^\d+$/.test(((e as HTMLElement).innerText || '').trim()))   // 숫자 클러스터 제외 = 개별 마커
        .slice(0, 12).map((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; });
    }).catch(() => [] as { cx: number; cy: number }[]);
    for (const mk of spread) {
      if (done.size >= INFO_TITLES.length) break;
      await page.mouse.click(mk.cx, mk.cy).catch(() => {}); await settle(page, 800); await killMobileAlarms(page);
      // 어떤 정보 모달이 열렸는지 제목으로 식별.
      let matched: { name: string; re: RegExp } | null = null;
      for (const it of INFO_TITLES) { if (done.has(it.name)) continue; if (await tagTargetModal(page, it.re)) { matched = it; break; } }
      if (!matched) { await closeMapModal(page); continue; }   // 정보 모달 아님/이미 처리 → 닫고 다음 마커
      done.add(matched.name);
      const ko = await captureMobileSlots(page, '[data-mlang-modal]');
      if (ko.length) {
        const sw = await switchMobileLangRuntime(page, lang);
        if (sw.ok) {
          if (!(await page.locator('[data-mlang-modal]').count().catch(() => 0))) await tagTargetModalLangAgnostic(page);
          const fg = await captureMobileSlots(page, '[data-mlang-modal]');
          const m = new Map(ko.map((s) => [s.key, s.text])); let c = 0, ch = 0;
          for (const f of fg) { if (m.has(f.key)) { c++; if (m.get(f.key) !== f.text) ch++; } }
          if (shouldEmitFg(c, ch)) emitMobileComparison(ko, fg, lang, tab, matched.name, tcRef, gSeen);
          else skip(meta(matched.name, '대조'), `대상 전환 미반영/전체 미번역 의심(공통 ${c}·변경 ${ch})`);
          await auditLayout(page, lang, tab, matched.name, tcRef, '[data-mlang-modal]').catch(() => {});
        } else skip(meta(matched.name, '대상 렌더'), sw.why);
        await restoreMobileKorean(page);
      } else skip(meta(matched.name, '캡처'), '정보 모달 슬롯 0');
      await closeMapModal(page);   // 비파괴(상세보기/링크 미클릭)
    }
  }
  const missing = INFO_TITLES.filter((it) => !done.has(it.name)).map((it) => it.name);
  if (missing.length) skip(meta('작업/일상점검/이슈 정보', '마커'), `일부 정보 모달 미도달(${missing.join('/')}) — 해당 유형 마커 부재/데이터 의존`);
}

// 코스 뷰 3모달 스캔 오케스트레이터 + 실패 대비 진단(발견 오버레이·아이콘 후보 수).
async function scanCourseViewModals(page: Page, lang: CourseLang, screenLabel: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  await restoreMobileKorean(page); await settle(page, 300);
  // ⚠ 맵-로드 대기(2026-09-28 실측: monitorMap KO 1슬롯·아이콘 4개 = Leaflet 맵/컨트롤 비동기 로드로 캡처가 너무 이름 → 모달 미출현 flake).
  //   우상단 컨트롤(아이콘 후보) ≥2개 나타날 때까지 최대 ~9s 폴링 후 스캔. 맵이 끝내 안 뜨면 진단만 남기고 진행(정직).
  for (let i = 0; i < 9; i++) {
    if ((await mapControlCenters(page)).length >= 2) break;
    await settle(page, 1_000); await killMobileAlarms(page);
  }
  const probe = await page.evaluate((sel) => ({
    overlays: Array.from(document.querySelectorAll(sel)).map((e) => (e.className || '').toString().slice(0, 40)).slice(0, 12),
  }), OVERLAY_SEL).catch(() => ({ overlays: [] as string[] }));
  const centers = await mapControlCenters(page);
  review({ lang: lang.ko, screen: `모바일-${screenLabel}`, kind: '지도 모달 진단', zone: 'crawl',
    item: `아이콘 후보 ${centers.length}개`, value: `상주 오버레이 클래스: ${probe.overlays.join(' / ') || '없음'}`, screenshot: '' });
  // ⚠ 실 UI 확정(2026-09-28 사용자 스크린샷): 코스뷰 화면 = 우측 드로어 4종. 트리거 = 우상단 스택(코스뷰 원형아이콘·보기옵션 ⛶아이콘·관리 텍스트pill) + 좌상단 브레드크럼(위치선택).
  //   드로어 제목이 명확(코스뷰/보기옵션/관리/위치선택) → **선두줄 앵커 매칭**으로 "3D 코스뷰"(potree) 오매칭 방지. 아이콘형은 mapControlCenters, 텍스트형은 트리거.
  // 코스뷰(지상/지하/3D·전체/작업/이슈/시설/점검/관심) — 우상단 원형 아이콘. /^코스뷰/ 앵커(3D 코스뷰 potree 제외).
  await scanMapModal(page, lang, screenLabel, '코스뷰 모달', /^코스\s*뷰/, tcRef, gSeen);
  // 보기옵션(전체/같은위치/2분할) — 우상단 ⛶ 아이콘.
  await scanMapModal(page, lang, screenLabel, '보기옵션 모달', /^보기\s*옵션/, tcRef, gSeen);
  // 관리(작업 지시/일상 점검/이슈 등록 + 안내문구) — 우상단 "관리" 텍스트 pill. 드로어 제목 "관리".
  await scanMapModal(page, lang, screenLabel, '관리 모달', /^관리/, tcRef, gSeen, /^\s*관리\s*$/);
  // 위치선택(코스/홀/구역 드롭다운 + 취소/선택) — 좌상단 "코스 / 홀 / 구역" 브레드크럼. 드로어 제목 "위치선택".
  await scanMapModal(page, lang, screenLabel, '위치선택 모달', /^위치\s*선택/, tcRef, gSeen, /코스\s*\/\s*홀\s*\/\s*구역/);
  // 딥: 위치선택 필터 → 작업 모음 클러스터 마커 → 개별 마커 → 작업/일상점검/이슈 정보 모달(best-effort·데이터 의존·비파괴).
  await scanMapWorkMarkers(page, lang, screenLabel, tcRef, gSeen).catch(() => {});
  // 진단: 각 트리거로 실제 열리는 패널 제목/클래스 덤프(보기옵션/관리 미출현 원인 규명 → titleRe 정밀화용). 비파괴.
  await restoreMobileKorean(page); await settle(page, 300); await killMobileAlarms(page);
  const trigNotes = await diagnoseMapTriggers(page).catch(() => [] as string[]);
  review({ lang: lang.ko, screen: `모바일-${screenLabel}`, kind: '지도 트리거→패널 진단', zone: 'crawl',
    item: `${trigNotes.length}개 트리거서 패널 포착`, value: trigNotes.join('  §  ') || '어떤 트리거에서도 fixed/absolute 비-leaflet 패널 미포착', screenshot: '' });
}

// ── 코스정보(submission) 허브 하위 모듈 스캔(2026-09-28, 사용자: 코스운영/잔디측정/토양측정/발병/거래처 상세·편집·[?]·신규등록 누락) ──
//   코스정보는 route 없는 하위 모듈 허브 → **허브 타일 클릭**으로 진입. 각 모듈=리스트 패턴이라 기존 딥 스캔 전면 재사용.
//   ⚠ 모듈마다 하드 재진입(enterMobileScreenKorean→submission→타일)으로 상태 오염 격리. 모듈별 전용 시트(모바일-<모듈>)·전용 dedup.
const COURSE_INFO_SUBS: { label: string; tile: string; reg?: string; sort?: boolean; help?: boolean; detail?: boolean; cond?: boolean; calendar?: boolean; dataHeavy?: boolean }[] = [
  { label: '코스운영정보', tile: '코스 운영 정보', calendar: true },
  { label: '잔디측정정보', tile: '잔디 측정 정보', reg: '신규 등록', sort: true, help: true, detail: true, cond: true },
  { label: '토양측정정보', tile: '토양 측정 정보', reg: '신규 등록', sort: true, help: true, detail: true, cond: true },
  { label: '발병정보', tile: '발병 정보', reg: '신규 등록', sort: true, help: true, detail: true, cond: true },
  { label: '거래처정보', tile: '거래처 정보', reg: '신규 등록', sort: true, help: true, detail: true, cond: true, dataHeavy: true },
];

// 코스정보 허브 → 하위 모듈 타일 클릭 진입(헤더 타이틀로 확정). 매번 하드 재진입(오염 격리).
async function enterCourseInfoSub(page: Page, tile: string): Promise<boolean> {
  await enterMobileScreenKorean(page, '코스정보', 'submission');
  await settle(page, 500); await killMobileAlarms(page);
  const before = page.url();
  const t = page.getByText(new RegExp(`^\\s*${tile.replace(/\s+/g, '\\s*')}\\s*$`)).filter({ visible: true }).first();
  if (!(await t.count().catch(() => 0))) return false;
  await t.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 1_000); await killMobileAlarms(page);
  const norm = (s: string) => s.replace(/\s+/g, '');
  const hdrs = await headerTitles(page).catch(() => [] as string[]);
  return hdrs.some((h) => norm(h).includes(norm(tile))) || page.url() !== before;
}

// 하위 모듈 리스트 → 항목 상세 진입(제목 링크/카드 클릭 → 상세 헤더 신호). 편집/삭제는 크롤(파괴가드)이 커버.
function courseInfoDetailNav(page: Page): () => Promise<boolean> {
  return async () => {
    const before = page.url();
    const reached = async () => page.url() !== before || (await headerTitles(page).then((hs) => hs.some((h) => /상세/.test(h))).catch(() => false));
    // 리스트 카드/제목 링크(파란 링크 텍스트) 클릭 — 날짜 담긴 카드 우선.
    const clicked = await page.evaluate(() => {
      const DATE = /\d{4}[-.]\d{2}[-.]\d{2}/;
      const cards = Array.from(document.querySelectorAll('[class*="bd-dde3ec"], [class*="bd-0b7f"], [class*="bdr-14"], [class*="-card"], [class*="bdr-12"], a'))
        .filter((c) => { const r = (c as HTMLElement).getBoundingClientRect(); return r.width > 40 && r.height > 30; });
      if (!cards.length) return false;
      const dated = cards.find((c) => DATE.test((c as HTMLElement).innerText || ''));
      (((dated || cards[0]) as HTMLElement)).click(); return true;
    }).catch(() => false);
    if (!clicked) return false;
    await settle(page, 1_000); await killMobileAlarms(page);
    return await reached();
  };
}

// 캘린더형(코스 운영 정보) — base 가 선택일 상세(첫 티업/마지막 티업/총 팀수)를 포함하지만, 데이터 있는 날짜(선택/오늘 마커) 추가 클릭.
async function scanCalendarDayDetail(page: Page, lang: CourseLang, screenLabel: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const tab = `모바일-${screenLabel}`;
  const meta = (note: string): CheckMeta => ({ path: `${tab} > 날짜상세`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 코스 운영 날짜상세 — ${note}` });
  await restoreMobileKorean(page); await settle(page, 300);
  const marker = page.getByText(/^\s*(선택|오늘)\s*$/).filter({ visible: true }).first();
  if (await marker.count().catch(() => 0)) { await marker.click({ timeout: 2_000 }).catch(() => {}); await settle(page, 700); }
  const ko = await captureMobileSlots(page);
  if (!ko.length) { skip(meta('캡처'), '날짜상세 슬롯 0'); return; }
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), sw.why); await restoreMobileKorean(page); return; }
  const fg = await captureMobileSlots(page);
  const m = new Map(ko.map((s) => [s.key, s.text])); let c = 0, ch = 0;
  for (const f of fg) { if (m.has(f.key)) { c++; if (m.get(f.key) !== f.text) ch++; } }
  if (shouldEmitFg(c, ch)) emitMobileComparison(ko, fg, lang, tab, '날짜상세', tcRef, gSeen);
  else skip(meta('대조'), `대상 전환 미반영(공통 ${c}·변경 ${ch})`);
  await restoreMobileKorean(page);
}

async function scanCourseInfoHub(page: Page, lang: CourseLang, tcRef: string, landingTexts: Set<string>, gSeen: Set<string>, destructiveOk: boolean): Promise<void> {
  // ⚠ 허브 타일명(기상/코스운영/잔디측정/토양측정/발병/거래처 정보)은 하위 모듈 진입 후에도 스택 잔존 → 각 모듈서 반복 캡처
  //   (거래처 base FAIL 122건 상당수가 이것). 허브 base(코스정보 시트)에서 1회만 검증하고 하위 모듈선 제외 → landingTexts 편입.
  for (const t of ['기상 정보', '코스 운영 정보', '잔디 측정 정보', '토양 측정 정보', '발병 정보', '거래처 정보']) landingTexts.add(t);
  for (const sub of COURSE_INFO_SUBS) {
    // ⚠ **IA 계층 반영**(2026-09-29 사용자: 거래처/잔디측정 등이 대메뉴처럼 시트 분리돼 혼란·코스정보 대메뉴가 빈 것처럼 보임):
    //   label 을 `코스 정보 입력 > <하위>`로 중첩 → 리포터가 경로 첫 세그먼트(모바일-코스 정보 입력)로 그룹핑 = **한 시트**,
    //   커버리지 화면(depth-2)=하위모듈명. 즉 대메뉴=코스 정보 입력, 하위메뉴=거래처정보/잔디측정정보/…로 계층 표시.
    const nest = `코스 정보 입력 > ${sub.label}`;
    if (overBudget()) { skip({ path: `모바일-${nest} > 기본`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 시간 예산 초과` }, '시간 예산 초과 — 코스정보 하위 모듈 미수행(MLANG_SCREENS=코스정보 로 별도 런 권장)'); continue; }
    // ⚠ 데이터 중심 모듈(거래처)은 chrome-only(사용자 확정) — 레코드 값(거래처명·대표·업종·금액) 제외, 시스템 텍스트만.
    gChromeOnly = sub.dataHeavy === true;
    const g = new Set<string>();   // 모듈별 dedup(모듈 간 공통 라벨 반복 허용=모듈별 완결 커버)
    // 1) base(진입+대조) — verifyMobileScreen 재사용(자체 진입 fn·진입 실패 시 진단/skip).
    const koTexts = await verifyMobileScreen(page, lang, nest, tcRef, () => enterCourseInfoSub(page, sub.tile), landingTexts, g).catch(() => [] as string[]);
    if (!koTexts.length) continue;
    const tab = `모바일-${nest}`;
    // 리스트 상태 유지 스캔(재진입 불필요): [?]·조건설정·정렬.
    if (sub.help) await scanTooltips(page, lang, tab, '기본', tcRef, g).catch(() => {});   // [?] 도움말 모달
    if (sub.cond) await scanOverlay(page, lang, nest, '조건설정', tcRef, async () => {   // 조건설정(+분류 드롭다운)
      const b = page.getByText(/^\s*조건설정\s*$/).filter({ visible: true }).first();
      if (!(await b.count().catch(() => 0))) return false;
      await b.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 900); return true;
    }, g).catch(() => {});
    if (sub.sort) await scanSortToggle(page, lang, nest, tcRef, g).catch(() => {});   // 정렬(토글/모달 자동 판별 — 거래처 최근거래일순 포함)
    // 네비게이션형(폼/상세) — 재진입 1회로 묶음(reg 가 back 으로 리스트 복귀 → detail 은 재진입 없이 이어감. 비용 절감).
    if ((sub.reg || sub.detail) && await enterCourseInfoSub(page, sub.tile)) {
      if (sub.reg) await scanRegForm(page, lang, nest, sub.reg, tcRef, landingTexts, g).catch(() => {});   // 신규 등록 폼(+취소확인) → 리스트 복귀
      if (sub.detail) await scanNavScreen(page, lang, nest, '상세', tcRef, courseInfoDetailNav(page), landingTexts, g, true, destructiveOk, true).catch(() => {});   // 상세 + ⋮ 편집/삭제 크롤
    }
    if (sub.calendar) await scanCalendarDayDetail(page, lang, nest, tcRef, g).catch(() => {});
    gChromeOnly = false;   // 모듈 종료 시 원복(다음 모듈/화면 누수 방지)
  }
  gChromeOnly = false;
}

// ── 조건설정 모달 내 분류 드롭다운 옵션 스캔(2026-09-28, 사용자: "조건설정 분류 상세 항목 누락") ──
//   조건설정 모달은 열지만 내부 vue-select(1분류/2분류·2분류/3분류 캐스케이드)를 **펼치지 않아** 옵션값이 누락.
//   사용자 확인: 분류 항목값 = **시스템 번역 대상** → 각 드롭다운 열어 옵션 캡처 → KO↔대상 대조(PASS/FAIL).
//   ⚠ **"분류" 라벨 트리거만** 타겟(작업자별=조장/작업자 인명 데이터 드롭다운 오검증 방지). 비파괴(옵션 열람만, 선택 안 함).
const DD_OPT_SEL = '[class*="dropdown-menu"], [class*="dropdown-option"], [class*="vs__dropdown"], [role="listbox"], [role="option"], [class*="option-list"], [class*="select-list"], [class*="slot-item"], li[class*="option"]';
const ddOptionsOpen = (page: Page) => page.locator(DD_OPT_SEL).filter({ visible: true }).count().then((c) => c > 0).catch(() => false);

// 오버레이 내 "분류" 셀렉트 트리거 중심좌표(작업자별/기간/상태 제외 — 텍스트에 '분류' 포함 + 셀렉트 어피던스).
async function ddTriggerCenters(page: Page): Promise<{ cx: number; cy: number }[]> {
  return page.evaluate((ovSel) => {
    const overlays = Array.from(document.querySelectorAll(ovSel)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
    const out: { cx: number; cy: number }[] = [];
    for (const ov of overlays) {
      for (const el of Array.from(ov.querySelectorAll('*'))) {
        const he = el as HTMLElement;
        const t = (he.innerText || '').replace(/\s+/g, ' ').trim();
        if (!/분류/.test(t) || t.length > 14) continue;           // 1분류/2분류/2분류 전체/3분류 전체 등 트리거만
        const cls = (el.className || '').toString();
        const selectish = el.matches('[class*="select"], [class*="dropdown"], [class*="vs__"], select') || /select|dropdown|vs__/.test(cls)
          || !!el.querySelector('[class*="arrow"], [class*="chevron"], svg, [class*="ico"]');
        if (!selectish && getComputedStyle(he).cursor !== 'pointer') continue;
        const r = he.getBoundingClientRect();
        if (r.width < 40 || r.height < 20 || r.height > 90) continue;   // 셀렉트 행 크기대
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        if (out.some((s) => Math.abs(s.cx - cx) < 10 && Math.abs(s.cy - cy) < 10)) continue;
        out.push({ cx, cy });
      }
    }
    return out.slice(0, 4);
  }, OVERLAY_SEL).catch(() => [] as { cx: number; cy: number }[]);
}

// 열린 조건설정 오버레이 내 분류 드롭다운들을 KO/대상 각각 펼쳐 옵션 대조. page 는 호출 시 KO·오버레이 열림 상태 가정.
async function scanModalDropdowns(page: Page, lang: CourseLang, tab: string, sub: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${sub}·분류`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} ${sub} 분류 드롭다운 — ${note}` });
  const centers = await ddTriggerCenters(page);
  if (!centers.length) return;   // 분류 드롭다운 없는 오버레이 → 조용히 통과(정렬/기타)
  // KO 패스: 각 트리거 열어 옵션 캡처(Escape 로 옵션만 닫고 모달 유지).
  const koByIdx: Slot[][] = [];
  for (const c of centers) {
    await page.mouse.click(c.cx, c.cy).catch(() => {}); await settle(page, 600); await killMobileAlarms(page);
    const opts = (await ddOptionsOpen(page)) ? await captureMobileSlots(page, DD_OPT_SEL) : [];
    koByIdx.push(opts);
    await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300);
  }
  const total = koByIdx.reduce((a, o) => a + o.length, 0);
  if (!total) { skip(meta('옵션'), `분류 드롭다운 ${centers.length}개 열림·옵션 0(비활성/캐스케이드 미선택 — 상위 분류 선택 후에만 노출)`); return; }
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), `전환 실패: ${sw.why}`); await restoreMobileKorean(page); return; }
  const centersFg = await ddTriggerCenters(page);   // reflow 대비 재열거(인덱스 매칭)
  for (let i = 0; i < centers.length; i++) {
    if (!koByIdx[i]?.length) continue;
    const c = centersFg[i] || centers[i];
    await page.mouse.click(c.cx, c.cy).catch(() => {}); await settle(page, 600); await killMobileAlarms(page);
    const fgOpts = (await ddOptionsOpen(page)) ? await captureMobileSlots(page, DD_OPT_SEL) : [];
    await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300);
    emitMobileComparison(koByIdx[i], fgOpts, lang, tab, `${sub}·분류${i + 1}`, tcRef, gSeen);
  }
  await restoreMobileKorean(page);
}

// ── 정렬 토글(최신순↔과거순) 스캔(2026-09-28, 사용자: "과거순 누락 — 최신순 선택 시 변환됨") ──
//   정렬은 팝업 없는 **인플레이스 토글** → 기본값 "최신순"만 보이고 "과거순"은 토글 후에만 노출. 두 상태 라벨을 모두 대조.
//   비파괴: 정렬 순서(view)만 변경 → 검증 후 **원래 순서로 원복**(토글 back). 커밋 없음.
// ⚠ 정렬 스캔 진단(2026-09-29, 사용자: SKIP 점검) — scanSortToggle 이 전 화면 0/6 성립 → 실 정렬 UI 구조 규명용.
//   비파괴(read-only page.evaluate). 정렬 영역 후보(SORT_RE 텍스트·ico-sort 아이콘·class*=sort)를 덤프해 다음 런에서 정밀 보강.
async function sortDiag(page: Page, lang: CourseLang, tab: string, branch: string): Promise<void> {
  const info = await page.evaluate(() => {
    const R = /(최신순|과거순|이름순|등록순|최근순|가나다순|최근거래일순|오래된거래순|거래일순|정렬)/;
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
    const desc = (el: Element) => {
      const r = el.getBoundingClientRect();
      const t = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      return `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 3).join('.')}[${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]="${t}"`;
    };
    const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    const textHits = all.filter((e) => e.children.length === 0 && R.test((e.innerText || e.textContent || '').trim()) && vis(e)).slice(0, 6).map(desc);
    const iconHits = all.filter((e) => /ico[-_]?sort|sort[-_]?ico|arrow[-_]?(up|down)|order/i.test((e.className || '').toString()) && vis(e)).slice(0, 6).map(desc);
    const classHits = all.filter((e) => /sort|order|align/i.test((e.className || '').toString()) && !/ico/i.test((e.className || '').toString()) && vis(e)).slice(0, 4).map(desc);
    return { textHits, iconHits, classHits };
  }).catch(() => ({ textHits: [] as string[], iconHits: [] as string[], classHits: [] as string[] }));
  review({ lang: lang.ko, screen: `${tab} > 정렬`, kind: '정렬 UI 진단', zone: 'sort',
    item: `SKIP원인=${branch}`,
    value: `텍스트후보[${info.textHits.length}]: ${info.textHits.join(' / ') || '(없음)'} || 아이콘후보[${info.iconHits.length}]: ${info.iconHits.join(' / ') || '(없음)'} || class후보[${info.classHits.length}]: ${info.classHits.join(' / ') || '(없음)'}`,
    screenshot: '' });
}

// 정렬 옵션 직접 열거(2026-09-30, QA-15704 #7: 이슈/예측 '과거 등록순' 영어 미번역 미검출) —
//   captureMobileSlots(body) 폴백은 옵션이 zone 규칙에 안 걸리거나 base dedup(gSeen)에 눌려 유실됨.
//   → SORT_RE 매칭 **가시 leaf 를 domPath 키로 직접 채취**(과거 등록순 등 전 옵션 확실 확보). reSrc=SORT_RE.source.
async function readSortOptionSlots(page: Page, reSrc: string): Promise<Slot[]> {
  return await page.evaluate((reSrc) => {
    const RE = new RegExp(reSrc);
    const domPath = (el: Element): string => {
      const parts: string[] = []; let node: Element | null = el; let depth = 0;
      while (node && node.nodeType === 1 && node.tagName !== 'BODY' && depth < 14) {
        let seg = node.tagName.toLowerCase(); const p: Element | null = node.parentElement;
        if (p) { const same = Array.from(p.children).filter((c) => c.tagName === node!.tagName); if (same.length > 1) seg += `:nth-of-type(${same.indexOf(node) + 1})`; }
        parts.unshift(seg); node = node.parentElement; depth++;
      }
      return parts.join('>');
    };
    const out: any[] = []; const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if ((el as HTMLElement).children.length) continue;   // leaf만
      const t = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!RE.test(t)) continue;
      const r = (el as HTMLElement).getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) continue;
      const key = 'sortopt|' + domPath(el); if (seen.has(key)) continue; seen.add(key);
      out.push({ key, zone: '버튼/선택', text: t, clip: false, ell: false });
    }
    return out;
  }, reSrc).catch(() => [] as Slot[]);
}

// FG(대상 언어) 정렬 옵션 텍스트 — KO에서 찾은 **동일 domPath**의 현재 텍스트를 언어무관하게 재독(2026-09-30 버그수정).
//   ⚠ FG를 SORT_RE로 필터하면 번역된 옵션(예 '과거 등록순'→'Cũ nhất')이 한국어 정규식에 안 걸려 0건 → 공통0 SKIP.
//   → 옵션 발견(KO)은 SORT_RE로, FG는 그 key(domPath)를 CSS 셀렉터로 querySelector 하여 텍스트만 읽음.
async function readTextAtSortPaths(page: Page, keys: string[]): Promise<Slot[]> {
  return await page.evaluate((keys) => {
    const out: any[] = [];
    for (const key of keys) {
      const sel = key.replace(/^sortopt\|/, '');
      let el: Element | null = null;
      try { el = document.querySelector(sel); } catch { el = null; }
      if (!el) continue;
      const t = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      out.push({ key, zone: '버튼/선택', text: t, clip: false, ell: false });
    }
    return out;
  }, keys).catch(() => [] as Slot[]);
}

async function scanSortToggle(page: Page, lang: CourseLang, screenLabel: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const tab = `모바일-${screenLabel}`;
  const meta = (note: string): CheckMeta => ({ path: `${tab} > 정렬`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 정렬 토글 — ${note}` });
  await restoreMobileKorean(page); await settle(page, 300); await killMobileAlarms(page);
  // ⚠ 실 정렬 UI 재구현(2026-09-29 진단 실측): 화면마다 상이 —
  //   · 이슈="최근 등록순" 텍스트 + i.ico-arrow-down  · 거래처="최근거래일순"→모달(최근거래일순/과거거래일순/이름순)
  //   · 시설/자재=i.ico-sort 아이콘(텍스트 라벨은 상태표시일 뿐 클릭해도 인플레이스 토글 안 됨)  · 작업지시/장비=아이콘 추정.
  //   결론: **대부분 아이콘(ico-sort/ico-arrow-down) 트리거 → 옵션 모달**. 트리거를 아이콘 우선으로 잡고, 모달 캡처는 body 폴백.
  const SORT_RE = /^\s*(최신순|과거순|이름순|가나다순|최근\s*등록순|과거\s*등록순|오래된\s*등록순|등록순|최근거래일순|과거거래일순|오래된거래(일)?순|거래일순|최근순|오래된순)\s*$/;
  const readLabel = () => page.getByText(SORT_RE).filter({ visible: true }).first().innerText().catch(() => '').then((s) => (s || '').trim());
  const iconTrig = () => page.locator('i[class*="ico-sort"], i[class*="ico-arrow-down"], [class*="ico-sort"]').filter({ visible: true }).first();
  const textTrig = () => page.getByText(SORT_RE).filter({ visible: true }).first();
  const hasIcon = await iconTrig().count().catch(() => 0);
  const hasText = await textTrig().count().catch(() => 0);
  if (!hasIcon && !hasText) { skip(meta('트리거'), '정렬 트리거(아이콘/텍스트) 미발견'); await sortDiag(page, lang, tab, '트리거 미발견').catch(() => {}); return; }
  const preLabel = await readLabel();   // 현재 정렬 상태 라벨(있으면 — 인플레이스 판정용)
  // ⚠ 옵션 전개 판정(2026-09-30 QA-15704 #7): 클릭 전/후 SORT_RE 옵션 집합 비교 → **새 옵션 출현 = 리스트 전개**.
  const preOpts = await readSortOptionSlots(page, SORT_RE.source);
  const preKeys = new Set(preOpts.map((o) => o.key));
  // 아이콘 우선 클릭(옵션 리스트/모달 오픈). 아이콘 없으면 텍스트 라벨 클릭(레거시 인플레이스 토글 가능성).
  await (hasIcon ? iconTrig() : textTrig()).click({ timeout: 3_000 }).catch(() => {}); await settle(page, 700); await killMobileAlarms(page);
  const btn = () => page.getByText(SORT_RE).filter({ visible: true }).first();
  const koOpts = await readSortOptionSlots(page, SORT_RE.source);
  const newOpts = koOpts.filter((o) => !preKeys.has(o.key)).length;   // 클릭으로 새로 나타난 옵션 수
  if (newOpts >= 1 || (await isOverlayOpen(page))) {   // 정렬 옵션 리스트/모달 전개(최근·과거 등록순, 이름순 등)
    // 전 옵션 직접 대조. 정렬 라벨은 반응성(트리거 최근 등록순→Newest first 확인) → 옵션 중 하나라도 전환되면
    //   이 컨트롤은 리렌더됨 → **잔존 한글(과거 등록순 등) = 실제 미번역**(비반응성 오판 아님) → freshFg=true(FAIL).
    //   전환 0 이면 미반영 → freshFg=false(관찰 보류).
    if (koOpts.length) {
      const swM = await switchMobileLangRuntime(page, lang);
      if (swM.ok) {
        const fgOpts = await readTextAtSortPaths(page, koOpts.map((o) => o.key));   // 동일 domPath 재독(언어무관 — SORT_RE 필터 금지)
        const m = new Map(koOpts.map((s) => [s.key, s.text])); let c = 0, ch = 0;
        for (const f of fgOpts) { if (m.has(f.key)) { c++; if (m.get(f.key) !== f.text) ch++; } }
        const reactive = ch >= 1;
        if (c > 0) emitMobileComparison(koOpts, fgOpts, lang, tab, '정렬(옵션)', tcRef, gSeen, reactive);
        else skip(meta('정렬 옵션 대조'), `정렬 옵션 공통 0(변경 ${ch})`);
      } else skip(meta('정렬 옵션 대상 렌더'), swM.why);
      await restoreMobileKorean(page);
    } else { skip(meta('정렬 옵션 캡처'), '정렬 옵션 slot 0(전개 감지되나 SORT_RE leaf 0)'); await sortDiag(page, lang, tab, '옵션 slot0').catch(() => {}); }
    await closeOverlay(page); return;
  }
  // 인플레이스 토글 경로: 방금 클릭이 상태 전환(preLabel→koB). 상태0=preLabel.
  const koA = preLabel;
  const koB = await readLabel();
  await btn().click({ timeout: 3_000 }).catch(() => {}); await settle(page, 600); await killMobileAlarms(page);   // 원복
  const koSlots: Slot[] = [];
  if (koA) koSlots.push({ key: '정렬|state0', zone: '버튼/선택', text: koA, clip: false, ell: false });
  if (koB && koB !== koA) koSlots.push({ key: '정렬|state1', zone: '버튼/선택', text: koB, clip: false, ell: false });
  if (koSlots.length < 2) { skip(meta('토글'), `정렬 토글 미동작(상태0="${koA}" 상태1="${koB}" — 인플레이스 전환 안 됨)`); await sortDiag(page, lang, tab, `토글 미동작(상태0="${koA}" 상태1="${koB}")`).catch(() => {}); return; }
  // FG: 동일 절차.
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), `전환 실패: ${sw.why}`); await restoreMobileKorean(page); return; }
  const fgA = await readLabel();
  await btn().click({ timeout: 3_000 }).catch(() => {}); await settle(page, 700); await killMobileAlarms(page);
  const fgB = await readLabel();
  await btn().click({ timeout: 3_000 }).catch(() => {}); await settle(page, 600); await killMobileAlarms(page);   // 원복
  // ⚠ fg 라벨 읽기 실패(빈값)면 리렌더 미스일 수 있어 **가짜 미노출 FAIL** 위험 → 양쪽 비어있지 않을 때만 대조. 아니면 SKIP.
  if (!fgA || !fgB) { skip(meta('대조'), `대상 정렬 라벨 읽기 실패(fgA="${fgA}" fgB="${fgB}") — 리렌더/토글 미스, 재시도 필요`); await sortDiag(page, lang, tab, `대상 라벨 읽기 실패(fgA="${fgA}" fgB="${fgB}")`).catch(() => {}); await restoreMobileKorean(page); return; }
  const fgSlots: Slot[] = [
    { key: '정렬|state0', zone: '버튼/선택', text: fgA, clip: false, ell: false },
    { key: '정렬|state1', zone: '버튼/선택', text: fgB, clip: false, ell: false },
  ];
  emitMobileComparison(koSlots, fgSlots, lang, tab, '정렬', tcRef, gSeen);
  await restoreMobileKorean(page);
}

// ── 화면 내 버튼→하위화면 크롤러(2026-09-16, 사용자: 버튼 진입 화면 미커버) ─────────
//   현재 도달 화면에서 **뷰형(비파괴 조회) 버튼만** 순회 클릭 → 하위 화면/모달 스캔 → 복귀. 파괴형(저장·삭제·등록·수정) 제외.
//   ⚠ E2E 재사용 설계: "버튼으로 모든 화면 순회"의 뼈대 = E2E 내비 백본. 다국어는 각 도달 화면 대조를 얹음.
const VIEW_BTN = /상세\s*보기|크게\s*보기|일자별|개인별|투입\s*시간|미리\s*보기|더\s*보기|현황|내역/;
//   순수 내비/닫기(항상 제외 — 클릭해도 새 화면 없음, 크롤 흐름만 깸): 취소·닫기·이전·다음·로그아웃·뒤로·홈·확인(다이얼로그는 별도 처리).
const NAV_BTN = /^취소$|^닫기$|^이전$|^다음$|로그아웃|^뒤로$|^홈$|모두 선택/;
//   파괴형(커밋): 저장·삭제·등록하기·완료·수정·제출·적용·초기화·추가. 파괴모드에선 **화면 도달용으로 클릭**하되 커밋 다이얼로그는 취소로 복귀(다국어=화면 텍스트 커버, 되돌릴 수 없는 커밋 회피).
//   ⚠ 2026-09-28 확장(사용자: 상세 편집/삭제 + 작업지시만들기/연결/조치등록 누락): 편집·만들기·연결 추가.
const DESTRUCTIVE_BTN = /저장|삭제|등록하기|^등록$|완료|수정|편집|적용|초기화|제출|보내기|^추가$|만들기|연결/;

// ⋮ 케밥 메뉴 열기(상세 헤더의 최우측 비-내비 아이콘 클릭) → 편집/삭제 항목 노출. clickKebab(courseMobileDeep) 로직 이식(미export).
//   비파괴: 메뉴만 엶(항목 클릭은 크롤이 파괴가드 하에 수행·커밋은 취소). 편집/삭제/수정 노출 확인 시 true.
async function openKebabMenu(page: Page): Promise<boolean> {
  const box = await page.evaluate(() => {
    const anchor = (Array.from(document.querySelectorAll('*')) as HTMLElement[])
      .find((e) => /상세/.test((e.textContent || '').trim()) && e.children.length === 0 && (e.textContent || '').trim().length < 14);
    let hdr: HTMLElement | null = anchor || null;
    for (let i = 0; i < 5 && hdr; i++) { if (hdr.querySelectorAll('button, i[class*="ico"]').length >= 2) break; hdr = hdr.parentElement; }
    if (!hdr) return null;
    const btns = (Array.from(hdr.querySelectorAll('button, i[class*="ico"], [class*="ico"]')) as HTMLElement[])
      .map((e) => ({ r: e.getBoundingClientRect(), cls: (e.className || '').toString() }))
      .filter((o) => o.r.width > 6 && o.r.height > 6 && !/arrow-prev|ico-home|ico-alarm|ico-profile|ico-search|ico-filter|ico-menu-1|ico-sort|ico-circle-delete/.test(o.cls));
    if (!btns.length) return null;
    btns.sort((a, b) => b.r.left - a.r.left);   // 최우측 = ⋮
    const r = btns[0].r; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }).catch(() => null);
  if (!box) return false;
  await page.mouse.click(box.x, box.y).catch(() => {}); await settle(page, 700); await killMobileAlarms(page);
  return await page.getByText(/^\s*(편집|수정|삭제)\s*$/).filter({ visible: true }).count().then((c) => c > 0).catch(() => false);
}

// ── (B) 연결 picker → 이슈/작업 선택 → 상세 2-hop 재마운트 대조(2026-09-30 QA-15704 #미검출) ─────────
//   호출 시점: crawlSubButtons 가 "작업/이슈 연결하기" 등 연결 후보를 클릭해 **picker(오버레이)가 열린 KO 상태**.
//   목적: picker 에서 첫 행(이슈/작업) 선택 → 상세 화면("종료" 등 상태 enum) 진입 = 리스트로부터 L3 딥 화면 커버.
//   ⚠ 진짜 FAIL 판정(freshFg=true): 딥 화면은 URL reload 불가라 base FG-first 를 못 쓰지만, **KO에서 상세 캡처 →
//     picker 복귀 → 대상 로케일 전환 → 상세 재진입(재클릭)** 하면 비반응성 배지가 대상 로케일로 **재마운트** → 잔존 한글이면
//     진짜 미번역(scanRegForm [아니오] 재마운트 트릭과 동형). 재진입/전환 실패 시 graceful. 비파괴(조회만·연결확정/저장 안 함).
async function scanLinkedIssueDetail(page: Page, lang: CourseLang, tab: string, sub: string, tcRef: string, gSeen: Set<string>, connectText = ''): Promise<string> {
  const bodySig = async () => page.evaluate(() => (document.body?.innerText || '').slice(0, 800)).catch(() => '');
  const moved = (bu: string, ab: string, bb: string) => page.url() !== bu || (!!bb && !!ab && ab.slice(0, 400) !== bb.slice(0, 400));
  // 현재 페이지 구조 프로브(스턱 규명) — 헤더·URL·가시 버튼·카드수·연결/이슈연결 존재.
  const probe = async (tagNote: string) => {
    const p = await page.evaluate(() => {
      const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const btns = (Array.from(document.querySelectorAll('button, [role="button"], a, [class*="button"]')) as HTMLElement[])
        .filter(vis).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14);
      const cards = document.querySelectorAll('[class*="card"], [class*="bd-dde3ec"], [class*="bdr-12"], li').length;
      const hdr = (Array.from(document.querySelectorAll('[class*="header-title"], h1, h2')) as HTMLElement[]).map((e) => e.innerText.trim()).filter(Boolean).slice(0, 3);
      return { url: location.pathname, hdr, btns, cards };
    }).catch(() => ({ url: '', hdr: [] as string[], btns: [] as string[], cards: 0 }));
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: `연결 딥 프로브(${tagNote})`, zone: 'crawl',
      item: `${p.url} · hdr[${p.hdr.join('/')}] · 카드 ${p.cards}`, value: `버튼: ${p.btns.join(' | ')}`, screenshot: '' });
  };
  // 강력 진단(2026-09-30): 연결버튼이 왜 Link 페이지로 안 가는지 규명 — ① 매칭 요소 원시 DOM(태그/클래스/disabled/카드상태)
  //   ② 네이티브 click 직후 새 오버레이/시트/다이얼로그 컨테이너 + '이슈연결/작업연결' 텍스트 존재 여부.
  const probeConnect = async (label: string) => {
    const info = await page.evaluate((label: string) => {
      const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
      const rect = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
      const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
      // 라벨과 정확히 일치(own+innerText)하는 요소 후보.
      const matches = all.filter((e) => norm(e.innerText) === label).slice(0, 4).map((e) => {
        const btnAnc = e.closest('button, a, [role="button"], [class*="button"], [class*="btn"]') as HTMLElement | null;
        const card = e.closest('[class*="card"], [class*="bd-"], [class*="bdr-"], li') as HTMLElement | null;
        return {
          tag: e.tagName.toLowerCase(), cls: (e.className || '').toString().slice(0, 60), rect: rect(e),
          btnAnc: btnAnc ? `${btnAnc.tagName.toLowerCase()}.${(btnAnc.className || '').toString().slice(0, 50)}` : 'none',
          href: (e.closest('a') as HTMLAnchorElement | null)?.getAttribute('href') || '',
          disabled: !!(e as any).disabled || e.getAttribute('aria-disabled') === 'true' || !!btnAnc?.hasAttribute('disabled'),
          cardStatus: card ? norm(card.innerText).slice(0, 60) : '',
        };
      });
      return { matches };
    }, label).catch(() => ({ matches: [] as any[] }));
    // 네이티브 click(액셔너빌리티 대기 우회) → 직후 오버레이/시트 관찰.
    const after = await page.evaluate((label: string) => {
      const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
      const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
      const target = all.find((e) => norm(e.innerText) === label);
      const btn = (target?.closest('button, a, [role="button"], [class*="button"], [class*="btn"]') as HTMLElement) || target;
      if (btn) (btn as HTMLElement).click();
      return true;
    }, label).catch(() => false);
    await settle(page, 1_600); await killMobileAlarms(page);
    const ov = await page.evaluate(() => {
      const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const OVR = /modal|sheet|layer|popup|dialog|drawer|overlay|bottom|full|link|connect|picker/i;
      const conts = (Array.from(document.querySelectorAll('[class]')) as HTMLElement[])
        .filter((e) => OVR.test((e.className || '').toString()) && vis(e))
        .map((e) => `${(e.className || '').toString().slice(0, 40)}: "${norm(e.innerText).slice(0, 50)}"`).slice(0, 8);
      const hasIssueLink = /이슈\s*연결|작업\s*연결|Link\s*Issue/i.test(document.body?.innerText || '');
      return { url: location.pathname, conts, hasIssueLink };
    }).catch(() => ({ url: '', conts: [] as string[], hasIssueLink: false }));
    const mText = info.matches.map((m: any) => `[${m.tag}.${m.cls}|btn=${m.btnAnc}|href=${m.href}|dis=${m.disabled}|카드="${m.cardStatus}"]`).join(' ');
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: `연결버튼 원시진단(nativeClick=${after})`, zone: 'crawl',
      item: `매칭 ${info.matches.length}: ${mText}`.slice(0, 480), value: `후URL ${ov.url} · 이슈연결텍스트=${ov.hasIssueLink} · 오버레이류[${ov.conts.join(' || ')}]`.slice(0, 500), screenshot: '' });
  };
  // Link 페이지 구조 진단(2026-09-30): dailyCheckLink 도달 후 이슈행/유형선택 미발견 규명 —
  //   전체 가시 클릭요소(최대 30, 슬라이스 없이) + findRow 후보 텍스트 + '이슈 연결'/'작업 연결' 정확 클릭 존재.
  const probeLinkState = async (tagNote: string) => {
    const p = await page.evaluate(() => {
      const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const clickables = (Array.from(document.querySelectorAll('button, a, [role="button"], [class*="button"], [class*="btn"]')) as HTMLElement[])
        .filter(vis).map((e) => norm(e.innerText)).filter(Boolean);
      const rows = (Array.from(document.querySelectorAll('a, li, [class*="card"], [class*="list-item"], [class*="list__item"], [class*="issue"], [class*="bd-dde3ec"], [class*="bdr-12"]')) as HTMLElement[])
        .filter(vis).map((e) => norm(e.innerText)).filter((t) => t.length >= 2 && t.length <= 60).slice(0, 20);
      const hasIssueExact = clickables.some((t) => /^이슈\s*연결$/.test(t));
      const hasTaskExact = clickables.some((t) => /^작업\s*연결$/.test(t));
      const hasCode = /\b[IW]-\d{3,}\b/.test(document.body?.innerText || '');
      return { url: location.pathname, clickables: Array.from(new Set(clickables)).slice(0, 30), rows, hasIssueExact, hasTaskExact, hasCode };
    }).catch(() => ({ url: '', clickables: [] as string[], rows: [] as string[], hasIssueExact: false, hasTaskExact: false, hasCode: false }));
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: `Link 구조진단(${tagNote})`, zone: 'crawl',
      item: `${p.url} · 이슈연결정확=${p.hasIssueExact} · 작업연결정확=${p.hasTaskExact} · I/W코드=${p.hasCode} · 클릭[${p.clickables.join(' | ')}]`.slice(0, 500),
      value: `행후보[${p.rows.join(' || ')}]`.slice(0, 500), screenshot: '' });
  };
  // Link 페이지 도달 신호: '이슈 연결'/'작업 연결'/저장/Save 중 하나라도 보이면 Link(유형선택) 화면.
  const onLinkNow = async (): Promise<boolean> =>
    page.getByText(/^\s*(이슈\s*연결|작업\s*연결|저장|Save)\s*$/).filter({ visible: true }).count().then((c) => c > 0).catch(() => false);
  // ⚠ 2026-09-30 프로브 근거 견고화: 단발 moved() 판정은 (a) 잘못된 텍스트 요소 클릭 (b) 느린/오버레이 전환에서 오탐 →
  //   **클릭가능 컨트롤(button/a/role/class) 우선 → 텍스트 폴백**, 클릭 후 **signal 폴링**(도달까지 대기)으로 교체.
  //   최대 3개 매칭 요소를 순차 시도(첫 매칭이 라벨/컨테이너면 다음 실제 버튼으로). signal 도달 시 즉시 true.
  //   ⚠ 2026-09-30 원시진단 확정: 연결버튼(button.button-common)이 **position:fixed 하단바에 겹쳐** Playwright .click()이
  //     액셔너빌리티(오버랩) 체크로 무동작 → **네이티브 DOM click 우선**(핸들러 직접 발화, 오버랩 우회)으로 해결.
  //     네이티브 → 폴링 → 미도달 시 force click 폴백. (dailyCheckLink 로 실제 네비게이트 확인됨)
  const clickToward = async (label: string, signal: () => Promise<boolean>, waitMs = 4500): Promise<boolean> => {
    if (await signal()) return true;
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const containsRe = new RegExp(esc);
    const exactRe = new RegExp(`^\\s*${esc}\\s*$`);
    const btnScoped = page.locator('button, a, [role="button"], [class*="button"], [class*="btn"]').filter({ hasText: containsRe }).filter({ visible: true });
    const plain = page.getByText(exactRe).filter({ visible: true });
    const poll = async (): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < waitMs) { await settle(page, 300); await killMobileAlarms(page); if (await signal()) return true; }
      return false;
    };
    for (const loc of [btnScoped, plain]) {
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 3); i++) {
        const el = loc.nth(i);
        await el.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {});
        await el.evaluate((node) => (node as HTMLElement).click()).catch(() => {});   // 네이티브 우선(오버랩 우회)
        if (await poll()) return true;
        await el.click({ force: true, timeout: 3_000 }).catch(() => {});   // 폴백: force(액셔너빌리티 무시)
        if (await poll()) return true;
      }
    }
    return await signal();
  };
  // step 0: 연결버튼 클릭 → Link(유형선택) 페이지 도달 보장. 도달 후 **긍정 프로브**(다음 런 진단용 실제 버튼/헤더 기록).
  if (connectText && !(await onLinkNow())) {
    if (!(await clickToward(connectText, onLinkNow))) {
      await probe('연결버튼→Link 미도달');
      await probeConnect(connectText).catch(() => {});   // 원시 DOM + nativeClick 후 오버레이 규명(원인 확정용)
      return 'Link 페이지 미도달(연결버튼 클릭) — 프로브 참조';
    }
  }
  if (connectText) await probe('Link 도달(유형선택 화면)');   // 긍정 확인 — 성공 경로도 기록해 이슈연결 라벨/구조 규명
  // 첫 선택 가능 행(이슈 리스트 항목) — **오버레이 우선, 없으면 전체 페이지**(이슈 리스트가 풀페이지일 수 있음). 이슈코드(I-####) 보유 행 우선.
  //   ⚠ 2026-09-30 실측(dailyCheckLink): 유형선택 전 기본 화면은 **일상점검 카드**(등록일시+분류(중요도)) 노출 → 이슈 행으로 오인 금지.
  //     이슈 행 특유 = **'관련시기'** 필드 또는 I/W코드(r248 이슈리스트: "활성 관련시기 매년... 중요도 중"). 일상점검 카드(등록일시&분류)는 배제.
  const findRow = async (): Promise<import('@playwright/test').Locator | null> => {
    for (const scope of [`${OVERLAY_SEL} `, '']) {
      const rows = page.locator(`${scope}:is(a, li, [class*="card"], [class*="list-item"], [class*="list__item"], [class*="issue"], [class*="bd-dde3ec"], [class*="bdr-12"])`).filter({ visible: true });
      const n = await rows.count().catch(() => 0);
      let fallback: import('@playwright/test').Locator | null = null;
      for (let i = 0; i < Math.min(n, 20); i++) {
        const r = rows.nth(i);
        const t = (await r.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
        if (!t || t.length < 2) continue;
        if (/^\s*(취소|닫기|확인|이전|다음|전체|모두|저장|Save|이슈\s*연결하기|작업\s*연결하기|작업지시\s*연결하기|일상점검\s*연결하기|이슈\s*연결|작업\s*연결)\s*$/.test(t)) continue;   // 컨트롤·유형선택 버튼 제외
        const box = await r.boundingBox().catch(() => null);
        if (!box || box.height < 24 || box.width < 60) continue;
        if (/\b[IW]-\d{3,}\b/.test(t) || /관련시기/.test(t)) return r;   // 이슈 행(강): 코드 또는 '관련시기' 필드
        if (/등록일시/.test(t) && /분류/.test(t)) continue;   // 일상점검 카드 = 이슈 아님(배제 — 유형선택 미완료 신호)
        if (!fallback) fallback = r;
      }
      if (fallback) return fallback;
    }
    return null;
  };
  // 이슈 리스트 등장 신호 = 이슈 특유 필드(관련시기) 또는 I/W코드가 body 에 등장.
  const issueListReady = async (): Promise<boolean> =>
    page.evaluate(() => /\b[IW]-\d{3,}\b/.test(document.body?.innerText || '') || /관련시기/.test(document.body?.innerText || '')).catch(() => false);
  // 상세까지 시퀀스(멱등): [이슈 연결하기(유형선택)] → [첫 이슈 행] → 상세 슬롯 캡처. (2026-09-30 실측: dailyCheckLink 유형선택 → 이슈 리스트 → 상세 = 3-hop)
  const goDetail = async (): Promise<Slot[] | null> => {
    // ① 유형 선택 버튼 '이슈 연결하기'(우선)/'이슈 연결' **무조건 네이티브 클릭**(fixed 하단바 오버랩 우회) → 이슈 리스트 등장 폴링.
    //   ⚠ 2026-09-30 실측: dailyCheckLink 기본 화면은 '일상점검 카드' → signal-우선 clickToward 는 유형버튼을 단락(카드를 이슈로 오인) → 명시 클릭으로 교체.
    for (const tl of ['이슈 연결하기', '이슈 연결']) {
      const tb = page.getByText(new RegExp(`^\\s*${tl.replace(/\s+/g, '\\s*')}\\s*$`)).filter({ visible: true }).first();
      if (!(await tb.count().catch(() => 0))) continue;
      await tb.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {});
      await tb.evaluate((node) => (node as HTMLElement).click()).catch(() => {});   // 네이티브 우선
      let ok = false; const t0 = Date.now();
      while (Date.now() - t0 < 4500) { await settle(page, 300); await killMobileAlarms(page); if (await issueListReady()) { ok = true; break; } }
      if (!ok) { await tb.click({ force: true, timeout: 3_000 }).catch(() => {}); await settle(page, 1_200); await killMobileAlarms(page); }   // force 폴백
      break;
    }
    // ② 첫 이슈 행 → 상세.
    const row = await findRow();
    if (!row) return null;
    const bu = page.url(), bb = await bodySig();
    await row.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {});
    await row.evaluate((node) => (node as HTMLElement).click()).catch(() => {}); await settle(page, 1_100); await killMobileAlarms(page);   // 네이티브 우선(오버랩 우회)
    if (!moved(bu, bb, await bodySig())) { await row.click({ force: true, timeout: 3_000 }).catch(() => {}); await settle(page, 1_100); await killMobileAlarms(page); }   // force 폴백
    if (!moved(bu, bb, await bodySig())) return null;   // 인라인(선택 체크만)·데이터 없음
    return await captureMobileSlots(page);   // 상세 전체 chrome(상태/분류/우선순위 enum 포함)
  };
  // 1) KO: 유형선택→리스트→상세 캡처
  const ko = await goDetail();
  if (!ko || !ko.length) { await probe('이슈연결/행 미발견'); await probeLinkState('이슈행/유형선택 미발견').catch(() => {}); return '이슈 유형선택/행 미발견 또는 상세 미진입 — 프로브 참조'; }
  // 2) 대상 전환 후 상세 **재마운트**: back(상세→리스트) → 전환 → 첫 행 재클릭(대상 로케일 마운트).
  await mobileBack(page); await settle(page, 700); await killMobileAlarms(page);   // 상세 → 이슈 리스트
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { await restoreMobileKorean(page); return `대상 전환 실패(${sw.why}) — KO 상세만 캡처`; }
  let fg: Slot[] | null = null;
  { const row = await findRow(); if (row) { const bu = page.url(), bb = await bodySig(); await row.scrollIntoViewIfNeeded({ timeout: 1_500 }).catch(() => {}); await row.evaluate((node) => (node as HTMLElement).click()).catch(() => {}); await settle(page, 1_100); await killMobileAlarms(page); if (!moved(bu, bb, await bodySig())) { await row.click({ force: true, timeout: 3_000 }).catch(() => {}); await settle(page, 1_100); await killMobileAlarms(page); } if (moved(bu, bb, await bodySig())) fg = await captureMobileSlots(page); } }
  await mobileBack(page).catch(() => {}); await settle(page, 500);   // 상세 → 리스트(잔여 unwind 은 다음 화면 하드리셋이 흡수)
  await restoreMobileKorean(page);
  if (!fg || !fg.length) return '대상 재진입 실패(재마운트 불가) — 대조 보류';
  // 4) freshFg=true(진짜 재마운트) 대조 → 상태 enum 미번역이면 FAIL. 딥 dedup 방지 위해 전용 seen.
  const koByKey = new Map(ko.map((s) => [s.key, s.text]));
  let common = 0, changed = 0;
  for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
  if (!shouldEmitFg(common, changed)) return `대조 미반영(공통 ${common}·변경 ${changed})`;
  emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen, true);
  return `상세 재마운트 대조✓(공통 ${common}·변경 ${changed}·freshFg)`;
}

async function crawlSubButtons(page: Page, lang: CourseLang, tab: string, parentSub: string, tcRef: string, gSeen: Set<string>, destructive: boolean): Promise<void> {
  // ⚠ 상세 ⋮ 메뉴(편집/삭제)는 아이콘 트리거라 텍스트 열거서 누락 → 파괴가드 시 **먼저 케밥 열어** 편집/삭제를 후보에 노출.
  if (destructive) { const opened = await openKebabMenu(page); if (opened) review({ lang: lang.ko, screen: `${tab} > ${parentSub}`, kind: '⋮ 메뉴 오픈', zone: 'crawl', item: '편집/삭제 노출', value: '케밥 메뉴 열림 → 후보 편입', screenshot: '' }); }
  const candAll: string[] = await page.evaluate(({ viewSrc, destSrc, navSrc, destructive }) => {
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
    // ① 우선순위 정렬(2026-09-30): **서브뷰 진입형(연결·만들기·보기·현황·내역·상세)** 을 앞으로 → cap 안에 고가치 후보 보장
    //   (연결→상세 #16 등이 DOM 뒤쪽이라 8상한 밖으로 밀려 유실되던 문제 해소). dedup 후 정렬, 상한은 caller(JS)서 env로.
    const PRIO = /연결|만들기|보기|현황|내역|상세/;
    return Array.from(new Set(out)).sort((a, b) => (PRIO.test(b) ? 1 : 0) - (PRIO.test(a) ? 1 : 0)).slice(0, 30);
  }, { viewSrc: VIEW_BTN.source, destSrc: DESTRUCTIVE_BTN.source, navSrc: NAV_BTN.source, destructive }).catch(() => [] as string[]);
  // ② 후보 상한 env화(2026-09-30): 기본 8, 철저 런은 MLANG_CRAWL_MAX=14 등. 루프 내 예산 break 와 병행해 타임아웃 안전.
  const crawlMax = Math.max(1, Number(process.env.MLANG_CRAWL_MAX || 8));
  const cand = candAll.slice(0, crawlMax);
  // ⚠ 진단 계측(2026-09-16, 사용자: 나의작업보기 상세 하위화면 미수행) — 각 버튼의 실제 결과(미발견/무동작/열림·대조/슬롯0)를
  //   review에 남겨 "왜 하위화면이 리포트에 안 보이는가"를 다음 런에서 규명. dedup(gSeen)에 눌려 안 보이는 것과 실제 무동작을 구분.
  // ③ 방문 서브뷰 시그니처 dedup(2026-09-30): 서로 다른 후보가 **동일 서브뷰**를 열면 재대조(전환/캡처) 낭비 → 시그니처로 스킵(안전 효율화, 커버리지 손실 없음 = 이미 대조된 화면).
  const visitedSig = new Set<string>();
  const diag: string[] = [];
  for (const t of cand) {
    if (overBudget()) { diag.push('⏱예산 초과 — 잔여 후보 중단'); break; }   // ② 루프 내 예산 break(cap↑ 안전판)
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
    // ③ 방문 서브뷰 dedup(2026-09-30 수정) — **캡처된 실제 KO 콘텐츠 해시**로 판정(이전 body 200자 프리픽스는 배경 상세페이지가 같아
    //   서로 다른 서브뷰를 오스킵 = 회귀 주범 → 제거). 진짜 동일 슬롯셋만 스킵 → 커버리지 손실 없이 재대조(전환+FG) 낭비만 절감.
    //   연결 후보(B)는 예외(항상 진행). 콘텐츠 0/소량(<3)은 판별 불가라 스킵 안 함.
    if (ko.length >= 3 && !/연결/.test(t)) {
      const sig = ko.map((s) => s.key + '=' + s.text).sort().join('§');
      if (visitedSig.has(sig)) {
        diag.push(`${t}=중복 서브뷰 스킵(③·동일콘텐츠 ${ko.length}슬롯)`);
        if (overlay) await closeOverlay(page); else { await mobileBack(page); await settle(page, 400); }
        for (let i = 0; i < 2 && (await isOverlayOpen(page)); i++) { await page.keyboard.press('Escape').catch(() => {}); await settle(page, 250); }
        await killMobileAlarms(page);
        continue;
      }
      visitedSig.add(sig);
    }
    if (ko.length) {
      const sw = await switchMobileLangRuntime(page, lang);
      if (sw.ok) {
        const fg = await captureMobileSlots(page, rootSel);
        const koByKey = new Map(ko.map((s) => [s.key, s.text]));
        let common = 0, changed = 0;
        for (const f of fg) { if (koByKey.has(f.key)) { common++; if (koByKey.get(f.key) !== f.text) changed++; } }
        if (shouldEmitFg(common, changed)) { emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen); note += `·공통${common}·변경${changed}·대조✓`; }
        else note += `·공통${common}·변경${changed}·미반영`;
      } else note += `·전환실패`;
      await restoreMobileKorean(page);
    } else note += `·슬롯0`;
    diag.push(`${t}=${note}`);
    // ── (B) 연결 후보 = "이슈/작업 연결" 류 → 링크 화면(새 페이지)서 [이슈 연결]→이슈 선택 → **이슈 상세(L3, 종료 뱃지)** descend 대조.
    //   ⚠ 2026-09-30 실측(스크린샷): "이슈/작업 연결"은 **오버레이 아닌 새 페이지** → isOverlayOpen 요구 제거(이 지점은 이미 무동작 체크 통과 = 열림).
    //   일상점검만 이슈 링크 보유(이슈/예측은 Work Order/Daily Check 링크 → 이슈 없음 → goDetail 이 정직 미발견 반환).
    if (/연결/.test(t)) {
      const deepSub = `${parentSub}·${t}·상세`.slice(0, 40);
      const deepNote = await scanLinkedIssueDetail(page, lang, tab, deepSub, tcRef, gSeen, t).catch((e) => `예외(${String(e).slice(0, 40)})`);
      diag.push(`${t}→상세=${deepNote}`);
      await restoreMobileKorean(page).catch(() => {});   // B 성공 경로는 대상 로케일 잔류 → 다음 후보/화면 KO baseline 보호
    }
    // 복귀: 오버레이(확인 다이얼로그 포함)면 **취소/닫기로** 닫기(커밋 회피), 새 화면이면 뒤로. 여전히 열려있으면 Escape.
    if (overlay) await closeOverlay(page); else { await mobileBack(page); await settle(page, 500); }
    for (let i = 0; i < 2 && (await isOverlayOpen(page)); i++) { await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); }
    await killMobileAlarms(page);
  }
  review({ lang: lang.ko, screen: `${tab} > ${parentSub}`, kind: '버튼 크롤', zone: 'crawl',
    item: `${cand.length}/${candAll.length}후보(상한 ${crawlMax})${destructive ? '·파괴형 포함' : ''}`, value: diag.join('  |  ') || '뷰형/파괴형 버튼 후보 없음', screenshot: '' });
}

// 네비게이션형 딥 인터랙션(클릭→새 화면): [나의 작업 보기]·항목→상세 등. 부모 탭 편입, KO↔대상 대조 후 뒤로가기 복귀.
//   crawl=true 면 도달 화면에서 다시 뷰형 버튼 크롤(2단계 중첩 화면 커버).
async function scanNavScreen(
  page: Page, lang: CourseLang, parentLabel: string, subName: string, tcRef: string,
  navFn: () => Promise<boolean>, landingTexts: Set<string>, gSeen: Set<string>, crawl = false, destructive = false,
  ownSeen = false,   // true=상세/나의작업보기: 별도 dedup(기본/등록폼과 겹쳐도 재노출) → 상세 화면 완결 커버리지(사용자 요청)
  arriveSig?: RegExp,   // 도착 확정 신호(2026-09-29 사용자 스크린샷): 클릭 후 본문에 이 패턴 나타나면 4신호 무관 진입 인정(나의 작업 보기=작업번호/W-\d+/월간계획 렌더됨에도 전환 미감지 오탐 해소)
  scanTips = false,   // true=이 도달 화면서 [?]/info 툴팁도 스캔(2026-09-30 QA-15704 #10: 나의작업보기 월간계획 툴팁 미번역 미검출)
): Promise<void> {
  // ⚠ 상세 화면은 기본/등록폼과 라벨이 겹쳐 per-screen gSeen 에 눌리면 리포트에 안 보임(2026-09-17 사용자 지적).
  //   ownSeen=true 면 이 서브 전용 Set 으로 emit → 상세의 작업번호·월간계획·작업일시 등이 온전히 노출됨. 크롤은 공유 gSeen 유지.
  const emitSeen = ownSeen ? new Set<string>() : gSeen;
  const tab = `모바일-${parentLabel}`;
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${subName}`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} ${subName} — ${note}` });
  await restoreMobileKorean(page); await settle(page, 300);
  const before = page.url();
  const beforeH = await headerTitles(page).catch(() => [] as string[]);   // 폼/모달 아닌 풀페이지 전환(헤더 스택 push) 감지용
  const bodySig = async (): Promise<string> => page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500)).catch(() => '');
  const beforeBody = await bodySig();   // in-place 콘텐츠 스왑(url·헤더 무변경) 감지용 본문 지문
  if (!(await navFn())) { skip(meta('진입'), `${subName} 트리거 미발견/데이터 의존`); return; }
  await settle(page, 1_100); await killMobileAlarms(page);
  // ⚠ 전환 판정 3단(2026-09-28 실측: 나의 작업 보기는 URL·오버레이·헤더 모두 무변경인 **in-place 콘텐츠 스왑**):
  //   ① URL 변경 ② 오버레이 ③ 헤더 스택 변경 ④ **본문 지문 유의미 변경**(≥30% 상이) → 하나라도면 진입 인정. 넷 다 무변경만 SKIP.
  const afterH = await headerTitles(page).catch(() => [] as string[]);
  const headerChanged = afterH.length !== beforeH.length || afterH.some((h) => !beforeH.includes(h));
  const afterBody = await bodySig();
  const bodyChanged = beforeBody.length > 0 && afterBody.length > 0 && (() => {
    const a = new Set(beforeBody.split(' ')), b = afterBody.split(' ');
    const overlap = b.filter((w) => a.has(w)).length / Math.max(b.length, 1);
    return overlap < 0.7;   // 신규 화면 단어의 30%↑가 이전과 다름 = 콘텐츠 전환
  })();
  const arrived = arriveSig ? arriveSig.test(afterBody) : false;   // 도착 신호(본문에 상세 마커 렌더) — 4신호 미감지여도 진입 확정
  const moved = arrived || page.url() !== before || await isOverlayOpen(page) || headerChanged || bodyChanged;
  if (!moved) { skip(meta('진입'), `${subName} 화면 전환 없음(url·오버레이·헤더·본문 모두 무변경 — 클릭 무동작/데이터 의존)`); return; }
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
  if (shouldEmitFg(common, changed)) emitMobileComparison(ko, fg, lang, tab, subName, tcRef, emitSeen);
  else skip(meta('대조'), `대상 전환 미반영(공통 ${common}·변경 ${changed})`);
  await restoreMobileKorean(page);
  // 딥: 이 도달 화면의 [?]/info 툴팁 스캔(나의작업보기 월간계획 등) — 라벨만 검증되고 툴팁 내용은 미캡처되던 갭 보강.
  if (scanTips) await scanTooltips(page, lang, tab, subName, tcRef, emitSeen).catch(() => {});
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
  if (shouldEmitFg(common, changed)) emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen);
  else skip(meta('대조'), `대상 전환 미반영(공통 ${common}·변경 ${changed})`);
  await restoreMobileKorean(page);
  await page.keyboard.press('Escape').catch(() => {}); await settle(page, 400); await killMobileAlarms(page);
}

// ── (P3) 리스트 분류필터 적용 후 레이아웃 감사(2026-09-30 QA-15704 #11 자재 분류필터 시설소모품 선택 후 화면) ──
//   비파괴 뷰 필터(저장 없음). 분류 vue-select/필터칩의 첫 비-전체 옵션 선택 → 대상 로케일 전환 → auditLayout(필터 상태 레이아웃).
//   복귀는 caller 의 크롤 전 클린 재진입(enterMobileScreenKorean)이 흡수. 컨트롤 미발견 시 조용히 통과.
async function scanListFilterLayout(page: Page, lang: CourseLang, screenLabel: string, tcRef: string): Promise<void> {
  const tab = `모바일-${screenLabel}`;
  const meta = (note: string): CheckMeta => ({ path: `${tab} > 분류필터·레이아웃`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 분류필터 — ${note}` });
  await restoreMobileKorean(page); await settle(page, 300);
  // 분류 필터 토글: 분류/필터 라벨 근접 vue-select 우선, 없으면 첫 vs 토글.
  const toggles = page.locator('.v-select .vs__dropdown-toggle, .vs__dropdown-toggle, [class*="filter"] [class*="select"], [class*="category"] [class*="select"]').filter({ visible: true });
  const n = await toggles.count().catch(() => 0);
  if (!n) { skip(meta('열기'), '분류 필터 컨트롤 미발견(화면에 분류 필터 없음)'); return; }
  const tog = toggles.first();
  await tog.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 600);
  // 옵션 리스트: 첫 비-전체 옵션 선택(뷰 필터·비파괴).
  const opts = page.locator('.vs__dropdown-menu li, .vs__dropdown-option, li[role="option"]').filter({ visible: true });
  const on = await opts.count().catch(() => 0);
  if (!on) { skip(meta('옵션'), '분류 옵션 리스트 미출현'); await page.keyboard.press('Escape').catch(() => {}); return; }
  let picked = false;
  for (let i = 0; i < Math.min(on, 8); i++) {
    const t = (await opts.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!t || /^전체$|^all$/i.test(t)) continue;
    await opts.nth(i).click({ timeout: 3_000 }).catch(() => {}); picked = true; break;
  }
  if (!picked) { skip(meta('옵션'), '비-전체 분류 옵션 없음'); await page.keyboard.press('Escape').catch(() => {}); return; }
  await settle(page, 900); await killMobileAlarms(page);
  // 대상 로케일 전환 후 필터 적용 상태의 레이아웃 감사(다국어 오버플로/잘림 포착).
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), sw.why); await restoreMobileKorean(page); return; }
  await auditLayout(page, lang, tab, '분류필터 적용', tcRef).catch(() => {});
  await restoreMobileKorean(page);
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
  if (shouldEmitFg(common, changed)) emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen);
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

// clickByTextFlex 의 **클릭 없는 존재 판정**(2026-09-29) — reg 트리거가 리스트에 다시 보이는지(=폼 이탈) 확인용.
async function clickByTextFlexProbe(page: Page, text: string): Promise<boolean> {
  const norm = (s: string) => (s || '').replace(/\s+/g, '');
  const want = norm(text);
  const loc = page.locator('button, .button-common, [role="button"], a').filter({ visible: true });
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const t = await loc.nth(i).innerText().catch(() => '');
    if (norm(t) === want || (want.length >= 3 && norm(t).includes(want))) return true;
  }
  return false;
}

// ── (P1) 유효성 검증문구 스캐너(2026-09-30 QA-15704 #5 종료<시작 시간·#9 동일자재 등록) ─────────
//   잘못된 입력을 **비파괴로 유발**(등록/저장/제출 클릭 금지)해 인라인 검증문구·검증 토스트를 노출시킨 뒤 KO↔대상 대조.
//   ⚠ 재트리거 방식이 곧 **신선 대상 렌더**(대상 로케일서 문구 재생성) → 잔존 한글/키누출은 진짜 FAIL(freshFg=true 등가).
//   트리거(비파괴): ① 동일/중복 여부 체크박스 토글(중복검사 유발) ② 시간류 number 입력 역순(종료<시작) 후 blur.
//   커밋 버튼(등록하기/저장/제출/확인)은 절대 클릭 안 함. 문구 미노출 시 DOM 프로브(관찰)로 검증요소 구조 기록.
const VALIDATION_SEL = '[class*="error"], [class*="invalid"], [class*="warn"], [class*="danger"], [class*="alert"], [class*="valid-msg"], [class*="validation"], [class*="help-text"], [role="alert"], [class*="toast"], [class*="msg"]';
async function scanValidationMessages(page: Page, lang: CourseLang, tab: string, sub: string, tcRef: string, gSeen: Set<string>): Promise<void> {
  const meta = (note: string): CheckMeta => ({ path: `${tab} > ${sub}·유효성`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 유효성 문구 — ${note}` });
  // 비파괴 잘못된 입력 유발 → 노출된 검증문구(짧은 시스템 텍스트) 수집. 커밋 버튼 클릭 금지.
  const trigger = async (): Promise<void> => {
    await page.evaluate(() => {
      const fire = (el: Element) => { for (const ev of ['input', 'change', 'blur', 'keyup']) el.dispatchEvent(new Event(ev, { bubbles: true })); };
      // ① 동일/중복 여부 체크박스(#9 자재) — 라벨/근접 텍스트에 동일·중복 포함한 checkbox 토글(중복검사 유발).
      for (const cb of Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]) {
        const scope = (cb.closest('label, [class*="check"], [class*="form"], li, div') as HTMLElement | null);
        const txt = (scope?.innerText || '') + ' ' + (cb.getAttribute('name') || '') + ' ' + (cb.id || '');
        if (/동일|중복|같은/.test(txt)) { if (!cb.checked) { cb.click(); fire(cb); } }
      }
      // ② 시간류 number/text 입력 역순(#5 종료<시작) — 시작=23, 종료=00 등 명백 역순 주입 후 blur(readonly picker 는 무시됨=무해).
      const timeInputs = (Array.from(document.querySelectorAll('input')) as HTMLInputElement[]).filter((i) => {
        const scope = ((i.closest('label, [class*="form"], [class*="field"], li, div') as HTMLElement | null)?.innerText || '') + ' ' + (i.getAttribute('placeholder') || '');
        return /시간|시작|종료|시:분|HH|MM|:/.test(scope) && !i.readOnly && (i.type === 'number' || i.type === 'text' || i.type === 'time');
      });
      if (timeInputs.length >= 2) {
        const set = (i: HTMLInputElement, v: string) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); d?.set?.call(i, v); fire(i); };
        set(timeInputs[0], timeInputs[0].type === 'time' ? '23:00' : '23');   // 시작 늦게
        set(timeInputs[1], timeInputs[1].type === 'time' ? '01:00' : '01');   // 종료 이르게
      }
    }).catch(() => {});   // 주입만(비파괴). 검증문구 읽기는 호출부 koMsgs/fgMsgs 가 settle 후 수행.
  };
  await restoreMobileKorean(page); await settle(page, 300);
  await trigger(); await settle(page, 700);
  const koMsgs = await page.evaluate((valSel) => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(valSel)) as HTMLElement[]) {
      const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (t && t.length >= 2 && t.length <= 60 && /[가-힣]/.test(t) && !out.includes(t)) out.push(t);
    }
    return out.slice(0, 12);
  }, VALIDATION_SEL).catch(() => [] as string[]);
  if (!koMsgs.length) {
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '유효성 문구 프로브', zone: 'validation',
      item: '검증문구 미노출', value: '동일/중복 체크·시간 역순 입력으로 검증문구 미유발(트리거 구조 상이 — 다음 런 정밀화) 또는 해당 폼에 유효성 없음', screenshot: '' });
    return;
  }
  // 대상 로케일서 재트리거 → 검증문구 재생성(신선 대상 렌더) → 분류. 잔존 한글/키누출 = 진짜 FAIL.
  const sw = await switchMobileLangRuntime(page, lang);
  if (!sw.ok) { skip(meta('대상 렌더'), sw.why); await restoreMobileKorean(page); return; }
  await trigger(); await settle(page, 700);
  const fgMsgs = await page.evaluate((valSel) => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(valSel)) as HTMLElement[]) {
      const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (t && t.length >= 2 && t.length <= 60 && !out.includes(t)) out.push(t);
    }
    return out.slice(0, 12);
  }, VALIDATION_SEL).catch(() => [] as string[]);
  await restoreMobileKorean(page);
  // 분류: 재트리거로 대상 로케일 신선 생성된 문구 → 한글잔존/혼재/키누출 = FAIL, 정상(번역) = PASS.
  const seenLocal = new Set<string>();
  for (const ft of fgMsgs) {
    if (seenLocal.has(ft)) continue; seenLocal.add(ft);
    let phen = '';
    if (KEY_LEAK_RE.test(ft)) phen = 'i18n 키 누출';
    else if (HANGUL_RE.test(ft)) phen = OTHER_SCRIPT_RE.test(ft) ? '언어 혼재' : '한글 노출';
    const m: CheckMeta = { path: `${tab} > ${sub}·유효성`, tcRef, tcId: `MLANG-${lang.ko}`, desc: phen ? `${lang.ko} 검증문구 ${phen}: "${ft.slice(0, 40)}"` : `${lang.ko} 검증문구 번역 정상: "${ft.slice(0, 40)}"`, expected: '검증문구(대상 로케일 재생성)', failMsg: phen || undefined };
    if (phen) record(m, 'FAIL', { actual: `${lang.label}: "${ft}"`, error: phen, detail: `${lang.label} 유효성 검증문구(신선 재트리거 — 비반응성 배제)` });
    else record(m, 'PASS', { actual: `${lang.label}: "${ft}"` });
  }
  gSeen.add(`__validation_${sub}`);
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
    if (shouldEmitFg(c, ch)) emitMobileComparison(ko, fg, lang, tab, sub, tcRef, gSeen);
    else skip(meta(sub, note), `대상 전환 미반영(공통 ${c}·변경 ${ch})`);
  };
  await restoreMobileKorean(page); await settle(page, 300);
  const before = page.url();
  const baseTitles = await headerTitles(page);   // 폼 오픈 전 헤더(스택 back 스코프용 — 프론트 폼 헤더 식별)
  if (!(await clickByTextFlex(page, regText))) { skip(meta('등록폼', '진입'), '등록폼 트리거 미발견/데이터 의존'); return; }
  await settle(page, 1_100); await killMobileAlarms(page);
  if (page.url() === before && !(await isOverlayOpen(page))) { skip(meta('등록폼', '진입'), '등록폼 화면 전환 없음'); return; }
  // 1) 폼 스캔(필드라벨·placeholder·라디오/체크·섹션·버튼·안내문구).
  const rawKo = await captureMobileSlots(page);
  let ko = rawKo;
  if (landingTexts.size) ko = ko.filter((s) => !landingTexts.has(s.text));
  // ⚠ 진단(2026-09-28, 사용자: "일상점검 등록 다수 항목 누락") — 폼 열렸는데 제목/설명/중요도 등 base 필드가 리포트서
  //   전부 누락 → 실제 캡처 내용을 남겨 원인(폼 미렌더/랜딩필터 과다/스택) 규명. rawKo=필터 전, ko=랜딩 제외 후.
  {
    const hdrs = await headerTitles(page).catch(() => [] as string[]);
    review({ lang: lang.ko, screen: `${tab} > 등록폼`, kind: '등록폼 base 진단', zone: 'capture',
      item: `헤더[${hdrs.join('/')}] rawKO ${rawKo.length}·랜딩제외후 ${ko.length}`,
      value: (ko.length ? ko : rawKo).slice(0, 14).map((s) => s.text).join(' / ') || '캡처 0(폼 미렌더/전환)', screenshot: '' });
  }
  if (ko.length) {
    const sw = await switchMobileLangRuntime(page, lang);
    if (sw.ok) {
      let fg = await captureMobileSlots(page);
      if (landingTexts.size) fg = fg.filter((s) => !landingTexts.has(s.text));
      cmp(ko, fg, '등록폼', '대조');
      // 레이아웃 결함 감사(폼 = 버튼/입력 밀집 → 겹침·오버플로·잘림 위험 최다. [지도에서 선택] 등 버튼 겹침 예시가 사는 곳).
      await auditLayout(page, lang, tab, '등록폼', tcRef).catch(() => {});
    } else skip(meta('등록폼', '대상 렌더'), sw.why);
    await restoreMobileKorean(page);
  } else skip(meta('등록폼', '캡처'), '폼 시스템 슬롯 0');
  // 1.5) 폼 내 딥(2026-09-17, 사용자: ? 툴팁·작업분류 드롭다운 누락) — 폼이 열린 상태에서 도움말 툴팁·드롭다운 옵션 스캔(비파괴).
  await scanTooltips(page, lang, tab, '등록폼', tcRef, gSeen);
  await scanSelectOptions(page, lang, tab, '등록폼', tcRef, gSeen);
  // 1.6) (P1) 유효성 검증문구(QA-15704 #5 종료<시작 시간·#9 동일자재 등록) — 비파괴 잘못된 입력 유발 → 검증문구 대조.
  await scanValidationMessages(page, lang, tab, '등록폼', tcRef, gSeen).catch(() => {});
  // ⚠ 폼 상태 가드(2026-09-29 진단: 이슈·시설 취소확인 미감지 원인 = scanTooltips/scanSelectOptions 후 폼이 닫혀
  //   **리스트에서 back이 눌림**(진단 헤더=리스트). back 전 폼 컨텍스트 재확보 — reg 트리거가 다시 보이면(=리스트로 빠짐) 폼 재오픈.
  await restoreMobileKorean(page); await settle(page, 300); await killMobileAlarms(page);
  const regVisible = await clickByTextFlexProbe(page, regText);   // 리스트로 빠졌는지(=reg 버튼 재노출) 판정
  if (regVisible) { await clickByTextFlex(page, regText); await settle(page, 1_100); await killMobileAlarms(page); }
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
    // ⚠ 모달 폴링(2026-09-29 사용자: 이슈·시설 [<] 시 취소확인 모달 정상 노출되는데 '미출현' 오탐).
    //   단일 settle(900) 후 1회 검사는 애니메이션 지연·감지신호 협소로 놓침 → 최대 ~2.6s 폴링 + 신호 확대
    //   (확인 문구 정규식 확대 "작업중이던 내용"·일반 취소 + 예/아니오 버튼쌍 + 오버레이).
    const CONFIRM_RE = /취소하시겠|나가시겠|저장하시겠|변경.*취소|삭제하시겠|작업중이던|내용을?\s*취소|이동하시겠|종료하시겠/;
    let confirmTxt = false, overlay = false, yesNo = false;
    for (let i = 0; i < 6; i++) {
      await settle(page, i === 0 ? 500 : 350); await killMobileAlarms(page);
      confirmTxt = await page.getByText(CONFIRM_RE).first().isVisible().catch(() => false);
      overlay = await isOverlayOpen(page);
      yesNo = await page.getByText(/^\s*예\s*$/).first().isVisible().catch(() => false)
        && await page.getByText(/^\s*(아니오|아니요|취소)\s*$/).first().isVisible().catch(() => false);
      if (confirmTxt || yesNo) break;
    }
    if (overlay || confirmTxt || yesNo) {
      // 스코프 폴백: OVERLAY_SEL 0이면 전체 body(확인모달이 표준 클래스 밖일 수 있음 — 조건설정 사례와 동일).
      let rootSel: string | undefined = OVERLAY_SEL;
      let kc = await captureMobileSlots(page, rootSel);
      if (!kc.length) { rootSel = undefined; kc = await captureMobileSlots(page); }
      if (kc.length) {
        const sw2 = await switchMobileLangRuntime(page, lang);
        if (sw2.ok) {
          let fc = await captureMobileSlots(page, rootSel);
          // ⚠ non-reactive 확인모달 FG 재마운트(2026-09-29 스크린샷: 모달이 KO서 열면 KO·FG세션서 열면 영어 = 생성시점 baked).
          //   switch-in-place FG가 KO와 동일 한글(=미반응)이면 [아니오]로 폼 복귀(비파괴)→[<] 재수행해 **FG로 모달 재마운트** 후 재캡처.
          const stale = fc.length && fc.some((s) => /[가-힣]/.test(s.text)) && fc.every((s) => { const k = kc.find((x) => x.key === s.key); return !k || k.text === s.text; });
          if (stale) {
            const no = page.getByText(/^\s*(아니오|아니요|취소)\s*$/).filter({ visible: true }).first();
            if (await no.count().catch(() => 0)) {
              await no.click({ timeout: 2_000 }).catch(() => {}); await settle(page, 600); await killMobileAlarms(page);   // 폼 복귀(이제 FG)
              let bk2 = await clickFrontLayerBack(page, baseTitles);
              if (!bk2) { const b = page.locator('i[class*="arrow-prev"], [class*="arrow-prev"], [class*="back"]').filter({ visible: true }).first(); if (await b.count().catch(() => 0)) { await b.click({ timeout: 3_000 }).catch(() => {}); bk2 = true; } }
              await settle(page, 900); await killMobileAlarms(page);
              let fc2 = await captureMobileSlots(page, rootSel); if (!fc2.length) fc2 = await captureMobileSlots(page);
              if (fc2.length) fc = fc2;   // 재마운트 FG 캡처로 대체(번역 확인 시 PASS·여전히 한글이면 진짜 미번역)
            }
          }
          cmp(kc, fc, backSub, '대조');
        } else skip(meta(backSub, '대상 렌더'), sw2.why);
        await restoreMobileKorean(page);
      } else {
        // 확인모달이 OVERLAY_SEL로 안 잡힘 → 실 구조 프로브(다음 이터레이션 셀렉터 보정용) 남기고 SKIP.
        const dump = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => /취소하시겠|나가시겠/.test((e as HTMLElement).innerText || '') && (e as HTMLElement).children.length <= 3).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().replace(/\s+/g, '.').slice(0, 40)}`)).catch(() => [] as string[]);
        review({ lang: lang.ko, screen: `${tab} > ${backSub}`, kind: '확인모달 DOM 프로브', zone: 'capture', item: `${dump.length}후보`, value: dump.join(' | '), screenshot: '' });
        skip(meta(backSub, '캡처'), '확인 모달 슬롯 0(프로브 참조)');
      }
      // [예]/[확인]으로 폼 종료(입력 없어 비파괴). 없으면 Escape.
      const yes = page.getByText(/^\s*(예|확인)\s*$/).filter({ visible: true }).first();
      if ((await yes.count().catch(() => 0)) && (await yes.isVisible().catch(() => false))) await yes.click({ timeout: 2_000 }).catch(() => {});
      else await page.keyboard.press('Escape').catch(() => {});
      await settle(page, 700);
    } else {
      // ⚠ 진단(2026-09-29 사용자: 이슈·시설 [<] 시 모달 정상 노출인데 미감지) — back 클릭이 실제 어디로 갔는지·
      //   현재 화면 상태를 남겨 다음 런서 원인(back 미클릭 vs 모달 클래스 미매칭) 규명. backOk=front헤더 back 성공여부.
      const nowH = await headerTitles(page).catch(() => [] as string[]);
      const bodyHint = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)).catch(() => '');
      review({ lang: lang.ko, screen: `${tab} > ${backSub}`, kind: '취소확인 미감지 진단', zone: 'capture',
        item: `backOk=${backOk}·헤더[${nowH.join('/')}]`, value: `본문선두: ${bodyHint}`, screenshot: '' });
      skip(meta(backSub, '출현'), '[<] 후 취소 확인 모달 미출현(진단 시트 참조 — back 도달·모달 클래스 확인)');
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
  const trig = page.locator('i[class*="question"], i[class*="help"], i[class*="ico-info"], [class*="ico-question"], [class*="circle-question"], [class*="question-mark"], [class*="ico-help"], [class*="help"], [class*="tooltip-btn"], [class*="help-btn"], button:has(i[class*="question"])').filter({ visible: true });
  let n = await trig.count().catch(() => 0);
  // 폴백: 텍스트가 정확히 '?' 인 작은 클릭 요소.
  const qMark = page.getByText(/^\?$/).filter({ visible: true });
  const nq = await qMark.count().catch(() => 0);
  // ⚠ 위치기반 폴백(2026-09-28, 사용자: "전화면 공통 [?] 모달 누락") — 헤더 우상단 원형 ? 아이콘이 class/glyph로 안 잡히는
  //   경우(svg·배경이미지) 대비: 헤더(y<90) 우측(x>W*0.6) 소형 클릭요소 좌표. 모달형 도움말("…이란?")을 확실히 포착.
  const helpCenters: { cx: number; cy: number }[] = await page.evaluate(() => {
    const W = window.innerWidth; const out: { cx: number; cy: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('button, [role="button"], i, svg, [class*="ico"], [class*="cursor-pointer"]'))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 14 || r.height < 14 || r.width > 60 || r.height > 60) continue;
      if (r.top > 90 || r.left + r.width / 2 < W * 0.6) continue;   // 헤더 우측만
      const cls = (el.className || '').toString();
      if (/arrow-prev|ico-home|ico-alarm|ico-profile|ico-search|ico-sort|ico-filter|ico-menu|ico-more|kebab|dots/.test(cls)) continue;
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      if (!out.some((o) => Math.abs(o.cx - cx) < 8 && Math.abs(o.cy - cy) < 8)) out.push({ cx, cy });
    }
    return out.slice(0, 3);
  }).catch(() => [] as { cx: number; cy: number }[]);
  // ── (P1) 인라인 라벨-인접 info 아이콘(2026-09-30 QA-15704 #10: 월간계획 툴팁 — 헤더 우측도 ? glyph도 아닌 **본문 인라인 info**) ──
  //   본문의 소형 아이콘(12~34px) 중 텍스트 리프와 가로 인접(≤48px)한 것 = 인라인 도움말 트리거. 네비/기능 아이콘은 class로 배제.
  const inlineCenters: { cx: number; cy: number }[] = await page.evaluate(() => {
    const out: { cx: number; cy: number }[] = [];
    const leaves = (Array.from(document.querySelectorAll('*')) as HTMLElement[])
      .filter((e) => e.children.length === 0 && (e.innerText || '').trim() && (e.getBoundingClientRect().width > 1));
    for (const ic of Array.from(document.querySelectorAll('i, svg, [class*="ico"], [class*="info"], [class*="question"], [class*="help"]'))) {
      const r = (ic as HTMLElement).getBoundingClientRect();
      if (r.width < 12 || r.height < 12 || r.width > 34 || r.height > 34) continue;
      const cls = (ic.className || '').toString();
      if (/arrow|home|alarm|profile|search|sort|filter|menu|more|kebab|dots|close|check|star|heart|trash|delete|edit|plus|minus|calendar|camera|image|download|upload|refresh|setting/i.test(cls)) continue;
      const near = leaves.some((l) => { const lr = l.getBoundingClientRect(); return Math.abs(lr.top - r.top) < 22 && (Math.abs(lr.right - r.left) < 48 || Math.abs(r.right - lr.left) < 48); });
      if (!near) continue;
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      if (!out.some((o) => Math.abs(o.cx - cx) < 8 && Math.abs(o.cy - cy) < 8)) out.push({ cx, cy });
    }
    return out.slice(0, 4);
  }).catch(() => [] as { cx: number; cy: number }[]);
  for (const c of inlineCenters) if (!helpCenters.some((h) => Math.abs(h.cx - c.cx) < 8 && Math.abs(h.cy - c.cy) < 8)) helpCenters.push(c);
  if (!n && !nq && !helpCenters.length) {
    const dump = await page.evaluate(() => Array.from(document.querySelectorAll('i, [class*="ico"]')).filter((e) => /q|help|info|hint/i.test((e.className || '').toString()) && (e as HTMLElement).offsetParent).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().replace(/\s+/g, '.').slice(0, 40)}`)).catch(() => [] as string[]);
    review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '툴팁 DOM 프로브', zone: 'tooltip', item: '트리거 0', value: dump.length ? dump.join(' | ') : '도움말/? 아이콘 후보 없음', screenshot: '' });
    return;
  }
  const HELP_SEL = `${TOOLTIP_SEL}, ${OVERLAY_SEL}`;   // 툴팁 + **모달형 도움말**("…이란?" 시트) 둘 다 포착(사용자: [?] 모달 누락)
  const total = Math.min((n || 0) + (nq || 0) + helpCenters.length, 8);
  for (let i = 0; i < total; i++) {
    const useCenter = i >= (n + nq);
    const el = i < n ? trig.nth(i) : (i < n + nq ? qMark.nth(i - n) : null);
    if (useCenter) {
      const c = helpCenters[i - n - nq]; if (!c) continue;
      await page.mouse.move(c.cx, c.cy).catch(() => {});   // (P1) hover-only 툴팁(월간계획 인라인 info) 대비 — 호버 후 클릭 병행
      await settle(page, 350);
      if (!(await page.locator(`${TOOLTIP_SEL}, ${OVERLAY_SEL}`).filter({ visible: true }).count().catch(() => 0))) {
        await page.mouse.click(c.cx, c.cy).catch(() => {});
      }
      await settle(page, 550); await killMobileAlarms(page);
    } else {
      if (!el || !(await el.isVisible().catch(() => false))) continue;
      await el.click({ timeout: 2_500 }).catch(() => {}); await settle(page, 600);
    }
    const tip = page.locator(HELP_SEL).filter({ visible: true }).first();
    if (!(await tip.count().catch(() => 0))) {
      const dump = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => /반복작업|의미합니다|참고|안내|입력할 수|이란\?|란\?/.test((e as HTMLElement).innerText || '') && (e as HTMLElement).children.length <= 2).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().replace(/\s+/g, '.').slice(0, 40)}`)).catch(() => [] as string[]);
      if (dump.length) review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '툴팁 DOM 프로브', zone: 'tooltip', item: `트리거#${i} 컨테이너 미포착`, value: dump.join(' | '), screenshot: '' });
      await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); continue;
    }
    const ko = await captureMobileSlots(page, HELP_SEL);
    if (ko.length) {
      const sw = await switchMobileLangRuntime(page, lang);
      if (sw.ok) {
        let fg = await captureMobileSlots(page, HELP_SEL);
        // ⚠ 툴팁 FG 재오픈(2026-09-29 스크린샷: 도움말이 화면은 영어인데 미번역/공통0 — 전환 시 툴팁 닫히거나 non-reactive).
        //   FG 캡처가 비었거나 KO 잔존(미반응)이면 **같은 트리거 재클릭**해 FG로 재마운트 후 재캡처.
        const needReopen = !fg.length || (fg.some((s) => /[가-힣]/.test(s.text)) && fg.every((s) => { const k = ko.find((x) => x.key === s.key); return !k || k.text === s.text; }));
        if (needReopen) {
          if (useCenter) { const c2 = helpCenters[i - n - nq]; if (c2) await page.mouse.click(c2.cx, c2.cy).catch(() => {}); }
          else if (el) { await el.click({ timeout: 2_500 }).catch(() => {}); }
          await settle(page, 600); await killMobileAlarms(page);
          const fg2 = await captureMobileSlots(page, HELP_SEL);
          if (fg2.length) fg = fg2;
        }
        const m = new Map(ko.map((s) => [s.key, s.text])); let c = 0, ch = 0;
        for (const f of fg) { if (m.has(f.key)) { c++; if (m.get(f.key) !== f.text) ch++; } }
        if (c > 0) emitMobileComparison(ko, fg, lang, tab, `${sub}·도움말`, tcRef, gSeen);
        else skip(meta('대조'), `도움말 공통 슬롯 0(변경 ${ch})`);
      } else skip(meta('대상 렌더'), sw.why);
      await restoreMobileKorean(page);
    }
    // 닫기(비파괴): Escape → 바깥 → closeOverlay(모달형). 확인 클릭 안 함(정보 모달이라 Escape로 충분).
    await page.keyboard.press('Escape').catch(() => {}); await settle(page, 250);
    if (await page.locator(HELP_SEL).filter({ visible: true }).count().catch(() => 0)) { await closeOverlay(page); }
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
    // ⚠ **인명/사용자입력 셀렉터 제외**(2026-09-28, 사용자: "제외 - 사용자 입력 항목") — 조장/작업자 등 인물 드롭다운은
    //   옵션이 등록된 작업자 인명(사용자 데이터) → 번역 대상 아님. 토글/필드라벨 텍스트로 식별해 통째 스킵(순수 인명
    //   정규식은 "전체"(전)·"진행중"(진) 등 시스템어 오제외 위험 → 컨텍스트 기반이 안전).
    const ctx = await tg.evaluate((el) => {
      const t = ((el as HTMLElement).innerText || '').trim();
      let p = el.parentElement; const lbls: string[] = [];
      // ⚠ 라벨 포착 강화(2026-09-29): 첫 라벨 1개만 잡던 것 → 조상 6단의 라벨류 **전부** 수집(거래처 라벨이 멀리 있어도 포착).
      for (let d = 0; d < 6 && p; d++) {
        p.querySelectorAll('label, dt, [class*="label"], [class*="tit"]').forEach((l) => { const s = ((l as HTMLElement).innerText || '').trim(); if (s && s.length < 20) lbls.push(s); });
        p = p.parentElement;
      }
      return `${t} ${lbls.join(' ')}`;
    }).catch(() => '');
    // ⚠ 사용자 데이터 드롭다운 제외 확대(2026-09-29 사용자 스크린샷: 장비·자재 등록폼 '거래처' 드롭다운 옵션이 업체명
    //   =스맛흐슥호어/티에이치배송대행/카트정비센터/코스조경/농약유통… = 사용자 등록 거래처). 인물 라벨에 더해 **거래처/업체 계열** 추가.
    //   거래처 선택은 항상 사용자 데이터(주요거래항목 관계형) → 통째 스킵. 시스템 enum(분류/그린/티박스)은 이 라벨 없음 → 오제외 없음.
    if (/조장|작업자|담당자|작성자|등록자|신청자|점검자|조치자|지시자|사용자|거래처|공급처|구매처|판매처|매입처|매출처|공급업체|협력업체|시공사|시공업체|제조사|제조업체|납품처|업체명|공사\s*업체|^업체$| 업체$/.test(ctx)) {
      review({ lang: lang.ko, screen: `${tab} > ${sub}·드롭다운#${i + 1}`, kind: '사용자데이터 셀렉터 제외', zone: 'select',
        item: '인물/거래처(사용자 입력) 드롭다운', value: `컨텍스트: "${ctx.slice(0, 40)}" → 옵션=등록 인명/업체명(번역대상 아님) 스킵`, screenshot: '' });
      continue;
    }
    await tg.click({ timeout: 2_500 }).catch(() => {}); await settle(page, 600);
    let koOpts = await readOpts();
    // ⚠ **옵션 내용 기반 인명/계정 드롭다운 제외**(2026-09-29 사용자: 작업지시 조장/작업자 드롭다운 인명 19건 누수 — 토글 컨텍스트로 못 걸림).
    //   옵션의 30%↑가 계정 마커(_결합·마스터/관리자/사용자/테스트/개발/매니저/master/admin)면 = 등록 인원 선택 드롭다운 → 통째 스킵(순수 인명 강나연 등도 함께 제외).
    //   시스템 enum 드롭다운(그린/티박스/전체/진행중)은 이런 마커 없음 → 오제외 안 됨.
    {
      const acctRe = /_|마스터|관리자|사용자|테스트|개발|매니저|master|admin/i;
      const frac = koOpts.length ? koOpts.filter((o) => acctRe.test(o)).length / koOpts.length : 0;
      if (koOpts.length >= 2 && frac >= 0.3) {
        review({ lang: lang.ko, screen: `${tab} > ${sub}·드롭다운#${i + 1}`, kind: '인명/계정 셀렉터 제외(옵션내용)', zone: 'select',
          item: `계정마커 ${Math.round(frac * 100)}% (${koOpts.length}옵션)`, value: `등록 인원 선택 드롭다운 → 사용자 데이터, 번역대상 아님 스킵. 예: ${koOpts.slice(0, 5).join(' / ')}`, screenshot: '' });
        await page.keyboard.press('Escape').catch(() => {}); await settle(page, 250);
        if (await page.locator('.vs__dropdown-menu').filter({ visible: true }).count().catch(() => 0)) { await page.mouse.click(5, 5).catch(() => {}); await settle(page, 200); }
        continue;
      }
    }
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
    const reactive = shouldEmitFg(cmpLen, changed);
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

// ── 레이아웃 결함 감사(2026-09-28) — 번역 검증과 별개 축(레이아웃 무결성). 비파괴(측정만) ──────────
//   DOM 지오메트리로 결정론적 검출(픽셀 비교·베이스라인 불요). 현재 활성 언어(호출 시점) 렌더 기준 →
//   FG(대상 언어) 상태에서 호출하면 **다국어 특유 오버플로**(영어/베트남어 긴 텍스트로 겹침·잘림)까지 포착.
//     · 버튼겹침(후보): rect 교차 ≥ 작은쪽 35% + **elementFromPoint 히트테스트**(각 요소가 자기중심 최상위·교차중심에 실제 픽셀) → **관찰(REVIEW)**
//        ⚠ 2026-09-28 사용자 실측: rect 교차만으론 오검출(z-index로 뒤에 가려짐·전환중 순간위치·rect>칠해진영역). DOM만으로 시각겹침 단정 불가 →
//          히트테스트로 스택/팬텀 제거 후에도 **FAIL 아닌 관찰**(눈으로 확인)로만 기록. 정직 리포팅(가짜 FAIL 금지).
//     · 영역벗어남: 페이지 가로 스크롤 발생 + 요소 right > 뷰포트 폭(가로 스크롤 컨테이너 안이면 정상 제외) → FAIL
//     · 글자잘림: leaf 텍스트 scroll > client + overflow hidden/clip + textOverflow≠ellipsis → FAIL / 말줄임(ellipsis)=관찰
//   전용 시트 "레이아웃 결함"(경로 첫 세그먼트) → 번역 PASS/FAIL율 비오염. 결함마다 스크린샷 저장.
//   ⚠ 에뮬 한계: 소프트키보드가 버튼 가림(R5)·회전·OS분기는 iPhone13 에뮬 미재현 → 이 감사는 정적 레이아웃만(그런 유형은 실기기 수동).
interface LayoutFinding { type: string; sig: string; detail: string; severity: 'FAIL' | 'REVIEW'; rect?: { x: number; y: number; w: number; h: number } }
async function auditLayout(page: Page, lang: CourseLang, tab: string, sub: string, tcRef: string, rootSel?: string): Promise<void> {
  await settle(page, 400);   // 전환/애니메이션 안정화 후 측정(순간 위치 오탐 방지)
  const findings: LayoutFinding[] = await page.evaluate((rootSel) => {
    const W = window.innerWidth, H = window.innerHeight;
    const roots = rootSel ? Array.from(document.querySelectorAll(rootSel)) : [document.body];
    if (!roots.length) return [] as LayoutFinding[];
    const vis = (el: Element): boolean => {
      const he = el as HTMLElement; const r = he.getBoundingClientRect(); const st = getComputedStyle(he);
      return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05
        && r.bottom > 0 && r.top < H;   // 세로로 뷰포트 밖(스크롤로 가려진 것)은 제외 — 오탐 방지
    };
    const txt = (el: Element): string => ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    const pathOf = (el: Element): string => {
      const p: string[] = []; let e: Element | null = el;
      for (let i = 0; i < 4 && e && e.nodeType === 1; i++) {
        let s = e.tagName.toLowerCase(); const c = (e.className || '').toString().trim().split(/\s+/)[0];
        if (c && !/^\d/.test(c)) s += '.' + c.slice(0, 20); p.unshift(s); e = e.parentElement;
      }
      return p.join('>');
    };
    const out: LayoutFinding[] = [];
    const all = roots.flatMap((rt) => Array.from(rt.querySelectorAll('*')));

    // ① 글자 잘림(hard clip) / 말줄임(관찰)
    for (const el of all) {
      if ((el as HTMLElement).children.length) continue;   // leaf만
      if (!vis(el)) continue;
      const t = txt(el); if (t.length < 2) continue;
      const he = el as HTMLElement; const st = getComputedStyle(he);
      const overW = he.scrollWidth > he.clientWidth + 2, overH = he.scrollHeight > he.clientHeight + 2;
      if (!(overW || overH)) continue;
      const hidden = /hidden|clip/.test(st.overflow) || /hidden|clip/.test(st.overflowX) || /hidden|clip/.test(st.overflowY);
      const rc = he.getBoundingClientRect(); const rect = { x: rc.left, y: rc.top, w: rc.width, h: rc.height };
      if (hidden && st.textOverflow !== 'ellipsis') {
        out.push({ type: '글자잘림', sig: pathOf(el) + '|' + t.slice(0, 16), severity: 'FAIL', rect,
          detail: `"${t.slice(0, 30)}" 잘림(내용 ${he.scrollWidth}×${he.scrollHeight} > 표시 ${he.clientWidth}×${he.clientHeight}, overflow=${st.overflowX}/${st.overflowY})` });
      } else if (st.textOverflow === 'ellipsis') {
        out.push({ type: '말줄임(관찰)', sig: pathOf(el) + '|' + t.slice(0, 16), severity: 'REVIEW', rect,
          detail: `"${t.slice(0, 30)}" 말줄임(…) 처리 — 의도 확인 요망` });
      }
    }

    // ② 영역 벗어남(가로 오버플로) — 페이지 자체에 가로 스크롤이 생긴 경우만
    if (document.documentElement.scrollWidth > W + 2) {
      for (const el of all) {
        if (!vis(el)) continue;
        const he = el as HTMLElement; if (he.children.length > 3) continue;   // 소형/리프만(컨테이너 제외)
        const t = txt(el); if (!t && !el.matches('input,textarea,img,button')) continue;
        const r = he.getBoundingClientRect();
        if (r.width < 10 || r.height < 8) continue;
        if (!(r.right > W + 4 && r.left < W && r.left >= -2)) continue;
        // 가로 스크롤 컨테이너(캐러셀 등) 안이면 정상
        let inScroll = false, p = he.parentElement;
        for (let i = 0; i < 6 && p; i++) { if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { inScroll = true; break; } p = p.parentElement; }
        if (inScroll) continue;
        out.push({ type: '영역벗어남', sig: pathOf(el) + '|R', severity: 'FAIL', rect: { x: r.left, y: r.top, w: r.width, h: r.height },
          detail: `"${(t || el.tagName).slice(0, 25)}" 우측 경계 초과(right ${Math.round(r.right)} > 뷰포트폭 ${W})` });
      }
    }

    // ③ 버튼/요소 겹침 — 가시 clickable 쌍의 교차 ≥ 작은쪽 35%
    const clickables = all.filter((el) => el.matches('button, a[href], [role="button"], input:not([type="hidden"]), .button-common, .btn'))
      .filter(vis).filter((el) => { const r = el.getBoundingClientRect(); return r.width >= 16 && r.height >= 16 && r.width < W * 0.98; });
    const isAnc = (a: Element, b: Element) => a.contains(b) || b.contains(a);
    for (let i = 0; i < clickables.length; i++) {
      for (let j = i + 1; j < clickables.length; j++) {
        const A = clickables[i], B = clickables[j]; if (isAnc(A, B)) continue;
        const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
        const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
        const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
        const inter = ix * iy; if (inter <= 0) continue;
        const minA = Math.min(ra.width * ra.height, rb.width * rb.height); if (minA <= 0) continue;
        if (inter < minA * 0.35) continue;
        // ⚠ **시각 겹침 검증(2026-09-28 사용자: 4건 전부 오검출·실제 안 겹침)**: getBoundingClientRect 교차=사각형 겹침일 뿐
        //   시각 겹침이 아님(z-index로 뒤에 가려짐=Edit/New 스택·전환중 순간위치·rect가 칠해진 영역보다 큼). elementFromPoint 히트테스트로
        //   ①두 요소가 각자 중심에서 실제 최상위(안 가려짐) ②교차영역 중심에 실제 둘 중 하나가 칠해짐 을 확인 → 팬텀/스택 제거.
        const within = (hit: Element | null, el: Element): boolean => !!hit && (hit === el || el.contains(hit) || hit.contains(el));
        const caX = ra.left + ra.width / 2, caY = ra.top + ra.height / 2;
        const cbX = rb.left + rb.width / 2, cbY = rb.top + rb.height / 2;
        const ixCx = Math.max(ra.left, rb.left) + ix / 2, ixCy = Math.max(ra.top, rb.top) + iy / 2;
        const inVP = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
        if (!inVP(caX, caY) || !inVP(cbX, cbY) || !inVP(ixCx, ixCy)) continue;   // 뷰포트 밖=확인 불가 → 오탐 방지로 건너뜀
        const hitA = document.elementFromPoint(caX, caY), hitB = document.elementFromPoint(cbX, cbY), hitI = document.elementFromPoint(ixCx, ixCy);
        if (!within(hitA, A) || !within(hitB, B)) continue;        // 한쪽이 다른 요소에 가려짐 = 스택(시각 겹침 아님)
        if (!(within(hitI, A) || within(hitI, B))) continue;       // 교차영역에 버튼 픽셀 없음 = 팬텀 rect
        const rawA = txt(A), rawB = txt(B);
        const la = (rawA.slice(0, 15) || A.getAttribute('aria-label') || '(아이콘)');
        const lb = (rawB.slice(0, 15) || B.getAttribute('aria-label') || '(아이콘)');
        const ux = Math.min(ra.left, rb.left), uy = Math.min(ra.top, rb.top);
        const rect = { x: ux, y: uy, w: Math.max(ra.right, rb.right) - ux, h: Math.max(ra.bottom, rb.bottom) - uy };
        // ⚠ DOM만으로 시각 겹침을 단정 불가 → **항상 관찰(REVIEW)**: 단정(FAIL) 아닌 "눈으로 확인 요망" 후보(정직 리포팅).
        out.push({ type: '버튼겹침(후보)', sig: pathOf(A) + '##' + pathOf(B), severity: 'REVIEW', rect,
          detail: `"${la}" ↔ "${lb}" rect 교차 ${Math.round(inter / minA * 100)}%·히트테스트 통과 — 시각 확인 요망` });
      }
    }
    return out.slice(0, 60);
  }, rootSel).catch(() => [] as LayoutFinding[]);

  for (const f of findings) {
    const key = f.type + '|' + f.sig;   // 런 전역 dedup(언어 무관 — 레이아웃은 재진입·언어 반복해도 동일 결함)
    if (gLayoutSeen.has(key)) continue; gLayoutSeen.add(key);
    const shot = await captureShot(page, `layout-${f.type}`, f.rect).catch(() => '');   // 결함 영역만 클립(구분되는 증거)
    if (f.severity === 'REVIEW') {
      review({ lang: lang.ko, screen: `${tab} > ${sub}`, kind: '레이아웃 관찰', zone: f.type, item: f.detail, value: `${lang.ko} 렌더`, screenshot: shot });
      continue;
    }
    record({ path: `레이아웃 결함 > ${tab} > ${f.type}`, tcRef, tcId: `LAYOUT-${lang.ko}`,
      desc: `${lang.ko} 렌더 · ${sub} · ${f.type}`, failMsg: f.type },
      'FAIL', { actual: f.detail, error: f.type, detail: `${sub} (${lang.ko} 모드) 레이아웃 결함`, screenshot: shot });
  }
}

// ── 화면 대상(랜딩 + 시스템 텍스트가 풍부한 대표 영역) ──────────────────────────
//   전 9영역은 세션 1런/로그인 한계상 과다 → 랜딩 + 대표 4영역(시스템 chrome 밀집). tile=-1=랜딩(URL), 그 외=타일 nth 클릭.
// 랜딩 + **전 9영역**(사용자 요청 전수). ⚠ 세션 1런/로그인 한계상 길어짐 → 중간 만료 시 후반 SKIP(정직).
//   ⚠ 진입은 **공백 무시 타일 매칭 + route 검증**(gotoMobileAreaFlex) — 타일 텍스트가 area명과 공백 다름
//   (시설관리↔"시설 관리"·코스정보↔"코스 정보 입력"·코스뷰↔"코스뷰") → hasText 정확매칭 실패 방지.
//   openers = 화면 내 **비파괴 오버레이 트리거**(조건설정 모달·정렬 드롭다운) → 딥 인터랙션 팝업 다국어 검증(별도 탭).
//   reg = [등록] 버튼(비파괴 폼 스캔 — 열어서 필드라벨·placeholder만 대조, 저장 안 함). 최신순/이름순은 팝업 없어(정렬 토글) 제외.
const MOBILE_LANG_SCREENS: { label: string; match: string | null; route: string; openers?: string[]; date?: boolean; reg?: string; mapModals?: boolean; hub?: boolean; extraNav?: string[]; filter?: boolean }[] = [
  { label: '랜딩', match: null, route: 'course' },
  { label: '작업 지시', match: '작업지시', route: 'orderMain', date: true, reg: '작업지시 등록' },
  { label: '작업 관리', match: '작업관리', route: 'orderList', openers: ['조건설정'], date: true },
  { label: '코스 뷰', match: '코스뷰', route: 'monitorMap', mapModals: true },
  { label: '일상 점검', match: '일상점검', route: 'dailyCheck', openers: ['조건설정'], reg: '점검 등록' },
  { label: '코스 정보 입력', match: '코스정보', route: 'submission', hub: true },   // ⚠ 시트명=대메뉴(코스 정보 입력) — 하위모듈(거래처/잔디측정 등)이 이 시트 안에 화면으로 계층 편입(2026-09-29)
  { label: '이슈/예측', match: '이슈/예측', route: 'issuePrediction', openers: ['조건설정'], reg: '이슈 등록', extraNav: ['예측달력'] },
  { label: '장비관리', match: '장비관리', route: 'equipmentList', reg: '장비등록' },
  { label: '시설관리', match: '시설관리', route: 'facilityList', openers: ['조건설정'], reg: '시설 등록' },
  { label: '자재관리', match: '자재관리', route: 'materialList', reg: '입고된 자재 등록', filter: true },   // filter: 분류 필터 적용 후 레이아웃 감사(#11)
];

// 한 화면 검증(KO 기준 ↔ 대상언어 대조). ⚠ 외국어 로그인 세션은 ko+대상 사전 동시 적재 → 양방향 주입 가능(2026-09-15 실측).
//   대상(FG) 캡처 → KO 주입 후 기준 캡처 → 데스크톱 applySlotComparison(무수정) → 리포트에 "한국어 원문 → 대상값" + PASS/FAIL.
// ── non-reactive 요소 거짓 FAIL 방지(2026-09-29 사용자 스크린샷: 단일/반복 뱃지·취소확인 모달·도움말 툴팁이
//    화면은 영어인데 KO 잔존으로 '한글 노출' FAIL). 원인: 일부 요소가 런타임 locale.value 변경에 반응 안 함(생성 시점 언어 baked).
//    → FAIL 후보(FG 텍스트가 KO와 동일한 한글)만 **화면을 FG 로케일로 재마운트**(enter 재호출·SPA 클라이언트 내비라 i18n 유지)해 재확인:
//    재마운트서 번역되면 거짓양성(override로 PASS 처리), 여전히 한글이면 진짜 미번역(FAIL 유지). 후보 없으면 no-op(비용·리스크 최소).
// (2026-09-29 제거) refreshFgNonReactive — enter() 가 enterMobileScreenKorean(→restoreMobileKorean)로 **한국어 재마운트**하여
//   "신선 FG"가 실제로 한국어였음(구조적 no-op). captureFgFresh(reload=대상 부팅) 로 대체.

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
  if (reactive) gSessionReactive = true;   // 세션 전환 확인 → 이후 서브뷰 "변경0"은 미번역 실결함으로 취급(전환 미반영 오판 방지)
  diag(`KO ${ko.length}·FG ${fg.length}·공통 ${common}·변경 ${changed}·반응성 ${reactive ? 'O(대조)' : 'X'}`);

  if (!ko.length) { skip(sMeta('고유콘텐츠'), '랜딩 메뉴 제외 후 고유 슬롯 0(서브페이지 고유 시스템텍스트 없음/데이터화면)'); return koTexts; }
  // ⚠ emit 판정에 세션 반응성 반영(2026-09-28): 이 화면 자체 변경이 낮아도(예 코스정보 base 공통7·변경1) **세션 전환이 이미 확인**(gSessionReactive)됐으면
  //   나머지 한글 잔존은 미번역 실결함 → emit(정직). 단 auditForeignHangulResidue(FG 한글 전수 스캔)는 **이 화면이 실제 FG 렌더**임이 확실할 때만(strict reactive)
  //   — 세션은 되는데 이 화면만 미렌더면 false FAIL 위험이 크기 때문(보수적).
  if (reactive || (gSessionReactive && common > 0)) {
    // ⚠ FG-우선 신선 캡처(2026-09-29, 비반응성 거짓 FAIL 근절): base 화면은 URL 주소지정 가능 풀페이지 →
    //   captureFgFresh(reload=대상 부팅)로 FG 재캡처 → 확인모달/상태뱃지/섹션제목/요일 등 비반응성 요소도 **대상 언어 신선 마운트**.
    //   신선 성공(fresh=true) 시에만 잔존 한글=실제 미번역 FAIL 판정. reload 실패/부팅≠대상 → 스위치-인-플레이스 폴백(잔존=관찰).
    let freshFg = false;
    { const r = await captureFgFresh(page); if (r.fresh) { fg = landingTexts.size ? r.slots.filter((s) => !landingTexts.has(s.text)) : r.slots; freshFg = true; } }
    // 모바일 이미터 — PASS=한국어 원문↔대상값, 잔존은 freshFg 일 때만 FAIL(그 외 관찰). 경로 `모바일-<화면> > 기본 > zone`, 런-전역 dedup.
    emitMobileComparison(ko, fg, lang, tab, '기본', tcRef, gSeen, freshFg);
    // 누락 오라클 ①: FG(대상언어) 모드에서 **검증 안 된 한글 잔존** = 놓친 시스템텍스트/미번역. accountedKo=이 화면 KO + 랜딩.
    //   ⚠ 신선 렌더(reload 대상 부팅)일 때만 신뢰(스위치-인-플레이스면 비반응성 한글이 전면 오탐). 지금 page 는 대상 모드 → restoreKorean 전에 실행.
    if (freshFg) {
      const accounted = new Set<string>([...koTexts, ...landingTexts]);
      await auditForeignHangulResidue(page, lang, tab, '기본', tcRef, accounted);
    }
  } else {
    // 대상 전환이 반영 안 됨 → FG가 여전히 한국어일 수 있어 누수 스캔은 false FAIL 위험 → 정직 SKIP(진단 기록).
    skip(sMeta('대조'), `대상 전환 미반영(공통 ${common} 중 변경 ${changed})${gSessionReactive ? '' : ' — 런타임 리렌더 실패, 재시도 필요'}`);
  }
  // 레이아웃 결함 감사(번역 반응성 무관 — 겹침/오버플로/잘림은 언어 렌더와 별개). 현재 FG(대상 언어) 상태에서 검출.
  await auditLayout(page, lang, tab, '기본', tcRef).catch(() => {});
  await restoreMobileKorean(page);   // 다음 화면 위해 KO 원복
  return koTexts;
}

// ── 엔트리: 한 언어 모바일 다국어 검증 ────────────────────────────────────────
//   ⚠ 대상 언어로 로그인된 세션 필요(외국어 로그인 = ko+대상 사전 동시 적재 → KO 기준 대조 가능).
//   한국어 로그인(ko 사전만) 세션은 대상 미렌더 → 정직 SKIP + 재로그인 안내.
export async function runCourseMobileLang(page: Page, lang: CourseLang): Promise<void> {
  const tcRef = `코스관리모바일_다국어_${lang.ko}`;
  // 예산: test timeout(1800s=30분) 내 writeReport 여유(3분) 확보 → 기본 1620s(27분). 초과 시 남은 화면 SKIP.
  //   ⚠ 2026-09-30 상향(1350→1620): VN 10화면 런이 ~24분 소요(코스정보 허브 ~6.5분+#7 정렬옵션 추가분) → 자재관리(마지막) 컷 해소.
  // 예산: test timeout(2520s=42분) 내 writeReport + 마지막 시작화면 오버슈트(코스정보 허브 ~6.5분) 여유 확보 → 기본 1920s(32분).
  //   ⚠ 예산은 화면 **시작 시점**에만 체크 → 예산 직전 시작한 화면은 완주(최대 ~6.5분 초과 가능) → test timeout 은 예산+오버슈트+writeReport 합보다 커야 함.
  //   2026-09-30 P1~P3 반영(유효성/오버레이 auditLayout/인라인 툴팁/분류필터/연결 2-hop, ~2~3분 추가) 흡수 위해 27→32분 상향.
  gDeadline = Date.now() + Number(process.env.MLANG_BUDGET_MS || 1_920_000);
  gLayoutSeen = new Set<string>();   // 레이아웃 결함 dedup 런마다 리셋
  gSessionReactive = false;          // 세션 반응성 플래그 리셋(랜딩 base에서 재확정)
  // 화면 서브셋 필터(1런/로그인 제약상 커버리지 분할) — env MLANG_SCREENS="코스정보,이슈" 식(랜딩은 항상 포함).
  const only = (process.env.MLANG_SCREENS || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  const st = await readMobileI18n(page);
  // 부팅 로케일=대상 여부 확정(FG-우선 신선 캡처 게이트). st.locale=런 시작 시점 메모리=부팅=localStorage 로케일.
  //   대상 로그인(부팅=대상)이면 reload 로 대상 신선 마운트 확보 → 비반응성 요소 실제 렌더 검증(거짓 FAIL 근절).
  gBootIsTarget = !!st.locale && (LANG_CODE_CANDIDATES[lang.ko] || []).includes(String(st.locale));

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
  const screens = only.length
    ? MOBILE_LANG_SCREENS.filter((s) => s.match == null || only.some((o) => s.label.replace(/\s+/g, '').includes(o) || o.includes(s.label.replace(/\s+/g, ''))))
    : MOBILE_LANG_SCREENS;
  // ⚠ **필터 투명화**(2026-09-28, 사용자: "검증 미수행 메뉴 다수" — 잔존 셸 env MLANG_SCREENS 원인). 필터가 걸리면 리포트/콘솔에
  //   명시해 "미수행"이 코드 결함이 아니라 **의도적/잔존 필터**임을 즉시 식별. 전체 실행하려면 env를 비워야 함(Remove-Item Env:MLANG_SCREENS).
  const skipped = MOBILE_LANG_SCREENS.filter((s) => !screens.includes(s)).map((s) => s.label);
  if (only.length) {
    console.log(`[course-mobile-lang] ⚠ MLANG_SCREENS 필터 활성=[${only.join(',')}] → 대상 ${screens.map((s) => s.label).join('/')} · 미수행 ${skipped.join('/') || '없음'}`);
    review({ lang: lang.ko, screen: '코스관리(모바일)', kind: '⚠ 화면 필터 활성(MLANG_SCREENS)', zone: 'run',
      item: `대상 ${screens.length}개: ${screens.map((s) => s.label).join(', ')}`,
      value: `미수행 ${skipped.length}개: ${skipped.join(', ') || '없음'} — 전체 검증하려면 셸 env MLANG_SCREENS 를 비우세요(PowerShell: Remove-Item Env:MLANG_SCREENS). 잔존 env가 흔한 "미수행" 원인.`, screenshot: '' });
  }
  for (const scr of screens) {
    // ⏱ 예산 초과 → 남은 화면 정직 SKIP(리포트 도달 보장). 랜딩은 이미 처리됐을 것.
    if (scr.match != null && overBudget()) {
      skip({ path: `모바일-${scr.label} > 기본`, tcRef, tcId: `MLANG-${lang.ko}`, desc: `${lang.ko} 시간 예산 초과` }, `시간 예산(${Math.round(Number(process.env.MLANG_BUDGET_MS || 1_920_000) / 1000)}s) 초과 — 이 화면 이후 미수행. MLANG_SCREENS 로 분할 실행 권장`);
      continue;
    }
    // ⚠ **화면 단위 중복 제거**(2026-09-15 재조정): 런-전역 dedup은 공통 폼필드(제목·상세·중요도…)를 앞 화면서 1회 검증 후
    //   뒤 화면 폼을 통째로 비워 "폼 검증 안 됨"처럼 보이게 함 → gSeen을 **화면마다 리셋**. 화면 내 세그먼트 간 중복만 제거,
    //   각 화면은 자기 폼·검색·상세를 온전히 노출(화면 간 공통 문자열은 화면별로 반복 허용 = 화면별 완결 커버리지).
    const gSeen = new Set<string>();
    const koTexts = await verifyMobileScreen(page, lang, scr.label, tcRef, async () => enterMobileScreenKorean(page, scr.match, scr.route), landingTexts, gSeen);
    if (scr.match == null) koTexts.forEach((t) => landingTexts.add(t));   // 랜딩 텍스트 축적(이후 서브화면 필터 기준)
    if (!koTexts.length) continue;   // 진입 실패 화면은 딥 인터랙션 생략
    // 딥⓪: [?] 헤더 도움말 모달("…이란?") — **전화면 공통**(사용자 지적). 리스트/랜딩 화면 base 에서 스캔.
    if (!scr.mapModals && !scr.hub) await scanTooltips(page, lang, `모바일-${scr.label}`, '기본', tcRef, gSeen);
    // 딥⓪-b: 화면 고유 서브뷰(이슈/예측=예측달력 등) — 버튼 클릭 → 새 화면 캡처 → 복귀.
    for (const ev of scr.extraNav || []) {
      await scanNavScreen(page, lang, scr.label, ev, tcRef, async () => {
        const b = page.getByText(new RegExp(`^\\s*${ev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)).filter({ visible: true }).first();
        if (!(await b.count().catch(() => 0))) return false;
        const before = page.url();
        await b.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 1_000); await killMobileAlarms(page);
        return page.url() !== before || (await headerTitles(page).then((hs) => hs.some((h) => h.replace(/\s/g, '').includes(ev.replace(/\s/g, '')))).catch(() => false));
      }, landingTexts, gSeen, false, false, true);
    }
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
    // 딥②: 검색(헤더 검색 아이콘) — 리스트형 화면(지도·허브 제외).
    if (scr.match != null && !scr.mapModals && !scr.hub) await scanSearch(page, lang, scr.label, tcRef, gSeen);
    // 딥②-b: 정렬 토글(최신순↔과거순) — 리스트형 화면. 기본값만 잡히던 "과거순" 커버(사용자 지적).
    if (scr.match != null && !scr.mapModals && !scr.hub) await scanSortToggle(page, lang, scr.label, tcRef, gSeen);
    // 딥③: datepicker(달력) — 기간 필터 보유 화면.
    if (scr.date) await scanDatepicker(page, lang, scr.label, tcRef, gSeen);
    // 딥③-b: (P3) 분류필터 적용 후 레이아웃 감사(#11 자재 분류필터). 크롤 직전 → 크롤의 클린 재진입이 필터 상태 리셋.
    if (scr.filter) await scanListFilterLayout(page, lang, scr.label, tcRef).catch(() => {});
    // 딥④(LAST): 네비게이션형 파괴형 크롤 — 랜딩=[나의 작업 보기], 리스트 화면=항목→상세(카드 우측 chevron). 드리프트 격리 위해 맨 끝.
    if (scr.mapModals) {
      // 코스 뷰(지도) = 리스트/상세 없음 → 우상단 컨트롤 3모달 스캔(코스뷰/보기옵션/관리). 사용자: "버튼 선택시 노출 화면 누락".
      await scanCourseViewModals(page, lang, scr.label, tcRef, gSeen);
    } else if (scr.hub) {
      // 코스정보 = 하위 모듈 허브(코스운영/잔디측정/토양측정/발병/거래처) → 각 모듈 진입해 리스트 딥 스캔 전면 재사용.
      await scanCourseInfoHub(page, lang, tcRef, landingTexts, gSeen, destructiveOk);
    } else if (scr.match == null) {
      // ⚠ 나의 작업 보기 = **별도 탭**(사용자 요청): parentLabel 자체를 화면명으로 → tab=`모바일-나의 작업 보기`.
      await scanNavScreen(page, lang, '나의 작업 보기', '기본', tcRef, async () => {
        // ⚠ 검증된 진입 패턴(courseMobileSuites 2)): 앱 내비로 랜딩 재진입 후 '나의 작업 보기' 클릭 → /mobile/course/myTask.
        //   2026-09-29 진단: page.goto(gotoMobileLanding) 딥링크는 타일 미렌더 + visible 필터가 요소 걸러 '트리거 미발견' 회귀 →
        //   base 스캔과 동일한 enterMobileScreenKorean(null)(goto+enterCourseMgmt 폴백)로 확실히 랜딩 렌더 후, 필터 없이 .first() 클릭.
        await restoreMobileKorean(page);
        await enterMobileScreenKorean(page, null, 'course'); await settle(page, 700); await killMobileAlarms(page);
        const b = page.getByText('나의 작업 보기', { exact: true }).first();
        if (!(await b.count().catch(() => 0))) return false;
        await b.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 1_200);
        return true;
      }, landingTexts, gSeen, true, destructiveOk, true, /작업번호|W-\d{3,}|월간계획|작업완료|작업기간/, true);   // crawl+파괴가드+ownSeen + 도착신호 + 툴팁스캔(월간계획 #10)(2026-09-29 사용자 스크린샷: W-00038 진행중 렌더되는데 4신호 미감지로 오탐 SKIP → 상세 마커로 진입확정)
    } else {   // 리스트형 화면: 항목→상세 진입 — 검증된 courseInfoDetailNav 재사용(제목 <a> 링크 포함·새 레이어 신호)
      // ⚠ **상세 전 클린 리스트 재진입**(2026-09-28 실측: 일상 상세 실패 프로브 "헤더[]·대기중 0" = 앞선 검색/정렬/등록폼이
      //   리스트를 필터·빈 상태로 더럽힘 → 카드 0). 허브 모듈은 재진입해 성공했음. 메인도 상세 직전 하드 재진입으로 클린 리스트 확보.
      await enterMobileScreenKorean(page, scr.match, scr.route); await settle(page, 500); await killMobileAlarms(page);
      // ⚠ 통일(2026-09-28 실측): 이전 navFn(a 미포함)은 장비/자재/일상(제목이 <a> 링크) 상세 진입 실패(SKIP), 반면
      //   허브 모듈은 courseInfoDetailNav(a 포함)로 전부 성공 → 메인도 동일 navFn 사용. chevron 우선 시도 후 폴백.
      await scanNavScreen(page, lang, scr.label, '상세', tcRef, async () => {
        const before0 = page.url();
        const baseH = await headerTitles(page).catch(() => [] as string[]);
        const newLayer = async () => page.url() !== before0
          || (await headerTitles(page).then((hs) => hs.some((h) => /상세/.test(h) || !baseH.includes(h))).catch(() => false));
        const chev = page.locator('i[class*="ico-arrow-next"], [class*="arrow-next"]').filter({ visible: true }).first();
        if (await chev.count().catch(() => 0)) { await chev.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 900); if (await newLayer()) return true; }
        if (await courseInfoDetailNav(page)()) return true;   // 제목 <a>/카드(날짜 우선) 클릭 + 상세 헤더 신호
        // ⚠ 진입 실패 프로브(2026-09-28, 장비/자재/일상 상세 미진입 규명) — 현재 화면의 카드/링크 후보 구조 덤프(다음 런 정밀수정).
        const probe = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll('a, [class*="card"], [class*="bd-"], [class*="bdr-"], li')).slice(0, 40)) {
            const he = el as HTMLElement; const r = he.getBoundingClientRect();
            if (r.width < 40 || r.height < 24) continue;
            const t = (he.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20);
            if (!t) continue;
            out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().replace(/\s+/g, '.').slice(0, 28)}${(el as HTMLAnchorElement).href ? '[href]' : ''}="${t}"`);
            if (out.length >= 10) break;
          }
          return { url: location.pathname, hdrs: Array.from(document.querySelectorAll('[class*="header-title"]')).map((e) => (e as HTMLElement).innerText.trim()).filter(Boolean).slice(0, 4), cands: out };
        }).catch(() => ({ url: '', hdrs: [] as string[], cands: [] as string[] }));
        review({ lang: lang.ko, screen: `코스관리(모바일) > ${scr.label}`, kind: '상세 진입 실패 프로브', zone: 'nav',
          item: `url=${probe.url} 헤더[${probe.hdrs.join('/')}]`, value: probe.cands.join('  |  ') || '카드/링크 후보 없음(리스트 밖/데이터0)', screenshot: '' });
        return false;
      }, landingTexts, gSeen, true, destructiveOk, true);   // crawl+파괴가드+ownSeen(2026-09-23 일반화: 나의작업보기와 동일한 상단 라벨-값 형태가 전 상세 화면에 있음 → 각 상세도 전용 Set으로 완결 커버)
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

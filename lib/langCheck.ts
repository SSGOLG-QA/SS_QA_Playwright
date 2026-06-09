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

// ── '정적 UI' 영역 정의 ────────────────────────────────────────
//  INCLUDE: 메뉴/버튼/탭/테이블헤더/안내문구/섹션제목/폼라벨/placeholder
//  EXCLUDE: 테이블 본문(td)·공지 본문·대화창·입력값 등 사용자 데이터(한국어 입력이 정상)
//  keepInData=true 인 zone은 tbody 등 데이터 영역 안이라도 스캔(시스템 요소: 행 버튼/요약 라벨/드롭다운 값).
//   → 사용자 데이터(이름·내용)는 여전히 배제하되, 표 안의 시스템 버튼·enum·요약 라벨은 검출.
const SCAN_ZONES: { zone: string; sel: string; attr?: string; keepInData?: boolean }[] = [
  { zone: '메뉴(대)', sel: '.depth-1-title' },
  { zone: '메뉴(소)', sel: '.depth-2 a' },
  { zone: '버튼', sel: 'button, a[class*="btn"], [role="button"], .button-common' },
  { zone: '행버튼', sel: 'tbody button, .list-table-group button, .table-overflow-item button', keepInData: true }, // 표 행 액션(삭제/스코어/보내기 등)
  { zone: '탭', sel: '[role="tab"], .tab-item, .tabs li, [class*="tab-"] li' },
  { zone: '테이블헤더', sel: 'thead th' },
  { zone: '안내문구', sel: '.info-box-text, [class*="guide"], [class*="info-text"], [class*="desc"]' },
  { zone: '섹션제목', sel: '.contents-box h1, .contents-box h2, .contents-box h3, .contents-box h4, .box-title, .section-title' },
  { zone: '요약카드', sel: '.summary-card__label, .summary-card__days, [class*="summary"] [class*="label"], [class*="stat"] [class*="label"]', keepInData: true }, // 라벨만(값=__value 제외)
  { zone: '폼라벨', sel: 'label, .form-label, .input-label, dt' },
  { zone: '드롭다운값', sel: '.vs__selected', keepInData: true },  // vue-select 표시값(시스템 기본값 예: 코스 전체)
  { zone: 'placeholder', sel: 'input[placeholder], textarea[placeholder]', attr: 'placeholder' },
];

// 컨텐츠/데이터 영역(배제) — '시스템 요소만 검증'. 공지·게시판 글 등 컨텐츠의 한글은 결함 아님(PASS 취급).
//  위 셀렉터가 잡더라도 이 조상 안이면 제외.
const EXCLUDE_ANCESTORS = [
  'tbody', '.list-table-group tbody', '[contenteditable]',
  '.notice-content', '.notice-detail', '.notice-view', '.message-box',  // 공지/대화 컨텐츠
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
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const inExcluded = (el: Element) => excl.some(sel => el.closest(sel));
    const seen = new Set<string>();
    const hits: { zone: string; text: string }[] = [];
    for (const z of zones) {
      const nodes = Array.from(document.querySelectorAll(z.sel));
      for (const el of nodes) {
        if (inExcluded(el)) continue;
        if (!isVisible(el)) continue;
        let text = '';
        if (z.attr) text = (el.getAttribute(z.attr) || '').trim();
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
        if (!isVisible(el)) continue;
        const text = (z.attr ? (el.getAttribute(z.attr) || '') : ((el as HTMLElement).innerText || '')).replace(/\s+/g, ' ').trim();
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
  await switchLanguage(admin, KOREAN); // 비파괴 원복
}

// ── 전체 메뉴 순회(단일 언어) ──────────────────────────────────
//  전략: 한국어로 진입 → 화면에서 언어 전환 → 스캔 → 한국어 원복(다음 메뉴 한글 네비 가능).
//  전역요소 중복 제거: seen 집합으로 화면별 '신규' 한글만 검출(전역 SNB/레이아웃은 홈에서 1회 귀속).
//  언어별 파일 분리: 각 언어 1회씩 별도 test에서 runLangCheckAll → writeReport(언어명).
const MENU_LIST: { menu: string; subs: string[] }[] = [
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
// 숫자/날짜 패턴(포맷 관찰용)
const DATE_RE = /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}/g;
const NUM_RE = /\d{1,3}([.,]\d{3})+(\.\d+)?/g;
const fmtShape = (s: string) => s.replace(/\d/g, '0'); // 2026.03.11 → 0000.00.00

// 단일 화면 검증(단일 언어): KO baseline ↔ 외국어 대조 + 외국어 화면 상태 점검.
//  FAIL 분류: 한글 노출 / 언어 혼재 / 미노출(미번역) / 인코딩 깨짐 / 글자 잘림.
//  확인 필요(판정 제외): 말줄임(…) / 시각 레이어(이미지텍스트·글리프□·레이아웃).  관찰: 날짜·숫자 포맷.
//  종료 시 한국어 원복. seen으로 전역요소(SNB/레이아웃) 중복 제거(홈에서 1회 귀속).
async function scanScreen(admin: Page, lang: Lang, screen: string, tcRef: string, seen: Set<string>) {
  const base: CheckMeta = { path: `${screen} > 언어검증`, tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko}(${lang.label}) 모드 — UI 표기 검증` };
  const ko = await captureSlots(admin);                 // 한국어 baseline(전환 전)
  const ok = await switchLanguage(admin, lang.label);
  if (!ok) { skip(base, `${lang.label} 전환 실패`); return; }
  const fg = await captureSlots(admin);                 // 전환 후
  const koMap = new Map(ko.map(s => [s.key, s.text]));
  const shot = await capture(admin, { ...base, path: `${screen}_${lang.ko}` }); // 화면 증빙(시각 확인용)

  const fresh = (k: string) => { if (seen.has(k)) return false; seen.add(k); return true; };
  const fail = (zone: string, koText: string, fgText: string, phen: string) => {
    if (!fresh(`${zone}|${phen}|${koText || fgText}`)) return; // 전역 중복 제거(기록 안 함)
    record(
      { path: `${screen} > 언어검증 > ${zone}`, tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} ${phen}: "${(koText || fgText).slice(0, 40)}"`, expected: koText ? `한국어 원문: "${koText}"` : '-' },
      'FAIL',
      { actual: fgText ? `${lang.label}: "${fgText}"` : '(빈값/미노출)', error: phen, detail: `${lang.label} 모드 표시값`, screenshot: shot },
    );
  };
  // 정상 번역 PASS — 실제값(번역 결과) 전수 기록(중복 제거)
  const pass = (zone: string, koText: string, fgText: string) => {
    if (!fresh(`PASS|${zone}|${koText}`)) return;
    record(
      { path: `${screen} > 언어검증 > ${zone}`, tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} 번역 정상: "${koText.slice(0, 40)}"`, expected: `한국어 원문: "${koText}"` },
      'PASS',
      { actual: `${lang.label}: "${fgText}"`, screenshot: shot },
    );
  };

  // ① 번역 카테고리 — 한국어 baseline에 한글이 있는 슬롯만 대상(시스템 요소; 컨텐츠는 배제됨)
  for (const s of ko) {
    if (!HANGUL.test(s.text)) continue;
    const f = fg.find(x => x.key === s.key);
    if (!f) continue;                                   // KO↔FG 슬롯 미매칭(reflow) → 오탐 방지 skip
    const ft = f.text;
    if (ft.trim() === '') fail(s.zone, s.text, '', '미노출(미번역)');
    else if (HANGUL.test(ft)) fail(s.zone, s.text, ft, hasOtherScript(ft) ? '언어 혼재' : '한글 노출');
    else pass(s.zone, s.text, ft);                      // 정상 번역 → 실제값 기록
  }
  // ② 외국어 화면 상태 카테고리 — 모든 FG 슬롯 대상(번역 여부 무관)
  const fmtSeen = new Set<string>();
  for (const f of fg) {
    const ft = f.text;
    if (!ft) continue;
    if (ENCODING_BROKEN.test(ft)) fail(f.zone, koMap.get(f.key) || '', ft, '인코딩 깨짐');
    if (f.clip) fail(f.zone, koMap.get(f.key) || '', ft, '글자 잘림');
    if (f.ell && fresh(`${f.zone}|말줄임|${ft}`))
      review({ lang: lang.ko, screen, kind: '말줄임(…)', zone: f.zone, item: ft.slice(0, 60), value: '말줄임 처리 — 전체 텍스트 노출 확인 필요', screenshot: shot });
    // 포맷 관찰(판정 제외): 날짜/숫자 형태 기록
    for (const re of [DATE_RE, NUM_RE]) {
      const m = ft.match(re);
      if (m) for (const tok of m) { const shape = fmtShape(tok); const k = `${lang.ko}|fmt|${shape}`; if (!fmtSeen.has(k) && fresh(k)) { fmtSeen.add(k); review({ lang: lang.ko, screen, kind: '포맷 관찰(날짜/숫자)', zone: f.zone, item: shape, value: `예: ${tok}`, screenshot: '' }); } }
    }
  }
  // (글리프 깨짐 □·이미지 내 텍스트·픽셀 레이아웃은 검증 범위 제외)
  await switchLanguage(admin, KOREAN);
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
    const key = `토스트|${phen || 'PASS'}|${screen}|${t}`;
    if (seen.has(key)) continue; seen.add(key);
    const meta = { path: `${screen} > 토스트/에러 > ${kind}`, tcRef: `언어검증_토스트`, tcId: `LANGTOAST-${lang.ko}`, desc: `${lang.ko} 토스트/에러 ${phen || '정상'}: "${t.slice(0, 36)}"`, expected: '-' };
    if (phen) record(meta, 'FAIL', { actual: `${lang.label}: "${t}"`, error: phen, detail: `${kind} 메시지`, screenshot: shot });
    else record(meta, 'PASS', { actual: `${lang.label}: "${t}"`, screenshot: shot });
  }
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
      const ok = await navigateMenu(admin, menu, sub).catch(() => false);
      await settle(admin);
      if (!ok) {
        skip({ path: `${screen} > 언어검증`, tcRef: `언어검증_${menu}`, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} 번역 검증` }, '메뉴 진입불가(미구현/범위제외)');
        continue;
      }
      await scanScreen(admin, lang, screen, `언어검증_${menu}`, seen);
    }
  }
  await switchLanguage(admin, KOREAN); // 비파괴 최종 원복
}

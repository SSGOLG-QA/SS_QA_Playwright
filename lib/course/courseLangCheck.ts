import { Page } from '@playwright/test';
import { captureSlots, applySlotComparison, Lang } from '../langCheck';
import { gotoCourseMenu, killAlarms, COURSE_IA } from './courseHelpers';
import { closeForm } from './formE2E';
import { settle } from '../adminHelpers';
import { skip, review, CheckMeta } from '../reporter';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어(언어) 검증 — admin langCheck 핵심(captureSlots·applySlotComparison) 재사용.
//   ⚠ 코스 스위처는 admin(.title/.slot-item)과 다름 = 헤더 우상단 `.select-btn`(현재 "한국어 ▾") 드롭다운.
//     옵션 표시명 = 한국어·English·Vietnam·Thailand·Taiwan·Chinese·Japanese·Indonesia (8개, 프로브 2026-08-31 확정).
//   ⚠ applySlotComparison의 '타 언어 노출' 감지는 native 스크립트 label(日本語·繁體中文…)로 분기 →
//     COURSE_LANGS는 label=native(감지·표시용) + clickLabel=드롭다운 표시명(클릭용)을 분리.
//   비파괴: 언어 전환·읽기만, 종료 시 한국어 원복.
// ──────────────────────────────────────────────────────────────

export interface CourseLang extends Lang { clickLabel: string; }
// label(감지/표시) ↔ clickLabel(드롭다운 클릭). Taiwan=번체(繁體)·Chinese=간체(简体) 매핑.
export const COURSE_LANGS: CourseLang[] = [
  { label: 'English', clickLabel: 'English', ko: '영어' },
  { label: 'Tiếng Việt', clickLabel: 'Vietnam', ko: '베트남어' },
  { label: 'ภาษาไทย', clickLabel: 'Thailand', ko: '태국어' },
  { label: '繁體中文', clickLabel: 'Taiwan', ko: '번체중문' },
  { label: '简体中文', clickLabel: 'Chinese', ko: '간체중문' },
  { label: '日本語', clickLabel: 'Japanese', ko: '일본어' },
  { label: 'Bahasa Indonesia', clickLabel: 'Indonesia', ko: '인도네시아어' },
];
const KOREAN_LABEL = '한국어';
// 드롭다운/트리거에 노출되는 표시명(현재 언어 판독용)
const DISPLAY_LABELS = [KOREAN_LABEL, 'English', 'Vietnam', 'Thailand', 'Taiwan', 'Chinese', 'Japanese', 'Indonesia'];

const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

// ⚠ 코스 데이터 오탐 존 제외(report-standard 가짜 FAIL 방지, 2026-09-01):
//   admin에 튜닝된 keepInData 존 중 `뱃지/상태`([class*=badge]>span)·`요약카드`([class*=summary/stat] [class*=label])는
//   코스에선 시스템 enum이 아니라 **사용자 데이터**(거래처명·자재명·계정명·담당자·메모·테스트 데이터)를 포착 →
//   전환 후 데이터가 그대로 남아 "미번역/한글노출"로 오판(베트남어 런에서 97/114 FAIL이 데이터였음).
//   admin SCAN_ZONES는 무수정(공유), 코스 비교(applySlotComparison) 직전에만 슬롯에서 제외.
//   실 번역대상(버튼·폼라벨·메뉴·섹션제목·카드범례·select옵션·드롭다운값)은 유지.
const COURSE_EXCLUDE_ZONES = new Set(['뱃지/상태', '요약카드']);

// 사용자 추가 항목 마커(2026-09-01, 사용자 지시 "[박] 포함 시 제외"):
//   [박]·[전]·[석] 등 **대괄호 1자 한글 접두** = 사용자가 만든 항목의 생성자/소유자 태그(데이터).
//   안내문구·드롭다운 등 시스템 존에 섞여 들어와도(예: "[박] 이슈_모든 연도가 …") 전환 후 잔존해 오탐.
//   ⚠ [필수]·[선택]·[신규]·[삭제] 등 **2자+ 시스템 표기는 보존**(1자 한글만 매칭).
const USER_ITEM_MARK = /\[[가-힣]\]/;

// 코스 시스템 enum 허용목록(2026-09-01, 사용자 지적 "표 분류 행 그린/티박스/러프… 검증 누락"):
//   비용/분석 표의 분류 컬럼(tbody)은 admin 규칙상 '데이터'로 통째 제외되나, 코스 area/구분은 **번역대상 시스템 enum**.
//   데이터(인명·거래처명)와 구분하려 **허용목록 매칭 행만** 검증 슬롯으로 승격(인명 '석석' 등은 미매칭→제외=false positive 0).
//   구조 셀렉터(첫 컬럼)로 캡처해 KO/FG index 정합 유지 + 이 목록으로 enum만 남김(prepCourseSlots).
const COURSE_ENUM_SET = new Set(['전체', '그린', '그린칼라', '그린 칼라', '티박스', '티 박스', '페어웨이', '러프', '벙커', '에이프런', '카트도로', '카트 도로', '코스', '홀', '헤저드', '워터해저드', '해저드', '기타']);
const isCourseEnum = (t: string) => { const n = (t || '').replace(/\s+/g, ' ').trim(); return COURSE_ENUM_SET.has(n) || /^(\d+\s*홀|홀\s*\d+)$/.test(n); };

// 물리적 코스 구역명 집합(2026-09-01, 사용자 지적 "코스 기본 정보 폼라벨 벙커/페어웨이/항목추가1 = 사용자 추가 항목 제외"):
//   ⚠ 코스 기본 정보의 `.info-list` dt 라벨은 **사용자가 등록한 구역 목록**(벙커/페어웨이 + '항목추가N'으로 추가) → 고정 i18n 라벨 아님·데이터.
//   고정 폼라벨(폰드 개수/총 담수량 등)은 구역명이 아니라 정상 번역(PASS) → **폼라벨 zone + 구역명** 또는 **항목추가N**만 사용자데이터로 제외.
//   전체/코스/홀/기타(비-물리구역 enum)는 폼라벨로 쓰이면 정상 UI일 수 있어 보존(구역 집합서 제외). 표(분류enum)의 구역명은 계속 검증(zone 다름).
const COURSE_AREA_SET = new Set(['그린', '그린칼라', '그린 칼라', '티박스', '티 박스', '페어웨이', '러프', '벙커', '에이프런', '카트도로', '카트 도로', '헤저드', '해저드', '워터해저드', '폰드', '법면', '묘포장', '조경']);
const isCourseArea = (t: string) => COURSE_AREA_SET.has((t || '').replace(/\s+/g, ' ').trim());
const USER_ADDED_LABEL = /^항목\s*추가\s*\d*$/;   // '항목추가1' 등 사용자 추가 항목 기본명

// 그리디 섹션 blob 감지(2026-09-01, 사용자 지적 "근태 기록 섹션제목에 사용자 데이터 혼입 언어혼재 false FAIL"):
//   섹션제목 zone이 컨테이너(.sub-title-box 등)를 잡아 섹션 전체 innerText(제목+요약+직원 테이블)를 삼킴 → 인명(염가희·강현지…)이
//   전환 후 잔존해 '언어 혼재' 오판. 진짜 제목은 짧음. 내가 넣은 안내문구(guide)는 길지만 **숫자 없는 산문** → 숫자 다수로 구분.
//   규칙: 섹션제목이 길고(>60) 숫자군 4+ = 데이터 표 blob → 제외(안내문구·짧은 제목·연도캡션은 보존).
const isGreedySectionBlob = (zone: string, text: string) =>
  zone === '섹션제목' && text.length > 60 && (text.match(/\d+/g) || []).length >= 4;

// 화면별 dedup 존(2026-09-01, 사용자 선택 "드롭다운만 화면별 기록"): 드롭다운 기본값은 화면마다 번역 여부가 달라(context-dependent)
//   런전역 dedup 시 한 화면(예: 작업지시)만 FAIL 기록되고 동일 결함(자재수불 등)이 숨음 → 이 존만 seen 키에 screen 포함해 화면별 노출.
const SCREEN_SCOPED_ZONES = new Set(['드롭다운값']);

// heavy 시각화 화면(맵/3D/canvas/이미지·실시간 모니터링) — 진입·렌더 느림 → 진입 재시도·백지 폴링 상향(2026-09-01 진입실패 분석).
//   통합런 후반 재진입 레이스로 코스 현황 관리 팝업 4건 진입실패·장비 관제 외국어 백지 발생 → heavy 화면만 대기·재시도 강화.
const HEAVY_SCREENS = ['코스 모니터', '식생 분석', '코스 영역 설정', '드론사진', '장비 관제', '시설 관제', '그린 분석', '3D'];
const isHeavyScreen = (s: string) => HEAVY_SCREENS.some((h) => s.includes(h));
// 정적 패스(runCourseLangCheck)가 화면별 열기형 트리거 수를 기록 → 모달 패스가 heavy 무트리거 화면 재진입을 생략(2026-09-01).
//   맵/canvas heavy 화면은 통합런 후반 재진입이 flake 표면인데, 폼 트리거가 없으면 재진입해도 '트리거 없음'으로 끝남 → 재진입 자체를 생략.
//   키(screen)는 정적/모달 패스 동일 산식. 값 0=트리거 없음(생략), ≥1=있음(진입), -1/미기록=미확인(정상 진입 폴백=현행 유지).
const screenTriggerCount = new Map<string, number>();

// 코스 비교 전 슬롯 정제: ① 데이터 오탐 존 제외 ② KO/FG 어느 쪽이든 사용자 항목 마커 포함 슬롯을 키 단위로 양쪽서 제외(매칭 정합 유지).
function prepCourseSlots<T extends { key: string; zone: string; text: string }>(ko: T[], fg: T[]): [T[], T[]] {
  const zoneOk = (s: T) => !COURSE_EXCLUDE_ZONES.has(s.zone);
  const k = ko.filter(zoneOk);
  const f = fg.filter(zoneOk);
  // 분류enum(표 첫 컬럼 구조 캡처): KO 텍스트가 코스 enum인 키만 검증 유지 → 데이터 행(인명·거래처명)은 제외(false positive 0).
  const enumBad = new Set<string>(k.filter((s) => s.zone === '분류enum' && !isCourseEnum(s.text)).map((s) => s.key));
  const markBad = new Set<string>([...k, ...f].filter((s) => USER_ITEM_MARK.test(s.text)).map((s) => s.key));
  // 사용자 추가 항목(코스 기본 정보 info-list 등): 폼라벨 zone의 구역명 + '항목추가N' → 데이터로 제외(false FAIL 방지).
  const userAddBad = new Set<string>([...k, ...f].filter((s) => USER_ADDED_LABEL.test(s.text) || (s.zone === '폼라벨' && isCourseArea(s.text))).map((s) => s.key));
  // 그리디 섹션 blob(제목+데이터 테이블 혼입) 제외 — KO/FG 어느 쪽이든 감지되면 키 단위 양쪽 제외.
  const blobBad = new Set<string>([...k, ...f].filter((s) => isGreedySectionBlob(s.zone, s.text)).map((s) => s.key));
  const bad = new Set<string>([...enumBad, ...markBad, ...userAddBad, ...blobBad]);
  return [k.filter((s) => !bad.has(s.key)), f.filter((s) => !bad.has(s.key))];
}

// ══════════════════ 커버리지 감사기(메타 검증, 2026-09-01) ══════════════════
//  배경(사용자 지적): langCheck는 SCAN_ZONES 셀렉터가 매칭하는 요소만 봄 → 미매칭 한글은 "놓쳤다" 신호 없이
//   조용히 skip → 화면 눈으로 볼 때마다 새 누락(카드제목·안내문구·필터탭…). 일일이 지적은 자동화 무의미.
//  해결: 화면의 **모든 가시 한글 leaf**를 수집해 captureSlots 커버분을 빼고 **미검증 한글 목록 + 커버리지%**를
//   '확인 필요·관찰' 시트(review, INFO — FAIL 아님)로 자동 출력 → 사람이 1회 검토 후 존 일괄 추가/데이터 확정.
//  report-standard: 결함 주장 아님(가짜 FAIL 0) + 조용한 100%통과의 가짜 신뢰도 제거(통과율≠커버리지).

// leaf 스캔 데이터/컨텐츠 조상 제외(langCheck EXCLUDE_ANCESTORS 미러 + 사이드바). 사용자 데이터(td·공지·대화·에디터)는 번역 비대상.
//   ⚠ 'tbody' 미제외(2026-09-01, 사용자 "표 항목 누락·false 100%"): tbody 통째 제외 시 표 분류 enum(그린/러프…)이
//     검증도 감사도 안 돼 조용한 100% → 감사기가 표 한글도 스캔(table 플래그로 구분)해 정직한 %·enum 노출. 순수 데이터 표는 감사 INFO만.
const LEAF_EXCLUDE = [
  '.side-navbar-container', '[contenteditable]',
  '.notice-content', '.notice-detail', '.notice-view', '.message-box',
  '.msg-message-left', '.msg-message-right', '.msg-message-top', '[class*="msg-message"]',
  '.board', '.board-view', '.post-view', '.content-view', '.viewer', '.editor', '.ck-content', '.fr-view',
  '.vs__dropdown-menu', '.datepicker-layer',
  // 코스 데이터 확정 제외(2026-09-01 감사 트리아지): dd=카드 값(지시/조장 인명), .section-card-title=작업 항목명([YS]그린_관수)
  'dd', '.section-card-title',
];

// 현재 DOM 상태의 가시 한글 leaf 텍스트 전수 수집(text node 기준 → 조상 중복 배제). table=표 내부 여부(감사 분리·정직 % 위해).
type Leaf = { text: string; tag: string; cls: string; table: boolean };
async function captureCourseLeaves(admin: Page): Promise<Leaf[]> {
  return admin.evaluate((excl) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const HANGUL = /[가-힣]/;
    const scope = document.querySelector('.contents, main') || document.body;
    const isVis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      if (r.width <= 1 && r.height <= 1) return false;
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const inExcl = (el: Element) => excl.some((sel) => el.closest(sel));
    const out: { text: string; tag: string; cls: string; table: boolean }[] = [];
    const seen = new Set<string>();
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = norm(n.nodeValue).slice(0, 200);   // 200(슬롯 extras와 동일) — 안내문단 truncation 불일치로 감사가 검증분을 '미검증' 이중표기하던 것 방지
      if (!t || !HANGUL.test(t)) continue;
      const el = (n as Text).parentElement;
      if (!el || !isVis(el) || inExcl(el)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      const clsRaw = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
      out.push({ text: t, tag: el.tagName.toLowerCase(), cls: (clsRaw || '').slice(0, 60), table: !!el.closest('tbody, [class*="table"]') });
    }
    return out;
  }, LEAF_EXCLUDE).catch(() => [] as Leaf[]);
}

// leaf(가시 한글) − 슬롯(captureSlots 커버) = 미검증. 포함관계(양방향)면 커버로 간주(과대보고 방지). 사용자 마커 제외.
//   커버리지%=UI chrome(비표) 기준(데이터 표가 %를 흐리지 않게), tableItems=표 내부 미검증 한글(enum 후보/데이터 검토) 별도.
function computeUncovered(leaves: Leaf[], slots: { text: string }[]): { covered: number; total: number; items: Leaf[]; tableItems: Leaf[] } {
  const T = slots.map((s) => norm(s.text)).filter(Boolean);
  // 커버 판정: 정확일치 또는 포함관계 — 단 **길이비 ≥60%**일 때만(2026-09-01, 사용자 "안내문구 누락" 근본원인).
  //   기존 무조건 포함(nt.includes(x))은 40자 안내문구가 2자 슬롯("비용")을 품는 것만으로 '커버'로 오판 → 감사가 조용히 100% 보고.
  //   짧은 슬롯이 긴 leaf를 삼키지 못하게 길이비 게이트(공백/래핑 변형만 흡수). 이 화면에서 안내문단이 미검증으로 정직 노출됨.
  const isCov = (t: string) => {
    const nt = norm(t);
    return T.some((x) => {
      if (x === nt) return true;
      if (!(x.includes(nt) || nt.includes(x))) return false;
      const s = Math.min(x.length, nt.length), l = Math.max(x.length, nt.length);
      return l > 0 && s / l >= 0.6;
    });
  };
  const cand = leaves.filter((l) => !USER_ITEM_MARK.test(l.text));
  const chrome = cand.filter((l) => !l.table);
  const items = chrome.filter((l) => !isCov(l.text));
  const tableItems = cand.filter((l) => l.table && !isCov(l.text));
  return { covered: chrome.length - items.length, total: chrome.length, items, tableItems };
}

// 인터랙션 컨트롤 인벤토리(클래스 B) — select·vue-select·빈결과 안내를 열거해 '미탐색/종속' 컨트롤 신호 제공.
//   예: 홀 드롭박스(코스 미선택=결과 없음 → 선택 시 홀1~홀9). 자동드라이브는 하지 않고 플래그만(사용자 결정 범위).
type Control = { kind: string; label: string; state: string; empty: boolean };
async function auditInteractions(admin: Page): Promise<Control[]> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.contents, main') || document.body;
    const isVis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const out: { kind: string; label: string; state: string; empty: boolean }[] = [];
    for (const s of Array.from(scope.querySelectorAll('select')) as HTMLSelectElement[]) {
      if (!isVis(s) || s.closest('.side-navbar-container')) continue;
      const opts = Array.from(s.options).map((o) => norm(o.textContent)).filter(Boolean);
      out.push({ kind: 'select', label: norm(s.getAttribute('name') || s.id) || '(무명)', state: `옵션 ${opts.length}: ${opts.slice(0, 5).join(' / ')}`, empty: opts.length <= 1 });
    }
    for (const v of Array.from(scope.querySelectorAll('.v-select, .vs__dropdown-toggle')) as HTMLElement[]) {
      if (!isVis(v) || v.closest('.side-navbar-container')) continue;
      const sel = v.querySelector('.vs__selected');
      const ph = v.querySelector('.vs__search') as HTMLInputElement | null;
      const val = norm(sel?.textContent || '') || norm(ph?.placeholder || '');
      out.push({ kind: 'vue-select', label: val || '(값없음)', state: sel ? `값: ${val}` : '미선택', empty: !sel });
    }
    for (const el of Array.from(scope.querySelectorAll('[class*="no-data"], [class*="no-result"], [class*="empty-text"]')) as HTMLElement[]) {
      if (!isVis(el) || el.closest('.side-navbar-container') || el.closest('tbody')) continue;
      const t = norm(el.textContent);
      if (t) out.push({ kind: '빈 결과', label: t.slice(0, 40), state: '종속 컨트롤 미선택 추정(선택 후 항목 확인 필요)', empty: true });
    }
    return out;
  }).catch(() => [] as Control[]);
}

// 커버리지 감사 결과를 '확인 필요·관찰' 시트로 방출(KO 1회, 언어무관). 화면+텍스트 dedup.
const seenCoverage = new Set<string>();
function emitCoverageAudit(screen: string, leaves: Leaf[], slots: { text: string }[]) {
  const { covered, total, items, tableItems } = computeUncovered(leaves, slots);
  if (!total && !tableItems.length) return;
  const pct = total ? Math.round((covered / total) * 100) : 100;
  review({ lang: '한국어', screen, kind: '커버리지 요약', item: `검증 ${covered}/${total} UI (${pct}%)`, value: `미검증 chrome ${items.length} / 표내부 ${tableItems.length}` });
  const dump = (list: Leaf[], kind: string) => {
    let shown = 0;
    for (const it of list) {
      const dk = `${kind}|${screen}|${it.text}`;
      if (seenCoverage.has(dk)) continue;
      seenCoverage.add(dk);
      if (shown >= 40) continue;
      review({ lang: '한국어', screen, kind, zone: `${it.tag}${it.cls ? '.' + it.cls.split(' ')[0] : ''}`, item: it.text });
      shown++;
    }
    if (list.length > shown && shown >= 40) review({ lang: '한국어', screen, kind, item: `…외 ${list.length - shown}건(생략)` });
  };
  dump(items, '미검증 한글(존추가 후보)');
  dump(tableItems, '표내부 한글(enum 승격/데이터 검토)');
}
// 인터랙션 인벤토리 방출(KO 1회). 종속/빈 컨트롤 우선 노출.
const seenControl = new Set<string>();
function emitInteractionAudit(screen: string, controls: Control[]) {
  for (const c of controls) {
    const dk = `${screen}|${c.kind}|${c.label}`;
    if (seenControl.has(dk)) continue;
    seenControl.add(dk);
    review({ lang: '한국어', screen, kind: c.empty ? '미탐색 컨트롤(선택 후 항목 확인)' : '인터랙션 컨트롤(인벤토리)', zone: c.kind, item: c.label, value: c.state });
  }
}

// 현재 노출 언어(헤더 .select-btn 텍스트에서 표시명 추출).
async function currentCourseLang(admin: Page): Promise<string> {
  const t = norm(await admin.locator('.select-btn').first().innerText().catch(() => ''));
  return DISPLAY_LABELS.find((l) => t.includes(l)) || t;
}

// 언어 전환: .select-btn 트리거 클릭 → 드롭다운에서 표시명(정확 텍스트) 클릭 → 안정화.
//   성공 판정 = currentCourseLang === 대상 표시명. 2회 재시도.
async function switchCourseLang(admin: Page, displayLabel: string): Promise<boolean> {
  if ((await currentCourseLang(admin)) === displayLabel) return true;
  for (let attempt = 0; attempt < 3; attempt++) {
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.locator('.select-btn, .select-btnWrap').first().click({ force: true }).catch(() => {});
    await admin.waitForTimeout(450);
    // 옵션: 정확 텍스트 가시 요소 중 트리거가 아닌 것(.last() = 드롭다운 항목 우선)
    const opt = admin.getByText(displayLabel, { exact: true }).filter({ visible: true }).last();
    if (await opt.isVisible().catch(() => false)) {
      await opt.click({ force: true }).catch(() => {});
    } else {
      // DOM 클릭 폴백(오버레이 z-index 우회)
      await opt.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    }
    await settle(admin, 1200);
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(300);
    if ((await currentCourseLang(admin)) === displayLabel) return true;
  }
  return (await currentCourseLang(admin)) === displayLabel;
}

// 비파괴 오버레이 닫기 — 헤더 언어 트리거를 가리는 모달/드롭다운/달력 제거(cascade 방지 핵심).
//   Escape 우선 → 잔존 모달은 취소/닫기(파괴 confirm 회피, formE2E closeForm 재사용).
async function closeCourseOverlays(admin: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const open = await admin.locator('.modal-group, .modal-box, .vs__dropdown-menu, .datepicker-layer, .slot-list')
      .filter({ visible: true }).count().catch(() => 0);
    if (!open) return;
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(250);
    if (await admin.locator('.modal-group, .modal-box').filter({ visible: true }).count().catch(() => 0)) {
      await closeForm(admin).catch(() => {});
    }
    await killAlarms(admin);
  }
}

// 한국어 원복(cascade 차단). 3단: ①오버레이 닫고 전환 ②DOM클릭 ③홈 리셋 후 재시도.
async function ensureCourseKorean(admin: Page): Promise<boolean> {
  if ((await currentCourseLang(admin)) === KOREAN_LABEL) return true;
  for (let i = 0; i < 3; i++) {
    await closeCourseOverlays(admin);
    if (await switchCourseLang(admin, KOREAN_LABEL)) return true;
    await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().evaluate((el: HTMLElement) => el.click()).catch(() => {});
    await settle(admin, 800);
    await closeCourseOverlays(admin);
  }
  return (await currentCourseLang(admin)) === KOREAN_LABEL;
}

// 외국어 전환 후 본문 백지 여부(폴링 positive-wait — 즉시 스냅샷 금지, 데이터 로딩 오탐 방지).
//   heavy=맵/실시간 모니터링 화면은 렌더 지연 커 폴링 6s→12s(장비 관제 외국어 백지 오탐 방지, 2026-09-01).
async function isForeignBlank(admin: Page, heavy = false): Promise<boolean> {
  const waits = heavy ? 12 : 6;
  for (let i = 0; i < waits; i++) {
    const len = await admin.locator('.contents, main').first().innerText().catch(() => '').then((t) => norm(t).length);
    if (len > 40) return false;
    await admin.waitForTimeout(1000);
  }
  return true;
}

// 메뉴 진입(cascade 복구 내장): 실패 시 오버레이 닫고 한국어 원복 후 재시도.
//   heavy 화면(맵/3D/canvas)은 통합런 후반 재진입 레이스로 flake → 대기 상향 + 2차 재시도(2026-09-01 진입실패 개선).
async function enterCourseMenu(admin: Page, menu: string, sub: string | undefined): Promise<boolean> {
  const heavy = isHeavyScreen(`${menu} ${sub || ''}`);
  const go = () => gotoCourseMenu(admin, menu, sub).then((r) => r !== false).catch(() => false);
  if (await go()) { if (heavy) await settle(admin, 1500); return true; }   // heavy: 진입 후 맵/canvas 로드 안정화
  await closeCourseOverlays(admin);
  await ensureCourseKorean(admin);   // SNB 외국어 잔존(cascade) 복구
  await settle(admin, heavy ? 1200 : 500);
  if (await go()) { if (heavy) await settle(admin, 1500); return true; }
  if (heavy) {
    // heavy 2차 재시도(로드 레이스 흡수) — 오버레이·언어 원복 후 넉넉히 대기.
    await closeCourseOverlays(admin);
    await ensureCourseKorean(admin);
    await settle(admin, 2000);
    if (await go()) { await settle(admin, 1500); return true; }
  }
  // 최종 reload 재앵커(2026-09-02): 직전 heavy 화면 진입 실패가 남긴 bad state(hung canvas/spinner)가
  //   다음 메뉴군으로 cascade → 비-heavy는 재시도 1회로 복구 불가(정보 관리 6연쇄 실패 관찰). reload=현재 URL
  //   새로고침(비파괴·세션 유지)으로 JS 상태 초기화 후 SNB 네비 재시도. heavy·비-heavy 공통 최후 복구.
  await admin.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await settle(admin, heavy ? 1500 : 800);
  await killAlarms(admin);
  await closeCourseOverlays(admin);
  await ensureCourseKorean(admin);
  const ok = await go();
  if (ok && heavy) await settle(admin, 1500);
  return ok;
}

// ── 탭 헬퍼(계층 순회) — 코스 탭 = `.tab-group > div`(role/li 아님, 프로브 2026-09-01 확정) ──
//   ⚠ 탭 라벨은 번역되므로 KO/FG를 **그룹레벨·인덱스**로 매칭(라벨 매칭 불가).
//   ⚠ Home은 2단 탭(비용 → 예산 대비 실적 분석/작업지시에 근거한 비용 분석) → 상위탭 클릭 후
//     나타나는 하위 `.tab-group`을 재귀(DFS) 순회. 단일탭·무탭 화면은 그대로 1회 캡처.
type TabSlots = { key: string; text: string; zone: string; clip?: boolean; ell?: boolean };

// 보이는 .tab-group 개수(사이드바 제외).
async function tabGroupCount(admin: Page): Promise<number> {
  return admin.evaluate(() => {
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !e.closest('.side-navbar-container');
    return Array.from(document.querySelectorAll('.tab-group')).filter(vis).length;
  }).catch(() => 0);
}
// level번째 그룹의 보이는 탭(자식) 수.
async function tabsInGroup(admin: Page, level: number): Promise<number> {
  return admin.evaluate((lv) => {
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !e.closest('.side-navbar-container');
    const g = Array.from(document.querySelectorAll('.tab-group')).filter(vis)[lv];
    return g ? Array.from(g.children).filter(vis).length : 0;
  }, level).catch(() => 0);
}
// level·i 탭 클릭 + 라벨 텍스트 반환(리포트 경로용, KO 순회 시 한국어).
async function clickTabGetLabel(admin: Page, level: number, i: number): Promise<string> {
  return admin.evaluate(({ lv, idx }) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !e.closest('.side-navbar-container');
    const g = Array.from(document.querySelectorAll('.tab-group')).filter(vis)[lv];
    if (!g) return '';
    const el = Array.from(g.children).filter(vis)[idx] as HTMLElement | undefined;
    if (!el) return '';
    const t = norm(el.innerText);
    el.click();
    return t;
  }, { lv: level, idx: i }).catch(() => '');
}
// 현재 노출된 모든 탭 라벨을 슬롯으로 캡처(화면+그룹레벨+인덱스 키 → KO/FG 매칭·화면간 충돌방지). Issue 2: 탭 이름 검증.
//   ⚠ key에 screen 포함 필수: seen이 런 전역(화면 공유)이라 `탭|g0i0`만 쓰면 2번째 화면의 첫 탭이 dedup 제거됨.
async function captureTabLabels(admin: Page, screen: string): Promise<TabSlots[]> {
  return admin.evaluate((scr) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !e.closest('.side-navbar-container');
    const out: { key: string; text: string; zone: string; clip: boolean; ell: boolean }[] = [];
    Array.from(document.querySelectorAll('.tab-group')).filter(vis).forEach((g, gi) => {
      Array.from(g.children).filter(vis).forEach((ch, ci) => {
        const t = norm((ch as HTMLElement).innerText);
        if (t) out.push({ key: `탭|${scr}|g${gi}i${ci}`, text: t, zone: '탭', clip: false, ell: false });
      });
    });
    return out;
  }, screen).catch(() => [] as TabSlots[]);
}
// 탭 라벨을 본문 슬롯에 병합(텍스트 중복 시 본문 우선 — 이미 잡힌 라벨 중복 대조 방지).
function mergeTabLabels(base: TabSlots[], labels: TabSlots[]): TabSlots[] {
  const seenTxt = new Set(base.map((s) => norm(s.text)));
  return [...base, ...labels.filter((l) => !seenTxt.has(norm(l.text)))];
}

// 코스 전용 추가 UI 슬롯(2026-09-01, 커버리지 감사 결과 일괄 존추가) — admin 공유 SCAN_ZONES 대신 course-side로만.
//   ⚠ 카드 제목이 유틸리티 클래스(strong.fs-24 등)라 공유 zone에 넣으면 admin 오염 → 코스에서만 캡처.
//   대상: 예산 카테고리(.progress-budget-title)·상태 enum(.progress-mini-text)·대시보드 카드 제목(strong.fs-24/fs-20).
//   숫자 금액이 섞여도 applySlotComparison은 한글 KO 슬롯만 판정 → 무해. 인명·작업명(데이터)은 dd/.section-card-title라 미포함.
//   .fc-ffffff = 다크 카드 화이트 캡션(예산 대비 실적 현황 카드의 "2026년 9월 현재/누적" 등 — 사용자 "검증범위 포함" 지시).
//   .tab-contents-box + div = 탭 안내문구 문단(2026-09-01, 사용자 지적 "홈>비용 예산대비/작업지시 안내문구 누락").
//     ⚠ 이 문단은 클래스가 비의미(layout-column-0-0-0 flex-1)라 admin 안내문구 zone(.info-text/.guide/.desc) 미포착 →
//     구조 앵커(2단 탭 라벨 .tab-contents-box의 형제 div)로 캡처(번역 무관 위치 고정). 탭 클릭마다 해당 탭 안내문구로 교체됨.
//   ── 배치2(2026-09-01, 감사기 검출 미검증 leaf 구조앵커, 프로브 `course:lang-anchors`→`analysis/코스관리_언어앵커_프로브.json`) ──
//     차트 라벨(.chart-section 스코프): strong.fc-grey400=등급추세 area명(그린/티박스…)·span.fs-14=목표/기준일 등급·span.fc-14=연도(2026년/2025년).
//       ⚠ 유틸 클래스라 반드시 .chart-section 스코프(전역 금지). 차트 데이터(등급 B+/숫자)는 비한글이라 applySlotComparison 무시.
//     .highcharts-plot-line-label=플롯라인 라벨(목표 : A, Highcharts 시맨틱 클래스). .calendar-header span=달력 요일 헤더(일~토, calendar-header 시맨틱).
//   ⚠ .tab-contents-box + div 은 안내문구 문단 + 하위 대시보드 전체를 품는 컨테이너 → innerText가 문단+숫자 blob(200자)로 지저분·
//     감사기가 순수 문단 leaf(106자)와 매칭 실패(길이비 0.53). 문단 문장은 컨테이너 **첫 자식**(프로브 확정: fs-14 fc-grey500 grey 설명행) →
//     `> div:first-child`로 정밀 캡처(문단만, 깔끔 검증 + 감사 이중표기 해소).
const COURSE_EXTRA_SEL = '.progress-budget-title, .progress-mini-text, strong.fs-24, strong.fs-20, .fc-ffffff, .tab-contents-box + div > div:first-child, .chart-section strong.fc-grey400, .chart-section span.fs-14, .chart-section span.fc-14, .highcharts-plot-line-label, .calendar-header span';
// 표 첫 컬럼(라벨=분류enum, 허용목록 필터) vs 표 헤더 th(표헤더, 무필터·항상 검증).
//   ⚠ 배치2 수정: 기존엔 `tbody tr > th`를 분류enum으로 묶어 컬럼헤더(구분/정규 작업/고정직 등)가 허용목록 미매칭→탈락(작업 탭 '표내부 13' 근본원인).
//     th=헤더(항상 검증) / td:first-child=행 라벨(enum 필터)로 분리. thead th는 admin이 이미 잡으나 tbody th(thead 없는 표)를 여기서 보강.
const COURSE_ENUM_CELL_SEL = 'tbody tr > td:first-child';
const COURSE_HDR_CELL_SEL = 'thead th, thead td, tbody tr > th';
async function captureCourseExtras(admin: Page, screen: string): Promise<TabSlots[]> {
  return admin.evaluate(({ sel, enumSel, hdrSel, scr }) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.contents, main') || document.body;
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !e.closest('.side-navbar-container');
    const out: { key: string; text: string; zone: string; clip: boolean; ell: boolean }[] = [];
    // (a) 카드 제목·예산 카테고리·상태·화이트 캡션·탭 안내문구·차트라벨·달력요일 — 시스템 UI(섹션제목 취급). 안내문구 문단 대비 200자.
    Array.from(scope.querySelectorAll(sel)).filter(vis).forEach((el, i) => {
      const t = norm((el as HTMLElement).innerText).slice(0, 200);
      if (t) out.push({ key: `추가|${scr}|a${i}`, text: t, zone: '섹션제목', clip: false, ell: false });
    });
    // (b) 표 행 라벨(첫 td, index 정합) — zone='분류enum' → prepCourseSlots서 허용목록 enum만 승격(데이터 행 제외).
    Array.from(scope.querySelectorAll(enumSel)).filter(vis).forEach((el, i) => {
      const t = norm((el as HTMLElement).innerText).slice(0, 40);
      if (t) out.push({ key: `분류|${scr}|${i}`, text: t, zone: '분류enum', clip: false, ell: false });
    });
    // (c) 표 헤더 th(구조·index 정합) — zone='표헤더'(무필터·항상 검증). 컬럼헤더는 전부 시스템 UI.
    Array.from(scope.querySelectorAll(hdrSel)).filter(vis).forEach((el, i) => {
      const t = norm((el as HTMLElement).innerText).slice(0, 40);
      if (t) out.push({ key: `표헤더|${scr}|${i}`, text: t, zone: '표헤더', clip: false, ell: false });
    });
    return out;
  }, { sel: COURSE_EXTRA_SEL, enumSel: COURSE_ENUM_CELL_SEL, hdrSel: COURSE_HDR_CELL_SEL, scr: screen }).catch(() => [] as TabSlots[]);
}

// 동적 확장(비파괴): 테이블 tree-toggle [+] + 카드 '펼쳐 보기' 토글을 모두 펼쳐 숨은 시스템 라벨(홀 전체/코스 전체 등) 노출.
//   확장 없는 화면은 no-op. dataset.lexp로 중복클릭 방지, 언어전환 후 재렌더 시 재확장.
async function expandDynamic(admin: Page): Promise<void> {
  for (let pass = 0; pass < 12; pass++) {
    const n = await admin.evaluate(() => {
      const sc = document.querySelector('.contents, main') || document.body;
      let c = 0;
      // 표 tree-toggle
      for (const b of Array.from(sc.querySelectorAll('tbody tr button.tree-toggle')) as HTMLElement[]) {
        if (!(b as HTMLElement & { dataset: DOMStringMap }).dataset.lexp) { (b as HTMLElement & { dataset: DOMStringMap }).dataset.lexp = '1'; b.click(); c++; }
      }
      // 카드 '펼쳐 보기'(접기 제외) — leaf-ish 클릭 요소
      for (const el of Array.from(sc.querySelectorAll('span, button, a, div')) as HTMLElement[]) {
        if (el.children.length > 1) continue;
        const t = (el.textContent || '').replace(/\s+/g, '');
        if (!t || t.length > 10) continue;
        if (t.includes('펼쳐') && !t.includes('접기') && !(el as HTMLElement & { dataset: DOMStringMap }).dataset.lexp) { (el as HTMLElement & { dataset: DOMStringMap }).dataset.lexp = '1'; el.click(); c++; }
      }
      return c;
    }).catch(() => 0);
    if (!n) break;
    await admin.waitForTimeout(400); await killAlarms(admin);
  }
}

// 계층 탭 순회 캡처(DFS). 각 도달 상태에서 [본문 슬롯 + 탭 라벨] 캡처. label=탭 경로(KO 순회 시 한국어, 리포트 표기).
//   무탭 화면 → 1회 캡처(label=''). 2단 탭 → 상위탭 클릭 후 하위 그룹 재귀.
async function captureTabbedH(admin: Page, screen: string, audit = false): Promise<{ label: string; slots: TabSlots[]; leaves?: Leaf[] }[]> {
  const out: { label: string; slots: TabSlots[]; leaves?: Leaf[] }[] = [];
  const capture = async (path: string[]) => {
    await expandDynamic(admin);
    // 본문 슬롯 + 탭 라벨 + 코스 전용 추가 UI(카드 제목·예산 카테고리·상태) 병합.
    const merged = mergeTabLabels(mergeTabLabels(await captureSlots(admin), await captureTabLabels(admin, screen)), await captureCourseExtras(admin, screen));
    out.push({ label: path.length ? `[${path.join(' > ')}]` : '', slots: merged, leaves: audit ? await captureCourseLeaves(admin) : undefined });
  };
  const dfs = async (level: number, path: string[]) => {
    const groups = await tabGroupCount(admin);
    if (level >= groups) { await capture(path); return; }
    const n = await tabsInGroup(admin, level);
    if (n < 1) { await capture(path); return; }
    for (let i = 0; i < Math.min(n, 10); i++) {
      const label = await clickTabGetLabel(admin, level, i);
      await settle(admin, 600); await killAlarms(admin);
      // 클릭으로 하위 그룹이 새로 나타나면 재귀(2단 탭), 아니면 현 상태 캡처.
      if ((await tabGroupCount(admin)) > level + 1) await dfs(level + 1, [...path, label]);
      else await capture([...path, label]);
    }
  };
  await dfs(0, []);
  return out.length ? out : [{ label: '', slots: await captureSlots(admin), leaves: audit ? await captureCourseLeaves(admin) : undefined }];
}

// 한 화면 검증(단일 언어): 계층 탭별 KO 캡처 → 전환 → 백지점검 → 계층 탭별 FG 캡처 → 인덱스 매칭 대조 → 한국어 원복.
//   ⚠ 탭 라벨은 번역되므로 KO/FG를 **DFS 방문 순서(인덱스)**로 매칭. 리포트 경로는 KO 탭 경로 사용.
async function scanCourseScreen(admin: Page, lang: CourseLang, screen: string, tcRef: string, seen: Set<string>) {
  const base: CheckMeta = { path: `${screen} > 언어검증`, tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko}(${lang.label}) 모드 — UI 표기 검증` };
  // 인터랙션 인벤토리(클래스 B) — 전환 전 KO 기본 뷰에서 1회(홀 드롭박스 등 종속 컨트롤 신호).
  emitInteractionAudit(screen, await auditInteractions(admin));
  const koCaps = await captureTabbedH(admin, screen, true);   // audit=true → 탭별 leaf 동반 캡처(커버리지 감사용)
  if (!(await switchCourseLang(admin, lang.clickLabel))) { skip(base, `${lang.clickLabel} 전환 실패(드롭다운/항목 미발견)`); await ensureCourseKorean(admin); return; }
  if (await isForeignBlank(admin, isHeavyScreen(screen))) { skip(base, `${lang.clickLabel} 전환 후 본문 백지(${isHeavyScreen(screen) ? '12' : '6'}s+ 미렌더) — 데이터의존/렌더 확인 필요`); await ensureCourseKorean(admin); return; }
  const fgCaps = await captureTabbedH(admin, screen);
  const n = Math.min(koCaps.length, fgCaps.length);
  for (let i = 0; i < n; i++) {
    const scr = koCaps[i].label ? `${screen} ${koCaps[i].label}` : screen;
    const [koF, fgF] = prepCourseSlots(koCaps[i].slots, fgCaps[i].slots);
    applySlotComparison(koF, fgF, lang, scr, tcRef, '', seen, SCREEN_SCOPED_ZONES);
    // 정적 커버리지 감사(클래스 A) — KO leaf − 커버 슬롯 = 미검증 한글(존추가 후보). INFO(가짜 FAIL 아님).
    emitCoverageAudit(scr, koCaps[i].leaves || [], koCaps[i].slots);
  }
  await ensureCourseKorean(admin);
}

// ══════════════════ Phase 2: 모달/팝업 내부 언어 검증 ══════════════════
//  ⚠ 언어 전환 후 버튼명이 번역돼 한글 트리거 매칭 불가 → KO모드에서 트리거 '위치(pi)' 식별 → 전환 → 위치로 재오픈.
//  비파괴: 열기형 트리거만(신규등록/보기/상세/설정/미리보기/추가), 파괴(저장/삭제/변경/적용/업로드/전송) 제외. closeForm으로 복원.
const OPENISH = ['신규 등록', '신규등록', '추가 등록', '등록', '수정', '보기', '상세', '설정', '미리보기', '편집'];
const DESTRUCTIVE = /저장|삭제|변경|적용|전송|업로드|다운로드|확정|완료|초기화/;
type ModalTrigger = { pi: number; label: string };

// KO 모드에서 페이지 레벨 열기형 버튼 위치(pi=전체 버튼 중 인덱스) 식별. 파괴 라벨 제외.
async function findModalTriggers(admin: Page): Promise<ModalTrigger[]> {
  return admin.evaluate(({ openish, destr }) => {
    const n = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const all = Array.from(document.querySelectorAll('button, [role="button"]'));
    const out: { pi: number; label: string }[] = [];
    const tried = new Set<string>();
    all.forEach((b, pi) => {
      if (!vis(b) || b.closest('.side-navbar-container')) return;
      const t = n((b as HTMLElement).innerText || b.textContent || '');
      if (!t || new RegExp(destr).test(t)) return;
      const m = openish.find((o: string) => t === o || t.includes(o));
      if (!m || tried.has(m)) return;
      tried.add(m);
      out.push({ pi, label: m });
    });
    return out.slice(0, 6);
  }, { openish: OPENISH, destr: DESTRUCTIVE.source }).catch(() => [] as ModalTrigger[]);
}
async function anyModalOpen(admin: Page): Promise<boolean> {
  return admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).filter({ visible: true }).count().then((c) => c > 0).catch(() => false);
}
// 편집 가능한 입력 수(언어 무관 폼 열림 판정용).
async function editableInputCount(admin: Page): Promise<number> {
  return admin.locator('.contents input:not([type=file]):not([type=hidden]):not([readonly]), .contents textarea, main input:not([type=file]):not([type=hidden]):not([readonly]), main textarea')
    .filter({ visible: true }).count().catch(() => 0);
}
// pi 위치 버튼 클릭 → 폼 열림 감지. 반환: 폼 유형('모달'|'페이지폼'|'인라인폼') 또는 ''(미오픈).
//   ⚠ [수정]은 모달이 아니라 같은 화면이 편집폼으로 전환(인라인) → 입력수 증가로 감지(언어 무관).
async function openFormByPi(admin: Page, pi: number, baseInputs: number): Promise<string> {
  const urlBefore = admin.url();
  await admin.locator('button, [role="button"]').nth(pi).click({ timeout: 3000 }).catch(() => {});
  await admin.waitForTimeout(1300); await killAlarms(admin);
  if (await anyModalOpen(admin)) return '모달';
  if (admin.url() !== urlBefore) {
    if (/(reg|edit|new|create|form|write|regist)/i.test(admin.url())) return '페이지폼';
    await admin.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}); await settle(admin, 700); return '';
  }
  const after = await editableInputCount(admin);
  if (after >= baseInputs + 2) return '인라인폼';
  return '';
}
// 폼 리셋(비파괴): 모달→closeForm / 페이지폼→goBack / 인라인폼(KO)→화면 재진입(편집 폐기) / 인라인폼(FG)→Escape만.
async function resetForm(admin: Page, kind: string, menu?: string, sub?: string) {
  if (kind === '모달') { await closeForm(admin); return; }
  if (kind === '페이지폼') { await admin.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}); await settle(admin, 600); await killAlarms(admin); return; }
  if (kind === '인라인폼') {
    await admin.keyboard.press('Escape').catch(() => {});
    // KO 단계(menu 제공)면 화면 재진입으로 편집 폐기(비파괴). FG는 메뉴명 번역돼 재진입 불가 → Escape만(다음 원복+재진입서 폐기).
    if (menu) { await gotoCourseMenu(admin, menu, sub).catch(() => {}); await settle(admin, 500); await killAlarms(admin); }
  }
}
// 슬롯 델타(폼-오픈 캡처 − 베이스 캡처) = 폼 고유 콘텐츠만(조회 중복 제외).
function deltaSlots(base: { key: string }[], withForm: { key: string; text: string; zone: string; clip?: boolean; ell?: boolean }[]) {
  const bk = new Set(base.map((s) => s.key));
  return withForm.filter((s) => !bk.has(s.key));
}

// 폼/팝업(모달·인라인편집·페이지폼) 내부 언어 검증 — 조회 화면 밖 전환요소.
async function scanCourseForms(admin: Page, lang: CourseLang, screen: string, tcRef: string, seen: Set<string>, menu: string, sub: string | undefined) {
  const base: CheckMeta = { path: `${screen} > 폼/팝업 언어검증`, tcRef, tcId: `LANGPOP-${lang.ko}`, desc: `${lang.ko}(${lang.label}) 폼/팝업 내부 i18n` };
  const triggers = await findModalTriggers(admin);
  if (!triggers.length) { skip(base, '열기형 트리거 없음(신규등록/수정/보기 등)'); return; }
  const koBaseInputs = await editableInputCount(admin);
  const koBase = await captureSlots(admin);
  // KO 폼 델타 수집(트리거별)
  const koForm = new Map<number, { slots: { key: string; text: string; zone: string; clip?: boolean; ell?: boolean }[]; kind: string }>();
  for (const tg of triggers) {
    const kind = await openFormByPi(admin, tg.pi, koBaseInputs);
    if (kind) koForm.set(tg.pi, { slots: deltaSlots(koBase, await captureSlots(admin)), kind });
    await resetForm(admin, kind, menu, sub);
  }
  if (!koForm.size) { skip(base, '폼 미오픈 — 페이지형/데이터의존 추정(트리거는 있으나 폼 전환 미감지)'); return; }
  // 전환 후 FG 폼 델타 대조. ⚠ KO 폼 수집 중 안 닫힌 모달이 헤더 스위처를 가려 전환 차단(작업 지시 전환실패) →
  //   전환 전 오버레이 강제 정리(2026-09-01 개선). 그래도 모달 잔존 시 전환은 재시도(switchCourseLang 내장) 후 판정.
  await closeCourseOverlays(admin);
  if (!(await switchCourseLang(admin, lang.clickLabel))) { skip(base, `${lang.clickLabel} 전환 실패(모달 잔존/스위처 차단 추정)`); await ensureCourseKorean(admin); return; }
  const fgBaseInputs = await editableInputCount(admin);
  const fgBase = await captureSlots(admin);
  for (const tg of triggers) {
    const rec = koForm.get(tg.pi); if (!rec || !rec.slots.length) continue;
    const kind = await openFormByPi(admin, tg.pi, fgBaseInputs);
    if (kind) {
      const fg = deltaSlots(fgBase, await captureSlots(admin));
      const [koF, fgF] = prepCourseSlots(rec.slots, fg);
      applySlotComparison(koF, fgF, lang, `${screen} ${rec.kind}[${tg.label}]`, tcRef, '', seen, SCREEN_SCOPED_ZONES);
    }
    await resetForm(admin, kind);   // FG: menu 미전달 → Escape만(원복+다음 재진입서 폐기)
  }
  await ensureCourseKorean(admin);
}

// 전 메뉴(COURSE_IA) × 단일 언어 팝업 순회.
export async function runCourseLangModal(admin: Page, lang: CourseLang) {
  const n = (s: string) => (s || '').replace(/\s+/g, '');
  const filt = (process.env.LANG_MENUS || '').split(',').map((s) => n(s)).filter(Boolean);
  const seen = new Set<string>();
  let done = 0;
  for (const grp of COURSE_IA) {
    for (const sub of grp.subs) {
      const screen = grp.menu === sub.name ? grp.menu : `${grp.menu} > ${sub.name}`;
      if (filt.length && !filt.some((f) => n(screen).includes(f))) continue;
      const tcRef = `코스관리_언어검증_팝업_${grp.menu}`;
      // heavy 화면이 정적 패스에서 '트리거 0'으로 확인됐으면 재진입 생략 — 재진입해도 '트리거 없음'으로 끝나므로
      //   flake 표면만 제거(동일 결과·정직 사유). 미확인(-1/미기록)이나 트리거≥1은 정상 진입(현행 유지).
      if (isHeavyScreen(screen) && screenTriggerCount.get(screen) === 0) {
        skip({ path: `${screen} > 팝업 언어검증`, tcRef, tcId: `LANGPOP-${lang.ko}`, desc: `${lang.ko} 팝업 i18n` }, '열기형 트리거 없음(정적 패스 확인) — heavy 재진입 생략');
        continue;
      }
      const ok = await enterCourseMenu(admin, grp.menu, grp.menu === sub.name ? undefined : sub.name);
      if (!ok) { skip({ path: `${screen} > 팝업 언어검증`, tcRef, tcId: `LANGPOP-${lang.ko}`, desc: `${lang.ko} 팝업 i18n` }, '진입 실패'); continue; }
      await killAlarms(admin); await settle(admin, 600);
      await scanCourseForms(admin, lang, screen, tcRef, seen, grp.menu, grp.menu === sub.name ? undefined : sub.name);
      done++;
      console.log(`  [langpop ${lang.ko}] ${screen} 완료 (${done})`);
    }
  }
  console.log(`\n[courseLangModal] ${lang.ko}(${lang.label}) — ${done}화면 팝업 검증`);
}

// 전 메뉴(COURSE_IA) × 단일 언어 순회. 세션 1런/로그인 제약 → 스펙에서 언어 선택(LANGS env).
//   filt: 대/소메뉴명 부분일치(공백무시)로 부분 실행(LANG_MENUS env).
export async function runCourseLangCheck(admin: Page, lang: CourseLang) {
  const n = (s: string) => (s || '').replace(/\s+/g, '');
  const filt = (process.env.LANG_MENUS || '').split(',').map((s) => n(s)).filter(Boolean);
  const seen = new Set<string>();
  seenCoverage.clear(); seenControl.clear();   // 언어별 리포트마다 커버리지 감사 재방출(review는 언어별 reset되므로 dedup도 리셋)
  screenTriggerCount.clear();   // 언어별 정적→모달 재진입 생략 판단 초기화(정적 패스가 이번 언어분으로 재채움)
  let done = 0;
  for (const grp of COURSE_IA) {
    for (const sub of grp.subs) {
      const screen = grp.menu === sub.name ? grp.menu : `${grp.menu} > ${sub.name}`;
      if (filt.length && !filt.some((f) => n(screen).includes(f))) continue;
      const tcRef = `코스관리_언어검증_${grp.menu}`;
      const ok = await enterCourseMenu(admin, grp.menu, grp.menu === sub.name ? undefined : sub.name);
      if (!ok) { skip({ path: `${screen} > 언어검증`, tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} 언어검증` }, '진입 실패(하위메뉴 미노출/degraded)'); continue; }
      await killAlarms(admin); await settle(admin, 600);
      await scanCourseScreen(admin, lang, screen, tcRef, seen);
      // 모달 패스 재진입 생략 판단용: 정적 패스는 첫(신선) 방문이라 트리거 탐지가 재진입보다 신뢰도 높음.
      //   scanCourseScreen 종료 시 ensureCourseKorean로 KO·동일화면 상태 → findModalTriggers(KO 라벨 매칭) 유효.
      try { await settle(admin, 200); screenTriggerCount.set(screen, (await findModalTriggers(admin)).length); }
      catch { screenTriggerCount.set(screen, -1); }   // 탐지 실패=미확인 → 모달 패스 정상 진입 폴백
      done++;
      console.log(`  [lang ${lang.ko}] ${screen} 완료 (${done}, 트리거 ${screenTriggerCount.get(screen)})`);
    }
  }
  console.log(`\n[courseLangCheck] ${lang.ko}(${lang.label}) — ${done}화면 검증`);
}

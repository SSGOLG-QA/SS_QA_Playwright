import { Page } from '@playwright/test';
import { record, skip, review, CheckMeta } from '../reporter';
import { killAlarms } from './courseHelpers';
import { settle } from '../adminHelpers';
import {
  CourseLang, switchCourseLang,
  ensureCourseKorean, enterCourseMenu, closeCourseOverlays,
} from './courseLangCheck';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어 — **캘린더 표시 년도 정합성** 검증 (QA-15543)
//
//  배경: 표준 다국어 하네스(runCourseLangCheck)는 KO baseline ↔ FG 슬롯을 **텍스트 교체(번역) 여부**로
//    대조한다. 그래서 "한글 잔존/미번역/혼재/타언어/인코딩/글자잘림" 같은 **표기(presentation) 결함**만 잡는다.
//    QA-15543(태국어 캘린더 년도 오류)은 번역·현지화는 됐는데 **값 자체가 틀린** 콘텐츠/시맨틱 결함이라
//    6개 FAIL 카테고리 어디에도 안 걸린다(원리적 사각지대). 게다가:
//      ① 정적 스캔은 datepicker를 열지 않아 년도가 캡처 범위 밖.
//      ② 날짜/숫자는 fmtShape로 숫자를 0으로 지우고 '관찰(INFO)'만 함(2569든 3112든 형태만 봄).
//      ③ 날짜값은 언어마다 달라지는 게 정상이라 baseline 대조로 옳고 그름을 판별할 oracle이 없음.
//
//  검출 방식 = **oracle 기반 교차언어 년도 정합**(런 내 완결, 비파괴):
//    1) 화면 진입(한국어) → 캘린더/datepicker를 열어 **표시 년도**(그레고리) 수집.  [KO는 신뢰 baseline]
//    2) 대상 언어 전환 → 동일 캘린더(탭경로+소스 인덱스 매칭)를 다시 열어 표시 년도 수집.
//    3) 판정: `FG표시년 − KO그레고리년` 이 **언어별 허용 오프셋**에 들면 PASS, 아니면 FAIL.
//       - 태국어: 허용 {0(그레고리), 543(불교력 Buddhist Era)} — 둘 다 관습상 정상. 그 외(이중가산
//         +1086·역방향 −543·엉뚱한 값)는 결함. QA-15543의 "잘못된 년도"가 정확히 여기 걸린다.
//       - 그 외 전 언어: {0} 그레고리력만.
//    4) 종료 시 한국어 원복.
//
//  ⚠ 오라클 설계 주의(정직성): QA-15543은 수정 완료(정상노출 확인)라 "태국어의 의도된 정본 역법"이
//     그레고리인지 불교력인지 티켓만으로 확정 불가 → **둘 다 허용**하는 보수적 오라클로 가짜 FAIL을 피하고
//     진짜 이상값만 잡는다. QA가 정본 역법을 확정하면 ALLOWED_YEAR_OFFSETS[태국어]를 단일값으로 좁히면 됨.
//  ⚠ 비파괴: 언어 전환·datepicker 열기/읽기/Escape 만. 날짜 선택·저장·네비게이션 이동 없음.
// ──────────────────────────────────────────────────────────────

// 언어별 허용 캘린더 년도 오프셋(그레고리 기준). `표시년 − offset === 그레고리년` 이면 정상.
export const ALLOWED_YEAR_OFFSETS: Record<string, number[]> = {
  // 태국어: **그레고리(0)만** — 2026-09-14 라이브 실측으로 확정(26/26 요소가 그레고리, 불교력 0건).
  //   즉 이 앱의 태국어 정본 역법 = 그레고리. QA-15543 수정 결과도 그레고리 정상노출.
  //   ⚠ 이전엔 증거 부재로 {0,543}(불교력도 허용)이었으나, 실측 후 {0}로 좁혀 **불교력(+543·2569) 회귀도
  //     결함으로 검출**한다. (만약 QA가 특정 화면은 불교력이 정본이라고 확정하면 그 화면만 예외 처리.)
  'ภาษาไทย': [0],
};
const DEFAULT_OFFSETS = [0];   // 나머지 전 언어 = 그레고리력만

// QA-15543 캘린더 노출 화면(코스관리_PC). Home은 작업/비용 대시보드 탭 안에 캘린더가 있어 탭 순회로 도달.
type CalScreen = { menu: string; sub?: string; label: string };
const CALENDAR_SCREENS: CalScreen[] = [
  { menu: 'Home', label: '홈(작업/비용 대시보드 캘린더)' },
  { menu: '정보 관리', sub: '코스 운영 정보', label: '정보 관리 > 코스 운영 정보' },
  { menu: '작업 관리', sub: '작업 계획', label: '작업 관리 > 작업 계획' },
  { menu: '작업 관리', sub: '예측 정보', label: '작업 관리 > 예측 정보' },
  { menu: '작업 관리', sub: '작업 일보', label: '작업 관리 > 작업 일보' },
  { menu: '예산 관리', sub: '예산 총괄', label: '예산 관리 > 예산 총괄(연간)' },
];

// 년도 문자열 정규화 — 태국/아랍-인도/전각 숫자를 ASCII로. (태국어 캘린더가 태국 숫자 ๒๕๖๙ 로 표기할 수 있음)
function toAsciiDigits(s: string): string {
  return (s || '')
    .replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))          // 태국 숫자
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))   // 아랍-인도 숫자
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));  // 전각 숫자
}
// 캘린더 헤더 텍스트에서 년도(첫 4자리) 추출. 월/일은 1~2자리라 무충돌. 헤더는 계산셀렉터로 스코프돼 큰 데이터숫자 없음.
function extractYear(raw: string): number | null {
  const t = toAsciiDigits((raw || '').replace(/\s+/g, ' '));
  const m = t.match(/\d{4}/);
  return m ? +m[0] : null;
}

// ── "chrome 년도" 스캔 셀렉터 (2026-09-14 프로브 course:probe-calendar 실측 기반) ──
//   코스관리 캘린더는 공유 datepicker(.datepicker-input/.datepicker-layer)가 **없다**(프로브: 전 화면 dpInput=0).
//   대신 **화면별 인라인 위젯**이며 년도는 아래 chrome 요소에 렌더된다:
//     · strong        = 인라인 월-뷰 캘린더 제목("2026년 9월", strong.ta-c/.fs-20) + 주간 제목("…~…") + "…기준"
//     · span.fc-ffffff= 다크 카드 캡션("2026년 9월 현재", Home 비용 예산대비실적)
//     · span.fc-14 / span.wd-50 = 차트/범례 연도 라벨("2026년"/"2025년")
//     · th            = 표 연도 헤더("2024년"/"2025년 (YoY)"/"2026년 (YoY)", 예산 총괄 연간)
//   ⚠ .calendar-header 는 **요일**(일 월 화…)만 담아 년도 없음 → 제외. 데이터 셀(td/.calendar-body-content/
//     .section-card-date/scheduler)은 이 셀렉터군에 안 들어와 자동 배제(작업일자·기간 데이터 오탐 없음).
const CHROME_YEAR_SEL = 'strong, span.fc-ffffff, span.fc-14, span.wd-50, th';

// chrome 요소의 **own-text**(직접 텍스트 노드)를 DOM 순서로 전수 수집(년도 유무 무관 — KO/FG 인덱스 정합용).
//   년도 판정/추출은 상위(checkScreenCalendar)에서: KO에 그레고리 년도 있는 인덱스만 대조.
//   own-text만 쓰는 이유: 부모가 자식 텍스트를 합산(innerText)하면 데이터가 섞여 오염 → 프로브가 own-text로 년도를 정확 포착함.
async function readChromeTexts(admin: Page): Promise<string[]> {
  return admin.evaluate((sel) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.contents, main') || document.body;
    const isVis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('.side-navbar-container');
    };
    const directText = (el: Element) => norm(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' '));
    const out: string[] = [];
    for (const el of Array.from(scope.querySelectorAll(sel))) {
      if (!isVis(el)) continue;
      out.push(directText(el).slice(0, 60));   // 빈 own-text도 자리 유지(인덱스 정합 — 번역은 텍스트만 바꿔 요소 집합/순서 불변)
    }
    return out;
  }, CHROME_YEAR_SEL).catch(() => [] as string[]);
}

// ── 탭 순회(계층 ≤2) — Home(작업/비용 → 하위 분석 탭)·예산 총괄(연간/월간). KO/FG 를 **인덱스 경로**로 매칭. ──
async function tabGroupCount(admin: Page): Promise<number> {
  return admin.evaluate(() => Array.from(document.querySelectorAll('.tab-group'))
    .filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest('.side-navbar-container')).length).catch(() => 0);
}
async function tabsInGroup(admin: Page, level: number): Promise<number> {
  return admin.evaluate((lv) => {
    const g = Array.from(document.querySelectorAll('.tab-group')).filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest('.side-navbar-container'))[lv];
    return g ? Array.from(g.children).filter((c) => (c as HTMLElement).offsetParent !== null).length : 0;
  }, level).catch(() => 0);
}
async function clickTab(admin: Page, level: number, i: number): Promise<void> {
  await admin.evaluate(({ lv, idx }) => {
    const g = Array.from(document.querySelectorAll('.tab-group')).filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest('.side-navbar-container'))[lv];
    if (!g) return;
    const el = Array.from(g.children).filter((c) => (c as HTMLElement).offsetParent !== null)[idx] as HTMLElement | undefined;
    el?.click();
  }, { lv: level, idx: i }).catch(() => {});
}

type Reading = { raw: string; year: number | null };

// 현재 화면의 chrome 년도 후보를 탭경로별로 수집 → Map<key, Reading>. key=탭경로+chrome인덱스(KO/FG 매칭).
async function collectAcrossTabs(admin: Page): Promise<Map<string, Reading>> {
  const map = new Map<string, Reading>();
  const collectLeaf = async (pathKey: string) => {
    (await readChromeTexts(admin)).forEach((raw, i) => map.set(`${pathKey}|chrome${i}`, { raw, year: extractYear(raw) }));
  };
  const groups = await tabGroupCount(admin);
  const n0 = groups >= 1 ? await tabsInGroup(admin, 0) : 0;
  if (n0 < 1) { await collectLeaf('root'); return map; }
  for (let i = 0; i < Math.min(n0, 8); i++) {
    await clickTab(admin, 0, i); await settle(admin, 500); await killAlarms(admin);
    // 2단 탭(홈 비용 대시보드 등): 상위탭 클릭 후 하위 그룹이 새로 나타나면 순회.
    if ((await tabGroupCount(admin)) > 1) {
      const n1 = await tabsInGroup(admin, 1);
      for (let j = 0; j < Math.min(Math.max(n1, 1), 8); j++) {
        if (n1 >= 1) { await clickTab(admin, 1, j); await settle(admin, 500); await killAlarms(admin); }
        await collectLeaf(`t${i}.${j}`);
        if (n1 < 1) break;
      }
    } else {
      await collectLeaf(`t${i}`);
    }
  }
  return map;
}

// 한 화면 캘린더 년도 검증(단일 언어). KO 수집 → 전환 → FG 수집 → 오프셋 대조 → 한국어 원복.
async function checkScreenCalendar(admin: Page, lang: CourseLang, screen: CalScreen, tcRef: string, seen: Set<string>): Promise<void> {
  const base: CheckMeta = { path: `${screen.label} > 캘린더 년도`, tcRef, tcId: `CALYEAR-${lang.ko}`, desc: `${lang.ko}(${lang.label}) 캘린더 표시 년도 정합성` };
  await settle(admin, 400); await closeCourseOverlays(admin);
  const ko = await collectAcrossTabs(admin);
  await closeCourseOverlays(admin);

  // KO에서 년도가 읽힌 소스만 검증 대상(캘린더 존재 증거). 하나도 없으면 정직하게 skip(이 화면 datepicker 없음/데이터의존).
  const koYearSources = [...ko.entries()].filter(([, v]) => v.year != null);
  if (!koYearSources.length) { skip(base, '캘린더/년도 헤더 미발견 — datepicker 없음·데이터 의존 추정(정직 미검증)'); return; }
  review({ lang: lang.ko, screen: screen.label, kind: '캘린더 소스(KO 기준)', item: `${koYearSources.length}개 년도 검출`, value: koYearSources.map(([, v]) => `${v.year}["${v.raw.slice(0, 16)}"]`).join(' / ').slice(0, 160) });

  if (!(await switchCourseLang(admin, lang.clickLabel))) { skip(base, `${lang.clickLabel} 전환 실패(드롭다운/항목 미발견)`); await ensureCourseKorean(admin); return; }
  await settle(admin, 700);
  const fg = await collectAcrossTabs(admin);
  await ensureCourseKorean(admin);

  const nowY = new Date().getFullYear();
  const offsets = ALLOWED_YEAR_OFFSETS[lang.label] ?? DEFAULT_OFFSETS;
  for (const [key, kv] of koYearSources) {
    const koYear = kv.year!;
    const dedup = `${screen.label}|${key}`;
    if (seen.has(dedup)) continue; seen.add(dedup);
    // KO 기준값 자체가 비정상 그레고리(현재년±10 밖)면 KO 데이터 이슈 → 판정 보류(관찰), FG를 오판하지 않음.
    if (koYear < nowY - 10 || koYear > nowY + 10) {
      review({ lang: lang.ko, screen: screen.label, kind: '캘린더 KO 기준 이상(판정 보류)', zone: key, item: `KO 표시년 ${koYear}`, value: `raw="${kv.raw}"` });
      continue;
    }
    const fv = fg.get(key);
    if (!fv || fv.year == null) {
      skip({ ...base, path: `${base.path} [${key}]` }, `${lang.clickLabel} 모드에서 동일 캘린더 년도 미검출(raw="${fv?.raw || ''}") — 렌더/구조 확인 필요`);
      continue;
    }
    const fgYear = fv.year;
    const delta = fgYear - koYear;
    const meta: CheckMeta = {
      path: `${screen.label} > 캘린더 년도`, tcRef, tcId: `CALYEAR-${lang.ko}`,
      desc: `${lang.ko} 캘린더 표시 년도가 그레고리 기준과 정합해야 함(허용 오프셋 ${offsets.join('/')})`,
      expected: `그레고리 ${koYear} → 허용 표시년 ${offsets.map((o) => koYear + o).join(' 또는 ')}`,
    };
    const eraName = (d: number) => (d === 543 ? ' 불교력' : d === 0 ? ' 그레고리' : '');
    if (offsets.includes(delta)) {
      record(meta, 'PASS', { actual: `${lang.label}: ${fgYear} (Δ${delta >= 0 ? '+' : ''}${delta}${eraName(delta)})`, detail: `KO raw="${kv.raw}" / ${lang.ko} raw="${fv.raw}"` });
    } else {
      record(meta, 'FAIL', {
        actual: `${lang.label}: ${fgYear} (그레고리 기준 ${koYear}, 실제 Δ${delta >= 0 ? '+' : ''}${delta}, 허용 ${offsets.join('/')})`,
        error: '캘린더 년도 오류',
        detail: `KO raw="${kv.raw}" / ${lang.ko} raw="${fv.raw}"`,
      });
    }
  }
}

// 캘린더 노출 화면 × 단일 언어 순회. 세션 1런/로그인 제약 → 스펙에서 언어 선택(LANGS env).
export async function runCourseCalendarLang(admin: Page, lang: CourseLang): Promise<void> {
  const seen = new Set<string>();
  // 오라클 가정 명시(정직성) — 태국어 이중역법 허용을 리포트에 남겨 QA가 정본 확정 시 좁힐 수 있게.
  const off = (ALLOWED_YEAR_OFFSETS[lang.label] ?? DEFAULT_OFFSETS);
  review({ lang: lang.ko, screen: '(오라클)', kind: '판정 기준', item: `허용 년도 오프셋 ${off.join('/')}`, value: `그레고리 기준 ± 오프셋만 정상, 그 외 값=결함(QA-15543 계열). ${lang.ko}=${off.includes(543) ? '불교력(+543)/그레고리 허용' : '그레고리력만(실측 확정)'}` });
  let done = 0;
  for (const screen of CALENDAR_SCREENS) {
    const tcRef = `코스관리_다국어_캘린더년도_${screen.menu}`;
    const sub = screen.sub && screen.sub !== screen.menu ? screen.sub : undefined;
    try {
      const ok = await enterCourseMenu(admin, screen.menu, sub);
      if (!ok) { skip({ path: `${screen.label} > 캘린더 년도`, tcRef, tcId: `CALYEAR-${lang.ko}`, desc: `${lang.ko} 캘린더 년도` }, '진입 실패(하위메뉴 미노출/degraded)'); continue; }
      await killAlarms(admin); await settle(admin, 600);
      await checkScreenCalendar(admin, lang, screen, tcRef, seen);
      done++;
      console.log(`  [cal-year ${lang.ko}] ${screen.label} 완료 (${done})`);
    } catch (e: any) {
      const msg = (e?.message || String(e)).replace(/\s+/g, ' ').slice(0, 300);
      console.warn(`  [cal-year ${lang.ko}] ${screen.label} 예외(격리·계속): ${msg}`);
      skip({ path: `${screen.label} > 캘린더 년도`, tcRef, tcId: `CALYEAR-${lang.ko}`, desc: `${lang.ko} 캘린더 년도` }, `화면 처리 예외(격리·계속): ${msg}`);
      await ensureCourseKorean(admin).catch(() => {});
      await killAlarms(admin).catch(() => {});
    }
  }
  console.log(`\n[courseCalendarLang] ${lang.ko}(${lang.label}) — ${done}화면 캘린더 년도 검증`);
}

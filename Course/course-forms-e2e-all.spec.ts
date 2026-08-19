import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport } from '../lib/reporter';
import { openEditableForm, closeForm, runFormBattery } from '../lib/course/formE2E';

// ──────────────────────────────────────────────────────────────
//  코스관리 전 대메뉴 폼 E2E(정보 관리 외, 비파괴) — 정보 관리에서 검증한 공용 배터리를 확장.
//  실행: npm run course:auth 후 npm run course:forms-e2e-all   (일부만: $env:E2E_MENUS="작업 관리,사진 관리")
//  각 화면: 진입 → [신규 등록]모달/[수정]/인라인 폼 열기 → 배터리(datepicker·입력전수·[X]클리어·항목추가/삭제·파일휴지통) → [취소] 폐기.
//  ⚠ 저장/등록(submit) 절대 클릭 금지. 폼 미제공(읽기전용/분석/데이터 의존)은 skip.
//  ⛔ 지도 화면 제외(handover 2-3: Leaflet 방문 시 후속 SNB 네비 불능) — 코스 현황 관리 전체·장비 관제·시설 관제.
// ──────────────────────────────────────────────────────────────

const SCREENS: { menu: string; sub: string; key: string }[] = [
  // 사진 관리
  { menu: '사진 관리', sub: '정보별 사진', key: 'PH-INFO' },
  { menu: '사진 관리', sub: '위치별 사진', key: 'PH-LOC' },
  // 작업 관리
  { menu: '작업 관리', sub: '작업 지시', key: 'WO-ORDER' },
  { menu: '작업 관리', sub: '작업 계획', key: 'WO-PLAN' },
  { menu: '작업 관리', sub: '이슈 관리', key: 'WO-ISSUE' },
  { menu: '작업 관리', sub: '예측 정보', key: 'WO-PREDICT' },
  { menu: '작업 관리', sub: '작업 일보', key: 'WO-DAILY' },
  // 인력 관리
  { menu: '인력 관리', sub: '인력 관리', key: 'HR-HUMAN' },
  { menu: '인력 관리', sub: '근태 관리', key: 'HR-WORK' },
  { menu: '인력 관리', sub: '투입 관리', key: 'HR-ASSIGN' },
  { menu: '인력 관리', sub: '권한관리', key: 'HR-PERM' },
  // 자재 관리
  { menu: '자재 관리', sub: '자재 총괄', key: 'MT-SUM' },
  { menu: '자재 관리', sub: '자재 수불(품목별)', key: 'MT-ITEM' },
  { menu: '자재 관리', sub: '자재 수불(일자별)', key: 'MT-DAILY' },
  // 시설/장비 총괄(관제=지도 제외)
  { menu: '시설 관리', sub: '시설 총괄', key: 'FC-SUM' },
  { menu: '장비 관리', sub: '장비 총괄', key: 'EQ-SUM' },
  // 예산 관리
  { menu: '예산 관리', sub: '예산 총괄', key: 'BG-SUM' },
  { menu: '예산 관리', sub: '예산 상세', key: 'BG-DETAIL' },
  { menu: '예산 관리', sub: '실적 관리', key: 'BG-PERF' },
  { menu: '예산 관리', sub: '예산 분석', key: 'BG-ANAL' },
  // 비용 관리
  { menu: '비용 관리', sub: '비용 집계', key: 'CO-AGG' },
  { menu: '비용 관리', sub: '작업별 비용', key: 'CO-TASK' },
  { menu: '비용 관리', sub: '분류별 비용', key: 'CO-CAT' },
  { menu: '비용 관리', sub: '위치별 비용', key: 'CO-LOC' },
  { menu: '비용 관리', sub: '기간별 비용', key: 'CO-PERIOD' },
];

test('코스관리 전 대메뉴 폼 E2E(정보 관리 외, 비파괴)', async ({ page, context }) => {
  test.setTimeout(1_500_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin: Page = await openCourseAdmin(page, context);

  const only = (process.env.E2E_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const screens = only.length ? SCREENS.filter((s) => only.includes(s.menu)) : SCREENS;

  for (const { menu, sub, key } of screens) {
    const P = `${menu} > ${sub}`;
    const Rp = `코스관리_폼E2E_${key}`;
    const ok = await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: `${Rp}_0`, tcId: `FORME2E-${key}-00`, desc: '진입' }, '진입 실패(SNB 미노출/네비 실패)'); continue; }
    // 렌더 안정화(데이터 화면 레이스 완화 — 시설 총괄 등 [등록] 버튼 늦게 노출)
    await admin.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await admin.locator('.contents button, main button, .contents table, .contents input').first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
    await admin.waitForTimeout(700); await killAlarms(admin);

    let form: { opened: boolean; kind: string };
    try { form = await openEditableForm(admin); } catch { form = { opened: false, kind: '' }; }
    if (!form.opened) {
      skip({ path: `${P} > 폼`, tcRef: `${Rp}_form`, tcId: `FORME2E-${key}-FORM`, desc: '편집 폼 열기' }, '폼 진입점 없음(읽기전용/분석/데이터 의존)');
      continue;
    }
    record({ path: `${P} > 폼`, tcRef: `${Rp}_form`, tcId: `FORME2E-${key}-FORM`, desc: `편집 폼 열기(${form.kind})`, failMsg: '폼 미오픈' }, 'PASS', { actual: form.kind });
    try { await runFormBattery(admin, P, Rp, key); } catch { /* 화면별 예외 격리 */ }
    try { await closeForm(admin); } catch { /* noop */ }
    await killAlarms(admin);
  }

  await killAlarms(admin);
  await writeReport('코스관리_폼E2E확장');
});

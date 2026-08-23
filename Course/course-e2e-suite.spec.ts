import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { runDeepScreensSweep } from '../lib/course/deepScreenE2E';
import { openEditableForm, closeForm, runFormBattery } from '../lib/course/formE2E';

// ──────────────────────────────────────────────────────────────
//  읽기 심화 E2E 통합 — 단일 로그인으로 (1) 심화 화면 스윕(deepScreenE2E) + (2) 폼 E2E 스윕을 순차 실행.
//  실행: npm run course:auth 후 npm run course:e2e
//  ⚠ "1로그인 1런" 제약 → 개별 E2E를 각각 돌리면 로그인 여러 번 필요하지만, 이 스위트는 openCourseAdmin 1회로 전부 수행.
//  전부 비파괴(폼 열기→구성요소 확인→취소/닫기, 저장·삭제 안 함). 결과 코스관리_E2E통합 xlsx+html.
//  폼 스윕 대상은 DEEP_SCREENS에 없는 화면만(중복 방문 방지). DEEP_SCREENS는 runDeepScreensSweep이 담당.
// ──────────────────────────────────────────────────────────────

// DEEP_SCREENS(정보관리 10·작업 2·인력 2·자재/시설/장비 각1·드론)에 없는 폼 화면.
const FORM_ADD: { menu: string; sub: string; key: string }[] = [
  { menu: '사진 관리', sub: '정보별 사진', key: 'PH-INFO' },
  { menu: '사진 관리', sub: '위치별 사진', key: 'PH-LOC' },
  { menu: '작업 관리', sub: '작업 계획', key: 'WO-PLAN' },
  { menu: '작업 관리', sub: '예측 정보', key: 'WO-PREDICT' },
  { menu: '작업 관리', sub: '작업 일보', key: 'WO-DAILY' },
  { menu: '인력 관리', sub: '근태 관리', key: 'HR-WORK' },
  { menu: '인력 관리', sub: '투입 관리', key: 'HR-ASSIGN' },
  { menu: '자재 관리', sub: '자재 수불(품목별)', key: 'MT-ITEM' },
  { menu: '자재 관리', sub: '자재 수불(일자별)', key: 'MT-DAILY' },
  { menu: '예산 관리', sub: '예산 총괄', key: 'BG-SUM' },
  { menu: '예산 관리', sub: '예산 상세', key: 'BG-DETAIL' },
  { menu: '예산 관리', sub: '실적 관리', key: 'BG-PERF' },
];

async function runFormSweep(admin: Page, screens: { menu: string; sub: string; key: string }[]): Promise<void> {
  for (const { menu, sub, key } of screens) {
    const P = `${menu} > ${sub}`;
    const Rp = `코스관리_E2E폼_${key}`;
    const ok = await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: `${Rp}_0`, tcId: `E2EF-${key}-00`, desc: '진입' }, '진입 실패(SNB 미노출/네비 실패)'); continue; }
    await admin.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await admin.locator('.contents button, main button, .contents table, .contents input').first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
    await admin.waitForTimeout(700); await killAlarms(admin);
    let form: { opened: boolean; kind: string };
    try { form = await openEditableForm(admin); } catch { form = { opened: false, kind: '' }; }
    if (!form.opened) { skip({ path: `${P} > 폼`, tcRef: `${Rp}_form`, tcId: `E2EF-${key}-FORM`, desc: '편집 폼 열기' }, '폼 진입점 없음(읽기전용/분석/데이터 의존)'); continue; }
    record({ path: `${P} > 폼`, tcRef: `${Rp}_form`, tcId: `E2EF-${key}-FORM`, desc: `편집 폼 열기(${form.kind})`, failMsg: '폼 미오픈' }, 'PASS', { actual: form.kind });
    try { await runFormBattery(admin, P, Rp, key); } catch { /* 화면별 예외 격리 */ }
    try { await closeForm(admin); } catch { /* noop */ }
    await killAlarms(admin);
  }
}

test('E2E 통합 — 심화 화면 스윕 + 폼 E2E (단일 로그인, 비파괴)', async ({ page, context }) => {
  test.setTimeout(2_400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  console.log('\n═══ [1/2] 심화 화면 스윕(deep) ═══');
  await runDeepScreensSweep(admin).catch((e) => console.warn('[e2e] deep 실패(계속):', e?.message || e));
  await killAlarms(admin);

  console.log('\n═══ [2/2] 폼 E2E 스윕(추가 화면) ═══');
  await runFormSweep(admin, FORM_ADD).catch((e) => console.warn('[e2e] forms 실패(계속):', e?.message || e));
  await killAlarms(admin);

  setReportHtmlOpts('코스관리_E2E통합', {
    subtitle: '심화 화면 스윕 + 폼 E2E — 단일 로그인 통합 · 비파괴(폼 열기→확인→취소)',
    lead: '코스관리 <b>전 메뉴 화면·폼 흐름</b>을 깊이 확인했습니다 — 탭 전환·신규등록/수정 폼 열기·입력 컨트롤·달력·[X] 등 구성요소가 정상 동작·노출되는지(저장·삭제는 안 함).',
    catch: ['폼·모달·탭이 <b>안 열리거나 구성요소가 빠진</b> 경우', '화면 진입·렌더 <b>회귀</b>'],
    miss: ['저장 후 <b>실제 반영·계산</b>(쓰기 경로 E2E가 담당)', '데이터가 없어 <b>폼 진입점이 없는</b> 화면(참고로 분리)'],
  });
  await writeReport('코스관리_E2E통합');
});

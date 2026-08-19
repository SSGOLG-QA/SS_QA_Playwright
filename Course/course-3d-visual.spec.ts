import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';

/**
 * 3D 측정값 시각 회귀 스캐폴드 (course:3d-visual) — 비파괴.
 *
 *  배경: 코스 현황 관리 > 3D(/monitor/3d)의 측정 도구(지점·거리·높이·각도·넓이)는
 *    측정 결과 **수치값이 WebGL 캔버스에 렌더**(DOM 미노출) → DOM 스캔으론 값 검증 불가(course:visual-deep D3-MEASURE는 상호작용만 PASS).
 *    → 값 검증은 시각 회귀(픽셀 대조)의 몫. 본 스캐폴드가 그 골격.
 *
 *  방식: 측정 도구 활성 → 캔버스에 **결정적 좌표**로 포인트 클릭 → **캔버스 요소 스크린샷** baseline 대조.
 *    측정값은 WebGL 캔버스에 그려지므로 canvas 요소 스크린샷에 포함됨 → 값 변경(계산 회귀) 시 픽셀 diff.
 *
 *  ★ 스모크 확정(2026-08-18, 2회 실행): **헤드리스 자동화에선 측정 불가**.
 *    - 헤드리스 Chromium=SwiftShader(소프트웨어 WebGL) → **EPT 포인트클라우드가 "Loading Entwine-generated EPT format"에서 멈춤**
 *      (지형은 거칠게 보이나 측정 point-picking에 필요한 완전 로드 미완). 지형 좌표를 클릭해도 측정선/수치 미생성 →
 *      5개 도구 스크린샷 byte-identical(로딩 상태). ∴ **3D 측정값 시각회귀는 실제 GPU(헤디드 or GPU-CI 러너)에서만 유효**.
 *    - 본 스캐폴드는 로드 완료(‘Loading Entwine’ 소멸) 대기 후 진행 — 미완이면 SKIP(헤드리스 한계 명시). GPU 환경서 baseline 생성 권장.
 *
 *  ⚠ 안정성 전제(반드시 지킬 것 — 미준수 시 오탐):
 *    1. **baseline은 고정 환경(CI 고정 러너)에서 생성** — WebGL은 GPU/OS/드라이버별 렌더 상이. 로컬↔CI diff는 오탐.
 *    2. **고정 뷰포트 1280×800**(아래 test.use) + 카메라 기본 위치(orbit/drag 금지 — 캡처 전 카메라 이동 안 함).
 *    3. **결정적 캔버스 클릭**(OFFS 고정 오프셋) — 같은 점 선택 → 같은 측정값.
 *    4. animations 비활성 + networkidle + WebGL 안정화 대기.
 *    5. 도구 간 측정 초기화는 도구 비활성+ESC로 시도 — 앱이 누적하면 baseline을 그 상태로 재생성하거나 앱별 초기화 버튼 추가(TODO).
 *
 *  baseline 생성/갱신: (재인증 후) npm run course:auth →
 *    npx playwright test --config=Course/playwright.config.ts --project=course Course/course-3d-visual.spec.ts --update-snapshots
 *  검출(회귀): npm run course:3d-visual
 *  ⚠ 첫 실행은 baseline이 없어 스냅샷을 생성하며 통과(경고) — 정본 baseline은 고정 CI 러너에서 --update-snapshots 로 확정.
 */

// 결정성: 고정 뷰포트(기본 최대화는 머신별 상이 → WebGL 캡처 불안정)
test.use({ viewport: { width: 1280, height: 800 } });

const M = (p: Page) => p.locator('.contents, main').first();
const TOOLS: { label: string; points: number }[] = [
  { label: '지점', points: 1 }, { label: '거리', points: 2 }, { label: '높이', points: 2 }, { label: '각도', points: 3 }, { label: '넓이', points: 3 },
];
// ⚠ 스모크 발견(2026-08-18): 캔버스 중심은 빈 배경(어두움) — 지형(골프장 포인트클라우드)은 좌하단 치우침.
//   중심±오프셋 클릭 시 배경 히트 → 포인트 미선택 → 측정 미생성(5도구 스샷 동일). → 지형 영역 분수좌표로 타깃.
//   분수좌표(캔버스 너비/높이 비율): 좌하단 골프장 페어웨이 위 결정적 점들.
const POINTS_FRAC = [[0.38, 0.62], [0.52, 0.68], [0.30, 0.72], [0.45, 0.58], [0.58, 0.75]];

async function activateTool(admin: Page, label: string): Promise<boolean> {
  const btn = M(admin).getByRole('button', { name: label, exact: true }).or(M(admin).getByText(label, { exact: true })).first();
  if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) return false;
  await btn.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);
  return true;
}

async function clickPoints(admin: Page, canvas: ReturnType<Page['locator']>, points: number): Promise<boolean> {
  const box = await canvas.boundingBox().catch(() => null);
  if (!box) return false;
  // 지형(좌하단 포인트클라우드) 위 결정적 분수좌표 클릭 — 배경(빈 중심) 회피.
  for (let i = 0; i < points; i++) { const [fx, fy] = POINTS_FRAC[i % POINTS_FRAC.length]; await admin.mouse.click(box.x + box.width * fx, box.y + box.height * fy).catch(() => {}); await admin.waitForTimeout(450); await killAlarms(admin); }
  return true;
}

// 측정 초기화 시도(도구 비활성 + ESC) — ⚠ 앱별 확정 아님(누적 시 baseline 재생성 필요)
async function clearMeasure(admin: Page, label: string): Promise<void> {
  await M(admin).getByText(label, { exact: true }).first().click({ timeout: 1_000 }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {});
  await admin.waitForTimeout(400); await killAlarms(admin);
}

test('3D 측정값 시각 회귀 스캐폴드(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  const admin = await openCourseAdmin(page, context);

  // 신선 세션에서 3D를 '첫 지도 화면'으로 진입(SPA 네비 후 저하 회피 — facility/green 교훈).
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '3D').then(() => true).catch(() => false))) {
    test.skip(true, '3D 진입 실패(세션 만료 추정 — npm run course:auth 후 재실행)'); return;
  }
  await admin.waitForTimeout(2_500); await killAlarms(admin);

  const canvas = M(admin).locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 16_000 }).catch(() => {});
  await admin.waitForLoadState('networkidle').catch(() => {});

  // ★ EPT 포인트클라우드 완전 로드 대기('Loading Entwine…' 소멸) — 측정 point-picking은 로드 후에만 동작.
  //   헤드리스(SwiftShader)에선 미완 지속 → 측정 불가로 SKIP(결함 아님·환경 한계). GPU 환경선 완료됨.
  let loaded = false;
  for (let i = 0; i < 60 && !loaded; i++) {   // 최대 ~120s
    loaded = await admin.evaluate(() => !/Loading\s+Entwine|Loading[^<]*EPT/i.test(document.body.textContent || '')).catch(() => false);
    if (!loaded) await admin.waitForTimeout(2_000);
  }
  if (!loaded) { test.skip(true, '3D 포인트클라우드(EPT) 로드 미완(~120s) — 헤드리스 소프트웨어 WebGL 한계. 측정 point-picking 불가 → GPU 환경(헤디드/CI)서 baseline 생성 필요.'); return; }
  await admin.waitForTimeout(1_500);   // WebGL 렌더 안정화

  const box = await canvas.boundingBox().catch(() => null);
  if (!box) { test.skip(true, '3D 캔버스 미검출(포인트 선택 불가)'); return; }

  const shot = { animations: 'disabled' as const, maxDiffPixelRatio: 0.05, timeout: 15_000 };

  // ── baseline 0: 기본 3D 뷰(측정 전 — 카메라 기본 위치) ──
  await expect.soft(canvas).toHaveScreenshot('3d-default.png', shot);

  // ── 각 측정 도구: 활성 → 결정적 포인트 클릭 → 캔버스 스크린샷(측정값 WebGL 포함) ──
  for (const t of TOOLS) {
    if (!(await activateTool(admin, t.label))) { console.log(`[3d-visual] 도구 [${t.label}] 미노출 — 스킵`); continue; }
    await clickPoints(admin, canvas, t.points);
    await admin.waitForTimeout(800);
    await expect.soft(canvas).toHaveScreenshot(`3d-measure-${t.label}.png`, shot);
    await clearMeasure(admin, t.label);   // ⚠ TODO: 앱별 초기화 확정 아님
  }
});

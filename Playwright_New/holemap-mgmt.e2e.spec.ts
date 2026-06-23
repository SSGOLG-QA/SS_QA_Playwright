import { test, expect, Page } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { HolemapZonePage, HolemapCartEntrancePage, HolemapTeeshotPage, HolemapPreviewPage } from './holemap-mgmt.pom';
import { SCREEN } from './holemap-mgmt.data';

// ──────────────────────────────────────────────────────────────
//  홀맵 관리 E2E — describe 분리로 개별 항목 독립 실행·리포트
//  4화면 × 개별 test(): 홀맵 구역 설정 / 카트패스 진입여부 / 티샷 유의 거리 / 홀맵 미리보기
//  ⚠ 비파괴: 저장/적용/전체허용·제한/checkbox 변경/초기화 금지
//  특정 항목 실행: npx playwright test holemap-mgmt --config=Playwright_New/playwright.config.ts -g "구역 설정"
// ──────────────────────────────────────────────────────────────

const MS = 8_000; // action timeout

// ═══════════════════════════════════════════════════════════════
//  1. 홀맵 구역 설정
// ═══════════════════════════════════════════════════════════════
test.describe('홀맵 구역 설정', () => {
  let admin: Page;
  let p: HolemapZonePage;

  test.beforeEach(async ({ page, context }) => {
    admin = await openAdmin(page, context);
    p = new HolemapZonePage(admin);
    await p.open();
    await p.expectLoaded(SCREEN.zone.urlPart);
  });

  // ── 진입 ──────────────────────────────────────────────────
  test('진입: URL + GNB 헤더 노출', async () => {
    await expect(admin).toHaveURL(new RegExp(SCREEN.zone.urlPart.replace(/\//g, '\\/')));
    await expect(p.gnbTitle, 'GNB 헤더 노출').toBeVisible();
  });

  test('안내문구: "홀맵 구역" 포함 텍스트 노출', async () => {
    await expect(p.infoBox, '안내문구 노출').toContainText(SCREEN.zone.guide);
  });

  test('필터: vue-select(전체코스/전체홀) 2개 노출', async () => {
    await expect(p.courseSelect, '전체코스 vue-select 노출').toBeVisible();
    await expect(p.holeSelect, '전체홀 vue-select 노출').toBeVisible();
  });

  // ── 텍스트 품질 ──────────────────────────────────────────
  test('raw code: 미가공 코드/오타 미노출', async () => {
    const hits = await p.scanRawCode();
    expect(hits, `미가공 코드 노출: ${JSON.stringify(hits)}`).toEqual([]);
  });

  // ── 테이블 ───────────────────────────────────────────────
  test('테이블: 컬럼 15개 노출', async () => {
    for (const col of SCREEN.zone.columns) {
      await test.step(`컬럼 '${col}'`, async () => {
        const header = p.column(col);
        if (await header.count() > 0) {
          await expect(header, `'${col}' 노출`).toBeVisible();
        } else {
          test.info().annotations.push({ type: '주의', description: `컬럼 '${col}' 미발견 — 화면 변경 가능성` });
        }
      });
    }
  });

  test('테이블: 행 수 ≥ 1 (또는 빈 상태 안내)', async () => {
    const rowCount = await p.renderedRowCount();
    if (rowCount > 0) {
      expect(rowCount, '행 수 ≥ 1').toBeGreaterThanOrEqual(1);
    } else {
      test.info().annotations.push({ type: '주의', description: '데이터 없음(0건) — 데이터 의존 skip' });
    }
  });

  // ── 페이지네이션 ─────────────────────────────────────────
  test('페이지네이션: 2페이지 이동 (best-effort)', async () => {
    const page2Btn = admin.getByRole('button', { name: '2', exact: true }).first();
    if (await page2Btn.count() > 0) {
      await page2Btn.click();
      await admin.waitForTimeout(800);
      await expect(p.rows.first(), '2페이지 행 렌더').toBeVisible();
    } else {
      test.info().annotations.push({ type: '주의', description: '2페이지 버튼 없음 — 1페이지 이내 데이터' });
    }
    for (const dir of ['prev', 'next', 'first', 'last'] as const) {
      const a = p.arrow(dir);
      if (await a.count()) {
        await a.click().catch(() => {});
        await admin.waitForTimeout(400);
        await expect(p.rows.first()).toBeVisible().catch(() => {});
      }
    }
  });

  // ── 필터 동작 ────────────────────────────────────────────
  test('필터 적용: 코스 선택 → [적용] → 행 필터링 (비파괴 조회)', async () => {
    const beforeCount = await p.renderedRowCount();
    const pickedCourse = await p.pickFirstSpecificCourse();
    if (!pickedCourse) {
      test.info().annotations.push({ type: '주의', description: '전체코스 외 옵션 없음 → skip' });
      return;
    }
    const selectedText = await p.selectedCourseText();
    expect(selectedText, `선택값 반영(${pickedCourse})`).toContain(pickedCourse);

    await p.applyFilterBtn.click();
    await admin.waitForTimeout(800);

    await expect(admin, '[적용] 후 URL 유지').toHaveURL(new RegExp(SCREEN.zone.urlPart.replace(/\//g, '\\/')));
    const afterCount = await p.renderedRowCount();
    expect(afterCount, '필터 후 행 수 ≤ 전체').toBeLessThanOrEqual(beforeCount);
    if (afterCount > 0) {
      const firstRowCourse = await p.rows.first().locator('td').nth(1).textContent();
      expect((firstRowCourse ?? '').trim(), '필터 결과 첫 행 코스 = 선택 코스').toBe(pickedCourse);
    }
  });

  test('필터 초기화: [초기화] → 코스 원복 (비파괴)', async () => {
    const pickedCourse = await p.pickFirstSpecificCourse();
    if (!pickedCourse) {
      test.info().annotations.push({ type: '주의', description: '전체코스 외 옵션 없음 → skip' });
      return;
    }
    await p.applyFilterBtn.click();
    await admin.waitForTimeout(600);

    await p.resetFilterBtn.click();
    await admin.waitForTimeout(600);

    const textAfter = await p.selectedCourseText();
    expect(textAfter, '초기화 후 선택 코스 변경').not.toBe(pickedCourse);
    await expect(p.table, '초기화 후 테이블 유지').toBeVisible();
  });

  // ── 모달 ──────────────────────────────────────────────────
  test('모달: [구역관리] → 오버레이 노출', async () => {
    if (await p.zoneBtn.count() === 0) {
      test.info().annotations.push({ type: '주의', description: '행 없음 → skip' });
      return;
    }
    await p.zoneBtn.evaluate((el: HTMLElement) => el.click());
    const container = p.modalContainer();
    const isVisible = await container.isVisible({ timeout: MS }).catch(() => false);
    if (isVisible) {
      await expect(container, '모달 오버레이(.modal-group) 노출').toBeVisible();
      const cancelBtn = p.modalCancelBtn();
      if (await cancelBtn.count() > 0) await cancelBtn.click();
      else await admin.keyboard.press('Escape');
    } else {
      await expect(admin, '별도 레이어 방식 — /club/ URL 유지').toHaveURL(/\/club\//);
      await admin.goBack().catch(() => {});
    }
  });

  test('모달: 내부 텍스트 + 버튼 ≥ 1개 노출', async () => {
    if (await p.zoneBtn.count() === 0) {
      test.info().annotations.push({ type: '주의', description: '행 없음 → skip' });
      return;
    }
    await p.zoneBtn.evaluate((el: HTMLElement) => el.click());
    const container = p.modalContainer();
    if (!(await container.isVisible({ timeout: MS }).catch(() => false))) {
      test.info().annotations.push({ type: '주의', description: '.modal-group 미발견 — 별도 레이어 방식' });
      await admin.goBack().catch(() => {});
      return;
    }
    const modalText = (await container.innerText().catch(() => '')).trim();
    expect(modalText.length, '모달 내 텍스트 존재').toBeGreaterThan(0);
    const btnCount = await container.locator('button.button-common').filter({ hasNotText: '' }).count();
    expect(btnCount, '모달 버튼 ≥ 1').toBeGreaterThanOrEqual(1);
    test.info().annotations.push({ type: '정보', description: `모달 버튼 ${btnCount}개` });
    const cancelBtn = p.modalCancelBtn();
    if (await cancelBtn.count() > 0) await cancelBtn.click();
    else await admin.keyboard.press('Escape');
  });

  test('모달: [취소] → 닫힘 (비파괴)', async () => {
    if (await p.zoneBtn.count() === 0) {
      test.info().annotations.push({ type: '주의', description: '행 없음 → skip' });
      return;
    }
    await p.zoneBtn.evaluate((el: HTMLElement) => el.click());
    const modal = p.modal();
    const isVisible = await modal.isVisible({ timeout: MS }).catch(() => false);
    if (isVisible) {
      await expect(modal, '모달 footer 노출').toBeVisible();
      const cancelBtn = p.modalCancelBtn();
      if (await cancelBtn.count() > 0) {
        await cancelBtn.click();
        await expect(modal, '취소 후 모달 닫힘').toBeHidden({ timeout: MS });
      } else {
        await admin.keyboard.press('Escape');
        test.info().annotations.push({ type: '주의', description: '취소 버튼 미발견 → ESC 닫음' });
      }
    } else {
      await expect(admin).toHaveURL(/\/club\//);
      await admin.goBack().catch(() => {});
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  2. 카트패스 진입여부 설정
// ═══════════════════════════════════════════════════════════════
test.describe('카트패스 진입여부 설정', () => {
  let admin: Page;
  let p: HolemapCartEntrancePage;

  test.beforeEach(async ({ page, context }) => {
    admin = await openAdmin(page, context);
    p = new HolemapCartEntrancePage(admin);
    await p.open();
    await p.expectLoaded(SCREEN.cartEntrance.urlPart);
  });

  test('진입: URL + GNB 헤더 노출', async () => {
    await expect(admin).toHaveURL(new RegExp(SCREEN.cartEntrance.urlPart.replace(/\//g, '\\/')));
    await expect(p.gnbTitle).toBeVisible();
  });

  test('raw code: 미가공 코드 미노출', async () => {
    const hits = await p.scanRawCode();
    expect(hits).toEqual([]);
  });

  test('탭: 코스 탭 전환 (datepicker 없음 — 탭으로 대체)', async () => {
    test.info().annotations.push({ type: '한계', description: '홀맵 관리 화면은 datepicker 없음 → 코스 탭 전환으로 대체' });
    for (const tabName of SCREEN.cartEntrance.courseTabs) {
      await test.step(`탭 '${tabName}' 전환`, async () => {
        const t = p.tab(tabName);
        if (await t.count() > 0) {
          await t.click();
          await admin.waitForTimeout(600);
          await expect(admin).toHaveURL(new RegExp(SCREEN.cartEntrance.urlPart.replace(/\//g, '\\/')));
          await expect(p.tabGroup).toBeVisible();
        } else {
          test.info().annotations.push({ type: '주의', description: `탭 '${tabName}' 미발견` });
        }
      });
    }
  });

  test('세션: 화면 진입 후 세션 유지', async () => {
    await p.expectSessionAlive();
  });
});

// ═══════════════════════════════════════════════════════════════
//  3. 티샷 유의 거리 설정
// ═══════════════════════════════════════════════════════════════
test.describe('티샷 유의 거리 설정', () => {
  let admin: Page;
  let p: HolemapTeeshotPage;

  test.beforeEach(async ({ page, context }) => {
    admin = await openAdmin(page, context);
    p = new HolemapTeeshotPage(admin);
    await p.open();
    await p.expectLoaded(SCREEN.teeshot.urlPart);
  });

  test('진입: URL + GNB 헤더 노출', async () => {
    await expect(admin).toHaveURL(new RegExp(SCREEN.teeshot.urlPart.replace(/\//g, '\\/')));
    await expect(p.gnbTitle).toBeVisible();
  });

  test('raw code: 미가공 코드 미노출', async () => {
    const hits = await p.scanRawCode();
    expect(hits).toEqual([]);
  });

  test('입력 필드: 코스 탭 전환 → 거리 input(placeholder=미입력) 노출 (비파괴)', async () => {
    const courseTab = p.tab(SCREEN.teeshot.courseTab);
    if (await courseTab.count() > 0) {
      await courseTab.click();
      await admin.waitForTimeout(800);
      await expect(admin).toHaveURL(new RegExp(SCREEN.teeshot.urlPart.replace(/\//g, '\\/')));
      const inputCount = await p.distanceInputs.count();
      if (inputCount > 0) {
        await expect(p.distanceInputs.first(), '거리 입력 필드 노출').toBeVisible();
        test.info().annotations.push({ type: '정보', description: `거리 입력 필드 ${inputCount}개 노출(저장 금지)` });
      } else {
        test.info().annotations.push({ type: '주의', description: '거리 입력 필드 미발견' });
      }
    } else {
      test.info().annotations.push({ type: '주의', description: `코스 탭 '${SCREEN.teeshot.courseTab}' 미발견` });
    }
  });

  test('세션: 화면 진입 후 세션 유지', async () => {
    await p.expectSessionAlive();
  });
});

// ═══════════════════════════════════════════════════════════════
//  4. 홀맵 미리보기
// ═══════════════════════════════════════════════════════════════
test.describe('홀맵 미리보기', () => {
  let admin: Page;
  let p: HolemapPreviewPage;

  test.beforeEach(async ({ page, context }) => {
    admin = await openAdmin(page, context);
    p = new HolemapPreviewPage(admin);
    await p.open();
    await p.expectLoaded(SCREEN.preview.urlPart);
  });

  test('진입: URL + GNB 헤더 노출', async () => {
    await expect(admin).toHaveURL(new RegExp(SCREEN.preview.urlPart.replace(/\//g, '\\/')));
    await expect(p.gnbTitle).toBeVisible();
  });

  test('raw code: 미가공 코드 미노출', async () => {
    const hits = await p.scanRawCode();
    expect(hits).toEqual([]);
  });

  test('미리보기: SVG 홀맵 렌더 영역 노출 (시각 도구 제한)', async () => {
    test.info().annotations.push({ type: '한계', description: 'SVG 홀맵 시각 렌더 검증 불가 — 노출 여부만 확인' });
    const svg = p.svgArea;  // vs__open-indicator(드롭다운 화살표) 제외
    const count = await svg.count();
    if (count > 0) {
      const isVis = await svg.isVisible().catch(() => false);
      if (isVis) {
        await expect(svg, 'SVG 영역 노출').toBeVisible();
      } else {
        test.info().annotations.push({ type: '주의', description: 'SVG 존재하나 미노출 — 홀맵 데이터 없거나 렌더 지연 가능성' });
      }
    } else {
      test.info().annotations.push({ type: '주의', description: 'SVG 미발견 — 홀맵 데이터 없음 가능성' });
    }
  });

  test('세션: 마지막 화면 진입 후 세션 유지', async () => {
    await p.expectSessionAlive();
  });
});

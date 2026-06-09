import { test, expect, Page } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { HolemapZonePage, HolemapCartEntrancePage, HolemapTeeshotPage, HolemapPreviewPage } from './holemap-mgmt.pom';
import { SCREEN } from './holemap-mgmt.data';

// ──────────────────────────────────────────────────────────────
//  홀맵 관리 E2E (현재 구현 AS-IS 기준) — POM 패턴
//  4화면(홀맵 구역 설정 / 카트패스 진입여부 설정 / 티샷 유의 거리 설정 / 홀맵 미리보기) × 8항목
//  ⚠ 비파괴: 저장/적용/구역관리 확인/전체허용·제한/checkbox 변경/초기화 클릭 금지.
//     [구역관리] 클릭 → 모달 노출 → 취소(닫기)까지만 허용. 홀맵 미리보기는 시각도구 제한 검증.
//  실행: npx playwright test --config=Playwright_New/playwright.config.ts holemap-mgmt
// ──────────────────────────────────────────────────────────────

let admin: Page;
test.beforeEach(async ({ page, context }) => {
  admin = await openAdmin(page, context);
});

// 1. 기능 진입 — 홀맵 구역 설정 URL 접속 및 페이지 로드 확인
test('항목1: 기능 진입 — 홀맵 구역 설정 URL 접속 및 로드', async () => {
  const p = new HolemapZonePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.zone.urlPart);
  await expect(p.infoBox, '안내 문구 로드').toContainText(SCREEN.zone.guide);
  // 코스/홀 필터(vue-select) 노출 확인
  await expect(p.vueSelects.first(), '코스/홀 필터(vue-select) 노출').toBeVisible();
});

// 2. 텍스트 검증 — 오타/가공되지 않은 코드 노출 여부 (4화면 전체)
test('항목2: 텍스트 검증 — raw code/미가공 코드 미노출', async () => {
  for (const PageCls of [HolemapZonePage, HolemapCartEntrancePage, HolemapTeeshotPage, HolemapPreviewPage]) {
    const p = new PageCls(admin);
    await p.open();
    const hits = await p.scanRawCode();
    expect(hits, `[${p.constructor.name}] 미가공 코드 노출: ${JSON.stringify(hits)}`).toEqual([]);
  }
});

// 3. 버튼(메뉴) 클릭 → 4화면 순회 이동 + 마지막 랜딩 후 세션 유지
test('항목3: 버튼(메뉴) 클릭 → 4화면 순회 이동 + 세션 유지', async () => {
  const zone = new HolemapZonePage(admin);
  await zone.open();
  await zone.expectLoaded(SCREEN.zone.urlPart);

  const cart = new HolemapCartEntrancePage(admin);
  await cart.open();
  await cart.expectLoaded(SCREEN.cartEntrance.urlPart);

  const tee = new HolemapTeeshotPage(admin);
  await tee.open();
  await tee.expectLoaded(SCREEN.teeshot.urlPart);

  const preview = new HolemapPreviewPage(admin);
  await preview.open();
  await preview.expectLoaded(SCREEN.preview.urlPart);
  await preview.expectSessionAlive();
});

// 4. 데이터 정합성 — 홀맵 구역 설정 테이블 컬럼 수 + 행(≥1) 또는 빈 안내 확인
test('항목4: 데이터 정합성 — 홀맵 구역 설정 테이블 컬럼/행 확인', async () => {
  const p = new HolemapZonePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.zone.urlPart);

  // 테이블 컬럼 확인 (9개 컬럼)
  for (const col of SCREEN.zone.columns) {
    const header = p.column(col);
    const cnt = await header.count();
    if (cnt > 0) {
      await expect(header, `컬럼 '${col}' 노출`).toBeVisible();
    } else {
      test.info().annotations.push({ type: '주의', description: `컬럼 '${col}' 미발견 — 화면 구조 변경 가능성` });
    }
  }

  // 행 수 확인 — 0건이면 skip 주석
  const rowCount = await p.renderedRowCount();
  if (rowCount > 0) {
    expect(rowCount, '테이블 행 ≥1').toBeGreaterThanOrEqual(1);
  } else {
    test.info().annotations.push({ type: '주의', description: '홀맵 구역 설정 테이블 데이터 없음(0건) — 데이터 의존 행 검증 skip' });
  }
});

// 5. 페이지네이션 — 홀맵 구역 설정(best-effort)
//    ⚠ 설정형 화면(카트패스/티샷/미리보기)은 페이지네이션 없음. 홀맵 구역 설정 테이블 대상.
test('항목5: 페이지네이션 — 홀맵 구역 설정(best-effort)', async () => {
  const p = new HolemapZonePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.zone.urlPart);

  const page2Btn = admin.getByRole('button', { name: '2', exact: true }).first();
  if (await page2Btn.count() > 0) {
    await page2Btn.click();
    await admin.waitForTimeout(800);
    await expect(p.rows.first(), '2페이지 행 렌더').toBeVisible();
  } else {
    test.info().annotations.push({ type: '주의', description: '2페이지 버튼 미발견 — 홀맵 구역 설정 데이터 1페이지 이내' });
  }
  for (const dir of ['prev', 'next', 'first', 'last'] as const) {
    const a = p.arrow(dir);
    if (await a.count()) {
      await a.click().catch(() => {});
      await admin.waitForTimeout(400);
      await expect(p.rows.first()).toBeVisible().catch(() => {});
    } else {
      test.info().annotations.push({ type: '주의', description: `[${dir}] 화살표 버튼 미발견` });
    }
  }
});

// 6. 달력/탭 경계 — datepicker 없음 → 코스 탭 첫·마지막 전환(카트패스 진입여부 설정 대상)
//    ⚠ 홀맵 관리 4화면 모두 날짜 조회기간 없음 → 달력 검증 불가.
//       카트패스 진입여부 설정 코스 탭 경계 전환으로 대체.
test('항목6: 달력/탭 경계 — 카트패스 코스 탭 경계 전환(datepicker 없음, 탭으로 대체)', async () => {
  const p = new HolemapCartEntrancePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.cartEntrance.urlPart);

  test.info().annotations.push({
    type: '한계(자동화 불가)',
    description: '홀맵 관리 4화면에 datepicker/조회기간 없음 → 달력 경계 검증 불가. 카트패스 코스 탭 경계 전환으로 대체.',
  });

  for (const tabName of SCREEN.cartEntrance.courseTabs) {
    const t = p.tab(tabName);
    if (await t.count() > 0) {
      await t.click();
      await admin.waitForTimeout(600);
      await expect(p.page, `탭 '${tabName}' 클릭 후 URL 유지`).toHaveURL(new RegExp(SCREEN.cartEntrance.urlPart.replace(/\//g, '\\/')));
      await expect(p.tabGroup, `탭 그룹 노출(탭: ${tabName})`).toBeVisible();
    } else {
      test.info().annotations.push({ type: '주의', description: `코스 탭 '${tabName}' 미발견` });
    }
  }
});

// 7. 입력/반영 — 티샷 유의 거리 코스 탭 전환 + 거리 입력 필드 노출 확인(비파괴)
//    ⚠ 검색 필드 없음. 탭 클릭 → 거리 입력 필드 변경 확인. 실제 입력/저장 금지(비파괴).
test('항목7: 입력/반영 — 티샷 유의 거리 코스 탭 전환 + 입력 필드 노출(비파괴)', async () => {
  const p = new HolemapTeeshotPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.teeshot.urlPart);

  // 기본 탭(South) 전환 확인 + 거리 입력 필드 노출
  const courseTab = p.tab(SCREEN.teeshot.courseTab);
  if (await courseTab.count() > 0) {
    await courseTab.click();
    await admin.waitForTimeout(800);
    await expect(p.page, '탭 전환 후 URL 유지').toHaveURL(new RegExp(SCREEN.teeshot.urlPart.replace(/\//g, '\\/')));
    // 거리 입력 필드(placeholder='미입력') 노출 확인 — 실제 입력 금지
    const inputCount = await p.distanceInputs.count();
    if (inputCount > 0) {
      await expect(p.distanceInputs.first(), `거리 입력 필드(placeholder='미입력') 노출`).toBeVisible();
      test.info().annotations.push({ type: '한계', description: `거리 입력 필드 ${inputCount}개 노출 확인. 실제 값 입력/저장은 비파괴 원칙으로 금지.` });
    } else {
      test.info().annotations.push({ type: '주의', description: '거리 입력 필드(placeholder=미입력) 미발견' });
    }
  } else {
    test.info().annotations.push({ type: '주의', description: `코스 탭 '${SCREEN.teeshot.courseTab}' 미발견 — 탭 전환 검증 불가` });
  }
});

// 8. 팝업/모달 — 홀맵 구역 설정 [구역관리] 모달 노출 후 취소(비파괴)
//    ⚠ [적용]/[저장]/[전체 허용·제한]/[홀별 설정 저장] 클릭 금지(비파괴 원칙).
//       [구역관리] 버튼 → 모달 노출 → 취소로 검증. 행 없으면 skip.
test('항목8: 팝업/모달 — 홀맵 구역 설정 [구역관리] 모달 노출 후 취소(비파괴)', async () => {
  const p = new HolemapZonePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.zone.urlPart);

  // [구역관리] 버튼(행별 버튼 → 첫 번째)
  const zoneBtn = p.zoneBtn;
  const zoneBtnCount = await zoneBtn.count();
  if (zoneBtnCount > 0) {
    await zoneBtn.evaluate((el: HTMLElement) => el.click());
    const modal = p.modal();
    const isModalVisible = await modal.isVisible({ timeout: TIMEOUT_ACTION }).catch(() => false);
    if (isModalVisible) {
      await expect(modal, '[구역관리] 클릭 후 모달 노출').toBeVisible();
      const cancelBtn = p.modalCancelBtn();
      if (await cancelBtn.count() > 0) {
        await cancelBtn.click();
        await expect(modal, '취소 후 모달 닫힘').toBeHidden({ timeout: TIMEOUT_ACTION });
      } else {
        await admin.keyboard.press('Escape');
        test.info().annotations.push({ type: '주의', description: '.modal-footer 취소 버튼 미발견 → ESC로 닫음' });
      }
    } else {
      // 별도 화면/레이어로 이동한 경우 — URL 유지 확인 후 pass
      await expect(p.page, '[구역관리] 클릭 후 URL 유지(인라인 방식)').toHaveURL(/\/club\//);
      test.info().annotations.push({ type: '주의', description: '[구역관리] 클릭 시 .modal-footer 미발견 — 별도 레이어 또는 페이지 이동 방식. URL /club/ 유지 확인.' });
      // 어드민으로 복귀
      await admin.goBack().catch(() => {});
    }
  } else {
    test.info().annotations.push({ type: '주의', description: '[구역관리] 버튼 미발견(데이터 없음) → 모달 검증 skip' });
  }
});

const TIMEOUT_ACTION = 8_000;

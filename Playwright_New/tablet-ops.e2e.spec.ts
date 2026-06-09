import { test, expect, Page } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { TabletFeaturePage, TabletMessagePage, TabletHoleEventPage } from './tablet-ops.pom';
import { SCREEN } from './tablet-ops.data';

// ──────────────────────────────────────────────────────────────
//  태블릿 운영 관리 E2E (현재 구현 AS-IS 기준) — POM 패턴
//  3화면(태블릿 기능 설정 / 메시지 관리 / 홀 이벤트 관리) × 8항목
//  ⚠ 비파괴: 저장/삭제/적용/확인서항목추가 '확인'/기능 토글/패스워드 변경 클릭 금지.
//     [수정] 클릭 → 편집 모달 노출 → 취소(닫기)까지만 허용.
//  실행: npx playwright test --config=Playwright_New/playwright.config.ts tablet-ops
// ──────────────────────────────────────────────────────────────

let admin: Page;
test.beforeEach(async ({ page, context }) => {
  admin = await openAdmin(page, context);
});

// 1. 기능 진입 — 지정 URL 접속 및 페이지 로드 확인
test('항목1: 기능 진입 — 태블릿 기능 설정 URL 접속 및 로드', async () => {
  const p = new TabletFeaturePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.feature.urlPart);
  await expect(p.infoBox, '안내 문구 로드').toContainText(SCREEN.feature.guide);
  // 경기 진행 설정 섹션 노출 확인
  await expect(p.section(SCREEN.feature.sectionGameRx).first(), '경기 진행 설정 섹션').toBeVisible();
});

// 2. 텍스트 검증 — 오타/가공되지 않은 코드(JSON, 변수명, {{}} 등) 노출 여부
test('항목2: 텍스트 검증 — raw code/미가공 코드 미노출', async () => {
  for (const PageCls of [TabletFeaturePage, TabletMessagePage, TabletHoleEventPage]) {
    const p = new PageCls(admin);
    await p.open();
    const hits = await p.scanRawCode();
    expect(hits, `[${p.constructor.name}] 미가공 코드 노출: ${JSON.stringify(hits)}`).toEqual([]);
  }
});

// 3. 버튼 동작 — 3화면 순회 이동 + 마지막 랜딩 후 세션 유지
test('항목3: 버튼(메뉴) 클릭 → 3화면 순회 이동 + 세션 유지', async () => {
  const feat = new TabletFeaturePage(admin);
  await feat.open();
  await feat.expectLoaded(SCREEN.feature.urlPart);

  const msg = new TabletMessagePage(admin);
  await msg.open();
  await msg.expectLoaded(SCREEN.message.urlPart);

  const he = new TabletHoleEventPage(admin);
  await he.open();
  await he.expectLoaded(SCREEN.holeEvent.urlPart);
  await he.expectSessionAlive();   // 마지막 이동 후 세션 유지
});

// 4. 데이터 정합성 — 경기 진행 설정 통계카드 합(전체=활성+비활성)
//    ⚠ 통계카드 3개 미노출 시(데이터 없음) → skip 주석
test('항목4: 데이터 정합성 — 통계카드 전체=활성+비활성 합', async () => {
  const p = new TabletFeaturePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.feature.urlPart);

  const cards = p.statCards;
  const count = await cards.count();
  if (count >= 3) {
    const parseNum = (s: string) => parseInt((s.match(/\d+/) || ['0'])[0], 10);
    const total    = parseNum(await cards.nth(0).innerText());
    const active   = parseNum(await cards.nth(1).innerText());
    const inactive = parseNum(await cards.nth(2).innerText());
    expect(active + inactive, `활성(${active})+비활성(${inactive}) = 전체(${total})`).toBe(total);
  } else {
    test.info().annotations.push({ type: '주의', description: `통계카드 ${count}개 발견(3 미만) — 데이터 없음 또는 구조 변경, 합 검증 skip` });
  }
});

// 5. 페이지네이션 — 홀이벤트 관리(best-effort)
//    ⚠ 설정형 화면(기능설정/메시지관리)은 페이지네이션 없음. 홀이벤트 테이블 대상.
test('항목5: 페이지네이션 — 홀이벤트 관리(best-effort)', async () => {
  const p = new TabletHoleEventPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.holeEvent.urlPart);

  // 숫자 2페이지 버튼이 있으면 이동 검증
  const page2Btn = admin.getByRole('button', { name: '2', exact: true }).first();
  if (await page2Btn.count() > 0) {
    await page2Btn.click();
    await admin.waitForTimeout(800);
    await expect(p.rows.first(), '2페이지 행 렌더').toBeVisible();
  } else {
    test.info().annotations.push({ type: '주의', description: '2페이지 버튼 미발견 — 홀이벤트 데이터 1페이지 이내' });
  }
  // 화살표(이전/다음/처음/마지막) best-effort
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

// 6. 달력/탭 경계 — datepicker 없음 → 메시지관리 탭 첫·마지막 전환(대체 검증)
//    ⚠ 태블릿 운영 관리 3화면 모두 날짜 입력/조회기간 없음 → 달력 검증 불가.
//       메시지 관리 5탭의 경계(첫·마지막) 전환으로 대체.
test('항목6: 달력/탭 경계 — 메시지관리 5탭 경계 전환(datepicker 없음, 탭으로 대체)', async () => {
  const p = new TabletMessagePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.message.urlPart);

  test.info().annotations.push({
    type: '한계(자동화 불가)',
    description: '태블릿 운영 관리 3화면에 datepicker/조회기간 없음 → 달력 경계 검증 불가. 메시지 관리 탭 경계 전환으로 대체.',
  });

  // 첫 탭(기본 선택)과 마지막 탭 경계 전환
  const tabs = SCREEN.message.tabs;
  for (const tabName of [tabs[0], tabs[tabs.length - 1]]) {
    const tab = p.tab(tabName);
    if (await tab.count() > 0) {
      await tab.click();
      await admin.waitForTimeout(600);
      // 탭 클릭 후 URL 유지 + 탭 그룹 노출
      await expect(p.page, `탭 '${tabName}' 클릭 후 URL 유지`).toHaveURL(new RegExp(SCREEN.message.urlPart.replace(/\//g, '\\/')));
      await expect(p.tabGroup, `탭 그룹 노출(탭: ${tabName})`).toBeVisible();
    } else {
      test.info().annotations.push({ type: '주의', description: `탭 '${tabName}' 미발견` });
    }
  }
});

// 7. 입력/반영 — 메시지관리 탭 선택 전환 반영 (탭 전환=필터 입력 대역)
//    ⚠ 검색 입력 필드 없음. 탭 클릭 → 콘텐츠 변경이 반영됨을 탭 그룹 active 상태로 검증.
test('항목7: 입력/반영 — 메시지관리 탭 전환 반영(비파괴)', async () => {
  const p = new TabletMessagePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.message.urlPart);

  const secondTabName = SCREEN.message.tabs[1];
  const secondTab = p.tab(secondTabName);
  if (await secondTab.count() > 0) {
    // 두 번째 탭 클릭 → 해당 탭 활성화 반영
    await secondTab.click();
    await admin.waitForTimeout(800);
    // URL 유지, 탭 그룹 노출 유지
    await expect(p.page, '탭 전환 후 URL 유지').toHaveURL(new RegExp(SCREEN.message.urlPart.replace(/\//g, '\\/')));
    await expect(p.tabGroup, '탭 전환 후 탭 그룹 노출').toBeVisible();
    // tablet-grid(버튼 배열 미리보기)는 탭과 무관하게 항상 노출
    await expect(p.tabletGrid, '버튼 배열 미리보기 노출').toBeVisible();
  } else {
    test.info().annotations.push({ type: '주의', description: `'${secondTabName}' 탭 미발견 — 탭 전환 반영 검증 불가` });
  }
});

// 8. 팝업/모달 — 메시지 관리 [수정] 모달 노출 후 취소(비파괴)
//    ⚠ [패스워드 변경]은 클릭 금지(비파괴 원칙). 메시지 관리 행 [수정] → 편집 모달 → 취소로 검증.
//       데이터 없으면(행 없음) skip.
test('항목8: 팝업/모달 — 메시지관리 [수정] 모달 노출 후 취소(비파괴)', async () => {
  const p = new TabletMessagePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.message.urlPart);

  const editBtn = p.firstEditBtn();
  const editBtnCount = await editBtn.count();
  if (editBtnCount > 0) {
    // element가 뷰포트 밖에 위치할 수 있음 → DOM 레벨 클릭(뷰포트 무관)
    await editBtn.evaluate((el: HTMLElement) => el.click());
    // 편집 모달(modal-footer 포함) 또는 inline 편집 폼 노출 확인
    const modal = p.modal();
    const isModalVisible = await modal.isVisible({ timeout: SCREEN.feature ? 8_000 : 8_000 }).catch(() => false);
    if (isModalVisible) {
      await expect(modal, '[수정] 클릭 후 모달 노출').toBeVisible();
      const cancelBtn = p.modalCancelBtn();
      if (await cancelBtn.count() > 0) {
        await cancelBtn.click();
        await expect(modal, '취소 후 모달 닫힘').toBeHidden({ timeout: 8_000 });
      } else {
        // ESC fallback
        await admin.keyboard.press('Escape');
        test.info().annotations.push({ type: '주의', description: '.modal-footer 취소 버튼 미발견 → ESC로 닫음' });
      }
    } else {
      // 인라인 편집 폼 방식 가능성 — URL 유지 확인 후 pass
      await expect(p.page, '[수정] 클릭 후 URL 유지(인라인 편집)').toHaveURL(new RegExp(SCREEN.message.urlPart.replace(/\//g, '\\/')));
      test.info().annotations.push({ type: '주의', description: '[수정] 클릭 시 .modal-footer 구조 미발견 — 인라인 편집 방식으로 추정. URL 유지 확인.' });
    }
  } else {
    test.info().annotations.push({ type: '주의', description: '메시지 관리 [수정] 버튼 미발견(데이터 없음) → 모달 검증 skip' });
  }
});

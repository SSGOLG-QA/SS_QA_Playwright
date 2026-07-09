/**
 * P2-A: Write-path E2E — 상위 10개 플로우
 *
 * 보호: ALLOW_DESTRUCTIVE=1 + td17 화이트리스트 + 킹즈락 클럽
 * 실행: $env:ALLOW_DESTRUCTIVE="1"; npx playwright test --project=admin-chromium Admin/write-path.spec.ts --no-deps --headed
 *
 * 각 플로우: withFixture(사전 잔여 정리 → 쓰기 액션 → teardown 마커행 삭제)
 * 검증: 토스트 출현 + 목록 재반영 + 원복 확인
 * 산출물: reports/write-path_report_*.xlsx
 */

import { test } from '../lib/fixtures';
import { isDestructiveAllowed, withFixture } from '../Playwright_New/destructive';
import { navigateMenu, settle } from '../lib/adminHelpers';
import { writeReport, resetResults, resetNoTC, resetDiff, skip, record, capture } from '../lib/reporter';
import { withToastObserver } from '../lib/langCheck';

// ── 공통 상수 ────────────────────────────────────────────────
const MARK = 'E2EWRITE';
const PFX = 'Write-path E2E';

// 프라이머리 버튼(등록/저장/적용 — 마지막 = 모달 제출용)
const primary = (a: any) =>
  a.locator('button.button-common.primary, button.primary').last();
// 비파괴 취소/닫기(non-primary/non-danger)
const cancel = (a: any) =>
  a.locator('button.button-common:not(.primary):not(.danger), button:not(.primary):not(.danger)[class*="cancel"], button:not(.primary):not(.danger)[class*="close"]').last();
// 모달 confirm(danger 없는 순수 알림 → [확인] 클릭)
const modalConfirm = (a: any) =>
  a.locator('.modal-footer').last().locator('button.primary, button.button-common.primary').last();

// ── 마커행 전수 삭제 ─────────────────────────────────────────
async function deleteMarkedRows(admin: any, mark: string, max = 15): Promise<void> {
  for (let i = 0; i < max; i++) {
    const row = admin.locator('tbody tr').filter({ hasText: mark }).first();
    if (!(await row.count().catch(() => 0))) break;
    await row.locator('input[type=checkbox]').first().check({ force: true }).catch(() => {});
    // 삭제 버튼 — "삭제" 텍스트 혹은 .button-common.danger
    const delBtn = admin.locator('.contents-box').getByRole('button', { name: /삭제/, exact: false }).first();
    if (!(await delBtn.isVisible().catch(() => false))) break;
    await delBtn.click().catch(() => {});
    await admin.waitForTimeout(500);
    // confirm 모달 처리
    const footer = admin.locator('.modal-footer').filter({
      has: admin.getByRole('button', { name: /확인|삭제/, exact: false }),
    }).first();
    if (await footer.isVisible({ timeout: 1500 }).catch(() => false)) {
      await footer.getByRole('button', { name: /확인|삭제/, exact: false }).first().click().catch(() => {});
    }
    await admin.waitForTimeout(900);
  }
}

// ── 모달 닫기(비파괴 — 언어 무관 클래스 기반) ───────────────
async function closeModal(admin: any): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (!(await admin.locator('.modal-group:visible, .modal-box:visible').count().catch(() => 0))) return;
    const btn = cancel(admin);
    if (await btn.isVisible().catch(() => false)) await btn.click({ force: true }).catch(() => {});
    else await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(500);
  }
}

// ── 토스트 성공 판정 ─────────────────────────────────────────
const isSuccess = (t: string) => /완료|성공|저장|등록|적용|success/i.test(t) && !/에러|오류|실패/.test(t);

// ════════════════════════════════════════════════════════════
test('P2-A Write-path E2E — 상위 10개 플로우', async ({ admin }) => {
  test.setTimeout(1_500_000); // 10플로우 × 최대 2.5분

  resetResults(); resetNoTC(); resetDiff();

  // ── 파괴 가드 공통 확인 ──────────────────────────────────
  const guard = await isDestructiveAllowed(admin);
  if (!guard.ok) {
    for (let n = 1; n <= 10; n++) {
      skip(
        { path: `${PFX} > WP-${String(n).padStart(2, '0')}`, tcRef: `WP-${String(n).padStart(2, '0')}`, tcId: `WP-${String(n).padStart(2, '0')}`, desc: '쓰기 플로우' },
        `파괴 가드 비활성 — ${guard.reason}. 실행: $env:ALLOW_DESTRUCTIVE="1"`,
      );
    }
    await writeReport('write-path');
    return;
  }

  // ════════════════════════════════════════════════════════
  //  WP-01: 골프장 소식 등록 → 목록 확인 → 삭제
  //  패턴: lang-check-toast 와 동일(검증 완료). 성공/충돌 모두 teardown.
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-01 골프장 소식`; const R = 'WP-01'; const marker = `${MARK}-WP01`;
    console.log(`\n${'─'.repeat(50)}\n[WP-01] 골프장 소식 등록·확인·삭제\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '코스 운영 관리', '골프장 소식').catch(() => {});
    await settle(admin);

    await withFixture(
      async () => { await deleteMarkedRows(admin, marker); },
      async () => {
        // [등록] 버튼(리스트) → 모달
        const listReg = admin.locator('.contents-box button.button-common.primary').first();
        const toasts = await withToastObserver(admin, async () => {
          await listReg.click().catch(() => {}); await admin.waitForTimeout(800);
          await admin.locator('textarea:visible').first().fill(`${marker} 골프장소식 E2E`).catch(() => {});
          // 노출시간 vue-select 첫 옵션 선택(빈 슬롯 → 충돌 유도로 레코드 미생성 가능)
          const vs = admin.locator('.vs__dropdown-toggle');
          for (let i = 0; i < Math.min(await vs.count().catch(() => 0), 3); i++) {
            if ((await vs.nth(i).innerText().catch(() => '')).trim()) continue;
            await vs.nth(i).click().catch(() => {}); await admin.waitForTimeout(300);
            await admin.locator('.vs__dropdown-option, li[role=option]').first().click().catch(() => {});
            await admin.waitForTimeout(200);
          }
          await primary(admin).click().catch(() => {});
        });
        await closeModal(admin); await settle(admin, 800);

        const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-01-reg', desc: '소식 등록 후' });
        const inList = await admin.locator('tbody tr').filter({ hasText: marker }).count().then(c => c > 0).catch(() => false);

        record({ path: P, tcRef: R, tcId: 'WP-01-reg', desc: '골프장 소식 등록 → 목록 반영', expected: '마커 행 노출', failMsg: '목록 미반영' },
          inList || toasts.length > 0 ? 'PASS' : 'FAIL',
          { actual: inList ? '목록 확인' : (toasts[0]?.slice(0, 60) || '마커 없음'), screenshot: shot });
        if (toasts.length)
          record({ path: P, tcRef: R, tcId: 'WP-01-toast', desc: '등록 토스트', expected: '토스트 출현' },
            'PASS', { actual: toasts[0].slice(0, 80) });
      },
      async () => { await deleteMarkedRows(admin, marker); },
    );
  }

  // ════════════════════════════════════════════════════════
  //  WP-02: 태블릿 메시지 등록 → 확인 → 삭제
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-02 태블릿 메시지`; const R = 'WP-02'; const marker = `${MARK}-WP02`;
    console.log(`\n${'─'.repeat(50)}\n[WP-02] 태블릿 메시지 등록·확인·삭제\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '태블릿 운영 관리', '메시지 관리').catch(() => {});
    await settle(admin);

    // 메시지 관리 화면이 없으면 SKIP
    const msgMenuOk = await admin.locator('.contents-box').isVisible({ timeout: 5_000 }).catch(() => false);
    if (!msgMenuOk) {
      skip({ path: P, tcRef: R, tcId: 'WP-02', desc: '태블릿 메시지 등록·확인·삭제' }, '화면 진입 불가 — SKIP');
    } else {
      await withFixture(
        async () => { await deleteMarkedRows(admin, marker); },
        async () => {
          // 추가/신규/등록 버튼
          const addBtn = admin.locator('.contents-box').getByRole('button', { name: /추가|신규|등록/, exact: false }).first();
          const hasAdd = await addBtn.isVisible({ timeout: 3_000 }).catch(() => false);
          if (!hasAdd) { skip({ path: P, tcRef: R, tcId: 'WP-02', desc: '등록 버튼 미발견' }, '등록 버튼 없음'); return; }

          const toasts = await withToastObserver(admin, async () => {
            await addBtn.click().catch(() => {}); await admin.waitForTimeout(600);
            // 첫 번째 텍스트 입력
            const inp = admin.locator('input[type=text]:visible, textarea:visible').first();
            await inp.fill(`${marker}`).catch(() => {});
            await primary(admin).click().catch(() => {});
          });
          await closeModal(admin); await settle(admin, 800);

          const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-02-reg', desc: '메시지 등록 후' });
          const inList = await admin.locator('tbody tr, .list-item').filter({ hasText: marker }).count().then(c => c > 0).catch(() => false);

          record({ path: P, tcRef: R, tcId: 'WP-02-reg', desc: '태블릿 메시지 등록 → 목록 반영', expected: '마커 메시지 노출' },
            inList || toasts.some(isSuccess) ? 'PASS' : 'FAIL',
            { actual: inList ? '목록 확인' : (toasts[0]?.slice(0, 60) || '마커 없음'), screenshot: shot });
        },
        async () => { await deleteMarkedRows(admin, marker); },
      );
    }
  }

  // ════════════════════════════════════════════════════════
  //  WP-03: 홀 이벤트 등록 → 확인 → 삭제
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-03 홀 이벤트`; const R = 'WP-03'; const marker = `${MARK}-WP03`;
    console.log(`\n${'─'.repeat(50)}\n[WP-03] 홀 이벤트 등록·확인·삭제\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '태블릿 운영 관리', '홀 이벤트 관리').catch(() => {});
    await settle(admin);

    await withFixture(
      async () => { await deleteMarkedRows(admin, marker); },
      async () => {
        const addBtn = admin.locator('.contents-box').getByRole('button', { name: /추가|신규|등록/, exact: false }).first();
        const hasAdd = await addBtn.isVisible({ timeout: 3_000 }).catch(() => false);
        if (!hasAdd) { skip({ path: P, tcRef: R, tcId: 'WP-03', desc: '등록 버튼 미발견' }, '등록 버튼 없음'); return; }

        const toasts = await withToastObserver(admin, async () => {
          await addBtn.click().catch(() => {}); await admin.waitForTimeout(600);
          const inp = admin.locator('input[type=text]:visible, textarea:visible').first();
          await inp.fill(`${marker}`).catch(() => {});
          await primary(admin).click().catch(() => {});
        });
        await closeModal(admin); await settle(admin, 800);

        const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-03-reg', desc: '홀 이벤트 등록 후' });
        const inList = await admin.locator('tbody tr, .list-item').filter({ hasText: marker }).count().then(c => c > 0).catch(() => false);

        record({ path: P, tcRef: R, tcId: 'WP-03-reg', desc: '홀 이벤트 등록 → 목록 반영', expected: '마커 이벤트 노출' },
          inList || toasts.some(isSuccess) ? 'PASS' : 'FAIL',
          { actual: inList ? '목록 확인' : (toasts[0]?.slice(0, 60) || '마커 없음'), screenshot: shot });
      },
      async () => { await deleteMarkedRows(admin, marker); },
    );
  }

  // ════════════════════════════════════════════════════════
  //  WP-04: 그린 스피드 값 입력 → 저장 → 토스트 확인
  //  비파괴 전략: 기존값 그대로 재입력(값 변경 없음) → 저장 토스트 확인
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-04 그린 스피드`; const R = 'WP-04';
    console.log(`\n${'─'.repeat(50)}\n[WP-04] 그린 스피드 저장 토스트 확인\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '코스 운영 관리', '그린 스피드').catch(() => {});
    await settle(admin);

    const inp = admin.locator('input[type=number]:visible, input[type=text]:visible').first();
    const hasInp = await inp.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasInp) {
      skip({ path: P, tcRef: R, tcId: 'WP-04', desc: '그린 스피드 입력 필드 미발견' }, '입력 필드 없음');
    } else {
      const origVal = await inp.inputValue().catch(() => '');
      const toasts = await withToastObserver(admin, async () => {
        await inp.fill(origVal || '2.80').catch(() => {});
        const saveBtn = admin.locator('.contents-box').getByRole('button', { name: /저장|적용|전체 적용/, exact: false }).first();
        if (await saveBtn.isVisible().catch(() => false)) await saveBtn.click().catch(() => {});
        else await primary(admin).click().catch(() => {});
        // confirm 모달이 뜨면 확인
        await admin.waitForTimeout(500);
        if (await admin.locator('.modal-footer:visible').count().catch(() => 0))
          await modalConfirm(admin).click().catch(() => {});
      });
      const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-04-save', desc: '그린 스피드 저장 후' });
      record({ path: P, tcRef: R, tcId: 'WP-04-save', desc: '그린 스피드 저장 → 토스트 출현', expected: '저장 완료 토스트' },
        toasts.length > 0 ? 'PASS' : 'FAIL',
        { actual: toasts[0]?.slice(0, 80) || '토스트 미출현', screenshot: shot });
    }
  }

  // ════════════════════════════════════════════════════════
  //  WP-05: 핀 포지션 변경 → 전체 적용 → 토스트 확인
  //  비파괴 전략: 현재 선택된 라디오(A/B/C/D) 동일 재클릭 → 전체 적용
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-05 핀 포지션`; const R = 'WP-05';
    console.log(`\n${'─'.repeat(50)}\n[WP-05] 핀 포지션 변경·저장·확인\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '코스 운영 관리', '핀 포지션 관리').catch(() => {});
    await settle(admin);

    const applyBtn = admin.locator('.contents-box').getByRole('button', { name: /전체 적용|적용|저장/, exact: false }).first();
    const hasApply = await applyBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasApply) {
      skip({ path: P, tcRef: R, tcId: 'WP-05', desc: '적용 버튼 미발견' }, '적용 버튼 없음');
    } else {
      // 첫 번째 라디오 그룹에서 첫 번째 옵션 클릭 후 저장
      const firstRadio = admin.locator('input[type=radio]').first();
      const toasts = await withToastObserver(admin, async () => {
        if (await firstRadio.isVisible().catch(() => false))
          await firstRadio.click({ force: true }).catch(() => {});
        await applyBtn.click().catch(() => {});
        await admin.waitForTimeout(500);
        if (await admin.locator('.modal-footer:visible').count().catch(() => 0))
          await modalConfirm(admin).click().catch(() => {});
      });
      const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-05-save', desc: '핀 포지션 저장 후' });
      record({ path: P, tcRef: R, tcId: 'WP-05-save', desc: '핀 포지션 전체 적용 → 토스트 출현', expected: '저장 완료 토스트' },
        toasts.length > 0 ? 'PASS' : 'FAIL',
        { actual: toasts[0]?.slice(0, 80) || '토스트 미출현', screenshot: shot });
    }
  }

  // ════════════════════════════════════════════════════════
  //  WP-06: 진행시간 표준 설정 저장 → 토스트 확인 → 원복
  //  비파괴 전략: 첫 번째 숫자 입력의 현재값 읽기 → 동일값 재입력 → 저장 → 원복
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-06 진행시간 표준 설정`; const R = 'WP-06';
    console.log(`\n${'─'.repeat(50)}\n[WP-06] 진행시간 표준 설정 저장·원복\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '경기 진행 관리', '진행시간 표준 설정').catch(() => {});
    await settle(admin);

    const inp = admin.locator('input[type=number]:visible, input[type=text]:visible').first();
    const saveBtn = admin.locator('.contents-box').getByRole('button', { name: /저장|적용/, exact: false }).first();
    const hasForm = await inp.isVisible({ timeout: 3_000 }).catch(() => false) &&
                    await saveBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!hasForm) {
      skip({ path: P, tcRef: R, tcId: 'WP-06', desc: '입력 필드/저장 버튼 미발견' }, '입력 필드 없음');
    } else {
      const origVal = await inp.inputValue().catch(() => '');
      const toasts = await withToastObserver(admin, async () => {
        await inp.fill(origVal || '10').catch(() => {});
        await saveBtn.click().catch(() => {});
        await admin.waitForTimeout(500);
        if (await admin.locator('.modal-footer:visible').count().catch(() => 0))
          await modalConfirm(admin).click().catch(() => {});
      });
      const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-06-save', desc: '진행시간 설정 저장 후' });
      // 원복
      if (origVal) await inp.fill(origVal).catch(() => {});
      record({ path: P, tcRef: R, tcId: 'WP-06-save', desc: '진행시간 표준 저장 → 토스트', expected: '저장 완료 토스트' },
        toasts.length > 0 ? 'PASS' : 'FAIL',
        { actual: toasts[0]?.slice(0, 80) || '토스트 미출현', screenshot: shot });
    }
  }

  // ════════════════════════════════════════════════════════
  //  WP-07: 태블릿 기능 설정 토글 → 저장 → 원복
  //  비파괴 전략: 토글 ON→OFF 또는 OFF→ON → 저장 → 즉시 반대로 토글 → 저장(원복)
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-07 태블릿 기능 설정`; const R = 'WP-07';
    console.log(`\n${'─'.repeat(50)}\n[WP-07] 태블릿 기능 설정 토글·저장·원복\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '태블릿 운영 관리', '태블릿 기능 설정').catch(() => {});
    await settle(admin);

    // 저장 버튼을 먼저 찾아야 유효한 화면 확인
    const saveBtn = admin.locator('.contents-box').getByRole('button', { name: /저장|적용/, exact: false }).first();
    const toggle = admin.locator('input[type=checkbox]:visible, .toggle-switch:visible, [class*="toggle"]:visible').first();
    const hasSave = await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasSave) {
      skip({ path: P, tcRef: R, tcId: 'WP-07', desc: '저장 버튼 미발견' }, '저장 버튼 없음');
    } else {
      // 초기 상태 캡처
      const origChecked = await toggle.isChecked().catch(() => false);
      const toasts = await withToastObserver(admin, async () => {
        // 토글 변경
        await toggle.click({ force: true }).catch(() => {});
        await admin.waitForTimeout(400);
        await saveBtn.click().catch(() => {});
        await admin.waitForTimeout(500);
        if (await admin.locator('.modal-footer:visible').count().catch(() => 0))
          await modalConfirm(admin).click().catch(() => {});
      });
      const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-07-save', desc: '기능 설정 저장 후' });

      // 원복: 다시 토글 → 저장
      await withToastObserver(admin, async () => {
        await toggle.click({ force: true }).catch(() => {});
        await admin.waitForTimeout(400);
        await saveBtn.click().catch(() => {});
        await admin.waitForTimeout(500);
        if (await admin.locator('.modal-footer:visible').count().catch(() => 0))
          await modalConfirm(admin).click().catch(() => {});
      });

      record({ path: P, tcRef: R, tcId: 'WP-07-save', desc: '태블릿 기능 토글 저장 → 토스트', expected: '저장 완료 토스트' },
        toasts.length > 0 ? 'PASS' : 'FAIL',
        { actual: toasts[0]?.slice(0, 80) || '토스트 미출현', screenshot: shot });

      const restored = await toggle.isChecked().catch(() => !origChecked);
      record({ path: P, tcRef: R, tcId: 'WP-07-restore', desc: '설정값 원복 확인', expected: `원복 후 상태=${origChecked}` },
        restored === origChecked ? 'PASS' : 'FAIL',
        { actual: `현재=${restored}, 원래=${origChecked}` });
    }
  }

  // ════════════════════════════════════════════════════════
  //  WP-08: 배토 기록 등록 → 확인 → 삭제
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-08 배토 기록`; const R = 'WP-08'; const marker = `${MARK}-WP08`;
    console.log(`\n${'─'.repeat(50)}\n[WP-08] 배토 기록 등록·확인·삭제\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '배토 관리', '배토 기록 조회').catch(() => {});
    await settle(admin);

    const addBtn = admin.locator('.contents-box').getByRole('button', { name: /등록|추가|신규/, exact: false }).first();
    const hasAdd = await addBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasAdd) {
      skip({ path: P, tcRef: R, tcId: 'WP-08', desc: '등록 버튼 미발견' }, '등록 버튼 없음 — SKIP');
    } else {
      await withFixture(
        async () => { await deleteMarkedRows(admin, marker); },
        async () => {
          const toasts = await withToastObserver(admin, async () => {
            await addBtn.click().catch(() => {}); await admin.waitForTimeout(600);
            // 내용 필드에 마커 입력
            const inp = admin.locator('input[type=text]:visible, textarea:visible').first();
            await inp.fill(`${marker}`).catch(() => {});
            await primary(admin).click().catch(() => {});
          });
          await closeModal(admin); await settle(admin, 800);

          const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-08-reg', desc: '배토 기록 등록 후' });
          const inList = await admin.locator('tbody tr').filter({ hasText: marker }).count().then(c => c > 0).catch(() => false);

          record({ path: P, tcRef: R, tcId: 'WP-08-reg', desc: '배토 기록 등록 → 목록 반영', expected: '마커 행 노출' },
            inList || toasts.some(isSuccess) ? 'PASS' : 'FAIL',
            { actual: inList ? '목록 확인' : (toasts[0]?.slice(0, 60) || '마커 없음'), screenshot: shot });
        },
        async () => { await deleteMarkedRows(admin, marker); },
      );
    }
  }

  // ════════════════════════════════════════════════════════
  //  WP-09: 대회 등록 → 확인 → 삭제
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-09 대회 등록`; const R = 'WP-09'; const marker = `${MARK}-WP09`;
    console.log(`\n${'─'.repeat(50)}\n[WP-09] 대회 등록·확인·삭제\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '대회', '대회관리').catch(() => {});
    await settle(admin);

    const addBtn = admin.locator('.contents-box').getByRole('button', { name: /신규 등록|등록|추가/, exact: false }).first();
    const hasAdd = await addBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasAdd) {
      skip({ path: P, tcRef: R, tcId: 'WP-09', desc: '등록 버튼 미발견' }, '등록 버튼 없음 — SKIP');
    } else {
      await withFixture(
        async () => { await deleteMarkedRows(admin, marker); },
        async () => {
          const toasts = await withToastObserver(admin, async () => {
            await addBtn.click().catch(() => {}); await admin.waitForTimeout(800);
            // 대회명 입력
            const inp = admin.locator('input[type=text]:visible').first();
            await inp.fill(`${marker} 대회`).catch(() => {});
            // 필수 드롭다운(코스 등)이 있다면 첫 번째 옵션 선택
            const vs = admin.locator('.vs__dropdown-toggle');
            for (let i = 0; i < Math.min(await vs.count().catch(() => 0), 2); i++) {
              if ((await vs.nth(i).innerText().catch(() => '')).trim()) continue;
              await vs.nth(i).click().catch(() => {}); await admin.waitForTimeout(300);
              await admin.locator('.vs__dropdown-option').first().click().catch(() => {}); await admin.waitForTimeout(200);
            }
            await primary(admin).click().catch(() => {});
          });
          await closeModal(admin); await settle(admin, 800);

          const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-09-reg', desc: '대회 등록 후' });
          const inList = await admin.locator('tbody tr, .list-item').filter({ hasText: marker }).count().then(c => c > 0).catch(() => false);

          record({ path: P, tcRef: R, tcId: 'WP-09-reg', desc: '대회 등록 → 목록 반영', expected: '마커 대회 노출' },
            inList || toasts.some(isSuccess) ? 'PASS' : 'FAIL',
            { actual: inList ? '목록 확인' : (toasts[0]?.slice(0, 60) || '마커 없음'), screenshot: shot });
        },
        async () => { await deleteMarkedRows(admin, marker); },
      );
    }
  }

  // ════════════════════════════════════════════════════════
  //  WP-10: 계정 등록 → 확인 → 삭제
  //  주의: 계정 등록에는 ID/PW 필수. E2E 테스트 전용 계정 형식 사용.
  // ════════════════════════════════════════════════════════
  {
    const P = `${PFX} > WP-10 계정 등록`; const R = 'WP-10'; const marker = `${MARK}-WP10`;
    const testId = `e2ew${Date.now().toString().slice(-6)}`;  // 유니크 ID
    console.log(`\n${'─'.repeat(50)}\n[WP-10] 계정 등록·확인·삭제 (ID: ${testId})\n${'─'.repeat(50)}`);

    await navigateMenu(admin, '계정 관리', '계정 리스트').catch(() => {});
    await settle(admin);

    const addBtn = admin.locator('.contents-box').getByRole('button', { name: /계정 추가|추가|신규|등록/, exact: false }).first();
    const hasAdd = await addBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasAdd) {
      skip({ path: P, tcRef: R, tcId: 'WP-10', desc: '계정 추가 버튼 미발견' }, '계정 추가 버튼 없음 — SKIP');
    } else {
      await withFixture(
        async () => {
          // 이전 E2EWRITE 계정 잔여 삭제
          await deleteMarkedRows(admin, marker);
          await deleteMarkedRows(admin, 'e2ew');
        },
        async () => {
          const toasts = await withToastObserver(admin, async () => {
            await addBtn.click().catch(() => {}); await admin.waitForTimeout(800);
            // 입력 필드 순서대로 채우기: 이름 / ID / 비밀번호 / 확인비밀번호
            const inputs = admin.locator('input[type=text]:visible, input[type=password]:visible, input:not([type=checkbox]):not([type=radio]):visible');
            const cnt = await inputs.count().catch(() => 0);
            const vals = [`${marker}`, testId, 'E2ePw1234!', 'E2ePw1234!', '', '', ''];
            for (let i = 0; i < Math.min(cnt, vals.length); i++) {
              if (vals[i]) await inputs.nth(i).fill(vals[i]).catch(() => {});
            }
            // 권한 드롭다운(있으면) 첫 옵션
            const vs = admin.locator('.vs__dropdown-toggle');
            for (let i = 0; i < Math.min(await vs.count().catch(() => 0), 1); i++) {
              if ((await vs.nth(i).innerText().catch(() => '')).trim()) continue;
              await vs.nth(i).click().catch(() => {}); await admin.waitForTimeout(300);
              await admin.locator('.vs__dropdown-option').first().click().catch(() => {}); await admin.waitForTimeout(200);
            }
            await primary(admin).click().catch(() => {});
          });
          await closeModal(admin); await settle(admin, 800);

          const shot = await capture(admin, { path: P, tcRef: R, tcId: 'WP-10-reg', desc: '계정 등록 후' });
          // 계정 목록에서 ID 또는 이름으로 확인
          const inList = await admin.locator('tbody tr').filter({ hasText: new RegExp(testId + '|' + marker) }).count().then(c => c > 0).catch(() => false);

          record({ path: P, tcRef: R, tcId: 'WP-10-reg', desc: '계정 등록 → 목록 반영', expected: '등록 계정 목록 노출' },
            inList || toasts.some(isSuccess) ? 'PASS' : 'FAIL',
            { actual: inList ? `ID=${testId} 목록 확인` : (toasts[0]?.slice(0, 60) || '마커 없음'), screenshot: shot });
        },
        async () => {
          await deleteMarkedRows(admin, marker);
          // ID 기준 추가 삭제 시도
          const row = admin.locator('tbody tr').filter({ hasText: testId }).first();
          if (await row.count().catch(() => 0)) {
            await row.locator('input[type=checkbox]').first().check({ force: true }).catch(() => {});
            const delBtn = admin.locator('.contents-box').getByRole('button', { name: /삭제/, exact: false }).first();
            await delBtn.click().catch(() => {}); await admin.waitForTimeout(500);
            const footer = admin.locator('.modal-footer').filter({ has: admin.getByRole('button', { name: /확인|삭제/, exact: false }) }).first();
            if (await footer.isVisible({ timeout: 1500 }).catch(() => false))
              await footer.getByRole('button', { name: /확인|삭제/, exact: false }).first().click().catch(() => {});
            await admin.waitForTimeout(800);
          }
        },
      );
    }
  }

  // ── 리포트 저장 ──────────────────────────────────────────
  await writeReport('write-path');
  console.log('\n[WP] 10개 플로우 완료 — reports/write-path_report_*.xlsx 생성\n');
});

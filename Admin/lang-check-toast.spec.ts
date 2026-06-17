import { test } from '../lib/fixtures';
import { isDestructiveAllowed, withFixture } from '../Playwright_New/destructive';
import { writeReport, resetResults, resetDiff, resetNoTC, resetReview, skip } from '../lib/reporter';
import { TARGET_LANGS, KOREAN, switchLanguage, withToastObserver, classifyToastText } from '../lib/langCheck';

// ──────────────────────────────────────────────────────────────
//  토스트·에러 메시지 언어 검증 — 공식 지원 언어 전체
//   트리거(검증됨): 코스 운영 관리 > 골프장 소식 > [등록] 모달에서 내용+노출시간 입력 후 [등록] 제출.
//     · 동일 날짜/시간 슬롯 충돌 시 → 에러 토스트 "동일날짜/동일시간에 골프장 소식이 존재 합니다…"(레코드 미생성=비파괴)
//     · 빈 슬롯이면 → 성공 토스트 "골프장소식 등록이 완료되었습니다."(레코드 생성 → teardown 삭제)
//   언어별로 토스트 텍스트를 캡처해 분류: 한글 노출 / 언어 혼재 / 인코딩 깨짐 / 정상(번역 실제값).
//   ⚠ 레코드 생성 가능성 → ALLOW_DESTRUCTIVE 가드 + withFixture로 마커행(E2ELANGTOAST) 전수 삭제(원복).
//   리포트: reports/lang-check-toast_report_*.xlsx
//   실행: $env:ALLOW_DESTRUCTIVE="1"; npx playwright test --project=admin-chromium Admin/lang-check-toast.spec.ts --no-deps
//   (일부 언어: $env:LANGS="영어,일본어")
// ──────────────────────────────────────────────────────────────
const FILTER = (process.env.LANGS || '').split(',').map(s => s.trim()).filter(Boolean);
const LANGS = FILTER.length ? TARGET_LANGS.filter(l => FILTER.includes(l.ko) || FILTER.includes(l.label)) : TARGET_LANGS;
const MARK = 'E2ELANGTOAST';
const SCREEN = '코스 운영 관리 > 골프장 소식';

test('토스트/에러 언어검증 — 골프장 소식 등록 토스트(전 언어)', async ({ admin }) => {
  test.setTimeout(900_000);
  resetResults(); resetDiff(); resetNoTC(); resetReview();
  const seen = new Set<string>();

  const guard = await isDestructiveAllowed(admin);
  if (!guard.ok) {
    skip({ path: `${SCREEN} > 토스트/에러`, tcRef: '언어검증_토스트', tcId: 'LANGTOAST', desc: '등록 토스트 언어검증' }, `레코드 생성 가능 → 파괴 가드 필요. 비활성: ${guard.reason}`);
    await writeReport('lang-check-toast');
    return;
  }

  await navigateMenu(admin, '코스 운영 관리', '골프장 소식').catch(() => {}); await settle(admin);
  // ⚠ 언어 전환 시 버튼 텍스트도 번역됨 → 텍스트 대신 클래스 기반(언어 무관) 셀렉터 사용.
  const listReg = () => admin.locator('.contents-box button.button-common.primary').first();   // 리스트 [등록](xxsmall)
  const modalReg = () => admin.locator('button.button-common.primary').last();                 // 모달 제출 [등록](small, DOM 마지막)

  // 등록 모달 열고 내용+노출시간(vue-select 첫 옵션=고정 슬롯→충돌 유도) 채운 뒤 제출 → 토스트 반환
  const openFillSubmit = async (content: string): Promise<string[]> => {
    await listReg().click().catch(() => {}); await admin.waitForTimeout(1000);
    await admin.locator('textarea:visible').first().fill(content).catch(() => {});
    const vs = admin.locator('.vs__dropdown-toggle');
    for (let i = 0; i < await vs.count().catch(() => 0); i++) {
      if ((await vs.nth(i).innerText().catch(() => '')).trim()) continue;   // 이미 값 있으면 skip
      await vs.nth(i).click().catch(() => {}); await admin.waitForTimeout(350);
      await admin.locator('.vs__dropdown-option, li[role=option]').first().click().catch(() => {}); await admin.waitForTimeout(250);
    }
    // 제출 직전부터 MutationObserver로 감시 → 찰나의 토스트 포착
    return await withToastObserver(admin, async () => { await modalReg().click().catch(() => {}); });
  };
  // 모달 확실히 닫기(언어 전환 차단 방지) — 취소(primary/danger 아닌 button-common) 우선, Escape 폴백. textarea 사라질 때까지.
  const closeModal = async () => {
    for (let i = 0; i < 4; i++) {
      if (!(await admin.locator('textarea:visible').count().catch(() => 0))) return;
      const cancel = admin.locator('button.button-common:not(.primary):not(.button-outline-danger):not(.button-outline-default)').last();
      if (await cancel.isVisible().catch(() => false)) await cancel.click({ force: true }).catch(() => {});
      else await admin.keyboard.press('Escape').catch(() => {});
      await admin.waitForTimeout(500);
    }
  };

  const cleanup = async () => {
    await closeModal(); await settle(admin);
    for (let i = 0; i < 12; i++) {
      const row = admin.locator('tbody tr').filter({ hasText: MARK }).first();
      if (!(await row.count().catch(() => 0))) break;
      await row.locator('input[type=checkbox]').first().check({ force: true }).catch(() => {});
      await admin.locator('.contents-box').getByRole('button', { name: '삭제', exact: true }).first().click().catch(() => {});
      await admin.waitForTimeout(400);
      const conf = admin.locator('.modal-footer').filter({ has: admin.getByRole('button', { name: /확인|삭제/ }) }).first();
      if (await conf.isVisible({ timeout: 1500 }).catch(() => false)) await conf.getByRole('button', { name: /확인|삭제/ }).first().click().catch(() => {});
      await admin.waitForTimeout(900);
    }
    const remain = await admin.locator('tbody tr').filter({ hasText: MARK }).count().catch(() => 0);
    console.log(`[teardown] 마커행(${MARK}) 삭제 후 잔여=${remain}`);
  };

  await withFixture(
    async () => { await cleanup(); },                                  // 사전 잔여 정리
    async () => {
      for (const lang of LANGS) {
        await closeModal();                                   // 전환 전 모달 확실히 닫기
        const ok = await switchLanguage(admin, lang.label);
        if (!ok) { skip({ path: `${SCREEN} > 토스트/에러`, tcRef: '언어검증_토스트', tcId: `LANGTOAST-${lang.ko}`, desc: `${lang.ko} 등록 토스트` }, `${lang.label} 전환 실패`); continue; }
        const toast = await openFillSubmit(`${MARK}-${lang.ko}`);
        if (toast.length) classifyToastText(lang, SCREEN, '등록 토스트(성공/중복)', toast, '', seen);
        else skip({ path: `${SCREEN} > 토스트/에러`, tcRef: '언어검증_토스트', tcId: `LANGTOAST-${lang.ko}`, desc: `${lang.ko} 등록 토스트` }, '토스트 미출현');
        await closeModal();
      }
      await switchLanguage(admin, KOREAN);
    },
    async () => { await switchLanguage(admin, KOREAN).catch(() => {}); await cleanup(); },   // 원복: 마커행 전수 삭제
  );

  await writeReport('lang-check-toast');
  if (process.env.KEEP_OPEN) await admin.pause();
});

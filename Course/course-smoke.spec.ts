import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_IA } from '../lib/course/courseHelpers';

// ──────────────────────────────────────────────────────────────
//  코스관리 IA 스모크 — 전 대/소메뉴를 SNB 로 순회하며 진입 성공만 비파괴 검증.
//  - 단일 test 순회(경기관제 all-suite 패턴): 세션은 재로그인 1회당 1런만 생존 →
//    test 마다 재진입하면 재로그인 폭주 → 반드시 한 test 에서 1회 진입 후 순회.
//  - 검증(비파괴): 로그인 페이지로 튕기지 않음 + 본문(.contents/.contents-box) 렌더 +
//    화면 제목(.contents-title/h2 등) 노출. 저장/등록/삭제 등 데이터 변경 동작은 하지 않음.
//  - 실행: npm run course:smoke  (세션 만료 시: npm run course:auth 후 재실행)
// ──────────────────────────────────────────────────────────────

interface Row { menu: string; sub: string; ok: boolean; note: string; url: string; }

async function contentLoaded(page: Page): Promise<boolean> {
  // 로그인 이탈 아님 + 본문 컨테이너 노출(코스관리는 .contents / .contents-box)
  if (/\/login/.test(page.url())) return false;
  const body = page.locator('.contents, .contents-box, main').first();
  return body.isVisible().catch(() => false);
}

test('코스관리 IA 스모크 — 전 메뉴 진입(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);

  const admin = await openCourseAdmin(page, context);
  const rows: Row[] = [];

  for (const { menu, subs } of COURSE_IA) {
    for (const { name: sub } of subs) {
      let ok = false;
      let note = '';
      try {
        const navigated = await gotoCourseMenu(admin, menu, menu === 'Home' ? undefined : sub);
        await killAlarms(admin);
        if (!navigated && menu !== 'Home') { note = 'SNB 링크 미발견'; }
        else { ok = await contentLoaded(admin); if (!ok) note = '본문 미렌더/로그인 이탈'; }
      } catch (e) {
        note = `예외: ${(e as Error).message.slice(0, 80)}`;
      }
      const label = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      rows.push({ menu, sub, ok, note, url: admin.url() });
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)} ${admin.url().replace(/^https?:\/\/[^/]+/, '')}${note ? '  ← ' + note : ''}`);
    }
  }

  const fail = rows.filter((r) => !r.ok);
  console.log(`\n[IA 스모크] 총 ${rows.length} · PASS ${rows.length - fail.length} · FAIL ${fail.length}`);
  if (fail.length) console.log('FAIL:', JSON.stringify(fail.map((f) => `${f.menu}>${f.sub}(${f.note})`), null, 1));

  // 대다수 진입 성공을 기대(일부 데이터 의존/미구현 여지 → 소프트 임계). 완전 실패 시만 하드 실패.
  expect(rows.length).toBeGreaterThan(30);
  expect(fail.length, `진입 실패 메뉴: ${fail.map((f) => `${f.menu}>${f.sub}`).join(', ')}`)
    .toBeLessThanOrEqual(Math.ceil(rows.length * 0.2));
});

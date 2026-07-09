import { test } from '../lib/fixtures';
import { navigateMenu, settle } from '../lib/adminHelpers';

// 단체 라운드 스코어/순위 새 탭 페이지 내용 덤프(읽기전용·비파괴).
//   스코어 [보기]→/club/RoundGroupScore/{id}, 결과집계 [보기]→/club/RoundGroupRank/{id}
//   라운드종료(데이터 완비) 행 우선. 새 탭 테이블 전수 덤프.
const dumpPage = async (pg: any) => pg.evaluate(() => {
  const tables = Array.from(document.querySelectorAll('table')).map((t: any) => ({
    cls: t.className.toString().slice(0, 50),
    headers: Array.from(t.querySelectorAll('thead th, thead td')).map((h: any) => h.innerText.trim().replace(/\n/g, ' ')),
    rows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 25).map((tr: any) =>
      Array.from(tr.querySelectorAll('td,th')).map((c: any) => c.innerText.trim().replace(/\n/g, '|'))),
    rowCount: t.querySelectorAll('tbody tr').length,
  }));
  const titles = Array.from(document.querySelectorAll('h1,h2,h3,h4,.title,.page-title,[class*="title"]'))
    .map((e: any) => e.innerText.trim()).filter((x: string) => x && x.length < 60).slice(0, 10);
  const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab-item, .tab button, [class*="tab"] button, .vs__selected'))
    .map((e: any) => e.innerText?.trim()).filter((x: string) => x && x.length < 30).slice(0, 25);
  const bodyTxt = (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  return { url: location.href, titles, tabs, tableCount: tables.length, tables, bodyTxt };
});

test('group-round newtab content dump', async ({ admin }) => {
  test.setTimeout(240_000);
  await navigateMenu(admin, '라운드관리', '단체라운드');
  await settle(admin, 2000);
  const tableBox = admin.locator('.contents-box').filter({ has: admin.getByRole('columnheader', { name: '단체명', exact: false }) }).first();
  const rows = tableBox.locator('tbody tr');
  const rc = await rows.count();
  console.log('ROW_COUNT=' + rc);

  const open = async (idx: number, label: string) => {
    let dumped = 0;
    for (let r = 0; r < Math.min(rc, 20) && dumped < 1; r++) {
      const status = (await rows.nth(r).locator('td').nth(9).innerText().catch(() => '')).replace(/\s/g, '');
      // 라운드종료 우선(완비). 데이터 없으면 다른 행도.
      if (dumped === 0 && status !== '라운드종료' && r < rc - 1) {
        // 첫 패스: 라운드종료만. 마지막 행까지 못 찾으면 두 번째 패스에서 아무거나.
      }
      const btn = rows.nth(r).locator('td').nth(idx).getByRole('button', { name: '보기', exact: true }).first();
      if (!(await btn.isVisible().catch(() => false))) continue;
      if (status !== '라운드종료') continue; // 1차: 라운드종료만
      const [pg] = await Promise.all([admin.context().waitForEvent('page', { timeout: 8000 }).catch(() => null), btn.click()]);
      if (!pg) { console.log(`[${label}] row${r} no new tab`); continue; }
      await pg.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await pg.waitForTimeout(1500);
      const info = await dumpPage(pg).catch((e: any) => ({ err: String(e) }));
      console.log(`\n===== [${label}] row${r}(${status}) =====\n` + JSON.stringify(info, null, 1));
      await pg.close().catch(() => {});
      dumped++;
    }
    if (!dumped) console.log(`[${label}] no 라운드종료 row found`);
  };

  await open(8, '스코어');
  await open(10, '결과집계출력');
});

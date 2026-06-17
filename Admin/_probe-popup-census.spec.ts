import { test } from '../lib/fixtures';
import { MENU_LIST } from '../lib/langCheck';
import * as fs from 'fs';

// 팝업 트리거 커버리지 센서스: 전 46 메뉴 한국어 모드 순회 →
//   ① 행 버튼 트리거(SAFE_POPUP_BTNS / CONFIRM_POPUP_BTNS)
//   ② 페이지 레벨(비행) 버튼 전체 목록(텍스트·클래스 — 수동 검토용)
//   ③ vue-select 드롭다운 수
// → analysis/_popup_census.json 저장
// 실행: npx playwright test --project=admin-chromium Admin/_probe-popup-census.spec.ts --no-deps

const SAFE_POPUP_BTNS = ['스코어', '클럽체크', '보기', '상세', '카트확인서', '캐디수첩', '중대재해 확인서', '추가 확인서'];
const PAGE_POPUP_BTNS = ['등록', '신규 등록', '미리보기', '수정', '추가'];
const CONFIRM_POPUP_BTNS = ['삭제'];
const ROW_SEL = '.table-overflow-item table tbody tr, .list-table-group tbody tr';
const ALL_TARGETS = [...SAFE_POPUP_BTNS, ...PAGE_POPUP_BTNS, ...CONFIRM_POPUP_BTNS];

test('popup trigger coverage census — all menus', async ({ admin }) => {
  test.setTimeout(600_000);

  const report: {
    menu: string; sub: string; status: string;
    rowTriggers: string[];
    pageTriggers: string[];
    pageButtonsAll: { txt: string; cls: string }[];
    vsDropdowns: number;
  }[] = [];

  for (const { menu, subs } of MENU_LIST) {
    for (const sub of subs) {
      const ok = await navigateMenu(admin, menu, sub).catch(() => false);
      await settle(admin, 800);
      if (!ok) {
        report.push({ menu, sub, status: 'SKIP(진입실패)', rowTriggers: [], pageTriggers: [], pageButtonsAll: [], vsDropdowns: 0 });
        continue;
      }

      // ① 행 버튼 트리거 탐색
      const rows = admin.locator(ROW_SEL);
      const rc = Math.min(await rows.count().catch(() => 0), 6);
      const rowTriggers: string[] = [];
      const triedRow = new Set<string>();
      for (let r = 0; r < rc; r++) {
        const btns = rows.nth(r).locator('button, [role="button"]');
        const bc = await btns.count().catch(() => 0);
        for (let bi = 0; bi < bc; bi++) {
          const label = (await btns.nth(bi).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
          const match = ALL_TARGETS.find(t => label === t || label.includes(t));
          if (!match || triedRow.has(match)) continue;
          if (!(await btns.nth(bi).isVisible().catch(() => false))) continue;
          triedRow.add(match);
          rowTriggers.push(label);
        }
      }

      // ② 페이지 레벨(비행) 버튼 전체 수집
      const pageBtnInfo = await admin.evaluate((rowSel) => {
        const isVisible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const st = getComputedStyle(el as HTMLElement);
          return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
        };
        return Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter(el => isVisible(el) && !el.closest(rowSel))
          .map((el, pi) => ({
            pi,
            txt: ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
            cls: (el.className || '').toString().slice(0, 60),
          }));
      }, ROW_SEL);

      const pageTriggers: string[] = [];
      const triedPage = new Set<string>();
      for (const btn of pageBtnInfo) {
        if (!btn.txt) continue;
        const match = ALL_TARGETS.find(t => btn.txt === t || btn.txt.includes(t));
        if (match && !triedPage.has(match)) { triedPage.add(match); pageTriggers.push(btn.txt); }
      }

      // ③ vue-select 드롭다운 수
      const vsDropdowns = await admin.locator('.vs__dropdown-toggle').count().catch(() => 0);

      report.push({
        menu, sub, status: 'OK',
        rowTriggers,
        pageTriggers,
        pageButtonsAll: pageBtnInfo.map(b => ({ txt: b.txt, cls: b.cls })).filter(b => b.txt),
        vsDropdowns,
      });
      console.log(`[${menu}>${sub}] row=${rowTriggers.join(',')||'-'} page=${pageTriggers.join(',')||'-'} vs=${vsDropdowns}`);
    }
  }

  // 요약
  const summary = report.map(r => ({
    screen: `${r.menu} > ${r.sub}`,
    status: r.status,
    rowTriggers: r.rowTriggers.join(', ') || '-',
    pageTriggers: r.pageTriggers.join(', ') || '-',
    vsDropdowns: r.vsDropdowns,
    covered: r.rowTriggers.length > 0 || r.pageTriggers.length > 0 || r.vsDropdowns > 0,
  }));
  const notCovered = summary.filter(s => s.status === 'OK' && !s.covered);
  console.log('\n=== 팝업/드롭다운 미감지 화면 ===');
  for (const s of notCovered) console.log('  ❌', s.screen);
  console.log(`\n총 화면=${summary.length}, 커버=${summary.filter(s=>s.covered).length}, 미커버=${notCovered.length}, SKIP=${summary.filter(s=>s.status!=='OK').length}`);

  fs.writeFileSync('analysis/_popup_census.json', JSON.stringify({ summary, detail: report }, null, 2), 'utf-8');
  console.log('>>> saved analysis/_popup_census.json');
});

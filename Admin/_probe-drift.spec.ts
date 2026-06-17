import { test } from '../lib/fixtures';
import { navigateMenu, settle } from '../lib/adminHelpers';
import * as fs from 'fs';

// 드리프트 확정 항목의 현재 UI 실제값 덤프 (비파괴 — 노출 스캔만)
test('drift probe — 현재 구현 실제값 덤프', async ({ admin }) => {
  test.setTimeout(300_000);
  const out: any = {};

  const scan = async () => admin.evaluate(() => {
    const vis = (el: Element) => (el as HTMLElement).offsetParent !== null;
    const txt = (el: Element) => ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    const headers = [...new Set(Array.from(document.querySelectorAll('th, [role=columnheader], .list-table-group thead td')).filter(vis).map(txt).filter(Boolean))];
    const buttons = [...new Set(Array.from(document.querySelectorAll('button, [role=button], a[class*=btn]')).filter(vis).map(txt).filter(Boolean))].slice(0, 40);
    const tabs = [...new Set(Array.from(document.querySelectorAll('.tab, [class*="tab"] li, [role=tab]')).filter(vis).map(txt).filter(Boolean))].slice(0, 20);
    const url = location.pathname;
    return { url, headers, buttons, tabs };
  });

  // 관제 관리 SNB 하위 메뉴명 전수 (카트이동경로 확인 명칭 확인용)
  const snbControl = await admin.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.depth-2-title, .depth-1-title, .snb a, .snb span, [class*="depth"]'))
      .map(e => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return [...new Set(items)];
  });
  out['_SNB_전체'] = snbControl;

  const visit = async (key: string, parent: string, child: string) => {
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) ok = await navigateMenu(admin, parent, child).catch(() => false) as boolean;
    await settle(admin, 2000);
    out[key] = ok ? await scan() : { ERROR: '진입 실패' };
  };

  await visit('카트이동경로', '관제 관리', '카트이동경로 확인');
  await visit('캐디리스트', '캐디 관리', '캐디 리스트');
  await visit('홀맵구역', '홀맵 관리', '홀맵 구역 설정');
  await visit('핀포지션', '코스 운영 관리', '핀 포지션 관리');
  await visit('코스분석', '코스 운영 관리', '코스 분석');
  await visit('후기통계', '고객 평가 관리', '후기 통계');
  await visit('배토기록', '배토 관리', '배토 기록 조회');
  await visit('주문내역', '식음 관리', '주문 내역 관리');

  fs.writeFileSync('analysis/_drift_probe.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
});

import { test } from '../lib/fixtures';
import { navigateMenu } from '../lib/adminHelpers';
import { attachUxObservers, probeScreenUx, UxFinding } from '../lib/uxProbe';
import * as fs from 'fs';

// UX probe 전 화면 비파괴 탐색 — 반응형/overflow/i18n/콘솔/네트워크.
//  기본: 테이블·대시보드 위주(반응형 영향 큰 화면). 단일 화면만: UX_MENU="대메뉴>하위메뉴".
//  실행: npx playwright test --project=admin-chromium Admin/ux-probe-all.spec.ts --no-deps
test('UX probe — 비파괴 탐색(반응형/overflow/i18n/콘솔)', async ({ admin }) => {
  test.setTimeout(900_000);
  const obs = attachUxObservers(admin);

  const DEFAULT: [string, string][] = [
    ['라운드 관리', '내장 현황'], ['라운드 관리', '전체 라운드'],
    ['홀맵 관리', '홀맵 구역 설정'],
    ['코스 운영 관리', '핀 포지션 관리'], ['코스 운영 관리', '코스 분석'],
    ['캐디 관리', '캐디 리스트'],
    ['배토 관리', '배토 기록 조회'],
    ['식음 관리', '주문 내역 관리'],
    ['고객 평가 관리', '후기 통계'],
    ['계정 관리', '계정 리스트'],
    ['대회', '대회관리'],
  ];
  const menus: [string, string][] = process.env.UX_MENU
    ? [process.env.UX_MENU.split('>').map(s => s.trim()) as [string, string]]
    : DEFAULT;

  const all: UxFinding[] = [];
  for (const [p, c] of menus) {
    let ok = false;
    for (let i = 0; i < 2 && !ok; i++) ok = await navigateMenu(admin, p, c).catch(() => false) as boolean;
    if (!ok) { all.push({ screen: `${p}>${c}`, area: '진입', severity: '정보', detail: '진입 실패(플레이크/세션)' }); continue; }
    all.push(...await probeScreenUx(admin, `${p}>${c}`, obs).catch(() => []));
  }

  fs.writeFileSync('analysis/_ux_probe_all.json', JSON.stringify(all, null, 2));
  const bySev = all.reduce((m: any, x) => { m[x.severity] = (m[x.severity] || 0) + 1; return m; }, {});
  console.log(`\n[ux-probe] 화면 ${menus.length}개 · 발견 ${all.length}건 · 심각도 ${JSON.stringify(bySev)}`);
  for (const x of all.filter(x => x.severity === '상' || x.severity === '중' || x.severity === '하'))
    console.log(`  [${x.severity}] ${x.screen} — ${x.area}`);
});

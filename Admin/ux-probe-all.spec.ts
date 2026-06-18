import { test } from '../lib/fixtures';
import { navigateMenu } from '../lib/adminHelpers';
import { attachUxObservers, probeScreenUx, UxFinding } from '../lib/uxProbe';
import * as fs from 'fs';
import ExcelJS from 'exceljs';

// UX 결함 → reports/ux-probe_report_*.xlsx (요약 + 결함 시트)
async function writeUxReport(all: UxFinding[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sev: Record<string, number> = { 상: 0, 중: 0, 하: 0, 정보: 0 };
  all.forEach(x => { sev[x.severity] = (sev[x.severity] || 0) + 1; });
  const screens = [...new Set(all.map(x => x.screen))];

  const sum = wb.addWorksheet('요약');
  sum.addRow(['UX probe 결과', `화면 ${screens.length} · 발견 ${all.length}`]);
  sum.addRow(['상', sev.상]); sum.addRow(['중', sev.중]); sum.addRow(['하', sev.하]); sum.addRow(['정보', sev.정보]);
  sum.addRow(['생성시각', new Date().toLocaleString('ko-KR')]);

  const ws = wb.addWorksheet('결함');
  ws.columns = [
    { header: '화면', key: 'screen', width: 30 },
    { header: '영역', key: 'area', width: 40 },
    { header: '심각도', key: 'severity', width: 8 },
    { header: '상세', key: 'detail', width: 70 },
  ];
  const order: Record<string, number> = { 상: 0, 중: 1, 하: 2, 정보: 3 };
  [...all].sort((a, b) => order[a.severity] - order[b.severity]).forEach(x =>
    ws.addRow({ screen: x.screen, area: x.area, severity: x.severity, detail: typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail).slice(0, 300) }));

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const path = `reports/ux-probe_report_${ts}.xlsx`;
  fs.mkdirSync('reports', { recursive: true });
  await wb.xlsx.writeFile(path);
  return path;
}

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
  const reportPath = await writeUxReport(all);
  const bySev = all.reduce((m: any, x) => { m[x.severity] = (m[x.severity] || 0) + 1; return m; }, {});
  console.log(`\n[ux-probe] 화면 ${menus.length}개 · 발견 ${all.length}건 · 심각도 ${JSON.stringify(bySev)}`);
  console.log(`[report] 엑셀 생성: ${reportPath}`);
  for (const x of all.filter(x => x.severity === '상' || x.severity === '중' || x.severity === '하'))
    console.log(`  [${x.severity}] ${x.screen} — ${x.area}`);
});

import { test } from '../lib/fixtures';
import * as fs from 'fs';

// 드롭박스 라벨 수집 진단 probe — SKIP_DROPDOWN_CONTENT_PATTERNS 매칭 여부 확인용.
//  대상: 경기 진행 관리 4종 + 식음 관리 4종 + 기존 검증 화면
// 실행: npx playwright test --project=admin-chromium Admin/_probe-langgap.spec.ts --no-deps

const TARGETS: { menu: string; sub: string }[] = [
  // 경기 진행 관리 — 전체 4종 진단
  { menu: '경기 진행 관리', sub: '진행시간 표준 설정' },
  { menu: '경기 진행 관리', sub: '진행시간 실시간' },
  { menu: '경기 진행 관리', sub: '진행시간 조회' },
  { menu: '경기 진행 관리', sub: '진행시간 통계' },
  // 식음 관리 — 전체 4종 진단
  { menu: '식음 관리', sub: '버전 및 설정' },
  { menu: '식음 관리', sub: '식당 관리' },
  { menu: '식음 관리', sub: '상품 등록 관리' },
  { menu: '식음 관리', sub: '주문 내역 관리' },
  // 기존 확인 화면
  { menu: '캐디 관리', sub: '캐디 등록 관리' },
  { menu: '배토 관리', sub: '배토 기록 조회' },
  // 추가: 패턴 검증 화면
  { menu: '계정 관리', sub: '계정 리스트' },
  { menu: '계정 관리', sub: '계정 권한 관리' },
];

const collectLabels = (admin: any) => admin.evaluate(() => {
  const toggles = Array.from(document.querySelectorAll('.vs__dropdown-toggle'));
  return toggles.map((toggle, idx) => {
    const he = toggle as HTMLElement;
    const bRect = he.getBoundingClientRect();
    const placeholder = (toggle.querySelector('input') as HTMLInputElement | null)?.getAttribute('placeholder') || '';
    const selected = ((toggle.querySelector('.vs__selected') as HTMLElement)?.innerText || '').replace(/\s+/g, ' ').trim();
    let contextLabel = '';
    let contextPath = '';
    let el: Element | null = toggle.parentElement;
    for (let d = 0; d < 6 && el && !contextLabel; d++) {
      for (const sel of ['label', '.box-title', '.sub-title', 'h3', 'h4', '.form-label', '.label', '.title-text', '.setting-name']) {
        const found = el.querySelector(sel) as HTMLElement | null;
        if (!found || found.contains(toggle)) continue;
        const txt = (found.innerText || '').replace(/\s+/g, ' ').trim();
        if (txt && txt.length >= 2 && txt.length <= 40 && !txt.includes('\n')) {
          contextLabel = txt;
          contextPath = `d${d}:${sel}`;
          break;
        }
      }
      el = el.parentElement;
    }
    return {
      idx,
      visible: bRect.width > 0 && bRect.height > 0,
      placeholder,
      selected,
      contextLabel,
      contextPath,
      parentCls: (toggle.parentElement?.className || '').toString().slice(0, 80),
    };
  });
});

const openAndSample = async (admin: any, i: number): Promise<string[]> => {
  try {
    const toggle = admin.locator('.vs__dropdown-toggle').nth(i);
    if (!(await toggle.isVisible().catch(() => false))) return [];
    await toggle.click().catch(() => {});
    await admin.waitForTimeout(600);
    const opts = await admin.locator('.vs__dropdown-menu li, .vs__dropdown-option').allInnerTexts().catch(() => [] as string[]);
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(200);
    return (opts as string[]).slice(0, 8);
  } catch { return []; }
};

test('dropdown label probe — 전체 미진단 화면 드롭박스 라벨 수집', async ({ admin }) => {
  test.setTimeout(600_000);
  const report: Record<string, unknown>[] = [];

  for (const { menu, sub } of TARGETS) {
    const ok = await navigateMenu(admin, menu, sub).catch(() => false);
    await settle(admin, 1000);
    if (!ok) { report.push({ screen: `${menu} > ${sub}`, status: 'SKIP(진입실패)' }); continue; }

    const labels: any[] = await collectLabels(admin);
    const visibleCount = labels.filter((l: any) => l.visible).length;
    const withSamples: Record<string, unknown>[] = [];
    for (const lbl of labels) {
      if (!lbl.visible) { withSamples.push({ ...lbl, sample: [] }); continue; }
      const sample = await openAndSample(admin, lbl.idx);
      withSamples.push({ ...lbl, sample });
    }
    report.push({ screen: `${menu} > ${sub}`, dropdowns: withSamples });

    console.log(`\n=== [${menu} > ${sub}] (가시 드롭박스 ${visibleCount}개) ===`);
    for (const d of withSamples) {
      const dd = d as any;
      if (!dd.visible) continue;
      console.log(`  #${dd.idx}  placeholder="${dd.placeholder}"  selected="${dd.selected}"  contextLabel="${dd.contextLabel}"(${dd.contextPath})`);
      if (dd.sample?.length) console.log(`         sample: ${dd.sample.slice(0, 6).join(' | ')}`);
      // 패턴 매칭 여부 확인
      const parts = [dd.placeholder, dd.selected, dd.contextLabel];
      const testLabels = ['전체캐디', '캐디', '식당', '권한 그룹', '하우스 캐디'];
      for (const lbl of testLabels) {
        if (parts.some((p: string) => p.includes(lbl))) {
          console.log(`         → 패턴 "${lbl}" 매칭 ✓`);
        }
      }
    }
  }

  fs.writeFileSync('analysis/_langgap_probe.json', JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n>>> saved analysis/_langgap_probe.json');
});

import { test } from '../lib/fixtures';
import { gotoMenu } from '../lib/reporter';
import fs from 'fs';

// 프로브(일회성): 부분일치 → 전문/정확 일치 승격용 AS-IS 실제값 덤프.
//   안내문구(.info-box-text), 테이블 컬럼헤더, 식음 카드/범례 텍스트 캡처.
// 실행: npx playwright test --project=admin-chromium Admin/_probe-infotext.spec.ts --no-deps
// 산출: analysis/_infotext_probe.json
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

const TARGETS: { id: string; parent: string; child: string; cards?: boolean; legend?: boolean }[] = [
  { id: 'GRN-01', parent: '코스 운영 관리', child: '그린 스피드' },
  { id: 'NEWS-01', parent: '코스 운영 관리', child: '골프장 소식' },
  { id: 'CEVAL-01', parent: '고객 평가 관리', child: '고객 평가' },
  { id: 'CDEV-01', parent: '고객 평가 관리', child: '캐디 평가' },
  { id: 'RVL-01', parent: '고객 평가 관리', child: '후기 리스트' },
  { id: 'RVS-01', parent: '고객 평가 관리', child: '후기 통계' },
  { id: 'ACL', parent: '계정 관리', child: '계정 리스트' },
  { id: 'APM-01', parent: '계정 관리', child: '계정 권한 관리' },
  { id: 'CADL', parent: '캐디 관리', child: '캐디 리스트' },
  { id: 'HMZ', parent: '홀맵 관리', child: '홀맵 구역 설정' },
  { id: 'FNBVER', parent: '식음 관리', child: '버전 및 설정', cards: true },
  { id: 'RESTO', parent: '식음 관리', child: '식당 관리', legend: true },
  { id: 'FNBORD', parent: '식음 관리', child: '주문 내역 관리' },
];

test('probe: 안내문구/컬럼/카드 AS-IS 덤프', async ({ admin }) => {
  test.setTimeout(420_000);
  const out: Record<string, any> = {};
  for (const t of TARGETS) {
    const ok = await gotoMenu(admin, t.parent, t.child, { path: `${t.parent} > ${t.child}`, tcRef: '-', tcId: t.id, desc: 'probe', failMsg: '진입 불가' }, { scanRawCode: false }).catch(() => false);
    if (!ok) { out[t.id] = { parent: t.parent, child: t.child, error: '진입 실패' }; continue; }
    await admin.locator('.info-box-text, .contents-box').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await admin.waitForTimeout(800);
    const rec: any = { parent: t.parent, child: t.child };
    rec.info = norm(await admin.locator('.info-box-text').first().innerText().catch(() => ''));
    rec.headers = (await admin.getByRole('columnheader').allInnerTexts().catch(() => [])).map(norm).filter(Boolean);
    if (t.cards) {
      rec.cardTitles = (await admin.locator('.card-title').allInnerTexts().catch(() => [])).map(norm).filter(Boolean);
      rec.cardDescs = (await admin.locator('.card-desc').allInnerTexts().catch(() => [])).map(norm).filter(Boolean);
      rec.bullets = (await admin.locator('.card-bullets').allInnerTexts().catch(() => [])).map(norm).filter(Boolean);
      rec.subTitles = (await admin.locator('.sub-title-box').allInnerTexts().catch(() => [])).map(norm).filter(Boolean);
    }
    if (t.legend) {
      const lb = admin.locator('.contents-box').filter({ hasText: /식당\s*추가/ }).first();
      rec.legend = norm(await lb.innerText().catch(() => '')).slice(0, 300);
    }
    out[t.id] = rec;
    console.log(`\n[${t.id}] ${t.child}\n  info: ${rec.info}\n  headers: ${(rec.headers || []).join(' / ')}`);
    if (rec.cardTitles) console.log(`  cardTitles: ${rec.cardTitles.join(' | ')}\n  cardDescs: ${rec.cardDescs.join(' | ')}\n  bullets: ${rec.bullets.join(' | ')}\n  subTitles: ${rec.subTitles.join(' | ')}`);
    if (rec.legend) console.log(`  legend: ${rec.legend}`);
  }
  if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
  fs.writeFileSync('analysis/_infotext_probe.json', JSON.stringify(out, null, 2));
  console.log('\n[probe] analysis/_infotext_probe.json 저장');
});

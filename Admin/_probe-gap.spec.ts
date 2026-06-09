import { test } from '@playwright/test';
import { openAdmin, navigateMenu, settle } from '../lib/adminHelpers';
import { captureSlots } from '../lib/langCheck';

const HAN = /[가-힣]/;
test('probe-gap3: 확장 zone 검증', async ({ page, context }) => {
  test.setTimeout(200_000);
  const admin = await openAdmin(page, context);
  for (const [m, s] of [['코스 운영 관리', '핀 포지션 관리'], ['라운드관리', '전체 라운드'], ['라운드관리', '내장 통계']] as [string, string][]) {
    const ok = await navigateMenu(admin, m, s).catch(() => false); await settle(admin);
    if (!ok) { console.log(`\n##### ${m} > ${s}: 진입불가`); continue; }
    const slots = (await captureSlots(admin)).filter(x => HAN.test(x.text));
    const byZone: Record<string, string[]> = {};
    for (const x of slots) (byZone[x.zone] = byZone[x.zone] || []).push(x.text);
    console.log(`\n##### ${m} > ${s} (한글 슬롯 ${slots.length}) #####`);
    for (const z of ['행버튼', '요약카드', '드롭다운값']) if (byZone[z]) console.log(`  [신규:${z}] ${JSON.stringify([...new Set(byZone[z])].slice(0, 12))}`);
    // 데이터 오염 체크: 사용자 데이터로 보이는 게 잡혔나
    const suspect = slots.filter(x => /강태구|외부자들|함미정|야옹|권경륜|비닐|박ㅇ|박ㄱ|^\d+명$/.test(x.text));
    console.log(`  [데이터 오염 의심] ${suspect.length}건: ${JSON.stringify(suspect.map(x => x.zone + ':' + x.text))}`);
  }
});

import { test } from '../lib/fixtures';
import { captureSlots } from '../lib/langCheck';

// Task1 검증: 새 SCAN_ZONE(.sub-title/select옵션/뱃지/빈상태)이 실제로 슬롯에 잡히는지 확인.
test('verify new scan zones capture', async ({ admin }) => {
  test.setTimeout(180_000);

  const probe = async (menu: string, sub: string, expects: string[]) => {
    await navigateMenu(admin, menu, sub);
    await settle(admin, 1500);
    const slots = await captureSlots(admin);
    const byZone: Record<string, string[]> = {};
    for (const s of slots) (byZone[s.zone] ||= []).push(s.text);
    console.log(`\n### ${menu} > ${sub} — zone별 캡처 수:`, Object.fromEntries(Object.entries(byZone).map(([k, v]) => [k, v.length])));
    for (const want of expects) {
      const hit = slots.find(s => s.text.includes(want));
      console.log(`   ${hit ? '✅' : '❌'} "${want}" ${hit ? `→ [${hit.zone}]` : '미캡처'}`);
    }
    // 신규 zone 샘플 출력
    for (const z of ['섹션제목', 'select옵션', '뱃지/상태', '빈상태', '카드/범례']) {
      if (byZone[z]?.length) console.log(`   [${z}] ${byZone[z].slice(0, 8).join(' | ')}`);
    }
  };

  await probe('라운드관리', '라운드 설정', ['롱기스트', '신페리오 적용홀', '라운드 기준 홀 수 설정', '홀 난이도 설정']);
  await probe('라운드관리', '카트 관리', ['사용중']);
  await probe('라운드관리', '홀별 정산 관리', ['홀별정산 사유관리', '홀정산 요청 현황']);
});

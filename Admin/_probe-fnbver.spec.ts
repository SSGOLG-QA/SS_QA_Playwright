import { test } from '../lib/fixtures';
import { navigateMenu, settle } from '../lib/adminHelpers';
import * as fs from 'fs';

// 버전 및 설정 — '현재버전' 표기 형식·위치(클래스) 정밀 점검 (extractDom 커버리지 갭 진단)
test('fnbver 현재버전 형식 점검', async ({ admin }) => {
  test.setTimeout(120_000);
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) ok = await navigateMenu(admin, '식음 관리', '버전 및 설정').catch(() => false);
  await settle(admin, 2000);

  const out = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    // ① '현재버전'을 포함한 모든 leaf-ish 요소
    const hits = [...document.querySelectorAll('*')]
      .filter(e => {
        const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
        return /현재\s*버전/.test(own);
      })
      .map(e => ({ tag: e.tagName, cls: (typeof e.className === 'string' ? e.className : ''), text: norm((e as HTMLElement).innerText) }))
      .slice(0, 10);
    // ② F&B 카드 전체 innerText (절단 없이)
    const fnbCard = [...document.querySelectorAll('.contents-box.card-col')]
      .find(e => /데이터 연동/.test((e as HTMLElement).innerText));
    const fnbFull = fnbCard ? norm((fnbCard as HTMLElement).innerText) : '(카드 없음)';
    // ③ FNBVER-04 정규식 매칭 테스트
    const body = norm(document.body.innerText);
    const reColon = /현재버전\s*:\s*\d+/.exec(body);
    const reNoColon = /현재버전\s*\d+/.exec(body);
    return { url: location.pathname, hits, fnbFull, matchColon: reColon ? reColon[0] : null, matchNoColon: reNoColon ? reNoColon[0] : null };
  });

  fs.writeFileSync('analysis/_fnbver_probe.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
});

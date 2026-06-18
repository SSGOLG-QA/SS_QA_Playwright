/**
 * IA 커버리지 → Confluence 자동 게시
 *  입력: analysis/_ia_coverage.json (ia-coverage 스펙 실행 시 writeIAReport가 생성)
 *  동작: 구현 현황을 storage HTML 표로 만들어 Confluence 페이지를 갱신(버전+1).
 *
 *  사전: ① npx playwright test --project=admin-chromium Admin/ia-coverage.spec.ts --no-deps
 *        ② 환경변수 설정
 *           CONFLUENCE_BASE   예) https://smartscoretech.atlassian.net/wiki
 *           CONFLUENCE_EMAIL  예) shin02160@smartscore.kr
 *           CONFLUENCE_TOKEN  Atlassian API 토큰(https://id.atlassian.com/manage/api-tokens)
 *           CONFLUENCE_PAGE_ID 갱신할 페이지 ID (예: 1952448513)
 *  실행: npx tsc --project tsconfig.json && node dist/scripts/iaToConfluence.js
 *        (또는 ts-node scripts/iaToConfluence.ts)
 *
 *  ⚠ 무인(cron/CI) 사용 시 토큰을 시크릿으로 주입. 토큰 미설정 시 안내 후 종료.
 */
import * as fs from 'fs';

interface IAResult { menu: string; sub: string; status: string; url?: string; note?: string }
interface IACoverage { generatedAt: string; total: number; impl: number; notImpl: number; noEntry: number; results: IAResult[] }

const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildBody(d: IACoverage): string {
  const rate = d.total ? Math.round((d.impl / d.total) * 100) : 0;
  const color = (st: string) => (st === '구현' ? 'green' : 'red');
  const rows = d.results.map(r =>
    `<tr><td><p>${esc(r.menu)}</p></td><td><p>${esc(r.sub)}</p></td>` +
    `<td><p><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${color(r.status) === 'green' ? 'Green' : 'Red'}</ac:parameter><ac:parameter ac:name="title">${esc(r.status)}</ac:parameter></ac:structured-macro></p></td>` +
    `<td><p>${esc(r.url || '')}</p></td><td><p>${esc(r.note || '')}</p></td></tr>`).join('');
  return `<p><strong>IA 구현 커버리지: ${d.impl}/${d.total} (${rate}%)</strong> · 미구현 ${d.notImpl} · 진입불가 ${d.noEntry} · 생성 ${esc(d.generatedAt)}</p>`
    + `<p>※ 본 표는 ia-coverage 자동 게시 스크립트가 갱신합니다(수동 편집 시 다음 실행에 덮어쓰기됨).</p>`
    + `<table><tbody><tr><th><p>대메뉴</p></th><th><p>메뉴</p></th><th><p>구현여부</p></th><th><p>URL</p></th><th><p>비고</p></th></tr>${rows}</tbody></table>`;
}

async function main() {
  const { CONFLUENCE_BASE, CONFLUENCE_EMAIL, CONFLUENCE_TOKEN, CONFLUENCE_PAGE_ID } = process.env;
  if (!CONFLUENCE_BASE || !CONFLUENCE_EMAIL || !CONFLUENCE_TOKEN || !CONFLUENCE_PAGE_ID) {
    console.error('❌ 환경변수 필요: CONFLUENCE_BASE, CONFLUENCE_EMAIL, CONFLUENCE_TOKEN, CONFLUENCE_PAGE_ID');
    console.error('   (Atlassian API 토큰: https://id.atlassian.com/manage/api-tokens)');
    process.exit(1);
  }
  const file = 'analysis/_ia_coverage.json';
  if (!fs.existsSync(file)) {
    console.error(`❌ ${file} 없음 — 먼저 ia-coverage 스펙을 실행하세요:`);
    console.error('   npx playwright test --project=admin-chromium Admin/ia-coverage.spec.ts --no-deps');
    process.exit(1);
  }
  const d: IACoverage = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const auth = 'Basic ' + Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_TOKEN}`).toString('base64');
  const headers = { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' };

  // 현재 페이지 버전·제목 조회 (v2 API)
  const getRes = await fetch(`${CONFLUENCE_BASE}/api/v2/pages/${CONFLUENCE_PAGE_ID}?body-format=storage`, { headers });
  if (!getRes.ok) { console.error(`❌ 페이지 조회 실패 ${getRes.status}: ${await getRes.text()}`); process.exit(1); }
  const page: any = await getRes.json();
  const nextVer = (page.version?.number ?? 1) + 1;

  const putRes = await fetch(`${CONFLUENCE_BASE}/api/v2/pages/${CONFLUENCE_PAGE_ID}`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      id: CONFLUENCE_PAGE_ID, status: 'current', title: page.title,
      body: { representation: 'storage', value: buildBody(d) },
      version: { number: nextVer, message: `IA 커버리지 자동 갱신 ${d.impl}/${d.total}` },
    }),
  });
  if (!putRes.ok) { console.error(`❌ 페이지 갱신 실패 ${putRes.status}: ${await putRes.text()}`); process.exit(1); }
  console.log(`✅ Confluence 갱신 완료 — IA ${d.impl}/${d.total}(${Math.round((d.impl / d.total) * 100)}%) → v${nextVer} (page ${CONFLUENCE_PAGE_ID})`);
}

main().catch(e => { console.error('❌ 오류:', e?.message || e); process.exit(1); });

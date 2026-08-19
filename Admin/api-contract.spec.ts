/**
 * API 응답 계약 검증 스펙 (P4-2)
 *
 * 목적: 핵심 화면의 백엔드 API 응답을 직접 검증
 *   - HTTP 상태 200 · Content-Type JSON · JSON 파싱/타입 · 에러 envelope 미포함
 *   - [선택] 최상위 키 존재 / 렌더 행 수 vs API 총 건수 정합성
 *
 * ⚠ 단일 test 설계(2026-08): admin 픽스처는 test 스코프 → test마다 openAdmin(재로그인).
 *   화면별 개별 test로 두면 같은 계정 반복 로그인 → 서버 강제 로그아웃(6회쯤부터).
 *   따라서 **한 test에서 1회 로그인으로 전 화면을 순회**한다(all-suite와 동일 패턴).
 *
 * 실행: npx playwright test --project=admin-chromium Admin/api-contract.spec.ts --no-deps
 *   discovery: 각 화면 진입 시 캡처된 데이터 API(GET/POST) URL이 콘솔에 출력됨(expectedKeys 채우기용).
 *
 * ⚠ 아키텍처 발견(2026-08-05 td17 라이브): 이 어드민 SPA는 **부팅 시 데이터를 프리페치/클라이언트
 *   캐시**하고 메뉴 이동은 순수 클라이언트 렌더 → **진입 시 데이터 API 네트워크가 뜨지 않는다**
 *   (전 9화면 '데이터 API 0건'으로 관측). 하네스는 정상 동작(가짜 FAIL 없이 SKIP)이나 진입-캡처만으론
 *   API 계약을 볼 수 없다.
 *   → 후속(follow-up): 실제 API를 잡으려면 ① openAdmin(앱 부팅) 시점에 startCapture를 걸어 프리페치
 *      응답을 수집하거나, ② 화면별로 [조회]/[검색] 클릭·admin.reload()로 refetch를 유발한 뒤 캡처.
 *      (reload는 비파괴 — 데이터 변경 없이 라우트 데이터만 재요청). 라이브 세션 확보 후 검증 필요.
 */
import { test } from '../lib/fixtures';
import { resetResults, resetNoTC, resetDiff, writeReport, gotoMenu } from '../lib/reporter';
import { startCapture, checkApiContract } from '../lib/apiContract';

interface ApiScreen {
  menu: string; sub: string; kw: string; id: string; label: string;
  expectedKeys?: string[];
  countPath?: string;
  countSel?: string;
}

// kw(URL 키워드)가 빗나가도 apiContract의 fallbackAny가 임의 JSON GET로 폴백한다.
const SCREENS: ApiScreen[] = [
  { menu: '라운드 관리', sub: '내장 현황', kw: '/visit', id: 'APC-01', label: '라운드관리 > 내장 현황' },
  { menu: '라운드 관리', sub: '전체라운드', kw: '/round', id: 'APC-02', label: '라운드관리 > 전체라운드' },
  { menu: '식음 관리', sub: '주문 내역 관리', kw: '/order', id: 'APC-03', label: '식음 관리 > 주문 내역 관리' },
  { menu: '계정 관리', sub: '계정 리스트', kw: '/account', id: 'APC-04', label: '계정 관리 > 계정 리스트' },
  { menu: '대회', sub: '대회관리', kw: '/tournament', id: 'APC-05', label: '대회 > 대회관리' },
  { menu: '캐디 관리', sub: '캐디 리스트', kw: '/caddie', id: 'APC-06', label: '캐디 관리 > 캐디 리스트' },
  { menu: '고객 평가 관리', sub: '후기 리스트', kw: '/review', id: 'APC-07', label: '고객 평가 관리 > 후기 리스트' },
  { menu: '코스 운영 관리', sub: '핀 포지션 관리', kw: '/pin', id: 'APC-08', label: '코스 운영 관리 > 핀 포지션 관리' },
  { menu: '배토 관리', sub: '배토 기록 조회', kw: '/topdressing', id: 'APC-09', label: '배토 관리 > 배토 기록 조회' },
];

test('API 계약 검증 — 핵심 화면(단일 세션 순회)', async ({ admin }) => {
  test.setTimeout(15 * 60_000);
  resetResults(); resetNoTC(); resetDiff();

  // ✨P2(2026-08-19): 이 어드민 SPA는 부팅 시 데이터를 프리페치하고 검색도 클라이언트 필터라
  //   진입/[조회] 클릭으론 데이터 API가 뜨지 않음(라이브 확인: refetch-클릭 → 전 화면 0건).
  //   → **부팅 프리페치 캡처**: 전역 캡처 설치 → reload()로 재부팅(비파괴, 데이터 라우트만 재요청) →
  //     프리페치 번들 수집 → 화면별 키워드로 공유 풀에서 선택. (URL 정적자산 필터로 폰트 오탐 제거)
  const pool = startCapture(admin, '');   // kw='' → 전 데이터 응답 수집(자산 제외는 startCapture 내부)
  await admin.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await admin.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await admin.waitForTimeout(2_500);
  const loginPage = /\/login/.test(admin.url());
  console.log(`\n[boot prefetch] 데이터 API ${pool.responses.length}건 수집${loginPage ? ' ⚠세션 만료(로그인 페이지)' : ''}`);
  const bootUrls = [...new Set(pool.responses.map(r => `${r.method} ${r.status} ${new URL(r.url).pathname} [${(r.ct.split(';')[0] || '').trim()}]`))];
  bootUrls.slice(0, 40).forEach(u => console.log('  ', u));

  for (const s of SCREENS) {
    await gotoMenu(admin, s.menu, s.sub, {
      path: s.label, tcRef: 'API_CONTRACT', tcId: s.id,
      desc: `${s.sub} 메뉴 진입`, failMsg: '메뉴 진입 불가',
    });
    // 화면별 refetch도 시도(서버 조회형이면 추가 캡처 — 클라이언트 필터면 무효, 공유 풀에 누적)
    const scope = admin.locator('.contents, main').first();
    const refetch = scope.getByRole('button', { name: /^\s*(조회|검색)\s*$/ }).first();
    if (await refetch.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await refetch.click({ timeout: 2_500 }).catch(() => {});
      await admin.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
      await admin.waitForTimeout(800);
    }

    // 공유 풀(부팅 프리페치 + 화면 refetch 누적)에서 키워드로 선택. detach는 마지막에 1회.
    await checkApiContract(admin, { urlKeyword: s.kw, responses: pool.responses, detach: () => {} }, {
      path: s.label, tcRef: 'API_CONTRACT', tcId: s.id,
      expectedStatus: 200, expectedKeys: s.expectedKeys ?? [], countPath: s.countPath,
      getRenderedCount: s.countSel ? async (page) => page.locator(s.countSel!).count() : undefined,
      settleMs: 400,
    });

    const urls = [...new Set(pool.responses.filter(r => r.url.includes(s.kw)).map(r =>
      `${r.method} ${r.status} ${new URL(r.url).pathname}`))];
    console.log(`[API Discovery] ${s.label} — 키워드 '${s.kw}' 매칭 ${urls.length}건${urls.length ? ': ' + urls.join(', ') : ''}`);
  }

  pool.detach();
  await writeReport('api-contract');
});

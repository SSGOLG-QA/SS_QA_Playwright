import { expect, Page } from '@playwright/test';
import { check, checkText, skip, gotoMenu, noTC, recordIA, diff, checkRawCode, checkRowCountVsTotal } from './reporter';
import { runCommonActions } from './commonActions';
import { DataGrid } from './components/DataGrid';
import { VueSelect } from './components/VueSelect';
import { SummaryCards } from './components/SummaryCards';
import { verifyInvariants, lockOrSkipFormula } from './domain/calcChecks';
import { parseVisitRow, visitInvariants, SS_RATIO_CANDIDATES, PRINT_RATE_CANDIDATES, VisitRow } from './domain/visitStatus';

// 헤더 키를 공백무시 정규식으로 찾는 소형 getter(컬럼 드리프트 견고)
const cell = (rec: Record<string, string>, re: RegExp) => {
  const k = Object.keys(rec).find(k => re.test(k.replace(/\s+/g, '')));
  return k ? rec[k] : '';
};

// ════════════════ 계산 정합성: 내장 현황(round-visit) ════════════════
//   행 원시값에서 파생값(총=남+여·SS비율·출력률)을 재계산해 정합 검증(구조 불변식 + 공식 자동확정).
//   runRoundMgmt(내장 현황) + visit-status-calc.spec.ts 양쪽에서 호출(DRY).
export async function runVisitStatusCalc(admin: Page) {
  const P = '라운드관리 > 내장 현황 > 정합성';
  const R = '라운드 관리_CALC';
  const grid = new DataGrid(admin.locator('.table-overflow-item table'));
  await admin.locator('.table-overflow-item table tbody tr').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  if (await grid.isEmpty()) { skip({ path: P, tcRef: R, tcId: 'VS-CALC', desc: '내장 현황 계산 정합성' }, '데이터 없음(행 0건)'); return; }
  const rows: VisitRow[] = (await grid.records()).map(parseVisitRow);
  await verifyInvariants(admin, P, R, 'VS-CALC', rows, visitInvariants);
  await lockOrSkipFormula(admin, P, R, 'VS-RATIO-SS', 'SS회원 비율', rows, r => r.ssRatio, SS_RATIO_CANDIDATES);
  await lockOrSkipFormula(admin, P, R, 'VS-RATIO-PRINT', '출력률', rows, r => r.printRate, PRINT_RATE_CANDIDATES);
}

// ──────────────────────────────────────────────────────────────
//  검증 스위트 (공용) — 홈 / 라운드관리 / IA 구현여부
//  각 spec 및 통합 spec에서 재사용
// ──────────────────────────────────────────────────────────────

const num = (s: string) => parseInt((s || '').replace(/[^\d-]/g, ''), 10);
const norm = (s: string) => (s || '').replace(/\s+/g, '');
const fmtDot = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
const btn = (a: Page, name: string) => a.getByRole('button', { name });

const NOTICE = {
  visit: '골프장에 방문한 일별 내장객수와 스마트스코어 회원수, 출력량, 출력률 등을 확인하고 엑셀로 다운로드할 수 있습니다. 90일 동안의 기록만 확인 가능합니다. 스마트스코어 회원이 어플로 라운드를 전송받는 경우, 해당 회원정보(성별, 연령, 지역)를 골프장에서 타겟마케팅의 목적으로 활용할 수 있습니다. 내장객에게 스마트스코어 어플을 추천하고, 라운드기록을 전송받을 수 있도록 안내해 주세요.',
  stats: '스마트스코어 회원이 내장하여 라운드기록을 전송받는 경우, 골프장에서는 해당 회원의 정보를 활용하여 타겟마케팅이 가능합니다. 스마트스코어 회원이 라운드기록을 전송받은 데이터에 근거하여 골프장 내장객의 성격과 추이를 확인할 수 있습니다.',
  all: '태블릿에서 전송된 골프장의 모든 라운드가 기록되며 라운드 상세정보를 관리할 수 있습니다. 라운드 정보 및 클럽체크, 확인서는 90일간 보관됩니다. 단, 고객촬영으로 촬영한 내장객 사진은 1일간만 보관됩니다.',
  course: '코스별 롱기스트, 니어리스트, 스테리오 적용 홀을 설정하고 라운드 기준 홀 수 및 홀 난이도를 관리할 수 있습니다. 운영 정책에 맞게 라운드 기본값을 미리 설정해 두면 대회/이벤트 생성 시 동일한 기준으로 빠르게 적용할 수 있습니다.',
};

// ════════════════ 홈(Home) - TC #1~10 전수 ════════════════
export async function runHome(admin: Page) {
  const s = {
    gnbTitle: 'h1', clubName: 'h3', lang: '.title', langItem: '.slot-item',
    profile: '.profile-img', profileLayer: '.profile-layer',
    noticeContent: '.notice-content', noticeTitle: '.contents-box .fw-700.fs-24',
    noticeDate: '.contents-box span.fc-767676',
    prevBtn: 'button.btn-nav:has(i.ico-circle-arrow-prev)', nextBtn: 'button.btn-nav:has(i.ico-circle-arrow-next)',
    depth2: '.depth-2 a',
  };
  // 홈은 gotoMenu 미경유(진입 직후 화면) → RAW 스캔 명시 (그 외 화면은 gotoMenu가 자동 처리)
  await checkRawCode(admin, { path: '홈 > 텍스트', tcRef: '공통메인_RAW', tcId: 'RAW', desc: '미가공 코드/오타 미노출' });
  await check(admin, { path: '홈 > 제공정보', tcRef: '공통메인_001', tcId: 'No.1-①', desc: '헤더 영역 제공', expected: '헤더(GNB) 노출', failMsg: '헤더 미노출' },
    async () => { await expect(admin.locator(s.gnbTitle, { hasText: '관제 어드민' })).toBeVisible(); });
  await check(admin, { path: '홈 > 제공정보', tcRef: '공통메인_001', tcId: 'No.1-②', desc: '최신 공지 글 제공', expected: '공지 본문 노출', failMsg: '공지 미노출' },
    async () => { await expect(admin.locator(s.noticeContent)).toBeVisible(); });
  await check(admin, { path: '홈 > 제공정보', tcRef: '공통메인_001', tcId: 'No.1-③', desc: '좌측 메뉴 아코디언 모두 접힌 상태', expected: '하위메뉴 미노출', failMsg: 'SNB 기본 펼침' },
    async () => { await expect(admin.locator(s.depth2, { hasText: '전체라운드' })).toBeHidden(); });
  await check(admin, { path: '홈 > 헤더(GNB)', tcRef: '공통메인_002', tcId: 'No.2-①', desc: '좌측 상단 타이틀 제공', expected: 'SMARTSCORE 코스관리|골프장명 (실제: 경기관제)', failMsg: '타이틀 미노출' },
    async () => { await expect(admin.locator(s.gnbTitle).first()).toBeVisible(); });
  await check(admin, { path: '홈 > 헤더(GNB)', tcRef: '공통메인_002', tcId: 'No.2-②', desc: '로그인한 골프장명 제공', expected: '골프장명(킹즈락)', failMsg: '골프장명 미노출' },
    async () => { await expect(admin.locator(s.clubName, { hasText: '킹즈락' })).toBeVisible(); });
  await check(admin, { path: '홈 > 헤더(GNB)', tcRef: '공통메인_002', tcId: 'No.2-③', desc: '언어 선택 드롭다운 제공', expected: '언어 드롭다운', failMsg: '언어 드롭다운 미노출' },
    async () => { await expect(admin.locator(s.lang, { hasText: '한국어' }).first()).toBeVisible(); });
  await check(admin, { path: '홈 > 헤더(GNB)', tcRef: '공통메인_002', tcId: 'No.2-④', desc: '프로필 진입(사진) 버튼 제공', expected: '프로필 버튼', failMsg: '프로필 버튼 미노출' },
    async () => { await expect(admin.locator(s.profile).first()).toBeVisible(); });
  await check(admin, { path: '홈 > 메인 > 공지', tcRef: '공통메인_005', tcId: 'No.5-①', desc: '공지사항 제목 영역 제공', expected: '공지 제목', failMsg: '공지 제목 미노출' },
    async () => { await expect(admin.locator(s.noticeTitle)).toBeVisible(); });
  await check(admin, { path: '홈 > 메인 > 공지', tcRef: '공통메인_005', tcId: 'No.5-②', desc: '공지사항 본문 영역 제공', expected: '공지 본문', failMsg: '공지 본문 미노출' },
    async () => { await expect(admin.locator(s.noticeContent)).toBeVisible(); });
  await check(admin, { path: '홈 > 메인 > 공지 제목', tcRef: '공통메인_006', tcId: 'No.6-①', desc: '좌/우 이동 버튼 제공', expected: '이전/다음 버튼', failMsg: '이동 버튼 미노출' },
    async () => { await expect(admin.locator(s.prevBtn)).toBeVisible(); await expect(admin.locator(s.nextBtn)).toBeVisible(); });
  await check(admin, { path: '홈 > 메인 > 공지 제목', tcRef: '공통메인_006', tcId: 'No.6-②', desc: '공지글 제목 표시', expected: '제목 텍스트', failMsg: '제목 미노출' },
    async () => { await expect(admin.locator(s.noticeTitle)).not.toBeEmpty(); });
  await check(admin, { path: '홈 > 메인 > 공지 제목', tcRef: '공통메인_006', tcId: 'No.6-③', desc: '작성/수정 최종 일시 제공', expected: '일시', failMsg: '일시 미노출' },
    async () => { await expect(admin.locator(s.noticeDate).first()).toBeVisible(); });
  await check(admin, { path: '홈 > 메인 > 공지 제목', tcRef: '공통메인_008', tcId: 'No.8', desc: '일시 형식(YYYY.MM.DD HH:mm)', expected: '날짜시각 형식', failMsg: '일시 형식 불일치' },
    async () => { await expect(admin.locator(s.noticeDate).first()).toHaveText(/\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/); });
  await check(admin, { path: '홈 > 메인 > 공지 본문', tcRef: '공통메인_009', tcId: 'No.9', desc: '공지 본문 영역 제공', expected: '본문 비어있지 않음', failMsg: '본문 미노출' },
    async () => { await expect(admin.locator(s.noticeContent)).not.toBeEmpty(); });
  await check(admin, { path: '홈 > 헤더 > 언어', tcRef: '공통메인_003', tcId: 'No.3', desc: '언어 드롭다운 선택 시 언어 항목 제공', expected: 'English/한국어 항목', failMsg: '언어 항목 미노출' },
    async () => { await admin.locator(s.lang, { hasText: '한국어' }).first().click({ force: true }).catch(() => {}); await expect(admin.locator(s.langItem, { hasText: 'English' })).toBeVisible(); await admin.keyboard.press('Escape').catch(() => {}); });
  await admin.locator(s.profile).first().click({ force: true }).catch(() => {});
  const layer = admin.locator(s.profileLayer);
  for (const [i, label] of ['아이디', '부서', '휴대폰', '이메일', '로그아웃'].entries())
    await check(admin, { path: '홈 > 헤더 > 마이페이지 팝업', tcRef: '공통메인_004', tcId: `No.4-${i + 1}`, desc: `마이페이지 '${label}' 제공`, expected: label, failMsg: `'${label}' 미노출` },
      async () => { await expect(layer.getByText(label, { exact: false })).toBeVisible(); });
  await admin.keyboard.press('Escape').catch(() => {});
  await check(admin, { path: '홈 > 메인 > 공지 제목', tcRef: '공통메인_007', tcId: 'No.7', desc: '다음 버튼 선택 시 공지글 전환', expected: '제목 변경됨', failMsg: '공지글 미전환' },
    async () => { const b = await admin.locator(s.noticeTitle).innerText().catch(() => ''); await admin.locator(s.nextBtn).click().catch(() => {}); await expect(admin.locator(s.noticeTitle)).not.toHaveText(b); });
  skip({ path: '홈 > 메인 > 공지 본문', tcRef: '공통메인_010', tcId: 'No.10', desc: '공지글 수정 반영' }, '편집/데이터 의존 — 자동화 부적합');
}

// ════════════════ 라운드관리 - TC 예상결과 전수 ════════════════
export async function runRoundMgmt(admin: Page) {
  const M = '라운드관리';
  const dl = () => admin.waitForEvent('download', { timeout: 15_000 }).catch(() => null);

  // 1. 내장 현황
  if (await gotoMenu(admin, M, '내장 현황', { path: '라운드관리 > 내장 현황', tcRef: '라운드 관리', tcId: '진입', desc: '내장 현황 진입', failMsg: '메뉴 진입 불가' })) {
    const t = admin.locator('.table-overflow-item table');
    await checkRowCountVsTotal(admin, { path: '라운드관리 > 내장 현황 > 정합성', tcRef: '라운드 관리_DATA', tcId: 'DATA-01', desc: '총 건수 vs 렌더 행 수' });
    await check(admin, { path: '라운드관리 > 내장 현황 > 설명 영역', tcRef: '라운드 관리_001', tcId: 'No.1-①', desc: '[데이터 마케팅 바로가기] 버튼 노출', expected: '버튼', failMsg: '버튼 미노출' }, async () => { await expect(btn(admin, '데이터 마케팅 바로가기')).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 내장 현황 > 설명 영역', tcRef: '라운드 관리_001', tcId: 'No.1-②', desc: '레거시 [도움말] 버튼 미존재 확인(리뉴얼 제거)', expected: '도움말 버튼 없음', failMsg: '도움말 버튼 잔존' }, async () => { await expect(btn(admin, '도움말')).toHaveCount(0); });
    diff('라운드관리 > 내장 현황', '[도움말] 버튼', '버튼 제거(리뉴얼)', '라운드 관리_001', '기능 정상 — 현 구현 유지');
    await check(admin, { path: '라운드관리 > 내장 현황 > 테이블', tcRef: '라운드 관리_001', tcId: 'No.1-③', desc: '[내보내기] 버튼 노출', expected: '내보내기', failMsg: '버튼 미노출' }, async () => { await expect(btn(admin, '내보내기')).toBeVisible(); });
    await checkText(admin, { path: '라운드관리 > 내장 현황 > 설명 영역', tcRef: '라운드 관리_002', tcId: 'No.2', desc: '안내 문구 TC 원문 일치', expected: NOTICE.visit, failMsg: 'UI 불일치(안내 문구/띄어쓰기)' }, admin.locator('.info-box-text'));
    for (const [i, c] of ['날짜', '총 내장객', '내장객 남/여', '유효 내장객', '기존 SS회원', '신규 SS회원', '일일 SS회원', 'SS회원 비율', '출력 횟수', '출력률'].entries())
      await check(admin, { path: '라운드관리 > 내장 현황 > 테이블', tcRef: '라운드 관리_005', tcId: `No.5-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `컬럼 '${c}'`, failMsg: '컬럼 미노출' }, async () => { await expect(t.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 내장 현황 > 테이블 > 내보내기', tcRef: '라운드 관리_017', tcId: 'No.17', desc: '[내보내기] 클릭 시 다운로드 발생', expected: 'download', failMsg: '다운로드 미발생' }, async () => { const d = dl(); await btn(admin, '내보내기').click(); expect(await d).not.toBeNull(); });
    // ✨계산 정합성(2026-06-17): 행 원시값↔파생값(총=남+여·SS비율·출력률) 재계산 검증
    await runVisitStatusCalc(admin);
  }

  // 2. 내장 통계
  if (await gotoMenu(admin, M, '내장 통계', { path: '라운드관리 > 내장 통계', tcRef: '라운드 관리', tcId: '진입', desc: '내장 통계 진입', failMsg: '메뉴 진입 불가' })) {
    await check(admin, { path: '라운드관리 > 내장 통계 > 설명 영역', tcRef: '라운드 관리_018', tcId: 'No.18-①', desc: '[데이터 마케팅 바로가기] 버튼', expected: '버튼', failMsg: '버튼 미노출' }, async () => { await expect(btn(admin, '데이터 마케팅 바로가기')).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 내장 통계 > 검색 영역', tcRef: '라운드 관리_018', tcId: 'No.18-②', desc: '[초기화]/[적용] 버튼', expected: '초기화/적용', failMsg: '버튼 미노출' }, async () => { await expect(btn(admin, '초기화')).toBeVisible(); await expect(btn(admin, '적용')).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 내장 통계 > 카드 요약', tcRef: '라운드 관리_018', tcId: 'No.18-③', desc: '카드 요약 영역', expected: 'summary-card', failMsg: '카드 미노출' }, async () => { await expect(admin.locator('.summary-card').first()).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 내장 통계 > 필터 버튼', tcRef: '라운드 관리_018', tcId: 'No.18-④', desc: '필터 버튼 영역', expected: '전체보기', failMsg: '필터 미노출' }, async () => { await expect(btn(admin, '전체보기')).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 내장 통계 > 테이블', tcRef: '라운드 관리_018', tcId: 'No.18-⑤', desc: '일별 내장 통계 테이블 영역', expected: 'table', failMsg: '테이블 미노출' }, async () => { await expect(admin.locator('.table-overflow-item table')).toBeVisible(); });
    await checkText(admin, { path: '라운드관리 > 내장 통계 > 설명 영역', tcRef: '라운드 관리_020', tcId: 'No.20', desc: '안내 문구 TC 원문 일치', expected: NOTICE.stats, failMsg: 'UI 불일치(안내 문구/띄어쓰기)' }, admin.locator('.info-box-text'));
    for (const [i, l] of ['총 스스회원 내장객', '일평균 스스 회원수', '남성/여성 비중'].entries())
      await check(admin, { path: '라운드관리 > 내장 통계 > 카드 요약', tcRef: '라운드 관리_029', tcId: `No.29-${i + 1}`, desc: `카드 '${l}' 노출`, expected: l, failMsg: '카드 미노출' }, async () => { await expect(new SummaryCards(admin).card(l)).toBeVisible(); });
    for (const [i, b] of ['전체보기', '성별만 보기', '연령만 보기'].entries())
      await check(admin, { path: '라운드관리 > 내장 통계 > 필터 버튼', tcRef: '라운드 관리_035', tcId: `No.35-${i + 1}`, desc: `필터 [${b}] 노출`, expected: `[${b}]`, failMsg: '필터 버튼 미노출' }, async () => { await expect(btn(admin, b)).toBeVisible(); });
    // No.33/45/50 은 데이터 의존(조회기간 내 SS회원 내장) → 0건이면 빈 상태("내역이 없습니다") → SKIP, 데이터 있으면 검증
    const statEmpty = (await admin.locator('.table-overflow-item table tbody tr', { hasText: '내역이 없습니다' }).count().catch(() => 0)) > 0
      || (await admin.locator('.summary-card').filter({ hasText: '총 스스회원 내장객' }).filter({ hasText: /(^|\D)0명/ }).count().catch(() => 0)) > 0;
    if (statEmpty) {
      skip({ path: '라운드관리 > 내장 통계 > 카드 > 남성/여성 비중', tcRef: '라운드 관리_033', tcId: 'No.33', desc: '남성/여성 비중 합 ≈ 100%' }, '데이터 없음(조회기간 내 SS회원 내장 0건)');
      skip({ path: '라운드관리 > 내장 통계 > 통계표(첫 행)', tcRef: '라운드 관리_045', tcId: 'No.45', desc: '첫 행 남+여+기타 = SS회원수' }, '데이터 없음(통계표 빈 상태)');
      skip({ path: '라운드관리 > 내장 통계 > 통계표 > 내보내기', tcRef: '라운드 관리_050', tcId: 'No.50', desc: '[내보내기] 클릭 시 다운로드 발생' }, '데이터 없음(내보낼 통계 없음)');
    } else {
      await check(admin, { path: '라운드관리 > 내장 통계 > 카드 > 남성/여성 비중', tcRef: '라운드 관리_033', tcId: 'No.33', desc: '남성/여성 비중 합 ≈ 100%', expected: '≈100%', failMsg: '비중 합 100% 아님' }, async () => { const x = await admin.locator('.summary-card').filter({ hasText: '남성/여성 비중' }).locator('.summary-card__value').innerText(); const ns = (x.match(/\d+/g) || []).map(Number); expect(ns.length).toBeGreaterThanOrEqual(2); expect(Math.abs(ns[0] + ns[1] - 100)).toBeLessThanOrEqual(1); });
      await check(admin, { path: '라운드관리 > 내장 통계 > 통계표(첫 행)', tcRef: '라운드 관리_045', tcId: 'No.45', desc: '첫 행 남+여+기타 = SS회원수', expected: '남+여+기타=SS회원수', failMsg: '성별 합 ≠ SS회원수' }, async () => { const r = admin.locator('.table-overflow-item table tbody tr').first().locator('td'); const ss = num(await r.nth(1).innerText()); const m = num(await r.nth(2).innerText()); const f = num(await r.nth(3).innerText()); const e = num(await r.nth(4).innerText()); expect(m + f + e, `${m}+${f}+${e}≠${ss}`).toBe(ss); });
      await check(admin, { path: '라운드관리 > 내장 통계 > 통계표 > 내보내기', tcRef: '라운드 관리_050', tcId: 'No.50', desc: '[내보내기] 클릭 시 다운로드 발생', expected: 'download', failMsg: '다운로드 미발생' }, async () => { const d = dl(); await btn(admin, '내보내기').click(); expect(await d).not.toBeNull(); });
    }
    // No.26 (조회기간 1년 초과 제한 알럿): 데이트피커가 '달력 전용'이라 fill/타이핑이 모델에 반영되지 않고
    //   (달력 클릭 구동은 불안정), 알럿은 openAdmin 자동 [확인] 핸들러로 닫힘 → 자동화 부적합 → SKIP(사유 명시).
    //   ※ 알럿 팝업 구조(.modal-footer 확인) 자체의 자동 처리는 핸들러 단위로 검증 완료.
    skip({ path: '라운드관리 > 내장 통계 > 검색 영역 > 조회기간', tcRef: '라운드 관리_026', tcId: 'No.26', desc: '조회기간 1년 초과 시 제한 알럿' }, '데이트피커 달력 전용(fill/타이핑 미반영) + 알림 자동 핸들러로 닫힘 → 자동화 부적합(수동 확인)');
  }

  // 3. 전체라운드
  if (await gotoMenu(admin, M, '전체라운드', { path: '라운드관리 > 전체라운드', tcRef: '라운드 관리', tcId: '진입', desc: '전체라운드 진입', failMsg: '메뉴 진입 불가' })) {
    const t = admin.locator('.table-overflow-item table');
    await checkRowCountVsTotal(admin, { path: '라운드관리 > 전체라운드 > 정합성', tcRef: '라운드 관리_DATA', tcId: 'DATA-03', desc: '총 건수 vs 렌더 행 수' });
    await check(admin, { path: '라운드관리 > 전체라운드 > 설명 영역', tcRef: '라운드 관리_054', tcId: 'No.54-①', desc: '설명(안내문구) 영역', expected: 'info-box', failMsg: '설명 영역 미노출' }, async () => { await expect(admin.locator('.info-box-text')).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 전체라운드 > 검색 영역', tcRef: '라운드 관리_054', tcId: 'No.54-②', desc: '검색 영역', expected: '검색', failMsg: '검색 영역 미노출' }, async () => { await expect(admin.getByPlaceholder('내장객 입력')).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 전체라운드 > 테이블', tcRef: '라운드 관리_054', tcId: 'No.54-③', desc: '테이블 영역', expected: 'table', failMsg: '테이블 미노출' }, async () => { await expect(t).toBeVisible(); });
    await checkText(admin, { path: '라운드관리 > 전체라운드 > 설명 영역', tcRef: '라운드 관리_055', tcId: 'No.55', desc: '안내 문구 TC 원문 일치', expected: NOTICE.all, failMsg: 'UI 불일치(안내 문구/띄어쓰기)' }, admin.locator('.info-box-text'));
    for (const [i, ph] of ['내장객 입력', '캐디명 입력', '디바이스 입력', '단체팀 입력', '카트번호 입력'].entries())
      await check(admin, { path: '라운드관리 > 전체라운드 > 검색 영역', tcRef: '라운드 관리_056', tcId: `No.56-${i + 1}`, desc: `검색 필드 '${ph}' 노출`, expected: ph, failMsg: '검색 필드 미노출' }, async () => { await expect(admin.getByPlaceholder(ph)).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 전체라운드 > 검색 영역', tcRef: '라운드 관리_056', tcId: 'No.56-⑥', desc: '[초기화]/[적용] 버튼', expected: '초기화/적용', failMsg: '버튼 미노출' }, async () => { await expect(btn(admin, '초기화')).toBeVisible(); await expect(btn(admin, '적용')).toBeVisible(); });
    for (const [i, c] of ['순번', '날짜', '티타임', '코스', '캐디', '진행시간', '내장객', '단체명', '스코어카드', '사진', '클럽체크', '중대재해 확인서', '추가 확인서', '카트확인서', '캐디수첩'].entries())
      await check(admin, { path: '라운드관리 > 전체라운드 > 테이블', tcRef: '라운드 관리_075', tcId: `No.75-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `컬럼 '${c}'`, failMsg: '컬럼 미노출' }, async () => { await expect(t.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  }

  // 4. 라운드 설정
  if (await gotoMenu(admin, M, '라운드 설정', { path: '라운드관리 > 라운드 설정', tcRef: '라운드 관리', tcId: '진입', desc: '라운드 설정 진입', failMsg: '메뉴 진입 불가' })) {
    await checkText(admin, { path: '라운드관리 > 라운드 설정 > 설명 영역', tcRef: '라운드 관리_168', tcId: 'No.168-①', desc: '안내 문구 TC 원문 일치', expected: NOTICE.course, failMsg: 'UI 불일치(안내 문구/띄어쓰기)' }, admin.locator('.info-box-text'));
    for (const [i, sec] of ['롱기스트 / 니어리스트', '신페리오 적용홀', '라운드 기준 홀 수 설정', '홀 난이도 설정'].entries())
      await check(admin, { path: '라운드관리 > 라운드 설정 > 섹션', tcRef: '라운드 관리_168', tcId: `No.168-${i + 2}`, desc: `'${sec}' 설정 영역 제공`, expected: sec, failMsg: '설정 영역 미노출' }, async () => { await expect(admin.locator('.sub-title-box', { hasText: sec }).first()).toBeVisible(); });
    await check(admin, { path: '라운드관리 > 라운드 설정 > 홀 선택', tcRef: '라운드 관리_170', tcId: 'No.170', desc: '홀 카드(토글) 노출', expected: 'hole-toggle-btn', failMsg: '홀 카드 미노출' }, async () => { await expect(admin.locator('.hole-toggle-btn').first()).toBeVisible(); });
  }

  // 5. 홀별정산관리 — 관제어드민 상세 TC #288~300 전수
  if (await gotoMenu(admin, M, '홀별정산관리', { path: '라운드관리 > 홀별정산관리', tcRef: '관제어드민상세_288', tcId: '진입', desc: '홀별정산관리 진입', failMsg: '메뉴 진입 불가' }))
    await runHoleCalc(admin);

  // 6. 카트관리 — IA No.7 (드라이브 상세 TC 미작성 → 구조 기반 전수)
  if (await gotoMenu(admin, M, '카트관리', { path: '라운드관리 > 카트관리', tcRef: '카트관리_1', tcId: '진입', desc: '카트관리 진입', failMsg: '메뉴 진입 불가' }))
    await runCartMgmt(admin);

  // 7. SNB 존재 / TC 미존재 → 이슈
  if (await gotoMenu(admin, M, '단체라운드', { path: '라운드관리 > 단체라운드', tcRef: '-', tcId: '진입', desc: '단체라운드 진입', failMsg: '메뉴 진입 불가' })) noTC('라운드관리 > 단체라운드', admin.url(), '범위제외(단체팀 고도화 별도) + 상세 TC 미작성');
}

// ════════════════ 카트관리 - IA No.7 (구조 기반 TC) ════════════════
//   URL: /club/page/cart-all  · 필터(사용 구분) + 카트추가 + 목록(5컬럼) + 페이지네이션
//   ⚠ [카트추가]/[사용중지]는 실데이터 변경 → 노출·활성만 검증(비파괴). [적용]/페이지이동은 읽기 전용
export async function runCartMgmt(admin: Page) {
  const P = '라운드관리 > 카트관리';
  const R = '카트관리';
  const table = admin.locator('.table-overflow-item table').first();

  await checkRowCountVsTotal(admin, { path: `${P} > 정합성`, tcRef: `${R}_DATA`, tcId: 'DATA-카트', desc: '총 건수 vs 렌더 행 수' });

  // ── No.1 설명 문구(원문 일치) ───────────────────────────────
  await checkText(admin, { path: `${P} > 설명 영역`, tcRef: `${R}_2`, tcId: 'CART-02', desc: '안내 문구 TC 원문 일치', expected: '골프장에서 운영 중인 카트를 관리하고 카트의 라운드 기록을 확인할 수 있습니다.', failMsg: 'UI 불일치(안내 문구)' }, admin.locator('.info-box-text'));

  // ── No.2 필터/액션 바 ───────────────────────────────────────
  await check(admin, { path: `${P} > 필터`, tcRef: `${R}_3`, tcId: 'CART-03', desc: '사용 구분 필터(vue-select) 노출', expected: 'vs-dropdown', failMsg: '필터 미노출' },
    async () => { await expect(admin.locator('.vs__dropdown-toggle, .vs__search').first()).toBeVisible(); });
  await check(admin, { path: `${P} > 필터`, tcRef: `${R}_4`, tcId: 'CART-04', desc: '[적용] 버튼 노출', expected: '적용', failMsg: '적용 버튼 미노출' },
    async () => { await expect(btn(admin, '적용')).toBeVisible(); });
  await check(admin, { path: `${P} > 액션`, tcRef: `${R}_5`, tcId: 'CART-05', desc: '[카트추가] 버튼 노출·활성(클릭 미수행·비파괴)', expected: '카트추가 enabled', failMsg: '카트추가 버튼 미노출/비활성' },
    async () => { await expect(btn(admin, '카트추가')).toBeVisible(); await expect(btn(admin, '카트추가')).toBeEnabled(); });

  // ── No.3 목록 테이블 5컬럼 ──────────────────────────────────
  for (const [i, c] of ['카트번호', '라운드 횟수', '라운드 기록', '상태', '관리'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_6`, tcId: `CART-06-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `컬럼 '${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(table.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });

  // ── No.4 행 액션(첫 데이터 행 스코프) — 보기 / 사용중지 ──────
  const row = table.locator('tbody tr').first();
  await check(admin, { path: `${P} > 테이블 > 행`, tcRef: `${R}_7`, tcId: 'CART-07', desc: '행 [라운드 기록 보기] 버튼 노출(행 스코프)', expected: '보기', failMsg: '보기 버튼 미노출' },
    async () => { await expect(row.getByRole('button', { name: '보기' })).toBeVisible(); });
  await check(admin, { path: `${P} > 테이블 > 행`, tcRef: `${R}_8`, tcId: 'CART-08', desc: '행 [사용중지] 버튼 노출(클릭 미수행·비파괴)', expected: '사용중지', failMsg: '사용중지 버튼 미노출' },
    async () => { await expect(row.getByRole('button', { name: '사용중지' })).toBeVisible(); });

  // ── No.5 [적용] 클릭 → 목록 유지(읽기 전용·기본필터 '전체') ──
  await check(admin, { path: `${P} > 필터 > 적용`, tcRef: `${R}_9`, tcId: 'CART-09', desc: '[적용] 클릭 시 목록 정상 갱신/유지', expected: '테이블 노출 유지', failMsg: '적용 후 테이블 미노출' },
    async () => { await btn(admin, '적용').click(); await admin.waitForTimeout(1000); await expect(table).toBeVisible(); await expect(table.locator('tbody tr').first()).toBeVisible(); });

  // ── No.6 페이지네이션(15p → ellipsis 존재) ──────────────────
  await check(admin, { path: `${P} > 페이지네이션`, tcRef: `${R}_10`, tcId: 'CART-10', desc: '페이지네이션 노출(다중 페이지)', expected: '페이지 버튼/…', failMsg: '페이지네이션 미노출' },
    async () => { await expect(admin.locator('.ellipsis, .pagination .active, button.active').first()).toBeVisible(); });
}

// ════════════════ 홀별정산관리 - 관제어드민 상세 TC #288~300 ════════════════
//   URL: /club/page/live-hole-calc  · 3개 섹션(① 활성화 ② 사유관리 ③ 요청현황)
//   ⚠ [저장] 버튼은 골프장 설정을 영구 반영하므로 클릭하지 않음(비파괴) — 토글은 검증 후 원상복구
export async function runHoleCalc(admin: Page) {
  const P = '라운드관리 > 홀별정산관리';
  const R = '관제어드민상세';
  // 섹션마다 저장/초기화 중복 → .contents-box 컨테이너로 스코프 (locator 분석 문서 기준)
  // 검색폼은 '홀정산 요청 현황' 박스, 결과 테이블은 별도 .list-table-group 박스에 위치
  const secStatus = admin.locator('.contents-box').filter({ hasText: '홀정산 요청 현황' });
  const resultTable = admin.locator('.list-table-group');


  // 섹션 서브타이틀은 화면상 공백 포함('홀별 정산 관리') → 공백 무시 정규식으로 매칭
  // (hasText 문자열은 공백 단일화만 하고 검색어 공백은 유지 → 불일치, regex로 회피)
  const SECS: { label: string; rx: RegExp }[] = [
    { label: '홀별정산관리', rx: /홀별\s*정산\s*관리/ },
    { label: '홀별정산 사유관리', rx: /홀별\s*정산\s*사유\s*관리/ },
    { label: '홀정산 요청 현황', rx: /홀정산\s*요청\s*현황/ },
  ];

  // 진입 직후 SPA 렌더 안정화 가드 — 첫 섹션 노출까지 대기(No.288-1 간헐 플레이크 방지)
  await admin.locator('.sub-title-box', { hasText: SECS[0].rx }).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  // ── No.288 화면 구성: 3개 섹션 + 안내문구 ──────────────────
  for (const [i, { label, rx }] of SECS.entries())
    await check(admin, { path: `${P} > 구성`, tcRef: `${R}_288`, tcId: `No.288-${i + 1}`, desc: `'${label}' 섹션(서브타이틀) 노출`, expected: label, failMsg: '섹션 미노출' },
      async () => { await expect(admin.locator('.sub-title-box', { hasText: rx }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 설명 영역`, tcRef: `${R}_288`, tcId: 'No.288-④', desc: '활성화 안내 문구 노출', expected: '플레이한 홀 수가 별도로 기록', failMsg: '안내 문구 미노출' },
    async () => { await expect(admin.locator('.info-box-text', { hasText: '플레이한 홀 수' }).first()).toBeVisible(); });

  // ── No.289 / No.290 홀정산 요청 활성화 토글 ON/OFF (저장 미반영·원상복구) ──
  // 토글 input id(tgv-N-0)는 SPA 네비게이션마다 동적 채번 → id 대신 활성화 섹션 + .toggle-switch 구조로 스코프
  // 숨김 input → 보이는 label 클릭으로 조작 (커스텀 토글)
  const actSection = admin.locator('.contents-box').filter({ hasText: '홀정산 요청 기능을 활성화' });
  const toggle = actSection.locator('.toggle-switch input[type="checkbox"]').first();
  const toggleLabel = actSection.locator('.toggle-switch label').first();
  const orig = await toggle.isChecked().catch(() => false);
  await check(admin, { path: `${P} > 활성화 토글`, tcRef: `${R}_289`, tcId: 'No.289', desc: '[홀정산 요청 활성화] 토글 ON 가능', expected: 'checked=true', failMsg: '토글 ON 불가' },
    async () => { if (!(await toggle.isChecked())) await toggleLabel.click(); await expect(toggle).toBeChecked(); });
  await check(admin, { path: `${P} > 활성화 토글`, tcRef: `${R}_290`, tcId: 'No.290', desc: '[홀정산 요청 활성화] 토글 OFF 가능', expected: 'checked=false', failMsg: '토글 OFF 불가' },
    async () => { if (await toggle.isChecked()) await toggleLabel.click(); await expect(toggle).not.toBeChecked(); });
  if ((await toggle.isChecked().catch(() => false)) !== orig) await toggleLabel.click().catch(() => {});   // 진입 시 상태로 원복(저장 안 함)

  // ── No.291~293 정산 사유 직접입력 (최대 3개) ────────────────
  const reasons = admin.getByPlaceholder('직접입력');
  for (const i of [0, 1, 2])
    await check(admin, { path: `${P} > 사유관리`, tcRef: `${R}_${291 + i}`, tcId: `No.${291 + i}`, desc: `정산 사유 직접입력 ${i + 1}번째 필드 노출`, expected: `직접입력 #${i + 1}`, failMsg: '사유 입력 필드 미노출' },
      async () => { await expect(reasons.nth(i)).toBeVisible(); });

  // ── No.298 사유는 최대 3개 — 4번째 입력 필드 없음(추가 차단) ──
  await check(admin, { path: `${P} > 사유관리`, tcRef: `${R}_298`, tcId: 'No.298', desc: '정산 사유 직접입력은 최대 3개(4번째 미존재)', expected: '직접입력 필드 = 3개', failMsg: '사유 4개 이상 노출(최대 3개 제한 위반)' },
    async () => { await expect(reasons).toHaveCount(3); });

  // ── No.294 검색 조회일(datepicker ×2) ───────────────────────
  const dates = secStatus.locator('.datepicker-input');
  await check(admin, { path: `${P} > 요청현황 > 검색`, tcRef: `${R}_294`, tcId: 'No.294', desc: '조회일 datepicker(시작/종료) 노출', expected: 'datepicker ×2', failMsg: '조회일 입력 미노출' },
    async () => { await expect(dates).toHaveCount(2); await expect(dates.first()).toBeVisible(); });

  // ── No.295 내장객 검색 / No.296 캐디명 검색 ──────────────────
  await check(admin, { path: `${P} > 요청현황 > 검색`, tcRef: `${R}_295`, tcId: 'No.295', desc: "내장객 검색 필드('내장객') 노출", expected: '내장객', failMsg: '내장객 검색 필드 미노출' },
    async () => { await expect(admin.getByPlaceholder('내장객')).toBeVisible(); });
  await check(admin, { path: `${P} > 요청현황 > 검색`, tcRef: `${R}_296`, tcId: 'No.296', desc: "캐디명 검색 필드('캐디명') 노출", expected: '캐디명', failMsg: '캐디명 검색 필드 미노출' },
    async () => { await expect(admin.getByPlaceholder('캐디명')).toBeVisible(); });
  await check(admin, { path: `${P} > 요청현황 > 검색`, tcRef: `${R}_296`, tcId: 'No.296-②', desc: '[검색] 버튼 노출', expected: '검색 버튼', failMsg: '검색 버튼 미노출' },
    async () => { await expect(btn(admin, '검색')).toBeVisible(); });

  // ── No.297 조회 실행 → 결과/빈 상태(읽기 전용, 비파괴) ───────
  await check(admin, { path: `${P} > 요청현황 > 조회결과`, tcRef: `${R}_297`, tcId: 'No.297', desc: '조회일(오늘) 검색 시 결과 또는 빈 상태 노출', expected: '행 ≥0 / "홀정산 기록이 없습니다"', failMsg: '검색 결과·빈 상태 모두 미노출' },
    async () => {
      const t = fmtDot(new Date());
      await dates.first().fill(t); await dates.nth(1).fill(t);
      await btn(admin, '검색').click();
      await admin.waitForTimeout(1200);
      const empty = await admin.getByText('홀정산 기록이 없습니다').isVisible().catch(() => false);
      const rows = await resultTable.locator('tbody tr').count().catch(() => 0);
      expect(empty || rows > 0, '빈 상태/결과 행 모두 없음').toBeTruthy();
    });

  // ── No.299 요청 현황 테이블 컬럼 (결과 테이블 .list-table-group 스코프) ──
  for (const [i, c] of ['No.', '정산 요청 시간', '티타임', '캐디명', '고객명', '플레이한 홀 수', '정산 사유'].entries())
    await check(admin, { path: `${P} > 요청현황 > 테이블`, tcRef: `${R}_299`, tcId: `No.299-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `컬럼 '${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(resultTable.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });

  // ── No.300 정렬 헤더(.th-sortable) + 요청 팀 수 표시 ─────────
  await check(admin, { path: `${P} > 요청현황 > 테이블`, tcRef: `${R}_300`, tcId: 'No.300-①', desc: '정렬 가능 헤더(정산 요청 시간/티타임/플레이한 홀 수) 3개', expected: 'th-sortable ×3', failMsg: '정렬 헤더 미노출' },
    async () => { await expect(resultTable.locator('.th-sortable')).toHaveCount(3); });
  await check(admin, { path: `${P} > 요청현황`, tcRef: `${R}_300`, tcId: 'No.300-②', desc: "'요청 팀 수 : N 팀' 카운트 노출", expected: '요청 팀 수 : N 팀', failMsg: '요청 팀 수 미노출' },
    async () => { await expect(admin.getByText(/요청 팀 수\s*:\s*\d+\s*팀/)).toBeVisible(); });
}

// ════════════════ 관제관리 > 아이콘 관리 - 구조 기반 TC ════════════════
//   URL: /club/page/live-icon  · 4개 섹션(① 기능설정 ② 사용중인 아이콘 ③ 코스별 색상 ④ 그늘집 위치)
//   ⚠ [관제적용]/[저장]/[변경]/카드[✕]는 골프장 설정 영구 반영 → 노출·활성만 검증(비파괴)
//   ⚠ 토글 id(tgv-1-0/1/2)는 SPA 네비게이션마다 동적 채번 → id 의존 금지(섹션 스코프)
//   ⚠ 아이콘 개수(14)·코스 수(3 South/East/West)는 골프장 데이터 의존 → 존재(≥1)로 검증
export async function runIconMgmt(admin: Page) {
  const P = '관제관리 > 아이콘 관리';
  const R = '아이콘관리';

  // 진입 안정화 — 첫 섹션(기능 설정) 서브타이틀 노출까지 대기
  const secFeature = admin.locator('.contents-box').filter({ hasText: '기능 설정' });
  const secIcons = admin.locator('.contents-box').filter({ hasText: '사용중인 아이콘' });
  await secFeature.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  // ── ① 기능 설정 ─────────────────────────────────────────────
  // 안내문구는 .sub-title-box 내 .desc-text(제목 .sub-title과 분리) → desc-text로 스코프
  await checkText(admin, { path: `${P} > 기능 설정 > 설명`, tcRef: `${R}_1`, tcId: 'ICON-01', desc: '기능 설정 안내 문구 노출', expected: '관제지도 아이콘 시인성 향상 및 아이콘 관리 기능의 사용 여부를 설정합니다.', failMsg: 'UI 불일치(안내 문구)' },
    secFeature.locator('.desc-text'));
  // 컬럼명은 리뉴얼로 공백 가변('상세설명'→'상세 설명') → 공백 무시 정규식 매칭
  const ICON_COLS: { label: string; rx: RegExp }[] = [
    { label: '기능명', rx: /기능명/ }, { label: '상세 설명', rx: /상세\s*설명/ }, { label: '설정', rx: /설정/ },
  ];
  for (const [i, { label, rx }] of ICON_COLS.entries())
    await check(admin, { path: `${P} > 기능 설정 > 테이블`, tcRef: `${R}_2`, tcId: `ICON-02-${i + 1}`, desc: `컬럼 '${label}' 노출`, expected: `컬럼 '${label}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: rx }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 기능 설정 > 토글`, tcRef: `${R}_3`, tcId: 'ICON-03', desc: '기능 토글 노출(시인성 향상/아이콘 관리 ≥2, id 비의존)', expected: 'checkbox ≥2', failMsg: '기능 토글 미노출' },
    async () => { expect(await secFeature.locator('input[type="checkbox"]').count()).toBeGreaterThanOrEqual(2); });
  // [관제적용] 버튼은 리뉴얼에서 제거(토글 즉시 반영·자동저장) → AS-IS(부재) 확인 + 기획-구현 차이 기록
  await check(admin, { path: `${P} > 기능 설정 > 액션`, tcRef: `${R}_4`, tcId: 'ICON-04', desc: '레거시 [관제적용] 버튼 미존재 확인(토글 즉시반영 방식)', expected: '관제적용 버튼 없음', failMsg: '관제적용 버튼 잔존' },
    async () => { await expect(secFeature.getByRole('button', { name: '관제적용' })).toHaveCount(0); });
  diff(`${P} > 기능 설정`, '[관제적용] 버튼으로 설정 반영', '버튼 없음 — 토글 즉시 반영(자동 적용)', `${R}_4`, '기능 정상 — 현 구현 유지');

  // ── ② 사용중인 아이콘 (카드 목록, 개수는 데이터 의존) ─────────
  await check(admin, { path: `${P} > 사용중인 아이콘`, tcRef: `${R}_5`, tcId: 'ICON-05', desc: '아이콘 카드 목록 노출(≥1)', expected: 'icon-card ≥1', failMsg: '아이콘 카드 미노출' },
    async () => { await expect(secIcons.locator('.icon-card').first()).toBeVisible(); });
  await check(admin, { path: `${P} > 사용중인 아이콘 > 카드`, tcRef: `${R}_6`, tcId: 'ICON-06', desc: '카드 제외(✕) 버튼 노출(클릭 미수행·비파괴)', expected: 'icon-card-x', failMsg: '✕ 버튼 미노출' },
    async () => { await expect(secIcons.locator('.icon-card-x').first()).toBeVisible(); });
  // 아이콘명 편집 input은 '아이콘 관리' 기능 ON 시에만 렌더 → OFF면 읽기전용 .icon-card-title(AS-IS)
  const editInputs = await secIcons.locator('.icon-card-input').count();
  if (editInputs > 0)
    await check(admin, { path: `${P} > 사용중인 아이콘 > 카드`, tcRef: `${R}_7`, tcId: 'ICON-07', desc: "'아이콘 관리' 기능 ON — 아이콘명 입력 필드 노출", expected: 'icon-card-input', failMsg: '아이콘명 입력 미노출' },
      async () => { await expect(secIcons.locator('.icon-card-input').first()).toBeVisible(); });
  else {
    await check(admin, { path: `${P} > 사용중인 아이콘 > 카드`, tcRef: `${R}_7`, tcId: 'ICON-07', desc: "'아이콘 관리' 기능 OFF — 카드 읽기전용 타이틀(.icon-card-title) 노출", expected: 'icon-card-title 노출', failMsg: '카드 타이틀 미노출' },
      async () => { await expect(secIcons.locator('.icon-card-title').first()).toBeVisible(); });
    diff(`${P} > 사용중인 아이콘`, '카드별 아이콘명 입력필드 상시 편집', "'아이콘 관리' 기능 OFF 시 읽기전용 타이틀, 편집 input 미노출(ON 시 편집 가능)", `${R}_7`, '기능 토글 상태 의존 — 현 구현 유지');
  }
  // [저장]은 '아이콘 관리' 기능 ON(편집 가능) 시 활성, OFF(읽기전용) 시 노출되나 비활성(AS-IS)
  const saveBtn = secIcons.getByRole('button', { name: '저장' }).first();
  if (editInputs > 0)
    await check(admin, { path: `${P} > 사용중인 아이콘 > 액션`, tcRef: `${R}_8`, tcId: 'ICON-08', desc: "'아이콘 관리' 기능 ON — [저장] 버튼 노출·활성(섹션 스코프·비파괴)", expected: '저장 enabled', failMsg: '저장 버튼 미노출/비활성' },
      async () => { await expect(saveBtn).toBeVisible(); await expect(saveBtn).toBeEnabled(); });
  else
    await check(admin, { path: `${P} > 사용중인 아이콘 > 액션`, tcRef: `${R}_8`, tcId: 'ICON-08', desc: "'아이콘 관리' 기능 OFF — [저장] 버튼 노출(읽기전용이라 비활성, 비파괴)", expected: '저장 노출(비활성)', failMsg: '저장 버튼 미노출' },
      async () => { await expect(saveBtn).toBeVisible(); });

  // ── ③ 코스별 아이콘 색상 ────────────────────────────────────
  await check(admin, { path: `${P} > 코스별 색상 > 테이블`, tcRef: `${R}_9`, tcId: 'ICON-09', desc: "컬럼 '아이콘 색상' 노출", expected: '아이콘 색상', failMsg: '색상 테이블 미노출' },
    async () => { await expect(admin.getByRole('columnheader', { name: '아이콘 색상', exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 코스별 색상 > 액션`, tcRef: `${R}_10`, tcId: 'ICON-10', desc: '[변경] 버튼 노출(코스별·클릭 미수행·비파괴)', expected: '변경 ≥1', failMsg: '변경 버튼 미노출' },
    async () => { await expect(btn(admin, '변경').first()).toBeVisible(); });

  // ── ④ 코스별 그늘집 위치 ────────────────────────────────────
  await check(admin, { path: `${P} > 그늘집 위치 > 테이블`, tcRef: `${R}_11`, tcId: 'ICON-11', desc: "컬럼 '그늘집 위치' 노출", expected: '그늘집 위치', failMsg: '그늘집 테이블 미노출' },
    async () => { await expect(admin.getByRole('columnheader', { name: '그늘집 위치', exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 그늘집 위치 > 홀 선택`, tcRef: `${R}_12`, tcId: 'ICON-12', desc: '홀 위치 체크박스(.check-item) 노출(≥1, 9홀×코스)', expected: 'check-item ≥1', failMsg: '홀 체크박스 미노출' },
    async () => { expect(await admin.locator('.check-item').count()).toBeGreaterThanOrEqual(1); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 관제관리 > 라이브채팅 공지 조회 - 구조 기반 TC ════════════════
//   URL: /club/page/control-live-chat · 안내문구 + 검색(조회일/공지내용) + 결과(.message-box 채팅버블)
//   ⚠ [적용]/[초기화]는 조회(읽기) 동작 → 클릭 가능(비파괴). 결과 건수는 데이터 의존(≥0)
//   🔴 공지내용 검색 필드 label이 '출력률'로 오표기(기능 정상) → 기획-구현 차이(라벨 오류)로 기록
//   결과 항목: .message-box > .item-content > .message-right > .msg-message-right(내용) + .msg-message-date(시각)
export async function runLiveChatNotice(admin: Page) {
  const P = '관제관리 > 라이브채팅 공지 조회';
  // TC참조(드라이브) 형식: 시트제목_1depth_No. (예: 관제 관리_라이브채팅 공지 조회_1)
  const R = '관제 관리_라이브채팅 공지 조회';
  // 검색폼은 '조회일' 포함 .contents-box, 결과는 .message-box (별도 박스)
  const searchBox = admin.locator('.contents-box').filter({ hasText: '조회일' });
  const messageBox = admin.locator('.message-box');

  // 진입 안정화 — 안내문구 노출까지 대기
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  // ── LIVECHAT-01 안내문구 원문 일치 ──────────────────────────
  await checkText(admin, { path: `${P} > 설명 영역`, tcRef: `${R}_1`, tcId: 'LIVECHAT-01', desc: '안내 문구 TC 원문 일치', expected: '라이브채팅의 공지사항 기록을 조회할 수 있습니다. 단, 한달 이내의 공지사항만 보관됩니다.', failMsg: 'UI 불일치(안내 문구)' },
    admin.locator('.info-box-text'));

  // ── LIVECHAT-02 조회일 datepicker(단일) ─────────────────────
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'LIVECHAT-02', desc: '조회일 datepicker 노출(YYYY.MM.DD)', expected: 'datepicker-input', failMsg: '조회일 입력 미노출' },
    async () => { await expect(searchBox.locator('.datepicker-input').first()).toBeVisible(); });

  // ── LIVECHAT-03 공지내용 검색 input(placeholder 기준 — 기능 식별) ──
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_3`, tcId: 'LIVECHAT-03', desc: "공지내용 검색 input 노출(ph '공지내용을 입력하세요')", expected: '공지내용 검색 input', failMsg: '공지내용 검색 input 미노출' },
    async () => { await expect(admin.getByPlaceholder('공지내용을 입력하세요')).toBeVisible(); });

  // ── LIVECHAT-04 초기화/적용 버튼(검색박스 스코프) ────────────
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_4`, tcId: 'LIVECHAT-04', desc: '[초기화]/[적용] 버튼 노출', expected: '초기화/적용', failMsg: '버튼 미노출' },
    async () => { await expect(searchBox.getByRole('button', { name: '초기화' })).toBeVisible(); await expect(searchBox.getByRole('button', { name: '적용' })).toBeVisible(); });

  // ── LIVECHAT-05 결과 영역(.message-box) 노출 ────────────────
  await check(admin, { path: `${P} > 결과`, tcRef: `${R}_5`, tcId: 'LIVECHAT-05', desc: '결과 영역(.message-box) 노출', expected: 'message-box', failMsg: '결과 영역 미노출' },
    async () => { await expect(messageBox.first()).toBeVisible(); });

  // ── LIVECHAT-06 메시지 항목 구조(데이터 존재 시) ─────────────
  const itemCount = await admin.locator('.message-box .item-content').count().catch(() => 0);
  if (itemCount > 0)
    await check(admin, { path: `${P} > 결과 > 항목`, tcRef: `${R}_6`, tcId: 'LIVECHAT-06', desc: '메시지 항목 구조(공지내용 + 시각) 노출', expected: 'msg-message-right + msg-message-date', failMsg: '메시지 항목 구조 미노출' },
      async () => { const first = admin.locator('.message-box .item-content').first(); await expect(first.locator('.msg-message-right').first()).toBeVisible(); await expect(first.locator('.msg-message-date').first()).toBeVisible(); });
  else
    skip({ path: `${P} > 결과 > 항목`, tcRef: `${R}_6`, tcId: 'LIVECHAT-06', desc: '메시지 항목 구조(공지내용 + 시각)' }, '조회 결과 없음(데이터 없음)');

  // ── 기획-구현 차이: 공지내용 검색 필드 label '출력률' 오표기 ──
  diff(`${P} > 검색`, "공지내용 검색 필드 라벨(공지내용 등)", "라벨이 '출력률'로 표기됨(placeholder는 '공지내용을 입력하세요')", `${R}_3`, '라벨 오류 의심 — 기능 정상, QA 확인 요망');
  await runCommonActions(admin, P, R);
}

// ════════════════ 관제관리 > 메시지 기록 조회 - 구조 기반 TC (콘텐츠 구현 확인 2026-06-08) ════════════════
//   URL: /club/page/control-message-history · 안내문구 + 검색(조회일 datepicker / 검색어) + 결과(.message-box 채팅버블: 날짜/To.{대상자}/내용/시각)
//   ⚠ 과거 '빈 화면'이었으나 콘텐츠 구현됨(2026-06 리뉴얼). SNB·TC 상세 라벨 = '메시지 기록 조회'(IA변경표의 '기기 조회' 표기와 달리 라이브는 '기록 조회'). 초기화/적용은 조회(읽기)·비파괴
export async function runMessageHistory(admin: Page) {
  const P = '관제관리 > 메시지 기록 조회';
  const R = '관제 관리_메시지 기록 조회';
  const searchBox = admin.locator('.contents-box').filter({ hasText: '조회일' });
  const messageBox = admin.locator('.message-box');
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  // ── MSGHIST-01 안내문구 원문 일치(TC No.3) ──────────────────
  await checkText(admin, { path: `${P} > 설명 영역`, tcRef: `${R}_3`, tcId: 'MSGHIST-01', desc: '안내 문구 TC 원문 일치', expected: '센터와 태블릿 간의 메시지 기록을 조회할 수 있습니다. 단, 한 달 이내의 메시지 기록만 보관됩니다.', failMsg: 'UI 불일치(안내 문구)' },
    admin.locator('.info-box-text'));
  // ── MSGHIST-02 조회일 datepicker ────────────────────────────
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'MSGHIST-02', desc: '조회일 datepicker 노출(YYYY.MM.DD)', expected: 'datepicker-input', failMsg: '조회일 입력 미노출' },
    async () => { await expect(searchBox.locator('.datepicker-input').first()).toBeVisible(); });
  // ── MSGHIST-03 검색어 input ─────────────────────────────────
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_4`, tcId: 'MSGHIST-03', desc: "검색어 input 노출(ph '검색어를 입력하세요.')", expected: '검색어 input', failMsg: '검색어 input 미노출' },
    async () => { await expect(admin.getByPlaceholder('검색어를 입력하세요.')).toBeVisible(); });
  // ── MSGHIST-04 초기화/적용 버튼(검색박스 스코프) ─────────────
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_4`, tcId: 'MSGHIST-04', desc: '[초기화]/[적용] 버튼 노출', expected: '초기화/적용', failMsg: '버튼 미노출' },
    async () => { await expect(searchBox.getByRole('button', { name: '초기화' })).toBeVisible(); await expect(searchBox.getByRole('button', { name: '적용' })).toBeVisible(); });
  // ── MSGHIST-05 결과 영역(.message-box) 노출 ─────────────────
  await check(admin, { path: `${P} > 결과`, tcRef: `${R}_8`, tcId: 'MSGHIST-05', desc: '대화창 결과 영역(.message-box) 노출', expected: 'message-box', failMsg: '결과 영역 미노출' },
    async () => { await expect(messageBox.first()).toBeVisible(); });
  // ── MSGHIST-06 대화 항목 구조(데이터 존재 시: To.{대상자} 포함) ──
  const msgTxt = (await messageBox.first().innerText().catch(() => '')).trim();
  if (msgTxt && /To\./.test(msgTxt))
    await check(admin, { path: `${P} > 결과 > 항목`, tcRef: `${R}_9`, tcId: 'MSGHIST-06', desc: '대화 항목 구조(날짜/To.{대상자}/내용) 노출', expected: 'To.{대상자}', failMsg: '대화 항목 구조 미노출' },
      async () => { await expect(messageBox.first()).toContainText('To.'); });
  else
    skip({ path: `${P} > 결과 > 항목`, tcRef: `${R}_9`, tcId: 'MSGHIST-06', desc: '대화 항목 구조(날짜/To.{대상자}/내용)' }, '조회 결과 없음(검색결과가 없습니다 / 데이터 없음)');
  await runCommonActions(admin, P, R);
}

// ════════════════ 관제관리 > 카트 이동경로 확인 - 구조 기반 제한 검증 ════════════════
//   URL: /club/page/live-cart-trace · 카트 이동경로 재생(replay)·추적 지도 도구
//   ⚠ 지도 상호작용·경로재생·슬라이더 조작은 검증 제외 → 필터·지도 컨테이너·컨트롤 노출만(비파괴)
//   ⚠ 재생 컨트롤(Ok/Clear/Prev/Next/Auto Start/Auto Stop)은 클릭 시 재생/상태 변경 → 노출만 검증, 클릭 금지
//   🔴 UI 미한글화(영문)·날짜형식 YYYY-MM-DD(대시) → 기획-구현 차이로 기록
export async function runCartTrace(admin: Page) {
  const P = '관제관리 > 카트이동경로 확인';
  // TC참조(드라이브) 형식: 시트제목_1depth_No.
  const R = '관제 관리_카트이동경로 확인';
  const ctrlBox = admin.locator('.contents-box').filter({ hasText: 'Auto Start' });

  // 진입 안정화 — 지도 컨테이너 노출까지 대기
  await admin.locator('.map-box').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  // ── CARTTRACE-01 조회일 datepicker(YYYY-MM-DD) ──────────────
  await check(admin, { path: `${P} > 필터`, tcRef: `${R}_1`, tcId: 'CARTTRACE-01', desc: '조회일 datepicker 노출(ph YYYY-MM-DD)', expected: 'datepicker-input', failMsg: '조회일 입력 미노출' },
    async () => { await expect(admin.locator('.datepicker-input').first()).toBeVisible(); });

  // ── CARTTRACE-02 캐디/조건 vue-select(≥1) ───────────────────
  await check(admin, { path: `${P} > 필터`, tcRef: `${R}_2`, tcId: 'CARTTRACE-02', desc: '캐디/조건 vue-select 드롭다운 노출(≥1)', expected: 'vs-dropdown ≥1', failMsg: 'vue-select 미노출' },
    async () => { expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(1); });

  // ── CARTTRACE-03 지도 컨테이너 ──────────────────────────────
  await check(admin, { path: `${P} > 지도`, tcRef: `${R}_3`, tcId: 'CARTTRACE-03', desc: '지도 컨테이너(.map-box) 노출', expected: 'map-box', failMsg: '지도 영역 미노출' },
    async () => { await expect(admin.locator('.map-box').first()).toBeVisible(); });

  // ── CARTTRACE-03b 지도/스카이뷰 전환 토글(노출만·클릭 금지·비파괴) ─
  // Kakao Maps SDK 렌더링 버튼: innerText 없음, title 속성으로만 식별 → button[title="지도"] 사용
  for (const [i, name] of ['지도', '스카이뷰'].entries())
    await check(admin, { path: `${P} > 지도 타입 토글`, tcRef: `${R}_3`, tcId: `CARTTRACE-03b-${i + 1}`, desc: `지도/스카이뷰 전환 버튼 [${name}] 노출(클릭 미수행·비파괴)`, expected: `[${name}]`, failMsg: `'${name}' 토글 버튼 미노출` },
      async () => { await expect(admin.locator(`button[title="${name}"]`).first()).toBeVisible(); });

  // ── CARTTRACE-04 재생 컨트롤 버튼(노출만·클릭 금지·비파괴) ───
  for (const [i, b] of ['Ok', 'Clear', 'Prev', 'Next', 'Auto Start', 'Auto Stop'].entries())
    await check(admin, { path: `${P} > 재생 컨트롤`, tcRef: `${R}_4`, tcId: `CARTTRACE-04-${i + 1}`, desc: `재생 컨트롤 [${b}] 버튼 노출(클릭 미수행·비파괴)`, expected: `[${b}]`, failMsg: '컨트롤 버튼 미노출' },
      async () => { await expect(ctrlBox.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });

  // ── CARTTRACE-05 재생 슬라이더 ──────────────────────────────
  await check(admin, { path: `${P} > 재생 상태`, tcRef: `${R}_5`, tcId: 'CARTTRACE-05', desc: '재생 슬라이더(.path-slider) 노출(조작 미수행)', expected: 'path-slider', failMsg: '슬라이더 미노출' },
    async () => { await expect(admin.locator('.path-slider').first()).toBeVisible(); });

  // ── CARTTRACE-06 재생 상태 박스(slider-val/time/acc) ─────────
  //   재생 시 갱신되는 상태 표시 요소 → 일부는 재생 전 비표시(예: acc-box) → 구조 존재(attached)로 검증
  for (const [i, sel] of [['.slider-val-box', '슬라이더 값'], ['.time-box', '시각'], ['.acc-box', '가속/정확도']].entries())
    await check(admin, { path: `${P} > 재생 상태`, tcRef: `${R}_6`, tcId: `CARTTRACE-06-${i + 1}`, desc: `재생 상태 '${sel[1]}'(${sel[0]}) 구조 존재(재생 시 갱신)`, expected: sel[0], failMsg: '상태 박스 미존재' },
      async () => { await expect(admin.locator(sel[0]).first()).toBeAttached(); });

  // ── 기획-구현 차이 ──────────────────────────────────────────
  diff(`${P} > UI`, '한글 UI(확인/초기화/이전/다음/자동재생 등)', '영문 UI(Ok/Clear/Prev/Next/Auto Start/Auto Stop/Caddie) — 미한글화', `${R}_4`, '미한글화 — 기능 정상, QA·기획 확인 요망');
  diff(`${P} > 필터`, '조회일 형식 YYYY.MM.DD(타 화면 일관)', '조회일 형식 YYYY-MM-DD(대시)', `${R}_1`, '날짜 형식 불일치 — QA 확인 요망');
  await runCommonActions(admin, P, R);
}

// ════════════════ 태블릿 운영 관리 > 태블릿 기능 설정 - 구조 기반 TC ════════════════
//   URL: /club/page/live-game · 7섹션(경기 진행 설정/카트도로 이탈 메시지/긴급호출 연락처/고객 확인서/중대재해 확인서/추가 확인서) + 패스워드 변경
//   ⚠ 내용 수정/저장/삭제/확인 항목 추가/패스워드 변경/기능 토글(tgv-1-0~13)/예·아니요는 비파괴(노출만, 클릭 금지)
//   ⚠ tgv-1-N 동적 채번 → id 비의존, 섹션 스코프 count. 통계카드 13개·확인항목 13개는 데이터 의존(≥1)
export async function runTabletFeature(admin: Page) {
  const P = '태블릿 운영 관리 > 태블릿 기능 설정';
  // TC참조(드라이브) 형식: 시트제목_1depth_No.
  const R = '태블릿 운영 관리_태블릿 기능 설정';

  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  // ── TABLET-01 안내문구 원문 일치 ────────────────────────────
  await checkText(admin, { path: `${P} > 설명 영역`, tcRef: `${R}_1`, tcId: 'TABLET-01', desc: '안내 문구 TC 원문 일치', expected: '태블릿에서 사용 가능한 기능들을 설정할 수 있습니다. 고객 확인서, 중대재해 확인서 및 카트 도로 이탈 메시지의 내용을 설정할 수 있으며, 긴급 호출 시 태블릿에 전송되는 연락처를 입력할 수 있습니다.', failMsg: 'UI 불일치(안내 문구)' },
    admin.locator('.info-box-text'));

  // ── TABLET-02 경기 진행 설정: 통계카드 3 + 합 일치 ───────────
  const secGame = admin.locator('.contents-box').filter({ hasText: /경기\s*진행\s*설정/ });
  await check(admin, { path: `${P} > 경기 진행 설정`, tcRef: `${R}_2`, tcId: 'TABLET-02-1', desc: "'경기 진행 설정' 섹션 + 통계카드 3개(전체/활성화/비활성화) 노출", expected: 'setting-stat-card ≥3', failMsg: '통계카드 미노출' },
    async () => { await expect(secGame.first()).toBeVisible(); expect(await secGame.locator('.setting-stat-card').count()).toBeGreaterThanOrEqual(3); });
  await check(admin, { path: `${P} > 경기 진행 설정`, tcRef: `${R}_2`, tcId: 'TABLET-02-2', desc: '전체 기능 수 = 활성화 기능 + 비활성화 기능', expected: '합 일치', failMsg: '기능 수 합 불일치' },
    async () => { const c = secGame.locator('.setting-stat-card'); const t = num(await c.nth(0).innerText()); const a = num(await c.nth(1).innerText()); const d = num(await c.nth(2).innerText()); expect(a + d, `${a}+${d}≠${t}`).toBe(t); });

  // ── TABLET-03 기능 토글(섹션 스코프, id 비의존) ──────────────
  await check(admin, { path: `${P} > 경기 진행 설정 > 토글`, tcRef: `${R}_3`, tcId: 'TABLET-03', desc: '기능 토글 노출(≥1, tgv-1-N id 비의존)', expected: 'checkbox ≥1', failMsg: '기능 토글 미노출' },
    async () => { expect(await secGame.locator('input[type="checkbox"]').count()).toBeGreaterThanOrEqual(1); });

  // ── TABLET-04~07 메시지/확인서 4섹션 (테이블 + 내용 수정, 섹션 스코프·비파괴) ──
  const MSG_SECS: { rx: RegExp; label: string; cols: string[] }[] = [
    { rx: /카트도로\s*이탈\s*메시지/, label: '카트도로 이탈 메시지', cols: ['상세 메시지', '수정일시', '작성자', '관리'] },
    { rx: /긴급\s*?호출\s*연락처/, label: '긴급호출 연락처', cols: ['전화번호', '수정일시', '작성자', '관리'] },
    { rx: /고객\s*확인서/, label: '고객 확인서', cols: ['상세 메시지', '수정일시', '작성자', '관리'] },
    { rx: /중대재해\s*확인서/, label: '중대재해 확인서', cols: ['상세 메시지', '수정일시', '작성자', '관리'] },
  ];
  for (const [i, sec] of MSG_SECS.entries()) {
    const ref = `${R}_${i + 4}`;
    const box = admin.locator('.contents-box').filter({ hasText: sec.rx });
    await check(admin, { path: `${P} > ${sec.label}`, tcRef: ref, tcId: `TABLET-0${i + 4}-1`, desc: `'${sec.label}' 섹션 + [내용 수정] 버튼 노출(섹션 스코프·비파괴)`, expected: '섹션+내용 수정', failMsg: '섹션/버튼 미노출' },
      async () => { await expect(box.first()).toBeVisible(); await expect(box.getByRole('button', { name: '내용 수정' }).first()).toBeVisible(); });
    for (const [j, c] of sec.cols.entries())
      await check(admin, { path: `${P} > ${sec.label} > 테이블`, tcRef: ref, tcId: `TABLET-0${i + 4}-${j + 2}`, desc: `컬럼 '${c}' 노출`, expected: `컬럼 '${c}'`, failMsg: '컬럼 미노출' },
        async () => { await expect(box.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  }

  // ── TABLET-08 추가 확인서 (항목 추가/저장 + 확인항목 input + 정상/비정상 radio, 비파괴) ──
  const secAdd = admin.locator('.contents-box').filter({ hasText: /추가\s*확인서/ });
  await check(admin, { path: `${P} > 추가 확인서`, tcRef: `${R}_8`, tcId: 'TABLET-08-1', desc: "'추가 확인서' 섹션 + [확인 항목 추가]/[저장] 버튼 노출(비파괴)", expected: '확인 항목 추가/저장', failMsg: '버튼 미노출' },
    async () => { await expect(secAdd.first()).toBeVisible(); await expect(admin.getByRole('button', { name: '확인 항목 추가' })).toBeVisible(); await expect(secAdd.getByRole('button', { name: '저장' }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 추가 확인서 > 항목`, tcRef: `${R}_8`, tcId: 'TABLET-08-2', desc: '확인항목 입력 필드 노출(≥1, 데이터 의존)', expected: 'pre-sign-input ≥1', failMsg: '확인항목 입력 미노출' },
    async () => { expect(await admin.locator('.pre-sign-input').count()).toBeGreaterThanOrEqual(1); });
  await check(admin, { path: `${P} > 추가 확인서 > 항목`, tcRef: `${R}_8`, tcId: 'TABLET-08-3', desc: "확인항목 옵션 radio(정상/비정상) 노출", expected: '정상/비정상 radio', failMsg: '옵션 radio 미노출' },
    async () => { await expect(admin.getByText('정상', { exact: true }).first()).toBeVisible(); await expect(admin.getByText('비정상', { exact: true }).first()).toBeVisible(); expect(await admin.locator('.check-item').count()).toBeGreaterThanOrEqual(2); });

  // ── TABLET-09 패스워드 변경 버튼(비파괴) ────────────────────
  await check(admin, { path: `${P} > 패스워드`, tcRef: `${R}_9`, tcId: 'TABLET-09', desc: '[패스워드 변경] 버튼 노출(클릭 미수행·비파괴)', expected: '패스워드 변경', failMsg: '패스워드 변경 버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '패스워드 변경' })).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 태블릿 운영 관리 > 메시지 관리 - 구조 기반 TC ════════════════
//   URL: /club/page/live-message · 탭5(태블릿/셀프모드/뒷카트 알림/센터/분실물&요청물품) + 버튼배열 미리보기(드래그&드롭) + 메시지 관리 테이블 + 예약어 힌트
//   ⚠ 저장/입력란 추가/적용/수정/삭제/드래그는 비파괴(노출만). 안내문구는 부분 일치(전문 일치 추후)
export async function runTabletMessage(admin: Page) {
  const P = '태블릿 운영 관리 > 메시지 관리';
  const R = '태블릿 운영 관리_메시지 관리';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  await check(admin, { path: `${P} > 설명 영역`, tcRef: `${R}_1`, tcId: 'TMSG-01', desc: '안내 문구 노출(부분 일치)', expected: '태블릿 및 센터에서 자주 사용하는 메시지를 등록…', failMsg: '안내 문구 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('자주 사용하는 메시지를 등록'); });

  for (const [i, t] of ['태블릿 메시지', '셀프모드 메시지', '뒷카트 알림 메시지', '센터 메시지', '분실물'].entries())
    await check(admin, { path: `${P} > 탭`, tcRef: `${R}_2`, tcId: `TMSG-02-${i + 1}`, desc: `탭 '${t}' 노출`, expected: t, failMsg: '탭 미노출' },
      async () => { await expect(admin.locator('.tab-group').getByText(t, { exact: false }).first()).toBeVisible(); });

  await check(admin, { path: `${P} > 버튼 배열 미리보기`, tcRef: `${R}_3`, tcId: 'TMSG-03', desc: '태블릿 관제 버튼 배열 미리보기(그리드) + [저장](드래그&드롭·비파괴)', expected: 'tablet-grid+저장', failMsg: '미리보기/저장 미노출' },
    async () => { await expect(admin.locator('.tablet-grid').first()).toBeVisible(); await expect(admin.getByRole('button', { name: '저장' }).first()).toBeVisible(); });

  await check(admin, { path: `${P} > 메시지 관리`, tcRef: `${R}_4`, tcId: 'TMSG-04', desc: '메시지 관리 [입력란 추가]/[적용] 버튼 노출(비파괴)', expected: '입력란 추가/적용', failMsg: '버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '입력란 추가' })).toBeVisible(); await expect(admin.getByRole('button', { name: '적용' })).toBeVisible(); });
  for (const [i, c] of ['제목', '메시지', '관리'].entries())
    await check(admin, { path: `${P} > 메시지 관리 > 테이블`, tcRef: `${R}_5`, tcId: `TMSG-05-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `컬럼 '${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: true }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 메시지 관리 > 행`, tcRef: `${R}_6`, tcId: 'TMSG-06', desc: '행 [수정]/[삭제] 버튼 노출(비파괴)', expected: '수정/삭제', failMsg: '행 버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '수정' }).first()).toBeVisible(); await expect(admin.getByRole('button', { name: '삭제' }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 예약어`, tcRef: `${R}_7`, tcId: 'TMSG-07', desc: '메시지 예약어 힌트(.msg-hint-box) 구조 존재(탭별 노출)', expected: '예약어 힌트', failMsg: '예약어 힌트 미존재' },
    async () => { await expect(admin.locator('.msg-hint-box').first()).toBeAttached(); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 태블릿 운영 관리 > 홀 이벤트 관리 - 구조 기반 TC ════════════════
//   URL: /club/page/live-hole-event · 홀이벤트(필터+테이블 6컬럼) + 아이템(카드 목록)
//   ⚠ 적용/홀이벤트 추가/아이템 추가/수정/삭제는 비파괴(노출만). 안내문구 오타('이미지가태') 의심 → 차이 기록
export async function runTabletHoleEvent(admin: Page) {
  const P = '태블릿 운영 관리 > 홀 이벤트 관리';
  const R = '태블릿 운영 관리_홀 이벤트 관리';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  // 통합 연속 실행 시 홀이벤트 섹션 렌더 지연 대비 — 섹션 노출까지 대기
  await admin.locator('.contents-box').filter({ hasText: /홀\s*이벤트/ }).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});

  await check(admin, { path: `${P} > 설명 영역`, tcRef: `${R}_1`, tcId: 'THEV-01', desc: '안내 문구 노출(부분 일치, 700 X 480)', expected: '특정 홀에 노출될 이미지… 700 X 480', failMsg: '안내 문구 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('700 X 480'); });

  // ⚠ 리뉴얼 띄어쓰기 변경(2026-06-05): '홀이벤트' → '홀 이벤트'(메뉴/섹션/컬럼/버튼). 공백 변동 대비 정규식 매칭
  const secEvent = admin.locator('.contents-box').filter({ hasText: /홀\s*이벤트/ });
  await check(admin, { path: `${P} > 홀 이벤트`, tcRef: `${R}_2`, tcId: 'THEV-02', desc: '홀 이벤트 섹션 + 필터(코스/홀 vue-select) + [홀 이벤트 추가](비파괴)', expected: '섹션+필터+추가', failMsg: '요소 미노출' },
    async () => { await expect(secEvent.first()).toBeVisible(); expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(1); await expect(admin.getByRole('button', { name: /홀\s*이벤트\s*추가/ })).toBeVisible(); });
  for (const [i, c] of [/코스/, /홀\s*번호/, /홀\s*이벤트/, /이미지/, /이벤트\s*노출시간/, /관리/].entries())
    await check(admin, { path: `${P} > 홀 이벤트 > 테이블`, tcRef: `${R}_3`, tcId: `THEV-03-${i + 1}`, desc: `컬럼 '${c.source}' 노출`, expected: `컬럼 '${c.source}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c }).first()).toBeVisible(); });
  // 행 [수정]/[삭제]는 등록된 홀 이벤트가 있을 때만 노출 → 빈 상태('등록된 홀 이벤트가 없습니다')면 SKIP(데이터 의존)
  if (await admin.getByText('등록된 홀 이벤트가 없습니다', { exact: false }).first().isVisible().catch(() => false))
    skip({ path: `${P} > 홀 이벤트 > 행`, tcRef: `${R}_4`, tcId: 'THEV-04', desc: '행 [수정]/[삭제] 버튼 노출(비파괴)' }, '등록된 홀 이벤트 없음(빈 상태) — 행 액션 미노출');
  else
    await check(admin, { path: `${P} > 홀 이벤트 > 행`, tcRef: `${R}_4`, tcId: 'THEV-04', desc: '행 [수정]/[삭제] 버튼 노출(비파괴)', expected: '수정/삭제', failMsg: '행 버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: '수정' }).first()).toBeVisible(); await expect(admin.getByRole('button', { name: '삭제' }).first()).toBeVisible(); });

  // 아이템 섹션: [아이템 추가]/아이템명 input은 상시. 아이템 카드(.item-card)는 등록 데이터 의존 → 0개면 카드 검증 SKIP
  await check(admin, { path: `${P} > 아이템`, tcRef: `${R}_5`, tcId: 'THEV-05', desc: '아이템 섹션 [아이템 추가] + 아이템명 input 노출(비파괴)', expected: '아이템 추가+input', failMsg: '요소 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '아이템 추가' })).toBeVisible(); await expect(admin.getByPlaceholder('아이템명을 입력하세요.')).toBeVisible(); });
  if ((await admin.locator('.item-card').count().catch(() => 0)) > 0)
    await check(admin, { path: `${P} > 아이템 > 카드`, tcRef: `${R}_5`, tcId: 'THEV-05-2', desc: '아이템 카드(.item-card) 노출(≥1)', expected: 'item-card ≥1', failMsg: '아이템 카드 미노출' },
      async () => { await expect(admin.locator('.item-card').first()).toBeVisible(); });
  else
    skip({ path: `${P} > 아이템 > 카드`, tcRef: `${R}_5`, tcId: 'THEV-05-2', desc: '아이템 카드(.item-card) 노출' }, '등록된 아이템 없음(빈 상태)');

  diff(`${P} > 설명 영역`, '안내문구 정상 표기', "안내문구 오타 의심('…노출될 이미지가태 없을 때…')", `${R}_1`, '오타 의심 — 전문 확인 요망');
  diff(`${P} > 명칭`, "'홀이벤트'(붙임)", "'홀 이벤트'(띄어쓰기) — 메뉴·섹션·컬럼·버튼 일괄 변경(2026-06-05 리뉴얼)", `${R}_2`, '명칭 띄어쓰기 변경 — AS-IS 반영');
  await runCommonActions(admin, P, R);
}

// ════════════════ 경기 진행 관리 (4종) - 구조 기반 TC ════════════════
//   ⚠ 저장/권장값 적용/이전 코스 값 복사/통계자료 작성/내보내기/검색은 비파괴(노출만, 클릭 안 함)
//   안내문구는 부분 일치. 테이블 컬럼은 대표 컬럼만 검증(홀별 1~9홀 다수 → 생략)

// 1) 진행시간 표준 설정 (/club/page/control-time-standard) — 코스/홀 카드 편집 + 요약 + 하단 표
export async function runTimeStandard(admin: Page) {
  const P = '경기 진행 관리 > 진행시간 표준 설정';
  const R = '경기 진행 관리_진행시간 표준 설정';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'TSTD-01', desc: '안내 문구 노출(부분)', expected: '표준적인 진행시간', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('표준적인 진행시간'); });
  await check(admin, { path: `${P} > 코스 선택`, tcRef: `${R}_2`, tcId: 'TSTD-02', desc: '코스 선택 패널 + 코스 카드(≥1, South/East/West)', expected: 'course-card ≥1', failMsg: '코스 카드 미노출' },
    async () => { await expect(admin.locator('.course-panel').first()).toBeVisible(); expect(await admin.locator('.course-card').count()).toBeGreaterThanOrEqual(1); });
  await check(admin, { path: `${P} > 홀별 입력`, tcRef: `${R}_3`, tcId: 'TSTD-03', desc: '홀별 입력 카드(.hole-card ≥1, PAR/진행시간/다음홀대기)', expected: 'hole-card ≥1', failMsg: '홀 카드 미노출' },
    async () => { expect(await admin.locator('.hole-card').count()).toBeGreaterThanOrEqual(1); });
  await check(admin, { path: `${P} > 코스대기/요약`, tcRef: `${R}_4`, tcId: 'TSTD-04', desc: '코스대기 설정 + 요약 패널 노출', expected: 'course-wait-box+summary-panel', failMsg: '요약 미노출' },
    async () => { await expect(admin.locator('.course-wait-box').first()).toBeVisible(); await expect(admin.locator('.summary-panel').first()).toBeVisible(); });
  for (const [i, c] of ['코스명', '경기시간', '홀간대기', '코스대기', '전체시간'].entries())
    await check(admin, { path: `${P} > 하단 표`, tcRef: `${R}_5`, tcId: `TSTD-05-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  for (const [i, b] of ['초기화', '저장', '권장값 적용', '이전 코스 값 복사'].entries())
    await check(admin, { path: `${P} > 버튼`, tcRef: `${R}_6`, tcId: `TSTD-06-${i + 1}`, desc: `[${b}] 버튼 노출(비파괴)`, expected: `[${b}]`, failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });

  // ── 정합성(자동 계산값 검증) — 읽기전용·비파괴. 시간 포맷 H:MM(또는 MM:SS) → 분환산 합산 ──
  const t2m = (s: string) => { const m = (s || '').match(/(\d+)\s*:\s*(\d+)/); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN; };
  // TSTD-07: 전체시간 = 경기시간 + 홀간대기 (요약 정보 + 코스 선택 카드)
  await check(admin, { path: `${P} > 정합성`, tcRef: `${R}_7`, tcId: 'TSTD-07', desc: '전체시간 = 경기시간 + 홀간대기 (요약·코스카드 자동계산)', expected: '전체=경기+홀간대기', failMsg: '합계 불일치' },
    async () => {
      const blocks = admin.locator('.summary-panel, .course-card');
      const n = await blocks.count(); let checked = 0;
      for (let i = 0; i < n; i++) {
        const txt = (await blocks.nth(i).innerText()).replace(/\s+/g, ' ');
        const a = txt.match(/전체시간\s*(\d+:\d+)/), b = txt.match(/경기시간\s*(\d+:\d+)/), c = txt.match(/홀간대기\s*(\d+:\d+)/);
        if (a && b && c) { expect(t2m(a[1]), `${txt.slice(0, 24)} 전체(${a[1]})=경기(${b[1]})+홀간(${c[1]})`).toBe(t2m(b[1]) + t2m(c[1])); checked++; }
      }
      expect(checked, '검증 가능한 요약/코스카드 ≥1').toBeGreaterThanOrEqual(1);
    });
  // TSTD-08: 라운드 자동계산 전체시간 = 전반(경기+홀간) + 후반(경기+홀간)  (코스대기 제외)
  //   라운드 테이블 td 시간토큰 순서: [경기前,홀간前,코스대기,전체,경기後,홀간後] (코스대기·전체는 전반행 rowspan)
  await check(admin, { path: `${P} > 정합성`, tcRef: `${R}_8`, tcId: 'TSTD-08', desc: '라운드 자동계산 전체시간 = 전반 전체 + 후반 전체', expected: '전체=전반+후반', failMsg: '라운드 합계 불일치' },
    async () => {
      const rt = admin.locator('table').filter({ hasText: '전반' });
      const tn = await rt.count(); let checks = 0;
      for (let i = 0; i < tn; i++) {
        const toks = (await rt.nth(i).locator('td').allInnerTexts()).join(' ').match(/\d+\s*:\s*\d+/g) || [];
        for (let j = 0; j + 6 <= toks.length; j += 6) {
          const g = toks.slice(j, j + 6).map(t2m);
          expect(g[3], `라운드 전체(${toks[j + 3]})=전반(${toks[j]}+${toks[j + 1]})+후반(${toks[j + 4]}+${toks[j + 5]})`).toBe(g[0] + g[1] + g[4] + g[5]);
          checks++;
        }
      }
      expect(checks, '검증 가능한 라운드(전반+후반 쌍) ≥1').toBeGreaterThanOrEqual(1);
    });

  // 요약 정보에서 경기/홀간/전체(분) 추출 헬퍼
  const summaryMin = async () => {
    const s = (await admin.locator('.summary-panel').first().innerText()).replace(/\s+/g, ' ');
    const g = s.match(/경기시간\s*(\d+:\d+)/), h = s.match(/홀간대기\s*(\d+:\d+)/), t = s.match(/전체시간\s*(\d+:\d+)/);
    return { game: g ? t2m(g[1]) : NaN, wait: h ? t2m(h[1]) : NaN, total: t ? t2m(t[1]) : NaN };
  };
  // 홀 카드 입력 합(진행시간/다음홀대기, 분)
  const holeSums = async () => {
    const holes = admin.locator('.hole-card'); const hn = await holes.count();
    let play = 0, wait = 0;
    for (let i = 0; i < hn; i++) {
      const ins = holes.nth(i).locator('input');
      play += parseInt((await ins.nth(0).inputValue().catch(() => '0')) || '0', 10) || 0;
      wait += parseInt((await ins.nth(1).inputValue().catch(() => '0')) || '0', 10) || 0;
    }
    return { play, wait, hn };
  };

  // ── 시나리오1(진입 시) TSTD-09: 경기시간 = Σ진행시간, 홀간대기 = Σ다음홀대기 ──
  await check(admin, { path: `${P} > 정합성`, tcRef: `${R}_9`, tcId: 'TSTD-09', desc: '경기시간=Σ진행시간 · 홀간대기=Σ다음홀대기 (입력↔요약 자동집계)', expected: '경기=Σ진행 / 홀간=Σ대기', failMsg: '집계 불일치' },
    async () => {
      const { play, wait, hn } = await holeSums(); expect(hn).toBeGreaterThanOrEqual(1);
      const s = await summaryMin();
      expect(s.game, `경기시간(${s.game}분)=Σ진행시간(${play}분)`).toBe(play);
      expect(s.wait, `홀간대기(${s.wait}분)=Σ다음홀대기(${wait}분)`).toBe(wait);
    });

  // ── 시나리오2(입력 변경 시) TSTD-10: 1홀 진행+10 → 경기/전체 +10 즉시 반영(비저장·복구) ──
  await check(admin, { path: `${P} > 정합성`, tcRef: `${R}_10`, tcId: 'TSTD-10', desc: '입력값 변경 시 요약 즉시 정합 반영(진행+10 → 경기·전체 +10)', expected: 'Δ10 정합 반영', failMsg: '변경 미반영/불일치' },
    async () => {
      const inp = admin.locator('.hole-card').first().locator('input').nth(0);
      const orig = await inp.inputValue(); const O = parseInt(orig || '0', 10) || 0;
      const b = await summaryMin();
      await inp.fill(String(O + 10)); await inp.blur().catch(() => {}); await admin.waitForTimeout(700);
      const a = await summaryMin();
      await inp.fill(orig); await inp.blur().catch(() => {}); await admin.waitForTimeout(500);   // 원상복구(저장 안 함)
      expect(a.game - b.game, `진행+10 → 경기시간 +10(${b.game}→${a.game})`).toBe(10);
      expect(a.total - b.total, `진행+10 → 전체시간 +10(${b.total}→${a.total})`).toBe(10);
    });

  // ── 시나리오3(권장값 적용 시) TSTD-11: 적용 후에도 경기=Σ진행·전체=경기+홀간 정합 유지(비저장·초기화 복구) ──
  await check(admin, { path: `${P} > 정합성`, tcRef: `${R}_11`, tcId: 'TSTD-11', desc: '[권장값 적용] 후 노출값 정합(전체=경기+홀간 불변식 유지)', expected: '적용 후 전체=경기+홀간', failMsg: '권장값 적용 후 불일치' },
    async () => {
      const before = await summaryMin();
      await admin.getByRole('button', { name: '권장값 적용' }).first().click().catch(() => {});
      await admin.waitForTimeout(1200);
      const { play } = await holeSums(); const s = await summaryMin();
      await admin.getByRole('button', { name: '초기화' }).first().click().catch(() => {});   // 원상복구(저장 안 함·비파괴)
      await admin.waitForTimeout(800);
      // 불변식: 전체시간 = 경기시간 + 홀간대기 (모든 상태에서 성립)
      expect(s.total, `적용 후 전체시간(${s.total})=경기(${s.game})+홀간(${s.wait})`).toBe(s.game + s.wait);
      // 적용 동작 수행 확인(요약 값 변동 또는 입력 반영) + 입력↔요약 집계 불일치 시 추적축 기록
      if (Number.isFinite(s.game) && s.game !== play)
        diff(`${P} > 권장값 적용`, '경기시간 = Σ진행시간(입력 카드)', `권장값 적용 후 요약 경기시간(${s.game}분) ≠ Σ진행시간 입력(${play}분) — 입력카드↔요약 집계 불일치`, `${R}_11`, '권장값 적용 후 집계 정합 확인 요망(테스트환경 데이터/재계산 지연 가능)');
    });
  await runCommonActions(admin, P, R);
}

// 2) 진행시간 실시간 (/club/page/control-time-realtime) — 모니터 검색 + 테이블 + 차트
export async function runTimeRealtime(admin: Page) {
  const P = '경기 진행 관리 > 진행시간 실시간';
  const R = '경기 진행 관리_진행시간 실시간';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'TRT-01', desc: '안내 문구 노출(부분)', expected: '진행시간을 모니터', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('모니터'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'TRT-02', desc: '검색 필드(캐디명/카트번호/내장객명) 노출', expected: '검색 input', failMsg: '검색 필드 미노출' },
    async () => { await expect(admin.getByPlaceholder('캐디명')).toBeVisible(); await expect(admin.getByPlaceholder('카트번호')).toBeVisible(); await expect(admin.getByPlaceholder('내장객명')).toBeVisible(); });
  for (const [i, b] of ['검색', '초기화', '새로고침', '내보내기', '홀별시각보기'].entries())
    await check(admin, { path: `${P} > 버튼`, tcRef: `${R}_3`, tcId: `TRT-03-${i + 1}`, desc: `[${b}] 버튼 노출(비파괴)`, expected: `[${b}]`, failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });
  for (const [i, c] of ['티업', '캐디', '전반', '후반', '현재', '전체', '코스간'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_4`, tcId: `TRT-04-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: true }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 차트`, tcRef: `${R}_5`, tcId: 'TRT-05', desc: '진행시간 차트(svg) 노출(≥1)', expected: 'svg ≥1', failMsg: '차트 미노출' },
    async () => { expect(await admin.locator('svg').count()).toBeGreaterThanOrEqual(1); });

  // ── 동작 자동화(비파괴: 조회/뷰/다운로드/클리어, 데이터 변경 없음) ──
  const tbl = () => admin.locator('table').first();
  const emptyState = async () => admin.getByText(/없습니다|내역이 없|데이터가 없|기록이 없/).first().isVisible({ timeout: 1500 }).catch(() => false);

  // TRT-06: 필터 조건 변경 → [검색] (조회 실행·테이블 갱신, 결과는 데이터 의존)
  await check(admin, { path: `${P} > 검색 실행`, tcRef: `${R}_6`, tcId: 'TRT-06', desc: '필터(캐디명) 변경 → [검색] 클릭 시 조회 실행(결과/빈상태 노출)', expected: '검색 실행·테이블 갱신', failMsg: '검색 미실행/화면 오류' },
    async () => { await admin.getByPlaceholder('캐디명').first().fill('김'); await admin.getByRole('button', { name: '검색', exact: true }).first().click(); await admin.waitForTimeout(1200); expect(await tbl().isVisible().catch(() => false) || await emptyState(), '검색 후 테이블/빈상태 노출').toBeTruthy(); });
  // TRT-07: [초기화] → 검색조건 초기화(입력 비워짐)
  await check(admin, { path: `${P} > 초기화`, tcRef: `${R}_7`, tcId: 'TRT-07', desc: '[초기화] 클릭 시 검색 입력 초기화', expected: '캐디명 입력 = 빈값', failMsg: '초기화 미반영' },
    async () => { await admin.getByRole('button', { name: '초기화', exact: true }).first().click(); await admin.waitForTimeout(800); await expect(admin.getByPlaceholder('캐디명').first()).toHaveValue(''); });
  // TRT-08: [새로고침] → 데이터 재조회(테이블 유지)
  await check(admin, { path: `${P} > 새로고침`, tcRef: `${R}_8`, tcId: 'TRT-08', desc: '[새로고침] 클릭 시 재조회(테이블 정상 유지)', expected: '테이블 노출 유지', failMsg: '새로고침 후 오류' },
    async () => { await admin.getByRole('button', { name: '새로고침', exact: true }).first().click(); await admin.waitForTimeout(1200); await expect(tbl()).toBeVisible(); });
  // TRT-09: [내보내기] → 엑셀 다운로드 발생만(내용 검증 X)
  await check(admin, { path: `${P} > 내보내기`, tcRef: `${R}_9`, tcId: 'TRT-09', desc: '[내보내기] 클릭 시 엑셀 다운로드 발생(내용 검증 제외)', expected: 'download 이벤트', failMsg: '다운로드 미발생' },
    async () => { const dlP = admin.waitForEvent('download', { timeout: 12_000 }).catch(() => null); await admin.getByRole('button', { name: '내보내기', exact: true }).first().click(); const d = await dlP; expect(d !== null || await emptyState(), '다운로드 발생 또는 데이터 없음').toBeTruthy(); });
  // TRT-10: [홀별시각보기/숨김] 토글 (라벨 보기↔숨김 전환, 원복)
  await check(admin, { path: `${P} > 홀별시각`, tcRef: `${R}_10`, tcId: 'TRT-10', desc: '[홀별시각보기/숨김] 클릭 시 토글(라벨 전환)', expected: '보기↔숨김 토글', failMsg: '토글 미반영' },
    async () => { const hb = () => admin.getByRole('button', { name: /홀별\s*시각/ }).first(); const l0 = (await hb().innerText()).trim(); await hb().click(); await admin.waitForTimeout(800); const l1 = (await hb().innerText()).trim(); expect(l1, `라벨 토글(${l0}→${l1})`).not.toBe(l0); await hb().click().catch(() => {}); await admin.waitForTimeout(500); });
  // TRT-11: [정보] 아이콘 → 새 탭 화면 랜딩 (데이터 행 의존)
  const infoCell = admin.locator('.info-cell, [class*="ico-info"]').first();
  if (await infoCell.isVisible({ timeout: 2000 }).catch(() => false))
    await check(admin, { path: `${P} > 정보 아이콘`, tcRef: `${R}_11`, tcId: 'TRT-11', desc: '[정보] 아이콘 클릭 시 새 탭 화면 랜딩', expected: '새 탭 오픈·로드', failMsg: '새 탭 미오픈' },
      async () => { const [popup] = await Promise.all([admin.context().waitForEvent('page', { timeout: 10_000 }), infoCell.click()]); await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {}); expect(popup.url(), '새 탭 URL').toMatch(/^https?:/); await popup.close().catch(() => {}); });
  else
    skip({ path: `${P} > 정보 아이콘`, tcRef: `${R}_11`, tcId: 'TRT-11', desc: '[정보] 아이콘 → 새 탭 랜딩' }, '정보 아이콘(데이터 행) 없음 — 데이터 의존');
  // TRT-12: 검색 입력 [X] → 입력 내용 삭제
  await check(admin, { path: `${P} > 입력 클리어`, tcRef: `${R}_12`, tcId: 'TRT-12', desc: '검색 입력 후 [X] 클릭 시 입력 삭제', expected: '입력 = 빈값', failMsg: 'X 클리어 미동작' },
    async () => { const cad = admin.getByPlaceholder('캐디명').first(); await cad.fill('테스트'); await admin.waitForTimeout(300); const x = cad.locator('xpath=..').locator('button, i, [class*=clear], [class*=close]').first(); await expect(x).toBeVisible(); await x.click(); await admin.waitForTimeout(300); await expect(cad).toHaveValue(''); });
}

// 3) 진행시간 조회 (/club/page/control-time-search) — 기간/조건 검색 + 테이블 + 차트
export async function runTimeSearch(admin: Page) {
  const P = '경기 진행 관리 > 진행시간 조회';
  const R = '경기 진행 관리_진행시간 조회';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'TSCH-01', desc: '안내 문구 노출(부분)', expected: '진행시간', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('진행시간'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'TSCH-02', desc: '조회기간 datepicker(≥2) + 조건 vue-select(≥1)', expected: 'datepicker≥2', failMsg: '검색 영역 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(1); });
  for (const [i, b] of ['검색', '초기화', '내보내기', '홀별시각보기'].entries())
    await check(admin, { path: `${P} > 버튼`, tcRef: `${R}_3`, tcId: `TSCH-03-${i + 1}`, desc: `[${b}] 버튼 노출(비파괴)`, expected: `[${b}]`, failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });
  for (const [i, c] of ['년도', '티업', '캐디', '전반', '후반', '전체', '코스간'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_4`, tcId: `TSCH-04-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: true }).first()).toBeVisible(); });
  diff(`${P} > 설명 영역`, '조회 화면에 맞는 안내문구', "안내문구가 '진행시간 실시간'과 동일('당일 진행중인 경기…모니터') — 조회 화면 안내 복붙 의심", `${R}_1`, '안내문구 부적합 의심 — QA 확인 요망');
  await runCommonActions(admin, P, R);
}

// 4) 진행시간 통계 (/club/page/control-time-statistics) — 통계 조건 + 통계표 + 차트
export async function runTimeStats(admin: Page) {
  const P = '경기 진행 관리 > 진행시간 통계';
  const R = '경기 진행 관리_진행시간 통계';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'TSTAT-01', desc: '안내 문구 노출(부분)', expected: '통계자료', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('통계자료'); });
  await check(admin, { path: `${P} > 통계 조건`, tcRef: `${R}_2`, tcId: 'TSTAT-02', desc: '통계 조건(라디오 + vue-select + 기간 datepicker)', expected: '조건 영역', failMsg: '조건 미노출' },
    async () => { expect(await admin.locator('.check-item').count()).toBeGreaterThanOrEqual(1); expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(1); });
  for (const [i, b] of ['통계자료 작성', '초기화', '내보내기'].entries())
    await check(admin, { path: `${P} > 버튼`, tcRef: `${R}_3`, tcId: `TSTAT-03-${i + 1}`, desc: `[${b}] 버튼 노출(비파괴)`, expected: `[${b}]`, failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });
  for (const [i, c] of ['구분', '라운드', '전반', '후반', '표준편차', '평점'].entries())
    await check(admin, { path: `${P} > 통계표`, tcRef: `${R}_4`, tcId: `TSTAT-04-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: true }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 캐디 관리 (3종) - 구조 기반 TC ════════════════
//   ⚠ 관제적용/적용/저장/입력란 추가/삭제/행 액션(라운드기록·회원추천·그늘집주문)은 비파괴(노출만). 조회/내보내기 read-only

// 1) 캐디리스트 (/club/page/caddie-all) — 그래프 + 통계카드 + 필터 + 목록
export async function runCaddieList(admin: Page) {
  const P = '캐디 관리 > 캐디리스트';
  const R = '캐디 관리_캐디리스트';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'CADL-01', desc: '안내 문구 노출(부분)', expected: '캐디 현황', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('캐디 현황'); });
  await check(admin, { path: `${P} > 그래프`, tcRef: `${R}_2`, tcId: 'CADL-02', desc: '그래프 카드 3종(하우스·활동·회원 비율) + 차트(canvas)', expected: 'graph-card ≥3 + canvas', failMsg: '그래프 미노출' },
    async () => { expect(await admin.locator('.graph-card').count()).toBeGreaterThanOrEqual(3); expect(await admin.locator('canvas').count()).toBeGreaterThanOrEqual(1); });
  await check(admin, { path: `${P} > 통계카드`, tcRef: `${R}_3`, tcId: 'CADL-03', desc: '통계 카드(총 등록 캐디/활동 캐디/운영 비율 등) 노출(≥1)', expected: 'stat-card ≥1', failMsg: '통계카드 미노출' },
    async () => { expect(await admin.locator('.stat-card').count()).toBeGreaterThanOrEqual(1); });
  await check(admin, { path: `${P} > 필터`, tcRef: `${R}_4`, tcId: 'CADL-04', desc: '활동 상태 vue-select + 캐디명 입력 + [적용]/[초기화]', expected: '필터', failMsg: '필터 미노출' },
    async () => { expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(1); await expect(admin.getByPlaceholder('캐디명을 입력하세요.')).toBeVisible(); await expect(admin.getByRole('button', { name: '적용', exact: true })).toBeVisible(); });
  for (const [i, c] of ['No', '성명', '성별', '휴대폰', '카트번호', '태블릿 No.', '배터리', '라운드기록', '회원추천', '그늘집주문'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_5`, tcId: `CADL-05-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 액션`, tcRef: `${R}_6`, tcId: 'CADL-06', desc: '[관제 적용] 버튼 노출(클릭 미수행·비파괴)', expected: '관제 적용', failMsg: '관제 적용 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '관제 적용' })).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 2) 캐디 등록 관리 (/club/page/caddie-register) — 등록 폼 + 목록
export async function runCaddieRegister(admin: Page) {
  const P = '캐디 관리 > 캐디 등록 관리';
  const R = '캐디 관리_캐디 등록 관리';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'CADR-01', desc: '안내 문구 노출(부분)', expected: '수정, 삭제', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('수정, 삭제'); });
  await check(admin, { path: `${P} > 탭`, tcRef: `${R}_2`, tcId: 'CADR-02', desc: '탭(캐디 등록 관리 / 캐디 수정·해지) 노출', expected: '탭 2종', failMsg: '탭 미노출' },
    async () => { await expect(admin.getByText('캐디 수정/해지', { exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 등록 폼`, tcRef: `${R}_3`, tcId: 'CADR-03', desc: '등록 폼(성명/휴대폰/태블릿 No./배터리 + 구분·성별 radio)', expected: '입력 폼', failMsg: '폼 미노출' },
    async () => { await expect(admin.getByPlaceholder('성명')).toBeVisible(); await expect(admin.getByPlaceholder('휴대폰')).toBeVisible(); expect(await admin.locator('.check-item').count()).toBeGreaterThanOrEqual(1); });
  await check(admin, { path: `${P} > 버튼`, tcRef: `${R}_4`, tcId: 'CADR-04', desc: '[입력란 추가]/[저장] 버튼 노출(비파괴)', expected: '입력란 추가/저장', failMsg: '버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '입력란 추가' })).toBeVisible(); await expect(admin.getByRole('button', { name: '저장' })).toBeVisible(); });
  for (const [i, c] of ['성명', '구분', '성별', '휴대폰', '자격취득일', '카트번호', '태블릿 No.', '배터리', '관리'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_5`, tcId: `CADR-05-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  diff(`${P} > 등록 폼`, '조회일/날짜 형식 YYYY.MM.DD(타 화면 일관)', '자격취득일 datepicker 형식 YYYY-MM-DD(대시)', `${R}_3`, '날짜 형식 불일치 — QA 확인 요망');
  await runCommonActions(admin, P, R);
}

// 3) 캐디 실적 (/club/page/caddie-performance) — 기간 조회 + 실적 테이블
export async function runCaddiePerformance(admin: Page) {
  const P = '캐디 관리 > 캐디 실적';
  const R = '캐디 관리_캐디 실적';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  // 안내문구 개정(2026-06): '애사심' 문구 → '…사용자 등록…골프장의 발전에 기여한 내역…'(QA-14896 기획과 상이로 기록됨). AS-IS 반영
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'CADP-01', desc: '안내 문구 노출(부분)', expected: '골프장의 발전에 기여', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e.first()).toBeVisible(); await expect(e.first()).toContainText('골프장의 발전에 기여'); });
  diff(`${P} > 설명 영역`, "안내문구('애사심' 포함 구문)", "안내문구 개정: '스마트스코어 태블릿을 통해…사용자 등록을 하여, …골프장의 발전에 기여한 내역을 확인할 수 있습니다.'", `${R}_1`, 'QA-14896(기획과 상이) — AS-IS 반영');
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'CADP-02', desc: '조회기간 datepicker(≥2) + [조회]/[내보내기] 버튼(비파괴)', expected: 'datepicker≥2', failMsg: '검색 영역 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '조회' })).toBeVisible(); await expect(admin.getByRole('button', { name: '내보내기' })).toBeVisible(); });
  for (const [i, c] of ['캐디명', '신규회원 추천수', '유효 내장객수', 'SS회원수', 'SS비율'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_3`, tcId: `CADP-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 배토 관리 > 배토 기록 조회 - 구조 기반 TC ════════════════
//   URL: /club/page/topdressing-record · 조회기간 + 테이블(작업 경로 보기) + 차트
//   ⚠ 초기화/적용/보기는 비파괴(조회·노출만). 안내문구 부분 일치
//   ⛔ 작업 경로 팝업([보기] 클릭 후 지도/경로 시각화)은 범위 제외 — 지도 상호작용·경로 재생 검증 부적합(카트 이동경로와 동일 정책). [보기] 버튼 노출만 검증.
export async function runBetoRecord(admin: Page) {
  const P = '배토 관리 > 배토 기록 조회';
  const R = '배토 관리_배토 기록 조회';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'BREC-01', desc: '안내 문구 노출(부분)', expected: '배토기록을 조회', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('배토기록을 조회'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'BREC-02', desc: '조회기간 datepicker(≥2) + vue-select + [초기화]/[적용](비파괴)', expected: 'datepicker≥2', failMsg: '검색 영역 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '적용', exact: true })).toBeVisible(); await expect(admin.getByRole('button', { name: '초기화' })).toBeVisible(); });
  // ✨드리프트(2026-06-16): '작업 경로' 컬럼·행 [보기] 버튼 제거됨 → 테이블 = No./캐디/시작시간/종료시간 4컬럼. AS-IS로 갱신.
  for (const [i, c] of ['No.', '캐디', '시작시간', '종료시간'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_3`, tcId: `BREC-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  // BREC-04/05: '작업 경로' 컬럼·[보기] 버튼이 리뉴얼에서 제거됨(부재 확인) → 기획-구현 차이로 추적
  await check(admin, { path: `${P} > 행`, tcRef: `${R}_4`, tcId: 'BREC-04', desc: '행 [보기](작업 경로) 버튼 제거 확인 — 부재', expected: '보기 버튼 없음', failMsg: '보기 버튼 잔존' },
    async () => { await expect(admin.getByRole('button', { name: '보기', exact: true })).toHaveCount(0); });
  diff(`${P} > 테이블`, "'작업 경로' 컬럼 + 행 [보기] 버튼(경로 시각화)", '컬럼·버튼 제거됨(4컬럼: No./캐디/시작시간/종료시간)', `${R}_3`, '구조 변경 — QA 확인 요망(기능 제거/이전 여부)');
  skip({ path: `${P} > 작업 경로 팝업`, tcRef: `${R}_5`, tcId: 'BREC-05', desc: '작업 경로 팝업([보기] 클릭) 내용 검증' }, '기능 제거 — [보기] 버튼·작업 경로 컬럼 부재(2026-06-16 드리프트)');
  await runCommonActions(admin, P, R);
}

// ════════════════ 배토 관리 > 배토 통계 - 구조 기반 TC (리뉴얼) ════════════════
//   URL: /club/page/topdressing-statistics · 안내문구 + 조건(기간/필터버튼) + 카드4 + 그래프(canvas) + 통계표
//   ⚠ 초기화/적용/내보내기/필터(작업자·작업시간·일별·월별) 전환은 조회(읽기) 동작 → 노출만 검증(클릭 안 함, 비파괴)
//   ⚠ 차트는 Highcharts(svg) 아닌 CANVAS. 필터 활성 표기는 button-outline-primary(활성)/button-outline-default(비활성)
//   ⚠ 카드 라벨은 일별/월별 모드에 따라 접두('일별 …') 가변 → substring 매칭. 레거시(/ss/admin/rounding.html) 스펙 폐기·재작성
export async function runBetoStats(admin: Page) {
  const P = '배토 관리 > 배토 통계';
  const R = '배토 관리_배토 통계';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  // ── BSTAT-01 안내문구(부분 일치) ────────────────────────────
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'BSTAT-01', desc: '안내 문구 노출(부분)', expected: '배토 작업자', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('배토 작업자'); });

  // ── BSTAT-02 조회기간 datepicker(≥2) + [초기화]/[적용](비파괴) ──
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'BSTAT-02', desc: '조회기간 datepicker(≥2) + [초기화]/[적용] 버튼(비파괴)', expected: 'datepicker≥2', failMsg: '검색 영역 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '적용', exact: true }).first()).toBeVisible(); await expect(admin.getByRole('button', { name: '초기화' }).first()).toBeVisible(); });

  // ── BSTAT-03 필터 버튼(작업자/작업시간 × 일별/월별, 노출만·비파괴) ──
  for (const [i, b] of ['작업자', '작업시간', '일별', '월별'].entries())
    await check(admin, { path: `${P} > 필터`, tcRef: `${R}_3`, tcId: `BSTAT-03-${i + 1}`, desc: `필터 [${b}] 버튼 노출(클릭 미수행·비파괴)`, expected: `[${b}]`, failMsg: '필터 버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });

  // ── BSTAT-04 기본 활성 필터(작업자/일별 = button-outline-primary, 작업시간/월별 = 비활성) ──
  await check(admin, { path: `${P} > 필터 > 기본값`, tcRef: `${R}_4`, tcId: 'BSTAT-04', desc: '기본 활성 필터(작업자·일별 활성, 작업시간·월별 비활성)', expected: '작업자/일별 active', failMsg: '기본 활성 상태 불일치' },
    async () => {
      await expect(admin.getByRole('button', { name: '작업자', exact: true }).first()).toHaveClass(/button-outline-primary/);
      await expect(admin.getByRole('button', { name: '일별', exact: true }).first()).toHaveClass(/button-outline-primary/);
      await expect(admin.getByRole('button', { name: '작업시간', exact: true }).first()).toHaveClass(/button-outline-default/);
      await expect(admin.getByRole('button', { name: '월별', exact: true }).first()).toHaveClass(/button-outline-default/);
    });

  // ── BSTAT-05 카드 요약 4종(총/평균/최대/최소 작업자 수, 접두 가변 → substring) ──
  for (const [i, l] of ['총 작업자 수', '평균 작업자 수', '최대 작업자 수', '최소 작업자 수'].entries())
    await check(admin, { path: `${P} > 카드 요약`, tcRef: `${R}_5`, tcId: `BSTAT-05-${i + 1}`, desc: `카드 '${l}' 노출`, expected: l, failMsg: '카드 미노출' },
      async () => { await expect(admin.locator('.card-label').filter({ hasText: l }).first()).toBeVisible(); });

  // ── BSTAT-06 그래프 영역(작업자 통계 그래프 + canvas) ────────
  await check(admin, { path: `${P} > 그래프`, tcRef: `${R}_6`, tcId: 'BSTAT-06', desc: "그래프 영역('통계 그래프') + 차트(canvas) 노출", expected: '통계 그래프 + canvas', failMsg: '그래프 미노출' },
    async () => { await expect(admin.getByText('통계 그래프', { exact: false }).first()).toBeVisible(); expect(await admin.locator('canvas').count()).toBeGreaterThanOrEqual(1); });

  // ── BSTAT-07 통계표 컬럼(No./날짜/작업자 수/작업시간 합계/평균 작업시간) ──
  for (const [i, c] of ['No.', '날짜', '작업자 수', '작업시간 합계', '평균 작업시간'].entries())
    await check(admin, { path: `${P} > 통계표`, tcRef: `${R}_7`, tcId: `BSTAT-07-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });

  // ── BSTAT-08 [내보내기] 버튼 노출(클릭 미수행·비파괴) ────────
  await check(admin, { path: `${P} > 액션`, tcRef: `${R}_8`, tcId: 'BSTAT-08', desc: '[내보내기] 버튼 노출(클릭 미수행·비파괴)', expected: '내보내기', failMsg: '내보내기 버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '내보내기' }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 홀맵 관리 (4종) - 구조 기반 TC ════════════════
//   ⚠ 저장/적용/구역관리/전체 허용·제한/홀별 설정 저장/checkbox·input 변경은 비파괴(노출만). 코스 탭(South/East/West)
//   홀맵 미리보기는 시각 도구 → 제한 검증(조건+미리보기 영역 노출만)

// 1) 홀맵 구역 설정 (/club/page/holemap-zone-management)
export async function runHolemapZone(admin: Page) {
  const P = '홀맵 관리 > 홀맵 구역 설정';
  const R = '홀맵 관리_홀맵 구역 설정';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'HMZ-01', desc: '안내 문구 노출(부분)', expected: '홀맵 구역', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('홀맵 구역'); });
  await check(admin, { path: `${P} > 필터`, tcRef: `${R}_2`, tcId: 'HMZ-02', desc: '필터(코스/홀 vue-select) + [초기화]/[적용]/[구역관리](비파괴)', expected: '필터+버튼', failMsg: '필터/버튼 미노출' },
    async () => { expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(1); await expect(admin.getByRole('button', { name: '적용', exact: true }).first()).toBeVisible(); await expect(admin.getByRole('button', { name: '구역 관리' }).first()).toBeVisible(); });
  for (const [i, c] of ['No', '코스', '홀', 'PAR', '야디지', '위험구역', 'OB구역', '패널티구역', '관리'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_3`, tcId: `HMZ-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 2) 카트패스 진입여부 설정 (/club/page/holemap-cart-entrance)
export async function runHolemapCartEntrance(admin: Page) {
  const P = '홀맵 관리 > 카트패스 진입여부 설정';
  const R = '홀맵 관리_카트패스 진입여부 설정';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'HMCE-01', desc: '안내 문구 노출(부분)', expected: '카트패스 진입', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('카트패스'); });
  await check(admin, { path: `${P} > 코스 탭`, tcRef: `${R}_2`, tcId: 'HMCE-02', desc: '코스 탭(South/East/West) 노출', expected: '코스 탭', failMsg: '코스 탭 미노출' },
    async () => { await expect(admin.locator('.tab-group').getByText('South', { exact: false }).first()).toBeVisible(); await expect(admin.locator('.tab-group').getByText('West', { exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 홀별 설정`, tcRef: `${R}_3`, tcId: 'HMCE-03', desc: '홀별 진입여부 checkbox 노출(≥1)', expected: 'checkbox ≥1', failMsg: '체크박스 미노출' },
    async () => { expect(await admin.locator('.contents-box input[type="checkbox"]').count()).toBeGreaterThanOrEqual(1); });
  for (const [i, b] of ['전체 허용', '전체 제한', '홀별 설정 저장'].entries())
    await check(admin, { path: `${P} > 버튼`, tcRef: `${R}_4`, tcId: `HMCE-04-${i + 1}`, desc: `[${b}] 버튼 노출(비파괴)`, expected: `[${b}]`, failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 3) 티샷 유의 거리 설정 (/club/page/holemap-teeshot-distance)
export async function runHolemapTeeshot(admin: Page) {
  const P = '홀맵 관리 > 티샷 유의 거리 설정';
  const R = '홀맵 관리_티샷 유의 거리 설정';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'HMTS-01', desc: '안내 문구 노출(부분)', expected: '티박스 진입', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('티박스'); });
  await check(admin, { path: `${P} > 코스 탭`, tcRef: `${R}_2`, tcId: 'HMTS-02', desc: '코스 탭(South/East/West) 노출', expected: '코스 탭', failMsg: '코스 탭 미노출' },
    async () => { await expect(admin.locator('.tab-group').getByText('South', { exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 홀별 거리`, tcRef: `${R}_3`, tcId: 'HMTS-03-1', desc: '홀별 거리 입력(placeholder 미입력) 노출(≥1)', expected: 'input placeholder', failMsg: '거리 입력 미노출' },
    async () => { await expect(admin.getByPlaceholder('미입력').first()).toBeVisible(); });
  await check(admin, { path: `${P} > 홀별 거리`, tcRef: `${R}_3`, tcId: 'HMTS-03-2', desc: '사용여부 checkbox 노출(≥1)', expected: 'checkbox ≥1', failMsg: '사용여부 체크박스 미노출' },
    async () => { expect(await admin.locator('.contents-box input[type="checkbox"]').count()).toBeGreaterThanOrEqual(1); });
  await check(admin, { path: `${P} > 홀별 거리`, tcRef: `${R}_3`, tcId: 'HMTS-03-3', desc: "'사용여부' 컬럼 라벨 노출", expected: "'사용여부'", failMsg: "'사용여부' 문구 미노출" },
    async () => { await expect(admin.locator('.contents-box').getByText('사용여부', { exact: true }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 버튼`, tcRef: `${R}_4`, tcId: 'HMTS-04', desc: '[초기화]/[저장] 버튼 노출(비파괴)', expected: '초기화/저장', failMsg: '버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '저장', exact: true }).first()).toBeVisible(); await expect(admin.getByRole('button', { name: '초기화' }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 4) 홀맵 미리보기 (/club/page/holemap-preview) — 시각 도구, 제한 검증
export async function runHolemapPreview(admin: Page) {
  const P = '홀맵 관리 > 홀맵 미리보기';
  const R = '홀맵 관리_홀맵 미리보기';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'HMP-01', desc: '안내 문구 노출(부분)', expected: '태블릿에 실제로', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('태블릿에 실제로'); });
  await check(admin, { path: `${P} > 미리보기 조건`, tcRef: `${R}_2`, tcId: 'HMP-02', desc: '미리보기 조건(코스/홀 vue-select ≥2)', expected: 'vs ≥2', failMsg: '조건 미노출' },
    async () => { expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(2); });
  await check(admin, { path: `${P} > 미리보기`, tcRef: `${R}_3`, tcId: 'HMP-03', desc: '미리보기 영역(svg) + 투명도 슬라이더 + 요약(노출만)', expected: 'svg+slider+summary', failMsg: '미리보기 미노출' },
    async () => { expect(await admin.locator('svg').count()).toBeGreaterThanOrEqual(1); await expect(admin.locator('.opacity-slider').first()).toBeVisible(); await expect(admin.locator('.preview-summary').first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 코스 운영 관리 (6종) - 구조 기반 TC ════════════════
//   ⚠ 전체 적용/선택 적용/수정/등록/삭제/조회/내보내기/checkbox는 비파괴(노출만). 안내문구 부분 일치

// 1) 핀 포지션 관리 (/club/page/course-analysis-pin-position)
export async function runPinPosition(admin: Page) {
  const P = '코스 운영 관리 > 핀 포지션 관리';
  const R = '코스 운영 관리_핀 포지션 관리';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'PIN-01', desc: '안내 문구 노출(부분)', expected: '핀 위치', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('핀 위치'); });
  for (const [i, c] of ['코스명', '홀', 'PAR', '야디지', '그린', '핀 포지션', '선택'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_2`, tcId: `PIN-02-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 액션`, tcRef: `${R}_3`, tcId: 'PIN-03', desc: '[전체 적용]/[선택 적용] 버튼 노출(비파괴)', expected: '전체/선택 적용', failMsg: '버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '전체 적용' }).first()).toBeVisible(); await expect(admin.getByRole('button', { name: '선택 적용' }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 2) 핀 포지션 변경이력 (/club/page/course-analysis-pin-history)
export async function runPinHistory(admin: Page) {
  const P = '코스 운영 관리 > 핀 포지션 변경이력';
  const R = '코스 운영 관리_핀 포지션 변경이력';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'PINH-01', desc: '안내 문구 노출(부분)', expected: '변경된 모든 이력', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('이력'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'PINH-02', desc: '조회기간 datepicker(≥2) + [조회]/[내보내기](비파괴)', expected: 'datepicker≥2', failMsg: '검색 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '조회' })).toBeVisible(); await expect(admin.getByRole('button', { name: '내보내기' })).toBeVisible(); });
  for (const [i, c] of ['코스명', '홀 번호', '변경일', '변경시간', '이전 핀위치', '변경 핀위치', '작업자'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_3`, tcId: `PINH-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 3) 핀 포지션 분석 (/club/page/course-analysis-pin)
export async function runPinAnalysis(admin: Page) {
  const P = '코스 운영 관리 > 핀 포지션 분석';
  const R = '코스 운영 관리_핀 포지션 분석';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'PINA-01', desc: '안내 문구 노출(부분)', expected: '평균 스코어/난이도', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('난이도'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'PINA-02', desc: '조회기간 datepicker(≥2) + [조회]/[내보내기](비파괴)', expected: 'datepicker≥2', failMsg: '검색 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '조회' })).toBeVisible(); });
  for (const [i, c] of ['라운드수', '라운드율', '오버파', '순위', 'SC평균'].entries())
    await check(admin, { path: `${P} > 분석표`, tcRef: `${R}_3`, tcId: `PINA-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 4) 코스 분석 (/club/page/course-analysis-detail)
export async function runCourseAnalysis(admin: Page) {
  const P = '코스 운영 관리 > 코스 분석';
  const R = '코스 운영 관리_코스 분석';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'CRS-01', desc: '안내 문구 노출(부분)', expected: '분석 자료', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('분석'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'CRS-02', desc: '조건 vue-select(≥1) + [조회](비파괴)', expected: 'vs≥1+조회', failMsg: '검색 미노출' },
    async () => { expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(1); await expect(admin.getByRole('button', { name: '조회' })).toBeVisible(); });
  for (const [i, c] of ['홀', '스코어', '퍼트수', '페어웨이안착률', '그린적중률'].entries())
    await check(admin, { path: `${P} > 분석표`, tcRef: `${R}_3`, tcId: `CRS-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 차트`, tcRef: `${R}_4`, tcId: 'CRS-04', desc: '분석 차트(svg) 노출(≥1)', expected: 'svg ≥1', failMsg: '차트 미노출' },
    async () => { expect(await admin.locator('svg').count()).toBeGreaterThanOrEqual(1); });
  await runCommonActions(admin, P, R);
}

// 5) 그린스피드 (/club/page/course-analysis-green-speed)
export async function runGreenSpeed(admin: Page) {
  const P = '코스 운영 관리 > 그린스피드';
  const R = '코스 운영 관리_그린스피드';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'GRN-01', desc: '안내 문구 노출(부분)', expected: '그린 스피드', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('그린 스피드'); });
  await check(admin, { path: `${P} > 입력`, tcRef: `${R}_2`, tcId: 'GRN-02', desc: '그린스피드 입력(예 2.6) + [수정] 버튼 노출(비파괴)', expected: 'input+수정', failMsg: '입력/버튼 미노출' },
    async () => { await expect(admin.getByPlaceholder('예) 2.6').first()).toBeVisible(); await expect(admin.getByRole('button', { name: '수정' }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 6) 골프장 소식 (/club/page/course-analysis-club-news)
export async function runClubNews(admin: Page) {
  const P = '코스 운영 관리 > 골프장 소식';
  const R = '코스 운영 관리_골프장 소식';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'NEWS-01', desc: '안내 문구 노출(부분)', expected: '골프장의 소식', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('골프장의 소식'); });
  for (const [i, c] of ['순서', '골프장소식', '노출기간', '노출여부', '작성자'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_2`, tcId: `NEWS-02-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 액션`, tcRef: `${R}_3`, tcId: 'NEWS-03', desc: '[등록] 버튼 노출(비파괴)', expected: '등록', failMsg: '등록 버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '등록', exact: true }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 고객 평가 관리 (4종) - 구조 기반 TC ════════════════
//   ⚠ 적용/초기화/내보내기/조회/숨김 처리는 비파괴(노출만). 안내문구 부분 일치

// 1) 고객 평가 (/club/page/customer-eval-poll)
export async function runCustomerEval(admin: Page) {
  const P = '고객 평가 관리 > 고객 평가';
  const R = '고객 평가 관리_고객 평가';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'CEVAL-01', desc: '안내 문구 노출(부분)', expected: '항목별 고객 평가 현황', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('고객 평가 현황'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'CEVAL-02', desc: '조회기간 datepicker(≥2) + 조건 vue-select + [적용]/[내보내기](비파괴)', expected: 'datepicker≥2', failMsg: '검색 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '적용', exact: true })).toBeVisible(); await expect(admin.getByRole('button', { name: '내보내기' })).toBeVisible(); });
  for (const [i, c] of ['기간', '평균 평점', '총 평가 수', '평가팀수'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_3`, tcId: `CEVAL-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 2) 캐디 평가 (/club/page/caddie-evaluation)
export async function runCaddieEval(admin: Page) {
  const P = '고객 평가 관리 > 캐디 평가';
  const R = '고객 평가 관리_캐디 평가';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'CDEV-01', desc: '안내 문구 노출(부분)', expected: '캐디에 대한 고객들의 평가', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('캐디에 대한 고객'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'CDEV-02', desc: '조회기간 datepicker(≥2) + [적용]/[내보내기](비파괴)', expected: 'datepicker≥2', failMsg: '검색 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '적용', exact: true })).toBeVisible(); });
  for (const [i, c] of ['태블릿 No.', '캐디명', '평균 평점', '총점', '총 평가 수', '평가팀수'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_3`, tcId: `CDEV-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 3) 후기 리스트 (/club/page/review-list)
export async function runReviewList(admin: Page) {
  const P = '고객 평가 관리 > 후기 리스트';
  const R = '고객 평가 관리_후기 리스트';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'RVL-01', desc: '안내 문구 노출(부분)', expected: '스마트스코어앱에 등록한 후기', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('후기'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'RVL-02', desc: '기간 버튼(1주일/1개월…) + datepicker(≥2) + [적용](비파괴)', expected: '기간+datepicker', failMsg: '검색 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '1개월' })).toBeVisible(); await expect(admin.getByRole('button', { name: '적용', exact: true })).toBeVisible(); });
  for (const [i, c] of ['작성일시', '내용', '작성자', '전체평점', '공감', '비공감', '답변상태'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_3`, tcId: `RVL-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  // ⚠ 버튼 라벨 '숨김 처리' → '숨김처리'(붙임, 2026-06-05). 공백 변동 대비 정규식
  await check(admin, { path: `${P} > 액션`, tcRef: `${R}_4`, tcId: 'RVL-04', desc: '[숨김처리]/[내보내기] 버튼 노출(비파괴)', expected: '숨김처리/내보내기', failMsg: '버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: /숨김\s*처리/ })).toBeVisible(); await expect(admin.getByRole('button', { name: '내보내기' })).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// 4) 후기 통계 (/club/page/review-statistics)
export async function runReviewStats(admin: Page) {
  const P = '고객 평가 관리 > 후기 통계';
  const R = '고객 평가 관리_후기 통계';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'RVS-01', desc: '안내 문구 노출(부분)', expected: '후기 통계', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('후기 통계'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'RVS-02', desc: '기간 버튼 + datepicker(≥2) + [조회]/[내보내기](비파괴)', expected: 'datepicker≥2', failMsg: '검색 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); await expect(admin.getByRole('button', { name: '조회' })).toBeVisible(); });
  for (const [i, c] of ['순서', '날짜', '등록후기 수', '전체', '코스', '그린', '서비스', '진행', '식음료'].entries())
    await check(admin, { path: `${P} > 통계표`, tcRef: `${R}_3`, tcId: `RVS-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: true }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 차트`, tcRef: `${R}_4`, tcId: 'RVS-04', desc: '후기 통계 차트(svg) 노출(≥1)', expected: 'svg ≥1', failMsg: '차트 미노출' },
    async () => { expect(await admin.locator('svg').count()).toBeGreaterThanOrEqual(1); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 계정 관리 (2종) - 구조 기반 TC ════════════════
//   ⚠ 권한변경/패스워드 변경/로그아웃/권한 그룹 추가·복사/수정/삭제/권한 적용은 비파괴(노출만, 클릭 금지)

// 1) 계정 리스트 (/club/page/account-user)
export async function runAccountList(admin: Page) {
  const P = '계정 관리 > 계정 리스트';
  const R = '계정 관리_계정 리스트';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'ACL-01', desc: '안내 문구 노출(부분)', expected: '등록된 계정들을 관리', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('계정'); });
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'ACL-02', desc: '검색(이름 input + vue-select) + [적용](비파괴)', expected: '검색 영역', failMsg: '검색 미노출' },
    async () => { await expect(admin.getByPlaceholder('이름을 입력해주세요')).toBeVisible(); await expect(admin.getByRole('button', { name: '적용', exact: true })).toBeVisible(); });
  for (const [i, c] of ['No.', '계정 상태', '부서', '이름', 'ID', '연락처', '권한'].entries())
    await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_3`, tcId: `ACL-03-${i + 1}`, desc: `컬럼 '${c}' 노출`, expected: `'${c}'`, failMsg: '컬럼 미노출' },
      async () => { await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible(); });
  for (const [i, b] of ['권한변경', '패스워드 변경'].entries())
    await check(admin, { path: `${P} > 행 액션`, tcRef: `${R}_4`, tcId: `ACL-04-${i + 1}`, desc: `행 [${b}] 버튼 노출(클릭 미수행·비파괴)`, expected: `[${b}]`, failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b }).first()).toBeVisible(); });
  // [로그아웃] 버튼은 '현재 로그인된 계정' 행에만 노출(TC No.23 사전조건 '로그인된 계정 있음') → 데이터 의존, 없으면 SKIP
  if ((await admin.getByRole('button', { name: '로그아웃' }).count().catch(() => 0)) > 0)
    await check(admin, { path: `${P} > 행 액션`, tcRef: `${R}_4`, tcId: 'ACL-04-3', desc: '행 [로그아웃] 버튼 노출(로그인된 계정 행·클릭 미수행·비파괴)', expected: '[로그아웃]', failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: '로그아웃' }).first()).toBeVisible(); });
  else
    skip({ path: `${P} > 행 액션`, tcRef: `${R}_4`, tcId: 'ACL-04-3', desc: '행 [로그아웃] 버튼 노출' }, '현재 로그인된 계정 없음 → 로그아웃 버튼 미노출(데이터 의존, TC No.23 사전조건 미충족)');
  await runCommonActions(admin, P, R);
}

// 2) 계정 권한 관리 (/club/page/account-permission)
export async function runAccountPermission(admin: Page) {
  const P = '계정 관리 > 계정 권한 관리';
  const R = '계정 관리_계정 권한 관리';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'APM-01', desc: '안내 문구 노출(부분)', expected: '부여할 권한을 세부적으로 설정', failMsg: '안내 미노출' },
    async () => { const e = admin.locator('.info-box-text'); await expect(e).toBeVisible(); await expect(e).toContainText('권한'); });
  for (const [i, b] of ['권한 그룹 복사', '권한 그룹 추가', '권한 적용'].entries())
    await check(admin, { path: `${P} > 액션`, tcRef: `${R}_2`, tcId: `APM-02-${i + 1}`, desc: `[${b}] 버튼 노출(비파괴)`, expected: `[${b}]`, failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });
  await check(admin, { path: `${P} > 권한 목록`, tcRef: `${R}_3`, tcId: 'APM-03', desc: "권한 목록 테이블(권한 명칭) + 기능 목록(기능 명칭) 노출", expected: '권한 명칭/기능 명칭', failMsg: '테이블 미노출' },
    async () => { await expect(admin.getByRole('columnheader', { name: '권한 명칭', exact: false }).first()).toBeVisible(); await expect(admin.getByRole('columnheader', { name: '기능 명칭', exact: false }).first()).toBeVisible(); });
  await runCommonActions(admin, P, R);
}

// ════════════════ 식음 관리 > 버전 및 설정 ════════════════
// 구조 기반 비파괴 검증 (드라이브 상세 TC 미작성). URL: /club/page/table-order-version
//  🔴 모든 액션이 파괴적(F&B/POS 동기화 실행·코스 기본식당 변경) → 노출·활성만 검증, 클릭/선택 금지
//  ⚠️ SNB 라벨 '버전 및 설정' (IA·langCheck의 '버전 업데이트'와 드리프트 → diff 기록)
export async function runFnbVersion(admin: Page) {
  const P = '식음 관리 > 버전 및 설정';
  const R = '식음 관리_버전 및 설정';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  const fnbCard = admin.locator('.contents-box.card-col').filter({ hasText: '식음관리(F&B) 데이터 연동' });
  const posCard = admin.locator('.contents-box.card-col').filter({ hasText: 'POS 메뉴 동기화' });
  const courseBox = admin.locator('.contents-box').filter({ hasText: /코스별\s*기본\s*식당\s*설정/ });

  // ── FNBVER-01 안내문구 원문 일치 ────────────────────────────
  await checkText(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'FNBVER-01', desc: '안내 문구 TC 원문 일치', expected: '식음관리(F&B) 변경사항과 POS 연동 정보를 태블릿에 반영할 수 있습니다.', failMsg: 'UI 불일치(안내 문구)' },
    admin.locator('.info-box-text'));

  // ── FNBVER-02 F&B 카드 제목/설명 ────────────────────────────
  await check(admin, { path: `${P} > F&B 데이터 연동`, tcRef: `${R}_2`, tcId: 'FNBVER-02', desc: 'F&B 데이터 연동 카드 제목/설명 노출', expected: '식음관리(F&B) 데이터 연동', failMsg: 'F&B 카드 미노출' },
    async () => { await expect(fnbCard.locator('.card-title')).toContainText('식음관리(F&B) 데이터 연동'); await expect(fnbCard.locator('.card-desc')).toContainText('태블릿 메뉴에 반영'); });

  // ── FNBVER-03 F&B 불릿 2줄 ──────────────────────────────────
  await check(admin, { path: `${P} > F&B 데이터 연동`, tcRef: `${R}_3`, tcId: 'FNBVER-03', desc: 'F&B 안내 불릿(반영 항목) 노출', expected: '식당 정보…/식음 메뉴 구성…', failMsg: '불릿 미노출' },
    async () => { const t = await fnbCard.locator('.card-bullets').innerText(); expect(t).toContain('변경사항을 반영'); expect(t).toContain('최신 상태'); });

  // ── FNBVER-04 현재버전 표기(데이터 의존 — 패턴) ──────────────
  await check(admin, { path: `${P} > F&B 데이터 연동`, tcRef: `${R}_4`, tcId: 'FNBVER-04', desc: '현재버전 표기 노출(숫자·업데이트 표시)', expected: '현재버전 : <숫자>', failMsg: '현재버전 표기 미노출' },
    async () => { const t = await fnbCard.innerText(); expect(t).toMatch(/현재버전\s*:\s*\d+/); });

  // ── FNBVER-05 [F&B 데이터 동기화] 버튼 노출·활성(클릭 금지) ──
  await check(admin, { path: `${P} > F&B 데이터 연동`, tcRef: `${R}_5`, tcId: 'FNBVER-05', desc: '[F&B 데이터 동기화] 버튼 노출·활성(비파괴·클릭 미수행)', expected: '[F&B 데이터 동기화]', failMsg: '버튼 미노출/비활성' },
    async () => { const b = fnbCard.getByRole('button', { name: 'F&B 데이터 동기화' }); await expect(b).toBeVisible(); await expect(b).toBeEnabled(); });

  // ── FNBVER-06 POS 카드 제목/설명 ────────────────────────────
  await check(admin, { path: `${P} > POS 연동`, tcRef: `${R}_6`, tcId: 'FNBVER-06', desc: 'POS 연동 카드 제목/설명 노출', expected: 'POS 메뉴 동기화', failMsg: 'POS 카드 미노출' },
    async () => { await expect(posCard.locator('.card-title')).toContainText('POS 메뉴 동기화'); await expect(posCard.locator('.card-desc')).toContainText('ERP'); });

  // ── FNBVER-07 [POS 메뉴 동기화] 버튼 노출·활성(클릭 금지) ────
  await check(admin, { path: `${P} > POS 연동`, tcRef: `${R}_7`, tcId: 'FNBVER-07', desc: '[POS 메뉴 동기화] 버튼 노출·활성(비파괴·클릭 미수행)', expected: '[POS 메뉴 동기화]', failMsg: '버튼 미노출/비활성' },
    async () => { const b = posCard.getByRole('button', { name: 'POS 메뉴 동기화' }); await expect(b).toBeVisible(); await expect(b).toBeEnabled(); });

  // ── FNBVER-08 코스별 기본 식당 설정 섹션 ────────────────────
  await check(admin, { path: `${P} > 코스별 기본 식당`, tcRef: `${R}_8`, tcId: 'FNBVER-08', desc: '코스별 기본 식당 설정 섹션(제목/안내) 노출', expected: '코스별 기본 식당 설정', failMsg: '섹션 미노출' },
    async () => { await expect(courseBox.locator('.sub-title-box')).toContainText('코스별 기본 식당 설정'); await expect(courseBox).toContainText('기본 식당을 설정'); });

  // ── FNBVER-09 코스 행 + 기본식당 vue-select(변경 금지) ──────
  await check(admin, { path: `${P} > 코스별 기본 식당`, tcRef: `${R}_9`, tcId: 'FNBVER-09', desc: '코스 행(≥1) + 기본식당 선택(vue-select)·현재 선택값 노출(비파괴·변경 미수행)', expected: 'v-select ≥1 + 선택값', failMsg: '코스 기본식당 설정 미노출' },
    async () => { const vs = new VueSelect(courseBox); expect(await vs.count()).toBeGreaterThanOrEqual(1); await expect(courseBox.locator('.vs__selected').first()).toBeVisible(); });

  // ── 기획-구현 차이: SNB 라벨 드리프트 ───────────────────────
  diff(P, 'SNB 1depth 명칭 = 버전 업데이트(IA 변경표)', "실제 SNB 라벨 = '버전 및 설정'", `${R}_1`, '명칭 드리프트 — 기능 정상, IA/문서 정정 권장(QA 확인 요망)');
  await runCommonActions(admin, P, R);
}

// ════════════════ 식음 관리 > 식당 관리 ════════════════
// 마스터-디테일(좌: 식당 리스트+아이콘 범례+[관리] / 우: 선택 안내). URL: /club/page/table-order-restaurant
//  🔴 비파괴: 식당 추가·관리(편집)·삭제 금지 → 노출만 검증
export async function runFnbRestaurant(admin: Page) {
  const P = '식음 관리 > 식당 관리';
  const R = '식음 관리_식당 관리';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  const listBox = admin.locator('.contents-box').filter({ hasText: /식당\s*추가/ });

  await checkText(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'RESTO-01', desc: '안내 문구 TC 원문 일치', expected: '운영 중인 식당을 생성 및 관리할 수 있습니다. 식당을 선택하여 판매할 메뉴를 관리할 수 있습니다.', failMsg: 'UI 불일치(안내 문구)' },
    admin.locator('.info-box-text'));

  await check(admin, { path: `${P} > 리스트`, tcRef: `${R}_2`, tcId: 'RESTO-02', desc: '[+ 식당 추가] 버튼 노출(비파괴·클릭 미수행)', expected: '[+ 식당 추가]', failMsg: '버튼 미노출' },
    async () => { await expect(listBox.getByRole('button', { name: /식당\s*추가/ }).first()).toBeVisible(); });

  await check(admin, { path: `${P} > 리스트`, tcRef: `${R}_3`, tcId: 'RESTO-03', desc: '아이콘 범례(테이블오더/캐디앱 주문가능) 노출', expected: '아이콘 설명', failMsg: '아이콘 범례 미노출' },
    async () => { await expect(listBox).toContainText('주문가능 식당'); await expect(listBox).toContainText('캐디앱'); });

  await check(admin, { path: `${P} > 리스트`, tcRef: `${R}_4`, tcId: 'RESTO-04', desc: '식당 행(≥1) + 행 [관리] 버튼 노출(비파괴·클릭 미수행)', expected: '식당 행 ≥1 + [관리]', failMsg: '식당 행/관리 버튼 미노출' },
    async () => { expect(await listBox.getByRole('button', { name: '관리', exact: true }).count()).toBeGreaterThanOrEqual(1); });

  await check(admin, { path: `${P} > 디테일`, tcRef: `${R}_5`, tcId: 'RESTO-05', desc: '우측 디테일 초기 안내(식당 선택 유도) 노출', expected: '리스트에서 식당을 선택해 주세요.', failMsg: '디테일 초기 안내 미노출' },
    async () => { await expect(admin.getByText('리스트에서 식당을 선택해 주세요.').first()).toBeVisible(); });

  await runCommonActions(admin, P, R);
}

// ════════════════ 식음 관리 > 상품 등록 관리 ════════════════
// 검색폼 + 상품 테이블(8컬럼). URL: /club/page/table-order-product
//  🔴 비파괴: 등록·삭제·원산지/카테고리 관리·노출 토글 변경 금지 → 노출만 검증
export async function runFnbProduct(admin: Page) {
  const P = '식음 관리 > 상품 등록 관리';
  const R = '식음 관리_상품 등록 관리';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  await checkText(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'FNBPROD-01', desc: '안내 문구 TC 원문 일치', expected: '식당에서 판매할 메뉴의 등록 및 관리를 할 수 있습니다. 메뉴별 이미지, 가격 등을 설정할 수 있습니다.', failMsg: 'UI 불일치(안내 문구)' },
    admin.locator('.info-box-text'));

  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_2`, tcId: 'FNBPROD-02', desc: "상품명 검색 input(ph '상품명을 입력하세요.') + [검색] 노출", expected: '상품명 검색 + [검색]', failMsg: '검색 영역 미노출' },
    async () => { await expect(admin.getByPlaceholder('상품명을 입력하세요.')).toBeVisible(); await expect(admin.getByRole('button', { name: '검색', exact: true }).first()).toBeVisible(); });

  for (const [i, b] of ['선택삭제', '원산지 관리', '카테고리 관리', '상품 등록'].entries())
    await check(admin, { path: `${P} > 액션`, tcRef: `${R}_3`, tcId: `FNBPROD-03-${i + 1}`, desc: `[${b}] 버튼 노출(비파괴·클릭 미수행)`, expected: `[${b}]`, failMsg: '버튼 미노출' },
      async () => { await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });

  await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_4`, tcId: 'FNBPROD-04', desc: '상품 테이블 헤더(No/카테고리/상품명/가격/조리시간/운영시간/노출) 노출', expected: 'No·썸네일·카테고리·상품명·가격·조리시간(분)·운영시간·노출', failMsg: '테이블 헤더 미노출' },
    async () => { for (const h of ['카테고리', '상품명', '가격', '조리시간', '운영시간', '노출']) await expect(admin.getByRole('columnheader', { name: h, exact: false }).first()).toBeVisible(); });

  const rowN = await admin.locator('tbody tr').count().catch(() => 0);
  if (rowN > 0)
    await check(admin, { path: `${P} > 테이블 > 행`, tcRef: `${R}_5`, tcId: 'FNBPROD-05', desc: '상품 행(≥1) 노출(데이터 의존·고정 count 금지)', expected: '상품 행 ≥1', failMsg: '상품 행 미노출' },
      async () => { expect(await admin.locator('tbody tr').count()).toBeGreaterThanOrEqual(1); });
  else
    skip({ path: `${P} > 테이블 > 행`, tcRef: `${R}_5`, tcId: 'FNBPROD-05', desc: '상품 행(≥1) 노출' }, '등록된 상품 없음(데이터 없음)');

  await runCommonActions(admin, P, R);
}

// ════════════════ 식음 관리 > 주문 내역 관리 ════════════════
// 캐디주문실적·그늘집주문내역 통합 통계 대시보드. URL: /club/page/table-order-statistics
//  🔴 비파괴: 조회/필터/내보내기(읽기성)만. 값·행수는 데이터 의존(0/빈상태 허용)
export async function runFnbOrderHistory(admin: Page) {
  const P = '식음 관리 > 주문 내역 관리';
  const R = '식음 관리_주문 내역 관리';
  await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  await checkText(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'FNBORD-01', desc: '안내 문구 TC 원문 일치', expected: '주문내역을 관리할 수 있습니다. 식당 별, 기간 별 주문 현황에 대하여 확인 및 엑셀 다운로드가 가능합니다.', failMsg: 'UI 불일치(안내 문구)' },
    admin.locator('.info-box-text'));

  await check(admin, { path: `${P} > 관점 탭`, tcRef: `${R}_2`, tcId: 'FNBORD-02', desc: '관점 탭(캐디주문실적/그늘집주문내역) 노출 — 캐디주문실적·그늘집주문내역 통합', expected: '캐디주문실적/그늘집주문내역', failMsg: '관점 탭 미노출' },
    async () => { await expect(admin.getByText('캐디주문실적', { exact: true }).first()).toBeVisible(); await expect(admin.getByText('그늘집주문내역', { exact: true }).first()).toBeVisible(); });

  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_3`, tcId: 'FNBORD-03', desc: '기간 datepicker(시작~종료) 노출(달력 전용)', expected: 'datepicker-input ×2', failMsg: '기간 datepicker 미노출' },
    async () => { expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2); });

  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_4`, tcId: 'FNBORD-04', desc: '기간 단위(일별/주별/월별) 버튼 노출', expected: '일별/주별/월별', failMsg: '기간 단위 버튼 미노출' },
    async () => { for (const b of ['일별', '주별', '월별']) await expect(admin.getByRole('button', { name: b, exact: true }).first()).toBeVisible(); });

  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_5`, tcId: 'FNBORD-05', desc: '식당/캐디 필터(vue-select ≥2) 노출', expected: 'v-select ≥2', failMsg: '필터 미노출' },
    async () => { expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(2); });

  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_6`, tcId: 'FNBORD-06', desc: '[적용]/[초기화] 버튼 노출', expected: '적용/초기화', failMsg: '버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '적용', exact: true }).first()).toBeVisible(); await expect(admin.getByRole('button', { name: '초기화', exact: true }).first()).toBeVisible(); });
  diff(`${P} > 검색`, '검색 버튼 라벨 [검색]', '[적용] (리뉴얼 라벨 통일)', `${R}_6`, '기능 정상 — 현 구현(AS-IS) 유지');

  await check(admin, { path: `${P} > 요약`, tcRef: `${R}_7`, tcId: 'FNBORD-07', desc: '요약 카드(총 주문금액/총 주문건수/평균 주문금액/주문TOP캐디) 노출(값 데이터 의존)', expected: '요약 카드 4종', failMsg: '요약 카드 미노출' },
    async () => { const sc = new SummaryCards(admin); for (const t of ['총 주문금액', '총 주문건수', '평균 주문금액', '주문TOP캐디']) await expect(sc.card(t)).toBeVisible(); });

  await check(admin, { path: `${P} > 주문 랭킹`, tcRef: `${R}_8`, tcId: 'FNBORD-08', desc: '주문 랭킹 테이블 헤더(순위/캐디명/식당/주문금액/평균주문금액) 노출', expected: '순위·캐디명·식당·주문금액 등', failMsg: '주문 랭킹 헤더 미노출' },
    async () => { for (const h of ['순위', '캐디명', '주문금액']) await expect(admin.getByRole('columnheader', { name: h, exact: false }).first()).toBeVisible(); });

  await check(admin, { path: `${P} > 주문 상세 내역`, tcRef: `${R}_9`, tcId: 'FNBORD-09', desc: '주문 상세 내역 테이블 헤더(No/캐디명/식당/주문내역/주문일시) 노출', expected: 'No·캐디명·식당·주문내역·주문일시', failMsg: '주문 상세 헤더 미노출' },
    async () => { for (const h of ['주문내역', '주문일시']) await expect(admin.getByRole('columnheader', { name: h, exact: false }).first()).toBeVisible(); });

  // ✨계산 정합성(2026-06-17): 캐디주문실적 랭킹표 행내 불변식(구조 — 명세 불요)
  //   주문금액 = 공급가 + 부가세(공급대가), 평균주문금액 = round(주문금액 / 주문건수)
  const rank = new DataGrid(admin.locator('table').filter({ has: admin.getByRole('columnheader', { name: '공급가', exact: false }) }).first());
  if (!(await rank.isEmpty().catch(() => true))) {
    const rrows = (await rank.records()).map(rec => ({
      name: cell(rec, /캐디명|순위/),
      supply: DataGrid.num(cell(rec, /공급가/)),
      vat: DataGrid.num(cell(rec, /부가세/)),
      amount: DataGrid.num(cell(rec, /^주문금액$|주문금액/)),
      cnt: DataGrid.num(cell(rec, /주문건수/)),
      avg: DataGrid.num(cell(rec, /평균주문금액/)),
    }));
    await verifyInvariants(admin, P, R, 'FNBORD-CALC', rrows, r => {
      const inv: { name: string; ok: boolean; detail: string }[] = [];
      if ([r.supply, r.vat, r.amount].every(Number.isFinite))
        inv.push({ name: '주문금액 = 공급가 + 부가세', ok: r.supply + r.vat === r.amount, detail: `${r.name}: ${r.supply}+${r.vat}=${r.supply + r.vat} vs ${r.amount}` });
      if ([r.amount, r.cnt, r.avg].every(Number.isFinite) && r.cnt > 0)
        inv.push({ name: '평균주문금액 = 주문금액 / 주문건수', ok: Math.round(r.amount / r.cnt) === r.avg, detail: `${r.name}: round(${r.amount}/${r.cnt})=${Math.round(r.amount / r.cnt)} vs ${r.avg}` });
      return inv;
    });
  }

  await runCommonActions(admin, P, R);
}

// ════════════════ 대회 > 대회관리 ════════════════
// 공식 대회 운영(참가자/조편성/그룹/스코어/리더보드). URL: /club/page/tournament
//  🔴 비파괴: 신규 등록·설정·등록·복사·보기(상세/웹뷰 진입) 금지 → 노출만. 검색은 조회성.
//  ⚠️ 안내문구가 .info-box-text 아님 → 안내 박스 텍스트 스코프 후 부분 일치
export async function runTournament(admin: Page) {
  const P = '대회 > 대회관리';
  const R = '대회_대회관리';
  await admin.locator('.contents-box').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  const infoBox = admin.locator('.contents-box').filter({ hasText: /대회관리\]\s*기능을\s*제공/ });
  const tableBox = admin.locator('.contents-box').filter({ has: admin.getByRole('columnheader', { name: '대회명', exact: false }) });

  // ── TOURN-01 안내문구 핵심구(부분) ─────────────────────────
  await check(admin, { path: `${P} > 설명`, tcRef: `${R}_1`, tcId: 'TOURN-01', desc: '안내문구 핵심구 노출(부분 일치)', expected: '공식적이고 다양한 방식의 대회 / 참가자, 조편성, 그룹 / 대회모드', failMsg: '안내문구 미노출' },
    async () => { await expect(infoBox).toContainText('공식적이고 다양한 방식의 대회'); await expect(infoBox).toContainText('참가자, 조편성, 그룹'); await expect(infoBox).toContainText('대회모드'); });

  // ── TOURN-02 웹뷰 로그인 URL 2종 + [URL복사]/[보기] ─────────
  await check(admin, { path: `${P} > 웹뷰 URL`, tcRef: `${R}_2`, tcId: 'TOURN-02', desc: '리더보드/관리자 웹뷰 로그인 URL + [URL복사]/[보기] 노출(비파괴)', expected: '웹뷰 URL 2종 + 복사/보기', failMsg: '웹뷰 URL 영역 미노출' },
    async () => {
      await expect(infoBox).toContainText('리더보드 웹뷰 로그인 URL'); await expect(infoBox).toContainText('관리자 웹뷰 로그인 URL');
      await expect(infoBox.getByRole('button', { name: 'URL복사' }).first()).toBeVisible();
      await expect(infoBox.getByRole('button', { name: '보기', exact: true }).first()).toBeVisible();
    });

  // ── TOURN-03 검색어 입력 + [검색] ──────────────────────────
  await check(admin, { path: `${P} > 검색`, tcRef: `${R}_3`, tcId: 'TOURN-03', desc: "검색어 입력(ph '검색어 입력') + [검색] 노출", expected: '검색어 입력 + [검색]', failMsg: '검색 영역 미노출' },
    async () => { await expect(admin.getByPlaceholder('검색어 입력')).toBeVisible(); await expect(admin.getByRole('button', { name: '검색', exact: true }).first()).toBeVisible(); });

  // ── TOURN-04 [신규 등록] 버튼(비파괴·클릭 금지) ─────────────
  await check(admin, { path: `${P} > 액션`, tcRef: `${R}_4`, tcId: 'TOURN-04', desc: '[신규 등록] 버튼 노출(비파괴·클릭 미수행)', expected: '[신규 등록]', failMsg: '버튼 미노출' },
    async () => { await expect(admin.getByRole('button', { name: '신규 등록' }).first()).toBeVisible(); });

  // ── TOURN-05 대회 테이블 헤더(주요 컬럼) ───────────────────
  await check(admin, { path: `${P} > 테이블`, tcRef: `${R}_5`, tcId: 'TOURN-05', desc: '대회 테이블 헤더(대회명/대회일자/참가자/조편성/그룹편집/스코어/결과집계/상태) 노출', expected: '대회명·대회일자·참가자·조편성·그룹편집·스코어·결과집계·상태', failMsg: '테이블 헤더 미노출' },
    async () => { for (const h of ['대회명', '대회일자', '조편성', '그룹편집', '스코어', '결과집계', '상태']) await expect(admin.getByRole('columnheader', { name: h, exact: false }).first()).toBeVisible(); });

  // ── TOURN-06 대회 행 ≥1(데이터 의존) ───────────────────────
  const rowN = await tableBox.locator('tbody tr').count().catch(() => 0);
  if (rowN > 0)
    await check(admin, { path: `${P} > 테이블 > 행`, tcRef: `${R}_6`, tcId: 'TOURN-06', desc: '대회 행(≥1) 노출(데이터 의존·고정 count 금지)', expected: '대회 행 ≥1', failMsg: '대회 행 미노출' },
      async () => { expect(await tableBox.locator('tbody tr').count()).toBeGreaterThanOrEqual(1); });
  else
    skip({ path: `${P} > 테이블 > 행`, tcRef: `${R}_6`, tcId: 'TOURN-06', desc: '대회 행(≥1) 노출' }, '등록된 대회 없음(데이터 없음)');

  // ── TOURN-07 행 액션([보기] 등) 노출(비파괴·클릭 금지) ──────
  if (rowN > 0)
    await check(admin, { path: `${P} > 테이블 > 행 액션`, tcRef: `${R}_7`, tcId: 'TOURN-07', desc: '행 액션([보기]/[복사] 등) 노출(비파괴·클릭 미수행)', expected: '[보기] ≥1', failMsg: '행 액션 미노출' },
      async () => { expect(await tableBox.locator('tbody').getByRole('button', { name: '보기', exact: true }).count()).toBeGreaterThanOrEqual(1); });
  else
    skip({ path: `${P} > 테이블 > 행 액션`, tcRef: `${R}_7`, tcId: 'TOURN-07', desc: '행 액션 노출' }, '등록된 대회 없음(데이터 없음)');

  // ── 기획-구현 차이: 리더보드=관리자 웹뷰 URL 동일 ──────────
  diff(P, '리더보드 웹뷰 URL ≠ 관리자 웹뷰 URL(별도 경로 기대)', "두 URL이 동일('https://smartscore.kr/leaderBoardLogin')", `${R}_2`, 'URL 복붙/매핑 오류 의심 — QA 확인 요망');
  await runCommonActions(admin, P, R);
}

// ════════════════ IA 구현 여부 ════════════════
const IA_TREE: { menu: string; subs: string[] }[] = [
  { menu: '홈', subs: [] },
  { menu: '라운드관리', subs: ['내장 현황', '내장 통계', '전체 라운드', '단체 라운드', '라운드 설정', '카트 관리', '홀별 정산 관리'] },
  // ✨드리프트(2026-06-16): '관제 모니터' 신규 SNB 진입 확인(카트이동경로 확인 통합 추정) → IA_TREE 추가. '카트이동경로 확인'은 제거 추적 유지(미구현).
  { menu: '관제 관리', subs: ['관제 모니터', '메시지 기록 조회', '라이브채팅 공지 조회', '아이콘 관리', '카트이동경로 확인'] },
  { menu: '태블릿 운영 관리', subs: ['태블릿 기능 설정', '메시지 관리', '홀 이벤트 관리'] },
  { menu: '홀맵 관리', subs: ['홀맵 구역 설정', '카트패스 진입여부 설정', '티샷 유의 거리 설정', '홀맵 미리보기'] },
  { menu: '코스 운영 관리', subs: ['핀 포지션 관리', '핀 포지션 변경이력', '핀 포지션 분석', '코스 분석', '그린 스피드', '골프장 소식'] },
  { menu: '경기 진행 관리', subs: ['진행시간 표준 설정', '진행시간 실시간', '진행시간 조회', '진행시간 통계'] },
  { menu: '캐디 관리', subs: ['캐디 리스트', '캐디 등록 관리', '캐디 실적'] },
  { menu: '캐디피 관리', subs: ['캐디피 설정', '캐디피 통계', '캐디피 결제 내역', '캐디 자료/신고서'] },
  { menu: '배토 관리', subs: ['배토 기록 조회', '배토 통계'] },
  { menu: '식음 관리', subs: ['버전 및 설정', '그늘집 및 TOS관리', '식당 관리', '상품 등록 관리', '식당·품목 매핑', '주문 내역 관리'] },   // ✎ '버전 업데이트'→'버전 및 설정'(실 SNB, 2026-06-09 정정)
  { menu: '고객 평가 관리', subs: ['캐디 평가', '고객 평가', '식음료 평가', '후기 리스트', '후기 통계'] },
  { menu: '대회', subs: ['대회관리'] },
  { menu: '계정 관리', subs: ['계정 리스트', '계정 관리인 리스트'] },
];
const ALIASES: string[][] = [['홈', 'home']];   // 혼용 허용 (확인 후 추가)
function aliasMatch(snbText: string, iaName: string): boolean {
  const a = norm(snbText).toLowerCase(), b = norm(iaName).toLowerCase();
  return a.includes(b) || b.includes(a) || ALIASES.some(g => g.includes(a) && g.includes(b));
}

// ════════════════ 관제 관리 > 관제 모니터 (SNB有/TC無 추적) ════════════════
//   ✨드리프트(2026-06-16): SNB에 '관제 모니터' 신규 메뉴 확인. 카트이동경로 확인이 통합된 것으로 추정.
//   범위제외 가능(관제팝업 정책 동일 — 별도 모니터링 화면). 상세 TC 미작성 → noTC로 추적.
export async function runControlMonitor(admin: Page) {
  noTC('관제 관리 > 관제 모니터', admin.url(), '신규 메뉴(2026-06-16, 카트이동경로 확인 통합 추정) — 범위제외 가능(상세 TC 미작성)');
}

export async function runIA(admin: Page) {
  for (const { menu, subs } of IA_TREE) {
    const parents = admin.locator('.depth-1-title');
    const pc = await parents.count();
    let pFound = false;
    for (let i = 0; i < pc; i++) if (aliasMatch(await parents.nth(i).innerText().catch(() => ''), menu)) { pFound = true; await parents.nth(i).click().catch(() => {}); break; }
    if (subs.length === 0) { recordIA(menu, '', pFound ? '구현' : '미구현', pFound ? admin.url() : '', pFound ? '대메뉴 존재' : 'SNB 대메뉴 없음'); continue; }
    if (!pFound) { for (const sub of subs) recordIA(menu, sub, '미구현', '', 'SNB 대메뉴 없음/명칭 불일치'); continue; }
    for (const sub of subs) {
      try {
        const links = admin.locator('.depth-2 a'); const n = await links.count(); let link = null;
        for (let i = 0; i < n; i++) if (norm(await links.nth(i).innerText().catch(() => '')).includes(norm(sub))) { link = links.nth(i); break; }
        if (!link) { recordIA(menu, sub, '미구현', '', 'SNB 메뉴 없음/명칭 불일치'); continue; }
        if (!(await link.isVisible().catch(() => false))) { for (let i = 0; i < pc; i++) if (aliasMatch(await parents.nth(i).innerText().catch(() => ''), menu)) { await parents.nth(i).click().catch(() => {}); break; } await link.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {}); }
        const before = admin.url(); await link.click().catch(() => {});
        await admin.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {}); await admin.waitForTimeout(600);
        const url = admin.url();
        if (/\/club\//.test(url) && url !== before) recordIA(menu, sub, '구현', url, '진입 성공');
        else if (/\/club\//.test(url)) recordIA(menu, sub, '구현', url, '진입(URL 동일)');
        else recordIA(menu, sub, '진입불가', url, '클릭 후 미진입');
      } catch (e: any) { recordIA(menu, sub, '진입불가', '', String(e?.message || e).slice(0, 80)); }
    }
  }
}

import { test } from '../lib/fixtures';
import { writeReport, resetResults, resetNoTC, resetDiff, resetReview } from '../lib/reporter';
import { runLangCheckUnified, TARGET_LANGS } from '../lib/langCheck';

// ──────────────────────────────────────────────────────────────
//  통합 언어 검증 — 정적 슬롯 비교 + 동적 스캔(드롭다운/라디오/팝업)을 메뉴당 1회 방문으로 처리.
//   lang-check-all + lang-check-dynamic 를 합친 효율적 대안:
//    ① 정적: KO baseline ↔ 외국어 슬롯 비교 (한글노출/혼재/미번역/인코딩/글자잘림)
//    ② 동적: 드롭다운 옵션목록 / 라디오 선택 시 변경 텍스트 / 클릭 팝업 내 문구
//   방식: 한국어 진입 → KO 슬롯 캡처 + 트리거 수집 → 언어 전환 → FG 슬롯 비교 + 동적스캔 → 원복
//   리포트: reports/lang-check-unified-<언어>_report_*.xlsx
//   ⚠ 비파괴: 드롭다운=Escape, 팝업=보기성만 열고 닫기, 라디오=클릭 후 복구(저장 안 함)
//
// 실행(전체):     npx playwright test --project=admin-chromium Admin/lang-check-unified.spec.ts --no-deps
// 실행(일부 언어): $env:LANGS = "영어"; npx playwright test ...
// 실행(일부 메뉴): $env:LANGDYN_MENUS = "경기 진행 관리"; npx playwright test ...
// 파괴 confirm 포함: $env:ALLOW_DESTRUCTIVE = "1"; npx playwright test ...
// ──────────────────────────────────────────────────────────────
const FILTER = (process.env.LANGS || '').split(',').map(s => s.trim()).filter(Boolean);
const LANGS = FILTER.length ? TARGET_LANGS.filter(l => FILTER.includes(l.ko) || FILTER.includes(l.label)) : TARGET_LANGS;
const ALLOW_DESTRUCTIVE = process.env.ALLOW_DESTRUCTIVE === '1';

for (const lang of LANGS) {
  test(`통합 언어 검증(정적+동적) — ${lang.ko}(${lang.label})`, async ({ admin }) => {
    test.setTimeout(1_500_000);   // 정적+동적 합산 ~40분/언어 여유값
    resetResults(); resetNoTC(); resetDiff(); resetReview();
    await runLangCheckUnified(admin, lang, ALLOW_DESTRUCTIVE);
    await writeReport(`lang-check-unified-${lang.ko}`);
    if (process.env.KEEP_OPEN) await admin.pause();
  });
}

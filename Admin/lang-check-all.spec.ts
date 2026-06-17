import { test } from '../lib/fixtures';
import { writeReport, resetResults, resetNoTC, resetDiff, resetReview } from '../lib/reporter';
import { runLangCheckAll, TARGET_LANGS } from '../lib/langCheck';

// ──────────────────────────────────────────────────────────────
//  언어 검증 (전체 메뉴 · 공식 지원 언어 7개) — 언어별 별도 리포트 파일
//   검출(FAIL): 한글 노출 / 언어 혼재 / 미노출(미번역) / 인코딩 깨짐(�·□·??) / 글자 잘림
//   확인 필요(판정 제외): 말줄임(…) / 시각 레이어(이미지 내 텍스트·글리프□·레이아웃) + 스크린샷
//   관찰(기록만): 날짜·숫자 포맷.   제외: 토스트/에러(액션 유발 必, 비파괴), 번역 정합성(오역)
//   방식: 한국어 진입 → baseline 캡처 → 언어 전환 → 동일 슬롯(DOM경로 키) 대조 → 한국어 원복(비파괴)
//   결과: reports/lang-check-<언어>_report_*.xlsx (시트: …/주요 이슈 현황/확인 필요·관찰)
// 실행(전체): npx playwright test --project=admin-chromium Admin/lang-check-all.spec.ts --no-deps
// 실행(일부 언어 검증): LANGS=일본어,영어 npx playwright test ... --no-deps
// ──────────────────────────────────────────────────────────────
const FILTER = (process.env.LANGS || '').split(',').map(s => s.trim()).filter(Boolean);
const LANGS = FILTER.length ? TARGET_LANGS.filter(l => FILTER.includes(l.ko) || FILTER.includes(l.label)) : TARGET_LANGS;

for (const lang of LANGS) {
  test(`언어 검증 전체 메뉴 — ${lang.ko}(${lang.label})`, async ({ admin }) => {
    test.setTimeout(900_000);
    resetResults(); resetNoTC(); resetDiff(); resetReview();
    await runLangCheckAll(admin, lang);
    await writeReport(`lang-check-${lang.ko}`);
    if (process.env.KEEP_OPEN) await admin.pause();
  });
}

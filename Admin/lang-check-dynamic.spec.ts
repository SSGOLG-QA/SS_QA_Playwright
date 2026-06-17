import { test } from '../lib/fixtures';
import { writeReport, resetResults, resetNoTC, resetDiff, resetReview } from '../lib/reporter';
import { runLangCheckDynamic, TARGET_LANGS } from '../lib/langCheck';

// ──────────────────────────────────────────────────────────────
//  동적 요소 언어 검증 (드롭다운 옵션 / 클릭 팝업) — 정적 스캔 미포착분 보강
//   대상: ① 펼친 vue-select 옵션목록  ② 행 버튼 클릭 시 .modal-group 팝업(문구·버튼·라벨)
//        ③ 스코어카드 가로/세로 전환 후 재스캔
//   분류(FAIL): 한글 노출 / 언어 혼재 / 인코딩 깨짐.  정상은 실제값(번역결과) 기록.
//   ⚠ 비파괴: 드롭다운=Escape, 팝업=보기성만 열고 취소/닫기. 삭제 confirm 은 ALLOW_DESTRUCTIVE 시에만(스캔 후 취소).
//   리포트: reports/lang-check-dynamic-<언어>_report_*.xlsx
// 실행: npx playwright test --project=admin-chromium Admin/lang-check-dynamic.spec.ts --no-deps
//      LANGS=영어,일본어 ...   /   삭제 confirm 포함: $env:ALLOW_DESTRUCTIVE="1"; ...
// ──────────────────────────────────────────────────────────────
const FILTER = (process.env.LANGS || '').split(',').map(s => s.trim()).filter(Boolean);
const LANGS = FILTER.length ? TARGET_LANGS.filter(l => FILTER.includes(l.ko) || FILTER.includes(l.label)) : TARGET_LANGS;
const ALLOW_DESTRUCTIVE = process.env.ALLOW_DESTRUCTIVE === '1';

for (const lang of LANGS) {
  test(`동적 언어 검증(드롭다운/팝업) — ${lang.ko}(${lang.label})`, async ({ admin }) => {
    test.setTimeout(1_200_000);
    resetResults(); resetNoTC(); resetDiff(); resetReview();
    await runLangCheckDynamic(admin, lang, ALLOW_DESTRUCTIVE);
    await writeReport(`lang-check-dynamic-${lang.ko}`);
    if (process.env.KEEP_OPEN) await admin.pause();
  });
}

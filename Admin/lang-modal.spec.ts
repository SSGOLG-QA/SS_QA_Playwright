/**
 * P2-B: 팝업/모달 전용 다국어 결함 리포트
 *
 * 목적: 7개 언어의 팝업·모달 내 텍스트(제목·버튼·레이블·placeholder) i18n 결함을
 *       단일 Excel 파일로 통합 보고.
 *
 * 특징:
 *  - runLangCheckModal: 팝업 트리거 있는 화면만 언어 전환·스캔 → 빠른 실행
 *  - captureModal 확장분(placeholder·label) 포함 → 폼 모달 내 미번역 자동 포착
 *  - 트리거 없는 화면은 SKIP(결함 아님)
 *  - 부분 실행: LANGMODAL_MENUS=라운드관리,내장현황 env 설정 시 범위 한정
 *
 * 실행:
 *   npx playwright test --project=admin-chromium Admin/lang-modal.spec.ts --no-deps --headed
 *
 * 부분 실행 예:
 *   $env:LANGMODAL_MENUS="라운드관리,내장 현황"
 *   npx playwright test --project=admin-chromium Admin/lang-modal.spec.ts --no-deps --headed
 *
 * 산출물:
 *   reports/lang-modal-결함_report_<timestamp>.xlsx
 *   시트 구성:
 *     - 통합 요약      : 언어별 FAIL/PASS/SKIP 집계
 *     - 모달 결함 목록 : FAIL 항목(팝업 종류·트리거·화면·한국어/표시값)
 *     - 언어별 시트    : (영어) (베트남어) … 상세
 */

import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { test } from '../lib/fixtures';
import {
  getResults, resetResults, resetNoTC, resetDiff, resetReview,
  writeReport,
} from '../lib/reporter';
import { runLangCheckModal, TARGET_LANGS, type Lang } from '../lib/langCheck';

// ── 모달 결함 행 타입 ─────────────────────────────────────────
type ModalFail = {
  lang: string;
  screen: string;
  triggerType: string;   // 팝업 종류: 등록·수정·상세·알람 등(path 끝 조각에서 추출)
  phenomenon: string;
  koText: string;
  fgText: string;
  screenshot: string;
};

// ── 팝업 종류 추출 헬퍼 ──────────────────────────────────────
function extractTriggerType(p: string): string {
  // path 형태: "라운드관리 > 내장 현황 > 팝업검증 > 팝업_영어 > 등록"
  const parts = p.split('>').map(s => s.trim());
  // 뒤에서 두 번째가 트리거 컨텍스트인 경우가 많음
  const last = parts[parts.length - 1] || '';
  if (/등록/.test(last)) return '등록';
  if (/수정/.test(last)) return '수정';
  if (/상세/.test(last)) return '상세';
  if (/삭제/.test(last)) return '삭제';
  if (/알람|알림/.test(last)) return '알람';
  if (/확인/.test(last)) return '확인';
  return last || '팝업';
}

// ── 모달 결함 목록 시트 ──────────────────────────────────────
async function writeModalDefectSheet(wb: ExcelJS.Workbook, fails: ModalFail[]): Promise<void> {
  const ws = wb.addWorksheet('모달 결함 목록');
  ws.columns = [
    { header: 'No.',       key: 'no',        width: 6  },
    { header: '언어',       key: 'lang',      width: 14 },
    { header: '화면',       key: 'screen',    width: 44 },
    { header: '팝업 종류',  key: 'trigger',   width: 12 },
    { header: '결함 유형',  key: 'phenomenon',width: 18 },
    { header: '한국어 원문', key: 'koText',   width: 40 },
    { header: '표시값',     key: 'fgText',    width: 40 },
    { header: '스크린샷',   key: 'screenshot',width: 46 },
  ];

  const C_TITLE = 'FF7030A0', C_BORDER = 'FFBFBFBF';
  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TITLE } };
  hdr.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const LANG_COLORS: Record<string, string> = {
    '영어': 'FF1F497D', '베트남어': 'FF375623', '태국어': 'FF7030A0',
    '번체중문': 'FFC55A11', '간체중문': 'FF843C0C', '일본어': 'FF833C04',
    '인도네시아어': 'FF984807',
  };

  for (let i = 0; i < fails.length; i++) {
    const f = fails[i];
    const row = ws.addRow({
      no: i + 1, lang: f.lang, screen: f.screen, trigger: f.triggerType,
      phenomenon: f.phenomenon, koText: f.koText, fgText: f.fgText,
      screenshot: f.screenshot ? path.basename(f.screenshot) : '',
    });
    row.alignment = { vertical: 'top', wrapText: true };
    const langCell = row.getCell('lang');
    langCell.font = { bold: true, color: { argb: LANG_COLORS[f.lang] || 'FF000000' } };
    const phenCell = row.getCell('phenomenon');
    if (f.phenomenon.includes('한글')) phenCell.font = { color: { argb: 'FFCC0000' } };
    else if (f.phenomenon.includes('미노출')) phenCell.font = { color: { argb: 'FFCC6600' } };
    for (let c = 1; c <= 8; c++) {
      row.getCell(c).border = {
        top: { style: 'thin', color: { argb: C_BORDER } },
        left: { style: 'thin', color: { argb: C_BORDER } },
        bottom: { style: 'thin', color: { argb: C_BORDER } },
        right: { style: 'thin', color: { argb: C_BORDER } },
      };
    }
  }
  ws.autoFilter = { from: 'A1', to: 'H1' };
}

// ── 통합 요약 시트 ───────────────────────────────────────────
async function writeSummarySheet(
  wb: ExcelJS.Workbook,
  langResults: Map<string, { pass: number; fail: number; skip: number }>,
): Promise<void> {
  // 첫 호출이라 addWorksheet가 곧 첫 시트(insertWorksheet는 exceljs에 없음)
  const ws = wb.addWorksheet('통합 요약');
  ws.columns = [
    { header: '언어',   key: 'lang',  width: 16 },
    { header: 'FAIL',  key: 'fail',  width: 9  },
    { header: 'PASS',  key: 'pass',  width: 9  },
    { header: 'SKIP',  key: 'skip',  width: 9  },
    { header: '전체',  key: 'total', width: 9  },
    { header: 'PASS율', key: 'rate', width: 10 },
  ];

  const C_TITLE = 'FF7030A0', C_HEAD = 'FFE2D0F0', C_TOTAL = 'FFE2EFDA', C_BORDER = 'FFBFBFBF';
  const fill = (cell: ExcelJS.Cell, argb: string) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  };
  const border = (row: ExcelJS.Row) =>
    row.eachCell(c => {
      c.border = {
        top: { style: 'thin', color: { argb: C_BORDER } },
        left: { style: 'thin', color: { argb: C_BORDER } },
        bottom: { style: 'thin', color: { argb: C_BORDER } },
        right: { style: 'thin', color: { argb: C_BORDER } },
      };
    });

  ws.mergeCells('A1:F1');
  const title = ws.getCell('A1');
  title.value = '팝업/모달 다국어 결함 통합 현황 (P2-B)';
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  fill(title, C_TITLE);
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;

  const hdr = ws.getRow(2);
  hdr.values = ['언어', 'FAIL', 'PASS', 'SKIP', '전체', 'PASS율'];
  hdr.font = { bold: true, color: { argb: 'FF3F1060' } };
  hdr.eachCell(c => { fill(c, C_HEAD); c.alignment = { horizontal: 'center' }; });
  border(hdr);

  let totFail = 0, totPass = 0, totSkip = 0;
  for (const lang of TARGET_LANGS) {
    const r = langResults.get(lang.ko) ?? { fail: 0, pass: 0, skip: 0 };
    totFail += r.fail; totPass += r.pass; totSkip += r.skip;
    const total = r.fail + r.pass + r.skip;
    const rate = (r.pass + r.fail) ? `${Math.round(r.pass / (r.pass + r.fail) * 100)}%` : '-';
    const row = ws.addRow([lang.ko, r.fail, r.pass, r.skip, total, rate]);
    row.alignment = { horizontal: 'center' };
    border(row);
    if (r.fail > 0) row.getCell(2).font = { bold: true, color: { argb: 'FFCC0000' } };
  }

  const grandTotal = totFail + totPass + totSkip;
  const grandRate = (totPass + totFail) ? `${Math.round(totPass / (totPass + totFail) * 100)}%` : '-';
  const tot = ws.addRow(['전체 합계', totFail, totPass, totSkip, grandTotal, grandRate]);
  tot.font = { bold: true };
  tot.alignment = { horizontal: 'center' };
  tot.eachCell(c => fill(c, C_TOTAL));
  border(tot);
  if (totFail > 0) tot.getCell(2).font = { bold: true, color: { argb: 'FFCC0000' } };

  ws.addRow([]);
  ws.addRow(['생성 일시', new Date().toLocaleString('ko-KR')]);
  ws.addRow(['스캔 범위', process.env.LANGMODAL_MENUS || '전체 메뉴']);
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ── 메인 스펙 ─────────────────────────────────────────────────
test('팝업/모달 다국어 결함 통합 리포트 (P2-B) — 7개 언어', async ({ admin }) => {
  test.setTimeout(TARGET_LANGS.length * 600_000);   // 언어당 최대 10분

  const allFails: ModalFail[] = [];
  const langResults = new Map<string, { pass: number; fail: number; skip: number }>();

  for (const lang of TARGET_LANGS) {
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`[lang-modal] ${lang.ko}(${lang.label}) 팝업 i18n 검증 시작`);
    console.log(`${'═'.repeat(55)}`);

    resetResults(); resetNoTC(); resetDiff(); resetReview();
    await runLangCheckModal(admin, lang);

    const results = getResults();
    const fail = results.filter(r => r.status === 'FAIL').length;
    const pass = results.filter(r => r.status === 'PASS').length;
    const skip = results.filter(r => r.status === 'SKIP').length;
    langResults.set(lang.ko, { fail, pass, skip });
    console.log(`[lang-modal] ${lang.ko} 완료 — FAIL: ${fail}, PASS: ${pass}, SKIP: ${skip}`);

    for (const r of results.filter(r => r.status === 'FAIL')) {
      const parts = (r.path || '').split('>').map(s => s.trim());
      const screen = parts.slice(0, 2).join(' > ') || r.path;
      const koText = (r.expected || '').slice(0, 80);
      const fgText = (r.actual || '').slice(0, 80);
      allFails.push({
        lang: lang.ko,
        screen,
        triggerType: extractTriggerType(r.path || ''),
        phenomenon: r.error || '결함',
        koText,
        fgText,
        screenshot: r.screenshot || '',
      });
    }

    await writeReport(`lang-modal-${lang.ko}`);
  }

  // ── 통합 Excel 생성 ────────────────────────────────────────
  const REPORT_DIR = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(REPORT_DIR, `lang-modal-결함_report_${ts}.xlsx`);

  const wb = new ExcelJS.Workbook();

  await writeSummarySheet(wb, langResults);
  await writeModalDefectSheet(wb, allFails);

  console.log('\n' + '═'.repeat(55));
  console.log(`[lang-modal] 팝업/모달 결함 현황 (총 ${allFails.length}건)`);
  for (const lang of TARGET_LANGS) {
    const r = langResults.get(lang.ko)!;
    console.log(`  ${lang.ko.padEnd(8)}: FAIL ${r.fail}건`);
  }
  console.log('═'.repeat(55));

  await wb.xlsx.writeFile(outPath);
  console.log(`\n[lang-modal] 통합 리포트 저장 → ${outPath}\n`);
});

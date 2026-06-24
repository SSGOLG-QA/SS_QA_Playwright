/**
 * 다국어 결함 통합 리포트 (P1-C)
 *
 * 목적: 7개 언어(영어/베트남어/태국어/번체중문/간체중문/일본어/인도네시아어)의
 *       번역 결함을 단일 Excel 파일에 통합 보고
 *
 * 기존 lang-check-all.spec.ts: 언어별 7개 파일 생성
 * 이 스펙:                      언어별 시트 + 통합 결함 목록을 1개 파일로 생성
 *
 * 실행:
 *   npx playwright test --project=admin-chromium Admin/lang-defect-report.spec.ts --no-deps --headed
 *
 * 산출물:
 *   reports/lang-결함-통합_report_<timestamp>.xlsx
 *   시트 구성:
 *     - 통합 요약      : 언어별 FAIL/PASS/SKIP 집계
 *     - 결함 전체 목록 : 모든 언어 FAIL 항목 (언어 컬럼 포함)
 *     - 확인 필요      : 말줄임/시각 레이어 항목
 *     - 언어별 시트    : (영어), (베트남어), … 각 언어 상세
 */

import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { test } from '../lib/fixtures';
import {
  getResults, resetResults, resetNoTC, resetDiff, resetReview,
  writeReport,
} from '../lib/reporter';
import { runLangCheckAll, TARGET_LANGS, type Lang } from '../lib/langCheck';

// ── 언어별 FAIL 항목 스냅샷 저장용 ────────────────────────────
type LangFail = {
  lang: string;
  path: string;
  zone: string;
  phenomenon: string;
  koText: string;
  fgText: string;
  screenshot: string;
};

// ── 통합 결함 목록 시트 생성 ──────────────────────────────────
async function writeUnifiedDefectSheet(
  wb: ExcelJS.Workbook,
  fails: LangFail[],
): Promise<void> {
  const ws = wb.addWorksheet('결함 전체 목록');
  ws.columns = [
    { header: 'No.',       key: 'no',        width: 6  },
    { header: '언어',       key: 'lang',      width: 14 },
    { header: '화면/영역',  key: 'path',      width: 44 },
    { header: '영역 유형',  key: 'zone',      width: 14 },
    { header: '결함 유형',  key: 'phenomenon',width: 18 },
    { header: '한국어 원문', key: 'koText',   width: 40 },
    { header: '표시값',     key: 'fgText',    width: 40 },
    { header: '스크린샷',   key: 'screenshot',width: 46 },
  ];

  const C_TITLE = 'FF4472C4', C_BORDER = 'FFBFBFBF';
  const hdrRow = ws.getRow(1);
  hdrRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdrRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TITLE } };
  hdrRow.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const LANG_COLORS: Record<string, string> = {
    '영어': 'FF1F497D', '베트남어': 'FF375623', '태국어': 'FF7030A0',
    '번체중문': 'FFC55A11', '간체중문': 'FF843C0C', '일본어': 'FF833C04',
    '인도네시아어': 'FF984807',
  };

  for (let i = 0; i < fails.length; i++) {
    const f = fails[i];
    const row = ws.addRow({
      no: i + 1,
      lang: f.lang,
      path: f.path,
      zone: f.zone,
      phenomenon: f.phenomenon,
      koText: f.koText,
      fgText: f.fgText,
      screenshot: f.screenshot ? path.basename(f.screenshot) : '',
    });
    row.alignment = { vertical: 'top', wrapText: true };
    const langCell = row.getCell('lang');
    langCell.font = { bold: true, color: { argb: LANG_COLORS[f.lang] || 'FF000000' } };
    const phenCell = row.getCell('phenomenon');
    if (f.phenomenon.includes('한글')) phenCell.font = { color: { argb: 'FFCC0000' } };
    else if (f.phenomenon.includes('미노출')) phenCell.font = { color: { argb: 'FFCC6600' } };
    else if (f.phenomenon.includes('인코딩')) phenCell.font = { color: { argb: 'FF7030A0' } };

    // 행 테두리
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

// ── 통합 요약 시트 생성 ───────────────────────────────────────
async function writeSummaryByLang(
  wb: ExcelJS.Workbook,
  langResults: Map<string, { pass: number; fail: number; skip: number }>,
): Promise<void> {
  // "통합 요약"을 첫 번째 시트로 삽입
  const ws = wb.insertWorksheet(0, '통합 요약');
  ws.columns = [
    { header: '언어',    key: 'lang',  width: 16 },
    { header: 'FAIL',   key: 'fail',  width: 9  },
    { header: 'PASS',   key: 'pass',  width: 9  },
    { header: 'SKIP',   key: 'skip',  width: 9  },
    { header: '전체',   key: 'total', width: 9  },
    { header: 'PASS율', key: 'rate',  width: 10 },
  ];

  const C_TITLE = 'FF4472C4', C_HEAD = 'FFD9E1F2', C_TOTAL = 'FFE2EFDA', C_BORDER = 'FFBFBFBF';
  const fill = (cell: ExcelJS.Cell, argb: string) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  };
  const border = (row: ExcelJS.Row) => {
    row.eachCell(c => {
      c.border = {
        top: { style: 'thin', color: { argb: C_BORDER } },
        left: { style: 'thin', color: { argb: C_BORDER } },
        bottom: { style: 'thin', color: { argb: C_BORDER } },
        right: { style: 'thin', color: { argb: C_BORDER } },
      };
    });
  };

  // 제목 행
  ws.mergeCells('A1:F1');
  const title = ws.getCell('A1');
  title.value = '다국어 결함 통합 현황';
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  fill(title, C_TITLE);
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;

  // 헤더 행
  const hdr = ws.getRow(2);
  hdr.values = ['언어', 'FAIL', 'PASS', 'SKIP', '전체', 'PASS율'];
  hdr.font = { bold: true, color: { argb: 'FF1F3864' } };
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

  // 합계 행
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
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ── 메인 스펙 ─────────────────────────────────────────────────
test('다국어 결함 통합 리포트 — 7개 언어', async ({ admin }) => {
  test.setTimeout(TARGET_LANGS.length * 900_000);  // 언어당 최대 15분

  const allFails: LangFail[] = [];
  const langResults = new Map<string, { pass: number; fail: number; skip: number }>();

  for (const lang of TARGET_LANGS) {
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`[lang-defect] ${lang.ko}(${lang.label}) 검증 시작`);
    console.log(`${'═'.repeat(55)}`);

    resetResults(); resetNoTC(); resetDiff(); resetReview();
    await runLangCheckAll(admin, lang);

    // 이 언어 결과 집계
    const results = getResults();
    const fail = results.filter(r => r.status === 'FAIL').length;
    const pass = results.filter(r => r.status === 'PASS').length;
    const skip = results.filter(r => r.status === 'SKIP').length;
    langResults.set(lang.ko, { fail, pass, skip });
    console.log(`\n[lang-defect] ${lang.ko} 완료 — FAIL: ${fail}, PASS: ${pass}, SKIP: ${skip}`);

    // FAIL 항목을 통합 목록에 추가
    for (const r of results.filter(r => r.status === 'FAIL')) {
      // path: "라운드관리 > 내장 현황 > 언어검증 > 버튼" → zone 추출
      const parts = (r.path || '').split('>').map(s => s.trim());
      const zone = parts[parts.length - 1] || '';
      // desc에서 현상/원문/표시값 추출 (applySlotComparison 포맷 활용)
      const koText = (r.expected || '').replace(/^한국어 원문:\s*"?/, '').replace(/"$/, '').trim().slice(0, 80);
      const fgText = (r.actual || '').replace(new RegExp(`^${lang.label}:\\s*"?`), '').replace(/"$/, '').trim().slice(0, 80);
      allFails.push({
        lang: lang.ko,
        path: parts.slice(0, -2).join(' > ') || r.path,
        zone,
        phenomenon: r.error || '결함',
        koText,
        fgText,
        screenshot: r.screenshot || '',
      });
    }

    // 언어별 개별 리포트도 생성 (기존 방식 유지)
    await writeReport(`lang-check-${lang.ko}`);
  }

  // ── 통합 Excel 생성 ────────────────────────────────────────
  const REPORT_DIR = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(REPORT_DIR, `lang-결함-통합_report_${ts}.xlsx`);

  const wb = new ExcelJS.Workbook();

  // 1) 통합 요약 시트
  await writeSummaryByLang(wb, langResults);

  // 2) 결함 전체 목록 시트
  const totalFail = allFails.length;
  await writeUnifiedDefectSheet(wb, allFails);

  // 언어별 집계 로그
  console.log('\n' + '═'.repeat(55));
  console.log(`[lang-defect] 통합 결함 현황 (총 ${totalFail}건)`);
  for (const lang of TARGET_LANGS) {
    const r = langResults.get(lang.ko)!;
    console.log(`  ${lang.ko.padEnd(8)}: FAIL ${r.fail}건`);
  }
  console.log('═'.repeat(55));

  await wb.xlsx.writeFile(outPath);
  console.log(`\n[lang-defect] 통합 리포트 저장 → ${outPath}\n`);
});

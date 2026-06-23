import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export default async function globalTeardown() {
  const jsonPath = path.join(__dirname, 'test-results', 'results.json');
  if (!fs.existsSync(jsonPath)) {
    console.log('\n[E2E report] results.json 미발견 — 엑셀 생성 건너뜀');
    return;
  }
  try {
    const script = path.join(__dirname, 'e2e-report.js');
    execSync(`node "${script}" "${jsonPath}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error('\n[E2E report] 엑셀 생성 실패:', (e as Error).message);
  }
}

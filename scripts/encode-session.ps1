# encode-session.ps1
# 로컬 auth/.auth/admin.json을 base64로 인코딩하여 GitHub Secret에 등록합니다.
#
# 사용법:
#   1. 로컬에서 npm run auth 실행 (세션 생성)
#   2. 이 스크립트 실행: .\scripts\encode-session.ps1
#   3. 출력된 base64 문자열을 복사
#   4. GitHub > 저장소 > Settings > Secrets and variables > Actions
#      > New repository secret > Name: PLAYWRIGHT_SESSION > 붙여넣기

$sessionFile = "auth/.auth/admin.json"

if (-not (Test-Path $sessionFile)) {
    Write-Error "세션 파일이 없습니다: $sessionFile"
    Write-Host "먼저 'npm run auth'를 실행하여 세션을 생성하세요." -ForegroundColor Yellow
    exit 1
}

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $sessionFile))
$base64 = [System.Convert]::ToBase64String($bytes)
$size = $bytes.Length

Write-Host ""
Write-Host "=== GitHub Secret 등록 방법 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 아래 base64 문자열을 복사하세요 ($size bytes)" -ForegroundColor Green
Write-Host ""
Write-Host "─── PLAYWRIGHT_SESSION 값 (복사 시작) ───" -ForegroundColor Yellow
Write-Host $base64
Write-Host "─── 복사 끝 ───" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. GitHub 저장소 > Settings > Secrets and variables > Actions" -ForegroundColor Green
Write-Host "   > New repository secret 클릭" -ForegroundColor Green
Write-Host "   > Name: PLAYWRIGHT_SESSION" -ForegroundColor Green
Write-Host "   > Secret: (위 base64 값 붙여넣기)" -ForegroundColor Green
Write-Host ""
Write-Host "3. SS_USERNAME / SS_PASSWORD Secret도 등록하세요:" -ForegroundColor Green
Write-Host "   Name: SS_USERNAME  Value: (계정 아이디)" -ForegroundColor Green
Write-Host "   Name: SS_PASSWORD  Value: (계정 비밀번호)" -ForegroundColor Green
Write-Host ""
Write-Host "세션 만료 주기: 수일~1주일 내 → 만료 시 1번부터 재실행" -ForegroundColor Magenta

# 클립보드에 자동 복사 (Windows)
try {
    $base64 | Set-Clipboard
    Write-Host "클립보드에 자동 복사되었습니다." -ForegroundColor Cyan
} catch {
    Write-Host "(클립보드 자동 복사 실패 — 위 값을 수동 복사하세요)" -ForegroundColor Gray
}

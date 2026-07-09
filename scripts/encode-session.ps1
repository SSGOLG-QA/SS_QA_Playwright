$sessionFile = "auth/.auth/admin.json"

if (-not (Test-Path $sessionFile)) {
    Write-Error "Session file not found: $sessionFile"
    Write-Host "Run 'npm run auth' first." -ForegroundColor Yellow
    exit 1
}

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $sessionFile))
$base64 = [System.Convert]::ToBase64String($bytes)
$size = $bytes.Length

Write-Host ""
Write-Host "=== GitHub Secret Registration ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Session file size: $size bytes" -ForegroundColor Green
Write-Host ""
Write-Host "--- PLAYWRIGHT_SESSION value (copy below) ---" -ForegroundColor Yellow
Write-Host $base64
Write-Host "--- end ---" -ForegroundColor Yellow
Write-Host ""
Write-Host "Steps:" -ForegroundColor Green
Write-Host "  1. Copy the base64 string above" -ForegroundColor Green
Write-Host "  2. GitHub repo > Settings > Secrets and variables > Actions" -ForegroundColor Green
Write-Host "  3. New repository secret > Name: PLAYWRIGHT_SESSION > Paste" -ForegroundColor Green
Write-Host ""

try {
    $base64 | Set-Clipboard
    Write-Host "Copied to clipboard automatically." -ForegroundColor Cyan
} catch {
    Write-Host "(Clipboard copy failed - please copy manually)" -ForegroundColor Gray
}
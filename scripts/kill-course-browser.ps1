# ──────────────────────────────────────────────────────────────
#  Kill ONLY Playwright's bundled Chromium (ms-playwright cache).
#  User's regular Chrome (C:\Program Files\Google\Chrome) is never touched.
#  Purpose: a course:auth headed browser orphaned by an abnormal exit (255)
#           can hold the shared QA account session and evict later test runs.
#  Run: npm run course:kill  (or powershell -NoProfile -File scripts/kill-course-browser.ps1)
#  Safety: only processes whose CommandLine contains 'ms-playwright' are targeted.
#          User Chrome path is 'Program Files\Google\Chrome' -> never matches.
#  (ASCII-only output to stay readable under any console codepage, e.g. CP949.)
# ──────────────────────────────────────────────────────────────

$targets = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='headless_shell.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'ms-playwright' }

if (-not $targets) {
  Write-Output "[course:kill] No Playwright browser process to kill (0 orphans)."
  exit 0
}

# Double safety: abort if any user-Chrome path slips into the target set.
$unsafe = $targets | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*Program Files*Google*Chrome*' }
if ($unsafe) {
  Write-Output "[course:kill] ABORTED - a user Chrome path was matched (unexpected). Check manually:"
  $unsafe | Select-Object ProcessId, ExecutablePath | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
  exit 1
}

$ids = $targets | Select-Object -ExpandProperty ProcessId -Unique
Write-Output "[course:kill] Killing $($ids.Count) Playwright browser process(es): $($ids -join ', ')"
foreach ($procId in $ids) {
  try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Output "  [ok] PID $procId killed" }
  catch { Write-Output "  [--] PID $procId already gone / inaccessible" }
}
Write-Output "[course:kill] Done. (user Chrome untouched)"

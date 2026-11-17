@echo off
rem ---------------------------------------------------------------
rem PMX Flight Parser - daily check wrapper
rem
rem Called by Windows Task Scheduler at 06:00 every day.
rem - Ensures the flight-parser server is running (starts it if not).
rem - POSTs /api/daily-check to scan the last 7 days of IMAP mailbox
rem   + local .msg folder for new flight emails, filter expired,
rem   append cumulative CSV, and upload to Supabase flights_to_track.
rem
rem Logs: %ROOT%log\flight_parser_daily_<YYYYMMDD>.log
rem Exit: 0 success, non-zero failure (Task Scheduler records).
rem ---------------------------------------------------------------

setlocal
set "ROOT=%~dp0..\.."
pushd "%ROOT%"

set "URL=http://127.0.0.1:8765/api/daily-check"
set "HEALTH=http://127.0.0.1:8765/healthz"
set "BODY={\"days\":7,\"filter_expired\":true,\"upload\":true,\"append_cumulative\":true}"
set "LOGDIR=%ROOT%log"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

set "TS=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "LOG=%LOGDIR%\flight_parser_daily_%TS%.log"

echo [%date% %time%] starting daily flight parser scan >> "%LOG%"

rem --- Step 1: ensure server is running ---
powershell -NoProfile -Command ^
  "$h = $null;" ^
  "try { $h = Invoke-RestMethod -Uri '%HEALTH%' -Method GET -TimeoutSec 5 -ErrorAction Stop } catch {};" ^
  "if (-not $h) {" ^
  "  Write-Host 'server down, starting...';" ^
  "  Start-Process -FilePath '%ROOT%app\flight_parser\run_server.bat' -WindowStyle Hidden;" ^
  "  for ($i=0; $i -lt 30; $i++) { Start-Sleep -Seconds 2; try { $h = Invoke-RestMethod -Uri '%HEALTH%' -Method GET -TimeoutSec 3 -ErrorAction Stop; break } catch {} }" ^
  "};" ^
  "if (-not $h) { Write-Host 'server failed to start'; exit 2 } else { Write-Host ('server OK: ' + $h.time) }" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] server failed to start, aborting >> "%LOG%"
  popd
  endlocal
  exit /b 2
)

rem --- Step 2: POST scan-outlook (signed-in Outlook inbox, COM-based) ---
set "OUTLOOK_BODY={\"limit\":300,\"lookback_days\":7,\"filter_expired\":true,\"upload\":true,\"append_cumulative\":true}"
powershell -NoProfile -Command ^
  "try {" ^
  "  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/scan-outlook' -Method POST -ContentType 'application/json' -Body '%OUTLOOK_BODY%' -TimeoutSec 180 -ErrorAction Stop;" ^
  "  $r | ConvertTo-Json -Depth 5" ^
  "} catch {" ^
  "  Write-Host ('scan-outlook FAILED: ' + $_.Exception.Message);" ^
  "  exit 3" ^
  "}" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] scan-outlook call failed >> "%LOG%"
  popd
  endlocal
  exit /b 3
)

rem --- Step 3: archive expired flights (PMX policy: move to history, not delete) ---
powershell -NoProfile -Command ^
  "try {" ^
  "  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/remove-expired' -Method POST -ContentType 'application/json' -Body '{\"dry_run\":false,\"hard_delete\":false}' -TimeoutSec 60 -ErrorAction Stop;" ^
  "  Write-Host ('archived ' + $r.processed + ' expired flight(s) to history');" ^
  "} catch {" ^
  "  Write-Host ('archive-expired FAILED: ' + $_.Exception.Message);" ^
  "  exit 4" ^
  "}" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] archive-expired failed >> "%LOG%"
  popd
  endlocal
  exit /b 4
)

echo [%date% %time%] daily scan complete >> "%LOG%"
popd
endlocal
exit /b 0

@echo off
rem ---------------------------------------------------------------
rem PMX Flight Parser - daily check wrapper
rem
rem Called by Windows Task Scheduler at 06:00 every day.
rem Hits the local flight-parser server (must be running) and asks
rem it to scan the last 7 days of IMAP mailbox + local .msg folder
rem for new flight emails, filter expired, append cumulative CSV,
rem and upload to the Supabase flight tracker.
rem
rem Logs are written under %ROOT%log\flight_parser_daily_<date>.log
rem Exit codes: 0 success, non-zero failure (Task Scheduler records).
rem ---------------------------------------------------------------

setlocal
set "ROOT=%~dp0..\.."
pushd "%ROOT%"

set "URL=http://127.0.0.1:8765/api/daily-check"
set "BODY={\"days\":7,\"filter_expired\":true,\"upload\":true,\"append_cumulative\":true}"
set "LOGDIR=%ROOT%log"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

set "TS=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
set "LOG=%LOGDIR%\flight_parser_daily_%TS%.log"

echo [%date% %time%] starting daily flight parser scan >> "%LOG%"
echo     URL: %URL% >> "%LOG%"
echo     BODY: %BODY% >> "%LOG%"

rem Step 1: ping healthz so we fail early if server is down
powershell -NoProfile -Command ^
  "try {" ^
  "  $h = Invoke-RestMethod -Uri '%URL%/../healthz' -Method GET -TimeoutSec 10 -ErrorAction Stop;" ^
  "  Write-Host ('healthz OK at {0}' -f $h.time)" ^
  "} catch {" ^
  "  Write-Host ('healthz FAILED: ' + $_.Exception.Message);" ^
  "  exit 2" ^
  "}" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] server not reachable, aborting >> "%LOG%"
  popd
  endlocal
  exit /b 2
)

rem Step 2: POST daily-check
powershell -NoProfile -Command ^
  "try {" ^
  "  $r = Invoke-RestMethod -Uri '%URL%' -Method POST -ContentType 'application/json' -Body '%BODY%' -TimeoutSec 120 -ErrorAction Stop;" ^
  "  $r | ConvertTo-Json -Depth 5" ^
  "} catch {" ^
  "  Write-Host ('daily-check FAILED: ' + $_.Exception.Message);" ^
  "  exit 3" ^
  "}" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] daily-check call failed >> "%LOG%"
  popd
  endlocal
  exit /b 3
)

echo [%date% %time%] daily scan complete >> "%LOG%"
popd
endlocal
exit /b 0

@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
set "NODE_BIN=C:\Users\Jacky2_Wang\.config\opencode\skills\portable-nodejs\bin\node-v24.14.1-win-x64"
set "NPM=%NODE_BIN%\npm.cmd"
set "PY=python"

:MENU
cls
echo ================================================================
echo   Border ^& Flight News Hub - Local Launcher
echo ================================================================
echo   1) Run crawler once          (fetch -^> DeepL translate -^> Supabase)
echo   2) Crawler dry-run           (no DB / DeepL writes, prints plan)
echo   3) Start webui dev           (http://localhost:3000)
echo   4) Build webui               (production build test)
echo   5) Flight parser: parse + upload .msg folder
echo   6) Flight parser: server     (http://127.0.0.1:8765)
echo   7) Flight parser: EMAIL search - backfill 180 days via IMAP
echo   8) Flight parser: EMAIL search - last 7 days via IMAP
echo   9) Open app / log folders
echo  10) Exit
echo ================================================================
set /p "c=Choose [1-10]: "

if "%c%"=="1" goto CRAWL
if "%c%"=="2" goto DRYRUN
if "%c%"=="3" goto DEV
if "%c%"=="4" goto BUILD
if "%c%"=="5" goto FPARSE
if "%c%"=="6" goto FSERVER
if "%c%"=="7" goto FBACKFILL
if "%c%"=="8" goto FSEARCH7D
if "%c%"=="9" goto OPEN
if "%c%"=="10" goto END
goto MENU

:CRAWL
if not exist "%ROOT%app\crawler\.env" (
  echo [!] app\crawler\.env not found.
  echo     Copy app\crawler\.env.example to .env and fill in
  echo     SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DEEPL_API_KEY.
  echo.
  pause
  goto MENU
)
%PY% -c "import feedparser, requests, supabase, dotenv" 2>nul
if errorlevel 1 (
  echo [*] Installing Python dependencies from requirements.txt...
  %PY% -m pip install -r "%ROOT%app\crawler\requirements.txt"
  echo.
)
echo [*] Running crawler...
%PY% "%ROOT%app\crawler\main.py"
echo.
echo [*] Done. Log file saved under %ROOT%log
echo.
pause
goto MENU

:DRYRUN
%PY% -c "import feedparser, requests, supabase, dotenv" 2>nul
if errorlevel 1 (
  echo [*] Installing Python dependencies from requirements.txt...
  %PY% -m pip install -r "%ROOT%app\crawler\requirements.txt"
  echo.
)
echo [*] Running crawler in DRY-RUN mode (no Supabase / DeepL side effects)...
%PY% "%ROOT%app\crawler\main.py" --dry-run
echo.
pause
goto MENU

:DEV
if not exist "%ROOT%app\webui\node_modules" (
  echo [*] Installing webui dependencies (first run, may take a few minutes)...
  pushd "%ROOT%app\webui"
  call "%NPM%" install
  popd
)
if not exist "%ROOT%app\webui\.env.local" (
  echo [!] app\webui\.env.local not found.
  echo     Copy app\webui\.env.example to .env.local and fill in
  echo     NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
  echo.
  pause
  goto MENU
)
echo [*] Starting webui dev server at http://localhost:3000   (Ctrl+C to stop)
pushd "%ROOT%app\webui"
call "%NPM%" run dev
popd
echo.
pause
goto MENU

:BUILD
if not exist "%ROOT%app\webui\node_modules" (
  echo [*] Installing webui dependencies...
  pushd "%ROOT%app\webui"
  call "%NPM%" install
  popd
)
echo [*] Building webui (production)...
pushd "%ROOT%app\webui"
call "%NPM%" run build
popd
echo.
pause
goto MENU

:OPEN
start "" "%ROOT%app"
start "" "%ROOT%log"
goto MENU

:FPARSE
echo [*] Flight parser: parse default .msg folder, append cumulative CSV, upload Supabase
%PY% "%ROOT%app\flight_parser\parse_and_upload.py" --skip-legacy
echo.
pause
goto MENU

:FSERVER
echo [*] Starting flight parser server at http://127.0.0.1:8765  (Ctrl+C to stop)
pushd "%ROOT%"
%PY% -m uvicorn app.flight_parser.server:app --host 127.0.0.1 --port 8765
popd
echo.
pause
goto MENU

:FBACKFILL
echo ================================================================
echo   Email search: one-time backfill via signed-in Outlook inbox
echo ================================================================
echo   Uses Windows COM automation to read your signed-in Outlook
echo   mailbox directly. NO IMAP credentials required.
echo.
echo   The server fetches inbox messages, parses flight segments,
echo   filters expired, appends cumulative CSV, uploads non-expired
echo   flights to Supabase, and archives already-arrived flights.
echo ================================================================
echo.
start "PMX Flight Parser Server" cmd /k "%PY% -m uvicorn app.flight_parser.server:app --host 127.0.0.1 --port 8765"
echo [*] Waiting for server to start...
ping 127.0.0.1 -n 5 >nul
echo.
echo [*] Calling POST /api/scan-outlook (full inbox, default 200 msgs)...
curl -s -X POST -H "Content-Type: application/json" -d "{\"limit\":300,\"filter_expired\":true,\"upload\":true,\"append_cumulative\":true}" http://127.0.0.1:8765/api/scan-outlook
echo.
echo.
pause
goto MENU

:FSEARCH7D
echo ================================================================
echo   Email search: scan Outlook inbox (last 7 days, on demand)
echo ================================================================
echo   Same prerequisites as the backfill option above. Scans only
echo   the last 7 days of emails for fresh flights.
echo ================================================================
echo.
start "PMX Flight Parser Server" cmd /k "%PY% -m uvicorn app.flight_parser.server:app --host 127.0.0.1 --port 8765"
ping 127.0.0.1 -n 5 >nul
echo.
echo [*] Calling POST /api/scan-outlook (last 7 days)...
curl -s -X POST -H "Content-Type: application/json" -d "{\"limit\":300,\"lookback_days\":7,\"filter_expired\":true,\"upload\":true,\"append_cumulative\":true}" http://127.0.0.1:8765/api/scan-outlook
echo.
echo.
pause
goto MENU

:END
endlocal

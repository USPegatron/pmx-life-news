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
echo   7) Flight parser: daily backfill (180d via mailbox)
echo   8) Open app / log folders
echo   9) Exit
echo ================================================================
set /p "c=Choose [1-9]: "

if "%c%"=="1" goto CRAWL
if "%c%"=="2" goto DRYRUN
if "%c%"=="3" goto DEV
if "%c%"=="4" goto BUILD
if "%c%"=="5" goto FPARSE
if "%c%"=="6" goto FSERVER
if "%c%"=="7" goto FBACKFILL
if "%c%"=="8" goto OPEN
if "%c%"=="9" goto END
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
echo [*] Flight parser: one-time backfill via mailbox (180 days)
echo     Requires the server running and MAILBOX_* configured in app\crawler\.env
echo.
set /p "skip=Start server if not running? (y/N) "
if /I "%skip%"=="Y" goto FBACKFILL_SRV
curl -s -X POST -H "Content-Type: application/json" -d "{\"days\":180}" http://127.0.0.1:8765/api/backfill
echo.
pause
goto MENU
:FBACKFILL_SRV
start "PMX Flight Parser Server" cmd /k "%PY% -m uvicorn app.flight_parser.server:app --host 127.0.0.1 --port 8765"
ping 127.0.0.1 -n 4 >nul
curl -s -X POST -H "Content-Type: application/json" -d "{\"days\":180}" http://127.0.0.1:8765/api/backfill
echo.
pause
goto MENU

:END
endlocal

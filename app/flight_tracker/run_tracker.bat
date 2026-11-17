@echo off
setlocal
cd /d "%~dp0\..\.."
echo ================================================================
echo   PMX Flight Tracker (Gemini + Google Search grounding)
echo ================================================================
echo   1) Run forever (check every 15 minutes)
echo   2) Smoke test -- check once and exit
echo   3) Check every N minutes (you'll be prompted)
echo   4) Exit
echo ================================================================
set /p "c=Choose [1-4]: "
if "%c%"=="1" goto LOOP
if "%c%"=="2" goto ONCE
if "%c%"=="3" goto CUSTOM
if "%c%"=="4" goto END
goto MENU

:LOOP
echo.
echo [*] Running flight tracker (Ctrl+C to stop)
python "app\flight_tracker\flight_tracker.py"
echo.
pause
goto END

:ONCE
echo.
echo [*] Smoke test -- one cycle and exit
python "app\flight_tracker\flight_tracker.py" --once
echo.
pause
goto END

:CUSTOM
set /p "mins=Interval in minutes (e.g. 5): "
echo.
python "app\flight_tracker\flight_tracker.py" --interval %mins%
echo.
pause
goto END

:END
endlocal

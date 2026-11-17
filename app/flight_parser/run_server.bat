@echo off
rem ---------------------------------------------------------------
rem PMX Flight Parser - server wrapper
rem
rem Started by Windows Task Scheduler "At startup" trigger so the
rem flight-parser server is always running on this 24x7 box.
rem ---------------------------------------------------------------

setlocal
set "ROOT=%~dp0..\.."
pushd "%ROOT%"

set "PY=python"
set "PORT=8765"

echo [%date% %time%] starting flight parser server on port %PORT% >> "%ROOT%log\flight_parser_server.log"
%PY% -m uvicorn app.flight_parser.server:app --host 127.0.0.1 --port %PORT% >> "%ROOT%log\flight_parser_server.log" 2>&1
popd
endlocal

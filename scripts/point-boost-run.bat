@echo off
rem Point-boost scheduled runner (called by Windows Task Scheduler).
rem Output is appended to logs\point_boost_task.log.
setlocal
cd /d "%~dp0..\webui"
if not exist "..\logs" mkdir "..\logs"
echo ==== %date% %time% ==== >> "..\logs\point_boost_task.log"
call npx tsx scripts/point_boost_run.mjs >> "..\logs\point_boost_task.log" 2>&1
endlocal

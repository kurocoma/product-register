@echo off
rem ポイント変倍最適化の定期実行（タスクスケジューラから呼ばれる）。
rem 実行ログは logs\point_boost_task.log に追記される。
setlocal
cd /d "%~dp0..\webui"
if not exist "..\logs" mkdir "..\logs"
echo ==== %date% %time% ==== >> "..\logs\point_boost_task.log"
call npx tsx scripts/point_boost_run.mjs >> "..\logs\point_boost_task.log" 2>&1
endlocal

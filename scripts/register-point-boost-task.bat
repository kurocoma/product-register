@echo off
rem ポイント変倍最適化をWindowsタスクスケジューラに登録する（1日2回）。
rem 時刻を変えたい場合は下の TIME1 / TIME2 を編集して再実行（/F で上書き登録される）。
rem 前提: PCがこの時刻に起動していること。削除は:
rem   schtasks /Delete /TN "ProductRegister PointBoost AM" /F
rem   schtasks /Delete /TN "ProductRegister PointBoost PM" /F
setlocal
set TIME1=09:00
set TIME2=21:00
set RUN_BAT=%~dp0point-boost-run.bat

schtasks /Create /F /TN "ProductRegister PointBoost AM" /TR "\"%RUN_BAT%\"" /SC DAILY /ST %TIME1%
if errorlevel 1 goto :fail
schtasks /Create /F /TN "ProductRegister PointBoost PM" /TR "\"%RUN_BAT%\"" /SC DAILY /ST %TIME2%
if errorlevel 1 goto :fail

echo.
echo 登録しました: %TIME1% / %TIME2% に毎日実行されます。
echo 実行ログ: logs\point_boost_task.log
echo ※実際に変倍を反映するには、アプリの「ポイント変倍」画面で「自動実行を有効にする」をONにしてください。
endlocal
exit /b 0

:fail
echo タスク登録に失敗しました。管理者権限で実行してみてください。
endlocal
exit /b 1

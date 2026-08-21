@echo off
rem Register point-boost as Windows scheduled tasks (twice a day).
rem Edit TIME1 / TIME2 below and re-run to change times (/F overwrites).
rem The PC must be powered on at these times.
rem NOTE: campaign windows (9:00-17:59 / 20:00-23:59 JST) are defined in
rem   webui/lib/point-boost/point-campaign.ts (CAMPAIGN_WINDOWS_JST).
rem   Each window's start must be more than 2 hours after the run time (RMS IE0173),
rem   so change TIME1/TIME2 and the windows together.
rem To remove:
rem   schtasks /Delete /TN "ProductRegister PointBoost AM" /F
rem   schtasks /Delete /TN "ProductRegister PointBoost PM" /F
setlocal
set TIME1=06:45
set TIME2=17:45
set RUN_BAT=%~dp0point-boost-run.bat

schtasks /Create /F /TN "ProductRegister PointBoost AM" /TR "\"%RUN_BAT%\"" /SC DAILY /ST %TIME1%
if errorlevel 1 goto :fail
schtasks /Create /F /TN "ProductRegister PointBoost PM" /TR "\"%RUN_BAT%\"" /SC DAILY /ST %TIME2%
if errorlevel 1 goto :fail

echo.
echo Registered: runs daily at %TIME1% and %TIME2%.
echo Log: logs\point_boost_task.log
echo NOTE: enable "auto run" in the app's Point Boost screen to actually apply changes.
endlocal
exit /b 0

:fail
echo ERROR: schtasks /Create failed. Try running this bat as Administrator.
endlocal
exit /b 1

@echo off
setlocal
cd /d "%~dp0\.."
if not exist ".env.worker" exit /b 1
if not exist ".env.alerts" exit /b 1
if not exist "worker-logs" mkdir "worker-logs"
node --env-file=.env.worker --env-file=.env.alerts scripts/worker-alerts.mjs --watch >> "worker-logs\alerts.log" 2>> "worker-logs\alerts-error.log"

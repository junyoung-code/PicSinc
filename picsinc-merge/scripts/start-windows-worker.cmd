@echo off
setlocal
cd /d "%~dp0\.."
if not exist ".env.worker" exit /b 1
if not exist "worker-logs" mkdir "worker-logs"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\check-windows-worker.ps1" >> "worker-logs\worker.log" 2>> "worker-logs\worker-error.log"
if errorlevel 1 exit /b 1
node --env-file=.env.worker --import tsx src/features/composition/worker-main.ts >> "worker-logs\worker.log" 2>> "worker-logs\worker-error.log"

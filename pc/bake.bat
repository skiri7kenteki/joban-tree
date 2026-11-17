@echo off
rem joban-tree (PC): make a bundled tree with the native engine. Double-click to start, or to resume after a stop.
rem Stop with Ctrl+C (or close this window). Options are passed through, e.g. bake.bat --trial / bake.bat --fresh
rem Keep this file ASCII only (cmd misreads non-ASCII lines).
chcp 65001 > nul
cd /d "%~dp0.."

set "NODE_EXE="
where node > nul 2> nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%USERPROFILE%\tools\node\node.exe" set "NODE_EXE=%USERPROFILE%\tools\node\node.exe"
if not defined NODE_EXE (
  echo Node.js was not found. Please install it from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo node_modules was not found. Run "npm install" in this folder first.
  pause
  exit /b 1
)

"%NODE_EXE%" node_modules\vite\bin\vite.js build --config pc\bake\vite.config.ts --logLevel warn
if errorlevel 1 (
  pause
  exit /b 1
)
"%NODE_EXE%" pc\bake\dist\bake.mjs %*
pause

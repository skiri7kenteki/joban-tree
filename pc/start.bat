@echo off
rem joban-tree (PC): double-click to start the local server and open the browser.
rem Close this window to stop. Keep this file ASCII only (cmd misreads non-ASCII lines).
chcp 65001 > nul
cd /d "%~dp0"

set "NODE_EXE="
where node > nul 2> nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%USERPROFILE%\tools\node\node.exe" set "NODE_EXE=%USERPROFILE%\tools\node\node.exe"
if not defined NODE_EXE (
  echo Node.js was not found. Please install it from https://nodejs.org/
  pause
  exit /b 1
)

"%NODE_EXE%" server.mjs --open %*
pause

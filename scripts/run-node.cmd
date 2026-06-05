@echo off
setlocal

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" %*
  exit /b %errorlevel%
)

where node >nul 2>nul
if %errorlevel%==0 (
  node %*
  exit /b %errorlevel%
)

echo Node.js was not found.
echo Install Node.js or run this project from Codex Desktop where the bundled runtime is available.
exit /b 1

@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
call "%SCRIPT_DIR%scripts\run-node.cmd" "%SCRIPT_DIR%scripts\serve.mjs"

@echo off
title Avvio ContiFor
cd /d "%~dp0"
echo ========================================================
echo          AVVIO APPLICAZIONE CONTIFOR (PWA)
echo ========================================================
echo.
echo Avvio del server locale in corso...

REM Controlla se Python e' disponibile
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Utilizzo server Python su porta 8080...
    start http://localhost:8080
    python -m http.server 8080
    goto end
)

REM Controlla se Node e' disponibile
where npx >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Utilizzo npx serve su porta 8080...
    start http://localhost:8080
    npx serve -l 8080 .
    goto end
)

REM Fallback: PowerShell HttpListener
echo Avvio server PowerShell...
start http://localhost:8080
powershell -ExecutionPolicy Bypass -Command "$listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:8080/'); $listener.Start(); Write-Host 'Server attivo su http://localhost:8080/ (Premi Ctrl+C per fermare)'; while($listener.IsListening){ $context = $listener.GetContext(); $path = Join-Path (Get-Location) ($context.Request.Url.LocalPath.TrimStart('/')); if(-not (Test-Path $path) -or (Get-Item $path) -is [System.IO.DirectoryInfo]){ $path = Join-Path $path 'index.html' }; if(Test-Path $path){ $bytes = [System.IO.File]::ReadAllBytes($path); $ext = [System.IO.Path]::GetExtension($path).ToLower(); $mime = 'text/plain'; switch($ext){ '.html'{$mime='text/html'}; '.js'{$mime='application/javascript'}; '.css'{$mime='text/css'}; '.svg'{$mime='image/svg+xml'}; '.json'{$mime='application/json'} }; $context.Response.ContentType = $mime; $context.Response.OutputStream.Write($bytes, 0, $bytes.Length) } else { $context.Response.StatusCode = 404 }; $context.Response.Close() }"

:end
pause

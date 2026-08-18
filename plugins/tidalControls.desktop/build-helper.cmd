@echo off
setlocal

echo.
echo ============================================
echo  TidalControls Native Helper Builder v1.2
echo ============================================
echo.

where dotnet >nul 2>nul
if errorlevel 1 (
    echo ERROR: .NET 8 SDK was not found.
    echo.
    echo Install the .NET 8 SDK from Microsoft, then run this file again.
    echo.
    pause
    exit /b 1
)

set "HERE=%~dp0"
set "PROJECT=%HERE%helper\TidalControlsHelper.csproj"
set "TARGET=%APPDATA%\Vencord\TidalControls"

if not exist "%TARGET%" mkdir "%TARGET%"

echo Building native Windows helper...
echo Runtime PowerShell usage: NONE
echo.

dotnet publish "%PROJECT%" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o "%TARGET%"

if errorlevel 1 (
    echo.
    echo ERROR: Helper build failed.
    pause
    exit /b 1
)

echo.
echo Built:
echo %TARGET%\TidalControlsHelper.exe
echo.
echo You can now run:
echo   pnpm build
echo   pnpm inject
echo.
pause

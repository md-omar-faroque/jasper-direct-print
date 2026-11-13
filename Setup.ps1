# Jasper Direct Print - one-click setup. No admin rights needed.
$ErrorActionPreference = "Stop"

$ExtensionId = "nlbogiickdaofdblfkpkllloogcioghh"   # fixed by the "key" in extension\manifest.json
$HostName    = "com.jasper.directprint"
$src         = $PSScriptRoot
$dest        = Join-Path $env:LOCALAPPDATA "JasperDirectPrint"

try {
    if (-not (Test-Path (Join-Path $src "native-host\print_host.ps1"))) {
        throw "Files not found. Please extract the ZIP first, then double-click Setup.bat."
    }

    Write-Host "1/4 Copying files to $dest ..."
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Copy-Item (Join-Path $src "extension")   $dest -Recurse -Force
    Copy-Item (Join-Path $src "native-host") $dest -Recurse -Force
    Get-ChildItem $dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

    $hostDir  = Join-Path $dest "native-host"
    $toolsDir = Join-Path $hostDir "tools"
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    $sumatra  = Join-Path $toolsDir "SumatraPDF.exe"

    Write-Host "2/4 Checking SumatraPDF ..."
    $existing = @(
        "C:\Program Files\SumatraPDF\SumatraPDF.exe",
        "C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
        (Join-Path $env:LOCALAPPDATA "SumatraPDF\SumatraPDF.exe")
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (Test-Path $sumatra) {
        Write-Host "    Using portable SumatraPDF.exe from the tools folder."
    } elseif ($existing) {
        Write-Host "    Using SumatraPDF already installed at $existing"
    } else {
        $installer = Get-ChildItem $src -Filter "SumatraPDF*install*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($installer) {
            Write-Host "    Setting up SumatraPDF privately inside the app folder (silent) ..."
            Start-Process -FilePath $installer.FullName -ArgumentList "-s -d `"$toolsDir`"" -Wait
        }
        if (-not (Test-Path $sumatra)) {
            Write-Host "    WARNING: SumatraPDF could not be set up automatically." -ForegroundColor Yellow
            Write-Host "    Download the portable SumatraPDF.exe and copy it to:" -ForegroundColor Yellow
            Write-Host "    $toolsDir" -ForegroundColor Yellow
        }
    }

    Write-Host "3/4 Registering native host with Chrome and Edge ..."
    $batPath = Join-Path $hostDir "print_host.bat"
    $manifest = [ordered]@{
        name            = $HostName
        description     = "Jasper Direct Print native host"
        path            = $batPath
        type            = "stdio"
        allowed_origins = @("chrome-extension://$ExtensionId/")
    }
    $manifestPath = Join-Path $hostDir "$HostName.installed.json"
    $json = $manifest | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($manifestPath, $json, (New-Object Text.UTF8Encoding($false)))

    foreach ($root in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts",
                        "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts")) {
        $key = Join-Path $root $HostName
        New-Item -Path $key -Force | Out-Null
        Set-ItemProperty -Path $key -Name "(default)" -Value $manifestPath
    }

    Write-Host "4/4 Done."
    $extPath = Join-Path $dest "extension"
    Set-Clipboard -Value $extPath
    Write-Host ""
    Write-Host "=============================================================" -ForegroundColor Green
    Write-Host " Native host installed." -ForegroundColor Green
    Write-Host " LAST STEP (one time only):" -ForegroundColor Green
    Write-Host "  1. In Chrome open  chrome://extensions  and turn on Developer mode"
    Write-Host "  2. Click 'Load unpacked' and paste this folder (already copied):"
    Write-Host "     $extPath"
    Write-Host "  3. The extension ID should be: $ExtensionId"
    Write-Host "  4. Restart Chrome, open the extension Settings, pick your printer."
    Write-Host "=============================================================" -ForegroundColor Green
    Start-Process "explorer.exe" $extPath
} catch {
    Write-Host ""
    Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

param()

$ErrorActionPreference = "Stop"

$LogFile = Join-Path (Split-Path -Parent $PSScriptRoot) "host.log"
function Write-Log {
    param([string]$Text)
    try { Add-Content -Path $LogFile -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Text) } catch {}
}
Write-Log "Host started"

$ScriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ScriptRoot)) {
    $ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

function Read-NativeMessage {
    $stdin = [Console]::OpenStandardInput()
    $lengthBytes = New-Object byte[] 4
    $read = $stdin.Read($lengthBytes, 0, 4)
    if ($read -ne 4) {
        return $null
    }

    $length = [BitConverter]::ToInt32($lengthBytes, 0)
    if ($length -le 0) {
        return $null
    }

    $messageBytes = New-Object byte[] $length
    $offset = 0
    while ($offset -lt $length) {
        $read = $stdin.Read($messageBytes, $offset, $length - $offset)
        if ($read -le 0) {
            break
        }
        $offset += $read
    }

    return [Text.Encoding]::UTF8.GetString($messageBytes)
}

function Write-NativeMessage {
    param([string]$Message)

    $bytes = [Text.Encoding]::UTF8.GetBytes($Message)
    $lengthBytes = [BitConverter]::GetBytes([uint32]$bytes.Length)
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($lengthBytes, 0, 4)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

function Send-Response {
    param([hashtable]$Payload)
    Write-NativeMessage ((ConvertTo-Json $Payload -Compress -Depth 6))
}

function Get-SumatraPath {
    $candidates = @(
        (Join-Path $ScriptRoot "tools\SumatraPDF.exe"),
        "C:\Program Files\SumatraPDF\SumatraPDF.exe",
        "C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe"
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) {
            return $path
        }
    }

    return $null
}

function Get-InstalledPrinters {
    return @(Get-Printer | Select-Object -ExpandProperty Name | Sort-Object)
}

function Get-DefaultPrinterName {
    $defaultPrinter = Get-CimInstance -ClassName Win32_Printer -Filter "Default='TRUE'" |
        Select-Object -First 1 -ExpandProperty Name

    return $defaultPrinter
}

function Save-PdfFromUrl {
    param(
        [string]$Url,
        [string]$CookieHeader,
        [string]$OutputPath
    )

    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($CookieHeader)) {
        $headers["Cookie"] = $CookieHeader
    }

    Write-Log "Downloading $Url"
    Invoke-WebRequest -Uri $Url -Headers $headers -OutFile $OutputPath -UseBasicParsing

    if (-not (Test-Path $OutputPath)) {
        throw "Downloaded PDF file was not created."
    }

    $fs = [IO.File]::OpenRead($OutputPath)
    $buf = New-Object byte[] 5
    [void]$fs.Read($buf, 0, 5)
    $fs.Close()
    $head = [Text.Encoding]::ASCII.GetString($buf)
    $size = (Get-Item $OutputPath).Length
    Write-Log "Downloaded $size bytes, header '$head'"
    if ($head -ne "%PDF-") {
        throw "Server did not return a PDF (got $size bytes starting '$head'). Session/login problem?"
    }
}

function Get-PrintSettingsString {
    param(
        [int]$Copies,
        [string]$PrintMode
    )

    # "actual" (default) = print at 100%, no scaling, no forced orientation.
    # This preserves barcode bar widths exactly as generated - any fit-to-page
    # scaling can blur/distort barcodes enough that scanners can't read them.
    # "auto" = old fit-to-page behavior, kept only for reports whose PDF page
    # size doesn't match the loaded paper and genuinely need scaling.
    # "exact-landscape"/"exact-portrait" = actual size PLUS a forced
    # orientation, for labels where the driver's default orientation fights
    # the report's page shape.
    switch ($PrintMode) {
        "auto"            { return "${Copies}x" }
        "exact-landscape" { return "${Copies}x,noscale,landscape" }
        "exact-portrait"  { return "${Copies}x,noscale,portrait" }
        default           { return "${Copies}x,noscale" }
    }
}

function Invoke-SilentPdfPrint {
    param(
        [string]$PdfPath,
        [string]$PrinterName,
        [int]$Copies = 1,
        [string]$PrintMode = "actual"
    )

    $sumatraPath = Get-SumatraPath
    if (-not $sumatraPath) {
        throw "SumatraPDF was not found. Install it or place SumatraPDF.exe in native-host\tools."
    }

    if (-not (Test-Path $PdfPath)) {
        throw "Temporary PDF file was not found."
    }

    $targetPrinter = $PrinterName
    if ([string]::IsNullOrWhiteSpace($targetPrinter)) {
        $targetPrinter = Get-DefaultPrinterName
    }

    if ([string]::IsNullOrWhiteSpace($targetPrinter)) {
        throw "No printer selected and no Windows default printer found."
    }

    $copies = [Math]::Max(1, $Copies)
    $printSettings = Get-PrintSettingsString -Copies $copies -PrintMode $PrintMode

    $argumentString = "-print-to `"$targetPrinter`" -print-settings $printSettings -silent `"$PdfPath`""
    Write-Log "Sumatra: $sumatraPath $argumentString"
    $process = Start-Process -FilePath $sumatraPath -ArgumentList $argumentString -PassThru -WindowStyle Hidden -Wait
    Write-Log "Sumatra exit code $($process.ExitCode)"
    if ($process.ExitCode -ne 0) {
        throw "SumatraPDF failed with exit code $($process.ExitCode)."
    }

    return @{
        printer = $targetPrinter
        copies = $copies
    }
}

function Handle-Message {
    param([string]$RawMessage)

    Write-Log "Received: $($RawMessage.Substring(0, [Math]::Min(300, $RawMessage.Length)))"
    $message = $RawMessage | ConvertFrom-Json
    $action = $message.action

    switch ($action) {
        "listPrinters" {
            Send-Response @{
                success = $true
                printers = Get-InstalledPrinters
            }
        }
        "testConnection" {
            Send-Response @{
                success = $true
                sumatraPath = (Get-SumatraPath)
                printers = (Get-InstalledPrinters).Count
            }
        }
        "printUrl" {
            if ([string]::IsNullOrWhiteSpace($message.url)) {
                throw "Missing report URL."
            }

            $fileName = if ($message.fileName) { $message.fileName } else { "jasper-report.pdf" }
            $tempDir = Join-Path $env:TEMP "jasper-direct-print"
            if (-not (Test-Path $tempDir)) {
                New-Item -ItemType Directory -Path $tempDir | Out-Null
            }

            $pdfPath = Join-Path $tempDir $fileName
            Save-PdfFromUrl -Url $message.url -CookieHeader $message.cookieHeader -OutputPath $pdfPath

            $printMode = if ($message.printMode) { $message.printMode } else { "actual" }
            $result = Invoke-SilentPdfPrint -PdfPath $pdfPath -PrinterName $message.printerName -Copies ([int]$message.copies) -PrintMode $printMode
            Send-Response @{
                success = $true
                printer = $result.printer
                copies = $result.copies
            }
        }
        "print" {
            if ([string]::IsNullOrWhiteSpace($message.pdfBase64)) {
                throw "Missing PDF data."
            }

            $fileName = if ($message.fileName) { $message.fileName } else { "jasper-report.pdf" }
            $tempDir = Join-Path $env:TEMP "jasper-direct-print"
            if (-not (Test-Path $tempDir)) {
                New-Item -ItemType Directory -Path $tempDir | Out-Null
            }

            $pdfPath = Join-Path $tempDir $fileName
            $bytes = [Convert]::FromBase64String($message.pdfBase64)
            [IO.File]::WriteAllBytes($pdfPath, $bytes)

            $printMode = if ($message.printMode) { $message.printMode } else { "actual" }
            $result = Invoke-SilentPdfPrint -PdfPath $pdfPath -PrinterName $message.printerName -Copies ([int]$message.copies) -PrintMode $printMode
            Send-Response @{
                success = $true
                printer = $result.printer
                copies = $result.copies
            }
        }
        default {
            throw "Unknown action: $action"
        }
    }
}

try {
    while ($true) {
        $incoming = Read-NativeMessage
        if ($null -eq $incoming) {
            break
        }

        try {
            Handle-Message -RawMessage $incoming
        } catch {
            Write-Log "ERROR: $($_.Exception.Message)"
            Send-Response @{
                success = $false
                error = $_.Exception.Message
            }
        }
    }
} catch {
    try {
        Send-Response @{
            success = $false
            error = $_.Exception.Message
        }
    } catch {
        exit 1
    }
}

# Jasper Direct Print - diagnostics. Run via Diagnose.bat
$dest = Join-Path $env:LOCALAPPDATA "JasperDirectPrint"
Write-Host "== Installed folder: $dest" ; Test-Path $dest
Write-Host "== Registry"
foreach ($r in "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.jasper.directprint","HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.jasper.directprint") {
  if (Test-Path $r) { "$r -> " + (Get-ItemProperty $r).'(default)' } else { "MISSING: $r" }
}
Write-Host "== Printers"
Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | Format-Table -AutoSize
$def = (Get-CimInstance Win32_Printer -Filter "Default='TRUE'").Name
Write-Host "Windows default printer: $def"
$sum = Join-Path $dest "native-host\tools\SumatraPDF.exe"
Write-Host "SumatraPDF exists: $(Test-Path $sum)"
$name = Read-Host "Type the exact printer name to test (Enter = default printer)"
if (-not $name) { $name = $def }
$pdf = Join-Path $env:TEMP "jdp-test.pdf"
$content = "BT /F1 24 Tf 72 700 Td (Jasper Direct Print test page) Tj ET"
$objs = @(
 "<< /Type /Catalog /Pages 2 0 R >>",
 "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
 "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
 "<< /Length $($content.Length) >>`nstream`n$content`nendstream",
 "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
$sb = New-Object Text.StringBuilder; [void]$sb.Append("%PDF-1.4`n"); $offs=@()
for ($i=0;$i -lt $objs.Count;$i++){ $offs += $sb.Length; [void]$sb.Append("$($i+1) 0 obj`n$($objs[$i])`nendobj`n") }
$x=$sb.Length; [void]$sb.Append("xref`n0 6`n0000000000 65535 f `n")
foreach($o in $offs){ [void]$sb.Append(("{0:D10} 00000 n `n" -f $o)) }
[void]$sb.Append("trailer << /Size 6 /Root 1 0 R >>`nstartxref`n$x`n%%EOF`n")
[IO.File]::WriteAllText($pdf, $sb.ToString(), [Text.Encoding]::ASCII)
Write-Host "== Printing test page to '$name'"
$p = Start-Process $sum -ArgumentList "-print-to `"$name`" -print-settings 1x,noscale -silent `"$pdf`"" -PassThru -Wait
Write-Host "SumatraPDF exit code: $($p.ExitCode)  (0 = sent to printer)"
Write-Host "== Last host log lines"
$log = Join-Path $dest "host.log"
if (Test-Path $log) { Get-Content $log -Tail 20 } else { "No host.log yet - the browser has never started the native host." }

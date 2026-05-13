param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Local     = Join-Path $ScriptDir "vm-test.sh"

# Strip CRLF to LF before shipping
$tmp = New-TemporaryFile
$content = Get-Content -Raw -LiteralPath $Local
$content = $content -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($tmp.FullName, $content)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Ship vm-test.sh to VM and execute" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

scp -i $SshKey -q $tmp.FullName "${VMUser}@${VMHost}:/tmp/vm-test.sh"
Remove-Item $tmp.FullName -Force

# Execute the test on the VM. Stream to screen AND save to deploy/.vm-test-output.txt for later inspection.
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$OutFile     = Join-Path $ProjectRoot "deploy\.vm-test-output.txt"

ssh -i $SshKey "${VMUser}@${VMHost}" "chmod +x /tmp/vm-test.sh && /tmp/vm-test.sh && rm -f /tmp/vm-test.sh" 2>&1 | Tee-Object -FilePath $OutFile

Write-Host ""
Write-Host "Output also saved to: $OutFile" -ForegroundColor Green

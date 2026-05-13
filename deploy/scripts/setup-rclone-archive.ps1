param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$Local       = Join-Path $ScriptDir "setup-rclone-archive.sh"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Step 1: ship setup-rclone-archive.sh to VM" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Strip CRLF -> LF before shipping (Windows-edited bash scripts trip on \r)
$tmp = New-TemporaryFile
$content = Get-Content -Raw -LiteralPath $Local
$content = $content -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($tmp.FullName, $content)

scp -i $SshKey $tmp.FullName "${VMUser}@${VMHost}:/tmp/setup-rclone-archive.sh"
Remove-Item $tmp.FullName -Force

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Step 2: run it (as root) on the VM" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
ssh -i $SshKey "${VMUser}@${VMHost}" "sudo bash /tmp/setup-rclone-archive.sh && rm -f /tmp/setup-rclone-archive.sh" 2>&1 | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Setup script done. Now run rclone config interactively." -ForegroundColor Green
Write-Host "  See RCLONE-CONFIG-GUIDE.md in the project root." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

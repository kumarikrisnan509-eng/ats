param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$Out         = Join-Path $ProjectRoot "deploy\.vm-analysis.txt"

"" | Out-File -FilePath $Out -Encoding utf8

function Section($title, $cmd) {
    "" | Add-Content $Out
    "============================================================" | Add-Content $Out
    " $title" | Add-Content $Out
    "============================================================" | Add-Content $Out
    Write-Host "==> $title" -ForegroundColor Cyan
    $output = ssh -i $SshKey "$VMUser@$VMHost" $cmd 2>&1
    $output | ForEach-Object {
        $_ | Add-Content $Out
        Write-Host "    $_" -ForegroundColor DarkGray
    }
}

Section "df -h (overall disk usage)"        "df -h | head -10"
Section "Total disk per major dir"          "sudo du -hx --max-depth=1 / 2>/dev/null | sort -hr | head -15"
Section "/var top 15"                       "sudo du -hx --max-depth=2 /var 2>/dev/null | sort -hr | head -15"
Section "/var/log breakdown"                "sudo du -hx --max-depth=2 /var/log 2>/dev/null | sort -hr | head -10"
Section "/var/log/ats (our audit log)"      "sudo ls -lah /var/log/ats/ 2>/dev/null"
Section "/var/cache/apt downloaded .debs"   "sudo du -sh /var/cache/apt/archives 2>/dev/null; echo 'files:'; sudo find /var/cache/apt/archives -name '*.deb' 2>/dev/null | wc -l"
Section "/var/lib/docker total"             "sudo du -sh /var/lib/docker 2>/dev/null"
Section "Docker space breakdown"            "sudo docker system df"
Section "All Docker images"                 "sudo docker images -a"
Section "Snap installed + disabled rev"     "snap list --all 2>/dev/null"
Section "/home/ubuntu top entries"          "sudo du -hx --max-depth=2 /home/ubuntu 2>/dev/null | sort -hr | head -10"
Section "/tmp"                              "sudo du -sh /tmp 2>/dev/null; ls /tmp 2>/dev/null"
Section "Journal (systemd) usage"           "sudo journalctl --disk-usage"
Section "Required: /opt/ats"                "sudo ls -lahR /opt/ats 2>/dev/null"
Section "Required: /etc/ats"                "sudo ls -lah /etc/ats 2>/dev/null"
Section "Required: /var/lib/ats/tokens"     "sudo ls -lah /var/lib/ats/tokens 2>/dev/null"
Section "Required: /var/www/<domain>"       "sudo ls -lah /var/www/ats.rajasekarselvam.com 2>/dev/null | head -10"
Section "Required: TLS cert"                "sudo ls -lah /etc/letsencrypt/live/ats.rajasekarselvam.com/ 2>/dev/null"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Analysis written to $Out" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

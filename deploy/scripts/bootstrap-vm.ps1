# bootstrap-vm.ps1 - one-shot VM bootstrap for the ATS Docker deploy.
# Conservative PowerShell syntax for max compatibility (PS 5.1 / 7+).
#
# Run from the project root (the folder containing this script's parent ATS Design):
#   .\deploy\scripts\bootstrap-vm.ps1
# Or just double-click BOOTSTRAP-VM.cmd in the project root.

param(
    [string]$VMHost      = "141.148.192.4",
    [string]$VMUser      = "ubuntu",
    [string]$SshKey      = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key",
    [string]$Domain      = "ats.rajasekarselvam.com",
    [string]$Email       = "rajasekarjavaee@gmail.com",
    [string]$DeployerPub = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIWnY09RubaEAvP5Q0/j0wUtzyKKZTclHiDEMUWuP+Hi github-actions@rajasekarselvam.com"
)

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$DeployDir   = Join-Path $ProjectRoot "deploy"
$LogFile     = Join-Path $DeployDir ".bootstrap.log"
$SecretsDir  = Join-Path $ProjectRoot ".secrets-local"
$KnownHosts  = Join-Path $SecretsDir "known_hosts.txt"

if (-not (Test-Path $SecretsDir)) {
    New-Item -ItemType Directory -Path $SecretsDir -Force | Out-Null
}

# Reset log
"" | Out-File -FilePath $LogFile -Encoding utf8

function Write-Log {
    param([string]$Message, [string]$Color = "White")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[" + $ts + "] " + $Message
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $LogFile -Value $line
}

function Invoke-Ssh {
    param([string]$Command)
    Write-Log ("ssh> " + $Command) "DarkGray"
    # Native commands like ssh print progress to stderr; PowerShell's "Stop" error preference
    # treats that as a terminating exception. Temporarily relax so we only fail on real
    # non-zero exit codes.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = ssh -i $SshKey -o StrictHostKeyChecking=accept-new ($VMUser + "@" + $VMHost) $Command 2>&1 |
                ForEach-Object { Add-Content -Path $LogFile -Value $_; Write-Host $_ -ForegroundColor DarkGray; $_ }
        $exit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    if ($exit -ne 0) {
        Write-Log ("ssh failed exit=" + $exit) "Red"
        throw ("ssh: " + $Command)
    }
    return $out
}

Write-Log "==> ATS VM bootstrap starting" "Cyan"
Write-Log ("    Project root: " + $ProjectRoot)
Write-Log ("    VM:           " + $VMUser + "@" + $VMHost)
Write-Log ("    Domain:       " + $Domain)

# ----- 1) Sanity checks -----
Write-Log "==> [1/7] Sanity checks" "Cyan"

$sshCmd = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $sshCmd) {
    throw "ssh not on PATH. Install Windows OpenSSH client: Settings -> Apps -> Optional features -> Add a feature -> OpenSSH Client."
}
Write-Log "  ssh OK"

$scpCmd = Get-Command scp -ErrorAction SilentlyContinue
if (-not $scpCmd) {
    throw "scp not on PATH. Install Windows OpenSSH client."
}
Write-Log "  scp OK"

if (-not (Test-Path $DeployDir)) {
    throw ("deploy/ folder not found at " + $DeployDir)
}
Write-Log "  deploy/ folder OK"

if (-not (Test-Path $SshKey)) {
    throw ("SSH key not found at " + $SshKey + ". Pass -SshKey <path> to override.")
}
Write-Log ("  SSH key OK: " + $SshKey)

# ----- 2) Probe SSH reachability -----
Write-Log "==> [2/7] Probing SSH" "Cyan"

$probeTarget = $VMUser + "@" + $VMHost
$prevErr = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$probeOut = ssh -i $SshKey -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 $probeTarget "echo ok" 2>&1
$probeExit = $LASTEXITCODE
$ErrorActionPreference = $prevErr
foreach ($l in $probeOut) { Add-Content -Path $LogFile -Value $l }
if ($probeExit -ne 0) {
    Write-Log "  Cannot SSH. Common causes:" "Red"
    Write-Log "   * VM not running, port 22 closed, or SSH key not loaded" "Yellow"
    foreach ($l in $probeOut) { Write-Host $l -ForegroundColor Red }
    throw "SSH probe failed."
}
Write-Log "  SSH OK"

# ----- 3) scp deploy/ -----
Write-Log "==> [3/7] scp deploy/ to /tmp/ats-deploy" "Cyan"

# Wipe any previous upload so scp -r doesn't nest into /tmp/ats-deploy/deploy
Invoke-Ssh "rm -rf /tmp/ats-deploy"

$scpTarget = $VMUser + "@" + $VMHost + ":/tmp/ats-deploy"
$prevErr = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& scp -i $SshKey -r -o StrictHostKeyChecking=accept-new $DeployDir $scpTarget 2>&1 | ForEach-Object {
    Add-Content -Path $LogFile -Value $_
    Write-Host $_ -ForegroundColor DarkGray
}
$scpExit = $LASTEXITCODE
$ErrorActionPreference = $prevErr
if ($scpExit -ne 0) {
    throw ("scp failed exit=" + $scpExit)
}
Write-Log "  Upload complete"

# ----- 4) Run setup-ubuntu-docker.sh -----
Write-Log "==> [4/7] Running setup-ubuntu-docker.sh on VM (3-5 min)" "Cyan"
Invoke-Ssh "sudo bash /tmp/ats-deploy/scripts/setup-ubuntu-docker.sh"
Write-Log "  Bootstrap complete"

# ----- 5) Deployer SSH key — already installed by setup-ubuntu-docker.sh -----
Write-Log "==> [5/7] Deployer SSH key installed by setup script" "Cyan"

# ----- 6) TLS via Certbot -----
Write-Log "==> [6/7] Certbot for $Domain" "Cyan"

$certbotCmd = "sudo certbot --nginx -d " + $Domain + " --agree-tos -m " + $Email + " --redirect --no-eff-email --non-interactive"
try {
    Invoke-Ssh $certbotCmd
    Write-Log "  Certbot OK"
} catch {
    Write-Log "  Certbot failed. May be DNS not propagated yet. Re-run later:" "Yellow"
    Write-Log ("    ssh " + $probeTarget + " '" + $certbotCmd + "'") "Yellow"
}

# ----- 7) ssh-keyscan for OCI_SSH_KNOWN_HOSTS -----
Write-Log "==> [7/7] Capturing host key" "Cyan"

$prevErr = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$scan = & ssh-keyscan -H -t ed25519,rsa,ecdsa $VMHost 2>$null
$ErrorActionPreference = $prevErr
if (-not $scan) {
    Write-Log "  ssh-keyscan returned nothing. Try later." "Yellow"
} else {
    $scan | Out-File -FilePath $KnownHosts -Encoding ascii
    $lineCount = ($scan | Measure-Object -Line).Lines
    Write-Log ("  Wrote " + $KnownHosts + " (" + $lineCount + " lines)")
}

# ----- Final -----
Write-Host ""
Write-Log "==> ALL DONE" "Green"
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " Bootstrap log:   $LogFile"   -ForegroundColor Green
Write-Host " known_hosts:     $KnownHosts" -ForegroundColor Green
Write-Host ""
Write-Host " Verify TLS once cert is issued:"                                   -ForegroundColor Green
Write-Host "   https://$Domain/api/health"                                      -ForegroundColor Yellow
Write-Host "=================================================================="  -ForegroundColor Green

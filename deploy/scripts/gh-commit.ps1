# gh-commit.ps1 -- commit + push files via GitHub REST API.
# Windows PowerShell equivalent of gh-commit.sh. Bypasses local .git so it works
# when index.lock is stuck or a rebase is in progress.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\deploy\scripts\gh-commit.ps1 `
#     -Message "tier xx" -Files @("path/to/a.js","path/to/b.jsx")

param(
    [Parameter(Mandatory=$true)][string]$Message,
    [Parameter(Mandatory=$true)][string[]]$Files,
    [string]$Owner   = "mohanapriya63085",
    [string]$Repo    = "ats",
    [string]$Branch  = "main",
    [string]$Pat     = "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"
)

$ErrorActionPreference = "Stop"
$Api = "https://api.github.com/repos/$Owner/$Repo"
$Headers = @{
    Authorization = "Bearer $Pat"
    Accept        = "application/vnd.github+json"
    "User-Agent"  = "ats-deploy-script"
}

function Invoke-Api {
    param([string]$Method, [string]$Path, [object]$Body)
    $uri = "$Api$Path"
    if ($Body) {
        $json = $Body | ConvertTo-Json -Depth 20 -Compress
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers -Body $json -ContentType "application/json"
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $Headers
}

Write-Host "[1/5] Fetch current $Branch SHA" -ForegroundColor Cyan
$refResp = Invoke-Api -Method GET -Path "/git/ref/heads/$Branch"
$parentSha = $refResp.object.sha
Write-Host "      parent: $($parentSha.Substring(0,12))"

Write-Host "[2/5] Fetch parent tree SHA" -ForegroundColor Cyan
$commitResp = Invoke-Api -Method GET -Path "/git/commits/$parentSha"
$baseTree = $commitResp.tree.sha
Write-Host "      base tree: $($baseTree.Substring(0,12))"

Write-Host "[3/5] Upload each file as a blob" -ForegroundColor Cyan
$treeItems = @()
foreach ($f in $Files) {
    if (-not (Test-Path $f)) {
        Write-Host "      skip (missing): $f" -ForegroundColor Yellow
        continue
    }
    $bytes = [System.IO.File]::ReadAllBytes($f)
    $b64   = [Convert]::ToBase64String($bytes)
    $blobResp = Invoke-Api -Method POST -Path "/git/blobs" -Body @{
        content  = $b64
        encoding = "base64"
    }
    $blobSha = $blobResp.sha
    $unixPath = $f -replace "\\","/"
    Write-Host ("      {0,-60} -> blob {1}" -f $unixPath, $blobSha.Substring(0,12))
    $treeItems += @{
        path = $unixPath
        mode = "100644"
        type = "blob"
        sha  = $blobSha
    }
}

if ($treeItems.Count -eq 0) {
    throw "No files were uploaded -- check paths."
}

Write-Host "[4/5] Create tree on top of base" -ForegroundColor Cyan
$treeResp = Invoke-Api -Method POST -Path "/git/trees" -Body @{
    base_tree = $baseTree
    tree      = $treeItems
}
$newTree = $treeResp.sha
Write-Host "      new tree: $($newTree.Substring(0,12))"

Write-Host "[5/5] Create commit + advance ref" -ForegroundColor Cyan
$commitNewResp = Invoke-Api -Method POST -Path "/git/commits" -Body @{
    message = $Message
    tree    = $newTree
    parents = @($parentSha)
}
$newCommit = $commitNewResp.sha
Write-Host "      new commit: $($newCommit.Substring(0,12))"

$null = Invoke-Api -Method PATCH -Path "/git/refs/heads/$Branch" -Body @{
    sha   = $newCommit
    force = $false
}

Write-Host ""
Write-Host "DONE. https://github.com/$Owner/$Repo/commit/$newCommit" -ForegroundColor Green

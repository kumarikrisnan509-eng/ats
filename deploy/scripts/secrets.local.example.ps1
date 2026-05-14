# SAMPLE FILE -- do NOT commit secrets.local.ps1 itself (it is gitignored).
#
# Copy this file to deploy\scripts\secrets.local.ps1, fill in real values,
# and any deploy-*.ps1 script that sources it will use those instead of the
# hardcoded fallback.
#
#   Copy-Item deploy\scripts\secrets.local.example.ps1 deploy\scripts\secrets.local.ps1
#   notepad deploy\scripts\secrets.local.ps1

$RepoOwner = "mohanapriya63085"
$Pat       = "ghp_PUT_YOUR_REPO_PAT_HERE"
$GhcrPat   = "ghp_PUT_YOUR_GHCR_PULL_PAT_HERE"

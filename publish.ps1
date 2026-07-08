<#
  publish.ps1  -  One-command publish/update for the traverse widget repo.

  1. Pulls the latest from GitHub.
  2. Copies the widget source from the gis-dev repo into this repo's
     traverse/ subfolder (skips node_modules).
  3. Commits and pushes.
  4. (Optional) Pushes a version tag. The Release GitHub Action then builds
     traverse.zip and cuts the release automatically, so the GitHub CLI is
     not needed on this machine.

  RUN (from a terminal opened in this repo folder):
    Normal update:            powershell -ExecutionPolicy Bypass -File .\publish.ps1
    Update + release v1.0.0:  powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Release v1.0.0
#>

param(
    [string]$Release = "",
    [string]$CommitMessage = "Update widget ($(Get-Date -Format 'yyyy-MM-dd'))",
    [string]$SourcePath = "$env:USERPROFILE\Documents\gis-dev\experience-builder\traverse"
)

$ErrorActionPreference = "Stop"

$RepoPath   = $PSScriptRoot
$WidgetDest = Join-Path $RepoPath "traverse"

Write-Host "==> Repo:   $RepoPath"
Write-Host "==> Source: $SourcePath"

if (-not (Test-Path $SourcePath)) {
    throw "Cannot find the widget source at:`n  $SourcePath`nPass -SourcePath or edit the default in publish.ps1."
}

Push-Location $RepoPath
try {
    Write-Host "`n==> Pulling latest from GitHub..."
    git pull

    Write-Host "`n==> Syncing widget files (skipping node_modules)..."
    robocopy "$SourcePath" "$WidgetDest" /MIR /XD "node_modules" ".vs" /XF "*.user" "*.suo" /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
    Write-Host "    Done."

    git add -A | Out-Null
    $pending = git status --porcelain
    if ([string]::IsNullOrWhiteSpace($pending)) {
        Write-Host "`n==> No changes to commit."
    } else {
        Write-Host "`n==> Committing: $CommitMessage"
        git commit -m "$CommitMessage" | Out-Null
        Write-Host "`n==> Pushing to GitHub..."
        git push
    }

    if ($Release -ne "") {
        Write-Host "`n==> Tagging $Release (the Release GitHub Action builds the zip and cuts the release)..."
        git tag $Release
        git push origin $Release
    }

    Write-Host "`n==> Finished."
}
finally {
    Pop-Location
}

# prep-demo.ps1 -- one command to stage the machine for the Loom take.
#
# What it does (maps to RECORDING_PLAN.md section 1):
#   1. Preflight: Node present, deps installed.
#   2. Free port 4000 (kills a stale server so the take never hits "port busy").
#   3. Start `npm run dev` in a minimized window (the terminal never appears on camera).
#   4. Wait until http://localhost:4000 answers.
#   5. POST /reset -- pristine slate. This WIPES run memory (runs.json), so the
#      on-camera Act 1 build IS run one and the Act 3 relaunch IS run two, which
#      is exactly what the memory beat needs. Use the SAME niche answer both
#      times: `trending sneakers, 3 products`.
#   6. Open the three tabs in order: intro card, dashboard, outro card.
#
# It does NOT record -- you drive Loom yourself per RECORDING_PLAN.md sections 2-3.
# Re-runnable: safe to run again between takes to get back to a clean slate.

$ErrorActionPreference = 'Stop'

$Port     = if ($env:DASHBOARD_PORT) { $env:DASHBOARD_PORT } else { 4000 }
$Base     = "http://localhost:$Port"
$VideoDir = $PSScriptRoot
$Repo     = (Resolve-Path (Join-Path $VideoDir '..\..')).Path
$Intro    = Join-Path $VideoDir 'intro-card.html'
$Outro    = Join-Path $VideoDir 'outro-card.html'

Write-Host "== Agent-Maker demo prep ==" -ForegroundColor Cyan
Write-Host "repo=$Repo  port=$Port"

# 1. Preflight -------------------------------------------------------------
try { $null = & node --version } catch { throw "Node not found. Install Node 20+ from https://nodejs.org" }
if (-not (Test-Path (Join-Path $Repo 'node_modules'))) {
    Write-Host "node_modules missing -> npm install" -ForegroundColor Yellow
    Push-Location $Repo; npm install; Pop-Location
}

# 2. Free the port ---------------------------------------------------------
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "Port $Port busy -> stopping PID(s): $($busy.OwningProcess -join ', ')" -ForegroundColor Yellow
    $busy.OwningProcess | Select-Object -Unique | ForEach-Object {
        try { Stop-Process -Id $_ -Force -ErrorAction Stop } catch {}
    }
    Start-Sleep -Seconds 1
}

# 3. Start the server (minimized, off camera) ------------------------------
Write-Host "Starting server: npm run dev (minimized)..." -ForegroundColor Green
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile','-NoExit','-Command',"Set-Location `"$Repo`"; npm run dev" `
    -WindowStyle Minimized | Out-Null

# 4. Wait for it to answer -------------------------------------------------
Write-Host -NoNewline "Waiting for $Base "
$up = $false
foreach ($i in 1..40) {
    try {
        $r = Invoke-WebRequest -Uri $Base -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch { Start-Sleep -Milliseconds 750; Write-Host -NoNewline '.' }
}
Write-Host ''
if (-not $up) { throw "Server did not come up on $Base. Check the minimized 'npm run dev' window for errors." }
Write-Host "Server up." -ForegroundColor Green

# 5. Pristine slate (wipes run memory so Act 3 speedup is genuine) ---------
try {
    Invoke-RestMethod -Uri "$Base/reset" -Method Post -TimeoutSec 5 | Out-Null
    Write-Host "Reset done -- run memory wiped, org chart clean." -ForegroundColor Green
} catch {
    Write-Host "WARN: /reset failed ($($_.Exception.Message)). Click 'Reset demo' on the dashboard by hand (two clicks)." -ForegroundColor Yellow
}

# 6. Open the three tabs, in order -----------------------------------------
Write-Host "Opening tabs: intro card -> dashboard -> outro card" -ForegroundColor Green
if (Test-Path $Intro) { Start-Process $Intro; Start-Sleep -Milliseconds 400 }
Start-Process $Base;  Start-Sleep -Milliseconds 400
if (Test-Path $Outro) { Start-Process $Outro }

Write-Host ''
Write-Host "READY. Next (RECORDING_PLAN.md):" -ForegroundColor Cyan
Write-Host "  - Reorder tabs to: intro | dashboard | outro. Hide bookmarks (Ctrl+Shift+B). Zoom dashboard ~110-125%."
Write-Host "  - Do Not Disturb ON, other apps closed, plugged in."
Write-Host "  - Niche answer, both runs, verbatim: 'trending sneakers, 3 products'"
Write-Host "  - Dry-run once off camera, then record in Loom (Screen only, entire screen)."

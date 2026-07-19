# run-submission-review.ps1
# Fires at 04:30 local time via Task Scheduler. Runs Claude headless to review the
# hackathon submission checklist and generate artifacts / scripts / instructions.
# Durable: Task Scheduler wakes the machine (WakeToRun). This script tolerates a
# just-woken machine by giving the network/npm shims a moment to settle.

$ErrorActionPreference = 'Stop'

$Project = 'C:\Users\skyei\hackathon\agent-maker'
$Shared  = Join-Path $Project 'shared\submission'
$LogDir  = Join-Path $Project 'shared\submission\_logs'
$Claude  = 'C:\Users\skyei\AppData\Roaming\npm\claude.cmd'

New-Item -ItemType Directory -Force -Path $Shared | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log   = Join-Path $LogDir "run-$stamp.log"

function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    $line | Tee-Object -FilePath $log -Append | Out-Null
}

Log "=== submission-review start ==="
Log "project=$Project"
Log "shared=$Shared"

# Machine may have just woken from sleep. Wait briefly for things to settle.
Start-Sleep -Seconds 20

# Sanity checks
if (-not (Test-Path $Claude)) { Log "FATAL: claude not found at $Claude"; exit 1 }
if (-not (Test-Path (Join-Path $Project 'docs\Hackathon_Docs.md'))) {
    Log "WARN: docs\Hackathon_Docs.md not found under project"
}

Set-Location $Project

$prompt = @"
Review docs/Hackathon_Docs.md submission checklist and create any necessary artifacts.
For video or human-required things (recording a demo video, uploading to the website,
filling web forms, anything a person must do), do NOT try to do them yourself. Instead
write a clear script or step-by-step instructions to do them, and make each instruction
map to the exact required action on the submission website.
Save everything you produce (artifacts, scripts, instruction docs) into this shared folder:
$Shared
Start by writing a SUBMISSION_STATUS.md in that folder summarizing what is done, what is
still needed, and where each generated file lives.
"@

Log "invoking claude (headless, acceptEdits)"

# Headless run. --permission-mode acceptEdits: auto-approves file writes into the
# workspace so artifacts/scripts get created unattended, but bash/other tools still
# need approval -- which simply fails (no hang) with nobody there to answer. Keeps
# the blast radius to file writes only.
try {
    & $Claude -p $prompt --permission-mode acceptEdits *>&1 |
        Tee-Object -FilePath $log -Append
    $code = $LASTEXITCODE
    Log "claude exited code=$code"
} catch {
    Log "ERROR: $($_.Exception.Message)"
    exit 1
}

Log "=== submission-review done ==="

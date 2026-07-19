# register-submission-task.ps1
# Registers a Windows Scheduled Task that runs run-submission-review.ps1 at 04:30
# local time every day, and is as durable as possible against sleep.
# Run once. Re-running safely replaces the existing task.

$ErrorActionPreference = 'Stop'

$TaskName = 'HackathonSubmissionReview'
$Runner   = 'C:\Users\skyei\hackathon\agent-maker\scripts\scheduled\run-submission-review.ps1'

if (-not (Test-Path $Runner)) { throw "Runner not found: $Runner" }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Runner`""

# 04:30 local time, every day.
$trigger = New-ScheduledTaskTrigger -Daily -At 4:30AM

# Durability: wake the machine from sleep, run if the scheduled moment was missed
# (e.g. machine was off/hibernating past 04:30), and don't let battery state block it.
$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew

# Run as the current user, only when logged on (works while session is locked).
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Runs Claude at 04:30 to review hackathon submission checklist and generate artifacts/scripts into shared folder.' `
    -Force | Out-Null

Write-Host "Registered task '$TaskName'."
Write-Host "Next run:"
Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo |
    Select-Object NextRunTime, LastRunTime, LastTaskResult | Format-List

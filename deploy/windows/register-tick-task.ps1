# Registers a Windows Scheduled Task that runs `npm run tick` every 30
# minutes — the Windows equivalent of deploy/systemd/yahngorithm-tick.timer.
# tick.ts's own scheduling logic (which groups are due, the quiet window,
# Saturday's tighter cadence) is unchanged; this just invokes it locally
# on a timer instead of over HTTP from GitHub Actions.
#
# Run from an elevated (Administrator) PowerShell prompt:
#   cd C:\path\to\the-yahngorithm
#   .\deploy\windows\register-tick-task.ps1
#
# Re-run any time to update the task (it recreates it).

$ErrorActionPreference = "Stop"

$RepoPath = (Get-Location).Path
# Avoid the ?. null-conditional operator — it needs PowerShell 7+, and
# Windows PowerShell 5.1 (still the default on most Windows installs) would
# fail to even parse this file with it.
$NpmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCmd) {
  Write-Error "npm.cmd not found on PATH. Install Node.js first (https://nodejs.org), then re-run this from a fresh terminal."
  exit 1
}
$NpmPath = $NpmCmd.Source

$TaskName = "yahngorithm-tick"
$Action = New-ScheduledTaskAction -Execute $NpmPath -Argument "run tick" -WorkingDirectory $RepoPath
# 10 years, not [TimeSpan]::MaxValue — the ScheduledTasks module has choked
# on the true max value in practice; this is the commonly-recommended safe
# stand-in for "repeat indefinitely."
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 25) `
  -MultipleInstances IgnoreNew

# LogonType S4U = "run whether user is logged on or not," without storing a
# password (unlike LogonType Password) — no prompt, just needs this account
# to have the "Log on as a batch job" right, which a normal admin/standard
# Windows account already has by default.
$Principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType S4U -RunLevel Limited

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal `
  -Description "the yahngorithm — scheduler tick (npm run tick), every 30 min"

Write-Host "Registered '$TaskName'. Check it:"
Write-Host "  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "  Start-ScheduledTask -TaskName $TaskName   # run one now to test"
Write-Host "Logs: Event Viewer -> Task Scheduler Library, or redirect npm's own output by wrapping the command in a .bat that appends to a log file if you want persistent logs."

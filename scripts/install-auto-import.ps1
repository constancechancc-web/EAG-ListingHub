# Creates (or replaces) the Windows scheduled task "EAG Listing Hub - Auto Import":
# runs scripts\auto-import.js every day at 12:00, 16:00 and 21:00 (computer time), as the current user, only when signed in.
# If the computer was off or asleep at that time, it runs as soon as it is available again.
#   powershell -ExecutionPolicy Bypass -File scripts\install-auto-import.ps1            (install)
#   powershell -ExecutionPolicy Bypass -File scripts\install-auto-import.ps1 -Remove    (remove)
param([switch]$Remove)

$taskName = 'EAG Listing Hub - Auto Import'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed: $taskName"
  exit 0
}

$project = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $project 'scripts\auto-import.js'
if (-not (Test-Path (Join-Path $project 'scripts\auto-import.config.json'))) { throw 'Run first: node scripts\auto-import.js --init' }

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $project
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At '12:00'),
  (New-ScheduledTaskTrigger -Daily -At '16:00'),
  (New-ScheduledTaskTrigger -Daily -At '21:00')
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
  -Description 'Imports new WhatsApp exports from the iCloud folder into EAG Listing Hub (12:00, 16:00 and 21:00).' -Force | Out-Null
$t = Get-ScheduledTask -TaskName $taskName
Write-Output "Installed: $taskName"
Write-Output ("State: {0}; next run: {1}" -f $t.State, (Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime)

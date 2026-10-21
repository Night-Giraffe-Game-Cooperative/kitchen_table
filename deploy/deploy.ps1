# Puts Kitchen Table on the VPS from this PC, over SSH.
#
# The first time, with the VPS's address and the web address pointing at it:
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@203.0.113.10 -Domain family.example.co.uk -FirstTime
#
# After that, to put the newest release on:
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@203.0.113.10
#
# To copy the nightly backups to this PC (into Documents\Kitchen Table backups,
# or -BackupDir), only the nights it hasn't got, keeping the newest -Keep here:
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@203.0.113.10 -FetchBackups
#
# To have this PC do that every evening (or when it's next switched on):
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@203.0.113.10 -ScheduleBackups
#
# Releases are built by GitHub (the Release workflow, when a v* tag is pushed)
# and fetched with the gh command from this checkout's GitHub repository, or
# -Repo owner/name. -Release picks one; the newest is the default.

param(
    [Parameter(Mandatory)] [string]$Server,
    [string]$Domain,
    [switch]$FirstTime,
    [string]$Release,
    [string]$Repo,
    [switch]$FetchBackups,
    [switch]$ScheduleBackups,
    [string]$BackupDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Kitchen Table backups'),
    [ValidateRange(1, 365)] [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $Repo) {
    $origin = git -C $here remote get-url origin 2>$null
    if ($origin -match 'github\.com[:/](.+?)(\.git)?$') { $Repo = $Matches[1] }
}
$ssh = @('-o', 'StrictHostKeyChecking=accept-new')

function Run($what, [scriptblock]$block) {
    Write-Host "== $what" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed." }
}

if ($FetchBackups) {
    New-Item -ItemType Directory -Force $BackupDir | Out-Null
    # Each night's backup holds every photo, so only the new nights come over.
    $there = @(ssh @ssh $Server 'ls -1 /var/backups/kitchen-table')
    if ($LASTEXITCODE -ne 0) { throw 'Listing the backups on the VPS failed.' }
    $new = @($there | Where-Object { $_ -match '^kitchen-table-[0-9-]+\.tar\.gz$' -and -not (Test-Path (Join-Path $BackupDir $_)) })
    foreach ($name in $new) {
        $part = Join-Path $BackupDir "$name.part"
        Run "Copying $name" { scp @ssh "${Server}:/var/backups/kitchen-table/$name" $part }
        Move-Item -Force $part (Join-Path $BackupDir $name)
    }
    # The names sort by date, so the oldest past -Keep go.
    Get-ChildItem $BackupDir -Filter 'kitchen-table-*.tar.gz' | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item
    Add-Content (Join-Path $BackupDir 'copied.txt') "$(Get-Date -Format 'yyyy-MM-dd HH:mm')  $($new.Count) new"
    Write-Host "$($new.Count) new. The backups are in $BackupDir" -ForegroundColor Green
    exit 0
}

if ($ScheduleBackups) {
    # It runs as you, with your SSH key, whenever you're signed in to the PC.
    $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Server $Server -FetchBackups -BackupDir `"$BackupDir`" -Keep $Keep"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Daily -At '9pm'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName 'Kitchen Table backups' -Action $action -Trigger $trigger -Settings $settings -Force `
        -Description 'Copies the new nightly Kitchen Table backups from the VPS to this PC.' | Out-Null
    Write-Host "Every evening at 9pm (or when the PC is next on), new backups will be copied to $BackupDir." -ForegroundColor Green
    Write-Host "To stop it: Unregister-ScheduledTask -TaskName 'Kitchen Table backups'"
    exit 0
}

if ($FirstTime -and -not $Domain) {
    Write-Host 'The first time needs -Domain, the web address (like family.example.co.uk).' -ForegroundColor Red
    exit 1
}
foreach ($tool in 'ssh', 'scp', 'gh') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "Can't find '$tool'." -ForegroundColor Red
        exit 1
    }
}

$work = Join-Path ([IO.Path]::GetTempPath()) "kitchen-table-deploy"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $work | Out-Null

# Built up with += so a single tag stays one argument. Windows PowerShell 5.1
# unwraps an if-expression's array, and -Release v0.2.0 reached gh as six
# arguments.
$which = @()
if ($Release) { $which += $Release }
if (-not $Repo) {
    Write-Host "Can't tell which GitHub repository the releases are in. Pass -Repo owner/name." -ForegroundColor Red
    exit 1
}
Run 'Fetching the release from GitHub' {
    gh release download @which --repo $Repo --pattern 'kitchen-table-*.tar.gz' --dir $work
}
$tarball = Get-ChildItem $work -Filter 'kitchen-table-*.tar.gz' | Select-Object -First 1
# The scripts go over with Unix line endings, whatever Git did to them here.
foreach ($script in Get-ChildItem $here -Filter '*.sh') {
    $text = [IO.File]::ReadAllText($script.FullName) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $work $script.Name), $text, (New-Object Text.UTF8Encoding $false))
}

$remote = '/root/kitchen-table-deploy'
Run 'Copying it to the VPS' {
    ssh @ssh $Server "rm -rf $remote"
    scp @ssh -r $work "${Server}:/root/"
}

if ($FirstTime) {
    Run "Setting up the VPS for https://$Domain" { ssh @ssh $Server "bash $remote/setup-vps.sh $Domain" }
}
Run "Installing $($tarball.Name)" { ssh @ssh $Server "bash $remote/install-release.sh $remote/$($tarball.Name)" }
Write-Host 'Kitchen Table is running on the VPS.' -ForegroundColor Green

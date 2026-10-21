# Starts Kitchen Table on this Windows PC.
#
# Builds the web app, sets up the server the first time, then runs it on
# http://localhost:4000, and on https://<this PC's address>:4443 for the
# tablets and phones on the home Wi-Fi (the camera needs a secure address).
# Stop it with Ctrl+C.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
#
# Needs Erlang/OTP 26 or newer, Elixir 1.17 or newer and Node 20 or newer.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { '4000' }

foreach ($tool in 'erl', 'mix', 'node', 'npm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "Can't find '$tool'. Install Erlang and Elixir (https://elixir-lang.org/install.html#windows) and Node (https://nodejs.org), then open a new PowerShell window." -ForegroundColor Red
        exit 1
    }
}

function Run($what, $dir, [scriptblock]$block) {
    Write-Host "== $what" -ForegroundColor Cyan
    Push-Location (Join-Path $root $dir)
    try {
        & $block
        if ($LASTEXITCODE -ne 0) { throw "$what failed." }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $root 'web\node_modules'))) {
    Run 'Installing the web app''s packages' 'web' { npm ci }
}
Run 'Building the web app' 'web' { npm run build }

if (-not (Test-Path (Join-Path $root 'server\deps'))) {
    Run 'Fetching the server''s packages' 'server' { mix deps.get }
}
Run 'Getting the database ready' 'server' { mix do ecto.create --quiet + ecto.migrate --quiet }

Write-Host ''
Write-Host "Kitchen Table is starting. Open http://localhost:$port on this PC." -ForegroundColor Green
$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -in 'Dhcp', 'Manual' -and $_.InterfaceAlias -notlike 'vEthernet*' }
$https = if ($env:HTTPS_PORT) { $env:HTTPS_PORT } else { '4443' }
foreach ($a in $addresses) {
    if ($https -eq 'off') {
        Write-Host "On a tablet or phone on the same Wi-Fi: http://$($a.IPAddress):$port  ($($a.InterfaceAlias))" -ForegroundColor Green
    } else {
        Write-Host "On a tablet or phone on the same Wi-Fi: https://$($a.IPAddress):$https  ($($a.InterfaceAlias))" -ForegroundColor Green
    }
}
if ($https -ne 'off') {
    Write-Host 'Tablets and phones need the https address for the camera in video calls. The first time, the'
    Write-Host 'browser warns that the connection is not private: choose Advanced, then Continue. It is your own PC.'
}
Write-Host "If Windows asks whether to let Erlang through the firewall, allow it on private networks (ports $port and $https)."
Write-Host ''

Run 'Running the server (Ctrl+C to stop)' 'server' { mix phx.server }

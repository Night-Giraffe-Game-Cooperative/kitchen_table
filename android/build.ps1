# Builds the Kitchen Table app for Android tablets and phones: a small app that
# opens Kitchen Table on this PC full screen, for home screens (like a kids'
# launcher) that won't take a browser shortcut. It asks for the camera and
# microphone itself and trusts this PC's home-made certificate.
#
#   powershell -ExecutionPolicy Bypass -File android\build.ps1
#   powershell -ExecutionPolicy Bypass -File android\build.ps1 -Install
#   powershell -ExecutionPolicy Bypass -File android\build.ps1 -Install -Serial <adb serial>
#   powershell -ExecutionPolicy Bypass -File android\build.ps1 -Address https://192.168.1.20:4443
#
# The app is android\build\KitchenTable.apk. -Install puts it on the tablet
# plugged in over USB (USB debugging on). The address can be changed in the
# app later, on the screen it shows when it can't reach the PC.
#
# Needs the Android SDK (build-tools, a platform and platform-tools) and JDK 17:
# ANDROID_HOME and JAVA_HOME, or where Android Studio puts them. It signs with
# the SDK folder's debug.keystore if there is one, otherwise the usual
# ~\.android\debug.keystore, which it makes the first time if need be. Keep the
# same keystore, so a new build installs over the old one.

param(
    [string]$Address,
    [switch]$Install,
    [string]$Serial,
    [string]$Sdk = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }),
    [string]$Keystore
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out = Join-Path $here 'build'

function Run($what, [scriptblock]$block) {
    Write-Host "== $what" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed." }
}

function Newest($dir, $filter) {
    Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Where-Object $filter |
        Sort-Object { if ($_.Name -match '(\d+)(\.(\d+))?') { [int]$Matches[1] * 1000 + [int]$Matches[3] } else { 0 } } -Descending |
        Select-Object -First 1
}

# The tools
$buildTools = Newest (Join-Path $Sdk 'build-tools') { Test-Path (Join-Path $_.FullName 'aapt2.exe') }
$platform = Newest (Join-Path $Sdk 'platforms') { Test-Path (Join-Path $_.FullName 'android.jar') }
if (-not $buildTools -or -not $platform) {
    Write-Host "Can't find the Android SDK's build-tools and a platform in $Sdk. Set ANDROID_HOME or pass -Sdk." -ForegroundColor Red
    exit 1
}
$androidJar = Join-Path $platform.FullName 'android.jar'
$aapt2 = Join-Path $buildTools.FullName 'aapt2.exe'
$d8 = Join-Path $buildTools.FullName 'd8.bat'
$zipalign = Join-Path $buildTools.FullName 'zipalign.exe'
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$adb = Join-Path $Sdk 'platform-tools\adb.exe'

$studioJdk = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
$jdk = @($env:JAVA_HOME, (Join-Path $Sdk 'jdk-17'), $studioJdk) + @(Get-ChildItem $Sdk -Directory -Filter 'jdk*' -ErrorAction SilentlyContinue | ForEach-Object FullName) |
    Where-Object { $_ -and (Test-Path (Join-Path $_ 'bin\javac.exe')) } | Select-Object -First 1
if (-not $jdk) {
    Write-Host "Can't find a JDK (javac.exe). Set JAVA_HOME to JDK 17." -ForegroundColor Red
    exit 1
}
$env:JAVA_HOME = $jdk
$env:Path = (Join-Path $jdk 'bin') + ';' + $env:Path
if (-not $Keystore) {
    $Keystore = Join-Path $Sdk 'debug.keystore'
    if (-not (Test-Path $Keystore)) { $Keystore = Join-Path $env:USERPROFILE '.android\debug.keystore' }
}
if (-not (Test-Path $Keystore)) {
    # The same debug keystore Android Studio would make.
    New-Item -ItemType Directory -Force (Split-Path $Keystore) | Out-Null
    Run 'Make a debug keystore' { & (Join-Path $jdk 'bin\keytool.exe') -genkeypair -keystore $Keystore -storepass android -keypass android -alias androiddebugkey -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 10000 }
}

# Where Kitchen Table is: this PC's address on the home network, as start.ps1 prints it
if (-not $Address) {
    $https = if ($env:HTTPS_PORT) { $env:HTTPS_PORT } else { '4443' }
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -in 'Dhcp', 'Manual' -and $_.InterfaceAlias -notlike 'vEthernet*' } |
        Select-Object -First 1
    if (-not $ip) {
        Write-Host "Can't work out this PC's address on the home network. Pass -Address https://<address>:$https." -ForegroundColor Red
        exit 1
    }
    $Address = "https://$($ip.IPAddress):$https"
}
Write-Host "The app will open $Address ($($platform.Name), build-tools $($buildTools.Name))" -ForegroundColor Green

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $out 'classes'), (Join-Path $out 'dex') | Out-Null
$manifest = (Get-Content (Join-Path $here 'AndroidManifest.xml') -Raw).Replace('@HOME@', [Security.SecurityElement]::Escape($Address))
[IO.File]::WriteAllText((Join-Path $out 'AndroidManifest.xml'), $manifest, (New-Object Text.UTF8Encoding $false))

Run 'Compiling the pictures and colours' { & $aapt2 compile --dir (Join-Path $here 'res') -o (Join-Path $out 'res.zip') }
Run 'Linking the app' {
    & $aapt2 link -I $androidJar --manifest (Join-Path $out 'AndroidManifest.xml') --auto-add-overlay `
        -o (Join-Path $out 'unsigned.apk') (Join-Path $out 'res.zip')
}
$sources = Get-ChildItem (Join-Path $here 'src') -Recurse -Filter *.java | ForEach-Object FullName
Run 'Compiling the code' {
    & (Join-Path $jdk 'bin\javac.exe') -encoding UTF-8 -source 8 -target 8 -Xlint:-options -nowarn `
        -bootclasspath $androidJar -classpath (Join-Path $buildTools.FullName 'core-lambda-stubs.jar') `
        -d (Join-Path $out 'classes') $sources
}
$classes = Get-ChildItem (Join-Path $out 'classes') -Recurse -Filter *.class | ForEach-Object FullName
Run 'Converting it for Android' { & $d8 --release --lib $androidJar --min-api 26 --output (Join-Path $out 'dex') $classes }

# Put the code in the app. Entries already there keep their compression, so
# resources.arsc stays stored as Android 11 and later require.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open((Join-Path $out 'unsigned.apk'), 'Update')
try {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $out 'dex\classes.dex'), 'classes.dex') | Out-Null
} finally {
    $zip.Dispose()
}

Run 'Aligning' { & $zipalign -f -p 4 (Join-Path $out 'unsigned.apk') (Join-Path $out 'aligned.apk') }
$apk = Join-Path $out 'KitchenTable.apk'
Run 'Signing' {
    & $apksigner sign --ks $Keystore --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android `
        --out $apk (Join-Path $out 'aligned.apk')
}
Write-Host "Built $apk" -ForegroundColor Green

if ($Install) {
    $device = if ($Serial) { @('-s', $Serial) } else { @() }
    Run 'Installing on the tablet' { & $adb @device install -r $apk }
    Write-Host 'Installed. Kitchen Table is in the tablet''s apps; with parental controls, allow it there first.' -ForegroundColor Green
}

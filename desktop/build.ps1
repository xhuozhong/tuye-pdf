param(
    [string] $SdkDir,
    [string] $OutputName = 'TuYePdf-win-x64.exe'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo 'dist'
$version = '1.0.3912.50'
if ([IO.Path]::GetFileName($OutputName) -ne $OutputName -or $OutputName -notlike '*.exe') {
    throw 'OutputName must be an .exe filename.'
}

if (-not $SdkDir) {
    $cache = Join-Path $PSScriptRoot '.sdk'
    $SdkDir = Join-Path $cache $version
    $archive = Join-Path $cache "webview2-$version.zip"
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    if (-not (Test-Path -LiteralPath $archive)) {
        $url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg"
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
    }
    $expectedHash = '8DD696301D8E5AD8389F26B636329BBF35754B793974E82168B1F6DDA234EB07'
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
        throw "WebView2 SDK archive hash mismatch: $archive"
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $SdkDir -Force
}

$sdkFiles = @{
    'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'BB397D03342C76BD308ADE82F5B7E8CED00DF59459799FFC93A38C3A882B3398'
    'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'DAAE92CDDA7E8BA51F86B27ED6EFEE9D0C7256FC04D0E91C17B2708D75B7A2B1'
    'runtimes/win-x64/native/WebView2Loader.dll' = '1AC87267E52CCDF5621678697F948030307A650CA56F38F69E74C7CFAF9605C6'
}
foreach ($file in $sdkFiles.Keys) {
    $component = Join-Path $SdkDir $file
    if ((Get-FileHash -LiteralPath $component -Algorithm SHA256).Hash -ne $sdkFiles[$file]) {
        throw "Unexpected WebView2 SDK component: $component"
    }
}

& node (Join-Path $repo 'src/build.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
& node (Join-Path $PSScriptRoot 'build-page.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop page build failed.' }

$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$core = Join-Path $SdkDir 'lib/net462/Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $SdkDir 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'
$loader = Join-Path $SdkDir 'runtimes/win-x64/native/WebView2Loader.dll'
$destination = Join-Path $dist $OutputName
$cscArgs = @(
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
    "/reference:$core", "/reference:$forms",
    "/resource:$core,Microsoft.Web.WebView2.Core.dll",
    "/resource:$forms,Microsoft.Web.WebView2.WinForms.dll",
    "/resource:$loader,WebView2Loader.dll",
    "/resource:$(Join-Path $PSScriptRoot 'desktop.html'),desktop.html",
    "/win32icon:$(Join-Path $PSScriptRoot 'tuye.ico')",
    "/win32manifest:$(Join-Path $PSScriptRoot 'desktop.manifest')",
    "/out:$destination", (Join-Path $PSScriptRoot 'Program.cs')
)
& $compiler @cscArgs
if ($LASTEXITCODE -ne 0) { throw 'Windows executable build failed.' }
Get-FileHash -LiteralPath $destination -Algorithm SHA256

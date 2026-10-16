param([string]$OutputDirectory = 'client/msvc-x86-runtime')
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -version '[17.0,18.0)' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Visual Studio 2022 x86 redistributable source was not found' }
$redistRoot = Join-Path $installation 'VC/Redist/MSVC'
$version = Get-ChildItem $redistRoot -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'x86/Microsoft.VC143.CRT') } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $version) { throw 'The genuine Microsoft VC143 x86 app-local CRT payload was not found' }
$source = Join-Path $version.FullName 'x86/Microsoft.VC143.CRT'
$files = @(Get-ChildItem $source -File -Filter '*.dll' | Sort-Object Name)
foreach ($required in @('msvcp140.dll', 'vcruntime140.dll')) {
    if (-not ($files | Where-Object Name -eq $required)) { throw "Redistributable payload omits $required" }
}
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$provenance = [ordered]@{
    architecture = 'x86'
    deployment = 'Microsoft app-local VC143 redistributable; no system DLL replacement or registry install'
    source = "Visual Studio 2022/VC/Redist/MSVC/$($version.Name)/x86/Microsoft.VC143.CRT"
    minimumWindows = 'Windows 10 (system UCRT and API sets remain OS-owned)'
    files = @()
}
foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature $file.FullName
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
        throw "Redistributable signature is not valid Microsoft code signing: $($file.Name) ($($signature.Status))"
    }
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    if ([BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x4550 -or [BitConverter]::ToUInt16($bytes, $peOffset + 4) -ne 0x014c) {
        throw "Redistributable is not a real PE32 x86 image: $($file.Name)"
    }
    $destination = Join-Path $OutputDirectory $file.Name.ToLowerInvariant()
    Copy-Item $file.FullName $destination
    $provenance.files += [ordered]@{
        name = $file.Name.ToLowerInvariant()
        size = $file.Length
        sha256 = (Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        fileVersion = $file.VersionInfo.FileVersion
        signer = $signature.SignerCertificate.Subject
        signerThumbprint = $signature.SignerCertificate.Thumbprint
    }
}
$provenance | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $OutputDirectory 'msvc-runtime-provenance.json') -Encoding utf8NoBOM
$provenance | ConvertTo-Json -Depth 6 | Write-Output

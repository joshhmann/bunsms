param(
    [Parameter(Mandatory)][uri]$BaselineUrl,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$BaselineSha256,
    [Parameter(Mandatory)][uri]$BaselineFilesBaseUrl,
    [Parameter(Mandatory)][string]$KaentakeArtifact,
    [Parameter(Mandatory)][string]$CompanionArtifact,
    [string]$OutputDirectory = 'native-smoke-output',
    [ValidateRange(30, 180)][int]$ObserveSeconds = 90,
    [string]$GameHost = 'buns.asslorde.com'
)
$ErrorActionPreference = 'Stop'
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$report = [ordered]@{
    startedUtc = [DateTime]::UtcNow.ToString('O'); runner = $env:RUNNER_NAME
    baselineUrl = $BaselineUrl.AbsoluteUri; baselineSha256 = $BaselineSha256.ToLowerInvariant()
    baselineFilesBaseUrl = $BaselineFilesBaseUrl.AbsoluteUri
    observeSeconds = $ObserveSeconds; gameHost = $GameHost
    status = 'not-completed'; nativeUiObserved = $false; initializeSuccessObserved = $false
    capsAckObserved = $false; snapshots = [Collections.Generic.List[object]]::new()
    controlledStops = [Collections.Generic.List[object]]::new()
}
$script:snapshotIndex = 0


function Save-Screenshot([int]$X, [int]$Y, [int]$Width, [int]$Height, [string]$Path) {
    if ($Width -le 0 -or $Height -le 0) { throw 'Window has no drawable client area' }
    $bitmap = [Drawing.Bitmap]::new($Width, $Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($X, $Y, 0, 0, $bitmap.Size)
        $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
        $colors = [Collections.Generic.HashSet[int]]::new()
        $nonBlack = 0; $samples = 0
        for ($y = 0; $y -lt $Height; $y += 8) {
            for ($x = 0; $x -lt $Width; $x += 8) {
                $pixel = $bitmap.GetPixel($x, $y)
                [void]$colors.Add($pixel.ToArgb())
                if ($pixel.R -gt 12 -or $pixel.G -gt 12 -or $pixel.B -gt 12) { $nonBlack++ }
                $samples++
            }
        }
        return [pscustomobject]@{ file = $Path; sampledColors = $colors.Count; nonBlackSamples = $nonBlack; samples = $samples
            visualContent = ($colors.Count -gt 16 -and $nonBlack -gt ($samples / 100)) }
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

function Save-NativeSnapshot([int[]]$Ids) {
    $script:snapshotIndex++
    $prefix = Join-Path $OutputDirectory ('snapshot-{0:D2}' -f $script:snapshotIndex)
    $row = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); processIds = $Ids; windows = @([NativeSmoke]::Windows($Ids))
        processes = @(); screenshots = @(); errors = @() }
    foreach ($processId in $Ids) {
        try {
            $process = Get-Process -Id $processId -ErrorAction Stop
            $row.processes += [pscustomobject]@{ id = $processId; name = $process.ProcessName; alive = -not $process.HasExited
                modules = @($process.Modules | ForEach-Object { [pscustomobject]@{ name = $_.ModuleName; path = $_.FileName; base = ('0x{0:X}' -f $_.BaseAddress.ToInt64()) } }) }
        } catch { $row.processes += [pscustomobject]@{ id = $processId; observationError = $_.Exception.Message } }
    }
    try {
        $desktop = [Windows.Forms.SystemInformation]::VirtualScreen
        [void](Save-Screenshot $desktop.X $desktop.Y $desktop.Width $desktop.Height "$prefix-desktop.png")
    } catch { $row.errors += "Desktop screenshot: $($_.Exception.Message)" }
    foreach ($window in $row.windows) {
        if (-not $window.Visible -or $window.Class -ne 'MapleStoryClass') { continue }
        try {
            $shot = Save-Screenshot $window.ClientX $window.ClientY $window.ClientWidth $window.ClientHeight "$prefix-$($window.Handle)-client.png"
            $row.screenshots += $shot
        } catch { $row.errors += "Window $($window.Handle): $($_.Exception.Message)" }
    }
    $report.snapshots.Add([pscustomobject]$row)
    $row | ConvertTo-Json -Depth 15 | Set-Content "$prefix.json"
    if (-not $report.compatibilityAction) {
        $action = [NativeSmoke]::ContinueCompatibilityPrompt($Ids)
        if ($action) {
            $report.compatibilityAction = [pscustomobject]@{ utc = [DateTime]::UtcNow.ToString('O'); action = $action
                reason = 'Invoke the visible normal Windows Run button once; no registry, signature guard, or compatibility policy is changed' }
        }
    }
}

try {
    $report.publicAccess = 'Activation deferred by user; unchanged public ports are not re-probed'
    if ($BaselineUrl.Scheme -ne 'https' -or $BaselineFilesBaseUrl.Scheme -ne 'https') {
        throw 'Native baseline provenance and bytes must use explicit SHA256-pinned HTTPS URLs'
    }
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -Path (Join-Path $PSScriptRoot 'NativeSmoke.cs')
    $manifestPath = Join-Path $OutputDirectory 'baseline-provenance.json'
    Invoke-WebRequest $BaselineUrl.AbsoluteUri -OutFile $manifestPath -TimeoutSec 60
    $actualSha = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.baselineActualSha256 = $actualSha
    if ($actualSha -ne $BaselineSha256.ToLowerInvariant()) { throw "Baseline provenance SHA256 mismatch: $actualSha" }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if (-not $manifest.files -or $manifest.files.Count -eq 0) { throw 'Native provenance contains no files' }
    $game = Join-Path $OutputDirectory 'baseline'
    New-Item -ItemType Directory -Force $game | Out-Null
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $base = [uri]($BaselineFilesBaseUrl.AbsoluteUri.TrimEnd('/') + '/')
    $verifiedFiles = [Collections.Generic.List[object]]::new()
    foreach ($file in $manifest.files) {
        if (-not $file.name -or $file.sha256 -notmatch '^[0-9a-fA-F]{64}$' -or $file.size -le 0) {
            throw 'Invalid native provenance file record'
        }
        if (-not $names.Add($file.name.Replace('\', '/'))) { throw "Case-colliding native filename: $($file.name)" }
        $destination = [IO.Path]::GetFullPath((Join-Path $game $file.name))
        if (-not $destination.StartsWith($game + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Native filename escapes baseline directory: $($file.name)"
        }
        $encoded = (($file.name.Replace('\', '/') -split '/') | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
        $url = [uri]::new($base, $encoded)
        New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($destination)) | Out-Null
        Invoke-WebRequest $url.AbsoluteUri -OutFile $destination -TimeoutSec 900
        $sha = (Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ((Get-Item $destination).Length -ne $file.size -or $sha -ne $file.sha256.ToLowerInvariant()) {
            throw "Native baseline size/SHA256 mismatch: $($file.name)"
        }
        $verifiedFiles.Add([pscustomobject]@{ name = $file.name; size = $file.size; sha256 = $sha; url = $url.AbsoluteUri })
    }
    $report.verifiedBaselineFiles = $verifiedFiles
    $required = @('MapleStory.exe', 'Canvas.dll', 'Gr2D_DX8.dll', 'PCOM.dll', 'NameSpace.dll', 'ResMan.dll', 'Shape2D.dll',
        'Sound_DX8.dll', 'ijl15.dll', 'bz32ex.dll', 'aossdk.dll', 'l3codeca.acm', 'mss32.dll', 'Base.wz', 'Character.wz',
        'Effect.wz', 'Etc.wz', 'Item.wz', 'List.wz', 'Map.wz', 'Mob.wz', 'Morph.wz', 'Npc.wz', 'Quest.wz', 'Reactor.wz',
        'Skill.wz', 'Sound.wz', 'String.wz', 'TamingMob.wz', 'UI.wz')
    foreach ($file in $required) { if (-not (Test-Path (Join-Path $game $file) -PathType Leaf)) { throw "Incomplete native baseline: missing $file" } }
    if (Test-Path (Join-Path $game 'dinput8.dll')) { throw 'Native baseline contains an unexpected HD/proxy dinput8.dll' }
    $expectedExe = 'ed5a699407b9705528b6a653cdee7395e6e1b7317b9711dcfb34681092072848'
    $expectedRenderer = 'ab1c942229af33da04d913ed1157ab322bff0812f7368bcf745d64b98698d34d'
    foreach ($pin in @{ 'MapleStory.exe' = $expectedExe; 'Gr2D_DX8.dll' = $expectedRenderer }.GetEnumerator()) {
        $sha = (Get-FileHash (Join-Path $game $pin.Key) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($sha -ne $pin.Value) { throw "Unsupported baseline $($pin.Key) SHA256=$sha" }
    }
    $runtime = Join-Path $KaentakeArtifact 'Release'
    foreach ($file in @('Kaentake.exe', 'Kaentake.dll', 'Custom.wz')) { Copy-Item (Join-Path $runtime $file) (Join-Path $game $file) -Force }
    Copy-Item (Join-Path $CompanionArtifact 'BunsMS.dll') (Join-Path $game 'BunsMS.dll') -Force
    "[config]`nhost=$GameHost`nport=8484`n" | Set-Content (Join-Path $game 'config.ini') -Encoding ascii
    $report.gameDirectory = $game
    $report.runtimeProvenance = Get-Content (Join-Path $KaentakeArtifact 'kaentake-build.json') -Raw | ConvertFrom-Json
    $report.diagnosticOnly = [bool]$report.runtimeProvenance.diagnosticOnly
    $report.runtimeFiles = @(foreach ($file in @('MapleStory.exe', 'Gr2D_DX8.dll', 'Kaentake.exe', 'Kaentake.dll', 'Custom.wz', 'BunsMS.dll')) {
        $path = Join-Path $game $file
        [pscustomobject]@{ name = $file; size = (Get-Item $path).Length; sha256 = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $debugLog = Join-Path $OutputDirectory 'native-debug.log'
    $callback = [Action[int[]]]{ param([int[]]$Ids) Save-NativeSnapshot $Ids }
    $report.processIds = [NativeSmoke]::Capture((Join-Path $game 'Kaentake.exe'), $game, $ObserveSeconds, $debugLog, $callback)
    Save-NativeSnapshot ([NativeSmoke]::LastProcessIds)
    $events = Get-Content $debugLog -Raw
    $report.initializeSuccessObserved = $events.Contains('BUNS_RUNTIME initialize-success')
    $report.capsAckObserved = $events.Contains('BUNS_RUNTIME caps-ack ')
    $report.companionModuleObserved = $events -match 'MODULE_OBSERVED .*BunsMS\.dll'
    $report.captureMode = 'normal-process/passive-DBWIN; no debugger attached'
    $report.secondChanceExceptionObserved = $null # Not observable with this passive capture; never claim absence.
    $final = $report.snapshots[$report.snapshots.Count - 1]
    $report.gameAliveAfterObservation = @($final.processes | Where-Object { $_.name -eq 'MapleStory' -and $_.alive }).Count -gt 0
    $report.nativeUiObserved = @($final.screenshots | Where-Object visualContent).Count -gt 0
    $report.errorDialogObserved = @($final.windows | Where-Object { $_.Visible -and $_.Class -eq '#32770' }).Count -gt 0
    if (-not $report.initializeSuccessObserved -or -not $report.companionModuleObserved -or -not $report.nativeUiObserved -or
        -not $report.gameAliveAfterObservation -or $report.errorDialogObserved) {
        throw 'Native startup acceptance not met; inspect actual windows, screenshots, passive process/DBWIN observations, and the deferred public-activation state'
    }
    $report.status = 'native-startup-observed'
} catch {
    $report.status = 'failed'
    $report.error = $_.Exception.ToString()
} finally {
    if ('NativeSmoke' -as [type]) {
        foreach ($processId in [NativeSmoke]::LastProcessIds) {
            try {
                $process = Get-Process -Id $processId -ErrorAction Stop
                if ($process.ProcessName -notin @('Kaentake', 'MapleStory')) {
                    $report.controlledStops.Add([pscustomobject]@{ processId = $processId; observation = 'PID no longer belongs to a launched native executable; not stopped' })
                    continue
                }
                $stop = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); processId = $processId; name = $process.ProcessName
                    reason = 'Smoke controller cleanup after observation/error; not a natural game exit'; controlled = $true }
                Stop-Process -Id $processId -Force -ErrorAction Stop
                $process.WaitForExit(5000) | Out-Null
                if ($process.HasExited) { $stop.exitCode = $process.ExitCode }
                $report.controlledStops.Add([pscustomobject]$stop)
            } catch { $report.controlledStops.Add([pscustomobject]@{ processId = $processId; observation = $_.Exception.Message }) }
        }
    }
    $report.finishedUtc = [DateTime]::UtcNow.ToString('O')
    $report | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $OutputDirectory 'result.json')
    $report | ConvertTo-Json -Depth 5 | Write-Output
}
if ($report.status -eq 'failed') { exit 1 }

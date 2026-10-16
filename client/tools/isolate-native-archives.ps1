param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$GameDirectory,
    [Parameter(Mandatory)][uri]$BaselineUrl,
    [Parameter(Mandatory)][string]$BaselineSha256,
    [Parameter(Mandatory)][uri]$BaselineFilesBaseUrl,
    [Parameter(Mandatory)][string]$KaentakeArtifact,
    [Parameter(Mandatory)][string]$CompanionArtifact,
    [Parameter(Mandatory)][string]$RuntimeArtifact,
    [int]$ObserveSeconds = 90,
    [string]$GameHost = '127.0.0.1'
)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ status = 'running'; sourceCommit = $env:GITHUB_SHA; steps = [Collections.Generic.List[object]]::new()
    scope = 'INTERNAL diagnostic mixtures only. Same exact published runtime/backend/observer; no release, fallback, feature acceptance, new hooks or downloads.' }
$script:archiveTrial = 0
try {
    $manifestPath = Join-Path $OutputDirectory 'baseline-provenance.json'
    if ((Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $BaselineSha256) { throw 'Full manifest authority changed' }
    $referencePath = Join-Path $OutputDirectory 'reference-provenance.json'
    if ((Get-FileHash $referencePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'a23ed4910cc0d19e63d3ce0f625eb5320be93c6807940d75be1440ee46bef810') { throw 'Reference authority changed' }
    $full = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $reference = Get-Content $referencePath -Raw | ConvertFrom-Json
    $deltas = @($reference.files | Where-Object {
        $old = $_
        $next = @($full.files | Where-Object name -eq $old.name)
        if ($next.Count -ne 1) { throw "Reference file missing from full authority: $($old.name)" }
        $old.sha256 -ne $next[0].hash
    } | ForEach-Object name)
    if (-not $deltas.Count -or @($deltas | Where-Object { $_ -notmatch '^[A-Za-z]+\.wz$' }).Count) { throw 'Archive-only delta prerequisite failed' }
    $root = Join-Path $OutputDirectory 'archive-bisection'
    New-Item -ItemType Directory -Force $root | Out-Null
    function Invoke-ArchiveSubset([string[]]$Names) {
        $script:archiveTrial++
        $directory = Join-Path $root ('trial-{0:D2}' -f $script:archiveTrial)
        foreach ($name in $deltas) {
            $cohort = if ($Names -contains $name) { 'full' } else { 'reference' }
            $cached = Join-Path (Join-Path (Join-Path $OutputDirectory 'private-asset-deltas') $cohort) $name
            Copy-Item $cached (Join-Path $GameDirectory $name) -Force
        }
        # The ordinary consumer harness independently verifies every staged file and all13 runtime hashes.
        & (Join-Path $PSScriptRoot 'native-smoke.ps1') -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 `
            -BaselineFilesBaseUrl $BaselineFilesBaseUrl -KaentakeArtifact $KaentakeArtifact `
            -CompanionArtifact $CompanionArtifact -RuntimeArtifact $RuntimeArtifact -OutputDirectory $directory `
            -ObserveSeconds $ObserveSeconds -GameHost $GameHost -PreparedGameDirectory $GameDirectory `
            -PublishedRuntimeControl -ReferenceAssetControl -DiagnosticFullArchives $Names | Out-Null
        $receipt = Get-Content (Join-Path $directory 'result.json') -Raw | ConvertFrom-Json
        $step = [ordered]@{ trial = $script:archiveTrial; fullArchives = @($Names); directory = $directory
            status = $receipt.status; initializeSuccessObserved = $receipt.initializeSuccessObserved
            nativeUiObserved = $receipt.nativeUiObserved; gameAliveAfterObservation = $receipt.gameAliveAfterObservation
            error = $receipt.error; outcome = 'inconclusive' }
        $result.steps.Add([pscustomobject]$step)
        if (-not $receipt.nativeCaptureStartedUtc -or -not $receipt.initializeSuccessObserved) { throw 'STOP: trial did not reach comparable native initialization' }
        $samples = @(Get-Content (Join-Path $directory 'kernel-backend-observations.log') | ForEach-Object { $_ | ConvertFrom-Json })
        if (-not $samples.Count) { throw 'STOP: no actual concurrent backend/kernel observations' }
        foreach ($sample in $samples) {
            if (@($sample.backendProcesses | Where-Object { $_.alive -eq $false }).Count -or
                -not @($sample.tcp | Where-Object { $_.localPort -eq 8484 -and $_.state -eq 'Listen' }).Count) {
                throw 'STOP: backend/listener stability not established during trial; no archive attribution'
            }
        }
        if ($receipt.status -eq 'native-startup-observed') { $outcome = 'startup-observed' }
        elseif (-not $receipt.nativeUiObserved -or -not $receipt.gameAliveAfterObservation -or $receipt.errorDialogObserved) { $outcome = 'startup-failed' }
        else { throw 'STOP: observer/acceptance failure is not a comparable native startup failure' }
        $result.steps[$result.steps.Count - 1].outcome = $outcome
        return $outcome
    }
    $candidates = @($deltas)
    while ($candidates.Count -gt 1) {
        $middle = [int][Math]::Ceiling($candidates.Count / 2.0)
        $left = @($candidates[0..($middle - 1)])
        $right = @($candidates[$middle..($candidates.Count - 1)])
        if ((Invoke-ArchiveSubset $left) -eq 'startup-failed') { $candidates = $left; continue }
        if ((Invoke-ArchiveSubset $right) -eq 'startup-failed') { $candidates = $right; continue }
        $result.status = 'interaction-or-nondeterminism-not-single-archive'
        $result.candidateArchives = $candidates
        throw 'STOP: both halves booted although the full set failed; do not invent a single-archive root cause'
    }
    $result.status = 'single-archive-dependent-startup-failure'
    $result.archive = $candidates[0]
    $result.limit = 'Archive dependency isolated only; node/decoder/root cause still requires evidence. All accepted content remains required in final RC.'
} catch {
    if ($result.status -eq 'running') { $result.status = 'inconclusive' }
    $result.error = $_.Exception.ToString()
} finally {
    $result.finishedUtc = [DateTime]::UtcNow.ToString('O')
    $result | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $OutputDirectory 'archive-bisection.json')
}

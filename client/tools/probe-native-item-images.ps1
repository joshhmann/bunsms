param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$GameDirectory,
    [Parameter(Mandatory)][uri]$BaselineUrl,
    [Parameter(Mandatory)][string]$BaselineSha256,
    [Parameter(Mandatory)][uri]$BaselineFilesBaseUrl,
    [Parameter(Mandatory)][string]$KaentakeArtifact,
    [Parameter(Mandatory)][string]$CompanionArtifact,
    [Parameter(Mandatory)][string]$RuntimeArtifact,
    [Parameter(Mandatory)][uri]$VariantsUrl,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$VariantsSha256,
    [int]$ObserveSeconds = 90,
    [string]$GameHost = '127.0.0.1'
)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ status = 'running'; sourceCommit = $env:GITHUB_SHA; authorityUrl = $VariantsUrl.AbsoluteUri
    authoritySha256 = $VariantsSha256; steps = [Collections.Generic.List[object]]::new()
    scope = 'INTERNAL data diagnostics only. Same published runtime/backend/observer; no release content cuts, remap, dummy art, memory/PE/guard patch or feature acceptance.' }
try {
    if ($VariantsUrl.Scheme -ne 'https') { throw 'Image variant authority must use pinned HTTPS' }
    $authorityPath = Join-Path $OutputDirectory 'item-image-variants.json'
    Invoke-WebRequest $VariantsUrl.AbsoluteUri -OutFile $authorityPath -TimeoutSec 60
    if ((Get-FileHash $authorityPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $VariantsSha256) { throw 'Image variant authority SHA256 mismatch' }
    $authority = Get-Content $authorityPath -Raw | ConvertFrom-Json
    $full = Get-Content (Join-Path $OutputDirectory 'baseline-provenance.json') -Raw | ConvertFrom-Json
    $reference = Get-Content (Join-Path $OutputDirectory 'reference-provenance.json') -Raw | ConvertFrom-Json
    $fullItem = $full.files | Where-Object name -eq 'Item.wz'
    $referenceItem = $reference.files | Where-Object name -eq 'Item.wz'
    if ($authority.reference.sha256 -ne $referenceItem.sha256 -or $authority.reference.size -ne $referenceItem.size -or
        $authority.rc3.sha256 -ne $fullItem.hash -or $authority.rc3.size -ne $fullItem.size -or -not $authority.variants.Count) {
        throw 'Image variants do not match the exact working/failed Item authority'
    }
    $fullSupport = $authority.supportCohort -eq 'full-rc3'
    if ($fullSupport) {
        $control = @($authority.variants | Where-Object { $_.id -eq $authority.controlVariantId -and $_.kind -eq 'full-support-control' })
        if ($control.Count -ne 1) { throw 'Full-support experiment needs one explicit no-new-cards control' }
        $reencoded = @($authority.variants | Where-Object { $_.id -eq $authority.reencodingControlVariantId -and $_.kind -eq 'on-full-support' })
        if ($reencoded.Count -ne 1) { throw 'Full-support experiment needs the explicit semantically unchanged re-encoding control' }
        $variants = @($control) + @($reencoded) + @($authority.variants | Where-Object { $_.kind -eq 'on-full-support' -and $_.id -ne $authority.reencodingControlVariantId })
    } else {
        $variants = @($authority.variants | Where-Object kind -eq 'on-reference')
    }
    if (-not $variants.Count) { throw 'No genuine discriminators in descriptor' }
    $isolateRemaining = @($variants | Where-Object { $_.isolateRemainingFullArchives -eq $true }).Count -gt 0
    if ($isolateRemaining -and
        ($fullSupport -or $variants.Count -ne 1 -or $variants[0].id -ne $authority.controlVariantId)) {
        throw 'Archive isolation requires one explicit reference-context working control'
    }
    if ($isolateRemaining -and $authority.currentFullCohort.manifestSha256 -ne $BaselineSha256) {
        throw 'Remaining-archive experiment requires its exact pinned full manifest'
    }
    $result.supportCohort = if ($fullSupport) { 'FULL rc3 other archives; actual pairing inventory retained separately' } else { 'working-reference51 other archives' }
    $selectedIds = @($variants | ForEach-Object id)
    $result.notExercised = @($authority.variants | Where-Object { $_.id -notin $selectedIds } | ForEach-Object id)
    $expectedBackend = @(Get-Content (Join-Path $OutputDirectory 'kernel-backend-ready.json') -Raw | ConvertFrom-Json)
    if ($expectedBackend.Count -ne 2 -or @($expectedBackend | Where-Object { $_.alive -ne $true }).Count) { throw 'Same live backend identity unavailable; STOP image attribution' }
    $expectedJava = $expectedBackend | Where-Object role -eq 'java'
    $fullArchiveNames = [Collections.Generic.List[string]]::new()
    foreach ($old in $reference.files) {
        $next = $full.files | Where-Object name -eq $old.name
        if ($old.sha256 -eq $next.hash) { continue }
        if ($old.name -notmatch '^[A-Za-z]+\.wz$') { throw 'Unexpected non-archive delta' }
        $cohort = if ($fullSupport) { 'full' } else { 'reference' }
        Copy-Item (Join-Path (Join-Path $OutputDirectory "private-asset-deltas/$cohort") $old.name) (Join-Path $GameDirectory $old.name) -Force
        if ($fullSupport -and $old.name -ne 'Item.wz') { $fullArchiveNames.Add($old.name) }
    }
    $root = Join-Path $OutputDirectory 'item-image-probes'
    $cache = Join-Path $OutputDirectory 'private-item-variants'
    New-Item -ItemType Directory -Force $root, $cache | Out-Null
    $index = 0
    foreach ($variant in $variants) {
        $index++
        $url = [uri]$variant.url
        if (-not $url.IsAbsoluteUri -or $url.Scheme -ne 'https' -or $variant.sha256 -notmatch '^[a-f0-9]{64}$' -or $variant.size -le 0) { throw 'Invalid image variant byte authority' }
        $supportFiles = @($variant.supportFiles | Where-Object { $_ })
        if ($supportFiles.Count -and -not $fullSupport -and $authority.supportCohort -ne 'reference') {
            throw 'Diagnostic support files require an explicitly pinned reference or full-rc3 context'
        }
        if (-not $fullSupport -and -not $supportFiles.Count -and $variant.sha256 -eq $referenceItem.sha256 -and $variant.size -eq $referenceItem.size) {
            $result.steps.Add([pscustomobject]@{ id = $variant.id; sha256 = $variant.sha256; images = $variant.images
                outcome = 'Exact already-proven reference bytes; no duplicate engine probe' })
            continue
        }
        $cached = Join-Path $cache ('variant-{0:D2}.wz' -f $index)
        if ($variant.sha256 -eq $fullItem.hash -and $variant.size -eq $fullItem.size) {
            Copy-Item (Join-Path $OutputDirectory 'private-asset-deltas/full/Item.wz') $cached
        } else { Invoke-WebRequest $url.AbsoluteUri -OutFile $cached -TimeoutSec 120 }
        if ((Get-Item $cached).Length -ne $variant.size -or (Get-FileHash $cached -Algorithm SHA256).Hash.ToLowerInvariant() -ne $variant.sha256) { throw "Image variant size/SHA256 mismatch: $($variant.id)" }
        Copy-Item $cached (Join-Path $GameDirectory 'Item.wz') -Force
        if ($fullSupport -and -not $supportFiles.Count) {
            Copy-Item (Join-Path $OutputDirectory 'private-asset-deltas/full/String.wz') (Join-Path $GameDirectory 'String.wz') -Force
        }
        $supportNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($support in $supportFiles) {
            $supportUrl = [uri]$support.url
            if ($support.name -notin @('String.wz', 'Skill.wz', 'Character.wz', 'Effect.wz', 'Map.wz', 'Mob.wz', 'Npc.wz') -or -not $supportNames.Add($support.name) -or $support.sha256 -notmatch '^[a-f0-9]{64}$' -or
                $support.size -le 0 -or -not $supportUrl.IsAbsoluteUri -or $supportUrl.Scheme -ne 'https') {
                throw 'Invalid diagnostic support-archive byte authority'
            }
            $supportCache = Join-Path $cache ("support-$($support.sha256).wz")
            if (-not (Test-Path $supportCache)) {
                $fullSupportFile = $full.files | Where-Object name -eq $support.name
                if ($support.sha256 -eq $fullSupportFile.hash -and $support.size -eq $fullSupportFile.size) {
                    Copy-Item (Join-Path (Join-Path $OutputDirectory 'private-asset-deltas/full') $support.name) $supportCache
                } else { Invoke-WebRequest $supportUrl.AbsoluteUri -OutFile $supportCache -TimeoutSec 120 }
            }
            if ((Get-Item $supportCache).Length -ne $support.size -or (Get-FileHash $supportCache -Algorithm SHA256).Hash.ToLowerInvariant() -ne $support.sha256) {
                throw "Diagnostic support-archive size/SHA256 mismatch: $($variant.id)"
            }
            Copy-Item $supportCache (Join-Path $GameDirectory $support.name) -Force
        }
        $effectiveFullArchives = @($fullArchiveNames | Where-Object { -not $supportNames.Contains($_) })
        $directory = Join-Path $root ('variant-{0:D2}' -f $index)
        & (Join-Path $PSScriptRoot 'native-smoke.ps1') -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 `
            -BaselineFilesBaseUrl $BaselineFilesBaseUrl -KaentakeArtifact $KaentakeArtifact -CompanionArtifact $CompanionArtifact `
            -RuntimeArtifact $RuntimeArtifact -OutputDirectory $directory -ObserveSeconds $ObserveSeconds -GameHost $GameHost `
            -PreparedGameDirectory $GameDirectory -PublishedRuntimeControl -ReferenceAssetControl `
            -DiagnosticFullArchives $effectiveFullArchives -DiagnosticItemVariant $variant -DiagnosticSupportFiles $supportFiles | Out-Null
        $receipt = Get-Content (Join-Path $directory 'result.json') -Raw | ConvertFrom-Json
        $step = [pscustomobject]@{ id = $variant.id; kind = $variant.kind; images = $variant.images; nodes = $variant.nodes; supportFiles = $supportFiles; sha256 = $variant.sha256; size = $variant.size
            directory = $directory; status = $receipt.status; initializeSuccessObserved = $receipt.initializeSuccessObserved
            nativeUiObserved = $receipt.nativeUiObserved; gameAliveAfterObservation = $receipt.gameAliveAfterObservation
            capsAckObserved = $receipt.capsAckObserved; error = $receipt.error; outcome = 'inconclusive' }
        $result.steps.Add($step)
        if (-not $receipt.nativeCaptureStartedUtc -or -not $receipt.initializeSuccessObserved) { throw 'STOP: variant never reached comparable native initialization' }
        $ready = @(Get-Content (Join-Path $directory 'kernel-backend-ready.json') -Raw | ConvertFrom-Json)
        foreach ($expected in $expectedBackend) {
            if (-not @($ready | Where-Object { $_.role -eq $expected.role -and $_.id -eq $expected.id -and $_.startUtc -eq $expected.startUtc -and $_.alive -eq $true }).Count) {
                throw 'STOP: backend identity/lifetime changed; no image attribution'
            }
        }
        $samples = @(Get-Content (Join-Path $directory 'kernel-backend-observations.log') | ForEach-Object { $_ | ConvertFrom-Json })
        if (-not $samples.Count) { throw 'STOP: no concurrent backend/kernel evidence' }
        foreach ($sample in $samples) {
            if ($sample.backendProcesses.Count -ne 2 -or @($sample.backendProcesses | Where-Object { $_.alive -ne $true }).Count -or
                -not @($sample.tcp | Where-Object { $_.localPort -eq 8484 -and $_.state -eq 'Listen' -and $_.owningPid -eq $expectedJava.id }).Count) {
                throw 'STOP: same backend/listener stability not established during variant'
            }
        }
        if ($receipt.status -eq 'native-startup-observed') { $step.outcome = 'startup-observed' }
        elseif (-not $receipt.nativeUiObserved -or -not $receipt.gameAliveAfterObservation -or $receipt.errorDialogObserved) { $step.outcome = 'startup-failed' }
        else { throw 'STOP: observer failure is not a comparable startup result' }
        if ($variant.id -eq $authority.controlVariantId -and $step.outcome -ne 'startup-observed') {
            throw 'STOP: unchanged-data prerequisite failed; do not run or interpret the re-encoding comparison'
        }
        if ($variant.id -eq $authority.reencodingControlVariantId -and $step.outcome -ne 'startup-observed') {
            throw 'STOP: semantically unchanged re-encoding failed; investigate writer/representation compatibility before any node/schema/root attribution'
        }
        if ($variant.id -in @($authority.prerequisiteVariantIds) -and $step.outcome -ne 'startup-observed') {
            throw "STOP: explicit healthy prerequisite failed: $($variant.id); do not interpret dependent controls"
        }
    }
    if ($isolateRemaining) {
        & (Join-Path $PSScriptRoot 'isolate-native-archives.ps1') -OutputDirectory $OutputDirectory -GameDirectory $GameDirectory `
            -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 -BaselineFilesBaseUrl $BaselineFilesBaseUrl `
            -KaentakeArtifact $KaentakeArtifact -CompanionArtifact $CompanionArtifact -RuntimeArtifact $RuntimeArtifact `
            -ObserveSeconds $ObserveSeconds -GameHost $GameHost -BaseItemVariant $variants[0] -BaseSupportFiles $supportFiles `
            -ExpectedFullArchives $authority.currentFullCohort.remainingActualChangedArchives
        $result.archiveIsolation = Get-Content (Join-Path $OutputDirectory 'archive-bisection.json') -Raw | ConvertFrom-Json
    }
    $result.status = 'image-variant-observations-complete'
    $result.limit = 'Sufficiency/dependency observations only; compare genuine nodes and runtime consumer evidence before any root/fix claim. Final full cohort and all features still required.'
} catch { $result.status = 'inconclusive'; $result.error = $_.Exception.ToString() }
finally {
    $result.finishedUtc = [DateTime]::UtcNow.ToString('O')
    $result | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $OutputDirectory 'item-image-probes.json')
}

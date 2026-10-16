param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$BackendResult,
    [Parameter(Mandatory)][int]$DurationSeconds,
    [string]$GameExecutable = ''
)
$ErrorActionPreference = 'Stop'
$backend = Get-Content $BackendResult -Raw | ConvertFrom-Json
$tracked = @{}
$initial = @()
foreach ($entry in @(@{ role = 'java'; id = [int]$backend.serverPid }, @{ role = 'mysql'; id = [int]$backend.mysqlPid })) {
    try {
        $process = Get-Process -Id $entry.id -ErrorAction Stop
        $null = $process.Handle # Retain a query handle so a later natural exit code remains observable.
        $tracked[$entry.role] = $process
        $initial += [pscustomobject]@{ role = $entry.role; id = $entry.id; name = $process.ProcessName; startUtc = $process.StartTime.ToUniversalTime().ToString('O'); alive = -not $process.HasExited }
    } catch {
        $initial += [pscustomobject]@{ role = $entry.role; id = $entry.id; alive = $false; observationError = $_.Exception.Message; exitCode = $null; limitation = 'Process absent before observer opened a handle; no retrospective exit-code claim' }
    }
}
$writer = [IO.StreamWriter]::new((Join-Path $OutputDirectory 'kernel-backend-observations.log'), $false, [Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true
$deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds)
$nextMemorySample = [DateTime]::MinValue
try {
    $initial | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $OutputDirectory 'kernel-backend-ready.json') -Encoding utf8NoBOM
    do {
        $sample = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); backendProcesses = @(); tcp = @(); logs = @() }
        foreach ($role in $tracked.Keys) {
            $process = $tracked[$role]
            $row = [ordered]@{ role = $role; id = $process.Id; name = $process.ProcessName }
            try {
                $row.alive = -not $process.HasExited
                if ($process.HasExited) { $row.exitCode = $process.ExitCode; $row.exitUtc = $process.ExitTime.ToUniversalTime().ToString('O') }
            } catch { $row.observationError = $_.Exception.Message }
            $sample.backendProcesses += [pscustomobject]$row
        }
        try {
            $sample.tcp = @(Get-NetTCPConnection -ErrorAction Stop |
                Where-Object { $_.LocalPort -eq 8484 -or $_.RemotePort -eq 8484 -or ($_.LocalPort -eq 3306 -and $_.State -eq 'Listen') } |
                ForEach-Object { [pscustomobject]@{ localAddress = $_.LocalAddress; localPort = $_.LocalPort; remoteAddress = $_.RemoteAddress; remotePort = $_.RemotePort; state = $_.State.ToString(); owningPid = $_.OwningProcess } })
        } catch { $sample.tcpObservationError = $_.Exception.Message }
        if ($GameExecutable -and [DateTime]::UtcNow -ge $nextMemorySample) {
            $sample.nativeMemory = @()
            $sample.memoryObservationMode = 'Read-only CIM provider; no native process handles. Missing metrics are limitations, never an abort or pressure diagnosis.'
            try {
                $native = @(Get-CimInstance Win32_Process -Filter "Name = 'MapleStory.exe'" `
                    -Property ProcessId, ExecutablePath, VirtualSize, PeakVirtualSize, PrivatePageCount, PageFileUsage, PeakPageFileUsage, WorkingSetSize `
                    -ErrorAction Stop | Where-Object { $_.ExecutablePath -eq $GameExecutable })
                $sample.nativeMemory = @($native | ForEach-Object {
                    [pscustomobject]@{ processId = $_.ProcessId; executable = $_.ExecutablePath
                        virtualSizeBytes = $_.VirtualSize; peakVirtualSizeBytes = $_.PeakVirtualSize
                        privatePageCountRaw = $_.PrivatePageCount; workingSetSizeBytes = $_.WorkingSetSize
                        pageFileUsageKiB = $_.PageFileUsage; peakPageFileUsageKiB = $_.PeakPageFileUsage }
                })
                if ($native.Count) {
                    try {
                        $memory = Get-CimInstance Win32_PerfRawData_PerfOS_Memory -Property CommitLimit, CommittedBytes, AvailableBytes -ErrorAction Stop
                        $sample.systemMemory = [pscustomobject]@{ commitLimitBytes = $memory.CommitLimit; committedBytes = $memory.CommittedBytes; availableBytes = $memory.AvailableBytes }
                    } catch { $sample.systemMemoryObservationError = $_.Exception.Message }
                }
            } catch { $sample.nativeMemoryObservationError = $_.Exception.Message }
            $nextMemorySample = [DateTime]::UtcNow.AddSeconds(1)
        }
        foreach ($name in @('server.log', 'server-error.log', 'mysql-error.log')) {
            $path = Join-Path ([IO.Path]::GetDirectoryName($BackendResult)) $name
            if (Test-Path $path) {
                $file = Get-Item $path
                $sample.logs += [pscustomobject]@{ name = $name; size = $file.Length; modifiedUtc = $file.LastWriteTimeUtc.ToString('O') }
            }
        }
        $writer.WriteLine(($sample | ConvertTo-Json -Depth 8 -Compress))
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path (Join-Path $OutputDirectory 'kernel-backend.stop')))
} finally {
    $writer.Dispose()
    foreach ($process in $tracked.Values) { $process.Dispose() }
}

param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$BackendResult,
    [Parameter(Mandatory)][int]$DurationSeconds
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

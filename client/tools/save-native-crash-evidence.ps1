param(
    [Parameter(Mandatory)][string]$GameDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][datetime]$StartedUtc
)
$ErrorActionPreference = 'Stop'
$destination = Join-Path $OutputDirectory 'crash-receipts'
$privateBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$private = Join-Path $privateBase ('buns-native-private-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $destination, $private | Out-Null
$receipt = [ordered]@{ startedUtc = $StartedUtc.ToUniversalTime().ToString('O'); observedUtc = [DateTime]::UtcNow.ToString('O'); events = @(); wer = @(); stacks = @(); errors = @(); rawFilesKeptPrivate = 0; mode = 'Existing Windows/native crash output only. Raw reports/dumps stay on private ephemeral runner disk, outside ALL artifact paths. No live debugger, dump-policy registry, guard or renderer changes.' }
$receipt.privateFileInventory = @()
$receipt.nativeText = @()
try {
    $receipt.events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $StartedUtc; Id = @(1000, 1001) } -ErrorAction Stop |
        Where-Object { $_.Message -match 'MapleStory|Kaentake|BunsMS\.dll' } |
        ForEach-Object {
            $event = [xml]$_.ToXml()
            $safe = [ordered]@{ utc = $_.TimeCreated.ToUniversalTime().ToString('O'); id = $_.Id; provider = $_.ProviderName }
            foreach ($data in $event.Event.EventData.Data) {
                if ($data.Name -in @('AppName', 'AppVersion', 'AppTimeStamp', 'ModuleName', 'ModuleVersion', 'ModuleTimeStamp', 'ExceptionCode', 'FaultingOffset', 'ProcessId', 'AppPath', 'ModulePath', 'EventName')) { $safe[$data.Name] = $data.InnerText }
            }
            [pscustomobject]$safe
        })
} catch { $receipt.errors += "Application event query: $($_.Exception.Message)" }
$files = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
try {
    Get-ChildItem $GameDirectory -File -Recurse -ErrorAction Stop |
        Where-Object { $_.LastWriteTimeUtc -ge $StartedUtc.ToUniversalTime() -and $_.Extension -in @('.dmp', '.mdmp', '.wer', '.log', '.txt') } |
        ForEach-Object { [void]$files.Add($_.FullName) }
} catch { $receipt.errors += "Native crash-file enumeration: $($_.Exception.Message)" }
foreach ($root in @((Join-Path $env:ProgramData 'Microsoft/Windows/WER/ReportArchive'), (Join-Path $env:ProgramData 'Microsoft/Windows/WER/ReportQueue'))) {
    if (-not (Test-Path $root)) { continue }
    try {
        foreach ($report in @(Get-ChildItem $root -Filter '*.wer' -File -Recurse -ErrorAction Stop | Where-Object { $_.LastWriteTimeUtc -ge $StartedUtc.ToUniversalTime() })) {
            if ((Get-Content $report.FullName -Raw).IndexOf($GameDirectory, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
            Get-ChildItem $report.Directory.FullName -File -Recurse | Where-Object { $_.Extension -in @('.dmp', '.mdmp', '.wer', '.txt') } | ForEach-Object { [void]$files.Add($_.FullName) }
        }
    } catch { $receipt.errors += "WER enumeration: $($_.Exception.Message)" }
}
$localDumps = Join-Path $env:LOCALAPPDATA 'CrashDumps'
if (Test-Path $localDumps) {
    Get-ChildItem $localDumps -File | Where-Object { $_.Name -match '^(MapleStory|Kaentake)\.' -and $_.LastWriteTimeUtc -ge $StartedUtc.ToUniversalTime() } | ForEach-Object { [void]$files.Add($_.FullName) }
}
$cdb = @((Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Debuggers/x86/cdb.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Debuggers/x64/cdb.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
$index = 0
foreach ($source in $files) {
    try {
        $index++
        $target = Join-Path $private ("{0:D3}-{1}" -f $index, [IO.Path]::GetFileName($source))
        Copy-Item -LiteralPath $source -Destination $target
        $receipt.rawFilesKeptPrivate++
        $file = Get-Item -LiteralPath $target
        $extension = $file.Extension.ToLowerInvariant()
        $receipt.privateFileInventory += [pscustomobject]@{
            index = $index; fileName = [IO.Path]::GetFileName($source); extension = $extension
            bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
            lastWriteUtc = (Get-Item -LiteralPath $source).LastWriteTimeUtc.ToString('O')
        }
        if ($extension -in @('.log', '.txt')) {
            # Never publish raw lines: a native report can include inherited environment/secrets.
            $tokens = [Collections.Generic.List[object]]::new()
            $reader = [IO.StreamReader]::new($target, $true)
            try {
                $lineNumber = 0; $stackLines = 0; $insideStack = $false
                while (-not $reader.EndOfStream -and $lineNumber -lt 4096 -and $tokens.Count -lt 64) {
                    $line = $reader.ReadLine(); $lineNumber++
                    if ($line -match '(?i)\b(exception(?:\s+(?:code|address|offset))?|error\s+code|fault(?:ing)?(?:\s+(?:address|offset))?|eip|rip)\s*[:=]\s*(-?(?:0x)?[0-9a-f]{4,16})\b') {
                        $tokens.Add([pscustomobject]@{ line = $lineNumber; kind = $Matches[1]; numericValue = $Matches[2] })
                    }
                    if ($line -match '(?i)^\s*(?:call\s+stack|stack\s*trace|backtrace)\b') { $insideStack = $true }
                    if ($insideStack -and $stackLines -lt 16 -and $line -match '^\s*((?:0x)?[0-9a-fA-F]{8,16})\s+((?:0x)?[0-9a-fA-F]{8,16})(?:\s|$)') {
                        $tokens.Add([pscustomobject]@{ line = $lineNumber; kind = 'bounded-stack-leading-addresses-only'; address1 = $Matches[1]; address2 = $Matches[2] })
                        $stackLines++
                    }
                    foreach ($match in [regex]::Matches($line, '(?i)\b(MapleStory\.exe|BunsMS\.dll|Kaentake\.(?:dll|exe)|Gr2D_DX8\.dll|d3d8\.dll|ntdll\.dll|kernelbase\.dll|kernel32\.dll)(?:\s*[!+]\s*(0x[0-9a-f]{1,16}|[A-Za-z_?@$][A-Za-z0-9_?@$:.<>~-]{0,95}(?:\+0x[0-9a-f]{1,16})?))?')) {
                        if ($tokens.Count -ge 64) { break }
                        $tokens.Add([pscustomobject]@{ line = $lineNumber; kind = 'module-mention-not-fault-proof'; module = $match.Groups[1].Value; location = $match.Groups[2].Value })
                    }
                }
                $receipt.nativeText += [pscustomobject]@{ fileIndex = $index; scannedLines = $lineNumber; limitLines = 4096; limitTokens = 64; tokens = $tokens }
            } finally { $reader.Dispose() }
        }
        if ([IO.Path]::GetExtension($target) -eq '.wer') {
            $pairs = @{}
            foreach ($line in Get-Content $target) { if ($line -match '^([^=]+)=(.*)$') { $pairs[$Matches[1]] = $Matches[2] } }
            $safe = [ordered]@{}
            foreach ($key in $pairs.Keys) {
                if ($key -match '^Sig\[(\d+)\]\.Name$' -and $pairs[$key] -in @('Application Name', 'Application Version', 'Application Timestamp', 'Fault Module Name', 'Fault Module Version', 'Fault Module Timestamp', 'Exception Code', 'Exception Offset')) { $safe[$pairs[$key]] = $pairs[('Sig[' + $Matches[1] + '].Value')] }
            }
            $receipt.wer += [pscustomobject]$safe
        }
        if ([IO.Path]::GetExtension($target) -in @('.dmp', '.mdmp') -and $cdb) {
            $commands = Join-Path $private "stack-$index.commands"
            ".ecxr`n.echo BUNS_STACK_BEGIN`nk`n.echo BUNS_STACK_END`nq" | Set-Content $commands -Encoding ascii
            $stdout = Join-Path $private "stack-$index.stdout"
            $tool = Start-Process $cdb -ArgumentList @('-z', "`"$target`"", '-cf', "`"$commands`"") -PassThru -RedirectStandardOutput $stdout -RedirectStandardError (Join-Path $private "stack-$index.stderr")
            if (-not $tool.WaitForExit(30000)) { $tool.Kill(); $receipt.errors += 'Offline stack analysis timed out'; continue }
            $inside = $false; $stack = @()
            foreach ($line in Get-Content $stdout) {
                if ($line.Contains('BUNS_STACK_END')) { $inside = $false }
                if ($inside -and $line -match '^\s*(?:[0-9a-fA-F`]+\s+){2,}.*(?:!|\+0x)') { $stack += $line }
                if ($line.Contains('BUNS_STACK_BEGIN')) { $inside = $true }
            }
            $receipt.stacks += [pscustomobject]@{ analyzer = 'Existing SDK cdb, OFFLINE dump only'; exitCode = $tool.ExitCode; frames = $stack }
        }
    } catch { $receipt.errors += "Private crash preservation/analysis: $($_.Exception.Message)" }
}
$receipt.offlineAnalyzerAvailable = [bool]$cdb
$receipt | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $destination 'receipt.json') -Encoding utf8NoBOM

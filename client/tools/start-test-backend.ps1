param(
    [Parameter(Mandatory)][uri]$BundleUrl,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$BundleSha256,
    [Parameter(Mandatory)][uri]$XmlUrl,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$XmlSha256,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$MySqlSha256,
    [string]$OutputDirectory = 'native-backend-output',
    [switch]$DailyCheckinFixture,
    [switch]$FundedCashPrismFixture
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $root | Out-Null
$report = [ordered]@{ status = 'starting'; startedUtc = [DateTime]::UtcNow.ToString('O'); host = '127.0.0.1'; productionTouched = $false }
function Receive-Pinned([uri]$Url, [string]$Sha, [string]$Path) {
    if ($Url.Scheme -ne 'https') { throw 'QA backend inputs require pinned HTTPS URLs' }
    $report.currentDownload = [ordered]@{ url = $Url.AbsoluteUri; expectedSha256 = $Sha; startedUtc = [DateTime]::UtcNow.ToString('O'); status = 'downloading' }
    Invoke-WebRequest $Url.AbsoluteUri -OutFile $Path -TimeoutSec 1800
    $actual = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.currentDownload.actualSha256 = $actual
    $report.currentDownload.bytes = (Get-Item $Path).Length
    if ($actual -ne $Sha.ToLowerInvariant()) { throw "QA backend artifact mismatch: $Url SHA256=$actual" }
    $report.currentDownload.status = 'verified'
    $report.currentDownload.finishedUtc = [DateTime]::UtcNow.ToString('O')
}
function Wait-Listening([int]$Port, [Diagnostics.Process]$Process, [int]$Seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        $Process.Refresh()
        if ($Process.HasExited) { throw "QA process exited before port $Port was ready (exit=$($Process.ExitCode))" }
        $socket = [Net.Sockets.TcpClient]::new()
        try {
            $connect = $socket.ConnectAsync('127.0.0.1', $Port)
            if ($connect.Wait(300) -and $socket.Connected) { return }
        } catch {} finally { $socket.Dispose() }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "QA process did not open loopback port $Port within $Seconds seconds"
}
try {
    if ($FundedCashPrismFixture -and -not $DailyCheckinFixture) { throw 'Funded pre-auth fixture requires the separate owned Warrior fixture mode' }
    $report.disk = @(Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free)
    Receive-Pinned $BundleUrl $BundleSha256 (Join-Path $root 'server.tar.gz')
    Receive-Pinned $XmlUrl $XmlSha256 (Join-Path $root 'xml.tar.gz')
    $mysqlUrl = [uri]'https://cdn.mysql.com/archives/mysql-8.0/mysql-8.0.36-winx64.zip'
    Receive-Pinned $mysqlUrl $MySqlSha256 (Join-Path $root 'mysql.zip')
    $server = Join-Path $root 'server'; $xml = Join-Path $root 'xml'
    New-Item -ItemType Directory -Force $server, $xml | Out-Null
    tar -xzf (Join-Path $root 'server.tar.gz') -C $server
    if ($LASTEXITCODE) { throw 'QA server archive extraction failed' }
    tar -xzf (Join-Path $root 'xml.tar.gz') -C $xml
    if ($LASTEXITCODE) { throw 'QA XML archive extraction failed' }
    Expand-Archive (Join-Path $root 'mysql.zip') (Join-Path $root 'mysql')
    $contractPath = @(Get-ChildItem $server -Filter runtime-contract.json -Recurse)
    if ($contractPath.Count -ne 1) { throw 'QA bundle must have exactly one runtime-contract.json' }
    $server = $contractPath[0].Directory.FullName
    $contract = Get-Content $contractPath[0].FullName -Raw | ConvertFrom-Json
    $jar = Join-Path $server 'Cosmic.jar'
    if ((Get-FileHash $jar -Algorithm SHA256).Hash.ToLowerInvariant() -ne $contract.jar.sha256 -or
        (Get-Item $jar).Length -ne $contract.jar.size) { throw 'QA server JAR differs from its frozen bundle contract' }
    $xmlRoots = @(Get-ChildItem $xml -Filter Map.wz -Directory -Recurse)
    if ($xmlRoots.Count -ne 1) { throw 'QA XML archive must contain exactly one complete XML root with Map.wz' }
    $xml = $xmlRoots[0].Parent.FullName
    $scripts = Join-Path (Split-Path $xml -Parent) 'scripts'
    if (-not (Test-Path $scripts -PathType Container)) { throw 'Matched server pack has no scripts alongside its WZ root' }
    Copy-Item (Join-Path $scripts '*') (Join-Path $server 'scripts') -Recurse -Force
    foreach ($name in @('Character.wz', 'Item.wz', 'Mob.wz', 'Npc.wz', 'Quest.wz', 'Skill.wz', 'String.wz')) {
        if (-not (Test-Path (Join-Path $xml $name) -PathType Container)) { throw "Incomplete QA XML root: $name" }
    }
    $mysql = Join-Path $root 'mysql/mysql-8.0.36-winx64'
    $data = Join-Path $root 'mysql-data'
    & (Join-Path $mysql 'bin/mysqld.exe') --no-defaults --initialize-insecure "--basedir=$mysql" "--datadir=$data" --console
    if ($LASTEXITCODE) { throw 'Native QA MySQL initialization failed' }
    $database = Start-Process (Join-Path $mysql 'bin/mysqld.exe') -WindowStyle Hidden -ArgumentList @('--no-defaults', "--basedir=`"$mysql`"", "--datadir=`"$data`"", '--bind-address=127.0.0.1', '--port=3306', '--mysqlx=OFF', '--console') -PassThru -RedirectStandardOutput (Join-Path $root 'mysql.log') -RedirectStandardError (Join-Path $root 'mysql-error.log')
    $report.mysqlPid = $database.Id
    Wait-Listening 3306 $database 90
    $password = [Guid]::NewGuid().ToString('N')
    Write-Output "::add-mask::$password"
    $sql = "CREATE DATABASE buns_rc; CREATE USER 'buns_rc'@'127.0.0.1' IDENTIFIED BY '$password'; GRANT ALL ON buns_rc.* TO 'buns_rc'@'127.0.0.1';"
    & (Join-Path $mysql 'bin/mysql.exe') --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=root "--execute=$sql"
    if ($LASTEXITCODE) { throw 'Native QA schema/user creation failed' }
    $config = (Get-Content (Join-Path $server 'config.template.yaml') -Raw).Replace('REPLACE_WITH_LOCAL_QA_PASSWORD', $password)
    $config | Set-Content (Join-Path $server 'config.yaml') -Encoding utf8NoBOM
    $writtenConfig = Join-Path $server 'config.yaml'
    $report.writtenRegistrationPolicy = [ordered]@{
        path = $writtenConfig
        sha256 = (Get-FileHash $writtenConfig -Algorithm SHA256).Hash.ToLowerInvariant()
        lines = @(Get-Content $writtenConfig | Where-Object { $_ -match '^\s*(AUTOMATIC_REGISTER|BCRYPT_MIGRATION)\s*:' })
        evidence = 'Actual on-disk QA config before Java; no password/config dump or claim of direct JVM field observation'
    }
    $java = (Get-Command java.exe).Source
    $javaArguments = @('-Xms512m', '-Xmx2g', "`"-Dwz-path=$xml`"", '-jar', 'Cosmic.jar')
    if ($DailyCheckinFixture) {
        if (-not $env:RUNNER_TEMP -or $contract.jar.sha256 -ne '63790903a2cd8f59664764fb7af8c2583313e422a404f8269005191aeb579503') {
            throw 'Daily factory setup is isolated-CI-only and requires the exact diagnostic frozen637 JAR'
        }
        $producerUrl = 'https://raw.githubusercontent.com/joshhmann/bunsms/3a255d4673398154733da5820fa24921530f8966/server/tools/NativeDailyFixtureBackend.java'
        $producerSha256 = '1daa8a42ada201e100363054017b35490914188873f39a261fd84ea8d9687421'
        if ($FundedCashPrismFixture) {
            $producerUrl = 'https://raw.githubusercontent.com/joshhmann/bunsms/d2332e9c7f7f11e9b82f9bf4b82f181dfd2e37d7/server/tools/NativeDailyFixtureBackend.java'
            $producerSha256 = '6d09950482c8bb7cf66a8cd9df2782414699e0f13b85fb07da3c90167eeb6ffc'
        }
        $source = Join-Path $server 'NativeDailyFixtureBackend.java'
        Receive-Pinned $producerUrl $producerSha256 $source
        $classes = Join-Path $server 'qa-classes'
        New-Item -ItemType Directory -Force $classes | Out-Null
        & (Get-Command javac.exe).Source --release 21 -cp $jar -d $classes $source
        if ($LASTEXITCODE) { throw 'Pinned genuine Daily factory producer did not compile against the actual frozen JAR' }
        $uuid = @(& (Join-Path $mysql 'bin/mysql.exe') --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=root --batch --skip-column-names '--execute=SELECT @@server_uuid;')
        if ($LASTEXITCODE -or $uuid.Count -ne 1 -or $uuid[0] -notmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$') {
            throw 'Actual owned QA MySQL UUID was not observed'
        }
        $privateRoot = Join-Path $env:RUNNER_TEMP ("buns-native-daily-" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory $privateRoot -ErrorAction Stop | Out-Null
        $report.dailyFixtureReceiptPath = Join-Path $root 'daily-fixture.json'
        $report.dailyFixtureCredentialsPath = Join-Path $privateRoot 'daily-credentials.json'
        $report.dailyFixtureProducer = @{ url = $producerUrl; sha256 = $producerSha256 }
        $report.mysqlUuid = $uuid[0]
        $javaArguments = @('-Xms512m', '-Xmx2g', "`"-Dwz-path=$xml`"", '-cp', "`"$classes;$jar`"", 'NativeDailyFixtureBackend',
            $uuid[0], "`"$($report.dailyFixtureReceiptPath)`"", "`"$($report.dailyFixtureCredentialsPath)`"", "`"$source`"")
        if ($FundedCashPrismFixture) { $javaArguments += 'cash-prism-preauth' }
    }
    $gameServer = Start-Process $java -WindowStyle Hidden -WorkingDirectory $server -ArgumentList $javaArguments -PassThru -RedirectStandardOutput (Join-Path $root 'server.log') -RedirectStandardError (Join-Path $root 'server-error.log')
    $report.serverPid = $gameServer.Id
    Wait-Listening 8484 $gameServer 300
    foreach ($port in @(7575, 7576, 7577)) { Wait-Listening $port $gameServer 90 }
    if ($DailyCheckinFixture) {
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        while (-not (Test-Path -LiteralPath $report.dailyFixtureReceiptPath)) {
            $gameServer.Refresh()
            if ($gameServer.HasExited -or [DateTime]::UtcNow -ge $deadline) {
                throw 'Genuine Daily factory did not atomically publish its completed receipt; inspect retained actual Java errors'
            }
            Start-Sleep -Milliseconds 250
        }
        $report.dailyFixture = Get-Content $report.dailyFixtureReceiptPath -Raw | ConvertFrom-Json
        if ($report.dailyFixture.producerSourceSha256 -ne $producerSha256 -or
            $report.dailyFixture.mysqlUuid -ne $report.mysqlUuid -or
            $report.dailyFixture.jarSha256 -ne $contract.jar.sha256 -or
            (-not $FundedCashPrismFixture -and $report.dailyFixture.account.allOriginalFieldsUnchanged -ne $true) -or
            ($FundedCashPrismFixture -and ($report.dailyFixture.fixtureKind -ne 'CASH_PRISM_PREAUTH' -or
                $report.dailyFixture.account.authenticationFieldsUnchanged -ne $true -or
                $report.dailyFixture.account.allowedAccountDeltasExact -ne $true -or
                $report.dailyFixture.funding.before -ne 0 -or $report.dailyFixture.funding.after -ne 10000 -or
                $report.dailyFixture.ownedPrism.itemId -ne 5782000 -or $report.dailyFixture.ownedPrism.quantity -ne 1 -or
                $report.dailyFixture.ownedPrism.normalInventoryApiPersistedAndReloaded -ne $true)) -or
            $report.dailyFixture.account.loggedinBefore -ne 0 -or $report.dailyFixture.account.loggedinAfter -ne 0 -or
            $report.dailyFixture.cid2Unchanged -ne $true -or
            -not (Test-Path -LiteralPath $report.dailyFixtureCredentialsPath)) {
            throw 'Genuine Daily factory receipt differs from pinned identity/untouched-account setup'
        }
    }
    $report.status = 'real-server-listening'
    $report.bundle = @{ url = $BundleUrl.AbsoluteUri; sha256 = $BundleSha256 }
    $report.xml = @{ url = $XmlUrl.AbsoluteUri; sha256 = $XmlSha256 }
    $report.jar = $contract.jar
    $report.contract = $contract
    $report.xmlRoot = $xml
    $report.serverDirectory = $server
    $report.mysqlDirectory = $mysql
    $report.mysqlDataDirectory = $data
} catch {
    $report.status = 'failed'; $report.error = $_.Exception.ToString()
} finally {
    $report.finishedUtc = [DateTime]::UtcNow.ToString('O')
    $report | ConvertTo-Json -Depth 15 | Set-Content (Join-Path $root 'result.json') -Encoding utf8NoBOM
    $report | ConvertTo-Json -Depth 5 | Write-Output
}
if ($report.status -eq 'failed') { exit 1 }

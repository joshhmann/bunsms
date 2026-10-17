param(
    [Parameter(Mandatory)][uri]$BaselineUrl,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$BaselineSha256,
    [Parameter(Mandatory)][uri]$BaselineFilesBaseUrl,
    [Parameter(Mandatory)][string]$KaentakeArtifact,
    [Parameter(Mandatory)][string]$CompanionArtifact,
    [Parameter(Mandatory)][string]$RuntimeArtifact,
    [string]$OutputDirectory = 'native-smoke-output',
    [ValidateRange(30, 600)][int]$ObserveSeconds = 90,
    [string]$GameHost = 'buns.asslorde.com',
    [switch]$ExerciseLogin,
    [string]$PreparedGameDirectory = '',
    [switch]$PublishedRuntimeControl,
    [switch]$ReferenceAssetControl,
    [string[]]$DiagnosticFullArchives = @(),
    [object]$DiagnosticItemVariant = $null,
    [object[]]$DiagnosticSupportFiles = @(),
    [string]$ItemImageVariantsUrl = '',
    [string]$ItemImageVariantsSha256 = ''
)
$ErrorActionPreference = 'Stop'
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$report = [ordered]@{
    startedUtc = [DateTime]::UtcNow.ToString('O'); runner = $env:RUNNER_NAME
    baselineUrl = $BaselineUrl.AbsoluteUri; baselineSha256 = $BaselineSha256.ToLowerInvariant()
    baselineFilesBaseUrl = $BaselineFilesBaseUrl.AbsoluteUri
    observeSeconds = $ObserveSeconds; gameHost = $GameHost
    publishedRuntimeControl = [bool]$PublishedRuntimeControl
    status = 'not-completed'; nativeUiObserved = $false; initializeSuccessObserved = $false
    capsAckObserved = $false; snapshots = [Collections.Generic.List[object]]::new()
    controlledStops = [Collections.Generic.List[object]]::new()
}
$script:snapshotIndex = 0
$networkJob = $null
$script:qaPassword = $null


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

function Read-QAAccountState {
    if ($GameHost -ne '127.0.0.1') { throw 'QA account observation requires the isolated loopback backend' }
    $backend = Get-Content $backendResult -Raw | ConvertFrom-Json
    if ($backend.host -ne '127.0.0.1' -or $backend.productionTouched -ne $false) {
        throw 'Refusing account observation outside the owned QA backend'
    }
    $mysql = Get-Process -Id $backend.mysqlPid -ErrorAction Stop
    if ($mysql.ProcessName -ne 'mysqld') { throw 'QA MySQL PID identity changed before read-only observation' }
    $query = @'
SELECT JSON_OBJECT('id',a.id,'name',a.name,'tos',a.tos,'loggedin',a.loggedin,'gender',a.gender,'picConfigured',(a.pic IS NOT NULL AND a.pic<>''),'characters',(SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',c.id,'name',c.name,'world',c.world,'map',c.map,'level',c.level)),JSON_ARRAY()) FROM characters c WHERE c.accountid=a.id)) FROM accounts a WHERE a.name='bunsrcqa';
'@
    $raw = @(& (Join-Path $backend.mysqlDirectory 'bin/mysql.exe') --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=root --database=buns_rc --batch --skip-column-names "--execute=$query")
    if ($LASTEXITCODE) { throw 'Isolated read-only QA account query failed' }
    $recentAccounts = @()
    if (-not $raw.Count) {
        $recent = @(& (Join-Path $backend.mysqlDirectory 'bin/mysql.exe') --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=root --database=buns_rc --batch --skip-column-names "--execute=SELECT JSON_OBJECT('id',id,'name',name) FROM accounts ORDER BY id DESC LIMIT 12;")
        if ($LASTEXITCODE) { throw 'Isolated read-only recent account query failed' }
        $recentAccounts = @($recent | ForEach-Object { $_ | ConvertFrom-Json })
    }
    return [pscustomobject]@{ utc = [DateTime]::UtcNow.ToString('O'); mysqlPid = $mysql.Id; readOnly = $true
        status = if ($raw.Count) { 'observed' } else { 'account-not-found' }
        recentAccounts = $recentAccounts
        account = if ($raw.Count) { ($raw -join "`n") | ConvertFrom-Json } else { $null } }
}

function Get-StockPicDigitPositions($Window) {
    $foreground = [NativeSmoke]::ForegroundContext()
    if ($foreground.ProcessId -ne $Window.ProcessId -or $foreground.Handle -ne $Window.Handle -or
        $foreground.Class -ne 'MapleStoryClass') { throw 'Stock PIC keypad is not in the owned foreground; no input submitted' }
    if (-not $script:stockPicGlyphs) {
        # Exact genuine stock glyphs observed in two real Windows layouts (389949/389963).
        # Every live keypad must contain all ten unique matches; never reuse an old layout.
        $script:stockPicGlyphs = @{
            '7,11:3E7F636363636363773E0C' = '0'
            '5,11:1C1E1F1818181818181808' = '1'
            '7,11:3E7F636130381C0E677F01' = '2'
            '7,11:3E3F633038387063773F08' = '3'
            '7,11:383C3C3636337F7F303010' = '4'
            '7,11:7E3F030B3F736063773E08' = '5'
            '7,11:3E3F03033F776363773E0C' = '6'
            '7,10:7F7F2030181C0C0C0E06' = '7'
            '7,11:3E7E63773E3E6363773E08' = '8'
            '7,11:3E7F6363777F6C60773E08' = '9'
        }
    }
    $slots = @(@(361,266), @(400,266), @(439,266), @(361,300), @(400,300),
        @(439,300), @(361,334), @(400,334), @(439,334), @(361,368))
    $bitmap = [Drawing.Bitmap]::new(132, 132)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen(($Window.ClientX + 335), ($Window.ClientY + 249), 0, 0, $bitmap.Size)
        $keys = @{}
        foreach ($slot in $slots) {
            $left = 11; $right = -11; $top = 11; $bottom = -11
            for ($y = -10; $y -le 10; $y++) {
                for ($x = -10; $x -le 10; $x++) {
                    $pixel = $bitmap.GetPixel(($slot[0] - 335 + $x), ($slot[1] - 249 + $y))
                    if ($pixel.R -lt 190 -and $pixel.G -lt 190 -and $pixel.B -lt 190) {
                        $left = [Math]::Min($left, $x); $right = [Math]::Max($right, $x)
                        $top = [Math]::Min($top, $y); $bottom = [Math]::Max($bottom, $y)
                    }
                }
            }
            if ($right -lt $left -or $bottom -lt $top) { throw 'Stock PIC keypad glyph missing; input stopped' }
            $rows = [Text.StringBuilder]::new()
            for ($y = $top; $y -le $bottom; $y++) {
                $mask = 0
                for ($x = $left; $x -le $right; $x++) {
                    $pixel = $bitmap.GetPixel(($slot[0] - 335 + $x), ($slot[1] - 249 + $y))
                    if ($pixel.R -lt 190 -and $pixel.G -lt 190 -and $pixel.B -lt 190) {
                        $mask = $mask -bor (1 -shl ($x - $left))
                    }
                }
                [void]$rows.Append($mask.ToString('X2'))
            }
            $signature = '{0},{1}:{2}' -f ($right - $left + 1), ($bottom - $top + 1), $rows.ToString()
            if (-not $script:stockPicGlyphs.ContainsKey($signature)) { throw 'Stock PIC keypad glyph unrecognized; input stopped' }
            $digit = $script:stockPicGlyphs[$signature]
            if ($keys.ContainsKey($digit)) { throw 'Stock PIC keypad glyph ambiguous; input stopped' }
            $keys[$digit] = [Drawing.Point]::new($slot[0], $slot[1])
        }
        if ($keys.Count -ne 10) { throw 'Stock PIC keypad does not contain ten unique digits; input stopped' }
        return $keys
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
    $row.foregroundBeforeApproval = [NativeSmoke]::ForegroundContext()
    $approvalPending = @($row.windows | Where-Object { $_.Visible -and $_.Title -eq 'Program Compatibility Assistant' }).Count -gt 0
    if (-not $report.compatibilityAction) {
        $action = [NativeSmoke]::ContinueCompatibilityPrompt($Ids)
        if ($action) {
            $report.compatibilityAction = [pscustomobject]@{ utc = [DateTime]::UtcNow.ToString('O'); action = $action
                reason = 'Invoke the visible normal Windows Run button once; no registry, signature guard, or compatibility policy is changed' }
            $approvalPending = $true
        }
    }
    $row.approvalPending = $approvalPending
    $row.foregroundAfterApproval = [NativeSmoke]::ForegroundContext()
    if (-not $approvalPending -and -not $report.foregroundAttempt -and (Test-Path $debugLog) -and
        (Get-Content $debugLog -Raw).Contains('BUNS_RUNTIME initialize-success')) {
        $target = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' }) | Select-Object -First 1
        if ($target) {
            $attempt = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); hwnd = $target.Handle; processId = $target.ProcessId
                scope = 'Normal OS foreground request; if refused, one ordinary click only on a WindowFromPoint-verified exposed owned game footer; no login input, renderer, guard, or transport change' }
            try {
                $attempt.observation = [NativeSmoke]::FocusClient($target)
                $attempt.activated = $attempt.observation.Activated
            }
            catch { $attempt.error = $_.Exception.Message }
            $report.foregroundAttempt = [pscustomobject]$attempt
            $row.windows = @([NativeSmoke]::Windows($Ids))
        }
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
    $row.foregroundBeforeInput = [NativeSmoke]::ForegroundContext()
    $report.snapshots.Add([pscustomobject]$row)
    $row | ConvertTo-Json -Depth 15 | Set-Content "$prefix.json"
    if (-not $approvalPending -and $ExerciseLogin -and -not $report.loginInput -and
        (Get-Content $debugLog -Raw).Contains('BUNS_RUNTIME initialize-success')) {
        $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
        if ($window -and @($row.screenshots | Where-Object visualContent).Count -gt 0 -and
            -not @($row.windows | Where-Object { $_.ProcessId -eq $window.ProcessId -and $_.Visible -and $_.Class -eq '#32770' }).Count) {
            $backend = Get-Content $backendResult -Raw | ConvertFrom-Json
            $java = Get-Process -Id $backend.serverPid -ErrorAction Stop
            $mysql = Get-Process -Id $backend.mysqlPid -ErrorAction Stop
            if ($java.ProcessName -ne 'java' -or $mysql.ProcessName -ne 'mysqld') { throw 'QA backend PID identity changed before ordinary login input' }
            $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8484 -OwningProcess $backend.serverPid -ErrorAction Stop)
            if (-not $listeners.Count) { throw 'Real QA backend has no login listener at ordinary input time' }
            $report.loginInput = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'; username = 'bunsrcqa'; hwnd = $window.Handle
                javaPid = $java.Id; javaCreationUtc = $java.StartTime.ToUniversalTime().ToString('O')
                mysqlPid = $mysql.Id; mysqlCreationUtc = $mysql.StartTime.ToUniversalTime().ToString('O')
                foregroundBeforeCredentials = [NativeSmoke]::ForegroundContext()
                keyboardDelivery = 'Normal mapped Windows key down/up, 100ms each; owned foreground checked for every character'
                actualAuthentication = 'PENDING server/UI evidence'
                basis = 'Observed native window/nonuniform screenshot, completed normal Windows approval and live owned backend/listener; input submission is not authentication proof.' }
            try {
                $report.accountBeforeLogin = Read-QAAccountState
                if ($report.accountBeforeLogin.status -ne 'account-not-found') {
                    throw 'Expected disposable QA account already exists before credentials; preserve stale-state evidence rather than resetting or seeding authentication'
                }
                [NativeSmoke]::ClickClient($window, 470, 245)
                [NativeSmoke]::TypeClientText($window, 'bunsrcqa')
                $report.loginInput.usernameEvidenceUtc = [DateTime]::UtcNow.ToString('O')
                $report.loginInput.usernameEvidence = Save-Screenshot $window.ClientX $window.ClientY $window.ClientWidth $window.ClientHeight (Join-Path $OutputDirectory 'ordinary-login-id-before-password.png')
                [NativeSmoke]::ClickClient($window, 470, 279)
                [NativeSmoke]::TypeClientText($window, $script:qaPassword)
                [NativeSmoke]::ClickClient($window, 640, 245)
                $report.loginInput.status = 'submitted-normal-OS-login-input'
            } catch { $report.loginInput.status = 'failed'; $report.loginInput.error = $_.Exception.ToString(); throw }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.loginInput.status -eq 'submitted-normal-OS-login-input' -and
        -not $report.termsAction -and ([datetime]$row.utc) -gt ([datetime]$report.loginInput.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeTerms = $state
        if ($state.status -eq 'observed') {
            if ($state.account.tos -eq 0) {
                $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
                if ($window) {
                    $report.termsAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'
                        scope = 'Owned disposable QA account; normal visible terms scrollbar and OK, never a direct DB update or synthetic acceptance packet' }
                    try {
                        [NativeSmoke]::DragClient($window, 580, 104, 580, 396)
                        [NativeSmoke]::ClickClient($window, 482, 435)
                        $report.termsAction.status = 'submitted-normal-scroll-and-confirm'
                    } catch { $report.termsAction.status = 'failed'; $report.termsAction.error = $_.Exception.ToString(); throw }
                }
            } else {
                $report.termsAction = [pscustomobject]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'already-accepted-account-state'; observation = $state }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.termsAction -and -not $report.genderAction -and
        ([datetime]$row.utc) -gt ([datetime]$report.termsAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeGender = $state
        if ($state.status -eq 'observed' -and $state.account.tos -eq 1 -and
            $state.account.gender -eq 10 -and $state.account.loggedin -eq 2) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.genderAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'
                    scope = 'Owned disposable QA account; normal OK on the observed default Male dialog, never a database state change or synthetic acceptance packet' }
                try {
                    [NativeSmoke]::ClickClient($window, 577, 364)
                    $report.genderAction.status = 'submitted-normal-gender-confirm'
                } catch { $report.genderAction.status = 'failed'; $report.genderAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.genderAction.status -eq 'submitted-normal-gender-confirm' -and
        -not $report.worldButtonAction -and ([datetime]$row.utc) -gt ([datetime]$report.genderAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeWorldButton = $state
        if ($state.status -eq 'observed' -and $state.account.tos -eq 1 -and
            $state.account.gender -eq 0 -and $state.account.loggedin -eq 2) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.worldButtonAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'
                    scope = 'Normal click on observed Scania world button; input alone does not prove channel selection, character creation or world entry' }
                try {
                    [NativeSmoke]::ClickClient($window, 245, 160)
                    $report.worldButtonAction.status = 'submitted-normal-world-button-click'
                } catch { $report.worldButtonAction.status = 'failed'; $report.worldButtonAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.worldButtonAction.status -eq 'submitted-normal-world-button-click' -and
        -not $report.channelButtonAction -and ([datetime]$row.utc) -gt ([datetime]$report.worldButtonAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeChannelButton = $state
        if ($state.status -eq 'observed' -and $state.account.tos -eq 1 -and
            $state.account.gender -eq 0 -and $state.account.loggedin -eq 2) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.channelButtonAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'
                    scope = 'Normal CH1 and Enter Channel clicks on the observed native chooser; character/world entry remains pending actual screen/server evidence' }
                try {
                    [NativeSmoke]::ClickClient($window, 270, 294)
                    [NativeSmoke]::ClickClient($window, 570, 460)
                    $report.channelButtonAction.status = 'submitted-normal-channel-button-click'
                } catch { $report.channelButtonAction.status = 'failed'; $report.channelButtonAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.channelButtonAction.status -eq 'submitted-normal-channel-button-click' -and
        -not $report.createButtonAction -and ([datetime]$row.utc) -gt ([datetime]$report.channelButtonAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeCreateButton = $state
        if ($state.status -eq 'observed' -and $state.account.tos -eq 1 -and
            $state.account.gender -eq 0 -and $state.account.loggedin -eq 2 -and @($state.account.characters).Count -eq 0) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.createButtonAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'
                    scope = 'Normal Create a Character click on the observed empty character chooser; no database-created character or world-entry claim' }
                try {
                    [NativeSmoke]::ClickClient($window, 625, 205)
                    $report.createButtonAction.status = 'submitted-normal-create-character-click'
                } catch { $report.createButtonAction.status = 'failed'; $report.createButtonAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.createButtonAction.status -eq 'submitted-normal-create-character-click' -and
        -not $report.explorerTypeAction -and ([datetime]$row.utc) -gt ([datetime]$report.createButtonAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeExplorerType = $state
        if ($state.status -eq 'observed' -and $state.account.tos -eq 1 -and
            $state.account.gender -eq 0 -and $state.account.loggedin -eq 2 -and @($state.account.characters).Count -eq 0) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.explorerTypeAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'
                    scope = 'Normal Select on the observed default Explorers character-type menu; no invented character or world-entry claim' }
                try {
                    [NativeSmoke]::ClickClient($window, 566, 416)
                    $report.explorerTypeAction.status = 'submitted-normal-explorer-type-select'
                } catch { $report.explorerTypeAction.status = 'failed'; $report.explorerTypeAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.explorerTypeAction.status -eq 'submitted-normal-explorer-type-select' -and
        -not $report.characterNameAction -and ([datetime]$row.utc) -gt ([datetime]$report.explorerTypeAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeCharacterName = $state
        if ($state.status -eq 'observed' -and $state.account.tos -eq 1 -and
            $state.account.gender -eq 0 -and $state.account.loggedin -eq 2 -and @($state.account.characters).Count -eq 0) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.characterNameAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'; name = 'WinRcQa'
                    scope = 'Normal typed name and OK on the observed native character-name screen; no database-created character or world-entry claim' }
                try {
                    [NativeSmoke]::ClickClient($window, 582, 211)
                    [NativeSmoke]::TypeClientText($window, 'WinRcQa')
                    $report.characterNameAction.nameEvidence = Save-Screenshot $window.ClientX $window.ClientY $window.ClientWidth $window.ClientHeight (Join-Path $OutputDirectory 'ordinary-character-name.png')
                    [NativeSmoke]::ClickClient($window, 548, 294)
                    $report.characterNameAction.status = 'submitted-normal-character-name'
                } catch { $report.characterNameAction.status = 'failed'; $report.characterNameAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.characterNameAction.status -eq 'submitted-normal-character-name' -and
        -not $report.appearanceAction -and ([datetime]$row.utc) -gt ([datetime]$report.characterNameAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeAppearance = $state
        if ($state.status -eq 'observed' -and $state.account.tos -eq 1 -and
            $state.account.gender -eq 0 -and $state.account.loggedin -eq 2 -and @($state.account.characters).Count -eq 0) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.appearanceAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'
                    scope = 'Normal OK on observed default Character Settings; actual server character creation remains required, never seeded' }
                try {
                    [NativeSmoke]::ClickClient($window, 559, 445)
                    $report.appearanceAction.status = 'submitted-normal-default-appearance'
                } catch { $report.appearanceAction.status = 'failed'; $report.appearanceAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.appearanceAction.status -eq 'submitted-normal-default-appearance' -and
        -not $report.characterStartAction -and ([datetime]$row.utc) -gt ([datetime]$report.appearanceAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforeCharacterStart = $state
        $created = @($state.account.characters | Where-Object { $_.name -eq $report.characterNameAction.name -and $_.id -gt 0 -and $_.world -eq 0 })
        if ($state.status -eq 'observed' -and $state.account.loggedin -eq 2 -and $created.Count -eq 1) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.characterStartAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'; characterId = $created[0].id
                    scope = 'Normal first character slot and observed Start button after genuine persisted creation; next native screen/world requires actual review' }
                try {
                    [NativeSmoke]::ClickClient($window, 255, 333)
                    [NativeSmoke]::ClickClient($window, 624, 160)
                    $report.characterStartAction.status = 'submitted-normal-character-start'
                } catch { $report.characterStartAction.status = 'failed'; $report.characterStartAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
    if (-not $approvalPending -and $ExerciseLogin -and $report.characterStartAction.status -eq 'submitted-normal-character-start' -and
        -not $report.picAction -and ([datetime]$row.utc) -gt ([datetime]$report.characterStartAction.utc).AddSeconds(2)) {
        $state = Read-QAAccountState
        $report.accountBeforePic = $state
        $created = @($state.account.characters | Where-Object { $_.id -eq $report.characterStartAction.characterId })
        if ($state.status -eq 'observed' -and $state.account.loggedin -eq 2 -and
            -not $state.account.picConfigured -and $created.Count -eq 1) {
            $window = @($row.windows | Where-Object { $_.Visible -and $_.Class -eq 'MapleStoryClass' -and $_.ClientWidth -eq 800 -and $_.ClientHeight -eq 600 }) | Select-Object -First 1
            if ($window) {
                $report.picAction = [ordered]@{ utc = [DateTime]::UtcNow.ToString('O'); status = 'attempting'
                    scope = 'Normal mouse clicks on live-recognized stock PIC digits and OK; no old layout reuse, forced text, PIC disablement or direct auth write' }
                try {
                    foreach ($digit in $script:qaPic.ToCharArray()) {
                        [NativeSmoke]::MoveClientPointer($window, 320, 150)
                        $keys = Get-StockPicDigitPositions $window
                        $point = $keys[$digit.ToString()]
                        [NativeSmoke]::ClickClient($window, $point.X, $point.Y)
                        Start-Sleep -Milliseconds 100
                    }
                    $report.picAction.entryEvidence = Save-Screenshot $window.ClientX $window.ClientY $window.ClientWidth $window.ClientHeight (Join-Path $OutputDirectory 'ordinary-pic-before-confirm.png')
                    [NativeSmoke]::ClickClient($window, 370, 408)
                    $report.picAction.status = 'submitted-normal-pic-mouse-input'
                } catch { $report.picAction.status = 'failed'; $report.picAction.error = $_.Exception.ToString(); throw }
            }
        }
    }
}

try {
    if ($ExerciseLogin) {
        if ($GameHost -ne '127.0.0.1') { throw 'Disposable QA login input requires the isolated loopback test backend' }
        $script:qaPassword = [Guid]::NewGuid().ToString('N').Substring(0, 10)
        Write-Output "::add-mask::$script:qaPassword"
        $script:qaPic = [Security.Cryptography.RandomNumberGenerator]::GetInt32(100000, 1000000).ToString([Globalization.CultureInfo]::InvariantCulture)
        Write-Output "::add-mask::$script:qaPic"
    }
    $report.publicAccess = 'Activation deferred by user; unchanged public ports are not re-probed'
    if ($BaselineUrl.Scheme -ne 'https' -or $BaselineFilesBaseUrl.Scheme -ne 'https') {
        throw 'Native baseline provenance and bytes must use explicit SHA256-pinned HTTPS URLs'
    }
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    if (-not ('NativeSmoke' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'NativeSmoke.cs') }
    if ($PreparedGameDirectory) {
        if (-not $PublishedRuntimeControl) { throw 'Prepared game reuse is only for the exact published-runtime control' }
        $PreparedGameDirectory = [IO.Path]::GetFullPath($PreparedGameDirectory)
        $manifestPath = Join-Path (Split-Path $PreparedGameDirectory -Parent) 'baseline-provenance.json'
    } else {
        $manifestPath = Join-Path $OutputDirectory 'baseline-provenance.json'
        Invoke-WebRequest $BaselineUrl.AbsoluteUri -OutFile $manifestPath -TimeoutSec 60
    }
    $actualSha = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.baselineActualSha256 = $actualSha
    if ($actualSha -ne $BaselineSha256.ToLowerInvariant()) { throw "Baseline provenance SHA256 mismatch: $actualSha" }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if (-not $manifest.files -or $manifest.files.Count -eq 0) { throw 'Native provenance contains no files' }
    $isClientManifest = $manifest.completeProfiles -contains 'kaentake'
    if ($PublishedRuntimeControl -and -not $isClientManifest) { throw 'Published runtime control requires a pinned complete client manifest' }
    $report.inputKind = if ($PublishedRuntimeControl) { 'Exact published runtime control A; NOT a feature-release fallback' } elseif ($isClientManifest) { 'Pinned complete full-content client manifest; compiled runtime overlay B for causal QA' } else { 'Pinned complete native provenance' }
    $assetFiles = $manifest.files
    $referenceUrl = [uri]'https://buns.asslorde.com/client/candidates/wz-candidate-6/provenance-manifest.json'
    $referenceBase = [uri]'https://buns.asslorde.com/client/candidates/wz-candidate-6/'
    $referenceSha256 = 'a23ed4910cc0d19e63d3ce0f625eb5320be93c6807940d75be1440ee46bef810'
    if ($ReferenceAssetControl) {
        if (-not $PublishedRuntimeControl -or -not $PreparedGameDirectory -or -not $isClientManifest) {
            throw 'Reference assets are only an internal prepared exact-published-runtime control'
        }
        $referencePath = Join-Path (Split-Path $PreparedGameDirectory -Parent) 'reference-provenance.json'
        if ((Get-FileHash $referencePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $referenceSha256) {
            throw 'Previously working reference provenance SHA256 mismatch'
        }
        $assetFiles = (Get-Content $referencePath -Raw | ConvertFrom-Json).files
        $selected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($name in $DiagnosticFullArchives) {
            $old = @($assetFiles | Where-Object name -eq $name)
            $full = @($manifest.files | Where-Object name -eq $name)
            if (-not $selected.Add($name) -or $name -notmatch '^[A-Za-z]+\.wz$' -or
                $old.Count -ne 1 -or $full.Count -ne 1 -or $old[0].sha256 -eq $full[0].hash) {
                throw "Invalid diagnostic archive delta: $name"
            }
        }
        $assetFiles = @(foreach ($old in $assetFiles) {
            if ($selected.Contains($old.name)) {
                $full = $manifest.files | Where-Object name -eq $old.name
                [pscustomobject]@{ name = $full.name; size = $full.size; sha256 = $full.hash }
            } else { $old }
        })
        $report.diagnosticFullArchives = @($DiagnosticFullArchives)
        $report.referenceAssetAuthority = [pscustomobject]@{ url = $referenceUrl.AbsoluteUri; sha256 = $referenceSha256 }
        $report.inputKind = 'INTERNAL previously working reference51 assets + exact published e363 runtime; NOT a release/fallback'
        if ($DiagnosticFullArchives.Count) {
            $report.inputKind = 'INTERNAL archive bisection: reference51 plus explicitly recorded full archives; NEVER a release/fallback'
        }
        if ($DiagnosticItemVariant) {
            $variantUrl = [uri]$DiagnosticItemVariant.url
            if ($selected.Contains('Item.wz') -or $DiagnosticItemVariant.sha256 -notmatch '^[a-f0-9]{64}$' -or
                $DiagnosticItemVariant.size -le 0 -or -not $variantUrl.IsAbsoluteUri -or $variantUrl.Scheme -ne 'https') {
                throw 'Invalid/conflicting internal Item variant authority'
            }
            $assetFiles = @(foreach ($old in $assetFiles) {
                if ($old.name -eq 'Item.wz') {
                    [pscustomobject]@{ name = 'Item.wz'; size = $DiagnosticItemVariant.size; sha256 = $DiagnosticItemVariant.sha256 }
                } else { $old }
            })
            $report.diagnosticItemVariant = $DiagnosticItemVariant
            $report.inputKind = 'INTERNAL genuine Item-image diagnostic variant with reference51; NEVER a release/fallback'
        }
        $supportByName = @{}
        foreach ($support in $DiagnosticSupportFiles) {
            $supportUrl = [uri]$support.url
            if ($support.name -notin @('String.wz', 'Skill.wz', 'Character.wz', 'Effect.wz', 'Map.wz', 'Mob.wz', 'Npc.wz') -or $supportByName.ContainsKey($support.name) -or $selected.Contains($support.name) -or
                $support.sha256 -notmatch '^[a-f0-9]{64}$' -or $support.size -le 0 -or -not $supportUrl.IsAbsoluteUri -or $supportUrl.Scheme -ne 'https') {
                throw 'Invalid/conflicting diagnostic support-archive authority'
            }
            $supportByName[$support.name] = $support
        }
        $assetFiles = @(foreach ($old in $assetFiles) {
            if ($supportByName.ContainsKey($old.name)) {
                $support = $supportByName[$old.name]
                [pscustomobject]@{ name = $old.name; size = $support.size; sha256 = $support.sha256 }
            } else { $old }
        })
        $report.diagnosticSupportFiles = @($DiagnosticSupportFiles)
    }
    $report.sourceCommit = $env:GITHUB_SHA
    $game = if ($PreparedGameDirectory) { $PreparedGameDirectory } else { Join-Path $OutputDirectory 'baseline' }
    New-Item -ItemType Directory -Force $game | Out-Null
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $base = [uri]($BaselineFilesBaseUrl.AbsoluteUri.TrimEnd('/') + '/')
    $verifiedFiles = [Collections.Generic.List[object]]::new()
    $report.verifiedBaselineFiles = $verifiedFiles
    foreach ($file in $assetFiles) {
        $expectedHash = if ($isClientManifest -and -not $ReferenceAssetControl) { $file.hash } else { $file.sha256 }
        if (-not $file.name -or $expectedHash -notmatch '^[0-9a-fA-F]{64}$' -or $file.size -le 0) {
            throw 'Invalid native provenance file record'
        }
        if (-not $names.Add($file.name.Replace('\', '/'))) { throw "Case-colliding native filename: $($file.name)" }
        $destination = [IO.Path]::GetFullPath((Join-Path $game $file.name))
        if (-not $destination.StartsWith($game + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Native filename escapes baseline directory: $($file.name)"
        }
        $encoded = (($file.name.Replace('\', '/') -split '/') | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
        $url = if ($ReferenceAssetControl -and $DiagnosticItemVariant -and $file.name -eq 'Item.wz') { [uri]$DiagnosticItemVariant.url } elseif ($ReferenceAssetControl -and $supportByName.ContainsKey($file.name)) { [uri]($supportByName[$file.name].url) } elseif ($ReferenceAssetControl -and $selected.Contains($file.name)) { [uri]($manifest.files | Where-Object name -eq $file.name).url } elseif ($ReferenceAssetControl) { [uri]::new($referenceBase, $encoded) } elseif ($isClientManifest) { [uri]$file.url } else { [uri]::new($base, $encoded) }
        if (-not $url.IsAbsoluteUri -or $url.Scheme -ne 'https') { throw "Native file URL must be pinned HTTPS: $($file.name)" }
        New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($destination)) | Out-Null
        $report.currentDownload = [ordered]@{ name = $file.name; url = $url.AbsoluteUri; expectedSize = $file.size; expectedSha256 = $expectedHash; startedUtc = [DateTime]::UtcNow.ToString('O'); status = 'downloading' }
        if (-not $PreparedGameDirectory) { Invoke-WebRequest $url.AbsoluteUri -OutFile $destination -TimeoutSec 900 }
        $sha = (Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ((Get-Item $destination).Length -ne $file.size -or $sha -ne $expectedHash.ToLowerInvariant()) {
            throw "Native baseline size/SHA256 mismatch: $($file.name)"
        }
        $verifiedFiles.Add([pscustomobject]@{ name = $file.name; size = $file.size; sha256 = $sha; url = $url.AbsoluteUri })
        $report.currentDownload.status = 'verified'
        $report.currentDownload.finishedUtc = [DateTime]::UtcNow.ToString('O')
    }
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
    if ($isClientManifest) {
        $publishedPath = Join-Path (Split-Path $game -Parent) 'published-provenance.json'
        if (-not $PreparedGameDirectory) {
            $publishedUrl = [uri]$manifest.provenance.url
            if ($publishedUrl.Scheme -ne 'https') { throw 'Published control provenance must use pinned HTTPS' }
            Invoke-WebRequest $publishedUrl.AbsoluteUri -OutFile $publishedPath -TimeoutSec 60
        }
        if ((Get-FileHash $publishedPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.provenance.sha256) { throw 'Published control provenance SHA256 mismatch' }
        $published = Get-Content $publishedPath -Raw | ConvertFrom-Json
        $report.publishedRuntimeSource = $published.runtimeSourceCommit
        if (-not $PublishedRuntimeControl) {
            # Preserve publisher bytes before any child applies the explicit QA host.
            $publisherConfigPath = Join-Path $OutputDirectory 'private-published-config.ini'
            Copy-Item (Join-Path $game 'config.ini') $publisherConfigPath
            $controlDirectory = Join-Path $OutputDirectory 'published-control'
            # Keep runtime/backend/observer fixed; cache only hash-different archives.
            $referencePath = Join-Path $OutputDirectory 'reference-provenance.json'
            Invoke-WebRequest $referenceUrl.AbsoluteUri -OutFile $referencePath -TimeoutSec 60
            if ((Get-FileHash $referencePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $referenceSha256) {
                throw 'Previously working reference provenance SHA256 mismatch'
            }
            $reference = Get-Content $referencePath -Raw | ConvertFrom-Json
            $deltaRoot = Join-Path $OutputDirectory 'private-asset-deltas'
            $referenceRoot = Join-Path $deltaRoot 'reference'
            $fullRoot = Join-Path $deltaRoot 'full'
            New-Item -ItemType Directory -Force $referenceRoot, $fullRoot | Out-Null
            $deltas = [Collections.Generic.List[object]]::new()
            $report.assetDeltas = $deltas
            foreach ($old in $reference.files) {
                $current = @($manifest.files | Where-Object name -eq $old.name)
                if ($current.Count -ne 1) { throw "Reference file absent/ambiguous in full manifest: $($old.name)" }
                if ($old.sha256 -eq $current[0].hash -and $old.size -eq $current[0].size) { continue }
                if ($old.name -notmatch '^[A-Za-z]+\.wz$') { throw "Non-archive delta invalidates this experiment: $($old.name)" }
                $cached = Join-Path $referenceRoot $old.name
                $referenceFileUrl = [uri]::new($referenceBase, [uri]::EscapeDataString($old.name))
                $report.currentDownload = [ordered]@{ name = $old.name; url = $referenceFileUrl.AbsoluteUri; expectedSize = $old.size; expectedSha256 = $old.sha256; status = 'downloading-reference-delta' }
                Invoke-WebRequest $referenceFileUrl.AbsoluteUri -OutFile $cached -TimeoutSec 900
                if ((Get-Item $cached).Length -ne $old.size -or (Get-FileHash $cached -Algorithm SHA256).Hash.ToLowerInvariant() -ne $old.sha256) {
                    throw "Reference archive size/SHA256 mismatch: $($old.name)"
                }
                $report.currentDownload.status = 'verified'
                $deltas.Add([pscustomobject]@{ name = $old.name; referenceSha256 = $old.sha256; referenceSize = $old.size; fullSha256 = $current[0].hash; fullSize = $current[0].size })
            }
            foreach ($delta in $deltas) {
                Move-Item (Join-Path $game $delta.name) (Join-Path $fullRoot $delta.name)
                Copy-Item (Join-Path $referenceRoot $delta.name) (Join-Path $game $delta.name)
            }
            $password = $script:qaPassword
            & $PSCommandPath -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 -BaselineFilesBaseUrl $BaselineFilesBaseUrl `
                -KaentakeArtifact $KaentakeArtifact -CompanionArtifact $CompanionArtifact -RuntimeArtifact $RuntimeArtifact `
                -OutputDirectory $controlDirectory -ObserveSeconds $ObserveSeconds -GameHost $GameHost `
                -PreparedGameDirectory $game -PublishedRuntimeControl -ReferenceAssetControl
            $controlExit = $LASTEXITCODE
            $script:qaPassword = $password
            $script:snapshotIndex = 0
            $control = Get-Content (Join-Path $controlDirectory 'result.json') -Raw | ConvertFrom-Json
            $report.publishedControl = [pscustomobject]@{ source = $published.runtimeSourceCommit; exitCode = $controlExit; status = $control.status; nativeUiObserved = $control.nativeUiObserved; initializeSuccessObserved = $control.initializeSuccessObserved; capsAckObserved = $control.capsAckObserved; error = $control.error; directory = $controlDirectory }
            if ($control.status -ne 'native-startup-observed') {
                throw 'Previously working reference51 control did not boot now: STOP asset attribution/bisection; reconsider environment/observer before any asset fix'
            }
            if ($ItemImageVariantsUrl) {
                $contextPath = Join-Path $OutputDirectory 'item-reference-context.json'
                Invoke-WebRequest $ItemImageVariantsUrl -OutFile $contextPath -TimeoutSec 60
                if ((Get-FileHash $contextPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ItemImageVariantsSha256) {
                    throw 'Diagnostic reference-context descriptor SHA256 mismatch'
                }
                $context = Get-Content $contextPath -Raw | ConvertFrom-Json
                if ($context.supportCohort -eq 'reference') {
                    Copy-Item (Join-Path $controlDirectory 'kernel-backend-ready.json') (Join-Path $OutputDirectory 'kernel-backend-ready.json')
                    & (Join-Path $PSScriptRoot 'probe-native-item-images.ps1') -OutputDirectory $OutputDirectory -GameDirectory $game `
                        -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 -BaselineFilesBaseUrl $BaselineFilesBaseUrl `
                        -KaentakeArtifact $KaentakeArtifact -CompanionArtifact $CompanionArtifact -RuntimeArtifact $RuntimeArtifact `
                        -ObserveSeconds $ObserveSeconds -GameHost $GameHost -VariantsUrl $ItemImageVariantsUrl -VariantsSha256 $ItemImageVariantsSha256
                    $report.itemImageProbes = Get-Content (Join-Path $OutputDirectory 'item-image-probes.json') -Raw | ConvertFrom-Json
                    if (@($context.variants | Where-Object { $_.isolateRemainingFullArchives -eq $true }).Count) {
                        $report.archiveBisection = $report.itemImageProbes.archiveIsolation
                        $report.inputKind = 'INTERNAL constant pinned Item/String control plus remaining full archives; no release or compiled-runtime acceptance'
                        if ($report.archiveBisection.status -ne 'remaining-full-archives-startup-observed') {
                            throw 'Remaining-full-archive experiment stopped; inspect constant-base control and bounded archive observations, not an assumed node/root cause'
                        }
                        $report.status = 'remaining-full-archive-observations-complete'
                        return
                    }
                    $report.inputKind = 'INTERNAL reference context plus descriptor-pinned Item/support-archive overrides; no full-support game attempt or compiled runtime overlay'
                    if ($report.itemImageProbes.status -ne 'image-variant-observations-complete' -or
                        @($report.itemImageProbes.steps | Where-Object outcome -eq 'startup-failed').Count) {
                        throw 'Reference-only asset experiment stopped; inspect actual pinned variant observations'
                    }
                    if ($ExerciseLogin) {
                        $lastStep = @($report.itemImageProbes.steps)[-1]
                        $loginVariants = @($context.variants | Where-Object id -eq $lastStep.id)
                        if ($loginVariants.Count -ne 1) { throw 'Ordinary login needs the exact successfully observed variant authority' }
                        $loginVariant = $loginVariants[0]
                        $loginSupport = @($loginVariant.supportFiles | Where-Object { $_ })
                        $loginDirectory = Join-Path $OutputDirectory 'ordinary-login'
                        & $PSCommandPath -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 -BaselineFilesBaseUrl $BaselineFilesBaseUrl `
                            -KaentakeArtifact $KaentakeArtifact -CompanionArtifact $CompanionArtifact -RuntimeArtifact $RuntimeArtifact `
                            -OutputDirectory $loginDirectory -ObserveSeconds 300 -GameHost $GameHost `
                            -PreparedGameDirectory $game -PublishedRuntimeControl -ReferenceAssetControl `
                            -DiagnosticItemVariant $loginVariant -DiagnosticSupportFiles $loginSupport -ExerciseLogin
                        $login = Get-Content (Join-Path $loginDirectory 'result.json') -Raw | ConvertFrom-Json
                        $report.ordinaryLogin = [pscustomobject]@{ directory = $loginDirectory; status = $login.status; error = $login.error
                            input = $login.loginInput; foregroundAttempt = $login.foregroundAttempt
                            termsAction = $login.termsAction; genderAction = $login.genderAction; worldButtonAction = $login.worldButtonAction
                            channelButtonAction = $login.channelButtonAction; createButtonAction = $login.createButtonAction; accountAfterObservation = $login.accountAfterObservation
                            explorerTypeAction = $login.explorerTypeAction
                            characterNameAction = $login.characterNameAction
                            appearanceAction = $login.appearanceAction; characterStartAction = $login.characterStartAction
                            accountBeforeLogin = $login.accountBeforeLogin
                            picAction = $login.picAction
                            acceptance = 'PENDING actual UI/backend review. Submitted input is not account/world proof; published zero-mask runtime is an internal enabler only.' }
                        if ($login.status -ne 'native-startup-observed' -or $login.loginInput.status -ne 'submitted-normal-OS-login-input') {
                            throw 'Ordinary native login attempt failed; preserve actual UI/backend evidence, not an asset-root attribution'
                        }
                    }
                    $report.status = 'reference-image-observations-complete'
                    return
                }
            }
            foreach ($delta in $deltas) {
                Copy-Item (Join-Path $fullRoot $delta.name) (Join-Path $game $delta.name) -Force
                if ((Get-Item (Join-Path $game $delta.name)).Length -ne $delta.fullSize -or
                    (Get-FileHash (Join-Path $game $delta.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $delta.fullSha256) {
                    throw "Full archive restore failed: $($delta.name)"
                }
            }
            if ($ItemImageVariantsUrl) {
                $PublishedRuntimeControl = $true
                $report.publishedRuntimeControl = $true
                $report.inputKind = 'INTERNAL full assets vs reference51; exact published runtime/backend/observer, no compiled overlay or release fallback'
            } else {
                $report.fullRuntimeComparison = $true
                $report.referenceControl = $report.publishedControl
                $fullControlDirectory = Join-Path $OutputDirectory 'published-full-control'
                Copy-Item $publisherConfigPath (Join-Path $game 'config.ini') -Force
                $password = $script:qaPassword
                & $PSCommandPath -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 -BaselineFilesBaseUrl $BaselineFilesBaseUrl `
                    -KaentakeArtifact $KaentakeArtifact -CompanionArtifact $CompanionArtifact -RuntimeArtifact $RuntimeArtifact `
                    -OutputDirectory $fullControlDirectory -ObserveSeconds $ObserveSeconds -GameHost $GameHost `
                    -PreparedGameDirectory $game -PublishedRuntimeControl | Out-Null
                $script:qaPassword = $password
                $script:snapshotIndex = 0
                $fullControl = Get-Content (Join-Path $fullControlDirectory 'result.json') -Raw | ConvertFrom-Json
                $report.publishedControl = [pscustomobject]@{ source = $published.runtimeSourceCommit
                    status = $fullControl.status; initializeSuccessObserved = $fullControl.initializeSuccessObserved
                    nativeUiObserved = $fullControl.nativeUiObserved; capsAckObserved = $fullControl.capsAckObserved
                    error = $fullControl.error; runtimeFiles = $fullControl.publishedRuntimeFiles; directory = $fullControlDirectory }
                if ($fullControl.status -ne 'native-startup-observed') {
                    throw 'Full published-runtime control A failed; STOP before compiled-runtime B, with no readiness/runtime attribution'
                }
                $report.inputKind = 'INTERNAL full-cohort published-runtime A passed; current compiled-runtime B on the same verified full assets/backend/observer, never a release fallback'
            }
        }
    }
    if (-not $PublishedRuntimeControl) {
        $runtime = Join-Path $KaentakeArtifact 'Release'
        foreach ($file in @('Kaentake.exe', 'Kaentake.dll', 'Custom.wz')) { Copy-Item (Join-Path $runtime $file) (Join-Path $game $file) -Force }
        Copy-Item (Join-Path $CompanionArtifact 'BunsMS.dll') (Join-Path $game 'BunsMS.dll') -Force
        $crtManifest = Join-Path $RuntimeArtifact 'msvc-runtime-provenance.json'
        $report.crtProvenance = Get-Content $crtManifest -Raw | ConvertFrom-Json
        if ($report.crtProvenance.architecture -ne 'x86') { throw 'Required app-local CRT payload is not x86' }
        foreach ($file in $report.crtProvenance.files) {
            $source = Join-Path $RuntimeArtifact $file.name
            $sha = (Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
            if ((Get-Item $source).Length -ne $file.size -or $sha -ne $file.sha256) { throw "Microsoft app-local runtime payload mismatch: $($file.name)" }
            Copy-Item $source (Join-Path $game $file.name) -Force
        }
        Copy-Item $crtManifest (Join-Path $game 'msvc-runtime-provenance.json')
    } else {
        $report.publishedRuntimeFiles = @(foreach ($file in $manifest.files | Where-Object { $_.name -in @('Kaentake.exe', 'Kaentake.dll', 'Custom.wz', 'BunsMS.dll') -or $_.name -match '^(msvcp|vcruntime|vccorlib|concrt)[^/\\]*\.dll$' }) {
            $path = Join-Path $game $file.name
            $sha = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
            if ((Get-Item $path).Length -ne $file.size -or $sha -ne $file.hash) { throw "Exact published runtime changed: $($file.name)" }
            [pscustomobject]@{ name = $file.name; size = $file.size; sha256 = $sha }
        })
        if ($report.publishedRuntimeFiles.Count -ne 13) { throw 'Exact published native runtime control requires all thirteen pinned runtime files' }
    }
    "[config]`nhost=$GameHost`nport=8484`n" | Set-Content (Join-Path $game 'config.ini') -Encoding ascii
    $configPath = Join-Path $game 'config.ini'
    $report.stagedConfiguration = [pscustomobject]@{
        path = $configPath
        sha256 = (Get-FileHash $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
        text = Get-Content $configPath -Raw
        evidenceKind = 'Actual staged file bytes; consumed native values require the independent BUNS_RUNTIME consumed-config event'
    }
    $report.gameDirectory = $game
    $report.runtimeProvenance = if ($PublishedRuntimeControl) { [pscustomobject]@{ runtimeSourceCommit = $published.runtimeSourceCommit; runtimeRunId = $published.runtimeRunId; authority = 'SHA256-verified published full-profile provenance; no runtime overlay' } } else { Get-Content (Join-Path $KaentakeArtifact 'kaentake-build.json') -Raw | ConvertFrom-Json }
    $report.diagnosticOnly = [bool]$report.runtimeProvenance.diagnosticOnly
    $report.runtimeFiles = @(foreach ($file in @('MapleStory.exe', 'Gr2D_DX8.dll', 'Kaentake.exe', 'Kaentake.dll', 'Custom.wz', 'BunsMS.dll')) {
        $path = Join-Path $game $file
        [pscustomobject]@{ name = $file; size = (Get-Item $path).Length; sha256 = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    try {
        $stream = [IO.File]::Open((Join-Path $game 'MapleStory.exe'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        try {
            $reader = [IO.BinaryReader]::new($stream)
            $stream.Position = 0x3c
            $peOffset = $reader.ReadUInt32()
            $stream.Position = $peOffset
            if ($reader.ReadUInt32() -ne 0x4550) { throw 'Actual executable has no PE signature' }
            $machine = $reader.ReadUInt16()
            $stream.Position = $peOffset + 22
            $characteristics = $reader.ReadUInt16()
            $report.actualExecutableMemoryLayout = [pscustomobject]@{
                utc = [DateTime]::UtcNow.ToString('O'); path = Join-Path $game 'MapleStory.exe'
                machine = '{0:X4}' -f $machine; characteristics = '{0:X4}' -f $characteristics
                largeAddressAware = ($characteristics -band 0x20) -ne 0
                evidence = 'Actual on-disk PE header read-only; no PE/memory/guard changes. Does not prove an allocation failure or fragmentation limit.'
            }
        } finally { $stream.Dispose() }
    } catch { $report.executableMemoryLayoutObservationError = $_.Exception.Message }
    $debugLog = Join-Path $OutputDirectory 'native-debug.log'
    $captureSeconds = if ($ExerciseLogin) { [Math]::Max($ObserveSeconds, 600) } else { $ObserveSeconds }
    $report.observeSeconds = $captureSeconds
    $backendResult = [IO.Path]::GetFullPath('native-backend-output/result.json')
    if (Test-Path $backendResult) {
        $networkJob = Start-Job -FilePath (Join-Path $PSScriptRoot 'native-network-observe.ps1') -ArgumentList $OutputDirectory, $backendResult, ($captureSeconds + 60), (Join-Path $game 'MapleStory.exe')
        $observerDeadline = [DateTime]::UtcNow.AddSeconds(20)
        while (-not (Test-Path (Join-Path $OutputDirectory 'kernel-backend-ready.json'))) {
            if ($networkJob.State -in @('Failed', 'Completed') -or [DateTime]::UtcNow -gt $observerDeadline) {
                Receive-Job $networkJob
                throw 'Kernel/backend observer did not become ready before native process start'
            }
            Start-Sleep -Milliseconds 50
        }
        $report.networkObserver = 'Concurrent backend query handles and kernel TCP owner/address/port samples; no debugger, detour, socket replacement, or backend restart'
    }
    $callback = [Action[int[]]]{ param([int[]]$Ids) Save-NativeSnapshot $Ids }
    $report.nativeCaptureStartedUtc = [DateTime]::UtcNow.ToString('O')
    $report.processIds = [NativeSmoke]::Capture((Join-Path $game 'Kaentake.exe'), $game, $captureSeconds, $debugLog, $callback)
    Save-NativeSnapshot ([NativeSmoke]::LastProcessIds)
    $events = Get-Content $debugLog -Raw
    $report.naturalExits = @([regex]::Matches($events, '(?m)^EXIT_PROCESS pid=(\d+) code=(-?\d+) reason=natural-before-controller-cleanup\r?$') | ForEach-Object {
        $code = [int]$_.Groups[2].Value
        [pscustomobject]@{ processId = [int]$_.Groups[1].Value; exitCode = $code; exitHex = '{0:X8}' -f ([long]$code -band 0xffffffffL); controllerCleanup = $false }
    })
    $report.initializeSuccessObserved = $events.Contains('BUNS_RUNTIME initialize-success')
    $report.capsAckObserved = $events.Contains('BUNS_RUNTIME caps-ack ')
    $report.companionModuleObserved = $events -match 'MODULE_OBSERVED .*BunsMS\.dll'
    $report.captureMode = 'normal-process/passive-DBWIN; no debugger attached'
    $report.secondChanceExceptionObserved = $null # Not observable with this passive capture; never claim absence.
    $final = $report.snapshots[$report.snapshots.Count - 1]
    $report.gameAliveAfterObservation = @($final.processes | Where-Object { $_.name -eq 'MapleStory' -and $_.alive }).Count -gt 0
    $report.nativeUiObserved = @($final.screenshots | Where-Object visualContent).Count -gt 0
    $report.errorDialogObserved = @($final.windows | Where-Object { $_.Visible -and $_.Class -eq '#32770' }).Count -gt 0
    $failures = @($report.naturalExits | Where-Object { $_.exitCode -ne 0 })
    if ($failures.Count) { throw "Observed native process natural failure: $($failures | ConvertTo-Json -Compress). Cause remains unattributed; inspect independent crash receipts." }
    if ($ExerciseLogin) {
        $report.accountAfterObservation = Read-QAAccountState
        $report.accountAfterObservation | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $OutputDirectory 'qa-account-state.json')
        if ($report.accountAfterObservation.status -ne 'observed' -or
            $report.accountAfterObservation.account.name -ne $report.loginInput.username -or
            $report.accountAfterObservation.account.loggedin -ne 2) {
            throw 'Normal QA login did not authenticate the expected account; inspect actual UI and retained read-only account state, not input submission or startup-only green'
        }
        $report.loginInput.actualAuthentication = 'PASS: expected QA account observed authenticated by the real isolated server; character/world acceptance still requires actual evidence'
        if ($report.termsAction.status -eq 'failed') { throw 'Normal owned QA terms interaction failed; inspect actual UI and read-only account state' }
        if ($report.genderAction.status -eq 'failed') { throw 'Normal owned QA gender interaction failed; inspect actual UI and read-only account state' }
        if ($report.worldButtonAction.status -eq 'failed') { throw 'Normal owned QA world-button input failed; inspect actual native UI before any world acceptance claim' }
        if ($report.channelButtonAction.status -eq 'failed') { throw 'Normal owned QA channel-button input failed; inspect actual native UI before any character/world acceptance claim' }
        if ($report.createButtonAction.status -eq 'failed') { throw 'Normal owned QA character-creation input failed; inspect actual native UI before any character/world acceptance claim' }
        if ($report.explorerTypeAction.status -eq 'failed') { throw 'Normal owned QA character-type input failed; retain actual UI evidence' }
        if ($report.characterNameAction.status -eq 'failed') { throw 'Normal owned QA character-name input failed; retain actual UI evidence' }
        if ($report.appearanceAction.status -eq 'failed') { throw 'Normal owned QA appearance confirmation failed; retain actual UI evidence' }
        if ($report.characterStartAction.status -eq 'failed') { throw 'Normal owned QA character Start failed; retain actual UI evidence' }
        if ($report.picAction.status -eq 'failed') { throw 'Normal owned QA PIC input failed; retain actual native dialog and read-only registration state' }
        if ($report.appearanceAction.status -eq 'submitted-normal-default-appearance' -and
            @($report.accountAfterObservation.account.characters | Where-Object { $_.name -eq $report.characterNameAction.name -and $_.id -gt 0 -and $_.world -eq 0 }).Count -ne 1) {
            throw 'Normal QA character creation did not persist the expected character; no character/world pass from submitted input'
        }
        if ($report.genderAction.status -eq 'submitted-normal-gender-confirm' -and
            $report.accountAfterObservation.status -eq 'observed' -and $report.accountAfterObservation.account.gender -eq 10) {
            throw 'Normal QA gender confirmation did not persist; inspect actual UI before advancing account acceptance'
        }
    }
    if ($ExerciseLogin -and $report.loginInput.status -ne 'submitted-normal-OS-login-input') {
        throw 'Requested actual QA login input was not submitted; inspect observed native UI and input receipt'
    }
    if (-not $report.initializeSuccessObserved -or -not $report.companionModuleObserved -or -not $report.nativeUiObserved -or
        -not $report.gameAliveAfterObservation -or $report.errorDialogObserved) {
        throw 'Native startup acceptance not met; inspect actual windows, screenshots, passive process/DBWIN observations, and the deferred public-activation state'
    }
    $report.status = 'native-startup-observed'
} catch {
    $report.status = 'failed'
    $report.error = $_.Exception.ToString()
} finally {
    if ($networkJob) {
        [IO.File]::WriteAllText((Join-Path $OutputDirectory 'kernel-backend.stop'), [DateTime]::UtcNow.ToString('O'))
        Wait-Job $networkJob -Timeout 20 | Out-Null
        if ($networkJob.State -eq 'Running') { Stop-Job $networkJob; $report.networkObserverForcedStop = $true }
        $report.networkObserverState = $networkJob.State.ToString()
        Receive-Job $networkJob -ErrorAction Continue | Out-Null
        Remove-Job $networkJob
    }
    if ($report.nativeCaptureStartedUtc -and $game) {
        try {
            & (Join-Path $PSScriptRoot 'save-native-crash-evidence.ps1') -GameDirectory $game -OutputDirectory $OutputDirectory -StartedUtc ([datetime]$report.nativeCaptureStartedUtc)
        } catch { $report.crashEvidenceError = $_.Exception.ToString() }
    }
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
    if (-not $ReferenceAssetControl -and -not $report.fullRuntimeComparison -and $report.publishedControl.status -eq 'native-startup-observed' -and
        $report.status -eq 'failed' -and $report.nativeCaptureStartedUtc -and -not $report.nativeUiObserved) {
        try {
            if ($ItemImageVariantsUrl) {
                & (Join-Path $PSScriptRoot 'probe-native-item-images.ps1') -OutputDirectory $OutputDirectory -GameDirectory $game `
                    -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 -BaselineFilesBaseUrl $BaselineFilesBaseUrl `
                    -KaentakeArtifact $KaentakeArtifact -CompanionArtifact $CompanionArtifact -RuntimeArtifact $RuntimeArtifact `
                    -ObserveSeconds $ObserveSeconds -GameHost $GameHost -VariantsUrl $ItemImageVariantsUrl -VariantsSha256 $ItemImageVariantsSha256
                $report.itemImageProbes = Get-Content (Join-Path $OutputDirectory 'item-image-probes.json') -Raw | ConvertFrom-Json
            } else {
                & (Join-Path $PSScriptRoot 'isolate-native-archives.ps1') -OutputDirectory $OutputDirectory -GameDirectory $game `
                    -BaselineUrl $BaselineUrl -BaselineSha256 $BaselineSha256 -BaselineFilesBaseUrl $BaselineFilesBaseUrl `
                    -KaentakeArtifact $KaentakeArtifact -CompanionArtifact $CompanionArtifact -RuntimeArtifact $RuntimeArtifact `
                    -ObserveSeconds $ObserveSeconds -GameHost $GameHost
                $report.archiveBisection = Get-Content (Join-Path $OutputDirectory 'archive-bisection.json') -Raw | ConvertFrom-Json
            }
        } catch { $report.archiveBisectionError = $_.Exception.ToString() }
    }
    $report.finishedUtc = [DateTime]::UtcNow.ToString('O')
    $report | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $OutputDirectory 'result.json')
    $report | ConvertTo-Json -Depth 5 | Write-Output
}
if ($report.status -eq 'failed') { exit 1 }

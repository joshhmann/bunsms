param(
    [Parameter(Mandatory)][int]$OwnerProcessId,
    [Parameter(Mandatory)][string]$Directory,
    [Parameter(Mandatory)][string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FolderPickerWindow {
    private delegate bool Callback(IntPtr window, IntPtr context);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr context);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int count);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    private static uint owner;
    private static IntPtr found;
    private static bool Visit(IntPtr window, IntPtr context) {
        uint pid; GetWindowThreadProcessId(window, out pid);
        if (pid != owner || !IsWindowVisible(window)) return true;
        var name = new StringBuilder(64); GetClassName(window, name, name.Capacity);
        if (name.ToString() != "#32770") return true;
        found = window; return false;
    }
    public static IntPtr Find(int pid) {
        owner = (uint)pid; found = IntPtr.Zero;
        EnumWindows(Visit, IntPtr.Zero); return found;
    }
}
'@
New-Item -ItemType Directory -Force $EvidenceDirectory | Out-Null
$record = [ordered]@{ startedUtc = [DateTime]::UtcNow.ToString('O'); ownerProcessId = $OwnerProcessId; requestedDirectory = $Directory; mode = 'Actual owned Windows common dialog and ordinary keyboard/default-button input; no Electron dialog stub or direct path IPC' }
function Save-Desktop([string]$Name) {
    $bounds = [Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = [Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size); $bitmap.Save((Join-Path $EvidenceDirectory $Name), [Drawing.Imaging.ImageFormat]::Png) }
    finally { $graphics.Dispose(); $bitmap.Dispose() }
}
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $window = [FolderPickerWindow]::Find($OwnerProcessId)
        if ($window -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($window -eq [IntPtr]::Zero) { throw 'No visible owned native folder dialog appeared' }
    $record.dialogHandle = '0x{0:X}' -f $window.ToInt64()
    Save-Desktop 'folder-dialog-before.png'
    if (-not [FolderPickerWindow]::SetForegroundWindow($window)) { throw 'Native folder dialog could not receive ordinary keyboard focus' }
    $escaped = [regex]::Replace([IO.Path]::GetFullPath($Directory), '[+^%~(){}\[\]]', { param($match) '{' + $match.Value + '}' })
    [Windows.Forms.SendKeys]::SendWait('%d')
    [Windows.Forms.SendKeys]::SendWait($escaped + '{ENTER}')
    Start-Sleep -Milliseconds 700
    $accept = [FolderPickerWindow]::GetDlgItem($window, 1)
    if ($accept -eq [IntPtr]::Zero) { throw 'Owned common folder dialog has no default acceptance control' }
    [void][FolderPickerWindow]::SendMessage($accept, 0x00f5, [IntPtr]::Zero, [IntPtr]::Zero)
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([FolderPickerWindow]::Find($OwnerProcessId) -eq $window -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if ([FolderPickerWindow]::Find($OwnerProcessId) -eq $window) { throw 'Actual folder dialog did not close after selection' }
    Save-Desktop 'folder-dialog-after.png'
    $record.status = 'native-dialog-selection-submitted'
    $record.limit = 'Renderer/profile filesystem postcondition must independently confirm the selected path; dialog closure alone is not an install pass.'
} catch { $record.status = 'failed'; $record.error = $_.Exception.ToString(); throw }
finally {
    $record.finishedUtc = [DateTime]::UtcNow.ToString('O')
    $record | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $EvidenceDirectory 'folder-dialog-result.json')
}

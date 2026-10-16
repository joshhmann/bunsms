using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeSmoke
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public uint Size; public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize; public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct CreateProcessInfo
    {
        public IntPtr File, Process, Thread, Base;
        public uint DebugOffset, DebugSize;
        public IntPtr ThreadLocalBase, Start, ImageName; public ushort Unicode;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct LoadDllInfo
    {
        public IntPtr File, Base; public uint DebugOffset, DebugSize;
        public IntPtr ImageName; public ushort Unicode;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct DebugStringInfo { public IntPtr Address; public ushort Unicode, Length; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExceptionRecord
    {
        public uint Code, Flags; public IntPtr Nested, Address; public uint Count;
        public UIntPtr I0, I1, I2, I3, I4, I5, I6, I7, I8, I9, I10, I11, I12, I13, I14;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExceptionInfo { public ExceptionRecord Record; public uint FirstChance; }
    // The smoke runner is 64-bit PowerShell, even when the debuggee is Win32.
    [StructLayout(LayoutKind.Explicit, Size = 176)]
    private struct DebugEvent
    {
        [FieldOffset(0)] public uint Code;
        [FieldOffset(4)] public uint ProcessId;
        [FieldOffset(8)] public uint ThreadId;
        [FieldOffset(16)] public CreateProcessInfo Create;
        [FieldOffset(16)] public LoadDllInfo Dll;
        [FieldOffset(16)] public DebugStringInfo String;
        [FieldOffset(16)] public ExceptionInfo Exception;
        [FieldOffset(16)] public IntPtr Thread;
        [FieldOffset(16)] public uint ExitCode;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr pa, IntPtr ta,
        bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool WaitForDebugEvent(out DebugEvent e, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ContinueDebugEvent(uint pid, uint tid, uint status);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DebugActiveProcessStop(uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DebugSetProcessKillOnExit(bool kill);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] data, UIntPtr length, out UIntPtr read);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(IntPtr file, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    private static string FilePath(IntPtr file)
    {
        if (file == IntPtr.Zero || file == new IntPtr(-1)) return "<no-file-handle>";
        var path = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(file, path, (uint)path.Capacity, 0);
        return length > 0 && length < path.Capacity ? path.ToString() : "<path-error:" + Marshal.GetLastWin32Error() + ">";
    }

    public static int[] LastProcessIds { get; private set; } = Array.Empty<int>();

    public static int[] Capture(string executable, string directory, int seconds, string logPath, Action<int[]> snapshot)
    {
        if (IntPtr.Size != 8) throw new InvalidOperationException("Use 64-bit PowerShell for the native smoke debugger.");
        var startup = new StartupInfo { Size = (uint)Marshal.SizeOf(typeof(StartupInfo)) };
        ProcessInfo root;
        if (!CreateProcess(executable, null, IntPtr.Zero, IntPtr.Zero, false, 1, IntPtr.Zero, directory, ref startup, out root))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess(DEBUG_PROCESS)");
        LastProcessIds = new[] { (int)root.ProcessId };
        var processes = new Dictionary<uint, IntPtr>();
        var ids = new HashSet<int>();
        var handles = new HashSet<IntPtr> { root.Process, root.Thread };
        try
        {
            DebugSetProcessKillOnExit(false);
            using (var log = new StreamWriter(logPath, false, new UTF8Encoding(false)))
            {
                log.AutoFlush = true;
                log.WriteLine("ROOT pid=" + root.ProcessId + " executable=" + executable);
                var clock = Stopwatch.StartNew();
                bool sawProcess = false;
                double nextSnapshot = 10;
                while (clock.Elapsed.TotalSeconds < seconds)
                {
                    if (clock.Elapsed.TotalSeconds >= nextSnapshot)
                    {
                        try { snapshot(LastProcessIds); }
                        catch (Exception error) { log.WriteLine("SNAPSHOT_ERROR " + error); }
                        nextSnapshot += 20;
                    }
                    DebugEvent e;
                    if (!WaitForDebugEvent(out e, 250))
                    {
                        int error = Marshal.GetLastWin32Error();
                        if (error != 121) log.WriteLine("WAIT_ERROR " + error);
                        continue;
                    }
                    uint status = 0x00010002; // DBG_CONTINUE
                    try
                    {
                        string prefix = DateTime.UtcNow.ToString("O") + " pid=" + e.ProcessId + " tid=" + e.ThreadId + " ";
                        switch (e.Code)
                        {
                            case 1:
                                log.WriteLine(prefix + "EXCEPTION code=0x" + e.Exception.Record.Code.ToString("X8") +
                                    " address=0x" + e.Exception.Record.Address.ToInt64().ToString("X") + " firstChance=" + e.Exception.FirstChance);
                                // Only debugger breakpoints are consumed; real exceptions reach the client's handlers.
                                if (e.Exception.Record.Code != 0x80000003 && e.Exception.Record.Code != 0x80000004)
                                    status = 0x80010001; // DBG_EXCEPTION_NOT_HANDLED
                                break;
                            case 2:
                                handles.Add(e.Thread);
                                break;
                            case 3:
                                sawProcess = true;
                                ids.Add((int)e.ProcessId);
                                var observed = new int[ids.Count]; ids.CopyTo(observed); LastProcessIds = observed;
                                processes[e.ProcessId] = e.Create.Process;
                                handles.Add(e.Create.Process); handles.Add(e.Create.Thread);
                                log.WriteLine(prefix + "CREATE_PROCESS base=0x" + e.Create.Base.ToInt64().ToString("X") + " path=" + FilePath(e.Create.File));
                                if (e.Create.File != IntPtr.Zero) CloseHandle(e.Create.File);
                                break;
                            case 5:
                                log.WriteLine(prefix + "EXIT_PROCESS code=0x" + e.ExitCode.ToString("X8"));
                                processes.Remove(e.ProcessId);
                                break;
                            case 6:
                                log.WriteLine(prefix + "LOAD_DLL base=0x" + e.Dll.Base.ToInt64().ToString("X") + " path=" + FilePath(e.Dll.File));
                                if (e.Dll.File != IntPtr.Zero) CloseHandle(e.Dll.File);
                                break;
                            case 8:
                                IntPtr process;
                                if (processes.TryGetValue(e.ProcessId, out process) && e.String.Length > 0)
                                {
                                    int length = e.String.Length * (e.String.Unicode != 0 ? 2 : 1);
                                    var data = new byte[length];
                                    UIntPtr read;
                                    if (ReadProcessMemory(process, e.String.Address, data, (UIntPtr)length, out read))
                                    {
                                        var encoding = e.String.Unicode != 0 ? Encoding.Unicode : Encoding.Default;
                                        log.WriteLine(prefix + "DEBUG_STRING " + encoding.GetString(data, 0, (int)read.ToUInt64()).TrimEnd('\0'));
                                    }
                                    else log.WriteLine(prefix + "DEBUG_STRING_READ_ERROR " + Marshal.GetLastWin32Error());
                                }
                                break;
                        }
                    }
                    finally
                    {
                        if (!ContinueDebugEvent(e.ProcessId, e.ThreadId, status))
                            log.WriteLine("CONTINUE_ERROR pid=" + e.ProcessId + " error=" + Marshal.GetLastWin32Error());
                    }
                    if (sawProcess && processes.Count == 0) break;
                }
                foreach (uint pid in processes.Keys)
                    log.WriteLine("DETACH pid=" + pid + " success=" + DebugActiveProcessStop(pid) + " error=" + Marshal.GetLastWin32Error());
            }
            var result = new int[ids.Count]; ids.CopyTo(result); return result;
        }
        finally
        {
            foreach (uint pid in processes.Keys) DebugActiveProcessStop(pid);
            foreach (IntPtr handle in handles) if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
        }
    }

    public sealed class WindowInfo
    {
        public int ProcessId; public string Handle, Class, Title; public bool Visible;
        public int X, Y, Width, Height; public string[] ChildText;
        public int ClientX, ClientY, ClientWidth, ClientHeight;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    private delegate bool WindowCallback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hwnd, WindowCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wparam, StringBuilder text,
        uint flags, uint milliseconds, out UIntPtr result);
    private static string Text(IntPtr hwnd)
    {
        var text = new StringBuilder(4096);
        GetWindowText(hwnd, text, text.Capacity);
        if (text.Length == 0)
        {
            UIntPtr result;
            SendMessageTimeout(hwnd, 0x000D, (UIntPtr)text.Capacity, text, 0x0003, 100, out result);
        }
        return text.ToString();
    }
    public static WindowInfo[] Windows(int[] ids)
    {
        var selected = new HashSet<int>(ids); var result = new List<WindowInfo>();
        EnumWindows((hwnd, unused) =>
        {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            if (!selected.Contains((int)pid)) return true;
            var cls = new StringBuilder(256); GetClassName(hwnd, cls, cls.Capacity);
            Rect rect; GetWindowRect(hwnd, out rect); var children = new List<string>();
            Rect client; GetClientRect(hwnd, out client); var origin = new Point(); ClientToScreen(hwnd, ref origin);
            EnumChildWindows(hwnd, (child, ignored) => { string text = Text(child); if (text.Length > 0) children.Add(text); return true; }, IntPtr.Zero);
            result.Add(new WindowInfo { ProcessId = (int)pid, Handle = "0x" + hwnd.ToInt64().ToString("X"), Class = cls.ToString(),
                Title = Text(hwnd), Visible = IsWindowVisible(hwnd), X = rect.Left, Y = rect.Top,
                Width = rect.Right - rect.Left, Height = rect.Bottom - rect.Top, ChildText = children.ToArray(),
                ClientX = origin.X, ClientY = origin.Y, ClientWidth = client.Right, ClientHeight = client.Bottom });
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}

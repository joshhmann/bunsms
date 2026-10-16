using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeSmoke
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size, Usage, Id; public UIntPtr Heap;
        public uint Module, Threads, Parent; public int Priority; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateEvent(IntPtr attributes, bool manualReset, bool initial, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFileMapping(IntPtr file, IntPtr attributes, uint protect, uint high, uint low, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr MapViewOfFile(IntPtr mapping, uint access, uint high, uint low, UIntPtr size);
    [DllImport("kernel32.dll")] private static extern bool UnmapViewOfFile(IntPtr view);
    [DllImport("kernel32.dll")] private static extern bool SetEvent(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    public static int[] LastProcessIds { get; private set; } = Array.Empty<int>();

    private static void ObserveProcesses(Dictionary<int, Process> processes, HashSet<int> ids, HashSet<string> modules, StreamWriter log)
    {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot != new IntPtr(-1))
        {
            try
            {
                var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
                var entries = new List<ProcessEntry>();
                if (Process32First(snapshot, ref entry)) do { entries.Add(entry); } while (Process32Next(snapshot, ref entry));
                bool added;
                do
                {
                    added = false;
                    foreach (var child in entries)
                    {
                        if (!ids.Contains((int)child.Parent) || ids.Contains((int)child.Id)) continue;
                        try
                        {
                            var process = Process.GetProcessById((int)child.Id);
                            // Do not request Process.Handle (full access): native guards may deny it.
                            // Ordinary exit/module observation below reports access failures separately.
                            processes.Add(process.Id, process); ids.Add(process.Id); added = true;
                            log.WriteLine("PROCESS_OBSERVED pid=" + child.Id + " parent=" + child.Parent + " name=" + child.Name);
                        }
                        catch (ArgumentException) { log.WriteLine("PROCESS_EXITED_BEFORE_OPEN pid=" + child.Id); }
                    }
                } while (added);
            }
            finally { CloseHandle(snapshot); }
        }
        var exited = new List<int>();
        foreach (var pair in processes)
        {
            var process = pair.Value;
            try
            {
                if (process.HasExited)
                {
                    log.WriteLine("EXIT_PROCESS pid=" + pair.Key + " code=" + process.ExitCode + " reason=natural-before-controller-cleanup");
                    exited.Add(pair.Key); continue;
                }
                process.Refresh(); // Process.Modules is cached; late-loaded companion DLLs must be observed.
                foreach (ProcessModule module in process.Modules)
                {
                    string key = pair.Key + ":" + module.BaseAddress.ToInt64();
                    if (modules.Add(key)) log.WriteLine("MODULE_OBSERVED pid=" + pair.Key + " base=0x" + module.BaseAddress.ToInt64().ToString("X") + " path=" + module.FileName);
                }
            }
            catch (Exception error) { log.WriteLine("PROCESS_OBSERVATION_ERROR pid=" + pair.Key + " " + error.Message); }
        }
        foreach (int pid in exited) { processes[pid].Dispose(); processes.Remove(pid); }
        var observed = new int[ids.Count]; ids.CopyTo(observed); LastProcessIds = observed;
    }

    public static int[] Capture(string executable, string directory, int seconds, string logPath, Action<int[]> snapshot)
    {
        // DBWIN is the standard passive OutputDebugString listener. No debug attach,
        // DEBUG_PROCESS flag, guard patch, or IsDebuggerPresent override is used.
        IntPtr ready = IntPtr.Zero, data = IntPtr.Zero, mapping = IntPtr.Zero, view = IntPtr.Zero;
        var processes = new Dictionary<int, Process>(); var ids = new HashSet<int>(); var modules = new HashSet<string>();
        try
        {
            ready = CreateEvent(IntPtr.Zero, false, false, "DBWIN_BUFFER_READY");
            data = CreateEvent(IntPtr.Zero, false, false, "DBWIN_DATA_READY");
            mapping = CreateFileMapping(new IntPtr(-1), IntPtr.Zero, 4, 0, 4096, "DBWIN_BUFFER");
            int mappingError = Marshal.GetLastWin32Error();
            if (ready == IntPtr.Zero || data == IntPtr.Zero || mapping == IntPtr.Zero || mappingError == 183)
                throw new System.ComponentModel.Win32Exception(mappingError, "Cannot acquire isolated passive DBWIN listener");
            view = MapViewOfFile(mapping, 6, 0, 0, (UIntPtr)4096);
            if (view == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Map DBWIN buffer");
            using (var log = new StreamWriter(logPath, false, new UTF8Encoding(false)))
            {
                log.AutoFlush = true;
                var root = Process.Start(new ProcessStartInfo(executable) { WorkingDirectory = directory, UseShellExecute = false });
                if (root == null) throw new InvalidOperationException("Native launcher did not start");
                processes.Add(root.Id, root); ids.Add(root.Id); LastProcessIds = new[] { root.Id };
                log.WriteLine("ROOT pid=" + root.Id + " mode=normal-process-no-debugger executable=" + executable);
                var clock = Stopwatch.StartNew(); double nextObservation = 0, nextSnapshot = 10;
                var buffer = new byte[4092];
                while (clock.Elapsed.TotalSeconds < seconds)
                {
                    SetEvent(ready);
                    if (WaitForSingleObject(data, 100) == 0)
                    {
                        int pid = Marshal.ReadInt32(view); Marshal.Copy(IntPtr.Add(view, 4), buffer, 0, buffer.Length);
                        int length = Array.IndexOf(buffer, (byte)0); if (length < 0) length = buffer.Length;
                        string text = Encoding.Default.GetString(buffer, 0, length);
                        // Never collect arbitrary unrelated process data or authentication payloads.
                        if (text.StartsWith("BUNS_RUNTIME ", StringComparison.Ordinal) || text.StartsWith("BUNS_SCAN ", StringComparison.Ordinal))
                            log.WriteLine(DateTime.UtcNow.ToString("O") + " DEBUG_STRING pid=" + pid + " " + text.TrimEnd('\0', '\r', '\n'));
                    }
                    if (clock.Elapsed.TotalSeconds >= nextObservation)
                    {
                        ObserveProcesses(processes, ids, modules, log); nextObservation += 1;
                        if (processes.Count == 0) break;
                    }
                    if (clock.Elapsed.TotalSeconds >= nextSnapshot)
                    {
                        try { snapshot(LastProcessIds); }
                        catch (Exception error) { log.WriteLine("SNAPSHOT_ERROR " + error); }
                        nextSnapshot += 20;
                    }
                }
                log.WriteLine("OBSERVATION_END elapsedSeconds=" + clock.Elapsed.TotalSeconds + " activeProcesses=" + processes.Count + " controllerCleanupNotYetRun=true");
            }
            return LastProcessIds;
        }
        finally
        {
            foreach (var process in processes.Values) process.Dispose();
            if (view != IntPtr.Zero) UnmapViewOfFile(view);
            foreach (var handle in new[] { mapping, data, ready }) if (handle != IntPtr.Zero) CloseHandle(handle);
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
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

    public sealed class FocusObservation
    {
        public bool NormalRequestActivated, ExposedFooterClickSubmitted, Activated;
        public int ScreenX, ScreenY;
        public string ExposedWindow;
    }

    public static FocusObservation FocusClient(WindowInfo window)
    {
        IntPtr hwnd = new IntPtr(Convert.ToInt64(window.Handle.Substring(2), 16));
        uint owner; GetWindowThreadProcessId(hwnd, out owner);
        if (owner != window.ProcessId || !window.Visible || window.Class != "MapleStoryClass")
            throw new InvalidOperationException("Foreground target is not the observed native game window");
        SetForegroundWindow(hwnd);
        System.Threading.Thread.Sleep(100);
        var result = new FocusObservation { NormalRequestActivated = GetForegroundWindow() == hwnd };
        result.Activated = result.NormalRequestActivated;
        if (result.Activated || window.ClientWidth <= 0 || window.ClientHeight < 100)
            return result;
        Point point = new Point { X = window.ClientWidth / 2, Y = window.ClientHeight - 50 };
        if (!ClientToScreen(hwnd, ref point))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        result.ScreenX = point.X; result.ScreenY = point.Y;
        IntPtr exposed = WindowFromPoint(point);
        result.ExposedWindow = "0x" + exposed.ToInt64().ToString("X");
        if (exposed != hwnd) return result;
        if (!SetCursorPos(point.X, point.Y))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        if (WindowFromPoint(point) != hwnd) return result;
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
        result.ExposedFooterClickSubmitted = true;
        System.Threading.Thread.Sleep(100);
        result.Activated = GetForegroundWindow() == hwnd;
        return result;
    }

    public static void ClickClient(WindowInfo window, int x, int y)
    {
        IntPtr hwnd = new IntPtr(Convert.ToInt64(window.Handle.Substring(2), 16));
        uint owner; GetWindowThreadProcessId(hwnd, out owner);
        if (owner != window.ProcessId || !window.Visible || window.Class != "MapleStoryClass" ||
            x < 0 || y < 0 || x >= window.ClientWidth || y >= window.ClientHeight)
            throw new InvalidOperationException("Input target is not the observed native game window");
        SetForegroundWindow(hwnd);
        System.Threading.Thread.Sleep(100);
        if (GetForegroundWindow() != hwnd)
            throw new InvalidOperationException("Native game did not receive foreground focus; no input submitted");
        Point point = new Point { X = x, Y = y };
        if (!ClientToScreen(hwnd, ref point) || !SetCursorPos(point.X, point.Y))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(100);
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, UIntPtr wparam, StringBuilder text, uint flags, uint milliseconds, out UIntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
    private static string Text(IntPtr hwnd)
    {
        var text = new StringBuilder(4096); GetWindowText(hwnd, text, text.Capacity);
        if (text.Length == 0) { UIntPtr result; SendMessageTimeout(hwnd, 0x000D, (UIntPtr)text.Capacity, text, 3, 100, out result); }
        return text.ToString();
    }
    public static WindowInfo[] Windows(int[] ids)
    {
        var selected = new HashSet<int>(ids); var result = new List<WindowInfo>();
        EnumWindows((hwnd, unused) =>
        {
            uint pid; GetWindowThreadProcessId(hwnd, out pid); if (!selected.Contains((int)pid)) return true;
            var cls = new StringBuilder(256); GetClassName(hwnd, cls, cls.Capacity);
            Rect rect, client; GetWindowRect(hwnd, out rect); GetClientRect(hwnd, out client);
            var origin = new Point(); ClientToScreen(hwnd, ref origin); var children = new List<string>();
            EnumChildWindows(hwnd, (child, ignored) => { string text = Text(child); if (text.Length > 0) children.Add(text); return true; }, IntPtr.Zero);
            result.Add(new WindowInfo { ProcessId = (int)pid, Handle = "0x" + hwnd.ToInt64().ToString("X"), Class = cls.ToString(), Title = Text(hwnd),
                Visible = IsWindowVisible(hwnd), X = rect.Left, Y = rect.Top, Width = rect.Right - rect.Left, Height = rect.Bottom - rect.Top,
                ChildText = children.ToArray(), ClientX = origin.X, ClientY = origin.Y, ClientWidth = client.Right, ClientHeight = client.Bottom });
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
    public static string ContinueCompatibilityPrompt(int[] ids)
    {
        var selected = new HashSet<int>(ids); string action = "";
        EnumWindows((hwnd, unused) =>
        {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            if (!selected.Contains((int)pid) || Text(hwnd) != "Program Compatibility Assistant") return true;
            EnumChildWindows(hwnd, (child, ignored) =>
            {
                if (Text(child).Replace("&", "") != "Run the program without getting help") return true;
                bool posted = PostMessage(child, 0x00F5, IntPtr.Zero, IntPtr.Zero);
                action = "PCA normal Run button posted=" + posted + " pid=" + pid + " hwnd=0x" + child.ToInt64().ToString("X") + " error=" + Marshal.GetLastWin32Error();
                return false;
            }, IntPtr.Zero);
            return action.Length == 0;
        }, IntPtr.Zero);
        return action;
    }
}

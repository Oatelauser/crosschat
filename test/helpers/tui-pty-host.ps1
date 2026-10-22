param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$ArgumentsBase64,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [int]$Columns = 80,
  [int]$Rows = 24
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;

public sealed class TuiPtyHost : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Coord { public short X; public short Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
        public int cb; public string reserved; public string desktop; public string title;
        public int x; public int y; public int xSize; public int ySize;
        public int xCountChars; public int yCountChars; public int fillAttribute;
        public int flags; public short showWindow; public short reserved2Length;
        public IntPtr reserved2; public IntPtr stdin; public IntPtr stdout; public IntPtr stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx {
        public StartupInfo startup; public IntPtr attributes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
        public IntPtr process; public IntPtr thread; public uint pid; public uint tid;
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long processTime; public long jobTime; public uint flags;
        public UIntPtr minWorkingSet; public UIntPtr maxWorkingSet; public uint activeProcesses;
        public UIntPtr affinity; public uint priority; public uint scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong readOperations; public ulong writeOperations; public ulong otherOperations;
        public ulong readBytes; public ulong writeBytes; public ulong otherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit basic; public IoCounters io;
        public UIntPtr processMemory; public UIntPtr jobMemory; public UIntPtr peakProcessMemory; public UIntPtr peakJobMemory;
    }

    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr attributes, uint size);
    [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(Coord size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
    [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr console, Coord size);
    [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr file, byte[] buffer, uint count, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr file, byte[] buffer, uint count, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref ExtendedLimit limit, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    static readonly object outputLock = new object();
    readonly object inputLock = new object();
    IntPtr console; IntPtr input; IntPtr output; IntPtr process; IntPtr job;
    IntPtr inputRead; IntPtr outputWrite; IntPtr attributes;
    Thread reader; bool disposed; uint childPid;

    static void Check(bool success, string operation) {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
    static Coord Dimensions(int columns, int rows) {
        if (columns < 1 || columns > 32767 || rows < 1 || rows > 32767) throw new ArgumentOutOfRangeException("dimensions");
        return new Coord { X = (short)columns, Y = (short)rows };
    }
    static void Event(object value) {
        lock (outputLock) { Console.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); }
    }
    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(character); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    public TuiPtyHost(string executable, string[] args, string directory, int columns, int rows) {
        try {
            Check(CreatePipe(out inputRead, out input, IntPtr.Zero, 0), "CreatePipe(input)");
            Check(CreatePipe(out output, out outputWrite, IntPtr.Zero, 0), "CreatePipe(output)");
            int result = CreatePseudoConsole(Dimensions(columns, rows), inputRead, outputWrite, 0, out console);
            if (result != 0) Marshal.ThrowExceptionForHR(result);
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size), "InitializeProcThreadAttributeList");
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x00020016), console, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute");
            var startup = new StartupInfoEx();
            startup.startup.cb = Marshal.SizeOf<StartupInfoEx>(); startup.attributes = attributes;
            // Null standard handles force ConPTY console handles instead of duplicating
            // this JSONL host's redirected pipes into the fixture process.
            startup.startup.flags = 0x00000100;
            var command = new StringBuilder(Quote(executable));
            foreach (string arg in args) command.Append(' ').Append(Quote(arg));
            ProcessInfo info;
            // Start suspended so the fixture belongs to our kill-on-close job before executing.
            Check(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x00080004, IntPtr.Zero, directory, ref startup, out info), "CreateProcessW");
            process = info.process; childPid = info.pid;
            try {
                job = CreateJobObjectW(IntPtr.Zero, null);
                Check(job != IntPtr.Zero, "CreateJobObjectW");
                var limit = new ExtendedLimit(); limit.basic.flags = 0x00002000;
                Check(SetInformationJobObject(job, 9, ref limit, (uint)Marshal.SizeOf<ExtendedLimit>()), "SetInformationJobObject");
                Check(AssignProcessToJobObject(job, process), "AssignProcessToJobObject");
                if (ResumeThread(info.thread) == uint.MaxValue) Check(false, "ResumeThread");
            } finally { CloseHandle(info.thread); }
            CloseHandle(inputRead); inputRead = IntPtr.Zero;
            CloseHandle(outputWrite); outputWrite = IntPtr.Zero;
            reader = new Thread(ReadOutput) { IsBackground = true }; reader.Start();
            Event(new { @event = "ready", pid = childPid, columns, rows });
        } catch { Dispose(); throw; }
    }
    void ReadOutput() {
        var buffer = new byte[8192];
        while (ReadFile(output, buffer, (uint)buffer.Length, out uint length, IntPtr.Zero) && length > 0) {
            Event(new { @event = "output", data = Convert.ToBase64String(buffer, 0, (int)length) });
        }
    }
    void Write(byte[] bytes) {
        lock (inputLock) {
            int offset = 0;
            while (offset < bytes.Length) {
                var remaining = new byte[bytes.Length - offset];
                Array.Copy(bytes, offset, remaining, 0, remaining.Length);
                Check(WriteFile(input, remaining, (uint)remaining.Length, out uint written, IntPtr.Zero), "WriteFile(input)");
                if (written == 0) throw new InvalidOperationException("ConPTY input pipe made no progress.");
                offset += (int)written;
            }
        }
    }
    void ReadCommands() {
        try {
            string line;
            while ((line = Console.ReadLine()) != null) {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                string operation = root.GetProperty("op").GetString();
                if (operation == "write") Write(Convert.FromBase64String(root.GetProperty("data").GetString()));
                else if (operation == "resize") {
                    int columns = root.GetProperty("columns").GetInt32(); int rows = root.GetProperty("rows").GetInt32();
                    int result = ResizePseudoConsole(console, Dimensions(columns, rows));
                    if (result != 0) Marshal.ThrowExceptionForHR(result);
                    Event(new { @event = "resized", columns, rows });
                } else if (operation == "terminate") { TerminateProcess(process, 125); return; }
                else throw new InvalidOperationException("Unknown ConPTY command: " + operation);
            }
            // Losing the owning driver must never leave its fixture running.
            TerminateProcess(process, 125);
        } catch (Exception error) {
            Event(new { @event = "error", message = error.Message });
            TerminateProcess(process, 125);
        }
    }
    public int Run() {
        new Thread(ReadCommands) { IsBackground = true }.Start();
        Check(WaitForSingleObject(process, uint.MaxValue) == 0, "WaitForSingleObject");
        Check(GetExitCodeProcess(process, out uint code), "GetExitCodeProcess");
        // The output reader stays active while ConPTY drains its final terminal output.
        if (console != IntPtr.Zero) { ClosePseudoConsole(console); console = IntPtr.Zero; }
        reader.Join(5000);
        Event(new { @event = "exit", code });
        return 0;
    }
    public void Dispose() {
        if (disposed) return; disposed = true;
        if (process != IntPtr.Zero && WaitForSingleObject(process, 0) == 258) TerminateProcess(process, 125);
        if (console != IntPtr.Zero) { ClosePseudoConsole(console); console = IntPtr.Zero; }
        if (reader != null) reader.Join(2000);
        if (attributes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); attributes = IntPtr.Zero; }
        foreach (IntPtr handle in new[] { inputRead, outputWrite, input, output, process, job }) if (handle != IntPtr.Zero) CloseHandle(handle);
    }
}
'@

$childArguments = [System.Text.Json.JsonSerializer]::Deserialize([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgumentsBase64)), [string[]])
$ptyHost = $null
try {
  $ptyHost = [TuiPtyHost]::new($Executable, $childArguments, $WorkingDirectory, $Columns, $Rows)
  exit $ptyHost.Run()
} finally {
  if ($null -ne $ptyHost) { $ptyHost.Dispose() }
}

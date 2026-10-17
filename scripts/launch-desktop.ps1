param(
    [string]$CommandLine = 'cmd.exe /c "pnpm run start:desktop"',
    [string]$WorkingDirectory = "d:\Company\cinlan\apps\cinlan-harness",
    [string]$Desktop = "WinSta0\Default"
)

$code = @"
using System;
using System.Runtime.InteropServices;

public class DesktopLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public Int32 cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public Int32 dwX;
        public Int32 dwY;
        public Int32 dwXSize;
        public Int32 dwYSize;
        public Int32 dwXCountChars;
        public Int32 dwYCountChars;
        public Int32 dwFillAttribute;
        public Int32 dwFlags;
        public Int16 wShowWindow;
        public Int16 cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public Int32 dwProcessId;
        public Int32 dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    public static int Launch(string cmd, string cwd, string desktop) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = desktop;
        si.dwFlags = 1; // STARTF_USESHOWWINDOW
        si.wShowWindow = 1; // SW_SHOWNORMAL
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        // 0x00000010 = CREATE_NEW_CONSOLE
        bool res = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00000010, IntPtr.Zero, cwd, ref si, out pi);
        if (!res) {
            int err = Marshal.GetLastWin32Error();
            Console.WriteLine("CreateProcess failed: " + err);
            return -err;
        }
        return pi.dwProcessId;
    }
}
"@

Add-Type -TypeDefinition $code
$pid_out = [DesktopLauncher]::Launch($CommandLine, $WorkingDirectory, $Desktop)
Write-Host "Desktop process launched with PID: $pid_out on desktop $Desktop"

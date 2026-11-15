// CREATE desktop launcher: opens the online app in its own window (Chrome, else Edge,
// else the default browser). Built with the logo as its icon so the desktop shortcut
// never depends on Chrome (which rewrites shortcuts that point at chrome.exe).
using System;
using System.Diagnostics;
using System.IO;

static class CreateLauncher
{
    const string Url = "https://create.wazprod.workers.dev";

    [STAThread]
    static void Main()
    {
        string pf = Environment.GetEnvironmentVariable("ProgramFiles") ?? "";
        string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "";
        string local = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
        string[] browsers =
        {
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
        };
        foreach (string b in browsers)
        {
            if (File.Exists(b))
            {
                Process.Start(new ProcessStartInfo(b, "--app=" + Url) { UseShellExecute = false });
                return;
            }
        }
        Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
    }
}

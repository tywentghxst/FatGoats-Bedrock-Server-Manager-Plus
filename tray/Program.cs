using System;
using System.IO;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Net;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace BedrockServerManager.Tray
{
    static class Program
    {
        private static Mutex mutex;
        private const string MutexName = "BedrockDedicatedServerManager_TrayMutex_v2";
        public const string DashboardUrl = "http://localhost:3001";

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Global exception handlers to prevent silent crashes
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (s, e) => LogCrash(e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => LogCrash(e.ExceptionObject as Exception);

            try
            {
                bool isNewInstance;
                mutex = new Mutex(true, MutexName, out isNewInstance);

                if (!isNewInstance)
                {
                    // An instance is already running in tray overflow area.
                    // Open the localhost browser dashboard and exit this second launch.
                    OpenBrowser(DashboardUrl);
                    return;
                }

                Application.Run(new TrayApplicationContext());
            }
            catch (Exception ex)
            {
                LogCrash(ex);
            }
        }

        public static void OpenBrowser(string url)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                };
                Process.Start(psi);
            }
            catch
            {
                try
                {
                    ProcessStartInfo psiFallback = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = "/c start " + url,
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    Process.Start(psiFallback);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "Could not launch default web browser for:\n" + url + "\n\nError: " + ex.Message,
                        "Bedrock Server Manager",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                }
            }
        }

        private static void LogCrash(Exception ex)
        {
            if (ex == null) return;
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string logDir = Path.Combine(baseDir, "data", "logs");
                if (!Directory.Exists(logDir)) Directory.CreateDirectory(logDir);
                string crashPath = Path.Combine(logDir, "crash.log");
                string logContent = string.Format("[{0:yyyy-MM-dd HH:mm:ss}] CRASH: {1}\n{2}\n\n", DateTime.Now, ex.Message, ex.StackTrace);
                File.AppendAllText(crashPath, logContent);
                MessageBox.Show("Bedrock Server Manager encountered an error:\n\n" + ex.Message + "\n\nDetails saved to data\\logs\\crash.log", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch { }
        }
    }

    public class TrayApplicationContext : ApplicationContext
    {
        private NotifyIcon notifyIcon;
        private ContextMenuStrip contextMenu;
        private ToolStripMenuItem menuOpenServer;
        private ToolStripMenuItem menuStartAll;
        private ToolStripMenuItem menuRestartAll;
        private ToolStripMenuItem menuStartBds;
        private ToolStripMenuItem menuStopBds;
        private ToolStripMenuItem menuRestartBds;
        private ToolStripMenuItem menuAutoStart;
        private System.Windows.Forms.Timer statusTimer;

        private Process nodeProcess;
        private string appDir;
        private string logFilePath;
        private SynchronizationContext syncContext;

        public TrayApplicationContext()
        {
            syncContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            ResolveDirectories();
            InitializeTrayIcon();
            StartNodeBackend();
            InitializeTimer();

            // Automatically launch browser dashboard on startup
            AutoLaunchBrowserOnStartup();

            // Notify user that app is sitting in taskbar overflow tray
            try
            {
                notifyIcon.ShowBalloonTip(
                    3500,
                    "Bedrock Server Manager",
                    "Server Manager is running in your taskbar overflow area.\nRight-click for controls or click to open dashboard.",
                    ToolTipIcon.Info
                );
            }
            catch { }
        }

        private void ResolveDirectories()
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory;

            // If running inside a subdirectory, locate the project root containing server\index.js
            if (!File.Exists(Path.Combine(appDir, "server", "index.js")) &&
                File.Exists(Path.Combine(appDir, "..", "server", "index.js")))
            {
                appDir = Path.GetFullPath(Path.Combine(appDir, ".."));
            }

            string logDir = Path.Combine(appDir, "data", "logs");
            if (!Directory.Exists(logDir))
            {
                try { Directory.CreateDirectory(logDir); } catch { }
            }
            logFilePath = Path.Combine(logDir, "manager-launcher.log");
        }

        private void InitializeTrayIcon()
        {
            contextMenu = new ContextMenuStrip();
            contextMenu.ShowImageMargin = false;

            // 1. "Open Server" Context Item (Bold, top item - opens localhost:3001)
            menuOpenServer = new ToolStripMenuItem("🌐 Open Server", null, (s, e) => Program.OpenBrowser(Program.DashboardUrl));
            menuOpenServer.Font = new Font(contextMenu.Font, FontStyle.Bold);
            contextMenu.Items.Add(menuOpenServer);
            contextMenu.Items.Add(new ToolStripMenuItem("🚀 Check for App Updates", null, (s, e) => Program.OpenBrowser(Program.DashboardUrl + "/settings")));

            contextMenu.Items.Add(new ToolStripSeparator());

            // 2. All Services Actions
            menuStartAll = new ToolStripMenuItem("⚡ Start All (Server + Playit + Bot)", null, (s, e) => SendTrayAction("start_all"));
            menuRestartAll = new ToolStripMenuItem("🔄 Restart All Services", null, (s, e) => SendTrayAction("restart_all"));
            contextMenu.Items.Add(menuStartAll);
            contextMenu.Items.Add(menuRestartAll);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 3. Bedrock Dedicated Server Controls
            menuStartBds = new ToolStripMenuItem("▶️ Start Bedrock Server", null, (s, e) => SendTrayAction("start_bds"));
            menuStopBds = new ToolStripMenuItem("⏹️ Stop Bedrock Server", null, (s, e) => SendTrayAction("stop_bds"));
            menuRestartBds = new ToolStripMenuItem("🔁 Restart Bedrock Server", null, (s, e) => SendTrayAction("restart_bds"));
            contextMenu.Items.Add(menuStartBds);
            contextMenu.Items.Add(menuStopBds);
            contextMenu.Items.Add(menuRestartBds);

            contextMenu.Items.Add(new ToolStripSeparator());

            // 4. Folder & Log shortcuts
            contextMenu.Items.Add(new ToolStripMenuItem("📁 Open BDS Folder", null, (s, e) => OpenDirectory(Path.Combine(appDir, "bds"))));
            contextMenu.Items.Add(new ToolStripMenuItem("📁 Open Backups Folder", null, (s, e) => OpenDirectory(Path.Combine(appDir, "data", "backups"))));
            contextMenu.Items.Add(new ToolStripMenuItem("📋 View Server Logs", null, (s, e) => OpenLogs()));

            contextMenu.Items.Add(new ToolStripSeparator());

            // 5. Windows Startup Toggle
            menuAutoStart = new ToolStripMenuItem("🚀 Start with Windows", null, (s, e) => ToggleAutoStart());
            menuAutoStart.Checked = IsAutoStartEnabled();
            contextMenu.Items.Add(menuAutoStart);

            // 6. Restart Manager
            contextMenu.Items.Add(new ToolStripMenuItem("🔄 Restart Manager", null, (s, e) => RestartApp()));

            // 7. Exit
            contextMenu.Items.Add(new ToolStripMenuItem("❌ Exit & Stop Server", null, (s, e) => ExitApplication()));

            // Extract application icon safely without holding file locks
            Icon appIcon = null;
            try
            {
                string iconPath = Path.Combine(appDir, "tray", "app.ico");
                if (File.Exists(iconPath))
                {
                    using (FileStream fs = new FileStream(iconPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    {
                        appIcon = new Icon(fs);
                    }
                }
            }
            catch { }

            if (appIcon == null)
            {
                try
                {
                    appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                }
                catch { }
            }

            if (appIcon == null)
            {
                appIcon = SystemIcons.Application;
            }

            notifyIcon = new NotifyIcon();
            notifyIcon.Icon = appIcon;
            SetTrayText("Bedrock Server Manager");
            notifyIcon.ContextMenuStrip = contextMenu;
            notifyIcon.Visible = true;

            // Single click or double click on tray icon opens the server localhost page
            notifyIcon.DoubleClick += (s, e) => Program.OpenBrowser(Program.DashboardUrl);
            notifyIcon.MouseClick += (s, e) =>
            {
                if (e.Button == MouseButtons.Left)
                {
                    Program.OpenBrowser(Program.DashboardUrl);
                }
            };
        }

        private void SetTrayText(string text)
        {
            if (notifyIcon == null) return;
            if (string.IsNullOrEmpty(text)) text = "Bedrock Server Manager";
            // Windows NotifyIcon.Text has a strict 63-char maximum length
            if (text.Length > 63) text = text.Substring(0, 63);
            try
            {
                notifyIcon.Text = text;
            }
            catch { }
        }

        private void InitializeTimer()
        {
            statusTimer = new System.Windows.Forms.Timer();
            statusTimer.Interval = 3500;
            statusTimer.Tick += (s, e) => PollServerStatus();
            statusTimer.Start();
        }

        private void AutoLaunchBrowserOnStartup()
        {
            // Run on background thread: wait until server is responsive, then open browser
            ThreadPool.QueueUserWorkItem(state =>
            {
                int attempts = 0;
                bool ready = false;

                while (attempts < 20 && !ready)
                {
                    ready = IsServerResponding();
                    if (!ready)
                    {
                        Thread.Sleep(500);
                        attempts++;
                    }
                }

                // Small grace delay to ensure page renders fully
                Thread.Sleep(300);
                Program.OpenBrowser(Program.DashboardUrl);
                Log("Auto-launched browser dashboard on startup.");
            });
        }

        private void EnsureDependencies(string nodeExe)
        {
            string nodeModules = Path.Combine(appDir, "node_modules");
            if (!Directory.Exists(nodeModules) || Directory.GetDirectories(nodeModules).Length == 0)
            {
                Log("WARNING: node_modules missing. Attempting automated dependency restore...");
                try
                {
                    string nodeDir = Path.GetDirectoryName(nodeExe);
                    string npmCmd = Path.Combine(nodeDir ?? "", "npm.cmd");
                    if (!File.Exists(npmCmd)) npmCmd = @"C:\Program Files\nodejs\npm.cmd";
                    if (!File.Exists(npmCmd)) npmCmd = "npm.cmd";

                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = string.Format("/c \"\"{0}\" install --omit=dev --no-audit --no-fund\"", npmCmd),
                        WorkingDirectory = appDir,
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    if (!string.IsNullOrEmpty(nodeDir))
                    {
                        psi.EnvironmentVariables["PATH"] = nodeDir + ";" + Environment.GetEnvironmentVariable("PATH");
                    }
                    using (Process p = Process.Start(psi))
                    {
                        p.WaitForExit(90000);
                    }
                    Log("Automated dependency restore finished.");
                }
                catch (Exception ex)
                {
                    Log("Automated dependency restore failed: " + ex.Message);
                }
            }
        }

        private void StartNodeBackend()
        {
            try
            {
                if (IsServerResponding())
                {
                    Log("Backend is already active on port 3001.");
                    return;
                }

                string nodeExe = FindNodeExecutable();
                string serverScript = Path.Combine(appDir, "server", "index.js");

                if (!File.Exists(serverScript))
                {
                    Log("ERROR: Server script not found at " + serverScript);
                    MessageBox.Show("Could not find server entry point:\n" + serverScript, "Bedrock Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                EnsureDependencies(nodeExe);

                Log("Spawning Node backend: " + nodeExe + " " + serverScript);

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodeExe;
                psi.Arguments = "server/index.js";
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.EnvironmentVariables["NODE_ENV"] = "production";

                string nodeDir = Path.GetDirectoryName(nodeExe);
                if (!string.IsNullOrEmpty(nodeDir))
                {
                    psi.EnvironmentVariables["PATH"] = nodeDir + ";" + Environment.GetEnvironmentVariable("PATH");
                }

                nodeProcess = new Process();
                nodeProcess.StartInfo = psi;
                nodeProcess.OutputDataReceived += (s, e) => { if (e.Data != null) Log("[Node] " + e.Data); };
                nodeProcess.ErrorDataReceived += (s, e) => { if (e.Data != null) Log("[Node ERROR] " + e.Data); };

                nodeProcess.Start();
                nodeProcess.BeginOutputReadLine();
                nodeProcess.BeginErrorReadLine();
                Log("Node backend process started with PID: " + nodeProcess.Id);
            }
            catch (Exception ex)
            {
                Log("Failed to start Node backend: " + ex.ToString());
            }
        }

        private string FindNodeExecutable()
        {
            string[] searchPaths = new string[]
            {
                Path.Combine(appDir, @"nodejs\node.exe"),
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\node.exe"),
                "node.exe"
            };

            foreach (string p in searchPaths)
            {
                if (p != "node.exe" && File.Exists(p))
                {
                    return p;
                }
            }

            return "node";
        }

        private bool IsServerResponding()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://localhost:3001/api/tray/status");
                req.Timeout = 1500;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private void PollServerStatus()
        {
            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://localhost:3001/api/tray/status");
                    req.Timeout = 2000;
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        string json = reader.ReadToEnd();
                        bool isRunning = json.Contains("\"bdsState\":\"running\"");
                        int players = 0;

                        int idx = json.IndexOf("\"playersCount\":");
                        if (idx != -1)
                        {
                            int start = idx + 15;
                            int end = json.IndexOfAny(new char[] { ',', '}' }, start);
                            if (end > start)
                            {
                                int.TryParse(json.Substring(start, end - start).Trim(), out players);
                            }
                        }

                        if (syncContext != null)
                        {
                            syncContext.Post(_ =>
                            {
                                try
                                {
                                    if (isRunning)
                                    {
                                        menuStartBds.Enabled = false;
                                        menuStopBds.Enabled = true;
                                        menuRestartBds.Enabled = true;
                                        SetTrayText(string.Format("Bedrock Server: Online ({0} players)", players));
                                    }
                                    else
                                    {
                                        menuStartBds.Enabled = true;
                                        menuStopBds.Enabled = false;
                                        menuRestartBds.Enabled = false;
                                        SetTrayText("Bedrock Server: Offline");
                                    }
                                }
                                catch { }
                            }, null);
                        }
                    }
                }
                catch
                {
                    if (syncContext != null)
                    {
                        syncContext.Post(_ =>
                        {
                            try
                            {
                                SetTrayText("Bedrock Manager (Connecting...)");
                            }
                            catch { }
                        }, null);
                    }
                }
            });
        }

        private void SendTrayAction(string action)
        {
            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://localhost:3001/api/tray/action");
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 5000;

                    byte[] data = Encoding.UTF8.GetBytes(string.Format("{{\"action\":\"{0}\"}}", action));
                    req.ContentLength = data.Length;
                    using (Stream stream = req.GetRequestStream())
                    {
                        stream.Write(data, 0, data.Length);
                    }

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    using (StreamReader reader = new StreamReader(resp.GetResponseStream()))
                    {
                        string res = reader.ReadToEnd();
                        Log("Action " + action + " response: " + res);
                    }

                    PollServerStatus();
                }
                catch (Exception ex)
                {
                    Log("Action " + action + " failed: " + ex.Message);
                }
            });
        }

        private void OpenDirectory(string dirPath)
        {
            try
            {
                if (!Directory.Exists(dirPath))
                {
                    Directory.CreateDirectory(dirPath);
                }
                Process.Start("explorer.exe", dirPath);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to open folder: " + ex.Message, "Bedrock Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenLogs()
        {
            try
            {
                if (!File.Exists(logFilePath))
                {
                    File.WriteAllText(logFilePath, "[Init] Log file created.\n");
                }
                Process.Start("notepad.exe", logFilePath);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to open logs: " + ex.Message, "Bedrock Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private bool IsAutoStartEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("BedrockServerManager");
                        return val != null;
                    }
                }
            }
            catch { }
            return false;
        }

        private void ToggleAutoStart()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null)
                    {
                        if (menuAutoStart.Checked)
                        {
                            key.DeleteValue("BedrockServerManager", false);
                            menuAutoStart.Checked = false;
                            try { notifyIcon.ShowBalloonTip(2000, "Bedrock Server Manager", "Disabled start with Windows.", ToolTipIcon.Info); } catch { }
                        }
                        else
                        {
                            string exePath = Application.ExecutablePath;
                            key.SetValue("BedrockServerManager", "\"" + exePath + "\"");
                            menuAutoStart.Checked = true;
                            try { notifyIcon.ShowBalloonTip(2000, "Bedrock Server Manager", "Enabled start with Windows.", ToolTipIcon.Info); } catch { }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to update Windows startup registry: " + ex.Message, "Bedrock Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void RestartApp()
        {
            try
            {
                Process.Start(Application.ExecutablePath);
                ExitApplication();
            }
            catch { }
        }

        private void ExitApplication()
        {
            try
            {
                Log("Shutting down Bedrock Server Manager Tray...");
                if (statusTimer != null) statusTimer.Stop();

                SendTrayAction("stop_bds");
                Thread.Sleep(800);

                if (nodeProcess != null && !nodeProcess.HasExited)
                {
                    try
                    {
                        nodeProcess.Kill();
                        nodeProcess.WaitForExit(1500);
                    }
                    catch { }
                }

                if (notifyIcon != null)
                {
                    notifyIcon.Visible = false;
                    notifyIcon.Dispose();
                }
            }
            catch { }
            finally
            {
                Application.Exit();
            }
        }

        private void Log(string msg)
        {
            try
            {
                string line = string.Format("[{0:yyyy-MM-dd HH:mm:ss}] {1}{2}", DateTime.Now, msg, Environment.NewLine);
                File.AppendAllText(logFilePath, line);
            }
            catch { }
        }
    }
}

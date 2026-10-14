using System;
using System.IO;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Threading;
using System.Net;
using System.Text;
using System.Windows.Forms;
using System.Runtime.InteropServices;
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

            bool needsSetup = IsSetupRequired();
            if (needsSetup)
            {
                Icon appIco = null;
                try
                {
                    string iconPath = Path.Combine(appDir, "tray", "app.ico");
                    if (File.Exists(iconPath)) appIco = new Icon(iconPath);
                }
                catch { }

                using (SetupProgressForm setupForm = new SetupProgressForm(appIco))
                {
                    setupForm.StartSetupTask((form) =>
                    {
                        RunSetupWithProgress(form);
                    });
                    DialogResult res = setupForm.ShowDialog();
                    if (res != DialogResult.OK && !IsServerResponding())
                    {
                        Log("Setup was cancelled or closed by user. Exiting launcher.");
                        ExitApplication();
                        return;
                    }
                }
            }
            else
            {
                StartNodeBackend();
            }

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

        private bool IsSetupRequired()
        {
            if (IsServerResponding()) return false;
            string nodeModulesDir = Path.Combine(appDir, "node_modules");
            string clientIndex = Path.Combine(appDir, "client", "dist", "index.html");
            return !Directory.Exists(nodeModulesDir) || !File.Exists(clientIndex);
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

                StartNodeBackendProcess();
            }
            catch (Exception ex)
            {
                Log("Failed to start Node backend: " + ex.ToString());
            }
        }

        private void StartNodeBackendProcess()
        {
            if (nodeProcess != null && !nodeProcess.HasExited) return;

            string nodeExe = FindNodeExecutable();
            string serverScript = Path.Combine(appDir, "server", "index.js");

            if (!File.Exists(serverScript))
            {
                Log("ERROR: Server script not found at " + serverScript);
                MessageBox.Show("Could not find server entry point:\n" + serverScript, "Bedrock Server Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

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

            nodeProcess = new Process();
            nodeProcess.StartInfo = psi;
            nodeProcess.OutputDataReceived += (s, e) => { if (e.Data != null) Log("[Node] " + e.Data); };
            nodeProcess.ErrorDataReceived += (s, e) => { if (e.Data != null) Log("[Node ERROR] " + e.Data); };

            nodeProcess.Start();
            nodeProcess.BeginOutputReadLine();
            nodeProcess.BeginErrorReadLine();
            Log("Node backend process started with PID: " + nodeProcess.Id);
        }

        private void RunSetupWithProgress(SetupProgressForm form)
        {
            try
            {
                form.UpdateProgress(5, "Verifying Environment...", "Checking Node.js runtime and workspace paths...", "Step 1 of 3: System Check");

                string nodeExe = FindNodeExecutable();
                string serverScript = Path.Combine(appDir, "server", "index.js");

                if (!File.Exists(serverScript))
                {
                    form.ShowError("Server entry point not found at server/index.js");
                    return;
                }

                string nodeModulesDir = Path.Combine(appDir, "node_modules");
                if (!Directory.Exists(nodeModulesDir))
                {
                    Log("First-time setup detected: node_modules missing. Starting npm install with live progress tracking...");
                    form.UpdateProgress(10, "Installing Server Dependencies (npm install)...", "Downloading and preparing Node.js packages...", "Step 1 of 3: Node Dependencies");

                    ProcessStartInfo npmPsi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = "/c npm install --omit=dev --no-audit --no-fund",
                        WorkingDirectory = appDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };

                    DateTime npmStart = DateTime.Now;
                    using (Process npmProc = new Process())
                    {
                        npmProc.StartInfo = npmPsi;
                        npmProc.OutputDataReceived += (s, e) =>
                        {
                            if (!string.IsNullOrEmpty(e.Data))
                            {
                                string clean = e.Data.Trim();
                                if (clean.Length > 0 && !clean.StartsWith("npm notice"))
                                {
                                    form.UpdateProgress(-1, null, clean, null);
                                }
                            }
                        };
                        npmProc.ErrorDataReceived += (s, e) =>
                        {
                            if (!string.IsNullOrEmpty(e.Data) && !e.Data.Contains("npm warn"))
                            {
                                form.UpdateProgress(-1, null, e.Data.Trim(), null);
                            }
                        };

                        npmProc.Start();
                        npmProc.BeginOutputReadLine();
                        npmProc.BeginErrorReadLine();

                        // Smooth interpolation from 10% to 62% while npm executes
                        while (!npmProc.HasExited)
                        {
                            Thread.Sleep(350);
                            double elapsedSec = (DateTime.Now - npmStart).TotalSeconds;
                            int interpolated = 10 + (int)(Math.Min(1.0, elapsedSec / 32.0) * 52);
                            form.UpdateProgress(interpolated, "Installing Server Dependencies (npm install)...", null, "Step 1 of 3: Node Dependencies");
                        }
                    }

                    Log("Server dependencies installed successfully.");
                    form.UpdateProgress(64, "Dependencies Installed Successfully", "✓ Core packages verified.", "Step 1 of 3 Complete");
                    Thread.Sleep(300);
                }
                else
                {
                    form.UpdateProgress(60, "Server Dependencies Verified", "✓ Core packages already installed.", "Step 1 of 3 Complete");
                    Thread.Sleep(150);
                }

                // Step 2: Check client/dist
                string clientIndex = Path.Combine(appDir, "client", "dist", "index.html");
                if (!File.Exists(clientIndex))
                {
                    form.UpdateProgress(65, "Compiling Web Dashboard...", "Building client web assets with Vite...", "Step 2 of 3: Frontend Build");
                    DateTime buildStart = DateTime.Now;

                    ProcessStartInfo buildPsi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = "/c cd client && npm install --no-audit --no-fund && npm run build",
                        WorkingDirectory = appDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };

                    using (Process buildProc = new Process())
                    {
                        buildProc.StartInfo = buildPsi;
                        buildProc.OutputDataReceived += (s, e) =>
                        {
                            if (!string.IsNullOrEmpty(e.Data)) form.UpdateProgress(-1, null, e.Data.Trim(), null);
                        };
                        buildProc.Start();
                        buildProc.BeginOutputReadLine();

                        while (!buildProc.HasExited)
                        {
                            Thread.Sleep(350);
                            double elapsedSec = (DateTime.Now - buildStart).TotalSeconds;
                            int interpolated = 65 + (int)(Math.Min(1.0, elapsedSec / 22.0) * 20);
                            form.UpdateProgress(interpolated, "Compiling Web Dashboard...", null, "Step 2 of 3: Frontend Build");
                        }
                    }

                    form.UpdateProgress(85, "Dashboard Built Successfully", "✓ Production web assets compiled.", "Step 2 of 3 Complete");
                    Thread.Sleep(250);
                }
                else
                {
                    form.UpdateProgress(85, "Dashboard Assets Verified", "✓ Pre-built client dist assets verified.", "Step 2 of 3 Complete");
                    Thread.Sleep(150);
                }

                // Step 3: Launch Node backend & wait for responsiveness
                form.UpdateProgress(88, "Starting Server Backend...", "Spawning Node.js background process...", "Step 3 of 3: Server Online");
                StartNodeBackendProcess();

                // Wait for health check
                int checkAttempts = 0;
                bool isReady = false;
                while (checkAttempts < 30 && !isReady)
                {
                    isReady = IsServerResponding();
                    if (!isReady)
                    {
                        Thread.Sleep(400);
                        checkAttempts++;
                        int p = Math.Min(98, 88 + (checkAttempts / 3));
                        form.UpdateProgress(p, "Starting Server Backend...", string.Format("Connecting to manager on port 3001 (attempt {0}/30)...", checkAttempts), "Step 3 of 3: Health Check");
                    }
                }

                form.UpdateProgress(100, "✓ Setup Complete!", "Bedrock Server Manager is online at http://localhost:3001", "Ready!");
                form.CompleteAndClose();
            }
            catch (Exception ex)
            {
                Log("Setup error: " + ex.Message);
                form.ShowError("Setup failed: " + ex.Message);
            }
        }

        private string FindNodeExecutable()
        {
            string[] searchPaths = new string[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe"),
                "node.exe"
            };

            foreach (string p in searchPaths)
            {
                if (p == "node.exe" || File.Exists(p))
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

    /// <summary>
    /// Custom double-buffered progress bar with modern styling and emerald gradient.
    /// </summary>
    public class ModernProgressBar : Control
    {
        private int val = 0;
        private int max = 100;

        public ModernProgressBar()
        {
            this.SetStyle(
                ControlStyles.UserPaint |
                ControlStyles.AllPaintingInWmPaint |
                ControlStyles.OptimizedDoubleBuffer |
                ControlStyles.ResizeRedraw,
                true
            );
            this.BackColor = Color.FromArgb(30, 41, 59); // Slate-800
        }

        public int Value
        {
            get { return val; }
            set
            {
                int newVal = Math.Max(0, Math.Min(max, value));
                if (val != newVal)
                {
                    val = newVal;
                    this.Invalidate();
                }
            }
        }

        public int Maximum
        {
            get { return max; }
            set
            {
                max = Math.Max(1, value);
                this.Invalidate();
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            // Background
            using (SolidBrush bgBrush = new SolidBrush(this.BackColor))
            {
                g.FillRectangle(bgBrush, this.ClientRectangle);
            }

            // Outer border
            using (Pen borderPen = new Pen(Color.FromArgb(51, 65, 85), 1))
            {
                g.DrawRectangle(borderPen, 0, 0, this.Width - 1, this.Height - 1);
            }

            // Fill
            if (val > 0)
            {
                float fillWidth = ((float)val / (float)max) * (this.Width - 4);
                if (fillWidth > 0)
                {
                    RectangleF fillRect = new RectangleF(2, 2, fillWidth, this.Height - 4);
                    // Emerald gradient
                    using (LinearGradientBrush fillBrush = new LinearGradientBrush(
                        fillRect,
                        Color.FromArgb(16, 185, 129),
                        Color.FromArgb(5, 150, 105),
                        LinearGradientMode.Horizontal))
                    {
                        g.FillRectangle(fillBrush, fillRect);
                    }

                    // Subtle highlight on top half of fill
                    RectangleF shineRect = new RectangleF(2, 2, fillWidth, Math.Max(1, (this.Height - 4) / 2f));
                    using (SolidBrush shineBrush = new SolidBrush(Color.FromArgb(35, 255, 255, 255)))
                    {
                        g.FillRectangle(shineBrush, shineRect);
                    }
                }
            }
        }
    }

    /// <summary>
    /// Modern dark-themed progress dialog shown during initial setup and dependency downloads.
    /// Displays live progress bar, percentage, elapsed time, and step status.
    /// </summary>
    public class SetupProgressForm : Form
    {
        [DllImport("user32.dll")]
        private static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        private Panel pnlHeader;
        private Label lblAppTitle;
        private Label lblSubTitle;
        private Label lblStatus;
        private Label lblDetails;
        private Label lblStep;
        private Label lblPercent;
        private Label lblElapsed;
        private Label lblNote;
        private Button btnClose;
        private ModernProgressBar progressBar;
        private System.Windows.Forms.Timer elapsedTimer;
        private DateTime startTime;
        private int currentPercent = 0;
        private Icon customIcon;

        public SetupProgressForm(Icon icon)
        {
            this.customIcon = icon;
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();

            this.Width = 530;
            this.Height = 250;
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(15, 23, 42); // Slate-900
            this.ForeColor = Color.FromArgb(248, 250, 252);
            this.TopMost = true;
            this.ShowInTaskbar = true;
            this.Text = "Bedrock Dedicated Server Manager - Initial Setup";
            if (this.customIcon != null) this.Icon = this.customIcon;

            // Make form draggable
            this.MouseDown += (s, e) =>
            {
                if (e.Button == MouseButtons.Left)
                {
                    ReleaseCapture();
                    SendMessage(this.Handle, 0xA1, 0x2, 0);
                }
            };

            // 1. Header panel
            pnlHeader = new Panel();
            pnlHeader.Dock = DockStyle.Top;
            pnlHeader.Height = 56;
            pnlHeader.BackColor = Color.FromArgb(22, 32, 50);
            pnlHeader.MouseDown += (s, e) =>
            {
                if (e.Button == MouseButtons.Left)
                {
                    ReleaseCapture();
                    SendMessage(this.Handle, 0xA1, 0x2, 0);
                }
            };

            // Header bottom border
            pnlHeader.Paint += (s, e) =>
            {
                using (Pen p = new Pen(Color.FromArgb(51, 65, 85), 1))
                {
                    e.Graphics.DrawLine(p, 0, pnlHeader.Height - 1, pnlHeader.Width, pnlHeader.Height - 1);
                }
            };

            // Header Icon / Emoji
            Label lblHeaderIcon = new Label();
            lblHeaderIcon.Text = "🎮";
            lblHeaderIcon.Font = new Font("Segoe UI Emoji", 13.5f);
            lblHeaderIcon.AutoSize = true;
            lblHeaderIcon.Location = new Point(14, 14);
            lblHeaderIcon.BackColor = Color.Transparent;
            pnlHeader.Controls.Add(lblHeaderIcon);

            lblAppTitle = new Label();
            lblAppTitle.Text = "Bedrock Dedicated Server Manager";
            lblAppTitle.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
            lblAppTitle.ForeColor = Color.White;
            lblAppTitle.AutoSize = true;
            lblAppTitle.Location = new Point(48, 10);
            lblAppTitle.BackColor = Color.Transparent;
            pnlHeader.Controls.Add(lblAppTitle);

            lblSubTitle = new Label();
            lblSubTitle.Text = "First-Time Setup & Dependency Preparation";
            lblSubTitle.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblSubTitle.ForeColor = Color.FromArgb(148, 163, 184); // Slate-400
            lblSubTitle.AutoSize = true;
            lblSubTitle.Location = new Point(49, 32);
            lblSubTitle.BackColor = Color.Transparent;
            pnlHeader.Controls.Add(lblSubTitle);

            btnClose = new Button();
            btnClose.Text = "✕";
            btnClose.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            btnClose.ForeColor = Color.FromArgb(148, 163, 184);
            btnClose.BackColor = Color.Transparent;
            btnClose.FlatStyle = FlatStyle.Flat;
            btnClose.FlatAppearance.BorderSize = 0;
            btnClose.FlatAppearance.MouseOverBackColor = Color.FromArgb(239, 68, 68);
            btnClose.FlatAppearance.MouseDownBackColor = Color.FromArgb(185, 28, 28);
            btnClose.Size = new Size(30, 26);
            btnClose.Location = new Point(this.Width - 38, 12);
            btnClose.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            btnClose.Cursor = Cursors.Hand;
            btnClose.Click += (s, e) =>
            {
                this.DialogResult = DialogResult.Cancel;
                this.Close();
            };
            pnlHeader.Controls.Add(btnClose);

            this.Controls.Add(pnlHeader);

            // 2. Status Label
            lblStatus = new Label();
            lblStatus.Text = "Preparing server environment...";
            lblStatus.Font = new Font("Segoe UI", 10.5f, FontStyle.Bold);
            lblStatus.ForeColor = Color.FromArgb(52, 211, 153); // Emerald-400
            lblStatus.Location = new Point(22, 72);
            lblStatus.Size = new Size(485, 22);
            lblStatus.AutoEllipsis = true;
            this.Controls.Add(lblStatus);

            // 3. Details Label
            lblDetails = new Label();
            lblDetails.Text = "Please wait while required components are downloaded...";
            lblDetails.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblDetails.ForeColor = Color.FromArgb(148, 163, 184);
            lblDetails.Location = new Point(23, 96);
            lblDetails.Size = new Size(485, 20);
            lblDetails.AutoEllipsis = true;
            this.Controls.Add(lblDetails);

            // 4. Step indicator (left above bar)
            lblStep = new Label();
            lblStep.Text = "Step 1 of 3: Core Packages";
            lblStep.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            lblStep.ForeColor = Color.FromArgb(100, 116, 139); // Slate-500
            lblStep.Location = new Point(22, 124);
            lblStep.Size = new Size(320, 18);
            this.Controls.Add(lblStep);

            // 5. Percentage (right above bar)
            lblPercent = new Label();
            lblPercent.Text = "0%";
            lblPercent.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
            lblPercent.ForeColor = Color.FromArgb(52, 211, 153); // Emerald
            lblPercent.TextAlign = ContentAlignment.MiddleRight;
            lblPercent.Location = new Point(410, 118);
            lblPercent.Size = new Size(98, 24);
            this.Controls.Add(lblPercent);

            // 6. Modern Progress Bar
            progressBar = new ModernProgressBar();
            progressBar.Location = new Point(22, 148);
            progressBar.Size = new Size(485, 22);
            progressBar.Value = 0;
            progressBar.Maximum = 100;
            this.Controls.Add(progressBar);

            // 7. Footer note (left)
            lblNote = new Label();
            lblNote.Text = "⚡ Automatic setup runs only once on your first launch.";
            lblNote.Font = new Font("Segoe UI", 8f, FontStyle.Italic);
            lblNote.ForeColor = Color.FromArgb(100, 116, 139);
            lblNote.Location = new Point(22, 186);
            lblNote.Size = new Size(340, 20);
            this.Controls.Add(lblNote);

            // 8. Elapsed timer (right)
            lblElapsed = new Label();
            lblElapsed.Text = "⏱ 00:00";
            lblElapsed.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblElapsed.ForeColor = Color.FromArgb(148, 163, 184);
            lblElapsed.TextAlign = ContentAlignment.MiddleRight;
            lblElapsed.Location = new Point(410, 184);
            lblElapsed.Size = new Size(98, 20);
            this.Controls.Add(lblElapsed);

            // Draw outer border
            this.Paint += (s, e) =>
            {
                using (Pen borderPen = new Pen(Color.FromArgb(51, 65, 85), 1))
                {
                    e.Graphics.DrawRectangle(borderPen, 0, 0, this.Width - 1, this.Height - 1);
                }
            };

            this.ResumeLayout(false);
        }

        public void StartSetupTask(Action<SetupProgressForm> workerAction)
        {
            this.startTime = DateTime.Now;
            this.elapsedTimer = new System.Windows.Forms.Timer();
            this.elapsedTimer.Interval = 500;
            this.elapsedTimer.Tick += (s, e) =>
            {
                TimeSpan span = DateTime.Now - startTime;
                lblElapsed.Text = string.Format("⏱ {0:00}:{1:00}", (int)span.TotalMinutes, span.Seconds);
            };
            this.elapsedTimer.Start();

            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    workerAction(this);
                }
                catch (Exception ex)
                {
                    this.ShowError("Setup encountered an issue: " + ex.Message);
                }
            });
        }

        public void UpdateProgress(int percent, string status, string details, string step)
        {
            if (this.InvokeRequired)
            {
                try
                {
                    this.BeginInvoke(new Action<int, string, string, string>(UpdateProgress), percent, status, details, step);
                }
                catch { }
                return;
            }

            if (percent >= 0)
            {
                currentPercent = Math.Max(0, Math.Min(100, percent));
                progressBar.Value = currentPercent;
                lblPercent.Text = currentPercent + "%";
            }

            if (!string.IsNullOrEmpty(status)) lblStatus.Text = status;
            if (!string.IsNullOrEmpty(details)) lblDetails.Text = details;
            if (!string.IsNullOrEmpty(step)) lblStep.Text = step;
        }

        public void ShowError(string errorMsg)
        {
            if (this.InvokeRequired)
            {
                try { this.BeginInvoke(new Action<string>(ShowError), errorMsg); } catch { }
                return;
            }

            if (elapsedTimer != null) elapsedTimer.Stop();
            lblStatus.Text = "Setup Notice";
            lblStatus.ForeColor = Color.FromArgb(239, 68, 68); // Red
            lblDetails.Text = errorMsg;
            lblStep.Text = "Please review data\\logs\\manager-launcher.log";
            lblPercent.ForeColor = Color.FromArgb(239, 68, 68);

            System.Windows.Forms.Timer closeTimer = new System.Windows.Forms.Timer();
            closeTimer.Interval = 4000;
            closeTimer.Tick += (s, e) =>
            {
                closeTimer.Stop();
                this.DialogResult = DialogResult.Cancel;
                this.Close();
            };
            closeTimer.Start();
        }

        public void CompleteAndClose()
        {
            if (this.InvokeRequired)
            {
                try { this.BeginInvoke(new Action(CompleteAndClose)); } catch { }
                return;
            }

            if (elapsedTimer != null) elapsedTimer.Stop();
            UpdateProgress(100, "✓ Setup Complete!", "Launching Bedrock Server Manager...", "Ready!");

            System.Windows.Forms.Timer finishTimer = new System.Windows.Forms.Timer();
            finishTimer.Interval = 650;
            finishTimer.Tick += (s, e) =>
            {
                finishTimer.Stop();
                this.DialogResult = DialogResult.OK;
                this.Close();
            };
            finishTimer.Start();
        }
    }
}

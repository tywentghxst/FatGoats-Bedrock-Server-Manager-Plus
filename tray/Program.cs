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
using System.IO.Compression;

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
                        Log("Setup was cancelled or closed by user before completion.");
                        ExitApplication();
                        return;
                    }
                }

                // Setup verified server online at 100%, open browser dashboard immediately
                Program.OpenBrowser(Program.DashboardUrl);
            }
            else
            {
                StartNodeBackend();
                // Automatically launch browser dashboard on startup once verified online
                AutoLaunchBrowserOnStartup();
            }

            InitializeTimer();

            // Notify user that app is sitting in taskbar overflow tray
            try
            {
                notifyIcon.ShowBalloonTip(
                    4500,
                    "Bedrock Dedicated Server Manager",
                    "Manager is running in your taskbar overflow tray (click ^ next to clock).\nRight-click for controls or click icon to open dashboard.",
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
            // Run on background thread: wait until server is verified responsive, then open browser
            ThreadPool.QueueUserWorkItem(state =>
            {
                int attempts = 0;
                bool ready = false;

                while (attempts < 25 && !ready)
                {
                    ready = IsServerResponding();
                    if (!ready)
                    {
                        Thread.Sleep(500);
                        attempts++;
                    }
                }

                if (ready)
                {
                    // Small grace delay to ensure page renders fully
                    Thread.Sleep(300);
                    Program.OpenBrowser(Program.DashboardUrl);
                    Log("Auto-launched browser dashboard on startup.");
                }
                else
                {
                    Log("Backend server did not respond within startup timeout. Skipping browser auto-launch to prevent error page.");
                }
            });
        }

        private bool IsSetupRequired()
        {
            if (IsServerResponding()) return false;

            // 1. Is Node.js runtime missing on this computer?
            string nodeExe = FindNodeExecutable();
            if (string.IsNullOrEmpty(nodeExe) || !File.Exists(nodeExe)) return true;

            // 2. Are server dependencies missing?
            string nodeModulesDir = Path.Combine(appDir, "node_modules");
            if (!Directory.Exists(nodeModulesDir)) return true;

            // 3. Is web dashboard build missing?
            string clientIndex = Path.Combine(appDir, "client", "dist", "index.html");
            if (!File.Exists(clientIndex)) return true;

            // 4. Is the official Bedrock Dedicated Server missing?
            string bdsExe = Path.Combine(appDir, "bds", "bedrock_server.exe");
            if (!File.Exists(bdsExe)) return true;

            return false;
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
                string errMsg = "Could not find server entry point:\n" + serverScript;
                Log("ERROR: " + errMsg);
                throw new FileNotFoundException(errMsg);
            }

            if (string.IsNullOrEmpty(nodeExe) || !File.Exists(nodeExe))
            {
                string errMsg = "Node.js was not detected on this system.";
                Log("ERROR: " + errMsg);
                throw new FileNotFoundException(errMsg);
            }

            Log(string.Format("Spawning Node backend: \"{0}\" \"{1}\" (CWD: {2})", nodeExe, serverScript, appDir));

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodeExe;
            psi.Arguments = "\"" + serverScript + "\"";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.EnvironmentVariables["NODE_ENV"] = "production";

            string nodeDir = Path.GetDirectoryName(nodeExe);
            string currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
            if (!currentPath.Contains(nodeDir))
            {
                psi.EnvironmentVariables["PATH"] = nodeDir + ";" + currentPath;
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

        private void DownloadFileWithProgress(string url, string destinationPath, SetupProgressForm form, int minPercent, int maxPercent, string stepName, string actionName)
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
            string dir = Path.GetDirectoryName(destinationPath);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

            string tempPath = destinationPath + ".downloading";
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch { }
            }

            using (WebClient wc = new WebClient())
            {
                wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

                AutoResetEvent waitHandle = new AutoResetEvent(false);
                Exception downloadEx = null;

                wc.DownloadProgressChanged += (s, e) =>
                {
                    double progressFraction = e.ProgressPercentage / 100.0;
                    int scaledPercent = minPercent + (int)(progressFraction * (maxPercent - minPercent));

                    double mbRecv = e.BytesReceived / 1048576.0;
                    double mbTotal = e.TotalBytesToReceive > 0 ? e.TotalBytesToReceive / 1048576.0 : 0.0;

                    string detailText = mbTotal > 0
                        ? string.Format("{0:F1} MB / {1:F1} MB ({2}%)", mbRecv, mbTotal, e.ProgressPercentage)
                        : string.Format("{0:F1} MB downloaded", mbRecv);

                    form.UpdateProgress(scaledPercent, actionName, detailText, stepName);
                };

                wc.DownloadFileCompleted += (s, e) =>
                {
                    if (e.Error != null) downloadEx = e.Error;
                    waitHandle.Set();
                };

                wc.DownloadFileAsync(new Uri(url), tempPath);
                waitHandle.WaitOne();

                if (downloadEx != null)
                {
                    try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
                    throw downloadEx;
                }

                if (File.Exists(destinationPath))
                {
                    try { File.Delete(destinationPath); } catch { }
                }

                File.Move(tempPath, destinationPath);
            }
        }

        private string GetLatestBdsDownloadUrl()
        {
            string fallbackUrl = "https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.26.52.3.zip";
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("https://net-secondary.web.minecraft-services.net/api/v1.0/download/links");
                req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
                req.Timeout = 4000;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string json = reader.ReadToEnd();
                    int idxWin = json.IndexOf("serverBedrockWindows");
                    if (idxWin != -1)
                    {
                        int urlIdx = json.IndexOf("\"downloadUrl\":", idxWin);
                        if (urlIdx != -1)
                        {
                            int quoteStart = json.IndexOf("\"", urlIdx + 14);
                            int quoteEnd = json.IndexOf("\"", quoteStart + 1);
                            if (quoteStart != -1 && quoteEnd != -1)
                            {
                                string foundUrl = json.Substring(quoteStart + 1, quoteEnd - quoteStart - 1).Replace("\\/", "/");
                                if (foundUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                                {
                                    return foundUrl;
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log("Mojang BDS API lookup notice: " + ex.Message + " (using official stable fallback).");
            }
            return fallbackUrl;
        }

        private void ExtractBdsZip(string zipPath, string bdsDir, SetupProgressForm form, int minPercent, int maxPercent)
        {
            if (!Directory.Exists(bdsDir)) Directory.CreateDirectory(bdsDir);

            using (ZipArchive archive = ZipFile.OpenRead(zipPath))
            {
                int total = archive.Entries.Count;
                int index = 0;

                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    index++;
                    string destPath = Path.GetFullPath(Path.Combine(bdsDir, entry.FullName));
                    if (!destPath.StartsWith(bdsDir, StringComparison.OrdinalIgnoreCase)) continue;

                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        if (!Directory.Exists(destPath)) Directory.CreateDirectory(destPath);
                    }
                    else
                    {
                        string dir = Path.GetDirectoryName(destPath);
                        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

                        // Preserve existing server configuration if already present
                        if (entry.Name.Equals("server.properties", StringComparison.OrdinalIgnoreCase) && File.Exists(destPath))
                        {
                            continue;
                        }

                        entry.ExtractToFile(destPath, true);
                    }

                    if (index % 12 == 0 || index == total)
                    {
                        int p = minPercent + (int)(((double)index / total) * (maxPercent - minPercent));
                        form.UpdateProgress(p, "Installing Bedrock Server...", string.Format("Extracting file {0}/{1}: {2}", index, total, entry.Name), "Step 4 of 5: Unpacking BDS");
                    }
                }
            }

            try { File.Delete(zipPath); } catch { }
        }

        private void RunSetupWithProgress(SetupProgressForm form)
        {
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;

                // Step 1: Check or Download Node.js runtime
                string nodeExe = FindNodeExecutable();
                if (string.IsNullOrEmpty(nodeExe) || !File.Exists(nodeExe))
                {
                    form.UpdateProgress(5, "Downloading Portable Node.js...", "Connecting to official Node.js distribution...", "Step 1 of 5: Node.js Runtime");
                    string nodeUrl = Environment.Is64BitOperatingSystem
                        ? "https://nodejs.org/dist/v20.18.0/win-x64/node.exe"
                        : "https://nodejs.org/dist/v20.18.0/win-x86/node.exe";

                    string targetNodeDir = Path.Combine(appDir, "data", "tools", "node");
                    string targetNodeExe = Path.Combine(targetNodeDir, "node.exe");

                    DownloadFileWithProgress(nodeUrl, targetNodeExe, form, 5, 38, "Step 1 of 5: Node.js Runtime", "Downloading Portable Node.js...");

                    if (!File.Exists(targetNodeExe) || new FileInfo(targetNodeExe).Length < 10000000)
                    {
                        throw new Exception("Downloaded Node.js binary was incomplete. Please verify your internet connection.");
                    }

                    nodeExe = targetNodeExe;
                    Log("Portable Node.js runtime successfully downloaded to: " + nodeExe);
                    form.UpdateProgress(38, "Node.js Runtime Ready", "✓ Portable Node.js engine installed.", "Step 1 of 5 Complete");
                    Thread.Sleep(200);
                }
                else
                {
                    form.UpdateProgress(38, "Node.js Runtime Verified", "✓ Node.js detected: " + Path.GetFileName(nodeExe), "Step 1 of 5 Complete");
                    Thread.Sleep(150);
                }

                string serverScript = Path.Combine(appDir, "server", "index.js");
                if (!File.Exists(serverScript))
                {
                    throw new FileNotFoundException("Server entry point not found at server/index.js");
                }

                // Step 2: Check server dependencies (node_modules)
                string nodeModulesDir = Path.Combine(appDir, "node_modules");
                if (!Directory.Exists(nodeModulesDir))
                {
                    string npmExe = FindNpmExecutable(nodeExe);
                    if (File.Exists(npmExe) || npmExe == "npm.cmd")
                    {
                        form.UpdateProgress(40, "Installing Server Dependencies...", "Running npm install for core packages...", "Step 2 of 5: Dependencies");
                        string nodeDir = Path.GetDirectoryName(nodeExe);
                        string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
                        if (!pathEnv.Contains(nodeDir)) pathEnv = nodeDir + ";" + pathEnv;

                        ProcessStartInfo npmPsi = new ProcessStartInfo
                        {
                            FileName = "cmd.exe",
                            Arguments = string.Format("/c \"\"{0}\" install --omit=dev --no-audit --no-fund\"", npmExe),
                            WorkingDirectory = appDir,
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            RedirectStandardOutput = true,
                            RedirectStandardError = true
                        };
                        npmPsi.EnvironmentVariables["PATH"] = pathEnv;

                        DateTime npmStart = DateTime.Now;
                        using (Process npmProc = new Process())
                        {
                            npmProc.StartInfo = npmPsi;
                            npmProc.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) form.UpdateProgress(-1, null, e.Data.Trim(), null); };
                            npmProc.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) form.UpdateProgress(-1, null, e.Data.Trim(), null); };
                            npmProc.Start();
                            npmProc.BeginOutputReadLine();
                            npmProc.BeginErrorReadLine();

                            while (!npmProc.HasExited)
                            {
                                Thread.Sleep(350);
                                double elapsedSec = (DateTime.Now - npmStart).TotalSeconds;
                                int interpolated = 40 + (int)(Math.Min(1.0, elapsedSec / 30.0) * 18);
                                form.UpdateProgress(interpolated, "Installing Server Dependencies...", null, "Step 2 of 5: Dependencies");
                            }
                            npmProc.WaitForExit();

                            if (npmProc.ExitCode != 0 && !Directory.Exists(nodeModulesDir))
                            {
                                throw new Exception(string.Format("npm install failed with exit code {0}.", npmProc.ExitCode));
                            }
                        }
                    }
                    else
                    {
                        throw new DirectoryNotFoundException("The node_modules folder is missing and npm was not found. Please ensure project files were fully extracted.");
                    }

                    form.UpdateProgress(58, "Dependencies Installed", "✓ Server packages verified.", "Step 2 of 5 Complete");
                    Thread.Sleep(200);
                }
                else
                {
                    form.UpdateProgress(58, "Dependencies Verified", "✓ Core server modules verified.", "Step 2 of 5 Complete");
                    Thread.Sleep(150);
                }

                // Step 3: Check client/dist
                string clientIndex = Path.Combine(appDir, "client", "dist", "index.html");
                if (!File.Exists(clientIndex))
                {
                    string npmExe = FindNpmExecutable(nodeExe);
                    form.UpdateProgress(60, "Building Web Dashboard Assets...", "Compiling frontend assets with Vite...", "Step 3 of 5: Web Assets");
                    string clientDir = Path.Combine(appDir, "client");
                    ProcessStartInfo buildPsi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = string.Format("/c \"\"{0}\" run build\"", npmExe),
                        WorkingDirectory = clientDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };
                    using (Process p = Process.Start(buildPsi))
                    {
                        p.WaitForExit();
                    }
                }
                form.UpdateProgress(62, "Dashboard Assets Verified", "✓ Web dashboard ready.", "Step 3 of 5 Complete");
                Thread.Sleep(150);

                // Step 4: Check or Download Minecraft Bedrock Dedicated Server (BDS)
                string bdsDir = Path.Combine(appDir, "bds");
                string bdsExe = Path.Combine(bdsDir, "bedrock_server.exe");
                if (!File.Exists(bdsExe))
                {
                    form.UpdateProgress(64, "Resolving Bedrock Server...", "Querying official Mojang Bedrock download servers...", "Step 4 of 5: Minecraft Server");
                    string bdsUrl = GetLatestBdsDownloadUrl();
                    Log("Downloading official Bedrock Dedicated Server from: " + bdsUrl);

                    string uploadDir = Path.Combine(appDir, "data", "uploads");
                    if (!Directory.Exists(uploadDir)) Directory.CreateDirectory(uploadDir);
                    string zipPath = Path.Combine(uploadDir, "bedrock-server-initial.zip");

                    DownloadFileWithProgress(bdsUrl, zipPath, form, 64, 82, "Step 4 of 5: Minecraft Server", "Downloading Official Bedrock Server...");

                    form.UpdateProgress(82, "Extracting Bedrock Server...", "Unpacking official Mojang server files to bds/...", "Step 4 of 5: Extracting");
                    ExtractBdsZip(zipPath, bdsDir, form, 82, 91);

                    if (!File.Exists(bdsExe))
                    {
                        throw new FileNotFoundException("Failed to locate bedrock_server.exe after extracting BDS archive.");
                    }

                    Log("Official Bedrock Dedicated Server successfully downloaded and installed to: " + bdsDir);
                    form.UpdateProgress(91, "Minecraft Server Ready", "✓ Mojang Bedrock Server executable installed.", "Step 4 of 5 Complete");
                    Thread.Sleep(200);
                }
                else
                {
                    form.UpdateProgress(90, "Minecraft Server Verified", "✓ Bedrock Dedicated Server binary found.", "Step 4 of 5 Complete");
                    Thread.Sleep(150);
                }

                // Step 5: Start Node Backend & Verify Server Health
                form.UpdateProgress(92, "Starting Server Backend...", "Spawning Node.js background process...", "Step 5 of 5: Server Online");
                StartNodeBackendProcess();

                int checkAttempts = 0;
                bool isReady = false;
                while (checkAttempts < 35 && !isReady)
                {
                    isReady = IsServerResponding();
                    if (!isReady)
                    {
                        Thread.Sleep(400);
                        checkAttempts++;
                        int p = Math.Min(99, 92 + (int)((checkAttempts / 35.0) * 7));
                        form.UpdateProgress(p, "Starting Server Backend...", string.Format("Verifying manager connection on port 3001 (attempt {0}/35)...", checkAttempts), "Step 5 of 5: Health Check");
                    }
                }

                if (!isReady)
                {
                    throw new Exception("The server manager backend started but did not respond on http://localhost:3001 in time. Please check data/logs/manager-launcher.log.");
                }

                form.UpdateProgress(100, "✓ Setup Complete!", "Bedrock Server Manager is online at http://localhost:3001", "Ready!");
                form.CompleteAndClose();
            }
            catch (Exception ex)
            {
                Log("Setup error: " + ex.Message + "\n" + ex.StackTrace);
                form.ShowError(ex.Message);
            }
        }

        private string FindNodeExecutable()
        {
            // 1. Portable Node in app directory or data/tools/node
            string[] localPaths = new string[]
            {
                Path.Combine(appDir, "data", "tools", "node", "node.exe"),
                Path.Combine(appDir, "tools", "node", "node.exe"),
                Path.Combine(appDir, "tools", "node.exe"),
                Path.Combine(appDir, "node.exe")
            };

            foreach (string p in localPaths)
            {
                try
                {
                    if (File.Exists(p) && new FileInfo(p).Length > 10000000) return p;
                }
                catch { }
            }

            // 2. Direct standard installation paths
            string[] standardPaths = new string[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"nvm\current\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\node.exe"),
                @"C:\ProgramData\chocolatey\bin\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @"scoop\apps\nodejs\current\node.exe")
            };

            foreach (string p in standardPaths)
            {
                try
                {
                    if (File.Exists(p)) return p;
                }
                catch { }
            }

            // 3. Scan system & user PATH
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] pathDirs = pathEnv.Split(new char[] { Path.PathSeparator }, StringSplitOptions.RemoveEmptyEntries);
            foreach (string dir in pathDirs)
            {
                try
                {
                    string candidate = Path.Combine(dir.Trim().Trim('"'), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }

            // 4. Fallback: ask `cmd.exe /c where node`
            try
            {
                ProcessStartInfo wherePsi = new ProcessStartInfo("cmd.exe", "/c where node")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true
                };
                using (Process p = Process.Start(wherePsi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                    string[] lines = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (string line in lines)
                    {
                        string trimmed = line.Trim();
                        if (File.Exists(trimmed) && trimmed.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                        {
                            return trimmed;
                        }
                    }
                }
            }
            catch { }

            return null;
        }

        private string FindNpmExecutable(string nodeExe = null)
        {
            if (string.IsNullOrEmpty(nodeExe)) nodeExe = FindNodeExecutable();

            if (!string.IsNullOrEmpty(nodeExe))
            {
                string dir = Path.GetDirectoryName(nodeExe);
                string candidate = Path.Combine(dir, "npm.cmd");
                if (File.Exists(candidate)) return candidate;
                candidate = Path.Combine(dir, "npm");
                if (File.Exists(candidate)) return candidate;
            }

            // Standard fallback paths
            string[] standardPaths = new string[]
            {
                @"C:\Program Files\nodejs\npm.cmd",
                @"C:\Program Files (x86)\nodejs\npm.cmd",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\npm.cmd"),
                @"C:\ProgramData\chocolatey\bin\npm.cmd"
            };

            foreach (string p in standardPaths)
            {
                try
                {
                    if (File.Exists(p)) return p;
                }
                catch { }
            }

            // Scan PATH
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(new char[] { Path.PathSeparator }, StringSplitOptions.RemoveEmptyEntries))
            {
                try
                {
                    string candidate = Path.Combine(dir.Trim().Trim('"'), "npm.cmd");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }

            return "npm.cmd";
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
        private Button btnRetry;
        private Button btnViewLogs;
        private ModernProgressBar progressBar;
        private System.Windows.Forms.Timer elapsedTimer;
        private DateTime startTime;
        private int currentPercent = 0;
        private Icon customIcon;
        private Action<SetupProgressForm> currentWorkerAction;

        public SetupProgressForm(Icon icon)
        {
            this.customIcon = icon;
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();

            this.Width = 540;
            this.Height = 255;
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
            lblSubTitle.Text = "First-Time Setup & Component Installation";
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
            lblStatus.Size = new Size(495, 22);
            lblStatus.AutoEllipsis = true;
            this.Controls.Add(lblStatus);

            // 3. Details Label
            lblDetails = new Label();
            lblDetails.Text = "Please wait while required components are downloaded...";
            lblDetails.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblDetails.ForeColor = Color.FromArgb(148, 163, 184);
            lblDetails.Location = new Point(23, 96);
            lblDetails.Size = new Size(495, 20);
            lblDetails.AutoEllipsis = true;
            this.Controls.Add(lblDetails);

            // 4. Step indicator (left above bar)
            lblStep = new Label();
            lblStep.Text = "Step 1 of 5: Initializing";
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
            lblPercent.Location = new Point(420, 118);
            lblPercent.Size = new Size(98, 24);
            this.Controls.Add(lblPercent);

            // 6. Modern Progress Bar
            progressBar = new ModernProgressBar();
            progressBar.Location = new Point(22, 148);
            progressBar.Size = new Size(495, 22);
            progressBar.Value = 0;
            progressBar.Maximum = 100;
            this.Controls.Add(progressBar);

            // 7. Footer note (left)
            lblNote = new Label();
            lblNote.Text = "⚡ Automatic setup runs only once on your first launch.";
            lblNote.Font = new Font("Segoe UI", 8f, FontStyle.Italic);
            lblNote.ForeColor = Color.FromArgb(100, 116, 139);
            lblNote.Location = new Point(22, 186);
            lblNote.Size = new Size(260, 20);
            this.Controls.Add(lblNote);

            // 8. Elapsed timer (right when normal)
            lblElapsed = new Label();
            lblElapsed.Text = "⏱ 00:00";
            lblElapsed.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblElapsed.ForeColor = Color.FromArgb(148, 163, 184);
            lblElapsed.TextAlign = ContentAlignment.MiddleRight;
            lblElapsed.Location = new Point(420, 184);
            lblElapsed.Size = new Size(98, 20);
            this.Controls.Add(lblElapsed);

            // 9. Retry button (shown on error)
            btnRetry = new Button();
            btnRetry.Text = "🔄 Retry Setup";
            btnRetry.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            btnRetry.ForeColor = Color.White;
            btnRetry.BackColor = Color.FromArgb(16, 185, 129); // Emerald-600
            btnRetry.FlatStyle = FlatStyle.Flat;
            btnRetry.FlatAppearance.BorderSize = 0;
            btnRetry.Size = new Size(110, 28);
            btnRetry.Location = new Point(this.Width - 235, 180);
            btnRetry.Cursor = Cursors.Hand;
            btnRetry.Visible = false;
            btnRetry.Click += (s, e) =>
            {
                btnRetry.Visible = false;
                btnViewLogs.Visible = false;
                lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
                lblPercent.ForeColor = Color.FromArgb(52, 211, 153);
                UpdateProgress(0, "Retrying setup...", "Restarting component downloads...", "Preparing...");
                if (currentWorkerAction != null)
                {
                    StartSetupTask(currentWorkerAction);
                }
            };
            this.Controls.Add(btnRetry);

            // 10. View logs button (shown on error)
            btnViewLogs = new Button();
            btnViewLogs.Text = "📋 View Logs";
            btnViewLogs.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            btnViewLogs.ForeColor = Color.FromArgb(203, 213, 225);
            btnViewLogs.BackColor = Color.FromArgb(51, 65, 85); // Slate-700
            btnViewLogs.FlatStyle = FlatStyle.Flat;
            btnViewLogs.FlatAppearance.BorderSize = 0;
            btnViewLogs.Size = new Size(95, 28);
            btnViewLogs.Location = new Point(this.Width - 118, 180);
            btnViewLogs.Cursor = Cursors.Hand;
            btnViewLogs.Visible = false;
            btnViewLogs.Click += (s, e) =>
            {
                try
                {
                    string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                    string logP = Path.Combine(baseDir, "data", "logs", "manager-launcher.log");
                    if (File.Exists(logP)) Process.Start("notepad.exe", logP);
                }
                catch { }
            };
            this.Controls.Add(btnViewLogs);

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
            this.currentWorkerAction = workerAction;
            this.startTime = DateTime.Now;
            if (this.elapsedTimer == null)
            {
                this.elapsedTimer = new System.Windows.Forms.Timer();
                this.elapsedTimer.Interval = 500;
                this.elapsedTimer.Tick += (s, e) =>
                {
                    TimeSpan span = DateTime.Now - startTime;
                    lblElapsed.Text = string.Format("⏱ {0:00}:{1:00}", (int)span.TotalMinutes, span.Seconds);
                };
            }
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
            lblStep.Text = "Setup could not complete automatically.";
            lblPercent.ForeColor = Color.FromArgb(239, 68, 68);
            if (btnRetry != null) btnRetry.Visible = true;
            if (btnViewLogs != null) btnViewLogs.Visible = true;
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

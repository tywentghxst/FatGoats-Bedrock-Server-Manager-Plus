using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace BedrockServerManager.Installer
{
    public class InstallerForm : Form
    {
        private Label lblTitle;
        private Label lblSubtitle;
        private Label lblFolderPrompt;
        private TextBox txtInstallDir;
        private Button btnBrowse;

        // Action Mode Radios
        private GroupBox grpActionMode;
        private RadioButton rbModeInstall;
        private RadioButton rbModeUninstall;

        // User Data Handling Options
        private GroupBox grpDataOptions;
        private RadioButton rbDataKeep;
        private RadioButton rbDataErase;

        // Shortcut & Launch Options
        private CheckBox chkDesktopShortcut;
        private CheckBox chkStartMenuShortcut;
        private CheckBox chkLaunchAfter;

        // Progress & Status Controls
        private ProgressBar progressBar;
        private Label lblStatus;
        private TextBox txtLog;
        private Button btnAction;
        private Button btnCancel;
        private Panel headerPanel;
        private Panel footerPanel;
        private BackgroundWorker worker;

        private const string REPO_ZIP_URL = "https://github.com/tywentghxst/FatGoats-Bedrock-Server-Manager-Plus/archive/refs/heads/main.zip";
        private const string NODE_ZIP_URL = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip";
        private const string REG_UNINSTALL_KEY = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\BedrockServerManagerPlus";

        private string initialMode = "install"; // "install" | "uninstall" | "reinstall"

        public InstallerForm(string[] args)
        {
            if (args != null && args.Length > 0)
            {
                foreach (string a in args)
                {
                    string lower = a.ToLower();
                    if (lower.Contains("uninstall")) initialMode = "uninstall";
                    else if (lower.Contains("reinstall")) initialMode = "reinstall";
                }
            }

            InitializeComponent();
            CheckExistingInstallation();
        }

        private void InitializeComponent()
        {
            this.Text = "Bedrock Server Manager Plus — Setup & Maintenance Wizard";
            this.Size = new Size(680, 680);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(15, 23, 42); // Slate 900
            this.ForeColor = Color.FromArgb(241, 245, 249); // Slate 100
            this.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            try
            {
                if (File.Exists("tray\\app.ico"))
                {
                    this.Icon = new Icon("tray\\app.ico");
                }
            }
            catch { }

            // Header Panel
            headerPanel = new Panel();
            headerPanel.Dock = DockStyle.Top;
            headerPanel.Height = 85;
            headerPanel.BackColor = Color.FromArgb(20, 29, 47);
            headerPanel.Paint += (s, e) =>
            {
                using (Pen pen = new Pen(Color.FromArgb(16, 185, 129), 2))
                {
                    e.Graphics.DrawLine(pen, 0, headerPanel.Height - 2, headerPanel.Width, headerPanel.Height - 2);
                }
            };

            lblTitle = new Label();
            lblTitle.Text = "Bedrock Server Manager Plus";
            lblTitle.Font = new Font("Segoe UI", 15F, FontStyle.Bold, GraphicsUnit.Point);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(20, 16);
            lblTitle.AutoSize = true;
            headerPanel.Controls.Add(lblTitle);

            lblSubtitle = new Label();
            lblSubtitle.Text = "Installer, Maintenance & Uninstallation Center";
            lblSubtitle.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            lblSubtitle.ForeColor = Color.FromArgb(148, 163, 184); // Slate 400
            lblSubtitle.Location = new Point(22, 48);
            lblSubtitle.AutoSize = true;
            headerPanel.Controls.Add(lblSubtitle);

            this.Controls.Add(headerPanel);

            // Installation Path selection
            lblFolderPrompt = new Label();
            lblFolderPrompt.Text = "Destination / Existing Installation Directory:";
            lblFolderPrompt.Location = new Point(22, 95);
            lblFolderPrompt.AutoSize = true;
            lblFolderPrompt.ForeColor = Color.FromArgb(226, 232, 240);
            this.Controls.Add(lblFolderPrompt);

            string defaultPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "BedrockServerManager");
            txtInstallDir = new TextBox();
            txtInstallDir.Text = defaultPath;
            txtInstallDir.Location = new Point(24, 116);
            txtInstallDir.Size = new Size(515, 25);
            txtInstallDir.BackColor = Color.FromArgb(30, 41, 59);
            txtInstallDir.ForeColor = Color.White;
            txtInstallDir.BorderStyle = BorderStyle.FixedSingle;
            txtInstallDir.TextChanged += (s, e) => CheckExistingInstallation();
            this.Controls.Add(txtInstallDir);

            btnBrowse = new Button();
            btnBrowse.Text = "Browse...";
            btnBrowse.Location = new Point(548, 115);
            btnBrowse.Size = new Size(95, 27);
            btnBrowse.BackColor = Color.FromArgb(51, 65, 85);
            btnBrowse.ForeColor = Color.White;
            btnBrowse.FlatStyle = FlatStyle.Flat;
            btnBrowse.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            btnBrowse.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.Description = "Select target folder for Bedrock Server Manager Plus:";
                    fbd.SelectedPath = txtInstallDir.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        txtInstallDir.Text = fbd.SelectedPath;
                    }
                }
            };
            this.Controls.Add(btnBrowse);

            // Group: Action Mode (Install/Reinstall vs Uninstall)
            grpActionMode = new GroupBox();
            grpActionMode.Text = " Operation Mode ";
            grpActionMode.Location = new Point(24, 150);
            grpActionMode.Size = new Size(618, 55);
            grpActionMode.ForeColor = Color.FromArgb(148, 163, 184);

            rbModeInstall = new RadioButton();
            rbModeInstall.Text = "🚀 Install / Reinstall Application";
            rbModeInstall.Location = new Point(18, 22);
            rbModeInstall.AutoSize = true;
            rbModeInstall.Checked = true;
            rbModeInstall.ForeColor = Color.White;
            rbModeInstall.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            rbModeInstall.CheckedChanged += OnModeChanged;
            grpActionMode.Controls.Add(rbModeInstall);

            rbModeUninstall = new RadioButton();
            rbModeUninstall.Text = "🗑️ Uninstall Application";
            rbModeUninstall.Location = new Point(280, 22);
            rbModeUninstall.AutoSize = true;
            rbModeUninstall.ForeColor = Color.White;
            rbModeUninstall.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            rbModeUninstall.CheckedChanged += OnModeChanged;
            grpActionMode.Controls.Add(rbModeUninstall);

            this.Controls.Add(grpActionMode);

            // Group: User Data Preservation Options
            grpDataOptions = new GroupBox();
            grpDataOptions.Text = " User Data & World Preservation ";
            grpDataOptions.Location = new Point(24, 212);
            grpDataOptions.Size = new Size(618, 85);
            grpDataOptions.ForeColor = Color.FromArgb(148, 163, 184);

            rbDataKeep = new RadioButton();
            rbDataKeep.Text = "🛡️ Keep all user data (Recommended) — Preserves worlds, database, backups, and configs";
            rbDataKeep.Location = new Point(18, 22);
            rbDataKeep.Size = new Size(580, 22);
            rbDataKeep.Checked = true;
            rbDataKeep.ForeColor = Color.FromArgb(52, 211, 153); // Emerald
            rbDataKeep.Font = new Font("Segoe UI", 8.8F, FontStyle.Bold);
            grpDataOptions.Controls.Add(rbDataKeep);

            rbDataErase = new RadioButton();
            rbDataErase.Text = "⚠️ Factory Reset / Erase all data — Completely wipe all worlds, database, and backups";
            rbDataErase.Location = new Point(18, 48);
            rbDataErase.Size = new Size(580, 22);
            rbDataErase.ForeColor = Color.FromArgb(248, 113, 113); // Red
            rbDataErase.Font = new Font("Segoe UI", 8.8F, FontStyle.Regular);
            grpDataOptions.Controls.Add(rbDataErase);

            this.Controls.Add(grpDataOptions);

            // Options: Shortcuts and Auto-Launch
            chkDesktopShortcut = new CheckBox();
            chkDesktopShortcut.Text = "Create Desktop Shortcut with custom Bedrock icon";
            chkDesktopShortcut.Location = new Point(24, 305);
            chkDesktopShortcut.AutoSize = true;
            chkDesktopShortcut.Checked = true;
            chkDesktopShortcut.ForeColor = Color.FromArgb(203, 213, 225);
            this.Controls.Add(chkDesktopShortcut);

            chkStartMenuShortcut = new CheckBox();
            chkStartMenuShortcut.Text = "Create Start Menu Program Shortcut";
            chkStartMenuShortcut.Location = new Point(24, 328);
            chkStartMenuShortcut.AutoSize = true;
            chkStartMenuShortcut.Checked = true;
            chkStartMenuShortcut.ForeColor = Color.FromArgb(203, 213, 225);
            this.Controls.Add(chkStartMenuShortcut);

            chkLaunchAfter = new CheckBox();
            chkLaunchAfter.Text = "Launch Bedrock Server Manager automatically upon completion";
            chkLaunchAfter.Location = new Point(24, 351);
            chkLaunchAfter.AutoSize = true;
            chkLaunchAfter.Checked = true;
            chkLaunchAfter.ForeColor = Color.FromArgb(203, 213, 225);
            this.Controls.Add(chkLaunchAfter);

            // Progress Bar
            progressBar = new ProgressBar();
            progressBar.Location = new Point(24, 380);
            progressBar.Size = new Size(618, 16);
            progressBar.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(progressBar);

            lblStatus = new Label();
            lblStatus.Text = "Ready to proceed. Choose your options and click below.";
            lblStatus.Location = new Point(24, 400);
            lblStatus.Size = new Size(618, 20);
            lblStatus.ForeColor = Color.FromArgb(52, 211, 153); // Emerald
            lblStatus.Font = new Font("Segoe UI", 8.5F, FontStyle.Bold);
            this.Controls.Add(lblStatus);

            // Output Log Box
            txtLog = new TextBox();
            txtLog.Location = new Point(24, 424);
            txtLog.Size = new Size(618, 140);
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.BackColor = Color.FromArgb(10, 15, 26);
            txtLog.ForeColor = Color.FromArgb(148, 163, 184);
            txtLog.Font = new Font("Consolas", 8F);
            txtLog.BorderStyle = BorderStyle.FixedSingle;
            this.Controls.Add(txtLog);

            // Footer Panel
            footerPanel = new Panel();
            footerPanel.Dock = DockStyle.Bottom;
            footerPanel.Height = 62;
            footerPanel.BackColor = Color.FromArgb(20, 29, 47);
            footerPanel.Paint += (s, e) =>
            {
                using (Pen pen = new Pen(Color.FromArgb(51, 65, 85), 1))
                {
                    e.Graphics.DrawLine(pen, 0, 0, footerPanel.Width, 0);
                }
            };

            btnCancel = new Button();
            btnCancel.Text = "Cancel";
            btnCancel.Location = new Point(415, 15);
            btnCancel.Size = new Size(100, 34);
            btnCancel.BackColor = Color.FromArgb(51, 65, 85);
            btnCancel.ForeColor = Color.White;
            btnCancel.FlatStyle = FlatStyle.Flat;
            btnCancel.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            btnCancel.Click += (s, e) => this.Close();
            footerPanel.Controls.Add(btnCancel);

            btnAction = new Button();
            btnAction.Text = "🚀 Install / Reinstall";
            btnAction.Location = new Point(525, 14);
            btnAction.Size = new Size(130, 36);
            btnAction.BackColor = Color.FromArgb(16, 185, 129); // Emerald 500
            btnAction.ForeColor = Color.FromArgb(15, 23, 42); // Slate 900
            btnAction.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            btnAction.FlatStyle = FlatStyle.Flat;
            btnAction.FlatAppearance.BorderSize = 0;
            btnAction.Click += BtnAction_Click;
            footerPanel.Controls.Add(btnAction);

            this.Controls.Add(footerPanel);

            // BackgroundWorker
            worker = new BackgroundWorker();
            worker.WorkerReportsProgress = true;
            worker.DoWork += Worker_DoWork;
            worker.ProgressChanged += Worker_ProgressChanged;
            worker.RunWorkerCompleted += Worker_RunWorkerCompleted;

            if (initialMode == "uninstall")
            {
                rbModeUninstall.Checked = true;
            }
        }

        private void CheckExistingInstallation()
        {
            string dir = txtInstallDir.Text.Trim();
            bool exists = Directory.Exists(dir) &&
                (File.Exists(Path.Combine(dir, "BedrockServerManager.exe")) || File.Exists(Path.Combine(dir, "server", "index.js")));

            if (exists)
            {
                rbModeInstall.Text = "🔄 Reinstall / Upgrade Application";
                lblSubtitle.Text = "Existing installation detected at destination directory.";
                lblSubtitle.ForeColor = Color.FromArgb(52, 211, 153);
            }
            else
            {
                rbModeInstall.Text = "🚀 Install Application";
                lblSubtitle.Text = "Universal Installer & Automated Dependency Engine";
                lblSubtitle.ForeColor = Color.FromArgb(148, 163, 184);
            }

            UpdateActionButton();
        }

        private void OnModeChanged(object sender, EventArgs e)
        {
            bool isUninstall = rbModeUninstall.Checked;

            chkDesktopShortcut.Visible = !isUninstall;
            chkStartMenuShortcut.Visible = !isUninstall;
            chkLaunchAfter.Visible = !isUninstall;

            if (isUninstall)
            {
                rbDataKeep.Text = "🛡️ Uninstall but keep my user data (Worlds, Database & Backups preserved)";
                rbDataErase.Text = "🗑️ Complete Uninstall (Permanently erase all files, worlds, database, backups)";
            }
            else
            {
                rbDataKeep.Text = "🛡️ Keep all user data (Recommended) — Preserves worlds, database, backups, and configs";
                rbDataErase.Text = "⚠️ Factory Reset / Clean Reinstall — Completely wipe all existing data and start fresh";
            }

            UpdateActionButton();
        }

        private void UpdateActionButton()
        {
            if (rbModeUninstall.Checked)
            {
                btnAction.Text = "🗑️ Uninstall Now";
                btnAction.BackColor = Color.FromArgb(239, 68, 68); // Red
                btnAction.ForeColor = Color.White;
            }
            else
            {
                bool isReinstall = rbModeInstall.Text.Contains("Reinstall");
                btnAction.Text = isReinstall ? "🔄 Reinstall Now" : "🚀 Install Now";
                btnAction.BackColor = Color.FromArgb(16, 185, 129); // Emerald
                btnAction.ForeColor = Color.FromArgb(15, 23, 42);
            }
        }

        private void Log(string message)
        {
            if (this.InvokeRequired)
            {
                this.Invoke(new Action<string>(Log), message);
                return;
            }
            txtLog.AppendText(string.Format("[{0:HH:mm:ss}] {1}\r\n", DateTime.Now, message));
        }

        private void BtnAction_Click(object sender, EventArgs e)
        {
            string targetDir = txtInstallDir.Text.Trim();
            if (string.IsNullOrEmpty(targetDir))
            {
                MessageBox.Show("Please choose a valid directory.", "Invalid Path", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            bool isUninstall = rbModeUninstall.Checked;
            bool keepData = rbDataKeep.Checked;

            if (isUninstall)
            {
                string warnMsg = keepData
                    ? "Are you sure you want to uninstall Bedrock Server Manager Plus?\n\nYour worlds, database records, and backups will remain preserved."
                    : "⚠️ WARNING: You have selected to PERMANENTLY ERASE ALL USER DATA.\n\nAll worlds, player data, backups, and database records will be DELETED!\n\nAre you sure you want to continue?";

                DialogResult dr = MessageBox.Show(warnMsg, "Confirm Uninstallation", MessageBoxButtons.YesNo, keepData ? MessageBoxIcon.Question : MessageBoxIcon.Warning);
                if (dr != DialogResult.Yes) return;
            }
            else if (!keepData)
            {
                DialogResult dr = MessageBox.Show(
                    "⚠️ FACTORY RESET WARNING:\n\nYou chose to reinstall without preserving user data. All existing worlds, database, and backups in this folder will be deleted.\n\nAre you sure you want to proceed with a clean reset?",
                    "Confirm Clean Reinstall", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (dr != DialogResult.Yes) return;
            }

            btnAction.Enabled = false;
            btnBrowse.Enabled = false;
            txtInstallDir.ReadOnly = true;
            grpActionMode.Enabled = false;
            grpDataOptions.Enabled = false;
            chkDesktopShortcut.Enabled = false;
            chkStartMenuShortcut.Enabled = false;
            chkLaunchAfter.Enabled = false;

            worker.RunWorkerAsync(new OperationOptions
            {
                TargetDirectory = targetDir,
                IsUninstall = isUninstall,
                KeepUserData = keepData,
                CreateDesktopShortcut = chkDesktopShortcut.Checked,
                CreateStartMenuShortcut = chkStartMenuShortcut.Checked,
                LaunchAfter = chkLaunchAfter.Checked
            });
        }

        private void Worker_ProgressChanged(object sender, ProgressChangedEventArgs e)
        {
            progressBar.Value = Math.Min(100, Math.Max(0, e.ProgressPercentage));
            if (e.UserState != null)
            {
                string msg = e.UserState.ToString();
                lblStatus.Text = msg;
                Log(msg);
            }
        }

        private class NodeInfo
        {
            public string NodeExe;
            public string NpmCmd;
            public string NodeDir;
        }

        private void StopRunningProcesses(string targetDir)
        {
            try
            {
                Process[] procs = Process.GetProcesses();
                foreach (Process p in procs)
                {
                    try
                    {
                        string name = p.ProcessName.ToLower();
                        if (name.Contains("bedrockservermanager") || name.Contains("bedrock_server"))
                        {
                            p.Kill();
                            p.WaitForExit(2000);
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        private NodeInfo ResolveOrInstallNode(string targetDir)
        {
            worker.ReportProgress(4, "Scanning system for Node.js runtime...");

            string[] candidateDirs = new string[]
            {
                Path.Combine(targetDir, "nodejs"),
                @"C:\Program Files\nodejs",
                @"C:\Program Files (x86)\nodejs",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm")
            };

            foreach (string dir in candidateDirs)
            {
                string nodePath = Path.Combine(dir, "node.exe");
                if (File.Exists(nodePath))
                {
                    string ver = RunCommandAndGetOutput(nodePath, "-v");
                    if (!string.IsNullOrEmpty(ver))
                    {
                        string npmPath = Path.Combine(dir, "npm.cmd");
                        if (!File.Exists(npmPath)) npmPath = Path.Combine(dir, "npm");
                        worker.ReportProgress(8, string.Format("Found Node.js {0} at {1}", ver.Trim(), dir));
                        return new NodeInfo
                        {
                            NodeExe = nodePath,
                            NpmCmd = npmPath,
                            NodeDir = dir
                        };
                    }
                }
            }

            string pathNodeVer = RunCommandAndGetOutput("node", "-v");
            if (!string.IsNullOrEmpty(pathNodeVer))
            {
                worker.ReportProgress(8, string.Format("Found Node.js {0} in system PATH.", pathNodeVer.Trim()));
                return new NodeInfo
                {
                    NodeExe = "node",
                    NpmCmd = "npm.cmd",
                    NodeDir = ""
                };
            }

            worker.ReportProgress(10, "Node.js was not detected. Automatically downloading official Node.js LTS runtime...");
            string tempNodeZip = Path.Combine(Path.GetTempPath(), string.Format("node-lts-{0}.zip", Environment.TickCount));
            string tempNodeExtract = Path.Combine(Path.GetTempPath(), string.Format("node-extract-{0}", Environment.TickCount));

            try
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                using (WebClient client = new WebClient())
                {
                    client.Headers.Add("User-Agent", "BedrockServerManager-Setup");
                    client.DownloadFile(NODE_ZIP_URL, tempNodeZip);
                }

                worker.ReportProgress(16, "Extracting bundled Node.js runtime...");
                if (Directory.Exists(tempNodeExtract)) Directory.Delete(tempNodeExtract, true);
                Directory.CreateDirectory(tempNodeExtract);
                ZipFile.ExtractToDirectory(tempNodeZip, tempNodeExtract);

                string[] subDirs = Directory.GetDirectories(tempNodeExtract);
                string sourceNodeDir = subDirs.Length > 0 ? subDirs[0] : tempNodeExtract;
                string destNodeDir = Path.Combine(targetDir, "nodejs");

                CopyDirectoryRecursive(sourceNodeDir, destNodeDir);

                worker.ReportProgress(20, "Bundled Node.js LTS configured at " + destNodeDir);

                return new NodeInfo
                {
                    NodeExe = Path.Combine(destNodeDir, "node.exe"),
                    NpmCmd = Path.Combine(destNodeDir, "npm.cmd"),
                    NodeDir = destNodeDir
                };
            }
            finally
            {
                try { File.Delete(tempNodeZip); } catch { }
                try { Directory.Delete(tempNodeExtract, true); } catch { }
            }
        }

        private void RegisterInWindowsUninstall(string targetDir)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(REG_UNINSTALL_KEY))
                {
                    if (key != null)
                    {
                        string exePath = Path.Combine(targetDir, "BedrockServerManager.exe");
                        string setupExe = Path.Combine(targetDir, "BedrockServerManager-Setup.exe");
                        string iconPath = Path.Combine(targetDir, "tray", "app.ico");

                        key.SetValue("DisplayName", "Bedrock Server Manager Plus");
                        key.SetValue("DisplayVersion", "1.1.0");
                        key.SetValue("Publisher", "FatGoats");
                        key.SetValue("InstallLocation", targetDir);
                        key.SetValue("DisplayIcon", File.Exists(iconPath) ? iconPath : exePath);
                        key.SetValue("UninstallString", string.Format("\"{0}\" /uninstall", File.Exists(setupExe) ? setupExe : exePath));
                        key.SetValue("NoModify", 1);
                        key.SetValue("NoRepair", 1);
                    }
                }
            }
            catch (Exception ex)
            {
                Log(string.Format("Notice registering uninstall entry: {0}", ex.Message));
            }
        }

        private void UnregisterInWindowsUninstall()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(REG_UNINSTALL_KEY, false);
            }
            catch { }
        }

        private void Worker_DoWork(object sender, DoWorkEventArgs e)
        {
            OperationOptions opts = (OperationOptions)e.Argument;
            string targetDir = opts.TargetDirectory;

            try
            {
                // Stop any running manager or BDS server processes first
                worker.ReportProgress(5, "Terminating active server and tray processes if running...");
                StopRunningProcesses(targetDir);

                if (opts.IsUninstall)
                {
                    // UNINSTALL WORKFLOW
                    worker.ReportProgress(15, "Removing application shortcuts...");
                    string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Bedrock Server Manager Plus.lnk");
                    string startLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Bedrock Server Manager Plus.lnk");
                    try { if (File.Exists(desktopLnk)) File.Delete(desktopLnk); } catch { }
                    try { if (File.Exists(startLnk)) File.Delete(startLnk); } catch { }

                    worker.ReportProgress(30, "Removing Windows uninstaller registry entries...");
                    UnregisterInWindowsUninstall();

                    if (!opts.KeepUserData)
                    {
                        // Clean full wipe
                        worker.ReportProgress(50, "Completely wiping application folder and all user data...");
                        if (Directory.Exists(targetDir))
                        {
                            Directory.Delete(targetDir, true);
                        }
                        worker.ReportProgress(100, "Clean uninstall completed! All application files and data erased.");
                    }
                    else
                    {
                        // Preserve worlds, database, backups
                        worker.ReportProgress(50, "Preserving worlds, database records, and backups...");
                        string tempBackup = Path.Combine(Path.GetTempPath(), string.Format("bedrock-saved-data-{0}", Environment.TickCount));
                        Directory.CreateDirectory(tempBackup);

                        string dbDir = Path.Combine(targetDir, "data", "db");
                        string backupsDir = Path.Combine(targetDir, "data", "backups");
                        string worldsDir = Path.Combine(targetDir, "bds", "worlds");
                        string propsFile = Path.Combine(targetDir, "bds", "server.properties");

                        if (Directory.Exists(dbDir)) CopyDirectoryRecursive(dbDir, Path.Combine(tempBackup, "data", "db"));
                        if (Directory.Exists(backupsDir)) CopyDirectoryRecursive(backupsDir, Path.Combine(tempBackup, "data", "backups"));
                        if (Directory.Exists(worldsDir)) CopyDirectoryRecursive(worldsDir, Path.Combine(tempBackup, "bds", "worlds"));
                        if (File.Exists(propsFile))
                        {
                            Directory.CreateDirectory(Path.Combine(tempBackup, "bds"));
                            File.Copy(propsFile, Path.Combine(tempBackup, "bds", "server.properties"), true);
                        }

                        worker.ReportProgress(70, "Removing application engine and binary files...");
                        if (Directory.Exists(targetDir))
                        {
                            try { Directory.Delete(targetDir, true); } catch { }
                        }
                        Directory.CreateDirectory(targetDir);

                        worker.ReportProgress(85, "Restoring preserved user data to folder...");
                        CopyDirectoryRecursive(tempBackup, targetDir);
                        try { Directory.Delete(tempBackup, true); } catch { }

                        worker.ReportProgress(100, "Uninstall complete! Your worlds, database, and backups were safely preserved.");
                    }

                    e.Result = opts;
                    return;
                }

                // INSTALL / REINSTALL WORKFLOW
                string tempUserDataBackup = null;

                if (opts.KeepUserData && Directory.Exists(targetDir))
                {
                    worker.ReportProgress(10, "Creating safety snapshot of existing user data (worlds & database)...");
                    tempUserDataBackup = Path.Combine(Path.GetTempPath(), string.Format("bedrock-install-backup-{0}", Environment.TickCount));
                    Directory.CreateDirectory(tempUserDataBackup);

                    string dbDir = Path.Combine(targetDir, "data", "db");
                    string backupsDir = Path.Combine(targetDir, "data", "backups");
                    string worldsDir = Path.Combine(targetDir, "bds", "worlds");
                    string propsFile = Path.Combine(targetDir, "bds", "server.properties");

                    if (Directory.Exists(dbDir)) CopyDirectoryRecursive(dbDir, Path.Combine(tempUserDataBackup, "data", "db"));
                    if (Directory.Exists(backupsDir)) CopyDirectoryRecursive(backupsDir, Path.Combine(tempUserDataBackup, "data", "backups"));
                    if (Directory.Exists(worldsDir)) CopyDirectoryRecursive(worldsDir, Path.Combine(tempUserDataBackup, "bds", "worlds"));
                    if (File.Exists(propsFile))
                    {
                        Directory.CreateDirectory(Path.Combine(tempUserDataBackup, "bds"));
                        File.Copy(propsFile, Path.Combine(tempUserDataBackup, "bds", "server.properties"), true);
                    }
                }
                else if (!opts.KeepUserData && Directory.Exists(targetDir))
                {
                    worker.ReportProgress(10, "Factory reset requested: Cleaning existing directory...");
                    try { Directory.Delete(targetDir, true); } catch { }
                }

                if (!Directory.Exists(targetDir))
                {
                    Directory.CreateDirectory(targetDir);
                }

                // 2. Resolve or Install Node.js runtime
                NodeInfo node = ResolveOrInstallNode(targetDir);

                // 3. Download repository package from GitHub
                string tempZip = Path.Combine(Path.GetTempPath(), string.Format("bedrock-mgr-setup-{0}.zip", Environment.TickCount));
                worker.ReportProgress(25, "Downloading latest repository package from GitHub...");

                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                using (WebClient client = new WebClient())
                {
                    client.Headers.Add("User-Agent", "BedrockServerManager-Setup");
                    client.DownloadFile(REPO_ZIP_URL, tempZip);
                }

                worker.ReportProgress(45, "Extracting repository files...");
                string tempExtract = Path.Combine(Path.GetTempPath(), string.Format("bedrock-mgr-extract-{0}", Environment.TickCount));
                if (Directory.Exists(tempExtract)) Directory.Delete(tempExtract, true);
                Directory.CreateDirectory(tempExtract);

                ZipFile.ExtractToDirectory(tempZip, tempExtract);

                string[] innerDirs = Directory.GetDirectories(tempExtract);
                string sourceRoot = innerDirs.Length > 0 ? innerDirs[0] : tempExtract;

                CopyDirectoryRecursive(sourceRoot, targetDir);

                try { File.Delete(tempZip); } catch { }
                try { Directory.Delete(tempExtract, true); } catch { }

                // Restore preserved user data if reinstalling with data keep
                if (tempUserDataBackup != null && Directory.Exists(tempUserDataBackup))
                {
                    worker.ReportProgress(55, "Restoring preserved worlds, database, and configurations...");
                    CopyDirectoryRecursive(tempUserDataBackup, targetDir);
                    try { Directory.Delete(tempUserDataBackup, true); } catch { }
                }

                // 4. Install NPM Dependencies
                worker.ReportProgress(65, "Installing core application dependencies (npm install)...");
                string npmCmd = node.NpmCmd;
                if (!File.Exists(npmCmd) && !string.IsNullOrEmpty(node.NodeDir))
                {
                    string candidate = Path.Combine(node.NodeDir, "npm.cmd");
                    if (File.Exists(candidate)) npmCmd = candidate;
                }

                ExecuteProcessWithEnv("cmd.exe", string.Format("/c \"\"{0}\" install --omit=dev --no-audit --no-fund\"", npmCmd), targetDir, node.NodeDir);

                // 5. Verify/Build Client Frontend Assets
                string clientDir = Path.Combine(targetDir, "client");
                string distDir = Path.Combine(clientDir, "dist");
                if (File.Exists(Path.Combine(distDir, "index.html")))
                {
                    worker.ReportProgress(82, "Verified pre-built production client assets.");
                }
                else if (Directory.Exists(clientDir))
                {
                    worker.ReportProgress(80, "Compiling client frontend assets (vite build)...");
                    ExecuteProcessWithEnv("cmd.exe", string.Format("/c \"\"{0}\" install && \"{0}\" run build\"", npmCmd), clientDir, node.NodeDir);
                }

                // 6. Build or deploy Windows Tray Launcher
                worker.ReportProgress(90, "Configuring BedrockServerManager.exe Windows tray launcher...");
                string csc = @"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe";
                string trayDir = Path.Combine(targetDir, "tray");
                string trayProgram = Path.Combine(trayDir, "Program.cs");
                string targetExe = Path.Combine(targetDir, "BedrockServerManager.exe");

                if (File.Exists(csc) && File.Exists(trayProgram))
                {
                    string iconArg = File.Exists(Path.Combine(trayDir, "app.ico"))
                        ? string.Format("/win32icon:\"{0}\"", Path.Combine(trayDir, "app.ico"))
                        : "";

                    string compileArgs = string.Format("/target:winexe /out:\"{0}\" {1} /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Core.dll \"{2}\"",
                        targetExe, iconArg, trayProgram);

                    ExecuteProcessWithEnv(csc, compileArgs, targetDir, node.NodeDir);
                }

                // Also copy setup wizard into targetDir as BedrockServerManager-Setup.exe for Add/Remove programs uninstaller
                try
                {
                    string currentExe = Application.ExecutablePath;
                    string destSetup = Path.Combine(targetDir, "BedrockServerManager-Setup.exe");
                    if (!string.Equals(currentExe, destSetup, StringComparison.OrdinalIgnoreCase))
                    {
                        File.Copy(currentExe, destSetup, true);
                    }
                }
                catch { }

                // 7. Register in Windows Add / Remove Programs
                worker.ReportProgress(93, "Registering in Windows Installed Apps...");
                RegisterInWindowsUninstall(targetDir);

                // 8. Create Shortcuts
                worker.ReportProgress(95, "Generating Windows shortcuts...");
                string iconPath = Path.Combine(trayDir, "app.ico");
                if (!File.Exists(iconPath)) iconPath = targetExe;

                if (opts.CreateDesktopShortcut && File.Exists(targetExe))
                {
                    string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Bedrock Server Manager Plus.lnk");
                    CreateShortcut(desktopLnk, targetExe, targetDir, iconPath, "Bedrock Server Manager Plus Launcher");
                    worker.ReportProgress(97, "Created Desktop shortcut.");
                }

                if (opts.CreateStartMenuShortcut && File.Exists(targetExe))
                {
                    string startMenuPrograms = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                    string startLnk = Path.Combine(startMenuPrograms, "Bedrock Server Manager Plus.lnk");
                    CreateShortcut(startLnk, targetExe, targetDir, iconPath, "Bedrock Server Manager Plus");
                    worker.ReportProgress(98, "Created Start Menu shortcut.");
                }

                worker.ReportProgress(100, "Operation completed successfully!");
                e.Result = opts;
            }
            catch (Exception ex)
            {
                worker.ReportProgress(0, string.Format("OPERATION ERROR: {0}", ex.Message));
                throw;
            }
        }

        private void Worker_RunWorkerCompleted(object sender, RunWorkerCompletedEventArgs e)
        {
            if (e.Error != null)
            {
                lblStatus.Text = "Operation failed. See log for details.";
                lblStatus.ForeColor = Color.FromArgb(239, 68, 68); // Red
                btnAction.Text = "Retry";
                btnAction.Enabled = true;
                btnCancel.Text = "Close";
                MessageBox.Show(string.Format("Setup encountered an error:\n\n{0}", e.Error.Message), "Operation Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            OperationOptions opts = (OperationOptions)e.Result;
            lblStatus.Text = "✓ Operation Completed Successfully!";
            lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
            btnAction.Text = "✓ Finished";
            btnCancel.Text = "Close";

            if (opts.IsUninstall)
            {
                string msg = opts.KeepUserData
                    ? "Bedrock Server Manager Plus was uninstalled.\n\nYour worlds, database records, and backups have been preserved in:\n" + opts.TargetDirectory
                    : "Bedrock Server Manager Plus has been completely uninstalled and all data has been erased.";

                MessageBox.Show(msg, "Uninstallation Complete", MessageBoxButtons.OK, MessageBoxIcon.Information);
                this.Close();
                return;
            }

            if (opts.LaunchAfter)
            {
                string targetExe = Path.Combine(opts.TargetDirectory, "BedrockServerManager.exe");
                if (File.Exists(targetExe))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = targetExe,
                            WorkingDirectory = opts.TargetDirectory,
                            UseShellExecute = true
                        });
                    }
                    catch { }
                }
            }

            MessageBox.Show("Bedrock Server Manager Plus has been successfully configured!\n\nThe tray launcher is now running in your Windows system tray overflow area, and your web browser will open to the dashboard.",
                "Setup Complete", MessageBoxButtons.OK, MessageBoxIcon.Information);

            this.Close();
        }

        private void ExecuteProcessWithEnv(string exe, string args, string workingDir, string prependPath)
        {
            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                WorkingDirectory = workingDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            if (!string.IsNullOrEmpty(prependPath))
            {
                string currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
                psi.EnvironmentVariables["PATH"] = prependPath + ";" + currentPath;
            }

            using (Process p = Process.Start(psi))
            {
                p.OutputDataReceived += (s, ev) => { if (!string.IsNullOrEmpty(ev.Data)) Log(ev.Data); };
                p.ErrorDataReceived += (s, ev) => { if (!string.IsNullOrEmpty(ev.Data)) Log(ev.Data); };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit(300000); // 5 minutes timeout
            }
        }

        private string RunCommandAndGetOutput(string exe, string args)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = exe,
                    Arguments = args,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(5000);
                    return output;
                }
            }
            catch
            {
                return null;
            }
        }

        private void CopyDirectoryRecursive(string sourceDir, string targetDir)
        {
            if (!Directory.Exists(targetDir)) Directory.CreateDirectory(targetDir);

            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string destFile = Path.Combine(targetDir, Path.GetFileName(file));
                File.Copy(file, destFile, true);
            }

            foreach (string dir in Directory.GetDirectories(sourceDir))
            {
                string dirName = Path.GetFileName(dir);
                if (dirName.Equals(".git", StringComparison.OrdinalIgnoreCase)) continue;
                string destDir = Path.Combine(targetDir, dirName);
                CopyDirectoryRecursive(dir, destDir);
            }
        }

        private void CreateShortcut(string shortcutPath, string targetExePath, string workingDir, string iconPath, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetExePath;
                shortcut.WorkingDirectory = workingDir;
                if (File.Exists(iconPath))
                {
                    shortcut.IconLocation = string.Format("{0},0", iconPath);
                }
                shortcut.Description = description;
                shortcut.Save();
            }
            catch (Exception ex)
            {
                Log(string.Format("Notice creating shortcut: {0}", ex.Message));
            }
        }

        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm(args));
        }
    }

    public class OperationOptions
    {
        public string TargetDirectory;
        public bool IsUninstall;
        public bool KeepUserData;
        public bool CreateDesktopShortcut;
        public bool CreateStartMenuShortcut;
        public bool LaunchAfter;
    }
}

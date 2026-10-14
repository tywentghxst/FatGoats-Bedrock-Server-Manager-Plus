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

namespace BedrockServerManager.Installer
{
    public class InstallerForm : Form
    {
        private Label lblTitle;
        private Label lblSubtitle;
        private Label lblFolderPrompt;
        private TextBox txtInstallDir;
        private Button btnBrowse;
        private CheckBox chkDesktopShortcut;
        private CheckBox chkStartMenuShortcut;
        private CheckBox chkLaunchAfter;
        private ProgressBar progressBar;
        private Label lblStatus;
        private TextBox txtLog;
        private Button btnInstall;
        private Button btnCancel;
        private Panel headerPanel;
        private Panel footerPanel;
        private BackgroundWorker worker;

        private const string REPO_ZIP_URL = "https://github.com/tywentghxst/FatGoats-Bedrock-Server-Manager-Plus/archive/refs/heads/main.zip";

        public InstallerForm()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "Bedrock Server Manager Plus — Setup Wizard";
            this.Size = new Size(620, 560);
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
            lblSubtitle.Text = "Universal Installer & Dependency Setup Engine";
            lblSubtitle.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            lblSubtitle.ForeColor = Color.FromArgb(148, 163, 184); // Slate 400
            lblSubtitle.Location = new Point(22, 48);
            lblSubtitle.AutoSize = true;
            headerPanel.Controls.Add(lblSubtitle);

            this.Controls.Add(headerPanel);

            // Installation Path selection
            lblFolderPrompt = new Label();
            lblFolderPrompt.Text = "Select Destination Installation Directory:";
            lblFolderPrompt.Location = new Point(22, 100);
            lblFolderPrompt.AutoSize = true;
            lblFolderPrompt.ForeColor = Color.FromArgb(226, 232, 240);
            this.Controls.Add(lblFolderPrompt);

            string defaultPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "BedrockServerManager");
            txtInstallDir = new TextBox();
            txtInstallDir.Text = defaultPath;
            txtInstallDir.Location = new Point(24, 124);
            txtInstallDir.Size = new Size(465, 25);
            txtInstallDir.BackColor = Color.FromArgb(30, 41, 59);
            txtInstallDir.ForeColor = Color.White;
            txtInstallDir.BorderStyle = BorderStyle.FixedSingle;
            this.Controls.Add(txtInstallDir);

            btnBrowse = new Button();
            btnBrowse.Text = "Browse...";
            btnBrowse.Location = new Point(500, 122);
            btnBrowse.Size = new Size(88, 27);
            btnBrowse.BackColor = Color.FromArgb(51, 65, 85);
            btnBrowse.ForeColor = Color.White;
            btnBrowse.FlatStyle = FlatStyle.Flat;
            btnBrowse.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            btnBrowse.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.Description = "Select target folder to install Bedrock Server Manager Plus:";
                    fbd.SelectedPath = txtInstallDir.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        txtInstallDir.Text = fbd.SelectedPath;
                    }
                }
            };
            this.Controls.Add(btnBrowse);

            // Shortcuts Options
            chkDesktopShortcut = new CheckBox();
            chkDesktopShortcut.Text = "Create Desktop Shortcut with custom Bedrock icon";
            chkDesktopShortcut.Location = new Point(24, 162);
            chkDesktopShortcut.AutoSize = true;
            chkDesktopShortcut.Checked = true;
            chkDesktopShortcut.ForeColor = Color.FromArgb(203, 213, 225);
            this.Controls.Add(chkDesktopShortcut);

            chkStartMenuShortcut = new CheckBox();
            chkStartMenuShortcut.Text = "Create Start Menu Program Shortcut";
            chkStartMenuShortcut.Location = new Point(24, 188);
            chkStartMenuShortcut.AutoSize = true;
            chkStartMenuShortcut.Checked = true;
            chkStartMenuShortcut.ForeColor = Color.FromArgb(203, 213, 225);
            this.Controls.Add(chkStartMenuShortcut);

            chkLaunchAfter = new CheckBox();
            chkLaunchAfter.Text = "Launch Bedrock Server Manager automatically upon completion";
            chkLaunchAfter.Location = new Point(24, 214);
            chkLaunchAfter.AutoSize = true;
            chkLaunchAfter.Checked = true;
            chkLaunchAfter.ForeColor = Color.FromArgb(203, 213, 225);
            this.Controls.Add(chkLaunchAfter);

            // Progress Bar
            progressBar = new ProgressBar();
            progressBar.Location = new Point(24, 250);
            progressBar.Size = new Size(564, 16);
            progressBar.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(progressBar);

            lblStatus = new Label();
            lblStatus.Text = "Ready to begin setup. Click 'Install Now' below.";
            lblStatus.Location = new Point(24, 272);
            lblStatus.Size = new Size(564, 20);
            lblStatus.ForeColor = Color.FromArgb(52, 211, 153); // Emerald
            lblStatus.Font = new Font("Segoe UI", 8.5F, FontStyle.Bold);
            this.Controls.Add(lblStatus);

            // Output Log Box
            txtLog = new TextBox();
            txtLog.Location = new Point(24, 298);
            txtLog.Size = new Size(564, 140);
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
            footerPanel.Height = 60;
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
            btnCancel.Location = new Point(390, 15);
            btnCancel.Size = new Size(95, 32);
            btnCancel.BackColor = Color.FromArgb(51, 65, 85);
            btnCancel.ForeColor = Color.White;
            btnCancel.FlatStyle = FlatStyle.Flat;
            btnCancel.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            btnCancel.Click += (s, e) => this.Close();
            footerPanel.Controls.Add(btnCancel);

            btnInstall = new Button();
            btnInstall.Text = "🚀 Install Now";
            btnInstall.Location = new Point(495, 14);
            btnInstall.Size = new Size(110, 34);
            btnInstall.BackColor = Color.FromArgb(16, 185, 129); // Emerald 500
            btnInstall.ForeColor = Color.FromArgb(15, 23, 42); // Slate 900
            btnInstall.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Click += BtnInstall_Click;
            footerPanel.Controls.Add(btnInstall);

            this.Controls.Add(footerPanel);

            // BackgroundWorker
            worker = new BackgroundWorker();
            worker.WorkerReportsProgress = true;
            worker.DoWork += Worker_DoWork;
            worker.ProgressChanged += Worker_ProgressChanged;
            worker.RunWorkerCompleted += Worker_RunWorkerCompleted;
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

        private void UpdateStatus(string message, int progress)
        {
            if (this.InvokeRequired)
            {
                this.Invoke(new Action<string, int>(UpdateStatus), message, progress);
                return;
            }
            lblStatus.Text = message;
            if (progress >= 0 && progress <= 100)
            {
                progressBar.Value = progress;
            }
        }

        private void BtnInstall_Click(object sender, EventArgs e)
        {
            string targetDir = txtInstallDir.Text.Trim();
            if (string.IsNullOrEmpty(targetDir))
            {
                MessageBox.Show("Please choose a valid destination directory.", "Invalid Path", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            btnInstall.Enabled = false;
            btnBrowse.Enabled = false;
            txtInstallDir.ReadOnly = true;
            chkDesktopShortcut.Enabled = false;
            chkStartMenuShortcut.Enabled = false;
            chkLaunchAfter.Enabled = false;

            worker.RunWorkerAsync(new InstallOptions
            {
                TargetDirectory = targetDir,
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

        private void Worker_DoWork(object sender, DoWorkEventArgs e)
        {
            InstallOptions opts = (InstallOptions)e.Argument;
            string targetDir = opts.TargetDirectory;

            try
            {
                // 1. Verify Prerequisites
                worker.ReportProgress(5, "Verifying Node.js and system dependencies...");
                string nodeVersion = RunCommandAndGetOutput("node", "-v");
                if (string.IsNullOrEmpty(nodeVersion))
                {
                    worker.ReportProgress(8, "WARNING: Node.js was not detected in system PATH.");
                    worker.ReportProgress(8, "Node.js (v18+) is recommended. Please install Node.js from https://nodejs.org/");
                }
                else
                {
                    worker.ReportProgress(10, string.Format("Detected Node.js version: {0}", nodeVersion.Trim()));
                }

                // 2. Prepare Directory
                worker.ReportProgress(15, string.Format("Creating destination directory: {0}", targetDir));
                if (!Directory.Exists(targetDir))
                {
                    Directory.CreateDirectory(targetDir);
                }

                // 3. Download from GitHub
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

                // Move inner files to target directory
                string[] innerDirs = Directory.GetDirectories(tempExtract);
                string sourceRoot = innerDirs.Length > 0 ? innerDirs[0] : tempExtract;

                CopyDirectoryRecursive(sourceRoot, targetDir);

                try { File.Delete(tempZip); } catch { }
                try { Directory.Delete(tempExtract, true); } catch { }

                // 4. Install NPM Dependencies
                worker.ReportProgress(65, "Installing core application dependencies (npm install)...");
                ExecuteProcess("cmd.exe", "/c npm install --omit=dev", targetDir);

                // 5. Build Client Assets (if client folder exists)
                string clientDir = Path.Combine(targetDir, "client");
                string distDir = Path.Combine(clientDir, "dist");
                if (Directory.Exists(clientDir) && !Directory.Exists(distDir))
                {
                    worker.ReportProgress(80, "Compiling client frontend assets (npm run build)...");
                    ExecuteProcess("cmd.exe", "/c npm install && npm run build", clientDir);
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

                    ExecuteProcess(csc, compileArgs, targetDir);
                }

                // 7. Create Shortcuts
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

                worker.ReportProgress(100, "Installation completed successfully!");
                e.Result = opts;
            }
            catch (Exception ex)
            {
                worker.ReportProgress(0, string.Format("INSTALLATION ERROR: {0}", ex.Message));
                throw;
            }
        }

        private void Worker_RunWorkerCompleted(object sender, RunWorkerCompletedEventArgs e)
        {
            if (e.Error != null)
            {
                lblStatus.Text = "Installation failed. See log for details.";
                lblStatus.ForeColor = Color.FromArgb(239, 68, 68); // Red
                btnInstall.Text = "Retry";
                btnInstall.Enabled = true;
                btnCancel.Text = "Close";
                MessageBox.Show(string.Format("Setup encountered an error:\n\n{0}", e.Error.Message), "Installation Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            InstallOptions opts = (InstallOptions)e.Result;
            lblStatus.Text = "✓ Installation Completed Successfully!";
            lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
            btnInstall.Text = "✓ Finished";
            btnCancel.Text = "Close";

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

            MessageBox.Show("Bedrock Server Manager Plus has been successfully installed on your computer!\n\nThe tray launcher is now running and will sit in your Windows system tray overflow area.",
                "Installation Complete", MessageBoxButtons.OK, MessageBoxIcon.Information);

            this.Close();
        }

        private void ExecuteProcess(string exe, string args, string workingDir)
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

            using (Process p = Process.Start(psi))
            {
                p.OutputDataReceived += (s, ev) => { if (!string.IsNullOrEmpty(ev.Data)) Log(ev.Data); };
                p.ErrorDataReceived += (s, ev) => { if (!string.IsNullOrEmpty(ev.Data)) Log(ev.Data); };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                p.WaitForExit(180000); // 3 minutes timeout
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
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }

    public class InstallOptions
    {
        public string TargetDirectory;
        public bool CreateDesktopShortcut;
        public bool CreateStartMenuShortcut;
        public bool LaunchAfter;
    }
}

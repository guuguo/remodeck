using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("RemoteDeck")]
[assembly: AssemblyProduct("RemoteDeck")]
[assembly: AssemblyDescription("RemoteDeck Desktop Console Launcher")]

namespace RemoteDeckLauncher
{
  internal static class NativeMethods
  {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    internal static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
  }

  internal sealed class LauncherConfig
  {
    public string Url;
    public string HealthUrl;
    public string Port;
    public string RepoRoot;
    public string BrowserPath;
    public string ProfileDir;
    public string NodePath;
  }

  internal sealed class SplashForm : Form
  {
    private readonly LauncherConfig _config;
    private readonly bool _initialRestart;
    private readonly Label _statusLabel;
    private readonly FlowLayoutPanel _actionsPanel;
    private readonly Button _retryButton;
    private readonly Button _restartButton;
    private readonly Button _browserButton;
    private bool _busy;

    public SplashForm(LauncherConfig config, bool initialRestart)
    {
      _config = config;
      _initialRestart = initialRestart;

      Text = "RemoteDeck";
      StartPosition = FormStartPosition.CenterScreen;
      FormBorderStyle = FormBorderStyle.FixedDialog;
      MaximizeBox = false;
      MinimizeBox = false;
      ClientSize = new Size(460, 224);
      BackColor = Color.FromArgb(8, 11, 16);
      ForeColor = Color.FromArgb(232, 238, 247);
      Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

      try
      {
        Icon exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        if (exeIcon != null)
        {
          Icon = exeIcon;
        }
      }
      catch
      {
      }

      Label titleLabel = new Label();
      titleLabel.Text = "RemoteDeck";
      titleLabel.Font = new Font("Segoe UI", 16f, FontStyle.Bold);
      titleLabel.ForeColor = Color.FromArgb(232, 238, 247);
      titleLabel.AutoSize = false;
      titleLabel.TextAlign = ContentAlignment.MiddleCenter;
      titleLabel.Bounds = new Rectangle(24, 28, 412, 36);
      Controls.Add(titleLabel);

      _statusLabel = new Label();
      _statusLabel.Text = initialRestart
        ? "正在重启本地 RemoteDeck 服务..."
        : string.Format("正在检查 RemoteDeck 服务 ({0})...", _config.Url);
      _statusLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
      _statusLabel.ForeColor = Color.FromArgb(147, 161, 181);
      _statusLabel.AutoSize = false;
      _statusLabel.TextAlign = ContentAlignment.MiddleCenter;
      _statusLabel.Bounds = new Rectangle(24, 72, 412, 58);
      Controls.Add(_statusLabel);

      _actionsPanel = new FlowLayoutPanel();
      _actionsPanel.FlowDirection = FlowDirection.LeftToRight;
      _actionsPanel.WrapContents = true;
      _actionsPanel.AutoSize = true;
      _actionsPanel.BackColor = Color.Transparent;
      _actionsPanel.Visible = false;
      _actionsPanel.Location = new Point(28, 152);

      _retryButton = CreateActionButton("重试启动并连接", true);
      _retryButton.Click += delegate { StartBootstrap(false); };

      _restartButton = CreateActionButton("重启后台服务", false);
      _restartButton.Click += delegate { StartBootstrap(true); };

      _browserButton = CreateActionButton("在默认浏览器打开", false);
      _browserButton.Click += delegate
      {
        Program.OpenExternalUrl(_config.Url);
        Close();
      };

      _actionsPanel.Controls.Add(_retryButton);
      _actionsPanel.Controls.Add(_restartButton);
      _actionsPanel.Controls.Add(_browserButton);
      Controls.Add(_actionsPanel);
    }

    private static Button CreateActionButton(string text, bool primary)
    {
      Button btn = new Button();
      btn.Text = text;
      btn.AutoSize = true;
      btn.MinimumSize = new Size(122, 32);
      btn.Padding = new Padding(8, 4, 8, 4);
      btn.Margin = new Padding(0, 0, 8, 6);
      btn.FlatStyle = FlatStyle.Flat;
      btn.FlatAppearance.BorderSize = 1;
      btn.FlatAppearance.BorderColor = primary
        ? Color.FromArgb(76, 141, 255)
        : Color.FromArgb(62, 78, 102);
      btn.BackColor = primary
        ? Color.FromArgb(47, 117, 245)
        : Color.FromArgb(19, 26, 37);
      btn.ForeColor = Color.FromArgb(232, 238, 247);
      btn.Cursor = Cursors.Hand;
      return btn;
    }

    protected override void OnShown(EventArgs e)
    {
      base.OnShown(e);
      StartBootstrap(_initialRestart);
    }

    private void StartBootstrap(bool forceRestart)
    {
      if (_busy)
      {
        return;
      }
      _busy = true;
      _actionsPanel.Visible = false;
      _statusLabel.Text = forceRestart
        ? "正在重启本地 RemoteDeck 服务..."
        : "正在自动拉起本地 RemoteDeck 服务...";

      Thread worker = new Thread(delegate()
      {
        string action = forceRestart ? "restart" : "install";
        Program.RunServiceScript(_config, action);

        bool healthy = false;
        for (int i = 0; i < 30; i++)
        {
          if (Program.ProbeHealth(_config.HealthUrl, 900))
          {
            healthy = true;
            break;
          }
          Thread.Sleep(400);
        }

        if (IsDisposed)
        {
          return;
        }
        try
        {
          BeginInvoke((MethodInvoker)delegate
          {
            _busy = false;
            if (healthy)
            {
              Program.LaunchAppWindow(_config);
              Close();
              return;
            }
            _statusLabel.Text = string.Format("未能连接到 {0}，请检查本地服务是否已启动。", _config.Url);
            _actionsPanel.Visible = true;
          });
        }
        catch
        {
        }
      });
      worker.IsBackground = true;
      worker.Start();
    }
  }

  internal static class Program
  {
    private const string AppUserModelId = "com.guuguo.remodeck.desktop";

    [STAThread]
    private static void Main(string[] args)
    {
      try
      {
        NativeMethods.SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
      }
      catch
      {
      }

      string cfgPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launcher.cfg");
      LauncherConfig config = LoadConfig(cfgPath, args);

      bool restartService = false;
      if (args != null)
      {
        for (int i = 0; i < args.Length; i++)
        {
          if (string.Equals(args[i], "--restart-service", StringComparison.OrdinalIgnoreCase))
          {
            restartService = true;
          }
        }
      }

      if (!restartService && ProbeHealth(config.HealthUrl, 900))
      {
        LaunchAppWindow(config);
        return;
      }

      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      Application.Run(new SplashForm(config, restartService));
    }

    private static LauncherConfig LoadConfig(string cfgPath, string[] args)
    {
      Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      if (File.Exists(cfgPath))
      {
        try
        {
          string[] lines = File.ReadAllLines(cfgPath, Encoding.UTF8);
          for (int i = 0; i < lines.Length; i++)
          {
            string line = lines[i].Trim();
            if (line.Length == 0 || line.StartsWith("#"))
            {
              continue;
            }
            int eq = line.IndexOf('=');
            if (eq <= 0)
            {
              continue;
            }
            string key = line.Substring(0, eq).Trim();
            string val = line.Substring(eq + 1).Trim();
            map[key] = val;
          }
        }
        catch
        {
        }
      }

      LauncherConfig cfg = new LauncherConfig();
      cfg.Url = GetMapValue(map, "url");
      cfg.HealthUrl = GetMapValue(map, "healthUrl");
      cfg.Port = GetMapValue(map, "port");
      cfg.RepoRoot = GetMapValue(map, "repoRoot");
      cfg.BrowserPath = GetMapValue(map, "browserPath");
      cfg.ProfileDir = GetMapValue(map, "profileDir");
      cfg.NodePath = GetMapValue(map, "nodePath");

      if (args != null)
      {
        for (int i = 0; i < args.Length; i++)
        {
          string arg = args[i] ?? string.Empty;
          if (arg.StartsWith("--url=", StringComparison.OrdinalIgnoreCase))
          {
            cfg.Url = arg.Substring(6).Trim();
          }
          else if (string.Equals(arg, "--url", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
          {
            i++;
            cfg.Url = (args[i] ?? string.Empty).Trim();
          }
          else if (arg.StartsWith("--port=", StringComparison.OrdinalIgnoreCase))
          {
            cfg.Port = arg.Substring(7).Trim();
          }
          else if (string.Equals(arg, "--port", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
          {
            i++;
            cfg.Port = (args[i] ?? string.Empty).Trim();
          }
        }
      }

      if (string.IsNullOrEmpty(cfg.Port))
      {
        cfg.Port = "43310";
      }
      if (string.IsNullOrEmpty(cfg.Url))
      {
        cfg.Url = string.Format("http://127.0.0.1:{0}/", cfg.Port);
      }
      if (string.IsNullOrEmpty(cfg.HealthUrl))
      {
        cfg.HealthUrl = BuildHealthUrl(cfg.Url, cfg.Port);
      }
      if (string.IsNullOrEmpty(cfg.NodePath))
      {
        cfg.NodePath = "node.exe";
      }
      return cfg;
    }

    private static string GetMapValue(Dictionary<string, string> map, string key)
    {
      string val;
      if (map.TryGetValue(key, out val))
      {
        return val ?? string.Empty;
      }
      return string.Empty;
    }

    private static string BuildHealthUrl(string url, string fallbackPort)
    {
      try
      {
        UriBuilder builder = new UriBuilder(new Uri(url));
        builder.Path = "/health";
        builder.Query = string.Empty;
        return builder.Uri.ToString();
      }
      catch
      {
        return string.Format("http://127.0.0.1:{0}/health", fallbackPort);
      }
    }

    internal static bool ProbeHealth(string healthUrl, int timeoutMs)
    {
      try
      {
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(healthUrl);
        req.Method = "GET";
        req.Timeout = timeoutMs;
        req.ReadWriteTimeout = timeoutMs;
        req.Headers["Cache-Control"] = "no-cache";
        using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
        {
          return (int)resp.StatusCode == 200;
        }
      }
      catch
      {
        return false;
      }
    }

    internal static void RunServiceScript(LauncherConfig config, string action)
    {
      if (string.IsNullOrEmpty(config.RepoRoot))
      {
        return;
      }
      string serviceScript = Path.Combine(config.RepoRoot, "scripts", "service.mjs");
      if (!File.Exists(serviceScript))
      {
        return;
      }
      try
      {
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = config.NodePath;
        psi.Arguments = string.Format("\"{0}\" {1}", serviceScript, action);
        psi.WorkingDirectory = config.RepoRoot;
        psi.CreateNoWindow = true;
        psi.UseShellExecute = false;
        psi.WindowStyle = ProcessWindowStyle.Hidden;
        psi.EnvironmentVariables["PORT"] = config.Port;
        using (Process proc = Process.Start(psi))
        {
          if (proc != null)
          {
            proc.WaitForExit(10000);
          }
        }
      }
      catch
      {
      }
    }

    internal static void LaunchAppWindow(LauncherConfig config)
    {
      if (!string.IsNullOrEmpty(config.BrowserPath) && File.Exists(config.BrowserPath))
      {
        try
        {
          StringBuilder args = new StringBuilder();
          args.AppendFormat("--app=\"{0}\" ", config.Url);
          if (!string.IsNullOrEmpty(config.ProfileDir))
          {
            args.AppendFormat("--user-data-dir=\"{0}\" ", config.ProfileDir);
          }
          args.Append("--no-first-run --no-default-browser-check");
          ProcessStartInfo psi = new ProcessStartInfo(config.BrowserPath, args.ToString());
          psi.UseShellExecute = false;
          if (!string.IsNullOrEmpty(config.RepoRoot) && Directory.Exists(config.RepoRoot))
          {
            psi.WorkingDirectory = config.RepoRoot;
          }
          Process.Start(psi);
          return;
        }
        catch
        {
        }
      }
      OpenExternalUrl(config.Url);
    }

    internal static void OpenExternalUrl(string url)
    {
      try
      {
        ProcessStartInfo psi = new ProcessStartInfo(url);
        psi.UseShellExecute = true;
        Process.Start(psi);
      }
      catch
      {
      }
    }
  }
}

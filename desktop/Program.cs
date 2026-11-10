using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("图页 · 图片合并成 PDF")]
[assembly: AssemblyProduct("图页")]
[assembly: AssemblyDescription("离线将多张图片合并为一个 PDF")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Program
{
    internal const string Title = "图页 · 图片合并成 PDF";
    private static readonly Assembly Package = typeof(Program).Assembly;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbeddedAssembly;
        try
        {
            Run();
        }
        catch (Exception error)
        {
            ShowStartupError(error);
        }
    }

    private static Assembly ResolveEmbeddedAssembly(object sender, ResolveEventArgs args)
    {
        string name = new AssemblyName(args.Name).Name;
        switch (name)
        {
            case "Microsoft.Web.WebView2.Core":
            case "Microsoft.Web.WebView2.WinForms":
                return Assembly.Load(ReadBytes(name + ".dll"));
            default:
                return null;
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Run()
    {
        string data = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TuYePdf");
        string loader = Path.Combine(data, "loader", "1.0.3912.50", "x64");
        InstallLoader(loader);
        CoreWebView2Environment.SetLoaderDllFolderPath(loader);
        using (var window = new MainWindow(Path.Combine(data, "WebView2")))
        {
            Application.Run(window);
        }
    }

    private static void InstallLoader(string folder)
    {
        const string name = "WebView2Loader.dll";
        Directory.CreateDirectory(folder);
        string destination = Path.Combine(folder, name);
        byte[] bytes = ReadBytes(name);
        if (File.Exists(destination) && File.ReadAllBytes(destination).SequenceEqual(bytes))
            return;

        string temporary = Path.Combine(folder, Path.GetRandomFileName());
        try
        {
            File.WriteAllBytes(temporary, bytes);
            if (File.Exists(destination))
                File.Replace(temporary, destination, null);
            else
                File.Move(temporary, destination);
        }
        catch (IOException)
        {
            if (!File.Exists(destination) || !File.ReadAllBytes(destination).SequenceEqual(bytes))
                throw;
        }
        finally
        {
            File.Delete(temporary);
        }
    }

    internal static string ReadPage()
    {
        return Encoding.UTF8.GetString(ReadBytes("desktop.html"));
    }

    private static byte[] ReadBytes(string name)
    {
        using (Stream input = Package.GetManifestResourceStream(name))
        using (var buffer = new MemoryStream())
        {
            if (input == null) throw new InvalidOperationException("缺少程序组件 " + name);
            input.CopyTo(buffer);
            return buffer.ToArray();
        }
    }

    internal static void ShowStartupError(Exception error)
    {
        Exception cause = error.GetBaseException();
        bool runtimeMissing = cause.GetType().Name == "WebView2RuntimeNotFoundException";
        string message = runtimeMissing
            ? "本机缺少 Microsoft Edge WebView2 运行组件。请安装 Microsoft 官方 WebView2 Runtime 后重新打开图页。"
            : "启动失败，请关闭窗口后重试。\r\n\r\n" + cause.Message;
        MessageBox.Show(message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}

internal sealed class MainWindow : Form
{
    private readonly WebView2 view;
    private readonly Label loading;
    private readonly string profilePath;
    private bool ready;

    internal MainWindow(string profilePath)
    {
        this.profilePath = profilePath;
        Text = Program.Title;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        MinimumSize = new Size(490, 500);
        var workArea = Screen.FromPoint(Cursor.Position).WorkingArea;
        Size = new Size(Math.Min(1130, workArea.Width - 40), Math.Min(820, workArea.Height - 40));
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = Color.FromArgb(245, 243, 239);

        loading = new Label {
            Text = "正在打开图页…",
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Fill
        };
        view = new WebView2 { Dock = DockStyle.Fill };
        view.DefaultBackgroundColor = BackColor;
        Controls.Add(view);
        Controls.Add(loading);
        loading.BringToFront();
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, profilePath);
            if (IsDisposed) return;
            await view.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;

            CoreWebView2 core = view.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            view.AllowExternalDrop = true;
            core.NewWindowRequested += (sender, args) => { args.Handled = true; };
            core.NavigationCompleted += (sender, args) => {
                if (ready) return;
                if (!args.IsSuccess)
                {
                    loading.Text = "图页界面加载失败，请关闭窗口后重试。";
                    return;
                }
                ready = true;
                loading.Hide();
                core.NavigationStarting += BlockExternalNavigation;
            };
            core.DownloadStarting += SavePdf;
            core.NavigateToString(Program.ReadPage());
        }
        catch (Exception error)
        {
            if (IsDisposed) return;
            Program.ShowStartupError(error);
            Close();
        }
    }

    private static void BlockExternalNavigation(object sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (!args.Uri.StartsWith("blob:", StringComparison.Ordinal))
            args.Cancel = true;
    }

    private void SavePdf(object sender, CoreWebView2DownloadStartingEventArgs args)
    {
        args.Handled = true;
        if (!ready || !args.DownloadOperation.Uri.StartsWith("blob:", StringComparison.Ordinal))
        {
            args.Cancel = true;
            return;
        }

        CoreWebView2Deferral deferral = args.GetDeferral();
        // Let WebView2 finish dispatching the event before opening a modal dialog.
        SynchronizationContext.Current.Post(_ =>
        {
            using (deferral)
            {
                if (IsDisposed)
                {
                    args.Cancel = true;
                    return;
                }
                try
                {
                    using (var dialog = new SaveFileDialog {
                        Title = "保存合并后的 PDF",
                        Filter = "PDF 文件 (*.pdf)|*.pdf",
                        FileName = Path.GetFileName(args.ResultFilePath),
                        DefaultExt = "pdf",
                        AddExtension = true,
                        OverwritePrompt = true,
                        RestoreDirectory = true,
                        InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)
                    })
                    {
                        if (dialog.ShowDialog(this) != DialogResult.OK)
                        {
                            args.Cancel = true;
                            SendSaveStatus("canceled");
                            return;
                        }
                        args.ResultFilePath = dialog.FileName;
                        CoreWebView2DownloadOperation download = args.DownloadOperation;
                        download.StateChanged += DownloadStateChanged;
                    }
                }
                catch (Exception)
                {
                    args.Cancel = true;
                    SendSaveStatus("failed");
                }
            }
        }, null);
    }

    private void DownloadStateChanged(object sender, object args)
    {
        var download = (CoreWebView2DownloadOperation)sender;
        switch (download.State)
        {
            case CoreWebView2DownloadState.Completed:
                download.StateChanged -= DownloadStateChanged;
                SendSaveStatus("saved:" + Path.GetFileName(download.ResultFilePath));
                break;
            case CoreWebView2DownloadState.Interrupted:
                download.StateChanged -= DownloadStateChanged;
                SendSaveStatus("failed");
                break;
        }
    }

    private void SendSaveStatus(string message)
    {
        if (!IsDisposed) view.CoreWebView2.PostWebMessageAsString(message);
    }
}

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("多图转 PDF")]
[assembly: AssemblyProduct("多图转 PDF")]
[assembly: AssemblyDescription("将多张图片合并成 PDF 的离线桌面工具")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

internal static class Program
{
    internal const string Title = "多图转 PDF";
    internal static readonly string ApplicationFolder = AppDomain.CurrentDomain.BaseDirectory;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            foreach (string file in new[] {
                "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll",
                "WebView2Loader.dll", "app.html"
            })
            {
                if (!File.Exists(Path.Combine(ApplicationFolder, file)))
                    throw new FileNotFoundException("缺少程序文件 " + file + "。请将下载的 ZIP 完整解压后，再打开 TuYePdf.exe。");
            }
            Run();
        }
        catch (Exception error)
        {
            ShowStartupError(error);
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Run()
    {
        string data = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TuYePdf");
        CoreWebView2Environment.SetLoaderDllFolderPath(ApplicationFolder);
        using (var window = new MainWindow(Path.Combine(data, "WebView2")))
        {
            Application.Run(window);
        }
    }

    internal static string ReadPage()
    {
        return File.ReadAllText(Path.Combine(ApplicationFolder, "app.html"), Encoding.UTF8);
    }

    internal static long? ReadClipboardRequestId(string json)
    {
        try
        {
            var request = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
            object type;
            object value;
            if (request == null || !request.TryGetValue("type", out type) ||
                !string.Equals(type as string, "paste-image", StringComparison.Ordinal) ||
                !request.TryGetValue("requestId", out value))
                return null;
            if (!(value is int || value is long || value is decimal || value is double))
                return null;
            decimal requestId = Convert.ToDecimal(value, CultureInfo.InvariantCulture);
            if (requestId < 1 || requestId > 9007199254740991M || requestId != decimal.Truncate(requestId))
                return null;
            return decimal.ToInt64(requestId);
        }
        catch (Exception)
        {
            return null;
        }
    }

    internal static string SerializeClipboardResult(object value)
    {
        return new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Serialize(value);
    }

    internal static void ShowStartupError(Exception error)
    {
        Exception cause = error.GetBaseException();
        bool runtimeMissing = cause.GetType().Name == "WebView2RuntimeNotFoundException";
        string message = runtimeMissing
            ? "本机缺少 Microsoft Edge WebView2 运行组件。请安装 Microsoft 官方 WebView2 Runtime 后重新打开多图转 PDF。"
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
            Text = "正在打开多图转 PDF…",
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
                    loading.Text = "多图转 PDF 界面加载失败，请关闭窗口后重试。";
                    return;
                }
                ready = true;
                loading.Hide();
                core.NavigationStarting += BlockExternalNavigation;
            };
            core.DownloadStarting += SavePdf;
            core.WebMessageReceived += PasteImage;
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

    private void PasteImage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        long? requestId = Program.ReadClipboardRequestId(args.WebMessageAsJson);
        if (!requestId.HasValue) return;

        try
        {
            using (Image image = Clipboard.GetImage())
            {
                if (image == null)
                {
                    SendClipboardResult(new {
                        type = "clipboard-error", requestId = requestId.Value,
                        message = "剪贴板中没有图片，请先复制图片后重试。"
                    });
                    return;
                }
                using (var png = new MemoryStream())
                {
                    image.Save(png, ImageFormat.Png);
                    string name = "粘贴图片-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".png";
                    SendClipboardResult(new {
                        type = "clipboard-image", requestId = requestId.Value,
                        dataUrl = "data:image/png;base64," + Convert.ToBase64String(png.ToArray()), name = name
                    });
                }
            }
        }
        catch (Exception)
        {
            if (!IsDisposed)
                SendClipboardResult(new {
                    type = "clipboard-error", requestId = requestId.Value,
                    message = "无法读取剪贴板图片，请稍后重试，或直接按 Ctrl+V。"
                });
        }
    }

    private void SendClipboardResult(object value)
    {
        if (!IsDisposed)
            view.CoreWebView2.PostWebMessageAsJson(Program.SerializeClipboardResult(value));
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

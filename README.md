# 图页 · 图片合并成 PDF

把多张 JPG、PNG、WebP 或 BMP 图片合成一个 PDF。每张图片占一页，按列表顺序导出。

- [使用网页版](https://xhuozhong.github.io/tuye-pdf/)
- [下载 Windows x64 版](https://github.com/xhuozhong/tuye-pdf/releases/latest/download/TuYePdf-win-x64.exe)
- [下载离线 HTML](https://github.com/xhuozhong/tuye-pdf/releases/latest/download/TuYePdf-offline.html)

## 使用方法

1. 选择或拖入图片，可通过拖动序号或上下箭头调整页序。
2. 选择 A4 自动方向、A4 竖版、A4 横版或按图片比例，并填写 PDF 文件名。
3. 网页版下载 PDF，Windows 版会弹出保存对话框。

图片和 PDF 在本机处理，无需上传文件。透明区域以白底导出，导出会压缩图片并缩小超大图片。

## Windows 桌面版

在 64 位 Windows 10 或 Windows 11 上双击 `TuYePdf-win-x64.exe`。应用需要 .NET Framework 4.6.2 或更高版本和 Microsoft Edge WebView2 Runtime。若系统提示缺少 WebView2，可从微软下载。桌面版可离线转换图片，应用程序本身无需安装。首次运行会在 `%LOCALAPPDATA%\TuYePdf` 创建应用组件和缓存目录。 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

发行文件未做代码签名，Windows 可能提示未知发布者。可在 [发行页面](https://github.com/xhuozhong/tuye-pdf/releases) 核对下载文件的 SHA-256。使用 PowerShell 计算本地哈希：

```powershell
Get-FileHash .\TuYePdf-win-x64.exe -Algorithm SHA256
```

## 从源码构建

在仓库根目录运行以下命令。`src/` 保存共享页面和 PDF 生成代码，`docs/index.html` 是 GitHub Pages 使用的页面。

```powershell
node .\src\build.cjs
```

这会生成 `docs/index.html` 和 `dist/TuYePdf-offline.html`。离线 HTML 可在浏览器中直接打开。

Windows 构建需 64 位 Windows、PowerShell、Node.js 和系统自带的 .NET Framework C# 编译器。

```powershell
powershell -NoProfile -File .\desktop\build.ps1
```

脚本从 NuGet 获取固定版本的 WebView2 SDK 并校验文件哈希，生成 `dist/TuYePdf-win-x64.exe`。也可用 `-SdkDir` 指定已解包的同版本 SDK。`desktop/Program.cs` 是桌面窗口和保存对话框的源代码。

## 验证范围

Chrome 和 Edge 已验证批量选图、排序、下载、损坏图片处理和四种页面模式。已验证 Windows 桌面应用启动及应用内生成和保存两页 PDF。桌面版的原生选图和保存对话框仍待手动走查。

## 第三方组件

Windows 版内嵌 Microsoft WebView2 SDK 1.0.3912.50 的必要组件。应用内「组件许可」提供许可和声明的原文。 [SDK 许可](third-party/webview2/LICENSE.txt) · [第三方声明](third-party/webview2/NOTICE.txt) · [NuGet 包](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3912.50)

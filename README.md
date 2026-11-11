# 多图转 PDF

把多张 JPG、PNG、WebP 或 BMP 图片合成一个 PDF。每张图片占一页，按列表顺序导出。

- [使用网页版](https://xhuozhong.github.io/tuye-pdf/)
- [下载 Windows x64 ZIP](https://github.com/xhuozhong/tuye-pdf/releases/latest/download/TuYePdf-win-x64.zip)
- [下载离线 HTML](https://github.com/xhuozhong/tuye-pdf/releases/latest/download/TuYePdf-offline.html)

## 使用方法

1. 选择、拖入或粘贴图片，可按文件名自然排序，或通过拖动序号和上下箭头调整页序。
2. 查看大图并按需旋转，选择 A4 自动方向、A4 竖版、A4 横版或按图片比例，填写 PDF 文件名。
3. 网页版下载 PDF，Windows 版会弹出保存对话框。

图片和 PDF 在本机处理，无需上传文件。透明区域以白底导出，导出会压缩图片并缩小超大图片。

## Windows 桌面版

v1.1.0 使用完整的便携文件夹。将 `TuYePdf-win-x64.zip` 中的所有文件解压到同一文件夹，再打开其中的 `TuYePdf.exe`。请连同配套 DLL 和 `app.html` 一起保留。

应用适用于 64 位 Windows 10 或 Windows 11，需要 .NET Framework 4.6.2 或更高版本和 Microsoft Edge WebView2 Runtime。若系统提示缺少 WebView2，可从微软下载。桌面版可离线转换图片，首次运行会在 `%LOCALAPPDATA%\TuYePdf\WebView2` 创建缓存目录。 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

发行文件未做代码签名，Windows 可能提示未知发布者。此前收到 360 对经微信接收的同名工具文件的隔离反馈，隔离文件与 v1.0.0 发布文件的哈希对应关系、厂商复核结论仍待确认。v1.1.0 已采用常规文件夹分发方式，360 的检测结果仍待复核。

可在 [发行页面](https://github.com/xhuozhong/tuye-pdf/releases) 核对 ZIP 的 SHA-256。解压后的 `SHA256SUMS.txt` 记录包内文件的哈希。使用 PowerShell 计算本地 ZIP 哈希。

```powershell
Get-FileHash .\TuYePdf-win-x64.zip -Algorithm SHA256
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

脚本从 NuGet 获取固定版本的 WebView2 SDK 并校验文件哈希，生成 `dist/TuYePdf-win-x64/` 和 `dist/TuYePdf-win-x64.zip`。也可用 `-SdkDir` 指定已解包的同版本 SDK。`desktop/Program.cs` 是桌面窗口和保存对话框的源代码。

文件夹内包含主程序、WebView2 的两个托管程序集和本机加载器、`app.html`、第三方声明和校验清单。主程序从同一目录加载这些文件。

## 验证范围

Chrome 和 Edge 的浏览器测试覆盖批量选图、拖放排序、文件名自然排序、清空列表、大图预览、旋转后导出、损坏图片处理和四种页面模式。图片粘贴通过浏览器事件和模拟剪贴板响应验证，已检查异步请求中过期响应的处理。

Windows 包已通过源码编译、SDK 组件哈希和包内文件校验。原生剪贴板 JSON 协议通过 23 项合成数据测试，覆盖请求 ID、错误响应和较大图片数据。系统剪贴板、原生选图和保存对话框仍待手动走查。

## 第三方组件

Windows 版随附 Microsoft WebView2 SDK 1.0.3912.50 的必要组件。应用内「组件许可」和包内 `THIRD-PARTY-NOTICES.txt` 提供许可和声明的原文。 [SDK 许可](third-party/webview2/LICENSE.txt) · [第三方声明](third-party/webview2/NOTICE.txt) · [NuGet 包](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3912.50)

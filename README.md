# 多图转 PDF

将 JPG、PNG、WebP、BMP 图片和已有 PDF 按列表顺序合成一份 PDF。可以整理报销票据、扫描件和长截图，同一份 PDF 的原有页序保留。

- [使用网页版](https://xhuozhong.github.io/tuye-pdf/)
- [下载 Windows x64 ZIP](https://github.com/xhuozhong/tuye-pdf/releases/latest/download/TuYePdf-win-x64.zip)
- [下载离线 HTML](https://github.com/xhuozhong/tuye-pdf/releases/latest/download/TuYePdf-offline.html)

## 使用方法

1. 选择或拖入图片与 PDF，也可粘贴截图。通过文件名自然排序、拖动序号或上下箭头调整文件顺序。
2. 图片可查看大图、裁剪和旋转。PDF 条目展示页数等信息，并整份加入合并结果。
3. 为图片选择页面规格、画质与体积模式，以及长图保留一页或按 A4 竖版分页，填写输出文件名。
4. 生成前会检查文件。无法读取的文件可移除，或由用户选择跳过后继续。生成过程中可以取消。
5. 网页版下载 PDF，Windows 版会弹出保存对话框。取消保存或保存失败后，可用生成好的结果再次下载或重新选择保存位置。

文件在本机处理，无需上传。图片提供「均衡」「保留原图清晰度」「更小文件」模式，透明区域以白底导出。已有 PDF 的文字、矢量内容和页面尺寸保留，页面规格、画质、裁剪和长图分页设置作用于图片。

PDF 表单会使用已有外观生成固定的页面内容。不支持的表单和 XFA 会在预检中提示，可选择跳过。需要验证数字签名时，请使用对应的原 PDF。

## Windows 桌面版

v1.2.0 使用完整的便携文件夹。将 `TuYePdf-win-x64.zip` 中的所有文件解压到同一文件夹，再打开其中的 `TuYePdf.exe`。请连同配套 DLL 和 `app.html` 一起保留。

应用适用于 64 位 Windows 10 或 Windows 11，需要 .NET Framework 4.6.2 或更高版本和 Microsoft Edge WebView2 Runtime。若系统提示缺少 WebView2，可从微软下载。桌面版可离线转换图片，首次运行会在 `%LOCALAPPDATA%\TuYePdf\WebView2` 创建缓存目录。 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

发行文件未做代码签名，Windows 可能提示未知发布者。此前收到 360 对经微信接收的同名工具文件的隔离反馈，隔离文件与 v1.0.0 发布文件的哈希对应关系、厂商复核结论仍待确认。Windows 版从 v1.1.0 起采用常规文件夹分发方式，当前版本的 360 检测结果仍待复核。

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

Chrome 网页版和 Edge 离线版已验证画质预设、裁剪、长图分页、生成取消、图片与 PDF 混合合并，以及取消或失败后使用同一结果更改文件名并再次保存。已检查窄屏布局、图片粘贴的模拟响应和异步请求中过期响应的处理。

转换引擎检查覆盖符合直嵌条件的 JPEG 原数据保留、EXIF 方向与手动旋转组合、带 ICC 配置图片的颜色回退处理、先裁剪后旋转、长图分页连续性和各画质模式的尺寸。混合 PDF 验证了原有可选中文字、矢量资源和页面尺寸，以及表单已有外观的固定显示和不支持表单的报错。

Windows 包已通过源码编译、SDK 组件哈希和包内文件校验。原生剪贴板 JSON 协议通过 23 项合成数据测试，保存适配器测试覆盖取消和失败后重试、缓存释放及实际保存名称。系统剪贴板、原生选图和保存对话框仍待手动走查。

## 第三方组件

PDF 合并使用 pdf-lib 1.17.1，按 MIT 许可提供，其打包依赖附有各自的许可和声明。Windows 版随附 Microsoft WebView2 SDK 1.0.3912.50 的必要组件。应用内「组件许可」和包内 `THIRD-PARTY-NOTICES.txt` 提供各组件的许可原文。 [pdf-lib 许可](third-party/pdf-lib/LICENSE.txt) · [pdf-lib 依赖声明](third-party/pdf-lib/THIRD-PARTY-NOTICES.txt) · [WebView2 许可](third-party/webview2/LICENSE.txt) · [WebView2 第三方声明](third-party/webview2/NOTICE.txt)

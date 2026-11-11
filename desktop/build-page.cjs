const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '..', 'dist', 'TuYePdf-offline.html');
let page = fs.readFileSync(source, 'utf8');

function replaceOnce(from, to) {
  if (page.split(from).length !== 2) throw new Error('Expected one desktop insertion point: ' + from);
  page = page.replace(from, () => to);
}

const sdk = path.join(__dirname, '..', 'third-party', 'webview2');
const license = ['LICENSE.txt', 'NOTICE.txt']
  .map(file => fs.readFileSync(path.join(sdk, file), 'utf8').trim())
  .join('\n\n')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

replaceOnce('<title>', `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; base-uri 'none'; form-action 'none'">
  <title>`);
replaceOnce('  </style>', `
    .footer-license { border: 0; background: transparent; color: var(--muted); padding: 0; text-decoration: underline; text-underline-offset: 3px; }
    #license-dialog { border: 1px solid var(--line); border-radius: 14px; padding: 20px; width: min(620px, calc(100% - 36px)); color: var(--ink); }
    #license-dialog::backdrop { background: #172b2b70; }
    #license-dialog .license-text { max-height: 55vh; overflow: auto; white-space: pre-wrap; font-size: 12px; }
    #license-dialog .pick-button { margin-left: auto; }
  </style>`);
replaceOnce('id="export-label">生成并下载 PDF', 'id="export-label">生成并保存 PDF');
replaceOnce('双击本文件，即可在浏览器中离线使用。', '多图转 PDF · Windows 桌面版');
replaceOnce('导出时会压缩图片，超大图片会缩小。</span></div>', `导出时会压缩图片，超大图片会缩小。</span><button type="button" id="license-button" class="footer-license">组件许可</button></div>
    <dialog id="license-dialog" aria-labelledby="license-heading">
      <h2 id="license-heading">WebView2 SDK 组件许可</h2>
      <pre class="license-text" tabindex="0">${license}</pre>
      <button type="button" class="pick-button" id="close-license">关闭</button>
    </dialog>`);
replaceOnce("  exportButton.addEventListener('click', async () => {", `  const licenseDialog = document.querySelector('#license-dialog');
  document.querySelector('#license-button').addEventListener('click', () => licenseDialog.showModal());
  document.querySelector('#close-license').addEventListener('click', () => licenseDialog.close());

  let pendingSave = null;

  function finishExport() {
    setBusy(false);
    exportLabel.textContent = '生成并保存 PDF';
    exportButton.focus();
  }

  window.chrome.webview.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    if (!pendingSave) return;
    const message = event.data;
    const { count, bytes, url } = pendingSave;
    pendingSave = null;
    URL.revokeObjectURL(url);
    if (message.startsWith('saved:')) {
      setNotice(notice, \`已保存 \${message.slice(6)}，共 \${count} 页（\${fileSize(bytes)}）。\`);
    } else if (message === 'canceled') {
      setNotice(notice, '已取消保存。');
    } else {
      setNotice(notice, '保存失败，请换一个位置后重试。', 'error');
    }
    finishExport();
  });

  exportButton.addEventListener('click', async () => {`);
replaceOnce(`      document.body.append(download);
      download.click();
      download.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(notice, \`已生成 \${name}，共 \${files.length} 页（\${fileSize(blob.size)}）。\`);`,
`      pendingSave = { count: files.length, bytes: blob.size, url };
      exportLabel.textContent = '等待保存 PDF';
      setNotice(notice, '请选择 PDF 保存位置。');
      document.body.append(download);
      download.click();
      download.remove();`);
replaceOnce(`      setNotice(notice, error.message || '生成失败，请检查图片后重试。', 'error');
    } finally {
      setBusy(false);
      exportLabel.textContent = '生成并下载 PDF';
      exportButton.focus();
    }`, `      if (pendingSave) URL.revokeObjectURL(pendingSave.url);
      pendingSave = null;
      setNotice(notice, error.message || '生成失败，请检查图片后重试。', 'error');
    } finally {
      if (!pendingSave) finishExport();
    }`);

fs.writeFileSync(path.join(__dirname, 'desktop.html'), page);

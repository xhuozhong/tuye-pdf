const fs = require('node:fs');
const path = require('node:path');

function installDesktopAdapter() {
  const licenseDialog = document.querySelector('#license-dialog');
  const licenseButton = document.createElement('button');
  licenseButton.type = 'button';
  licenseButton.id = 'license-button';
  licenseButton.className = 'footer-license';
  licenseButton.textContent = '组件许可';
  document.querySelector('.footer').append(licenseButton);
  licenseButton.addEventListener('click', () => licenseDialog.showModal());
  document.querySelector('#close-license').addEventListener('click', () => licenseDialog.close());
  const retryButton = document.querySelector('#retry-button');
  if (retryButton) retryButton.textContent = '重新选择保存位置';

  let cachedDownload = null;
  let pendingSave = null;

  function releaseDownload() {
    if (cachedDownload) URL.revokeObjectURL(cachedDownload.url);
    cachedDownload = null;
  }

  window.nativeReleasePdf = () => {
    if (pendingSave) {
      pendingSave.releaseAfterSave = true;
      return;
    }
    releaseDownload();
  };

  window.nativeSavePdf = (blob, name) => {
    if (pendingSave) return pendingSave.promise;
    if (!cachedDownload || cachedDownload.blob !== blob) {
      releaseDownload();
      cachedDownload = { blob, url: URL.createObjectURL(blob) };
    }

    let resolveSave;
    const promise = new Promise(resolve => { resolveSave = resolve; });
    pendingSave = { promise, resolve: resolveSave, name, releaseAfterSave: false };
    const download = document.createElement('a');
    download.href = cachedDownload.url;
    download.download = name;
    try {
      document.body.append(download);
      download.click();
    } catch {
      pendingSave = null;
      resolveSave({ status: 'failed', name });
    } finally {
      download.remove();
    }
    return promise;
  };

  window.chrome.webview.addEventListener('message', event => {
    if (typeof event.data !== 'string' || !pendingSave) return;
    const message = event.data;
    if (message !== 'canceled' && message !== 'failed' && !message.startsWith('saved:')) return;

    const operation = pendingSave;
    pendingSave = null;
    const saved = message.startsWith('saved:');
    if (saved || operation.releaseAfterSave) releaseDownload();
    operation.resolve({
      status: saved ? 'saved' : message,
      name: saved ? message.slice(6) : operation.name,
    });
  });

  window.addEventListener('pagehide', () => window.nativeReleasePdf());
}

const source = path.join(__dirname, '..', 'dist', 'TuYePdf-offline.html');
let page = fs.readFileSync(source, 'utf8');

function replaceOnce(from, to) {
  if (page.split(from).length !== 2) throw new Error('Expected one desktop insertion point: ' + from);
  page = page.replace(from, () => to);
}

const licenseFiles = ['webview2/LICENSE.txt', 'webview2/NOTICE.txt', 'pdf-lib/LICENSE.txt', 'pdf-lib/THIRD-PARTY-NOTICES.txt'];
const license = licenseFiles
  .map(file => fs.readFileSync(path.join(__dirname, '..', 'third-party', file), 'utf8').trim())
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
page = page.replaceAll('生成并下载 PDF', '生成并保存 PDF');
replaceOnce('双击本文件，即可在浏览器中离线使用。', '多图转 PDF · Windows 桌面版');
replaceOnce('</body>', `  <dialog id="license-dialog" aria-labelledby="license-heading">
    <h2 id="license-heading">第三方组件许可</h2>
    <pre class="license-text" tabindex="0">${license}</pre>
    <button type="button" class="pick-button" id="close-license">关闭</button>
  </dialog>
  <script>(${installDesktopAdapter.toString()})();</script>
</body>`);

if (Buffer.byteLength(page, 'utf8') > 2 * 1024 * 1024) {
  throw new Error('Desktop HTML exceeds the 2 MB WebView2 NavigateToString limit.');
}
fs.writeFileSync(path.join(__dirname, 'desktop.html'), page);

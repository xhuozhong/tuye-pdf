const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(__dirname, 'image-to-pdf.html'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, 'pdf-engine.js'), 'utf8').trimEnd();

function replaceOnce(page, from, to) {
  if (page.split(from).length !== 2) throw new Error(`Expected one insertion point: ${from}`);
  return page.replace(from, () => to);
}

function write(relativePath, content) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

const offline = replaceOnce(template, '/* PDF_ENGINE */', engine);
write('dist/TuYePdf-offline.html', offline);

let web = replaceOnce(offline, '<title>图片合并成 PDF</title>', `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; base-uri 'none'; form-action 'none'">
  <link rel="icon" href="data:,">
  <title>图页 · 图片合并成 PDF</title>`);
web = replaceOnce(web, '离线运行 · 图片留在本机', '浏览器内处理 · 图片留在本机');
web = replaceOnce(web, '    .footer {', '    .footer a { color: inherit; text-underline-offset: 3px; }\n    .footer {');
web = replaceOnce(web, '双击本文件，即可在浏览器中离线使用。', '图页 · 网页版');
web = replaceOnce(web, '导出时会压缩图片，超大图片会缩小。</span></div>', `导出时会压缩图片，超大图片会缩小。</span><a href="https://github.com/xhuozhong/tuye-pdf/releases/latest/download/TuYePdf-win-x64.exe">下载 Windows 版</a></div>`);
write('docs/index.html', web);

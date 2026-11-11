// Convert File or { file: File, rotation?: number } entries to a PDF Blob.
// Rotation is clockwise in 90-degree steps, applied after camera orientation.
// onProgress(completed, total) runs after each page. Modes: auto A4,
// portrait A4, landscape A4, or image.
async function buildImagePdf(files, { pageMode = 'auto', onProgress = () => {} } = {}) {
  if (!files.length) throw new Error('请先添加至少一张图片。');
  if (!['auto', 'portrait', 'landscape', 'image'].includes(pageMode)) {
    throw new Error('请选择有效的页面尺寸。');
  }

  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;

  function append(value) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes instanceof Blob ? bytes.size : bytes.byteLength;
  }

  function startObject(id) {
    offsets[id] = length;
    append(`${id} 0 obj\n`);
  }

  append('%PDF-1.4\n');
  append(new Uint8Array([37, 226, 227, 207, 211, 10]));
  startObject(1);
  append('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObject(2);
  const kids = Array.from(files, (_, index) => `${3 + index * 3} 0 R`);
  append(`<< /Type /Pages /Count ${files.length} /Kids [${kids.join(' ')}] >>\nendobj\n`);

  for (const [index, entry] of files.entries()) {
    const file = entry.file || entry;
    const requestedRotation = entry.file ? (entry.rotation ?? 0) : 0;
    const rotation = ((requestedRotation % 360) + 360) % 360;
    if (!Number.isFinite(requestedRotation) || rotation % 90 !== 0) {
      throw new Error(`第 ${index + 1} 张图片“${file.name}”的旋转角度必须是 90 度的整数倍。`);
    }
    // Yield between pages so the progress indicator can repaint.
    await new Promise(resolve => setTimeout(resolve, 0));
    let page;
    try {
      page = await rasterizePdfImage(file, rotation);
    } catch {
      throw new Error(`第 ${index + 1} 张图片“${file.name}”无法处理。请确认文件能正常打开，或将其另存为 JPG / PNG 后重试。`);
    }

    // Keep the assembled Blob within a practical size for local browser use.
    if (length + page.jpeg.size > 512 * 1024 * 1024) {
      throw new Error('生成的 PDF 将超过 512 MB。请减少图片数量后分批导出。');
    }

    const { width, height, x, y, drawWidth, drawHeight } = pdfImagePlacement(page, pageMode);
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;

    startObject(pageId);
    append(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(4)} ${height.toFixed(4)}]
/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

    const matrix = [drawWidth, 0, 0, drawHeight, x, y].map(number => number.toFixed(4)).join(' ');
    const content = encoder.encode(`q\n${matrix} cm\n/Im0 Do\nQ\n`);
    startObject(contentId);
    append(`<< /Length ${content.byteLength} >>\nstream\n`);
    append(content);
    append('endstream\nendobj\n');

    startObject(imageId);
    append(`<< /Type /XObject /Subtype /Image /Width ${page.rasterWidth} /Height ${page.rasterHeight}
/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.size} >>\nstream\n`);
    append(page.jpeg);
    append('\nendstream\nendobj\n');

    onProgress(index + 1, files.length);
  }

  const xref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  const entries = offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`);
  append(entries.join(''));
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

async function rasterizePdfImage(file, rotation = 0) {
  const canvas = document.createElement('canvas');
  let bitmap;
  let image;
  let imageUrl;
  try {
    if (typeof createImageBitmap === 'function') {
      // Apply camera orientation metadata before choosing the paper direction.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } else {
      imageUrl = URL.createObjectURL(file);
      image = new Image();
      image.src = imageUrl;
      await image.decode();
    }
    const source = bitmap || image;
    const sourceWidth = bitmap ? bitmap.width : image.naturalWidth;
    const sourceHeight = bitmap ? bitmap.height : image.naturalHeight;
    const quarterTurn = rotation % 180 !== 0;
    const width = quarterTurn ? sourceHeight : sourceWidth;
    const height = quarterTurn ? sourceWidth : sourceHeight;
    if (!width || !height) throw new Error('Invalid image dimensions');

    // Keep large phone photos manageable while retaining print detail.
    const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(12_000_000 / (width * height)));
    const rasterWidth = Math.max(1, Math.round(width * scale));
    const rasterHeight = Math.max(1, Math.round(height * scale));
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, rasterWidth, rasterHeight);
    context.imageSmoothingQuality = 'high';
    context.translate(rasterWidth / 2, rasterHeight / 2);
    context.rotate(rotation * Math.PI / 180);
    const drawWidth = quarterTurn ? rasterHeight : rasterWidth;
    const drawHeight = quarterTurn ? rasterWidth : rasterHeight;
    context.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    bitmap?.close();
    bitmap = null;

    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    if (!jpeg || jpeg.type !== 'image/jpeg') throw new Error('JPEG encoding failed');
    return { width, height, rasterWidth, rasterHeight, jpeg };
  } finally {
    bitmap?.close();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    canvas.width = canvas.height = 1;
  }
}

function pdfImagePlacement(image, mode) {
  if (mode === 'image') {
    // 96 image pixels per inch, reduced uniformly for unusually large pages.
    const scale = Math.min(0.75, 14400 / Math.max(image.width, image.height));
    const width = image.width * scale;
    const height = image.height * scale;
    return { width, height, x: 0, y: 0, drawWidth: width, drawHeight: height };
  }

  const landscape = mode === 'landscape' || (mode === 'auto' && image.width > image.height);
  const a4Short = 210 * 72 / 25.4;
  const a4Long = 297 * 72 / 25.4;
  const width = landscape ? a4Long : a4Short;
  const height = landscape ? a4Short : a4Long;
  const margin = 24;
  const scale = Math.min((width - margin * 2) / image.width, (height - margin * 2) / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  return { width, height, x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, drawWidth, drawHeight };
}

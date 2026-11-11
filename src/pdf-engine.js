// Entries are File or { file, type?: 'image'|'pdf', rotation?, crop? }.
// Crop coordinates are normalized in the EXIF-corrected original image, before
// clockwise quarter-turn rotation. Imported PDFs retain every original page.
// Progress counts completed source files. Its third argument reports output pages.
async function buildImagePdf(files, {
  pageMode = 'auto',
  qualityMode = 'balanced',
  longImageMode = 'single',
  signal,
  onProgress = () => {},
} = {}) {
  pdfCheckAbort(signal);
  if (!files?.length) throw pdfExportError('请先添加至少一张图片。', 'empty-input');
  if (!['auto', 'portrait', 'landscape', 'image'].includes(pageMode)) {
    throw pdfExportError('请选择有效的页面尺寸。', 'invalid-page-mode');
  }
  if (!['balanced', 'original', 'small'].includes(qualityMode)) {
    throw pdfExportError('请选择有效的导出质量。', 'invalid-quality-mode');
  }
  if (!['single', 'split'].includes(longImageMode)) {
    throw pdfExportError('请选择有效的长图处理方式。', 'invalid-long-image-mode');
  }

  const entries = Array.from(files);
  if (entries.some(pdfIsPdfEntry)) {
    return pdfBuildMixedDocument(entries, { pageMode, qualityMode, longImageMode, signal, onProgress });
  }
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  const kids = [];
  let length = 0;
  let nextObjectId = 3;

  function append(value) {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes instanceof Blob ? bytes.size : bytes.byteLength;
  }

  function startObject(id) {
    offsets[id] = length;
    append(`${id} 0 obj\n`);
  }

  function writePage(image, placement, strip, split) {
    const pageId = nextObjectId++;
    const contentId = nextObjectId++;
    const newImage = !image.objectId;
    if (newImage) image.objectId = nextObjectId++;
    const imageId = image.objectId;
    if (newImage && length + image.jpeg.size > 512 * 1024 * 1024) {
      throw pdfExportError('生成的 PDF 将超过 512 MB。请减少图片数量后分批导出。', 'output-size-limit', 'PDFLimitError');
    }
    kids.push(`${pageId} 0 R`);
    const { width, height, x, y, drawWidth, drawHeight } = placement;
    startObject(pageId);
    append(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(4)} ${height.toFixed(4)}]
/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

    const matrix = pdfImageMatrix(image, placement, strip).map(number => number.toFixed(4)).join(' ');
    const clip = image.direct && split
      ? `${[x, y, drawWidth, drawHeight].map(number => number.toFixed(4)).join(' ')} re W n\n`
      : '';
    const content = encoder.encode(`q\n${clip}${matrix} cm\n/Im0 Do\nQ\n`);
    startObject(contentId);
    append(`<< /Length ${content.byteLength} >>\nstream\n`);
    append(content);
    append('endstream\nendobj\n');

    if (newImage) {
      startObject(imageId);
      append(`<< /Type /XObject /Subtype /Image /Width ${image.rasterWidth} /Height ${image.rasterHeight}
/ColorSpace /${image.colorSpace || 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.size} >>\nstream\n`);
      append(image.jpeg);
      append('\nendstream\nendobj\n');
    }
  }

  append('%PDF-1.4\n');
  append(new Uint8Array([37, 226, 227, 207, 211, 10]));
  startObject(1);
  append('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  for (const [index, entry] of entries.entries()) {
    pdfCheckAbort(signal);
    const file = entry?.file || entry;
    const label = `第 ${index + 1} 张图片“${file?.name || '未命名图片'}”`;
    const detail = { sourceNumber: index + 1, fileName: file?.name || '' };
    if (!(file instanceof Blob) || !file.size) {
      throw pdfExportError(`${label}不是有效的图片文件。`, 'invalid-file', 'PDFInputError', detail);
    }
    const requestedRotation = entry?.file ? (entry.rotation ?? 0) : 0;
    if (!Number.isFinite(requestedRotation) || requestedRotation % 90 !== 0) {
      throw pdfExportError(`${label}的旋转角度必须是 90 度的整数倍。`, 'invalid-rotation', 'PDFInputError', detail);
    }
    const rotation = ((requestedRotation % 360) + 360) % 360;
    const crop = pdfValidateCrop(entry?.file ? entry.crop : undefined, label, detail);
    let decoded;
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      pdfCheckAbort(signal);
      const direct = qualityMode === 'original' && !crop ? await pdfReadDirectJpeg(file, rotation, signal) : null;
      if (!direct) decoded = await pdfDecodeImage(file, signal);
      const rectangle = decoded ? pdfCropPixels(crop, decoded.width, decoded.height, label, detail) : null;
      const quarterTurn = rotation % 180 !== 0;
      const imageWidth = direct ? direct.width : (quarterTurn ? rectangle.height : rectangle.width);
      const imageHeight = direct ? direct.height : (quarterTurn ? rectangle.width : rectangle.height);
      const printableWidth = 210 * 72 / 25.4 - 48;
      const printableHeight = 297 * 72 / 25.4 - 48;
      const split = longImageMode === 'split' && imageHeight / imageWidth > printableHeight / printableWidth;
      const stripHeight = split ? Math.max(1, Math.floor(printableHeight * imageWidth / printableWidth)) : imageHeight;

      for (let top = 0; top < imageHeight; top += stripHeight) {
        await new Promise(resolve => setTimeout(resolve, 0));
        pdfCheckAbort(signal);
        const strip = { top, width: imageWidth, height: Math.min(stripHeight, imageHeight - top) };
        const image = direct || await pdfRasterizeImage(decoded.source, rectangle, rotation, strip, qualityMode, signal);
        pdfCheckAbort(signal);
        const placement = split ? {
          width: printableWidth + 48,
          height: printableHeight + 48,
          x: 24,
          y: printableHeight + 24 - strip.height * printableWidth / imageWidth,
          drawWidth: printableWidth,
          drawHeight: strip.height * printableWidth / imageWidth,
        } : pdfImagePlacement(image, pageMode);
        writePage(image, placement, strip, split);
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (error.name?.startsWith('PDF')) throw error;
      const message = qualityMode === 'original'
        ? `${label}无法按原图尺寸处理。请确认文件正常，或改用“均衡”后重试。`
        : `${label}无法处理。请确认文件能正常打开，或将其另存为 JPG / PNG 后重试。`;
      const failure = pdfExportError(message, 'image-processing-failed', 'PDFImageError', detail);
      failure.cause = error;
      throw failure;
    } finally {
      decoded?.close();
    }
    pdfCheckAbort(signal);
    onProgress(index + 1, entries.length, { pagesCompleted: kids.length });
  }

  pdfCheckAbort(signal);
  // The page count is known after splitting, so the page tree is written last.
  startObject(2);
  append(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>\nendobj\n`);
  const xref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  append(offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''));
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

function pdfIsPdfEntry(entry) {
  const file = entry?.file || entry;
  return entry?.type === 'pdf' || file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}

async function pdfBuildMixedDocument(entries, options) {
  const { PDFDocument } = globalThis.PDFLib || {};
  if (!PDFDocument) {
    throw pdfExportError('PDF 合并组件尚未加载，请重新打开工具后重试。', 'missing-pdf-library', 'PDFDependencyError');
  }
  const { signal, onProgress } = options;
  const output = await PDFDocument.create({ updateMetadata: false });
  for (const [index, entry] of entries.entries()) {
    pdfCheckAbort(signal);
    const file = entry?.file || entry;
    const detail = { sourceNumber: index + 1, fileName: file?.name || '' };
    const label = `第 ${index + 1} 个文件“${file?.name || '未命名文件'}”`;
    if (!(file instanceof Blob) || !file.size) {
      throw pdfExportError(`${label}不是有效文件。`, 'invalid-file', 'PDFInputError', detail);
    }
    const isPdf = pdfIsPdfEntry(entry);
    if (isPdf && ((entry?.rotation ?? 0) !== 0 || entry?.crop)) {
      throw pdfExportError(`${label}是 PDF，请保留原始页面后导出。`, 'unsupported-pdf-edit', 'PDFInputError', detail);
    }
    try {
      const input = isPdf ? file : await buildImagePdf([entry], { ...options, onProgress: () => {} });
      pdfCheckAbort(signal);
      const bytes = await input.arrayBuffer();
      pdfCheckAbort(signal);
      const source = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
      pdfCheckAbort(signal);
      if (isPdf) pdfPrepareImportedForm(source, label, detail, signal);
      const pageIndices = source.getPageIndices();
      if (!pageIndices.length) throw new Error('PDF has no pages');
      const pages = await output.copyPages(source, pageIndices);
      for (const page of pages) {
        await new Promise(resolve => setTimeout(resolve, 0));
        pdfCheckAbort(signal);
        output.addPage(page);
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (error.name?.startsWith('PDF')) {
        if (!isPdf) {
          error.detail = { ...error.detail, ...detail };
          error.message = error.message.replace(/^第 1 张图片/, `第 ${index + 1} 个文件`);
        }
        throw error;
      }
      const encrypted = /encrypt|password/i.test(error.message || '');
      throw pdfExportError(encrypted
        ? `${label}有密码保护，请先使用无密码的 PDF。`
        : `${label}无法读取或合并，请确认 PDF 文件完整并能正常打开。`,
      encrypted ? 'encrypted-pdf' : 'invalid-pdf', 'PDFInputError', detail);
    }
    onProgress(index + 1, entries.length, { pagesCompleted: output.getPageCount() });
  }
  pdfCheckAbort(signal);
  const bytes = await output.save({ objectsPerTick: 25 });
  pdfCheckAbort(signal);
  if (bytes.byteLength > 512 * 1024 * 1024) {
    throw pdfExportError('生成的 PDF 将超过 512 MB。请减少文件数量后分批导出。', 'output-size-limit', 'PDFLimitError');
  }
  return new Blob([bytes], { type: 'application/pdf' });
}

function pdfPrepareImportedForm(source, label, detail, signal) {
  const { PDFName } = globalThis.PDFLib;
  if (!source.catalog.get(PDFName.of('AcroForm'))) return;
  const unsupported = () => pdfExportError(
    `${label}含有无法保留显示效果的表单，请先将原文件另存或打印为普通 PDF 后重试。`,
    'unsupported-pdf-form', 'PDFInputError', detail);
  try {
    const dictionary = source.catalog.lookup(PDFName.of('AcroForm'));
    if (dictionary.has(PDFName.of('XFA'))) throw unsupported();
    const form = source.getForm();
    const fields = form.getFields();
    if (!fields.length) return;
    for (const field of fields) {
      pdfCheckAbort(signal);
      const widgets = field.acroField.getWidgets();
      const visible = widgets.filter(widget => {
        const rectangle = widget.getRectangle();
        // Hidden and NoView widgets do not draw on the page.
        return rectangle.width > 0 && rectangle.height > 0 && !(widget.getFlags() & (2 | 32));
      });
      if (!visible.length) {
        // removeField() requires an appearance even for zero-size signatures.
        const references = [field.ref, ...widgets.map(widget => source.context.getObjectRef(widget.dict)).filter(Boolean)];
        for (const page of source.getPages()) {
          for (const reference of references) page.node.removeAnnot(reference);
        }
        form.acroForm.removeField(field.acroField);
      } else {
        if (visible.length !== widgets.length) throw unsupported();
        for (const widget of visible) {
          if (!widget.getNormalAppearance()) throw unsupported();
          const reference = form.findWidgetAppearanceRef(field, widget);
          const appearance = source.context.lookup(reference);
          const box = appearance.dict.lookup(PDFName.of('BBox')).asRectangle();
          const rectangle = widget.getRectangle();
          const matrix = appearance.dict.lookup(PDFName.of('Matrix'));
          const expectedMatrix = [1, 0, 0, 1, 0, 0];
          const normalMatrix = !matrix || (matrix.size() === 6 && expectedMatrix.every(
            (value, index) => Math.abs(matrix.get(index).asNumber() - value) < 1e-6));
          // pdf-lib flatten draws the AP at unit scale, so reject APs that need
          // a separate bounding-box transformation to match the widget rectangle.
          if (!normalMatrix || Math.abs(box.x) > 1e-6 || Math.abs(box.y) > 1e-6 ||
              Math.abs(box.width - rectangle.width) > 1e-4 || Math.abs(box.height - rectangle.height) > 1e-4) {
            throw unsupported();
          }
          const defaultResources = dictionary.get(PDFName.of('DR'));
          if (!appearance.dict.get(PDFName.of('Resources')) && defaultResources) {
            appearance.dict.set(PDFName.of('Resources'), defaultResources);
          }
        }
      }
    }
    // Use existing appearances. Regeneration could change values, fonts or layout.
    form.flatten({ updateFieldAppearances: false });
  } catch (error) {
    if (error.name === 'AbortError' || error.detail?.code === 'unsupported-pdf-form') throw error;
    const failure = unsupported();
    failure.cause = error;
    throw failure;
  }
}

function pdfExportError(message, code, name = 'PDFInputError', detail = {}) {
  const error = new Error(message);
  error.name = name;
  error.detail = { ...detail, code };
  return error;
}

function pdfCheckAbort(signal) {
  if (signal?.aborted) throw new DOMException('已取消导出。', 'AbortError');
}

function pdfValidateCrop(crop, label, detail) {
  if (crop === undefined || crop === null) return null;
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (!values.every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
      crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9) {
    throw pdfExportError(`${label}的裁剪区域无效，请重新框选图片内的区域。`, 'invalid-crop', 'PDFInputError', detail);
  }
  if (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1) return null;
  return { x: crop.x, y: crop.y, width: Math.min(crop.width, 1 - crop.x), height: Math.min(crop.height, 1 - crop.y) };
}

function pdfCropPixels(crop, width, height, label, detail) {
  if (!crop) return { x: 0, y: 0, width, height };
  const x = Math.round(crop.x * width);
  const y = Math.round(crop.y * height);
  const right = Math.round((crop.x + crop.width) * width);
  const bottom = Math.round((crop.y + crop.height) * height);
  if (right <= x || bottom <= y) {
    throw pdfExportError(`${label}的裁剪区域不足一个像素，请扩大裁剪区域。`, 'crop-too-small', 'PDFInputError', detail);
  }
  return { x, y, width: right - x, height: bottom - y };
}

async function pdfDecodeImage(file, signal) {
  pdfCheckAbort(signal);
  let bitmap;
  let image;
  let imageUrl;
  const close = () => {
    bitmap?.close();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (image) image.src = '';
  };
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } else {
      imageUrl = URL.createObjectURL(file);
      image = new Image();
      image.src = imageUrl;
      await image.decode();
    }
    pdfCheckAbort(signal);
    const source = bitmap || image;
    const width = bitmap ? bitmap.width : image.naturalWidth;
    const height = bitmap ? bitmap.height : image.naturalHeight;
    if (!width || !height) throw new Error('Invalid image dimensions');
    return { source, width, height, close };
  } catch (error) {
    close();
    throw error;
  }
}

function pdfRotationMatrix(rotation, width, height) {
  switch (rotation) {
    case 90: return [0, 1, -1, 0, height, 0];
    case 180: return [-1, 0, 0, -1, width, height];
    case 270: return [0, -1, 1, 0, 0, width];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

async function pdfRasterizeImage(source, crop, rotation, strip, qualityMode, signal) {
  pdfCheckAbort(signal);
  const settings = {
    balanced: { quality: 0.94, edge: 4096, pixels: 12_000_000 },
    original: { quality: 0.94, edge: Infinity, pixels: Infinity },
    small: { quality: 0.75, edge: 2048, pixels: 4_000_000 },
  }[qualityMode];
  const scale = Math.min(1, settings.edge / Math.max(strip.width, strip.height), Math.sqrt(settings.pixels / (strip.width * strip.height)));
  const rasterWidth = Math.max(1, Math.round(strip.width * scale));
  const rasterHeight = Math.max(1, Math.round(strip.height * scale));
  const canvas = document.createElement('canvas');
  try {
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, rasterWidth, rasterHeight);
    context.imageSmoothingQuality = 'high';
    context.scale(rasterWidth / strip.width, rasterHeight / strip.height);
    context.translate(0, -strip.top);
    context.transform(...pdfRotationMatrix(rotation, crop.width, crop.height));
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    pdfCheckAbort(signal);
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', settings.quality));
    pdfCheckAbort(signal);
    if (!jpeg || jpeg.type !== 'image/jpeg') throw new Error('JPEG encoding failed');
    return { width: strip.width, height: strip.height, rasterWidth, rasterHeight, jpeg };
  } finally {
    canvas.width = canvas.height = 1;
  }
}

async function pdfReadDirectJpeg(file, rotation, signal) {
  pdfCheckAbort(signal);
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  pdfCheckAbort(signal);
  if (signature[0] !== 0xff || signature[1] !== 0xd8) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  pdfCheckAbort(signal);
  const metadata = pdfJpegMetadata(bytes);
  if (!metadata) return null;
  const exifSwap = metadata.orientation >= 5;
  const orientedWidth = exifSwap ? metadata.height : metadata.width;
  const orientedHeight = exifSwap ? metadata.width : metadata.height;
  const userSwap = rotation % 180 !== 0;
  return {
    jpeg: file,
    rasterWidth: metadata.width,
    rasterHeight: metadata.height,
    width: userSwap ? orientedHeight : orientedWidth,
    height: userSwap ? orientedWidth : orientedHeight,
    colorSpace: metadata.channels === 1 ? 'DeviceGray' : 'DeviceRGB',
    direct: true,
    orientation: metadata.orientation,
    rotation,
    orientedWidth,
    orientedHeight,
  };
}

function pdfJpegMetadata(bytes) {
  if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let position = 2;
  let metadata;
  let orientation = 1;
  while (position + 4 <= bytes.length) {
    if (bytes[position++] !== 0xff) return null;
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xd9) return null;
    if (position + 2 > bytes.length) return null;
    const length = bytes[position] * 256 + bytes[position + 1];
    if (length < 2 || position + length > bytes.length) return null;
    // The direct stream uses DeviceRGB/DeviceGray, so let the browser convert
    // JPEGs carrying an ICC profile into the canvas's default sRGB color space.
    if (marker === 0xe2 && length >= 14 &&
        String.fromCharCode(...bytes.subarray(position + 2, position + 14)) === 'ICC_PROFILE\0') return null;
    if (marker === 0xe1) orientation = pdfExifOrientation(bytes.subarray(position + 2, position + length)) || orientation;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return null;
      const bits = bytes[position + 2];
      const height = bytes[position + 3] * 256 + bytes[position + 4];
      const width = bytes[position + 5] * 256 + bytes[position + 6];
      const channels = bytes[position + 7];
      if (bits !== 8 || ![1, 3].includes(channels) || !width || !height || length < 8 + channels * 3) return null;
      metadata = { width, height, channels };
    }
    if (marker === 0xda) return metadata ? { ...metadata, orientation } : null;
    position += length;
  }
  return null;
}

function pdfExifOrientation(segment) {
  if (segment.length < 14 || String.fromCharCode(...segment.subarray(0, 6)) !== 'Exif\0\0') return null;
  const view = new DataView(segment.buffer, segment.byteOffset + 6, segment.byteLength - 6);
  const byteOrder = view.getUint16(0);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const littleEndian = byteOrder === 0x4949;
  if (view.getUint16(2, littleEndian) !== 42) return null;
  const offset = view.getUint32(4, littleEndian);
  if (offset < 8 || offset + 2 > view.byteLength) return null;
  const count = view.getUint16(offset, littleEndian);
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    if (view.getUint16(entry, littleEndian) === 274 && view.getUint16(entry + 2, littleEndian) === 3 &&
        view.getUint32(entry + 4, littleEndian) === 1) {
      const value = view.getUint16(entry + 8, littleEndian);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function pdfImageMatrix(image, placement, strip) {
  if (!image.direct) return [placement.drawWidth, 0, 0, placement.drawHeight, placement.x, placement.y];
  const w = image.rasterWidth;
  const h = image.rasterHeight;
  const exifMatrices = [
    null,
    [1, 0, 0, 1, 0, 0],
    [-1, 0, 0, 1, w, 0],
    [-1, 0, 0, -1, w, h],
    [1, 0, 0, -1, 0, h],
    [0, 1, 1, 0, 0, 0],
    [0, 1, -1, 0, h, 0],
    [0, -1, -1, 0, h, w],
    [0, -1, 1, 0, 0, w],
  ];
  const exif = exifMatrices[image.orientation];
  const user = pdfRotationMatrix(image.rotation, image.orientedWidth, image.orientedHeight);
  const point = (x, y) => {
    const correctedX = exif[0] * x + exif[2] * y + exif[4];
    const correctedY = exif[1] * x + exif[3] * y + exif[5];
    const rotatedX = user[0] * correctedX + user[2] * correctedY + user[4];
    const rotatedY = user[1] * correctedX + user[3] * correctedY + user[5];
    return [
      placement.x + rotatedX * placement.drawWidth / image.width,
      placement.y + placement.drawHeight - (rotatedY - strip.top) * placement.drawHeight / strip.height,
    ];
  };
  const origin = point(0, h);
  const right = point(w, h);
  const top = point(0, 0);
  return [right[0] - origin[0], right[1] - origin[1], top[0] - origin[0], top[1] - origin[1], ...origin];
}

function pdfImagePlacement(image, mode) {
  if (mode === 'image') {
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
  const scale = Math.min((width - 48) / image.width, (height - 48) / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  return { width, height, x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, drawWidth, drawHeight };
}

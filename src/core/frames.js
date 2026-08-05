import JSZip from 'jszip';
import { project, IMG_RE, naturalSort, shotKeyOf, deriveBaseName, computeShots } from './model.js';

const THUMB_W = 152, THUMB_H = 88;
const TINY_W = 48, TINY_H = 27;

export async function loadFromFiles(fileList, { preserve = false } = {}) {
  const files = [...fileList].filter((f) => IMG_RE.test(f.name)).sort((a, b) => naturalSort(a.name, b.name));
  if (!files.length) throw new Error('No image files found.');
  const items = files.map((f) => ({ name: f.name, blob: f }));
  return ingest(items, 'files', files[0].name, null, preserve);
}

export async function loadFromZip(file, { preserve = false } = {}) {
  const zip = await JSZip.loadAsync(file);
  const entries = [];
  zip.forEach((path, entry) => {
    const leaf = path.split('/').pop();
    if (!entry.dir && IMG_RE.test(path) && !leaf.startsWith('.')) entries.push(entry);
  });
  if (!entries.length) throw new Error('No images inside that zip.');
  entries.sort((a, b) => naturalSort(a.name, b.name));
  const items = [];
  for (const e of entries) items.push({ name: e.name.split('/').pop(), blob: await e.async('blob') });
  return ingest(items, 'zip', items[0].name, file.name, preserve);
}

// items: [{ name, blob }]
async function ingest(items, source, firstName, zipName, preserve, onProgress) {
  const p = project;
  p.frames.forEach((f) => f.url && f.url.startsWith('blob:') && URL.revokeObjectURL(f.url));
  p.frames = [];
  p.diffs = [];
  p.frameKeys = [];
  if (!preserve) {
    p.manualAdd.clear(); p.manualRemove.clear(); p.meta.clear();
  }
  p.source = source;
  if (!preserve) p.baseName = deriveBaseName(source, firstName, zipName);

  const tiny = document.createElement('canvas');
  tiny.width = TINY_W; tiny.height = TINY_H;
  const tctx = tiny.getContext('2d', { willReadFrequently: true });

  for (let i = 0; i < items.length; i++) {
    const { name, blob } = items[i];
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url).catch(() => null);
    if (!img) { URL.revokeObjectURL(url); continue; }

    const thumb = document.createElement('canvas');
    thumb.width = THUMB_W; thumb.height = THUMB_H;
    drawCover(thumb.getContext('2d'), img, THUMB_W, THUMB_H);

    tctx.drawImage(img, 0, 0, TINY_W, TINY_H);
    const px = tctx.getImageData(0, 0, TINY_W, TINY_H).data;
    const luma = new Uint8ClampedArray(TINY_W * TINY_H);
    for (let s = 0, q = 0; s < px.length; s += 4, q++) {
      luma[q] = (px[s] * 0.299 + px[s + 1] * 0.587 + px[s + 2] * 0.114) | 0;
    }

    p.frames.push({ index: p.frames.length, name, url, thumb, full: blob, luma });
    if (onProgress && i % 4 === 0) onProgress(i + 1, items.length);
  }

  p.diffs = p.frames.map((f, i) => {
    if (i === 0) return 0;
    const a = p.frames[i - 1].luma, b = f.luma;
    let sum = 0;
    for (let k = 0; k < a.length; k++) sum += Math.abs(a[k] - b[k]);
    return sum / a.length / 2.55;
  });

  p.frameKeys = p.frames.map((f) => shotKeyOf(f.name));
  const named = p.frameKeys.filter(Boolean).length;
  const distinct = new Set(p.frameKeys.filter(Boolean)).size;
  p.hasNamePattern = named >= p.frames.length * 0.8 && distinct >= 1;
  if (!preserve) p.groupMode = p.hasNamePattern ? 'name' : 'cuts';
  else if (p.groupMode === 'name' && !p.hasNamePattern) p.groupMode = 'cuts';

  computeShots(p);
  return p;
}

export function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

function drawCover(ctx, img, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const dw = img.width * r, dh = img.height * r;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

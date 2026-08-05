import { project as P, computeShots } from '../core/model.js';
import { blobToBase64, base64ToBlob, download } from './base64.js';
import { loadImage } from '../core/frames.js';

const THUMB_W = 152, THUMB_H = 88;

// Serialize the whole editable project (full-res boards + audio + all state).
export async function saveWorkFile(onProgress) {
  const frames = [];
  for (let i = 0; i < P.frames.length; i++) {
    const f = P.frames[i];
    const type = f.full?.type || 'image/png';
    frames.push({ index: f.index, name: f.name, type, data: await blobToBase64(f.full) });
    if (onProgress && i % 3 === 0) onProgress(i + 1, P.frames.length, 'saving');
  }
  let audio = null;
  if (P.audio && P.audio.blob) {
    audio = {
      name: P.audio.name,
      type: P.audio.blob.type || 'audio/mpeg',
      offsetSec: P.audio.offsetSec || 0,
      inSec: P.audio.inSec ?? null,
      outSec: P.audio.outSec ?? null,
      data: await blobToBase64(P.audio.blob),
    };
  }
  const doc = {
    app: 'animatic-work', version: 1,
    savedAt: new Date().toISOString(),
    baseName: P.baseName,
    fps: P.fps, threshold: P.threshold, groupMode: P.groupMode,
    hasNamePattern: P.hasNamePattern, lenUnit: P.lenUnit, spotSeconds: P.spotSeconds,
    falloffReach: P.falloffReach,
    stages: P.stages,
    frameKeys: P.frameKeys,
    diffs: P.diffs.map((d) => Math.round(d * 100) / 100),
    manualAdd: [...P.manualAdd], manualRemove: [...P.manualRemove],
    meta: [...P.meta.entries()],
    boardDur: [...P.boardDur.entries()],
    boardDisabled: [...P.boardDisabled],
    shotDisabled: [...P.shotDisabled],
    pinned: [...P.pinned],
    audio,
    frames,
  };
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  download(blob, `${P.baseName}_work.animatic.json`);
}

// Restore a project from a work file, rebuilding thumbnails from the full-res data.
export async function openWorkFile(file, onProgress) {
  const doc = JSON.parse(await file.text());
  if (doc.app !== 'animatic-work') throw new Error('Not an Animatic work file.');

  // wipe current session
  P.frames.forEach((f) => f.url && f.url.startsWith('blob:') && URL.revokeObjectURL(f.url));
  if (P.audio?.url) URL.revokeObjectURL(P.audio.url);

  P.baseName = doc.baseName || 'sequence';
  P.fps = doc.fps || 24;
  P.threshold = doc.threshold ?? 14;
  P.groupMode = doc.groupMode || 'cuts';
  P.hasNamePattern = !!doc.hasNamePattern;
  P.lenUnit = doc.lenUnit || 'sec';
  P.spotSeconds = doc.spotSeconds || 30;
  P.falloffReach = doc.falloffReach || 3;
  P.stages = doc.stages || ['previs', 'anim', 'light', 'comp'];
  P.frameKeys = doc.frameKeys || [];
  P.diffs = doc.diffs || [];
  P.manualAdd = new Set(doc.manualAdd || []);
  P.manualRemove = new Set(doc.manualRemove || []);
  P.meta = new Map(doc.meta || []);
  P.boardDur = new Map(doc.boardDur || []);
  P.boardDisabled = new Set(doc.boardDisabled || []);
  P.shotDisabled = new Set(doc.shotDisabled || []);
  P.pinned = new Set(doc.pinned || []);
  P.source = 'workfile';

  P.audio = null;
  if (doc.audio) {
    const blob = base64ToBlob(doc.audio.data, doc.audio.type);
    P.audio = {
      name: doc.audio.name, blob, url: URL.createObjectURL(blob),
      offsetSec: doc.audio.offsetSec || 0,
      inSec: doc.audio.inSec ?? null, outSec: doc.audio.outSec ?? null,
    };
  }

  P.frames = [];
  const list = doc.frames || [];
  for (let i = 0; i < list.length; i++) {
    const fr = list[i];
    const blob = base64ToBlob(fr.data, fr.type || 'image/png');
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url).catch(() => null);
    const thumb = document.createElement('canvas');
    thumb.width = THUMB_W; thumb.height = THUMB_H;
    if (img) {
      const r = Math.max(THUMB_W / img.width, THUMB_H / img.height);
      const dw = img.width * r, dh = img.height * r;
      thumb.getContext('2d').drawImage(img, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2, dw, dh);
    }
    P.frames.push({ index: fr.index ?? i, name: fr.name, url, thumb, full: blob });
    if (onProgress && i % 3 === 0) onProgress(i + 1, list.length, 'opening');
  }

  computeShots(P);
  return P;
}

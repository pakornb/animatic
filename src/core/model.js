// Central project state + pure helpers shared by editor and viewer.

export const project = {
  frames: [],          // { index, name, url, thumb(canvas), full(Blob|null) }
  frameKeys: [],       // per-frame filename shot key (or null)
  diffs: [],           // frame-to-frame visual change 0..100
  hasNamePattern: false,
  groupMode: 'cuts',   // 'cuts' | 'name'
  threshold: 14,
  fps: 24,
  lenUnit: 'sec',      // 'sec' | 'frames'
  spotSeconds: 30,
  manualAdd: new Set(),   // filenames of forced shot starts
  manualRemove: new Set(),// filenames of removed boundaries
  meta: new Map(),        // startFilename -> { tag, note, len(seconds) }
  boardWeights: new Map(),// filename -> weight (default 1) within its shot
  boardDisabled: new Set(),// filenames of disabled boards
  shotDisabled: new Set(),// shot ids (name key or start filename) that are cut
  stages: ['previs', 'anim', 'light', 'comp'],
  baseName: 'sequence',   // derived from first file / zip name
  source: null,           // 'files' | 'zip' | 'workfile'
  audio: null,            // { name, blob, url, offsetSec, inSec, outSec } | null
  shots: [],              // computed: { start, end, count, name }
  cuts: new Set(),        // computed shot-start indices
};

export const IMG_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// MCDS_10_001.png -> "MCDS_10"  (drop extension + trailing frame counter)
export function shotKeyOf(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const nums = base.match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  const last = nums[nums.length - 1];
  const idx = base.lastIndexOf(last);
  return base.slice(0, idx).replace(/[_\-.\s]+$/, '') || null;
}

// A friendly base name for exports: zip stem, or first image stem without the counter.
export function deriveBaseName(source, firstName, zipName) {
  if (source === 'zip' && zipName) return zipName.replace(/\.zip$/i, '') || 'sequence';
  if (!firstName) return 'sequence';
  const stem = firstName.replace(/\.[^.]+$/, '');
  const key = shotKeyOf(firstName);
  if (key) {
    // strip the shot number too so MCDS_10_001 -> MCDS
    const m = key.match(/^(.*?)[_\-.\s]*\d+$/);
    return (m && m[1]) || key;
  }
  return stem.replace(/[_\-.\s]*\d+$/, '') || stem || 'sequence';
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function fmtTC(frame, fps) {
  const f = ((frame % fps) + fps) % fps;
  const t = Math.floor(frame / fps);
  const s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(f)}`;
}

export function fmtClock(sec) {
  const s = Math.max(0, sec);
  const whole = Math.floor(s);
  const cs = Math.round((s - whole) * 100);
  const m = Math.floor(whole / 60), r = whole % 60;
  return `${m}:${pad2(r)}.${pad2(cs)}`;
}

// ---- shot computation (filename grouping OR diff cuts, plus manual overrides) ----
function nameBoundaries(p) {
  const b = new Set([0]);
  for (let i = 1; i < p.frames.length; i++) if (p.frameKeys[i] !== p.frameKeys[i - 1]) b.add(i);
  return b;
}

export function computeShots(p = project) {
  const idx = new Map();
  p.frames.forEach((f, i) => idx.set(f.name, i));
  let starts;
  if (p.groupMode === 'name' && p.hasNamePattern) {
    starts = nameBoundaries(p);
  } else {
    starts = new Set([0]);
    for (let i = 1; i < p.diffs.length; i++) if (p.diffs[i] >= p.threshold) starts.add(i);
  }
  for (const fn of p.manualAdd) { const i = idx.get(fn); if (i > 0) starts.add(i); }
  for (const fn of p.manualRemove) { const i = idx.get(fn); if (i > 0) starts.delete(i); }
  starts.add(0);

  const ordered = [...starts].sort((a, b) => a - b);
  const shots = [];
  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i];
    const end = i + 1 < ordered.length ? ordered[i + 1] - 1 : p.frames.length - 1;
    shots.push({ start, end, count: end - start + 1, name: p.frameKeys[start] || '' });
  }
  p.cuts = starts;
  p.shots = shots;
  return shots;
}

export function shotMeta(p, sh) {
  return p.meta.get(p.frames[sh.start].name) || { tag: '', note: '', len: null };
}
export function setShotMeta(p, sh, key, val) {
  const fn = p.frames[sh.start].name;
  const m = p.meta.get(fn) || { tag: '', note: '', len: null };
  m[key] = val;
  p.meta.set(fn, m);
}

export function shotId(p, sh) { return sh.name || p.frames[sh.start].name; }
export function isShotDisabled(p, sh) { return p.shotDisabled.has(shotId(p, sh)); }
export function isBoardDisabled(p, fi) { return p.boardDisabled.has(p.frames[fi].name); }
export function boardWeight(p, fi) {
  const w = p.boardWeights.get(p.frames[fi].name);
  return w == null || w <= 0 ? 1 : w;
}
export function enabledBoards(p, sh) {
  if (isShotDisabled(p, sh)) return [];
  const out = [];
  for (let f = sh.start; f <= sh.end; f++) if (!isBoardDisabled(p, f)) out.push(f);
  return out;
}

export function lenToUnit(p, sec) {
  return p.lenUnit === 'frames' ? Math.round(sec * p.fps) : Math.round(sec * 100) / 100;
}
export function unitToSec(p, v) {
  return p.lenUnit === 'frames' ? v / p.fps : v;
}

// A shot's total on-screen seconds: manual override, else enabled-board count / fps.
export function shotLenSec(p, sh) {
  const m = shotMeta(p, sh);
  if (m.len != null) return m.len;
  return enabledBoards(p, sh).length / p.fps;
}

// Fit-to-spot across ENABLED shots; fills only shots without a manual length,
// then normalizes so the whole spot lands exactly on target.
export function autoEstimate(p = project, { minSec = 0.5 } = {}) {
  const active = p.shots.filter((sh) => enabledBoards(p, sh).length > 0);
  const unset = [];
  let lockedTotal = 0;
  for (const sh of active) {
    const m = shotMeta(p, sh);
    if (m.len != null) lockedTotal += m.len; else unset.push(sh);
  }
  if (!unset.length) {
    const t = active.reduce((s, sh) => s + shotLenSec(p, sh), 0);
    return { filled: 0, total: t, over: t - p.spotSeconds };
  }
  let budget = p.spotSeconds - lockedTotal;
  if (budget <= 0) budget = 0;
  let floor = minSec;
  if (unset.length * floor > budget && budget > 0) floor = budget / unset.length;
  const weightTotal = unset.reduce((s, sh) => s + enabledBoards(p, sh).length, 0) || unset.length;
  const raw = unset.map((sh) => Math.max(floor, budget * (enabledBoards(p, sh).length / weightTotal)));
  const rawSum = raw.reduce((a, b) => a + b, 0) || 1;
  unset.forEach((sh, i) => {
    const len = budget > 0 ? (raw[i] / rawSum) * budget : floor;
    setShotMeta(p, sh, 'len', Math.round(len * 1000) / 1000);
  });
  const total = active.reduce((s, sh) => s + shotLenSec(p, sh), 0);
  return { filled: unset.length, total, over: total - p.spotSeconds };
}

// Full timeline: per-board placements, shot color spans, collapse markers for
// disabled boards/shots (zero width — no gaps).
export function timeline(p = project) {
  const boards = [];
  const spans = [];
  const markers = [];
  let t = 0, colorIdx = 0;
  p.shots.forEach((sh, si) => {
    if (isShotDisabled(p, sh)) { markers.push({ atSec: t, kind: 'shot', label: shotId(p, sh) }); return; }
    const enabled = enabledBoards(p, sh);
    if (!enabled.length) { markers.push({ atSec: t, kind: 'shot', label: shotId(p, sh) }); return; }
    const shotLen = shotLenSec(p, sh);
    const sumW = enabled.reduce((s, fi) => s + boardWeight(p, fi), 0) || 1;
    const spanStart = t;
    for (let fi = sh.start; fi <= sh.end; fi++) {
      if (isBoardDisabled(p, fi)) { markers.push({ atSec: t, kind: 'board', label: p.frames[fi].name }); continue; }
      const len = shotLen * (boardWeight(p, fi) / sumW);
      boards.push({ fi, startSec: t, len, shotIndex: si });
      t += len;
    }
    spans.push({ shotIndex: si, name: sh.name || `S${si + 1}`, startSec: spanStart, len: t - spanStart, colorIdx: colorIdx % 2 });
    colorIdx++;
  });
  return { boards, spans, markers, total: t };
}

// Which board is on screen at global time `sec`.
export function resolveAt(p, sec) {
  const { boards, total } = timeline(p);
  if (!boards.length) return null;
  let b = boards[0];
  for (let i = 0; i < boards.length; i++) { if (boards[i].startSec <= sec + 1e-6) b = boards[i]; else break; }
  return { frame: b.fi, shotIndex: b.shotIndex, startSec: b.startSec, len: b.len, total };
}

// ---- undo/redo snapshot of light state (never the image blobs) ----
export function captureState(p = project) {
  return JSON.stringify({
    groupMode: p.groupMode, threshold: p.threshold, fps: p.fps,
    lenUnit: p.lenUnit, spotSeconds: p.spotSeconds, stages: p.stages,
    manualAdd: [...p.manualAdd], manualRemove: [...p.manualRemove],
    meta: [...p.meta.entries()],
    boardWeights: [...p.boardWeights.entries()],
    boardDisabled: [...p.boardDisabled], shotDisabled: [...p.shotDisabled],
    audio: p.audio ? { offsetSec: p.audio.offsetSec, inSec: p.audio.inSec, outSec: p.audio.outSec } : null,
  });
}
export function applyState(p, snap) {
  const s = JSON.parse(snap);
  p.groupMode = s.groupMode; p.threshold = s.threshold; p.fps = s.fps;
  p.lenUnit = s.lenUnit; p.spotSeconds = s.spotSeconds; p.stages = s.stages || p.stages;
  p.manualAdd = new Set(s.manualAdd); p.manualRemove = new Set(s.manualRemove);
  p.meta = new Map(s.meta);
  p.boardWeights = new Map(s.boardWeights || []);
  p.boardDisabled = new Set(s.boardDisabled || []);
  p.shotDisabled = new Set(s.shotDisabled || []);
  if (p.audio && s.audio) { p.audio.offsetSec = s.audio.offsetSec; p.audio.inSec = s.audio.inSec; p.audio.outSec = s.audio.outSec; }
  computeShots(p);
}

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

export function lenToUnit(p, sec) {
  return p.lenUnit === 'frames' ? Math.round(sec * p.fps) : Math.round(sec * 100) / 100;
}
export function unitToSec(p, v) {
  return p.lenUnit === 'frames' ? v / p.fps : v;
}

// Fit-to-spot: fill only shots WITHOUT a manual length so the WHOLE spot lands
// exactly on target. Locked (manually set) shots are respected; the remaining
// budget is distributed by board weight, floored, then normalized to hit the
// target precisely. If the floor can't fit, it scales the floor down rather
// than overshooting.
export function autoEstimate(p = project, { minSec = 0.5 } = {}) {
  const unset = [];
  let lockedTotal = 0;
  for (const sh of p.shots) {
    const m = shotMeta(p, sh);
    if (m.len != null) lockedTotal += m.len;
    else unset.push(sh);
  }
  if (!unset.length) return { filled: 0, total: lockedTotal, over: lockedTotal - p.spotSeconds };

  let budget = p.spotSeconds - lockedTotal;
  if (budget <= 0) budget = 0; // locked shots already exceed the spot; give unset ~floor
  let floor = minSec;
  if (unset.length * floor > budget && budget > 0) floor = budget / unset.length; // shrink floor to fit

  const weightTotal = unset.reduce((s, sh) => s + sh.count, 0) || unset.length;
  // first pass: weighted with floor
  const raw = unset.map((sh) => Math.max(floor, budget * (sh.count / weightTotal)));
  const rawSum = raw.reduce((a, b) => a + b, 0) || 1;
  // normalize so unset shots sum exactly to the budget
  unset.forEach((sh, i) => {
    const len = budget > 0 ? (raw[i] / rawSum) * budget : floor;
    setShotMeta(p, sh, 'len', Math.round(len * 1000) / 1000);
  });

  let total = 0;
  for (const sh of p.shots) total += shotLenSec(p, sh);
  return { filled: unset.length, total, over: total - p.spotSeconds };
}

// The on-screen length of a shot in seconds (manual override or frame-count default).
export function shotLenSec(p, sh) {
  const m = shotMeta(p, sh);
  return m.len != null ? m.len : sh.count / p.fps;
}

// Cumulative start time (seconds) for each shot, and total.
export function timeline(p = project) {
  let t = 0;
  const rows = p.shots.map((sh) => {
    const len = shotLenSec(p, sh);
    const row = { sh, startSec: t, len };
    t += len;
    return row;
  });
  return { rows, total: t };
}

// Which shot + board is on screen at global time `sec`.
// holdFirst: show only the first board of a multi-board shot (else even slideshow).
export function resolveAt(p, sec, holdFirst = false) {
  const { rows, total } = timeline(p);
  if (!rows.length) return null;
  let idx = 0;
  for (let i = 0; i < rows.length; i++) { if (rows[i].startSec <= sec + 1e-6) idx = i; else break; }
  const row = rows[idx];
  const sh = row.sh;
  let frame = sh.start;
  if (!holdFirst && sh.count > 1 && row.len > 0) {
    const within = clampNum(sec - row.startSec, 0, row.len);
    const b = Math.min(sh.count - 1, Math.floor((within / row.len) * sh.count));
    frame = sh.start + b;
  }
  return { shotIndex: idx, shot: sh, frame, startSec: row.startSec, len: row.len, total };
}

function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }

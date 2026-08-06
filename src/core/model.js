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
  boardWeights: new Map(),// (legacy, unused) filename -> weight
  boardDur: new Map(),    // filename -> on-screen seconds (source of truth for timing)
  boardDisabled: new Set(),// filenames of disabled boards
  shotDisabled: new Set(),// shot ids (name key or start filename) that are cut
  pinned: new Set(),      // filenames whose duration is locked (walls for retime)
  falloffReach: 3,        // base falloff reach in boards (global; Shift doubles it)
  falloffCurve: 'smooth', // 'linear' | 'easeIn' | 'easeOut' | 'smooth'
  stages: ['previs', 'anim', 'light', 'comp'],
  baseName: 'sequence',   // derived from first file / zip name
  resW: 1920, resH: 1080, // spot resolution (largest source image by default)
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
  const cs = Math.max(0, Math.round(sec * 100));
  const c = cs % 100, whole = Math.floor(cs / 100);
  const m = Math.floor(whole / 60), r = whole % 60;
  return `${m}:${pad2(r)}.${pad2(c)}`;
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

export function shotId(p, sh) { return sh.name || p.frames[sh.start].name; }
export function isShotDisabled(p, sh) { return p.shotDisabled.has(shotId(p, sh)); }
export function isBoardDisabled(p, fi) { return p.boardDisabled.has(p.frames[fi].name); }
export function isPinned(p, fi) { return p.pinned.has(p.frames[fi].name); }

export const MIN_DUR = () => 1 / 240; // absolute floor; practical min is ~1 frame

// per-board on-screen duration (source of truth). default = 1 frame.
export function boardDur(p, fi) {
  const d = p.boardDur.get(p.frames[fi].name);
  return d == null || d <= 0 ? 1 / p.fps : d;
}
export function setBoardDur(p, fi, sec) {
  p.boardDur.set(p.frames[fi].name, Math.max(1 / (p.fps * 4), sec));
}

export function enabledBoards(p, sh) {
  if (isShotDisabled(p, sh)) return [];
  const out = [];
  for (let f = sh.start; f <= sh.end; f++) if (!isBoardDisabled(p, f)) out.push(f);
  return out;
}
// flat ordered list of every enabled board index across all enabled shots
export function enabledFlat(p) {
  const out = [];
  p.shots.forEach((sh) => { if (!isShotDisabled(p, sh)) for (let f = sh.start; f <= sh.end; f++) if (!isBoardDisabled(p, f)) out.push(f); });
  return out;
}

export function lenToUnit(p, sec) {
  return p.lenUnit === 'frames' ? Math.round(sec * p.fps) : Math.round(sec * 100) / 100;
}
export function unitToSec(p, v) {
  return p.lenUnit === 'frames' ? v / p.fps : v;
}

// shot length = sum of its enabled boards' durations (derived)
export function shotLenSec(p, sh) {
  return enabledBoards(p, sh).reduce((s, fi) => s + boardDur(p, fi), 0);
}
// meta stays for tag/note/stageVals; len is no longer used for timing
export function shotMeta(p, sh) {
  return p.meta.get(p.frames[sh.start].name) || { tag: '', note: '', len: null };
}
export function setShotMeta(p, sh, key, val) {
  const fn = p.frames[sh.start].name;
  const m = p.meta.get(fn) || { tag: '', note: '', len: null };
  m[key] = val;
  p.meta.set(fn, m);
}

// scale a shot's enabled boards proportionally to a new total length
export function setShotLen(p, sh, sec) {
  const boards = enabledBoards(p, sh);
  if (!boards.length) return;
  const cur = shotLenSec(p, sh) || 1;
  const factor = Math.max(0.01, sec) / cur;
  boards.forEach((fi) => setBoardDur(p, fi, boardDur(p, fi) * factor));
}

export function totalSec(p) { return enabledFlat(p).reduce((s, fi) => s + boardDur(p, fi), 0); }

// Auto-estimate: give every UNPINNED enabled board an equal share of the
// remaining budget (spot − pinned time) so the total hits the spot exactly.
export function autoEstimate(p = project) {
  const flat = enabledFlat(p);
  if (!flat.length) return { filled: 0, total: 0, over: -p.spotSeconds };
  const pinnedTime = flat.filter((fi) => isPinned(p, fi)).reduce((s, fi) => s + boardDur(p, fi), 0);
  const free = flat.filter((fi) => !isPinned(p, fi));
  if (!free.length) return { filled: 0, total: totalSec(p), over: totalSec(p) - p.spotSeconds };
  const per = Math.max(1 / p.fps, (p.spotSeconds - pinnedTime) / free.length);
  free.forEach((fi) => setBoardDur(p, fi, per));
  const total = totalSec(p);
  return { filled: free.length, total, over: total - p.spotSeconds };
}

// Rebalance: scale all UNPINNED boards so the total equals the spot length.
export function rebalance(p = project) {
  const flat = enabledFlat(p);
  const pinnedTime = flat.filter((fi) => isPinned(p, fi)).reduce((s, fi) => s + boardDur(p, fi), 0);
  const free = flat.filter((fi) => !isPinned(p, fi));
  const freeTotal = free.reduce((s, fi) => s + boardDur(p, fi), 0) || 1;
  const target = Math.max(0, p.spotSeconds - pinnedTime);
  const factor = target / freeTotal;
  free.forEach((fi) => setBoardDur(p, fi, boardDur(p, fi) * factor));
  return { total: totalSec(p), over: totalSec(p) - p.spotSeconds };
}

// pin-bounded region [lo,hi] (flat indices) around a set of positions
function regionAround(p, flat, positions) {
  let lo = Math.min(...positions), hi = Math.max(...positions);
  while (lo - 1 >= 0 && !isPinned(p, flat[lo - 1])) lo--;
  while (hi + 1 < flat.length && !isPinned(p, flat[hi + 1])) hi++;
  const leftPin = lo > 0 && isPinned(p, flat[lo - 1]);
  const rightPin = hi < flat.length - 1 && isPinned(p, flat[hi + 1]);
  return { lo, hi, leftPin, rightPin };
}

// normalized falloff weight for distance ratio t in [0,∞), by curve
export function falloffWeight(t, curve = 'smooth') {
  if (t >= 1) return 0;
  const x = 1 - t; // 1 at center → 0 at reach
  switch (curve) {
    case 'linear': return x;
    case 'easeIn': return x * x;            // tight: concentrates near the drag
    case 'easeOut': return 1 - t * t;        // wide: spreads far before dropping
    case 'smooth': default: return x * x * (3 - 2 * x); // smoothstep S-curve
  }
}

// Remove `amount` (if >0) or add `-amount` (if <0) across `targets`, weighted by
// distance from anchorPos with the active easing curve. Returns unabsorbed leftover.
function redistribute(p, targets, amount, anchorPos, flat, reach, curve = p.falloffCurve) {
  let remaining = amount;
  const minD = 1 / p.fps;
  for (let pass = 0; pass < 6 && Math.abs(remaining) > 1e-6; pass++) {
    const pool = targets.filter((b) => (remaining > 0 ? boardDur(p, b) > minD + 1e-9 : true));
    if (!pool.length) break;
    const weights = pool.map((b) => Math.max(0.0001, falloffWeight(Math.abs(flat.indexOf(b) - anchorPos) / (reach + 1), curve)));
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    let done = 0;
    pool.forEach((b, i) => {
      const share = remaining * (weights[i] / wSum);
      const cur = boardDur(p, b);
      let next = cur - share;
      if (next < minD) next = minD;
      done += cur - next;
      setBoardDur(p, b, next);
    });
    remaining -= done;
  }
  return remaining;
}

function slackOf(p, boards) { const minD = 1 / p.fps; return boards.reduce((s, b) => s + Math.max(0, boardDur(p, b) - minD), 0); }

// Vertical retime: set board `fi` to newDur; neighbors flex with falloff, bounded
// by pins. Between two pins the change is capped to the region's slack (no drift).
export function retimeBoard(p, fi, newDur, reach = p.falloffReach) {
  const flat = enabledFlat(p);
  const pos = flat.indexOf(fi);
  if (pos < 0) return 0;
  newDur = Math.max(1 / (p.fps * 4), newDur);
  let delta = newDur - boardDur(p, fi);
  if (Math.abs(delta) < 1e-6) return 0;
  const { lo, hi, leftPin, rightPin } = regionAround(p, flat, [pos]);
  const others = [];
  for (let i = lo; i <= hi; i++) if (i !== pos) others.push(flat[i]);
  if (!others.length) { setBoardDur(p, fi, newDur); return delta; }
  if (delta > 0 && leftPin && rightPin) {           // fully pin-bounded → cap, no ripple
    const slack = slackOf(p, others);
    if (delta > slack) { delta = slack; newDur = boardDur(p, fi) + delta; }
  }
  setBoardDur(p, fi, newDur);
  redistribute(p, others, delta, pos, flat, reach);
  return delta;
}

// Scale a whole selection's durations by `factor`; neighbors absorb the net change.
export function retimeGroup(p, fiList, factor, reach = p.falloffReach) {
  const flat = enabledFlat(p);
  const positions = fiList.map((fi) => flat.indexOf(fi)).filter((i) => i >= 0);
  if (!positions.length) return;
  const { lo, hi } = regionAround(p, flat, positions);
  const sel = new Set(fiList);
  const others = [];
  for (let i = lo; i <= hi; i++) if (!sel.has(flat[i])) others.push(flat[i]);
  let net = 0;
  fiList.forEach((fi) => { const cur = boardDur(p, fi); const nd = Math.max(1 / (p.fps * 4), cur * factor); net += nd - cur; setBoardDur(p, fi, nd); });
  const anchor = positions.reduce((a, b) => a + b, 0) / positions.length;
  if (others.length) redistribute(p, others, net, anchor, flat, reach);
  return net;
}

// Horizontal mushy-offset: slide board `fi` later (d>0) or earlier (d<0) by
// borrowing time ahead and donating behind, with falloff, bounded by pins.
// Board's own duration is unchanged; total stays constant.
export function offsetBoard(p, fi, d, reach = p.falloffReach) {
  const flat = enabledFlat(p);
  const pos = flat.indexOf(fi);
  if (pos < 0 || Math.abs(d) < 1e-6) return 0;
  const { lo, hi } = regionAround(p, flat, [pos]);
  const before = [], after = [];
  for (let i = lo; i <= hi; i++) { if (i < pos) before.push(flat[i]); else if (i > pos) after.push(flat[i]); }
  if (d > 0) { const s = slackOf(p, after); if (d > s) d = s; if (!before.length) d = 0; }
  else { const s = slackOf(p, before); if (-d > s) d = -s; if (!after.length) d = 0; }
  if (Math.abs(d) < 1e-6) return 0;
  // move right by d: compress `after` by d, expand `before` by d
  redistribute(p, after, d, pos, flat, reach);
  redistribute(p, before, -d, pos, flat, reach);
  return d;
}

// Slide a whole selection as a block horizontally: borrow from ahead of the
// block, donate behind, with falloff, bounded by pins. Selection durations hold.
export function offsetGroup(p, fiList, d, reach = p.falloffReach) {
  const flat = enabledFlat(p);
  const positions = fiList.map((fi) => flat.indexOf(fi)).filter((i) => i >= 0);
  if (!positions.length || Math.abs(d) < 1e-6) return 0;
  const minP = Math.min(...positions), maxP = Math.max(...positions);
  const { lo, hi } = regionAround(p, flat, positions);
  const sel = new Set(fiList);
  const before = [], after = [];
  for (let i = lo; i <= hi; i++) { if (sel.has(flat[i])) continue; if (i < minP) before.push(flat[i]); else if (i > maxP) after.push(flat[i]); }
  if (d > 0) { const s = slackOf(p, after); if (d > s) d = s; if (!before.length) d = 0; }
  else { const s = slackOf(p, before); if (-d > s) d = -s; if (!after.length) d = 0; }
  if (Math.abs(d) < 1e-6) return 0;
  const center = (minP + maxP) / 2;
  redistribute(p, after, d, center, flat, reach);
  redistribute(p, before, -d, center, flat, reach);
  return d;
}

// Full timeline: per-board placements, shot spans, collapse markers.
export function timeline(p = project) {
  const boards = [];
  const spans = [];
  const markers = [];
  let t = 0, colorIdx = 0;
  p.shots.forEach((sh, si) => {
    if (isShotDisabled(p, sh)) { markers.push({ atSec: t, kind: 'shot', label: shotId(p, sh) }); return; }
    const enabled = enabledBoards(p, sh);
    if (!enabled.length) { markers.push({ atSec: t, kind: 'shot', label: shotId(p, sh) }); return; }
    const spanStart = t;
    for (let fi = sh.start; fi <= sh.end; fi++) {
      if (isBoardDisabled(p, fi)) { markers.push({ atSec: t, kind: 'board', label: p.frames[fi].name }); continue; }
      const len = boardDur(p, fi);
      boards.push({ fi, startSec: t, len, shotIndex: si, pinned: isPinned(p, fi) });
      t += len;
    }
    spans.push({ shotIndex: si, name: sh.name || `S${si + 1}`, startSec: spanStart, len: t - spanStart, colorIdx: colorIdx % 2 });
    colorIdx++;
  });
  return { boards, spans, markers, total: t };
}

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
    boardDur: [...p.boardDur.entries()],
    boardDisabled: [...p.boardDisabled], shotDisabled: [...p.shotDisabled],
    pinned: [...p.pinned],
    audio: p.audio ? { offsetSec: p.audio.offsetSec, inSec: p.audio.inSec, outSec: p.audio.outSec } : null,
  });
}
export function applyState(p, snap) {
  const s = JSON.parse(snap);
  p.groupMode = s.groupMode; p.threshold = s.threshold; p.fps = s.fps;
  p.lenUnit = s.lenUnit; p.spotSeconds = s.spotSeconds; p.stages = s.stages || p.stages;
  p.manualAdd = new Set(s.manualAdd); p.manualRemove = new Set(s.manualRemove);
  p.meta = new Map(s.meta);
  p.boardDur = new Map(s.boardDur || []);
  p.boardDisabled = new Set(s.boardDisabled || []);
  p.shotDisabled = new Set(s.shotDisabled || []);
  p.pinned = new Set(s.pinned || []);
  if (p.audio && s.audio) { p.audio.offsetSec = s.audio.offsetSec; p.audio.inSec = s.audio.inSec; p.audio.outSec = s.audio.outSec; }
  computeShots(p);
}

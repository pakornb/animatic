import '../style.css';
import {
  project as P, computeShots, timeline, resolveAt, autoEstimate, rebalance,
  retimeBoard, retimeGroup, offsetBoard, offsetGroup, boardDur, setBoardDur, enabledFlat, falloffWeight, fmtClock,
} from '../core/model.js';
import { loadFromFiles, loadFromZip } from '../core/frames.js';
import { saveWorkFile, openWorkFile } from '../io/workfile.js';
import { loadAudioFile, drawWaveform } from '../io/audio.js';
import { renderInspector } from './inspector.js';
import { Transport } from './transport.js';
import { mutate, undo, redo, clearHistory, canUndo, canRedo, beginGesture, commitGesture } from '../core/history.js';

const $ = (id) => document.getElementById(id);
let cur = 0, lastShot = -1, pps = null;
const BOARD_H = 60, RULER_H = 24, SEC_PER_PX = 0.012;
const transport = new Transport(P);
const slotEls = new Map();
let selected = new Set();

function isolationBadge() {
  const el = $('iso'); const ok = self.crossOriginIsolated === true;
  el.textContent = ok ? 'isolated ✓' : 'not isolated';
  el.title = ok ? 'mp4 export will work' : 'mp4 export needs the hosted app';
  el.className = 'iso ' + (ok ? 'ok' : 'warn');
}

// ---------- loading ----------
async function loadImages(files) {
  const arr = [...files]; const zip = arr.find((f) => /\.zip$/i.test(f.name));
  try { overlay('Loading images…'); if (zip) await loadFromZip(zip); else await loadFromFiles(arr); afterLoad(); }
  catch (e) { console.error(e); toast(e.message || 'Load failed'); } finally { overlay(false); }
}
async function openWork(file) {
  try { overlay('Opening work file…'); await openWorkFile(file, (d, t) => overlay(`Opening… ${d}/${t}`)); afterLoad(); }
  catch (e) { console.error(e); toast(e.message || 'Could not open work file'); } finally { overlay(false); }
}
function afterLoad() { clearHistory(); pps = null; selected.clear(); onLoaded(); }
async function saveWork() {
  if (!P.frames.length) return;
  try { overlay('Saving work file…'); await saveWorkFile((d, t) => overlay(`Saving… ${d}/${t}`)); toast('Work file saved'); }
  catch (e) { console.error(e); toast('Save failed'); } finally { overlay(false); }
}

function onLoaded() {
  cur = Math.min(cur, P.frames.length - 1);
  $('loadView').classList.add('hidden');
  $('stage').classList.remove('hidden');
  $('baseName').textContent = P.baseName;
  $('fps').value = P.fps; $('spot').value = P.spotSeconds; $('lenUnit').value = P.lenUnit;
  $('falloff').value = P.falloffReach;
  $('falloffVal') && ($('falloffVal').textContent = P.falloffReach);
  $('falloffCurve').value = P.falloffCurve;
  drawCurvePreview();
  const gm = $('groupMode'); gm.value = P.groupMode;
  gm.options[1].disabled = !P.hasNamePattern;
  gm.options[1].textContent = P.hasNamePattern ? 'filename' : 'filename (none)';
  $('saveBtn').disabled = false;
  transport.mountAudio(); syncAudioUI(); render();
}

// ---------- render ----------
function render() {
  computeShots(P);
  buildTimeline();
  updateInspector();
  updateBudget();
  updatePlayhead(transport.sec);
  refreshUndoButtons();
}
function light() { drawRuler(); positionSlots(); updateBudget(); updatePlayhead(transport.sec); }
function updateInspector() {
  renderInspector($('inspector'), cur, {
    onChange: light, onStructural: render,
    onGoFrame: (i) => { selectSingle(i); },
  });
}
function refreshUndoButtons() { $('undoBtn').disabled = !canUndo(); $('redoBtn').disabled = !canRedo(); }
function boardStartSec(fi) { const b = timeline(P).boards.find((x) => x.fi === fi); return b ? b.startSec : 0; }

function updateBudget() {
  const total = timeline(P).total, over = total - P.spotSeconds, b = $('budget');
  const sign = over > 0.05 ? `+${over.toFixed(2)}s over` : over < -0.05 ? `${Math.abs(over).toFixed(2)}s under` : 'on target';
  b.textContent = `${fmtClock(total)} / ${P.spotSeconds}s · ${sign}`;
  b.className = 'budget ' + (Math.abs(over) <= 0.05 ? 'ok' : over > 0 ? 'over' : 'under');
  $('scrub') && ($('scrub').max = String(Math.max(total, P.spotSeconds)));
}

// ---------- build timeline ----------
function fitPps() { const w = $('timeline').clientWidth - 4 || 800; const st = Math.max(timeline(P).total, P.spotSeconds) || 1; return w / st; }
function innerScaleTotal() { return Math.max(timeline(P).total, P.spotSeconds); }

function buildTimeline() {
  if (pps == null) pps = fitPps();
  const inner = $('tlInner');
  inner.querySelectorAll('.slot, .mk').forEach((n) => n.remove());
  slotEls.clear();
  const ph = $('playhead');
  const { boards, spans, markers } = timeline(P);
  inner.style.width = innerScaleTotal() * pps + 'px';

  const colorOf = new Map(), firstOf = new Map();
  spans.forEach((sp) => { colorOf.set(sp.shotIndex, sp.colorIdx); firstOf.set(sp.shotIndex, sp.name); });
  const seen = new Set(); const boardW = Math.round((BOARD_H * 16) / 9);

  boards.forEach((bd) => {
    const slot = document.createElement('div');
    slot.className = 'slot c' + (colorOf.get(bd.shotIndex) || 0) + (bd.pinned ? ' pinned' : '') + (selected.has(bd.fi) ? ' selected' : '');
    slot.style.left = bd.startSec * pps + 'px';
    slot.style.width = Math.max(2, bd.len * pps) + 'px';
    slot.dataset.fi = bd.fi;
    const stripe = document.createElement('div'); stripe.className = 'stripe';
    if (!seen.has(bd.shotIndex)) { seen.add(bd.shotIndex); const nm = document.createElement('span'); nm.textContent = firstOf.get(bd.shotIndex); stripe.appendChild(nm); }
    stripe.addEventListener('pointerdown', (e) => e.stopPropagation()); // stripe never retimes
    slot.appendChild(stripe);
    const c = document.createElement('canvas'); c.width = boardW; c.height = BOARD_H; c.className = 'bimg';
    c.getContext('2d').drawImage(P.frames[bd.fi].thumb, 0, 0, boardW, BOARD_H);
    slot.appendChild(c);
    if (bd.pinned) { const pb = document.createElement('span'); pb.className = 'pinbadge'; pb.textContent = '📌'; slot.appendChild(pb); }
    attachTile(slot, c, bd.fi);
    inner.insertBefore(slot, ph);
    slotEls.set(bd.fi, slot);
  });

  markers.forEach((mk) => {
    const d = document.createElement('div'); d.className = 'mk ' + mk.kind;
    d.style.left = mk.atSec * pps + 'px';
    d.title = `disabled ${mk.kind}: ${mk.label} — click to re-enable`;
    d.addEventListener('click', (e) => { e.stopPropagation(); mutate(() => { if (mk.kind === 'shot') P.shotDisabled.delete(mk.label); else P.boardDisabled.delete(mk.label); }); render(); });
    inner.insertBefore(d, ph);
  });
  drawRuler();
}
function positionSlots() {
  const { boards } = timeline(P);
  $('tlInner').style.width = innerScaleTotal() * pps + 'px';
  boards.forEach((bd) => { const el = slotEls.get(bd.fi); if (el) { el.style.left = bd.startSec * pps + 'px'; el.style.width = Math.max(2, bd.len * pps) + 'px'; } });
}

function drawRuler() {
  const cv = $('tlRuler');
  const w = innerScaleTotal() * pps;
  cv.width = w; cv.height = RULER_H; cv.style.width = w + 'px';
  const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, w, RULER_H);
  const total = timeline(P).total, spotX = P.spotSeconds * pps, totalX = total * pps;
  // overflow shading beyond the spot
  if (total > P.spotSeconds) { ctx.fillStyle = 'rgba(255,80,80,.10)'; ctx.fillRect(spotX, 0, totalX - spotX, RULER_H); }
  // threshold dashed line
  ctx.strokeStyle = 'rgba(138,146,158,.4)'; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(0, RULER_H * 0.55); ctx.lineTo(w, RULER_H * 0.55); ctx.stroke(); ctx.setLineDash([]);
  // per-board diff bars
  timeline(P).boards.forEach((bd) => {
    const d = P.diffs[bd.fi] || 0;
    const bh = Math.min(RULER_H - 4, (d / 60) * (RULER_H - 4));
    const x = bd.startSec * pps, bw = Math.max(1, bd.len * pps);
    ctx.fillStyle = d >= P.threshold ? 'rgba(255,138,61,.8)' : 'rgba(90,100,114,.7)';
    ctx.fillRect(x, RULER_H - 4 - bh, bw, bh);
  });
  // spot bar (bottom): green 0→spot, red spot→total
  ctx.fillStyle = 'rgba(108,192,112,.9)'; ctx.fillRect(0, RULER_H - 3, Math.min(spotX, totalX), 3);
  if (totalX > spotX) { ctx.fillStyle = 'rgba(255,90,90,.9)'; ctx.fillRect(spotX, RULER_H - 3, totalX - spotX, 3); }
  // start + spot-end ticks
  ctx.fillStyle = 'rgba(108,192,112,1)'; ctx.fillRect(0, 0, 2, RULER_H);
  ctx.fillStyle = 'rgba(255,138,61,.9)'; ctx.fillRect(spotX - 1, 0, 2, RULER_H);
}

// ---------- selection ----------
function selectSingle(fi) { selected = new Set([fi]); cur = fi; transport.seek(boardStartSec(fi)); render(); }
function toggleSel(fi) { if (selected.has(fi)) selected.delete(fi); else selected.add(fi); cur = fi; render(); }

// ---------- tile gestures (axis-locked) ----------
function attachTile(slot, imgCanvas, fi) {
  let downX = 0, downY = 0, axis = null, snap = null, moved = false;
  imgCanvas.addEventListener('pointerdown', (e) => {
    if (e.metaKey || e.ctrlKey) { e.stopPropagation(); toggleSel(fi); return; }
    downX = e.clientX; downY = e.clientY; axis = null; moved = false;
    imgCanvas.setPointerCapture(e.pointerId);
    // materialize all durations so the snapshot is complete/idempotent
    enabledFlat(P).forEach((f) => setBoardDur(P, f, boardDur(P, f)));
    snap = new Map(P.boardDur);
    if (!selected.has(fi)) selected = new Set([fi]);
  });
  imgCanvas.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 || !snap) return;
    const dx = e.clientX - downX, dy = downY - e.clientY;
    if (!axis) { if (Math.max(Math.abs(dx), Math.abs(dy)) > 4) { axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; beginGesture(); slot.classList.add('dragging'); } else return; }
    moved = true;
    P.boardDur = new Map(snap); // restore, apply gesture idempotently
    const reach = P.falloffReach * (e.shiftKey ? 2 : 1);
    if (axis === 'y') {
      const startDur = snap.get(P.frames[fi].name) || boardDur(P, fi);
      const desired = Math.max(1 / (P.fps * 4), startDur + dy * SEC_PER_PX);
      if (selected.size > 1 && selected.has(fi)) retimeGroup(P, [...selected], desired / startDur, reach);
      else retimeBoard(P, fi, desired, reach);
    } else {
      if (selected.size > 1 && selected.has(fi)) offsetGroup(P, [...selected], dx * SEC_PER_PX, reach);
      else offsetBoard(P, fi, dx * SEC_PER_PX, reach);
    }
    computeShots(P); light();
  });
  imgCanvas.addEventListener('pointerup', (e) => {
    imgCanvas.releasePointerCapture?.(e.pointerId);
    slot.classList.remove('dragging');
    if (axis && moved) { commitGesture(); refreshUndoButtons(); render(); }
    else { selectSingle(fi); }
    axis = null; snap = null;
  });
}

// ---------- playback ----------
function onTick(sec, playing) {
  updatePlayhead(sec);
  const r = resolveAt(P, sec);
  if (r) {
    if (P.frames[r.frame]) $('preview').src = P.frames[r.frame].url;
    if (!playing) cur = r.frame;
    if (r.shotIndex !== lastShot) { lastShot = r.shotIndex; if (!playing) updateInspector(); }
    $('previewMeta').textContent = `${P.frames[r.frame].name} · shot ${r.shotIndex + 1}/${P.shots.length}`;
  }
  $('clock').textContent = `${fmtClock(sec)} / ${fmtClock(P.spotSeconds)}`;
  $('playBtn').textContent = playing ? '❚❚' : '▶';
  if (P.audio) drawWaveformLane();
}
function updatePlayhead(sec) {
  $('playhead').style.left = sec * pps + 'px';
  const r = resolveAt(P, sec);
  slotEls.forEach((el, fi) => el.classList.toggle('active', r && fi === r.frame));
  if (transport.playing) keepVisible(sec);
}
function keepVisible(sec) { const sc = $('timeline'), x = sec * pps; if (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - sc.clientWidth * 0.3; }

// ---------- zoom ----------
function setZoom(mult) { const sc = $('timeline'), cs = (sc.scrollLeft + sc.clientWidth / 2) / pps; pps = Math.max(2, Math.min(6000, pps * mult)); buildTimeline(); updatePlayhead(transport.sec); sc.scrollLeft = cs * pps - sc.clientWidth / 2; }
function zoomFit() { pps = fitPps(); buildTimeline(); updatePlayhead(transport.sec); $('timeline').scrollLeft = 0; }

// ---------- audio ----------
async function loadAudio(file) { try { overlay('Decoding audio…'); P.audio = await loadAudioFile(file); transport.mountAudio(); syncAudioUI(); toast('Audio loaded'); } catch (e) { console.error(e); toast('Could not load audio'); } finally { overlay(false); } }
function syncAudioUI() { const has = !!P.audio; $('audioLane').classList.toggle('hidden', !has); $('audioName').textContent = has ? P.audio.name : ''; if (!has) return; drawWaveformLane(); drawSlipReadout(); $('useAudioLen').disabled = !P.audio.duration; }
function drawWaveformLane() { const c = $('wave'); c.width = c.clientWidth || 600; c.height = 44; const a = P.audio; const at = a ? transport.sec - (a.offsetSec || 0) + (a.inSec ?? 0) : null; drawWaveform(c, a, { fps: P.fps, markerSec: at }); }
function drawSlipReadout() { const a = P.audio; if (!a) return; const fr = Math.round((a.offsetSec || 0) * P.fps); $('slipVal').textContent = `offset ${fr >= 0 ? '+' : ''}${fr}f (${fmtClock(Math.abs(a.offsetSec || 0))})`; }
function nudgeSlip(df) { const a = P.audio; if (!a) return; mutate(() => { a.offsetSec = (a.offsetSec || 0) + df / P.fps; }); drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec); refreshUndoButtons(); }
function nudgeSlipSec(d) { const a = P.audio; if (!a) return; mutate(() => { a.offsetSec = (a.offsetSec || 0) + d; }); drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec); refreshUndoButtons(); }
function setSyncToPlayhead() { const a = P.audio; if (!a) return; mutate(() => { a.offsetSec = transport.sec; }); drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec); refreshUndoButtons(); toast('Audio start set to playhead'); }

// ---------- utils ----------
function overlay(msg) { const o = $('overlay'); if (msg === false) { o.classList.add('hidden'); return; } o.querySelector('span').textContent = msg; o.classList.remove('hidden'); }
let toastT; function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2000); }

function boardNav(dir) {
  const flat = enabledFlat(P); const i = flat.indexOf(cur);
  let ni = i < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, i + dir));
  selectSingle(flat[ni]);
}
function shotNav(dir) {
  const si = P.shots.findIndex((s) => cur >= s.start && cur <= s.end); if (si < 0) return;
  let t;
  if (dir > 0) { const n = P.shots[si + 1]; t = n ? n.start : P.frames.length - 1; }
  else { const s = P.shots[si]; if (cur > s.start) t = s.start; else { const pv = P.shots[si - 1]; t = pv ? pv.start : 0; } }
  selectSingle(t);
}
function arrowRetime(dir, big) {
  const step = dir * (1 / P.fps), reach = P.falloffReach * (big ? 2 : 1);
  mutate(() => {
    if (selected.size > 1) { const anchor = [...selected][0]; const d0 = boardDur(P, anchor); retimeGroup(P, [...selected], (d0 + step) / d0, reach); }
    else retimeBoard(P, cur, boardDur(P, cur) + step, reach);
  });
  render();
}
function doUndo() { if (undo()) { render(); onTick(transport.sec, false); toast('Undo'); } }
function doRedo() { if (redo()) { render(); onTick(transport.sec, false); toast('Redo'); } }

function clearSelection() { selected.clear(); render(); }
let marqEl = null, marqX0 = 0;
function clearMarquee() { if (marqEl) { marqEl.remove(); marqEl = null; } }
function drawCurvePreview() {
  const cv = $('curvePrev'); if (!cv) return;
  const w = cv.width = cv.clientWidth || 120, h = cv.height = 34;
  const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(78,168,222,.9)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let i = 0; i <= w; i++) { const t = (i / w); const y = h - 3 - falloffWeight(t, P.falloffCurve) * (h - 6); if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90,100,114,.5)'; ctx.beginPath(); ctx.moveTo(0, h - 3); ctx.lineTo(w, h - 3); ctx.stroke();
}

// ---------- playhead + ruler interactions ----------
function wirePlayheadAndRuler() {
  const grab = $('phGrab');
  let dragging = false;
  const scrubTo = (clientX) => { const sc = $('timeline'); const x = clientX - sc.getBoundingClientRect().left + sc.scrollLeft; let sec = x / pps; sec = Math.round(sec * P.fps) / P.fps; transport.pause(); transport.seek(Math.max(0, sec)); };
  grab.addEventListener('pointerdown', (e) => { dragging = true; grab.setPointerCapture(e.pointerId); e.stopPropagation(); });
  grab.addEventListener('pointermove', (e) => { if (dragging) scrubTo(e.clientX); });
  grab.addEventListener('pointerup', (e) => { dragging = false; grab.releasePointerCapture?.(e.pointerId); });

  const ruler = $('tlRuler');
  ruler.addEventListener('pointerdown', (e) => {
    clearMarquee();
    const sc = $('timeline'); marqX0 = e.clientX - sc.getBoundingClientRect().left + sc.scrollLeft;
    marqEl = document.createElement('div'); marqEl.className = 'marquee'; marqEl.style.left = marqX0 + 'px'; marqEl.style.width = '0px';
    $('tlInner').appendChild(marqEl); ruler.setPointerCapture(e.pointerId);
  });
  ruler.addEventListener('pointermove', (e) => {
    if (!marqEl) return;
    const sc = $('timeline'); const x = e.clientX - sc.getBoundingClientRect().left + sc.scrollLeft;
    marqEl.style.left = Math.min(marqX0, x) + 'px'; marqEl.style.width = Math.abs(x - marqX0) + 'px';
  });
  const finishMarquee = (e) => {
    if (!marqEl) return;
    const sc = $('timeline'); const x = (e && e.clientX != null) ? e.clientX - sc.getBoundingClientRect().left + sc.scrollLeft : marqX0;
    const a = Math.min(marqX0, x) / pps, b = Math.max(marqX0, x) / pps;
    clearMarquee();
    if (Math.abs(b - a) < 0.02) { transport.pause(); transport.seek(Math.round(a * P.fps) / P.fps); return; }
    const sel = new Set(); timeline(P).boards.forEach((bd) => { if (bd.startSec + bd.len > a && bd.startSec < b) sel.add(bd.fi); });
    if (sel.size) { selected = sel; cur = [...sel][0]; render(); toast(`${sel.size} selected`); }
  };
  ruler.addEventListener('pointerup', finishMarquee);
  ruler.addEventListener('pointercancel', clearMarquee);
  ruler.addEventListener('lostpointercapture', () => { if (marqEl) clearMarquee(); });
  window.addEventListener('blur', clearMarquee);
}

// ---------- wire ----------
function wire() {
  isolationBadge();
  transport.onTick = onTick;
  wirePlayheadAndRuler();

  $('pickBtn').onclick = () => $('fileInput').click();
  $('pickZip').onclick = () => $('zipInput').click();
  $('openWorkBtn').onclick = () => $('workInput').click();
  $('openWorkBtn2').onclick = () => $('workInput').click();
  $('fileInput').onchange = (e) => e.target.files.length && loadImages(e.target.files);
  $('zipInput').onchange = (e) => e.target.files.length && loadImages(e.target.files);
  $('workInput').onchange = (e) => e.target.files.length && openWork(e.target.files[0]);
  $('saveBtn').onclick = saveWork;

  $('fps').onchange = (e) => { mutate(() => { P.fps = Math.max(1, +e.target.value || 24); }); render(); };
  $('spot').onchange = (e) => { mutate(() => { P.spotSeconds = Math.max(1, +e.target.value || 30); }); render(); };
  $('lenUnit').onchange = (e) => { P.lenUnit = e.target.value; render(); };
  $('groupMode').onchange = (e) => { mutate(() => { P.groupMode = e.target.value; }); selected.clear(); render(); };
  $('falloff').oninput = (e) => { P.falloffReach = +e.target.value; $('falloffVal').textContent = e.target.value; };
  $('falloffCurve').onchange = (e) => { P.falloffCurve = e.target.value; drawCurvePreview(); };
  $('clearSelBtn').onclick = clearSelection;
  $('autoBtn').onclick = () => { mutate(() => { const r = autoEstimate(P); toast(`Estimated ${r.filled} boards → ${fmtClock(r.total)}`); }); render(); };
  $('rebalBtn').onclick = () => { mutate(() => { const r = rebalance(P); toast(`Rebalanced → ${fmtClock(r.total)}`); }); render(); };

  $('undoBtn').onclick = doUndo; $('redoBtn').onclick = doRedo;
  $('helpBtn').onclick = () => $('helpPop').classList.toggle('hidden');
  document.addEventListener('click', (e) => { if (!e.target.closest('#helpBtn, #helpPop')) $('helpPop').classList.add('hidden'); });
  $('zoomIn').onclick = () => setZoom(1.6); $('zoomOut').onclick = () => setZoom(1 / 1.6); $('zoomFit').onclick = zoomFit;

  $('playBtn').onclick = () => transport.toggle();
  $('toStart').onclick = () => transport.seek(0);
  $('toEnd').onclick = () => transport.seek(timeline(P).total);
  $('stepBack').onclick = () => boardNav(-1);
  $('stepFwd').onclick = () => boardNav(1);
  $('prevShot').onclick = () => shotNav(-1);
  $('nextShot').onclick = () => shotNav(1);

  $('loadAudioBtn').onclick = () => $('audioInput').click();
  $('loadAudioBtn0').onclick = () => $('audioInput').click();
  $('audioInput').onchange = (e) => e.target.files.length && loadAudio(e.target.files[0]);
  $('slipMinus1').onclick = () => nudgeSlip(-1); $('slipPlus1').onclick = () => nudgeSlip(1);
  $('slipMinusS').onclick = () => nudgeSlipSec(-0.1); $('slipPlusS').onclick = () => nudgeSlipSec(0.1);
  $('setSync').onclick = setSyncToPlayhead;
  $('useAudioLen').onclick = () => { if (P.audio?.duration) { mutate(() => { P.spotSeconds = Math.round(P.audio.duration * 100) / 100; }); $('spot').value = P.spotSeconds; render(); toast('Spot set to audio length'); } };

  const lane = $('wave'); let adr = false, ax0 = 0, aoff0 = 0;
  lane.addEventListener('pointerdown', (e) => { if (!P.audio) return; adr = true; ax0 = e.clientX; aoff0 = P.audio.offsetSec || 0; lane.setPointerCapture(e.pointerId); beginGesture(); });
  lane.addEventListener('pointermove', (e) => { if (!adr || !P.audio) return; const total = Math.max(timeline(P).total, P.spotSeconds); const spp = total / (lane.clientWidth || 600); let off = aoff0 + (e.clientX - ax0) * spp; off = Math.round(off * P.fps) / P.fps; P.audio.offsetSec = off; drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec); });
  lane.addEventListener('pointerup', () => { if (adr) { adr = false; commitGesture(); refreshUndoButtons(); } });

  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); const d = $('drop'); if (d) d.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; const d = $('drop'); if (d) d.classList.remove('hot'); }));
  document.addEventListener('drop', (e) => { e.preventDefault(); const files = [...e.dataTransfer.files]; if (!files.length) return; const audio = files.find((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f.name)); const work = files.find((f) => /\.json$/i.test(f.name)); if (audio && P.frames.length) loadAudio(audio); else if (work && files.length === 1) openWork(work); else loadImages(files); });

  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (typing || !P.frames.length) return;
    const k = e.key;
    if (k === ' ') { if (/button/i.test(e.target.tagName)) return; e.preventDefault(); transport.toggle(); return; }
    if (k === 'Escape') { clearSelection(); return; }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault(); const dir = k === 'ArrowRight' ? 1 : -1;
      if (e.metaKey || e.ctrlKey) transport.seek(dir > 0 ? timeline(P).total : 0);
      else if (e.altKey) shotNav(dir);
      else boardNav(dir);
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault(); arrowRetime(k === 'ArrowUp' ? 1 : -1, e.shiftKey);
    }
  });

  window.addEventListener('resize', () => { if (P.frames.length) { buildTimeline(); updatePlayhead(transport.sec); if (P.audio) drawWaveformLane(); } });
}

wire();

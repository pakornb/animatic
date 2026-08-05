import '../style.css';
import {
  project as P, computeShots, timeline, resolveAt, shotMeta, autoEstimate, rebalance,
  retimeBoard, boardDur, fmtClock,
} from '../core/model.js';
import { loadFromFiles, loadFromZip } from '../core/frames.js';
import { saveWorkFile, openWorkFile } from '../io/workfile.js';
import { loadAudioFile, drawWaveform } from '../io/audio.js';
import { renderInspector } from './inspector.js';
import { Transport } from './transport.js';
import { mutate, undo, redo, clearHistory, canUndo, canRedo, beginGesture, commitGesture } from '../core/history.js';

const $ = (id) => document.getElementById(id);
let cur = 0, lastShot = -1, pps = null;
const BOARD_H = 60, STRIPE_H = 12, SEC_PER_PX = 0.012;
const transport = new Transport(P);
const slotEls = new Map(); // fi -> element

function isolationBadge() {
  const el = $('iso'); const ok = self.crossOriginIsolated === true;
  el.textContent = ok ? 'isolated ✓' : 'not isolated';
  el.title = ok ? 'mp4 export will work' : 'mp4 export needs the hosted app';
  el.className = 'iso ' + (ok ? 'ok' : 'warn');
}

// ---------- loading ----------
async function loadImages(files) {
  const arr = [...files]; const zip = arr.find((f) => /\.zip$/i.test(f.name));
  try { overlay('Loading images…'); if (zip) await loadFromZip(zip); else await loadFromFiles(arr); clearHistory(); pps = null; onLoaded(); }
  catch (e) { console.error(e); toast(e.message || 'Load failed'); } finally { overlay(false); }
}
async function openWork(file) {
  try { overlay('Opening work file…'); await openWorkFile(file, (d, t) => overlay(`Opening… ${d}/${t}`)); clearHistory(); pps = null; onLoaded(); }
  catch (e) { console.error(e); toast(e.message || 'Could not open work file'); } finally { overlay(false); }
}
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
function light() { buildTimeline(); updateBudget(); updatePlayhead(transport.sec); }
function updateInspector() {
  renderInspector($('inspector'), cur, {
    onChange: light, onStructural: render,
    onGoFrame: (i) => { cur = i; transport.seek(boardStartSec(i)); render(); },
  });
}
function refreshUndoButtons() { $('undoBtn').disabled = !canUndo(); $('redoBtn').disabled = !canRedo(); }
function boardStartSec(fi) { const b = timeline(P).boards.find((x) => x.fi === fi); return b ? b.startSec : 0; }

function updateBudget() {
  const total = timeline(P).total;
  const over = total - P.spotSeconds;
  const b = $('budget');
  const sign = over > 0.05 ? `+${over.toFixed(2)}s over` : over < -0.05 ? `${Math.abs(over).toFixed(2)}s under` : 'on target';
  b.textContent = `${fmtClock(total)} / ${P.spotSeconds}s · ${sign}`;
  b.className = 'budget ' + (Math.abs(over) <= 0.05 ? 'ok' : over > 0 ? 'over' : 'under');
  $('stats') && ($('stats').textContent = '');
  $('scrub').max = String(Math.max(total, P.spotSeconds));
}

// ---------- unified board strip ----------
function fitPps() {
  const w = $('timeline').clientWidth - 4 || 800;
  const scaleTotal = Math.max(timeline(P).total, P.spotSeconds) || 1;
  return w / scaleTotal;
}
function buildTimeline() {
  if (pps == null) pps = fitPps();
  const inner = $('tlInner');
  inner.querySelectorAll('.slot, .mk, .target-marker').forEach((n) => n.remove());
  slotEls.clear();
  const ph = $('playhead');
  const { boards, spans, markers, total } = timeline(P);
  const scaleTotal = Math.max(total, P.spotSeconds);
  inner.style.width = scaleTotal * pps + 'px';

  const colorOf = new Map(); const firstOf = new Map();
  spans.forEach((sp) => { colorOf.set(sp.shotIndex, sp.colorIdx); firstOf.set(sp.shotIndex, sp.name); });
  const seenShot = new Set();
  const boardW = Math.round((BOARD_H * 16) / 9);

  boards.forEach((bd) => {
    const slot = document.createElement('div');
    slot.className = 'slot c' + (colorOf.get(bd.shotIndex) || 0) + (bd.pinned ? ' pinned' : '');
    slot.style.left = bd.startSec * pps + 'px';
    slot.style.width = Math.max(2, bd.len * pps) + 'px';
    slot.dataset.fi = bd.fi;
    const stripe = document.createElement('div'); stripe.className = 'stripe';
    if (!seenShot.has(bd.shotIndex)) { seenShot.add(bd.shotIndex); const nm = document.createElement('span'); nm.textContent = firstOf.get(bd.shotIndex); stripe.appendChild(nm); }
    slot.appendChild(stripe);
    const c = document.createElement('canvas'); c.width = boardW; c.height = BOARD_H;
    c.getContext('2d').drawImage(P.frames[bd.fi].thumb, 0, 0, boardW, BOARD_H);
    slot.appendChild(c);
    if (bd.pinned) { const pinb = document.createElement('span'); pinb.className = 'pinbadge'; pinb.textContent = '📌'; slot.appendChild(pinb); }
    slot.title = `${P.frames[bd.fi].name} · ${bd.len.toFixed(2)}s`;
    attachSlotDrag(slot, bd.fi);
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

  const tm = document.createElement('div'); tm.className = 'target-marker';
  tm.style.left = P.spotSeconds * pps + 'px'; tm.title = `${P.spotSeconds}s target`;
  inner.insertBefore(tm, ph);
}

// reposition existing nodes without recreating them (used during retime drag)
function updateGeometry() {
  const { boards, total } = timeline(P);
  const scaleTotal = Math.max(total, P.spotSeconds);
  $('tlInner').style.width = scaleTotal * pps + 'px';
  boards.forEach((bd) => {
    const el = slotEls.get(bd.fi);
    if (el) { el.style.left = bd.startSec * pps + 'px'; el.style.width = Math.max(2, bd.len * pps) + 'px'; el.title = `${P.frames[bd.fi].name} · ${bd.len.toFixed(2)}s`; }
  });
  $('tlInner').querySelector('.target-marker') && ($('tlInner').querySelector('.target-marker').style.left = P.spotSeconds * pps + 'px');
  updateBudget();
  updatePlayhead(transport.sec);
}

// ---------- vertical-drag retime ----------
function attachSlotDrag(slot, fi) {
  let downY = 0, startDur = 0, dragging = false, moved = false;
  slot.addEventListener('pointerdown', (e) => {
    downY = e.clientY; startDur = boardDur(P, fi); dragging = false; moved = false;
    slot.setPointerCapture(e.pointerId);
  });
  slot.addEventListener('pointermove', (e) => {
    if (e.buttons === 0) return;
    const dy = downY - e.clientY;
    if (!dragging && Math.abs(dy) > 4) { dragging = true; beginGesture(); slot.classList.add('dragging'); }
    if (dragging) {
      moved = true;
      const desired = Math.max(1 / (P.fps * 4), startDur + dy * SEC_PER_PX);
      retimeBoard(P, fi, desired);
      updateGeometry();
    }
  });
  slot.addEventListener('pointerup', (e) => {
    slot.releasePointerCapture?.(e.pointerId);
    slot.classList.remove('dragging');
    if (dragging && moved) { commitGesture(); refreshUndoButtons(); render(); }
    else { cur = fi; transport.seek(boardStartSec(fi)); render(); } // treated as click
    dragging = false;
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
  $('scrub').value = String(sec);
  $('playBtn').textContent = playing ? '❚❚' : '▶';
  if (P.audio) drawWaveformLane();
}
function updatePlayhead(sec) {
  $('playhead').style.left = sec * pps + 'px';
  const r = resolveAt(P, sec);
  slotEls.forEach((el, fi) => el.classList.toggle('active', r && fi === r.frame));
  if (transport.playing) keepVisible(sec);
}
function keepVisible(sec) {
  const sc = $('timeline'); const x = sec * pps;
  if (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - sc.clientWidth * 0.3;
}

// ---------- zoom ----------
function setZoom(mult) {
  const sc = $('timeline'); const centerSec = (sc.scrollLeft + sc.clientWidth / 2) / pps;
  pps = Math.max(2, Math.min(6000, pps * mult)); buildTimeline(); updatePlayhead(transport.sec);
  sc.scrollLeft = centerSec * pps - sc.clientWidth / 2;
}
function zoomFit() { pps = fitPps(); buildTimeline(); updatePlayhead(transport.sec); $('timeline').scrollLeft = 0; }

// ---------- audio ----------
async function loadAudio(file) {
  try { overlay('Decoding audio…'); P.audio = await loadAudioFile(file); transport.mountAudio(); syncAudioUI(); toast('Audio loaded'); }
  catch (e) { console.error(e); toast('Could not load audio'); } finally { overlay(false); }
}
function syncAudioUI() {
  const has = !!P.audio; $('audioLane').classList.toggle('hidden', !has);
  $('audioName').textContent = has ? P.audio.name : ''; if (!has) return;
  drawWaveformLane(); drawSlipReadout(); $('useAudioLen').disabled = !P.audio.duration;
}
function drawWaveformLane() {
  const c = $('wave'); c.width = c.clientWidth || 600; c.height = 44;
  const a = P.audio; const at = a ? transport.sec - (a.offsetSec || 0) + (a.inSec ?? 0) : null;
  drawWaveform(c, a, { fps: P.fps, markerSec: at });
}
function drawSlipReadout() { const a = P.audio; if (!a) return; const fr = Math.round((a.offsetSec || 0) * P.fps); $('slipVal').textContent = `offset ${fr >= 0 ? '+' : ''}${fr}f (${fmtClock(Math.abs(a.offsetSec || 0))})`; }
function nudgeSlip(df) { const a = P.audio; if (!a) return; mutate(() => { a.offsetSec = (a.offsetSec || 0) + df / P.fps; }); drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec); refreshUndoButtons(); }
function nudgeSlipSec(d) { const a = P.audio; if (!a) return; mutate(() => { a.offsetSec = (a.offsetSec || 0) + d; }); drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec); refreshUndoButtons(); }
function setSyncToPlayhead() { const a = P.audio; if (!a) return; mutate(() => { a.offsetSec = transport.sec; }); drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec); refreshUndoButtons(); toast('Audio start set to playhead'); }

// ---------- utils ----------
function overlay(msg) { const o = $('overlay'); if (msg === false) { o.classList.add('hidden'); return; } o.querySelector('span').textContent = msg; o.classList.remove('hidden'); }
let toastT; function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2000); }
function jumpShot(dir) {
  const i = P.shots.findIndex((s) => cur >= s.start && cur <= s.end); if (i < 0) return;
  let target;
  if (dir > 0) { const n = P.shots[i + 1]; target = n ? n.start : P.frames.length - 1; }
  else { const s = P.shots[i]; if (cur > s.start) target = s.start; else { const pv = P.shots[i - 1]; target = pv ? pv.start : 0; } }
  cur = target; transport.seek(boardStartSec(target)); render();
}
function doUndo() { if (undo()) { render(); onTick(transport.sec, false); toast('Undo'); } }
function doRedo() { if (redo()) { render(); onTick(transport.sec, false); toast('Redo'); } }

// ---------- wire ----------
function wire() {
  isolationBadge();
  transport.onTick = onTick;

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
  $('groupMode').onchange = (e) => { mutate(() => { P.groupMode = e.target.value; }); render(); };
  $('autoBtn').onclick = () => { mutate(() => { const r = autoEstimate(P); toast(`Estimated ${r.filled} boards → ${fmtClock(r.total)}`); }); render(); };
  $('rebalBtn').onclick = () => { mutate(() => { const r = rebalance(P); toast(`Rebalanced → ${fmtClock(r.total)}`); }); render(); };

  $('undoBtn').onclick = doUndo; $('redoBtn').onclick = doRedo;
  $('helpBtn').onclick = () => $('helpPop').classList.toggle('hidden');
  document.addEventListener('click', (e) => { if (!e.target.closest('#helpBtn, #helpPop')) $('helpPop').classList.add('hidden'); });
  $('zoomIn').onclick = () => setZoom(1.6); $('zoomOut').onclick = () => setZoom(1 / 1.6); $('zoomFit').onclick = zoomFit;

  $('playBtn').onclick = () => transport.toggle();
  $('toStart').onclick = () => transport.seek(0);
  $('toEnd').onclick = () => transport.seek(timeline(P).total);
  $('stepBack').onclick = () => transport.stepFrames(-1);
  $('stepFwd').onclick = () => transport.stepFrames(1);
  $('prevShot').onclick = () => jumpShot(-1);
  $('nextShot').onclick = () => jumpShot(1);
  $('scrub').oninput = (e) => transport.seek(+e.target.value);

  $('timeline').addEventListener('click', (e) => {
    if (e.target.closest('.slot, .mk')) return;
    const sc = $('timeline'); const x = e.clientX - sc.getBoundingClientRect().left + sc.scrollLeft;
    transport.seek(x / pps);
  });

  $('loadAudioBtn').onclick = () => $('audioInput').click();
  $('loadAudioBtn0').onclick = () => $('audioInput').click();
  $('audioInput').onchange = (e) => e.target.files.length && loadAudio(e.target.files[0]);
  $('slipMinus1').onclick = () => nudgeSlip(-1); $('slipPlus1').onclick = () => nudgeSlip(1);
  $('slipMinusS').onclick = () => nudgeSlipSec(-0.1); $('slipPlusS').onclick = () => nudgeSlipSec(0.1);
  $('setSync').onclick = setSyncToPlayhead;
  $('useAudioLen').onclick = () => { if (P.audio?.duration) { mutate(() => { P.spotSeconds = Math.round(P.audio.duration * 100) / 100; }); $('spot').value = P.spotSeconds; render(); toast('Spot set to audio length'); } };

  const lane = $('wave'); let dragging = false, dragX0 = 0, off0 = 0;
  lane.addEventListener('pointerdown', (e) => { if (!P.audio) return; dragging = true; dragX0 = e.clientX; off0 = P.audio.offsetSec || 0; lane.setPointerCapture(e.pointerId); beginGesture(); });
  lane.addEventListener('pointermove', (e) => {
    if (!dragging || !P.audio) return;
    const total = Math.max(timeline(P).total, P.spotSeconds); const secPerPx = total / (lane.clientWidth || 600);
    let off = off0 + (e.clientX - dragX0) * secPerPx; off = Math.round(off * P.fps) / P.fps;
    P.audio.offsetSec = off; drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec);
  });
  lane.addEventListener('pointerup', () => { if (dragging) { dragging = false; commitGesture(); refreshUndoButtons(); } });

  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); const d = $('drop'); if (d) d.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; const d = $('drop'); if (d) d.classList.remove('hot'); }));
  document.addEventListener('drop', (e) => {
    e.preventDefault(); const files = [...e.dataTransfer.files]; if (!files.length) return;
    const audio = files.find((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f.name));
    const work = files.find((f) => /\.json$/i.test(f.name));
    if (audio && P.frames.length) loadAudio(audio); else if (work && files.length === 1) openWork(work); else loadImages(files);
  });

  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (typing || !P.frames.length) return;
    const k = e.key;
    if (k === ' ') { if (/button/i.test(e.target.tagName)) return; e.preventDefault(); transport.toggle(); return; }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault(); const dir = k === 'ArrowRight' ? 1 : -1;
      if (e.metaKey || e.ctrlKey) transport.seek(dir > 0 ? timeline(P).total : 0);
      else if (e.shiftKey) jumpShot(dir);
      else transport.stepFrames(dir);
    }
  });

  window.addEventListener('resize', () => { if (P.frames.length) { buildTimeline(); updatePlayhead(transport.sec); if (P.audio) drawWaveformLane(); } });
}

wire();

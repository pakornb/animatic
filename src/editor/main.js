import '../style.css';
import {
  project as P, computeShots, timeline, resolveAt, shotMeta, autoEstimate,
  fmtClock, fmtTC,
} from '../core/model.js';
import { loadFromFiles, loadFromZip } from '../core/frames.js';
import { saveWorkFile, openWorkFile } from '../io/workfile.js';
import { loadAudioFile, drawWaveform } from '../io/audio.js';
import { renderInspector } from './inspector.js';
import { Transport } from './transport.js';

const $ = (id) => document.getElementById(id);
let cur = 0;               // current frame index (paused/scrub position)
let lastShot = -1;         // for inspector refresh during playback
const transport = new Transport(P);

function isolationBadge() {
  const el = $('iso');
  const ok = self.crossOriginIsolated === true;
  el.textContent = ok ? 'isolated ✓ mp4 ready' : 'not isolated — mp4 needs the hosted app';
  el.className = 'iso ' + (ok ? 'ok' : 'warn');
}

// ---------- loading ----------
async function loadImages(files) {
  const arr = [...files];
  const zip = arr.find((f) => /\.zip$/i.test(f.name));
  try {
    overlay('Loading images…');
    if (zip) await loadFromZip(zip); else await loadFromFiles(arr);
    onLoaded();
  } catch (e) { console.error(e); toast(e.message || 'Load failed'); }
  finally { overlay(false); }
}
async function openWork(file) {
  try {
    overlay('Opening work file…');
    await openWorkFile(file, (d, t) => overlay(`Opening… ${d}/${t}`));
    onLoaded();
  } catch (e) { console.error(e); toast(e.message || 'Could not open work file'); }
  finally { overlay(false); }
}
async function saveWork() {
  if (!P.frames.length) return;
  try {
    overlay('Saving work file…');
    await saveWorkFile((d, t) => overlay(`Saving… ${d}/${t}`));
    toast('Work file saved');
  } catch (e) { console.error(e); toast('Save failed'); }
  finally { overlay(false); }
}

function onLoaded() {
  cur = Math.min(cur, P.frames.length - 1);
  $('loadView').classList.add('hidden');
  $('stage').classList.remove('hidden');
  $('baseName').textContent = P.baseName;
  $('fps').value = P.fps;
  $('spot').value = P.spotSeconds;
  $('lenUnit').value = P.lenUnit;
  const gm = $('groupMode');
  gm.value = P.groupMode;
  gm.options[1].disabled = !P.hasNamePattern;
  gm.options[1].textContent = P.hasNamePattern ? 'filename' : 'filename (none)';
  $('saveBtn').disabled = false;
  transport.mountAudio();
  syncAudioUI();
  render();
}

// ---------- structural render ----------
function render() {
  computeShots(P);
  buildTimeline();
  updateInspector(true);
  const total = timeline(P).total;
  updateBudget(total);
  updatePlayhead(transport.sec);
}

function updateInspector(force) {
  renderInspector($('inspector'), cur, {
    onChange: () => { buildTimeline(); updateBudget(timeline(P).total); updatePlayhead(transport.sec); },
    onGoFrame: (i) => { cur = i; transport.seek(shotStartSec(i)); updateInspector(true); },
  });
}

function shotStartSec(frameIndex) {
  const { rows } = timeline(P);
  const r = rows.find((x) => frameIndex >= x.sh.start && frameIndex <= x.sh.end);
  return r ? r.startSec : 0;
}

function updateBudget(total) {
  const over = total - P.spotSeconds;
  const b = $('budget');
  const sign = over > 0.05 ? `+${over.toFixed(2)}s over` : over < -0.05 ? `${Math.abs(over).toFixed(2)}s under` : 'on target';
  b.textContent = `${fmtClock(total)} / ${P.spotSeconds}s · ${sign}`;
  b.className = 'budget ' + (Math.abs(over) <= 0.05 ? 'ok' : over > 0 ? 'over' : 'under');
  $('stats').textContent = `${P.frames.length} frames · ${P.shots.length} shots`;
  $('scrub').max = String(Math.max(total, P.spotSeconds));
}

// tiled, aspect-correct boards; width = duration
function buildTimeline() {
  const tl = $('timeline');
  // preserve playhead element
  tl.querySelectorAll('.block, .target-marker').forEach((n) => n.remove());
  const ph = $('playhead');
  const { rows, total } = timeline(P);
  const scaleTotal = Math.max(total, P.spotSeconds);
  const blockH = 60, boardW = Math.round((blockH * 16) / 9);
  const blocks = [];
  rows.forEach((row, i) => {
    const block = document.createElement('div');
    block.className = 'block';
    block.style.width = (row.len / scaleTotal) * 100 + '%';
    const m = shotMeta(P, row.sh);
    const label = m.tag || row.sh.name || `S${i + 1}`;
    block.title = `${label} · ${row.len.toFixed(2)}s · ${row.sh.count}b`;
    const boards = document.createElement('div'); boards.className = 'boards';
    block.appendChild(boards);
    const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = label;
    block.appendChild(cap);
    block.addEventListener('click', () => { cur = row.sh.start; transport.seek(row.startSec); updateInspector(true); });
    tl.insertBefore(block, ph);
    blocks.push({ block, boards, row, boardW, blockH });
  });
  // second pass: fill each block with as many aspect-correct boards as fit
  blocks.forEach(({ block, boards, row, boardW, blockH }) => {
    const px = block.clientWidth || 8;
    const slots = Math.max(1, Math.round(px / boardW));
    const n = Math.min(slots, row.sh.count);
    for (let s = 0; s < n; s++) {
      const fi = row.sh.start + (n === 1 ? 0 : Math.round((s * (row.sh.count - 1)) / (n - 1)));
      const c = document.createElement('canvas');
      c.width = boardW; c.height = blockH;
      c.getContext('2d').drawImage(P.frames[fi].thumb, 0, 0, boardW, blockH);
      boards.appendChild(c);
    }
  });
  const marker = document.createElement('div');
  marker.className = 'target-marker';
  marker.style.left = (P.spotSeconds / scaleTotal) * 100 + '%';
  marker.title = `${P.spotSeconds}s target`;
  tl.insertBefore(marker, ph);
}

// ---------- playback tick (cheap) ----------
function onTick(sec, playing) {
  updatePlayhead(sec);
  const r = resolveAt(P, sec, transport.holdFirst);
  if (r) {
    if (P.frames[r.frame]) $('preview').src = P.frames[r.frame].url;
    if (!playing) cur = r.frame;
    if (r.shotIndex !== lastShot) { lastShot = r.shotIndex; if (!playing) updateInspector(true); }
    const sh = r.shot; const si = r.shotIndex + 1;
    $('previewMeta').textContent = `${P.frames[r.frame].name} · shot ${si}/${P.shots.length}`;
  }
  const total = timeline(P).total;
  $('clock').textContent = `${fmtClock(sec)} / ${fmtClock(P.spotSeconds)}`;
  $('scrub').value = String(sec);
  $('playBtn').textContent = playing ? '❚❚' : '▶';
  if (P.audio) drawAudioMarker(sec);
}

function updatePlayhead(sec) {
  const total = timeline(P).total;
  const scaleTotal = Math.max(total, P.spotSeconds);
  $('playhead').style.left = (sec / scaleTotal) * 100 + '%';
  const idx = (resolveAt(P, sec, transport.holdFirst) || {}).shotIndex;
  [...$('timeline').querySelectorAll('.block')].forEach((el, i) => el.classList.toggle('active', i === idx));
}

// ---------- audio ----------
async function loadAudio(file) {
  try {
    overlay('Decoding audio…');
    P.audio = await loadAudioFile(file);
    transport.mountAudio();
    syncAudioUI();
    toast('Audio loaded');
  } catch (e) { console.error(e); toast('Could not load audio'); }
  finally { overlay(false); }
}

function syncAudioUI() {
  const has = !!P.audio;
  $('audioLane').classList.toggle('hidden', !has);
  $('audioName').textContent = has ? P.audio.name : '';
  if (!has) return;
  drawWaveformLane();
  drawSlipReadout();
  $('useAudioLen').disabled = !P.audio.duration;
}

function drawWaveformLane() {
  const c = $('wave');
  c.width = c.clientWidth || 600; c.height = 44;
  drawWaveform(c, P.audio, { fps: P.fps, markerSec: currentAudioPos() });
}
function drawAudioMarker() { drawWaveformLane(); }

function currentAudioPos() {
  const a = P.audio; if (!a) return null;
  const at = transport.sec - (a.offsetSec || 0) + (a.inSec ?? 0);
  return at;
}

function drawSlipReadout() {
  const a = P.audio; if (!a) return;
  const frames = Math.round((a.offsetSec || 0) * P.fps);
  $('slipVal').textContent = `${frames >= 0 ? '+' : ''}${frames}f  (${fmtTC(Math.abs(frames), P.fps)})`;
}

function nudgeSlip(deltaFrames) {
  const a = P.audio; if (!a) return;
  a.offsetSec = (a.offsetSec || 0) + deltaFrames / P.fps;
  drawSlipReadout(); drawWaveformLane();
  transport.seek(transport.sec); // re-sync audio position
}
function nudgeSlipSec(d) {
  const a = P.audio; if (!a) return;
  a.offsetSec = (a.offsetSec || 0) + d;
  drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec);
}
function setSyncToPlayhead() {
  const a = P.audio; if (!a) return;
  a.offsetSec = transport.sec; // audio in-point plays at the current frame
  drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec);
  toast('Audio start set to playhead');
}

// ---------- utilities ----------
function overlay(msg) {
  const o = $('overlay');
  if (msg === false) { o.classList.add('hidden'); return; }
  o.querySelector('span').textContent = msg; o.classList.remove('hidden');
}
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2000);
}
function jumpShot(dir) {
  const i = P.shots.findIndex((s) => cur >= s.start && cur <= s.end);
  if (i < 0) return;
  let target;
  if (dir > 0) { const n = P.shots[i + 1]; target = n ? n.start : P.frames.length - 1; }
  else { const s = P.shots[i]; if (cur > s.start) target = s.start; else { const pv = P.shots[i - 1]; target = pv ? pv.start : 0; } }
  cur = target; transport.seek(shotStartSec(target)); updateInspector(true);
}

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

  $('fps').onchange = (e) => { P.fps = Math.max(1, +e.target.value || 24); render(); };
  $('spot').onchange = (e) => { P.spotSeconds = Math.max(1, +e.target.value || 30); render(); };
  $('lenUnit').onchange = (e) => { P.lenUnit = e.target.value; render(); };
  $('groupMode').onchange = (e) => { P.groupMode = e.target.value; render(); };
  $('autoBtn').onclick = () => { const r = autoEstimate(P); toast(r.filled ? `Estimated ${r.filled} shots → ${fmtClock(r.total)}` : 'All shots already set'); render(); };

  // transport
  $('playBtn').onclick = () => transport.toggle();
  $('toStart').onclick = () => { transport.seek(0); };
  $('toEnd').onclick = () => { transport.seek(timeline(P).total); };
  $('stepBack').onclick = () => transport.stepFrames(-1);
  $('stepFwd').onclick = () => transport.stepFrames(1);
  $('prevShot').onclick = () => jumpShot(-1);
  $('nextShot').onclick = () => jumpShot(1);
  $('scrub').oninput = (e) => transport.seek(+e.target.value);
  $('holdFirst').onchange = (e) => { transport.holdFirst = e.target.checked; onTick(transport.sec, transport.playing); };

  // audio
  $('loadAudioBtn').onclick = () => $('audioInput').click();
  $('loadAudioBtn0').onclick = () => $('audioInput').click();
  $('audioInput').onchange = (e) => e.target.files.length && loadAudio(e.target.files[0]);
  $('slipMinus1').onclick = () => nudgeSlip(-1);
  $('slipPlus1').onclick = () => nudgeSlip(1);
  $('slipMinusS').onclick = () => nudgeSlipSec(-0.1);
  $('slipPlusS').onclick = () => nudgeSlipSec(0.1);
  $('setSync').onclick = setSyncToPlayhead;
  $('useAudioLen').onclick = () => { if (P.audio?.duration) { P.spotSeconds = Math.round(P.audio.duration * 100) / 100; $('spot').value = P.spotSeconds; render(); toast('Spot set to audio length'); } };

  // drag audio block to slip (snap to frames)
  const lane = $('wave');
  let dragging = false, dragX0 = 0, off0 = 0;
  lane.addEventListener('pointerdown', (e) => { if (!P.audio) return; dragging = true; dragX0 = e.clientX; off0 = P.audio.offsetSec || 0; lane.setPointerCapture(e.pointerId); });
  lane.addEventListener('pointermove', (e) => {
    if (!dragging || !P.audio) return;
    const total = Math.max(timeline(P).total, P.spotSeconds);
    const secPerPx = total / (lane.clientWidth || 600);
    let off = off0 + (e.clientX - dragX0) * secPerPx;
    off = Math.round(off * P.fps) / P.fps; // snap to frames
    P.audio.offsetSec = off; drawSlipReadout(); drawWaveformLane(); transport.seek(transport.sec);
  });
  lane.addEventListener('pointerup', () => { dragging = false; });

  // drag/drop
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); const d = $('drop'); if (d) d.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; const d = $('drop'); if (d) d.classList.remove('hot'); }));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files]; if (!files.length) return;
    const audio = files.find((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f.name));
    const work = files.find((f) => /\.json$/i.test(f.name));
    if (audio && P.frames.length) loadAudio(audio);
    else if (work && files.length === 1) openWork(work);
    else loadImages(files);
  });

  // keyboard: arrows = frames (or audio slip when audio lane focused)
  document.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(e.target.tagName) || !P.frames.length) return;
    const k = e.key;
    if (k === ' ') { if (/button/i.test(e.target.tagName)) return; e.preventDefault(); transport.toggle(); return; }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (e.metaKey || e.ctrlKey) { transport.seek(dir > 0 ? timeline(P).total : 0); cur = dir > 0 ? P.frames.length - 1 : 0; }
      else if (e.shiftKey) jumpShot(dir);
      else transport.stepFrames(dir);
    }
  });

  window.addEventListener('resize', () => { if (P.frames.length) { buildTimeline(); updatePlayhead(transport.sec); if (P.audio) drawWaveformLane(); } });
}

wire();

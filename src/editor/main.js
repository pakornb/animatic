import '../style.css';
import {
  project as P, computeShots, timeline, shotMeta, autoEstimate, fmtClock,
} from '../core/model.js';
import { loadFromFiles, loadFromZip } from '../core/frames.js';
import { saveWorkFile, openWorkFile } from '../io/workfile.js';
import { renderInspector } from './inspector.js';

const $ = (id) => document.getElementById(id);
let cur = 0;

function isolationBadge() {
  const el = $('iso');
  const ok = self.crossOriginIsolated === true;
  el.textContent = ok ? 'isolated ✓ mp4 ready' : 'not isolated — mp4 needs the hosted app';
  el.className = 'iso ' + (ok ? 'ok' : 'warn');
}

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
    await openWorkFile(file, (done, total) => overlay(`Opening… ${done}/${total}`));
    onLoaded();
  } catch (e) { console.error(e); toast(e.message || 'Could not open work file'); }
  finally { overlay(false); }
}

async function saveWork() {
  if (!P.frames.length) return;
  try {
    overlay('Saving work file…');
    await saveWorkFile((done, total) => overlay(`Saving… ${done}/${total}`));
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
  render();
}

function render() {
  computeShots(P);
  const { total } = timeline(P);
  drawTimeline(total);
  drawPreview();
  renderInspector($('inspector'), cur, {
    onChange: () => { const t = timeline(P).total; drawTimeline(t); updateBudget(t); },
    onGoFrame: (i) => { cur = i; render(); },
  });
  updateBudget(total);
}

function updateBudget(total) {
  const over = total - P.spotSeconds;
  const b = $('budget');
  const sign = over > 0.05 ? `+${over.toFixed(2)}s over` : over < -0.05 ? `${Math.abs(over).toFixed(2)}s under` : 'on target';
  b.textContent = `${fmtClock(total)} / ${P.spotSeconds}s · ${sign}`;
  b.className = 'budget ' + (Math.abs(over) <= 0.05 ? 'ok' : over > 0 ? 'over' : 'under');
  $('stats').textContent = `${P.frames.length} frames · ${P.shots.length} shots`;
}

function drawTimeline(total) {
  const tl = $('timeline');
  tl.innerHTML = '';
  const { rows } = timeline(P);
  const scaleTotal = Math.max(total, P.spotSeconds);
  rows.forEach((row, i) => {
    const block = document.createElement('div');
    block.className = 'block';
    if (cur >= row.sh.start && cur <= row.sh.end) block.classList.add('active');
    block.style.width = (row.len / scaleTotal) * 100 + '%';
    const m = shotMeta(P, row.sh);
    const label = m.tag || row.sh.name || `S${i + 1}`;
    block.title = `${label} · ${row.len.toFixed(2)}s · ${row.sh.count}b`;
    const c = document.createElement('canvas');
    c.width = 96; c.height = 54;
    const rep = Math.floor((row.sh.start + row.sh.end) / 2);
    c.getContext('2d').drawImage(P.frames[rep].thumb, 0, 0, 96, 54);
    block.appendChild(c);
    const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = label;
    block.appendChild(cap);
    block.addEventListener('click', () => { cur = row.sh.start; render(); });
    tl.appendChild(block);
  });
  const marker = document.createElement('div');
  marker.className = 'target-marker';
  marker.style.left = (P.spotSeconds / scaleTotal) * 100 + '%';
  tl.appendChild(marker);
}

function drawPreview() {
  const f = P.frames[cur];
  if (!f) return;
  $('preview').src = f.url;
  const sh = P.shots.find((s) => cur >= s.start && cur <= s.end);
  const si = P.shots.indexOf(sh) + 1;
  $('previewMeta').textContent = `${f.name} · frame ${f.index + 1}/${P.frames.length} · shot ${si}`;
}

function overlay(msg) {
  const o = $('overlay');
  if (msg === false) { o.classList.add('hidden'); return; }
  o.querySelector('span').textContent = msg;
  o.classList.remove('hidden');
}
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2000);
}

function jumpShot(dir) {
  const i = P.shots.findIndex((s) => cur >= s.start && cur <= s.end);
  if (i < 0) return;
  if (dir > 0) { const n = P.shots[i + 1]; cur = n ? n.start : P.frames.length - 1; }
  else { const s = P.shots[i]; if (cur > s.start) cur = s.start; else { const pv = P.shots[i - 1]; cur = pv ? pv.start : 0; } }
}

function wire() {
  isolationBadge();
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
  $('autoBtn').onclick = () => {
    const r = autoEstimate(P);
    toast(r.filled ? `Estimated ${r.filled} shots` : 'All shots already set');
    render();
  };

  ['dragenter', 'dragover'].forEach((ev) =>
    document.addEventListener(ev, (e) => { e.preventDefault(); const d = $('drop'); if (d) d.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; const d = $('drop'); if (d) d.classList.remove('hot'); }));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files]; if (!files.length) return;
    const work = files.find((f) => /\.json$/i.test(f.name));
    if (work && files.length === 1) openWork(work); else loadImages(files);
  });

  document.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(e.target.tagName) || !P.frames.length) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (e.metaKey || e.ctrlKey) cur = dir > 0 ? P.frames.length - 1 : 0;
      else if (e.shiftKey) jumpShot(dir);
      else cur = Math.max(0, Math.min(P.frames.length - 1, cur + dir));
      render();
    }
  });
}

wire();

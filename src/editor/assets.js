import {
  project as P, shotMeta, shotLenSec, lenToUnit, isShotDisabled, enabledBoards,
  addAssetTask, removeAssetTask, addAssetCat, removeAssetCat, addAsset, removeAsset,
  getAsset, setAssetField, setAssetTaskVal, assetsByCat,
} from '../core/model.js';
import { mutate } from '../core/history.js';
import { createAnnotator, annotatorToolbar, drawAnnos } from '../core/annotate.js';

let refresh = () => {};
export function setRefresh(fn) { refresh = fn; }

// ---------- montage + breakdown data ----------
function shotMontage(sh, cols = 3, cell = 200) {
  const boards = enabledBoards(P, sh);
  if (!boards.length) return null;
  const t0 = P.frames[boards[0]].thumb;
  const cw = cell, ch = Math.round(cell * t0.height / t0.width);
  const n = boards.length, c = Math.min(cols, n), r = Math.ceil(n / c);
  const cv = document.createElement('canvas'); cv.width = c * cw; cv.height = r * ch;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  boards.forEach((fi, i) => { const rr = Math.floor(i / c), cc = i % c; ctx.drawImage(P.frames[fi].thumb, cc * cw, rr * ch, cw, ch); });
  return { url: cv.toDataURL('image/jpeg', 0.72), w: cv.width, h: cv.height };
}

function loadImg(src) { return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }); }
async function assetThumbFor(a) {
  if (!a.thumb) return null;
  if (!a.annos || !a.annos.length) return a.thumb;
  const im = await loadImg(a.thumb); if (!im) return a.thumb;
  const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
  const ctx = cv.getContext('2d'); ctx.drawImage(im, 0, 0); drawAnnos(ctx, a.annos, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.8);
}

export async function buildBreakdownData(withThumbs = true) {
  const shots = P.shots.map((sh, si) => {
    const m = shotMeta(P, sh);
    const mont = withThumbs ? shotMontage(sh) : null;
    return {
      id: si + 1, name: sh.name || '', tag: m.tag || '',
      length: lenToUnit(P, shotLenSec(P, sh)), note: m.note || '',
      taskVals: m.taskVals || m.stageVals || {}, disabled: isShotDisabled(P, sh),
      thumbnail: mont ? mont.url : null, thumbW: mont ? mont.w : 152, thumbH: mont ? mont.h : 88,
    };
  });
  const assets = [];
  for (const a of P.assets) {
    assets.push({ name: a.name, cat: a.cat, tasks: a.tasks || {}, thumbnail: withThumbs ? await assetThumbFor(a) : null, thumbW: a.thumbW || 240, thumbH: a.thumbH || 135 });
  }
  return { kind: 'breakdown', lenUnit: P.lenUnit, fps: P.fps, shotTasks: P.shotTasks, assetTasks: P.assetTasks, assetCats: P.assetCats, shots, assets };
}

export async function exportBreakdownJSON() {
  const data = await buildBreakdownData(true);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${P.baseName}_breakdown.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- modal shell ----------
function modal(title, bodyBuilder, wide) {
  closeModal();
  const root = document.getElementById('modalRoot');
  const back = document.createElement('div'); back.className = 'modal-back'; back.id = 'activeModal';
  const box = document.createElement('div'); box.className = 'modal' + (wide ? ' wide' : '');
  const head = document.createElement('div'); head.className = 'modal-head';
  head.innerHTML = `<b>${title}</b>`;
  const x = document.createElement('button'); x.className = 'tbtn sm'; x.textContent = '✕'; x.onclick = closeModal;
  head.appendChild(x);
  const body = document.createElement('div'); body.className = 'modal-body';
  box.append(head, body); back.appendChild(box); root.appendChild(back);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) closeModal(); });
  bodyBuilder(body);
  return body;
}
export function closeModal() { const m = document.getElementById('activeModal'); if (m) m.remove(); }

// ---------- asset window ----------
export function openAssetWindow() {
  modal('Asset tracker', renderAssets, true);
}
function renderAssets(body) {
  body.innerHTML = '';

  // asset task columns editor
  const tbar = el('div', 'task-editor');
  tbar.appendChild(tag('asset tasks:', 'lbl'));
  P.assetTasks.forEach((t) => {
    const chip = el('span', 'chip'); chip.textContent = t;
    const rm = el('button', 'chip-x'); rm.textContent = '×'; rm.title = 'remove task';
    rm.onclick = () => { if (confirm(`Remove asset task "${t}"?`)) { mutate(() => removeAssetTask(P, t)); renderAssets(body); } };
    chip.appendChild(rm); tbar.appendChild(chip);
  });
  const addT = el('button', 'btn ghost sm'); addT.textContent = '+ task';
  addT.onclick = () => { const n = prompt('New asset task (e.g. groom, fx):'); if (n) { mutate(() => addAssetTask(P, n)); renderAssets(body); } };
  tbar.appendChild(addT);
  body.appendChild(tbar);

  // categories
  P.assetCats.forEach((cat) => {
    const sec = el('div', 'asset-cat');
    const ch = el('div', 'asset-cat-head');
    ch.innerHTML = `<span class="cat-name">${escapeHtml(cat)}</span>`;
    const addA = el('button', 'btn ghost sm'); addA.textContent = '+ asset';
    addA.onclick = () => { mutate(() => addAsset(P, cat)); renderAssets(body); };
    const rmC = el('button', 'mini'); rmC.textContent = 'remove category'; rmC.onclick = () => { if (confirm(`Remove category "${cat}" and its assets?`)) { mutate(() => removeAssetCat(P, cat)); renderAssets(body); } };
    ch.append(addA, rmC); sec.appendChild(ch);

    const items = assetsByCat(P, cat);
    if (!items.length) { const e = el('div', 'asset-empty'); e.textContent = 'no assets yet'; sec.appendChild(e); }
    items.forEach((a) => sec.appendChild(assetRow(a, body)));
    body.appendChild(sec);
  });

  const addCat = el('button', 'btn ghost sm'); addCat.textContent = '+ category';
  addCat.onclick = () => { const n = prompt('New category (e.g. vehicle, fx):'); if (n) { mutate(() => addAssetCat(P, n)); renderAssets(body); } };
  body.appendChild(addCat);
}

function assetRow(a, body) {
  const row = el('div', 'asset-row');
  // thumb
  const thumb = el('div', 'asset-thumb');
  if (a.thumb) { const im = document.createElement('img'); im.src = a.thumb; thumb.appendChild(im); if (a.annos && a.annos.length) { const ov = document.createElement('canvas'); ov.className = 'asset-anno-ov'; thumb.appendChild(ov); const set = () => { const r = thumb.getBoundingClientRect(); ov.width = r.width; ov.height = r.height; drawAnnos(ov.getContext('2d'), a.annos, ov.width, ov.height); }; requestAnimationFrame(set); } }
  else thumb.textContent = '—';
  const thumbBtns = el('div', 'asset-thumb-btns');
  const pick = el('button', 'mini'); pick.textContent = 'board'; pick.title = 'pick a board as reference'; pick.onclick = () => pickBoard(a.id, body);
  const up = el('button', 'mini'); up.textContent = 'upload'; up.onclick = () => uploadThumb(a.id, body);
  const ann = el('button', 'mini'); ann.textContent = '✎'; ann.title = 'annotate reference'; ann.disabled = !a.thumb; ann.onclick = () => openAssetAnnotate(a.id, body);
  thumbBtns.append(pick, up, ann);
  const thumbWrap = el('div', 'asset-thumb-wrap'); thumbWrap.append(thumb, thumbBtns);
  row.appendChild(thumbWrap);

  // name
  const nm = document.createElement('input'); nm.className = 'asset-name'; nm.value = a.name;
  nm.oninput = () => setAssetField(P, a.id, 'name', nm.value);
  nm.onchange = () => mutate(() => setAssetField(P, a.id, 'name', nm.value));
  row.appendChild(nm);

  // task values
  const tvs = el('div', 'asset-tasks');
  P.assetTasks.forEach((t) => {
    const wrap = el('label', 'asset-task');
    const lb = el('span', ''); lb.textContent = t;
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0';
    inp.value = (a.tasks && a.tasks[t] != null) ? a.tasks[t] : '';
    inp.oninput = () => setAssetTaskVal(P, a.id, t, inp.value === '' ? '' : +inp.value);
    inp.onchange = () => mutate(() => setAssetTaskVal(P, a.id, t, inp.value === '' ? '' : +inp.value));
    wrap.append(lb, inp); tvs.appendChild(wrap);
  });
  row.appendChild(tvs);

  const del = el('button', 'mini'); del.textContent = '🗑'; del.title = 'delete asset';
  del.onclick = () => { mutate(() => removeAsset(P, a.id)); renderAssets(body); };
  row.appendChild(del);
  return row;
}

function pickBoard(id, body) {
  modal('Pick a reference board', (mb) => {
    const grid = el('div', 'board-picker');
    P.frames.forEach((f, fi) => {
      const c = document.createElement('canvas'); c.width = 152; c.height = 88; c.className = 'pick';
      c.getContext('2d').drawImage(f.thumb, 0, 0, 152, 88); c.title = f.name;
      c.onclick = () => {
        const cv = document.createElement('canvas'); cv.width = 240; cv.height = Math.round(240 * f.thumb.height / f.thumb.width);
        cv.getContext('2d').drawImage(f.thumb, 0, 0, cv.width, cv.height);
        mutate(() => { setAssetField(P, id, 'thumb', cv.toDataURL('image/jpeg', 0.75)); setAssetField(P, id, 'thumbFrom', f.name); setAssetField(P, id, 'thumbW', cv.width); setAssetField(P, id, 'thumbH', cv.height); setAssetField(P, id, 'annos', []); });
        openAssetWindow();
      };
      grid.appendChild(c);
    });
    mb.appendChild(grid);
  }, true);
}

function openAssetAnnotate(id, body) {
  const a = getAsset(P, id); if (!a || !a.thumb) return;
  modal('Annotate reference — ' + (a.name || ''), (mb) => {
    const host = el('div', 'anno-host'); host.style.position = 'relative';
    const img = document.createElement('img'); img.className = 'anno-img'; img.src = a.thumb;
    host.appendChild(img); mb.appendChild(host);
    const barSlot = el('div', 'anno-bar-wrap'); mb.appendChild(barSlot);
    img.onload = () => {
      const ctrl = createAnnotator(host, img, a.annos || [], (strokes) => { mutate(() => setAssetField(P, id, 'annos', strokes)); });
      barSlot.appendChild(annotatorToolbar(ctrl));
    };
  }, true);
}
function uploadThumb(id, body) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { const cv = document.createElement('canvas'); cv.width = 240; cv.height = Math.round(240 * img.height / img.width); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); mutate(() => { setAssetField(P, id, 'thumb', cv.toDataURL('image/jpeg', 0.75)); setAssetField(P, id, 'thumbFrom', 'upload'); setAssetField(P, id, 'thumbW', cv.width); setAssetField(P, id, 'thumbH', cv.height); setAssetField(P, id, 'annos', []); }); renderAssets(document.querySelector('#activeModal .modal-body')); }; img.src = r.result; };
    r.readAsDataURL(file);
  };
  inp.click();
}

// ---------- sheet preview ----------
export function openPreview() {
  modal('Sheet preview', async (body) => {
    body.innerHTML = '<div class="asset-empty">Building preview…</div>';
    const d = await buildBreakdownData(true);
    body.innerHTML = '';
    const wrapS = el('div', 'sheet-block');
    wrapS.appendChild(tag('Shots', 'sheet-title'));
    wrapS.appendChild(shotTable(d));
    body.appendChild(wrapS);
    if (d.assets.length) {
      const wrapA = el('div', 'sheet-block');
      wrapA.appendChild(tag('Assets', 'sheet-title'));
      wrapA.appendChild(assetTable(d));
      body.appendChild(wrapA);
    } else {
      const e = el('div', 'asset-empty'); e.textContent = 'No assets — add some in the Asset tracker to see the Assets tab.'; body.appendChild(e);
    }
  }, true);
}
function shotTable(d) {
  const t = document.createElement('table'); t.className = 'sheet';
  const heads = ['Shot', 'Storyboard', 'Name', `Length (${d.lenUnit === 'frames' ? 'f' : 's'})`, ...d.shotTasks.map(cap), 'Notes'];
  t.appendChild(tr(heads.map((h) => th(h))));
  d.shots.forEach((s) => {
    const cells = [];
    cells.push(td(s.disabled ? `${s.id} ⊘` : s.id));
    const img = document.createElement('td'); if (s.thumbnail) { const im = document.createElement('img'); im.src = s.thumbnail; im.className = 'sheet-thumb'; img.appendChild(im); } cells.push(img);
    cells.push(td(s.tag || s.name));
    cells.push(td(s.length));
    d.shotTasks.forEach((tk) => cells.push(td(s.taskVals[tk] != null ? s.taskVals[tk] : '')));
    cells.push(td(s.note));
    const row = tr(cells); if (s.disabled) row.className = 'dis'; t.appendChild(row);
  });
  return t;
}
function assetTable(d) {
  const t = document.createElement('table'); t.className = 'sheet';
  t.appendChild(tr(['Category', 'Reference', 'Asset', ...d.assetTasks.map(cap)].map((h) => th(h))));
  d.assetCats.forEach((cat) => {
    d.assets.filter((a) => a.cat === cat).forEach((a, i) => {
      const ref = document.createElement('td'); if (a.thumbnail) { const im = document.createElement('img'); im.src = a.thumbnail; im.className = 'sheet-thumb'; ref.appendChild(im); }
      const cells = [td(i === 0 ? cap(cat) : ''), ref, td(a.name)];
      d.assetTasks.forEach((tk) => cells.push(td(a.tasks[tk] != null ? a.tasks[tk] : '')));
      t.appendChild(tr(cells));
    });
  });
  return t;
}

// ---------- tiny dom helpers ----------
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function tag(text, cls) { const e = el('span', cls); e.textContent = text; return e; }
function tr(cells) { const r = document.createElement('tr'); cells.forEach((c) => r.appendChild(c)); return r; }
function th(t) { const e = document.createElement('th'); e.textContent = t; return e; }
function td(t) { const e = document.createElement('td'); e.textContent = t; return e; }
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

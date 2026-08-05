import {
  project as P, shotMeta, setShotMeta, shotLenSec, setShotLen, lenToUnit, unitToSec,
  isBoardDisabled, isShotDisabled, shotId, boardDur, setBoardDur, isPinned, enabledBoards,
} from '../core/model.js';
import { mutate, beginGesture, commitGesture } from '../core/history.js';

export function renderInspector(container, frameIndex, cb) {
  const { onChange, onStructural, onGoFrame } = cb;
  container.innerHTML = '';
  if (!P.shots.length) return;
  const si = P.shots.findIndex((s) => frameIndex >= s.start && frameIndex <= s.end);
  const sh = P.shots[si];
  if (!sh) return;
  const m = shotMeta(P, sh);
  const shotOff = isShotDisabled(P, sh);
  const enb = enabledBoards(P, sh);
  const shotPinned = enb.length > 0 && enb.every((fi) => isPinned(P, fi));
  const multi = sh.count > 1;

  const head = el('div', 'insp-head');
  const label = m.tag || sh.name || `Shot ${si + 1}`;
  head.innerHTML =
    `<div class="insp-title">${escapeHtml(label)}` +
    `${shotOff ? ' <span class="cut-tag">CUT</span>' : ''}${shotPinned ? ' <span class="pin-tag">PIN</span>' : ''}</div>` +
    `<div class="insp-sub">shot ${si + 1}/${P.shots.length} · ${sh.count} boards · ${shotLenSec(P, sh).toFixed(2)}s</div>`;
  container.appendChild(head);

  const nav = el('div', 'insp-nav');
  nav.append(
    btn('‹', () => si > 0 && onGoFrame(P.shots[si - 1].start), si === 0),
    btn('›', () => si < P.shots.length - 1 && onGoFrame(P.shots[si + 1].start), si === P.shots.length - 1),
    tog(shotOff ? 'enable shot' : 'disable shot', shotOff ? 'on' : 'off-btn', () => {
      mutate(() => { if (shotOff) P.shotDisabled.delete(shotId(P, sh)); else P.shotDisabled.add(shotId(P, sh)); });
      onStructural();
    }),
    tog(shotPinned ? 'unpin shot' : 'pin shot', shotPinned ? 'pinned' : '', () => {
      mutate(() => {
        if (shotPinned) enb.forEach((fi) => P.pinned.delete(P.frames[fi].name));
        else enb.forEach((fi) => P.pinned.add(P.frames[fi].name));
      });
      onStructural();
    }),
  );
  container.appendChild(nav);

  const boards = el('div', 'insp-boards');
  for (let f = sh.start; f <= sh.end; f++) {
    const off = isBoardDisabled(P, f);
    const pin = isPinned(P, f);
    const cell = el('div', 'board-cell' + (off ? ' off' : '') + (f === frameIndex ? ' sel' : ''));
    const c = document.createElement('canvas');
    c.width = 120; c.height = 68; c.className = 'board';
    c.getContext('2d').drawImage(P.frames[f].thumb, 0, 0, 120, 68);
    c.title = P.frames[f].name;
    c.addEventListener('click', () => onGoFrame(f));
    cell.appendChild(c);

    const row = el('div', 'board-row');
    row.appendChild(mini(off ? 'show' : 'hide', off ? 'enable board' : 'disable board', () => {
      mutate(() => { if (off) P.boardDisabled.delete(P.frames[f].name); else P.boardDisabled.add(P.frames[f].name); });
      onStructural();
    }));
    row.appendChild(mini(pin ? '📌' : 'pin', pin ? 'unpin board' : 'pin board', () => {
      mutate(() => { if (pin) P.pinned.delete(P.frames[f].name); else P.pinned.add(P.frames[f].name); });
      onStructural();
    }, pin));
    if (!off) {
      const d = document.createElement('input');
      d.type = 'number'; d.min = '0'; d.step = P.lenUnit === 'frames' ? '1' : '0.05'; d.className = 'wt';
      d.value = lenToUnit(P, boardDur(P, f));
      d.title = 'this board’s duration';
      d.addEventListener('focus', beginGesture);
      d.addEventListener('input', () => {
        const v = parseFloat(d.value);
        if (!isNaN(v) && v > 0) setBoardDur(P, f, unitToSec(P, v));
        onChange();
      });
      d.addEventListener('blur', commitGesture);
      row.appendChild(d);
    }
    cell.appendChild(row);
    boards.appendChild(cell);
  }
  container.appendChild(boards);

  const fields = el('div', 'insp-fields');
  fields.appendChild(field('Name', textInput(m.tag || '', sh.name ? `rename ${sh.name}` : 'shot name / tag',
    (v) => setShotMeta(P, sh, 'tag', v), onChange)));

  const lenWrap = el('div', 'len-wrap');
  const len = document.createElement('input');
  len.type = 'number'; len.min = '0'; len.step = P.lenUnit === 'frames' ? '1' : '0.1';
  len.value = lenToUnit(P, shotLenSec(P, sh));
  len.disabled = shotOff;
  len.title = 'shot total — scales its boards proportionally';
  len.addEventListener('focus', beginGesture);
  len.addEventListener('input', () => { const v = parseFloat(len.value); if (!isNaN(v) && v > 0) setShotLen(P, sh, unitToSec(P, v)); onChange(); });
  len.addEventListener('blur', commitGesture);
  const unit = el('span', 'unit'); unit.textContent = P.lenUnit === 'frames' ? 'frames' : 'sec';
  lenWrap.append(len, unit);
  fields.appendChild(field('Shot length (total)', lenWrap));

  const stageWrap = el('div', 'insp-stages');
  P.stages.forEach((s) => {
    const cell = el('div', 'stage-cell');
    const lab = el('label', ''); lab.textContent = s;
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0';
    inp.value = (m.stageVals && m.stageVals[s] != null) ? m.stageVals[s] : '';
    inp.addEventListener('focus', beginGesture);
    inp.addEventListener('input', () => {
      const mm = shotMeta(P, sh); const sv = { ...(mm.stageVals || {}) };
      sv[s] = inp.value === '' ? null : +inp.value;
      setShotMeta(P, sh, 'stageVals', sv); onChange();
    });
    inp.addEventListener('blur', commitGesture);
    cell.append(lab, inp);
    stageWrap.appendChild(cell);
  });
  fields.appendChild(field('Stages', stageWrap));

  const note = document.createElement('textarea');
  note.value = m.note || ''; note.placeholder = 'notes…'; note.rows = 3;
  note.addEventListener('focus', beginGesture);
  note.addEventListener('input', () => { setShotMeta(P, sh, 'note', note.value); onChange(); });
  note.addEventListener('blur', commitGesture);
  fields.appendChild(field('Notes', note));

  container.appendChild(fields);
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function btn(txt, fn, disabled) { const b = el('button', 'btn ghost sm'); b.textContent = txt; b.onclick = fn; b.disabled = !!disabled; return b; }
function tog(txt, extra, fn) { const b = el('button', 'btn ghost sm ' + extra); b.textContent = txt; b.onclick = fn; return b; }
function mini(txt, title, fn, active) { const b = el('button', 'mini' + (active ? ' active' : '')); b.textContent = txt; b.title = title; b.onclick = fn; return b; }
function textInput(val, ph, set, onChange) {
  const i = document.createElement('input');
  i.value = val; i.placeholder = ph;
  i.addEventListener('focus', beginGesture);
  i.addEventListener('input', () => { set(i.value); onChange(); });
  i.addEventListener('blur', commitGesture);
  return i;
}
function field(label, node) { const w = el('div', 'field'); const l = el('div', 'field-label'); l.textContent = label; w.append(l, node); return w; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

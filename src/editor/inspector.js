import {
  project as P, shotMeta, setShotMeta, shotLenSec, lenToUnit, unitToSec, fmtTC,
  isBoardDisabled, isShotDisabled, shotId, boardWeight,
} from '../core/model.js';
import { mutate, beginGesture, commitGesture } from '../core/history.js';

// Render the inspector for the shot containing `frameIndex`.
// cb: { onChange (light refresh), onStructural (full refresh), onGoFrame(idx) }
export function renderInspector(container, frameIndex, cb) {
  const { onChange, onStructural, onGoFrame } = cb;
  container.innerHTML = '';
  if (!P.shots.length) return;
  const si = P.shots.findIndex((s) => frameIndex >= s.start && frameIndex <= s.end);
  const sh = P.shots[si];
  if (!sh) return;
  const m = shotMeta(P, sh);
  const shotOff = isShotDisabled(P, sh);
  const multi = sh.count > 1;

  const head = el('div', 'insp-head');
  const label = m.tag || sh.name || `Shot ${si + 1}`;
  head.innerHTML =
    `<div class="insp-title">${escapeHtml(label)}${shotOff ? ' <span class="cut-tag">CUT</span>' : ''}</div>` +
    `<div class="insp-sub">shot ${si + 1}/${P.shots.length} · frames ${sh.start + 1}–${sh.end + 1} · ${sh.count} boards</div>`;
  container.appendChild(head);

  const nav = el('div', 'insp-nav');
  const prev = btn('‹ prev', () => si > 0 && onGoFrame(P.shots[si - 1].start), si === 0);
  const next = btn('next ›', () => si < P.shots.length - 1 && onGoFrame(P.shots[si + 1].start), si === P.shots.length - 1);
  const cut = btn(shotOff ? 'enable shot' : 'disable shot', () => {
    mutate(() => { if (shotOff) P.shotDisabled.delete(shotId(P, sh)); else P.shotDisabled.add(shotId(P, sh)); });
    onStructural();
  });
  cut.classList.add(shotOff ? 'on' : 'off-btn');
  nav.append(prev, next, cut);
  container.appendChild(nav);

  // boards, each with disable toggle + weight (weight only shown for multi-board shots)
  const boards = el('div', 'insp-boards');
  for (let f = sh.start; f <= sh.end; f++) {
    const off = isBoardDisabled(P, f);
    const cell = el('div', 'board-cell' + (off ? ' off' : '') + (f === frameIndex ? ' sel' : ''));
    const c = document.createElement('canvas');
    c.width = 120; c.height = 68; c.className = 'board';
    c.getContext('2d').drawImage(P.frames[f].thumb, 0, 0, 120, 68);
    c.title = P.frames[f].name;
    c.addEventListener('click', () => onGoFrame(f));
    cell.appendChild(c);

    const row = el('div', 'board-row');
    const tog = document.createElement('button');
    tog.className = 'mini';
    tog.textContent = off ? 'enable' : 'disable';
    tog.title = off ? 'enable board' : 'disable board';
    tog.addEventListener('click', () => {
      mutate(() => { if (off) P.boardDisabled.delete(P.frames[f].name); else P.boardDisabled.add(P.frames[f].name); });
      onStructural();
    });
    row.appendChild(tog);

    if (multi && !off) {
      const w = document.createElement('input');
      w.type = 'number'; w.min = '0.1'; w.step = '0.1'; w.className = 'wt';
      w.value = boardWeight(P, f);
      w.title = 'weight (share of shot time)';
      w.addEventListener('focus', beginGesture);
      w.addEventListener('input', () => {
        const v = parseFloat(w.value);
        if (!isNaN(v) && v > 0) P.boardWeights.set(P.frames[f].name, v);
        else P.boardWeights.delete(P.frames[f].name);
        onChange();
      });
      w.addEventListener('blur', commitGesture);
      row.appendChild(w);
    }
    cell.appendChild(row);
    boards.appendChild(cell);
  }
  container.appendChild(boards);

  // fields
  const fields = el('div', 'insp-fields');

  fields.appendChild(field('Name', textInput(m.tag || '', sh.name ? `rename ${sh.name}` : 'shot name / tag',
    (v) => setShotMeta(P, sh, 'tag', v), onChange)));

  const lenWrap = el('div', 'len-wrap');
  const len = document.createElement('input');
  len.type = 'number'; len.min = '0'; len.step = P.lenUnit === 'frames' ? '1' : '0.1';
  len.value = lenToUnit(P, shotLenSec(P, sh));
  if (m.len == null) len.classList.add('faint');
  len.disabled = shotOff;
  len.addEventListener('focus', beginGesture);
  len.addEventListener('input', () => {
    const v = parseFloat(len.value);
    setShotMeta(P, sh, 'len', isNaN(v) ? null : unitToSec(P, v));
    len.classList.remove('faint');
    onChange();
  });
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
      const mm = shotMeta(P, sh);
      const sv = { ...(mm.stageVals || {}) };
      sv[s] = inp.value === '' ? null : +inp.value;
      setShotMeta(P, sh, 'stageVals', sv);
      onChange();
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

// helpers
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function btn(txt, fn, disabled) { const b = el('button', 'btn ghost sm'); b.textContent = txt; b.onclick = fn; b.disabled = !!disabled; return b; }
function textInput(val, ph, set, onChange) {
  const i = document.createElement('input');
  i.value = val; i.placeholder = ph;
  i.addEventListener('focus', beginGesture);
  i.addEventListener('input', () => { set(i.value); onChange(); });
  i.addEventListener('blur', commitGesture);
  return i;
}
function field(label, node) {
  const w = el('div', 'field');
  const l = el('div', 'field-label'); l.textContent = label;
  w.append(l, node);
  return w;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

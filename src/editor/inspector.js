import {
  project as P, shotMeta, setShotMeta, shotLenSec, lenToUnit, unitToSec, fmtTC,
} from '../core/model.js';

// Render the inspector for the shot containing `frameIndex`.
// callbacks: onChange() after edits, onGoFrame(idx) to move the playhead.
export function renderInspector(container, frameIndex, { onChange, onGoFrame }) {
  container.innerHTML = '';
  if (!P.shots.length) return;
  const si = P.shots.findIndex((s) => frameIndex >= s.start && frameIndex <= s.end);
  const sh = P.shots[si];
  if (!sh) return;
  const m = shotMeta(P, sh);

  const head = el('div', 'insp-head');
  const label = m.tag || sh.name || `Shot ${si + 1}`;
  head.innerHTML =
    `<div class="insp-title">${escapeHtml(label)}</div>` +
    `<div class="insp-sub">shot ${si + 1}/${P.shots.length} · frames ${sh.start + 1}–${sh.end + 1} · ${sh.count} boards</div>`;
  container.appendChild(head);

  // nav
  const nav = el('div', 'insp-nav');
  const prev = btn('‹ prev', () => si > 0 && onGoFrame(P.shots[si - 1].start));
  const next = btn('next ›', () => si < P.shots.length - 1 && onGoFrame(P.shots[si + 1].start));
  prev.disabled = si === 0; next.disabled = si === P.shots.length - 1;
  nav.append(prev, next);
  container.appendChild(nav);

  // boards
  const boards = el('div', 'insp-boards');
  for (let f = sh.start; f <= sh.end; f++) {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 68; c.className = 'board';
    if (f === frameIndex) c.classList.add('sel');
    c.getContext('2d').drawImage(P.frames[f].thumb, 0, 0, 120, 68);
    c.title = P.frames[f].name;
    c.addEventListener('click', () => onGoFrame(f));
    boards.appendChild(c);
  }
  container.appendChild(boards);

  // fields
  const fields = el('div', 'insp-fields');

  fields.appendChild(field('Name', (() => {
    const i = document.createElement('input');
    i.value = m.tag || '';
    i.placeholder = sh.name ? `rename ${sh.name}` : 'shot name / tag';
    i.addEventListener('input', () => { setShotMeta(P, sh, 'tag', i.value); onChange(); });
    return i;
  })()));

  const lenWrap = document.createElement('div');
  lenWrap.style.cssText = 'display:flex;align-items:center;gap:8px';
  const len = document.createElement('input');
  len.type = 'number'; len.min = '0';
  len.step = P.lenUnit === 'frames' ? '1' : '0.1';
  len.value = lenToUnit(P, shotLenSec(P, sh));
  const overridden = m.len != null;
  if (!overridden) len.classList.add('faint');
  len.addEventListener('input', () => {
    const v = parseFloat(len.value);
    setShotMeta(P, sh, 'len', isNaN(v) ? null : unitToSec(P, v));
    len.classList.remove('faint');
    onChange();
  });
  const unit = el('span', 'unit'); unit.textContent = P.lenUnit === 'frames' ? 'frames' : 'sec';
  const tc = el('span', 'tc'); tc.textContent = fmtTC(sh.count, P.fps);
  lenWrap.append(len, unit, tc);
  fields.appendChild(field('Length', lenWrap));

  // stages (numeric)
  const stageWrap = el('div', 'insp-stages');
  P.stages.forEach((s) => {
    const cell = el('div', 'stage-cell');
    const lab = el('label', ''); lab.textContent = s;
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0';
    inp.value = (m.stageVals && m.stageVals[s] != null) ? m.stageVals[s] : '';
    inp.addEventListener('input', () => {
      const mm = shotMeta(P, sh);
      const sv = mm.stageVals || {};
      sv[s] = inp.value === '' ? null : +inp.value;
      setShotMeta(P, sh, 'stageVals', sv);
      onChange();
    });
    cell.append(lab, inp);
    stageWrap.appendChild(cell);
  });
  fields.appendChild(field('Stages', stageWrap));

  const note = document.createElement('textarea');
  note.value = m.note || ''; note.placeholder = 'notes…'; note.rows = 3;
  note.addEventListener('input', () => { setShotMeta(P, sh, 'note', note.value); onChange(); });
  fields.appendChild(field('Notes', note));

  container.appendChild(fields);
}

// helpers
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function btn(txt, fn) { const b = el('button', 'btn ghost sm'); b.textContent = txt; b.onclick = fn; return b; }
function field(label, node) {
  const w = el('div', 'field');
  const l = el('div', 'field-label'); l.textContent = label;
  w.append(l, node);
  return w;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Shared vector-annotation engine. Strokes are stored in normalized (0..1)
// coordinates relative to the image's content box, so they scale to any render
// size (preview, asset thumb, mp4 frame, viewer).

export const ANNO_COLORS = ['#ff3b3b', '#ffcc00', '#4ea8de', '#6cc070', '#ffffff', '#111111'];

// content rect of an <img>/<canvas> honoring object-fit: contain
export function contentRect(el) {
  const bw = el.clientWidth, bh = el.clientHeight;
  const iw = el.naturalWidth || el.width || bw, ih = el.naturalHeight || el.height || bh;
  if (!iw || !ih) return { x: 0, y: 0, w: bw, h: bh };
  const s = Math.min(bw / iw, bh / ih);
  const w = iw * s, h = ih * s;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

export function drawAnnos(ctx, strokes, W, H) {
  if (!strokes || !strokes.length) return;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const lw = Math.max(2, Math.round(W / 300));
  strokes.forEach((s) => {
    ctx.strokeStyle = s.color || '#ff3b3b'; ctx.fillStyle = s.color || '#ff3b3b';
    ctx.lineWidth = lw;
    const P = (p) => ({ x: p.x * W, y: p.y * H });
    if (s.type === 'free' && s.pts.length > 1) {
      ctx.beginPath(); const a = P(s.pts[0]); ctx.moveTo(a.x, a.y);
      for (let i = 1; i < s.pts.length; i++) { const b = P(s.pts[i]); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    } else if (s.type === 'box') {
      const a = P(s.pts[0]), b = P(s.pts[1]); ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (s.type === 'ellipse') {
      const a = P(s.pts[0]), b = P(s.pts[1]); ctx.beginPath();
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (s.type === 'arrow') {
      const a = P(s.pts[0]), b = P(s.pts[1]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x), hl = lw * 4;
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - hl * Math.cos(ang - 0.4), b.y - hl * Math.sin(ang - 0.4));
      ctx.lineTo(b.x - hl * Math.cos(ang + 0.4), b.y - hl * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    } else if (s.type === 'text') {
      const a = P(s.pts[0]); const fs = Math.max(12, Math.round(H / 22));
      ctx.font = `600 ${fs}px sans-serif`; ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(3, lw); ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(s.text || '', a.x, a.y); ctx.fillText(s.text || '', a.x, a.y);
    }
  });
  ctx.restore();
}

// Attach an interactive annotator over `imageEl` inside `host` (position:relative).
// strokes: initial array (mutated copy returned via onCommit). Returns controller.
export function createAnnotator(host, imageEl, strokes, onCommit) {
  let cur = (strokes || []).slice();
  let tool = 'arrow', color = ANNO_COLORS[0];
  const canvas = document.createElement('canvas');
  canvas.className = 'anno-canvas';
  host.appendChild(canvas);

  function place() {
    const r = contentRect(imageEl);
    canvas.style.left = imageEl.offsetLeft + r.x + 'px';
    canvas.style.top = imageEl.offsetTop + r.y + 'px';
    canvas.width = Math.max(1, Math.round(r.w)); canvas.height = Math.max(1, Math.round(r.h));
    canvas.style.width = r.w + 'px'; canvas.style.height = r.h + 'px';
    redraw();
  }
  function redraw() { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); drawAnnos(ctx, cur, canvas.width, canvas.height); }
  const norm = (e) => { const b = canvas.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; };

  let drawing = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (tool === 'text') { const t = prompt('Label text:'); if (t) { cur.push({ type: 'text', color, pts: [norm(e)], text: t }); commit(); } return; }
    drawing = { type: tool, color, pts: [norm(e), norm(e)] };
    if (tool === 'free') drawing.pts = [norm(e)];
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    if (drawing.type === 'free') drawing.pts.push(norm(e)); else drawing.pts[1] = norm(e);
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); drawAnnos(ctx, cur.concat([drawing]), canvas.width, canvas.height);
  });
  canvas.addEventListener('pointerup', () => { if (!drawing) return; const d = drawing; drawing = null; const a = d.pts[0], b = d.pts[d.pts.length - 1]; if (d.type !== 'free' && Math.hypot((b.x - a.x), (b.y - a.y)) < 0.01) return; cur.push(d); commit(); });

  function commit() { redraw(); onCommit && onCommit(cur.slice()); }
  const ctrl = {
    canvas,
    setTool: (t) => { tool = t; }, setColor: (c) => { color = c; },
    undo: () => { cur.pop(); commit(); },
    clear: () => { cur = []; commit(); },
    getStrokes: () => cur.slice(),
    reflow: place,
    destroy: () => { canvas.remove(); },
  };
  place();
  return ctrl;
}

// A reusable toolbar element for an annotator controller.
export function annotatorToolbar(ctrl) {
  const bar = document.createElement('div'); bar.className = 'anno-bar';
  const tools = [['arrow', '↗'], ['box', '▢'], ['ellipse', '◯'], ['free', '✎'], ['text', 'T']];
  let curBtn = null;
  tools.forEach(([t, label], i) => {
    const b = document.createElement('button'); b.className = 'anno-tool'; b.textContent = label; b.title = t;
    if (i === 0) { b.classList.add('on'); curBtn = b; }
    b.onclick = () => { ctrl.setTool(t); if (curBtn) curBtn.classList.remove('on'); b.classList.add('on'); curBtn = b; };
    bar.appendChild(b);
  });
  const sep = document.createElement('span'); sep.className = 'anno-sep'; bar.appendChild(sep);
  ANNO_COLORS.forEach((c, i) => { const s = document.createElement('button'); s.className = 'anno-color' + (i === 0 ? ' on' : ''); s.style.background = c; s.onclick = () => { ctrl.setColor(c); bar.querySelectorAll('.anno-color').forEach((x) => x.classList.remove('on')); s.classList.add('on'); }; bar.appendChild(s); });
  const sep2 = document.createElement('span'); sep2.className = 'anno-sep'; bar.appendChild(sep2);
  const undo = document.createElement('button'); undo.className = 'anno-tool'; undo.textContent = '⤺'; undo.title = 'undo'; undo.onclick = () => ctrl.undo(); bar.appendChild(undo);
  const clr = document.createElement('button'); clr.className = 'anno-tool'; clr.textContent = 'clear'; clr.onclick = () => ctrl.clear(); bar.appendChild(clr);
  return bar;
}

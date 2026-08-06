import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { project as P, timeline, getAnnos } from '../core/model.js';
import { drawAnnos } from '../core/annotate.js';

const CORE = 'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm';
let ff = null;

async function ensureFF(log) {
  if (ff) return ff;
  ff = new FFmpeg();
  if (log) ff.on('log', ({ message }) => console.log('[ffmpeg]', message));
  await ff.load({
    coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
    workerURL: await toBlobURL(`${CORE}/ffmpeg-core.worker.js`, 'text/javascript'),
  });
  return ff;
}

function evenN(n) { n = Math.round(n); return n % 2 ? n + 1 : n; }

// render one board full-res, letterboxed to resW×resH, optional annotations burned in
async function renderFrame(fi, W, H, burn) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  let bmp;
  try { bmp = await createImageBitmap(P.frames[fi].full); }
  catch { bmp = await createImageBitmap(await (await fetch(P.frames[fi].url)).blob()); }
  const s = Math.min(W / bmp.width, H / bmp.height);
  const w = bmp.width * s, h = bmp.height * s;
  ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  bmp.close && bmp.close();
  if (burn) { const a = getAnnos(P, fi); if (a.length) drawAnnos(ctx, a, W, H); }
  return await new Promise((res) => cv.toBlob((b) => res(b), 'image/jpeg', 0.9));
}

export async function exportMp4({ burnAnnotations = false, onProgress = () => {} } = {}) {
  if (!self.crossOriginIsolated) throw new Error('mp4 export needs the hosted (isolated) app — headers not active here.');
  const { boards, total } = timeline(P);
  if (!boards.length) throw new Error('Nothing to export.');
  const W = evenN(P.resW || 1920), H = evenN(P.resH || 1080), fps = P.fps || 24;

  onProgress('Loading encoder…', 0.02);
  const f = await ensureFF();

  onProgress('Rendering frames…', 0.05);
  let list = 'ffconcat version 1.0\n';
  for (let i = 0; i < boards.length; i++) {
    const bd = boards[i];
    const blob = await renderFrame(bd.fi, W, H, burnAnnotations);
    const name = `f${String(i).padStart(4, '0')}.jpg`;
    await f.writeFile(name, await fetchFile(blob));
    list += `file '${name}'\nduration ${bd.len.toFixed(4)}\n`;
    if (i === boards.length - 1) list += `file '${name}'\n`; // repeat last for final duration
    onProgress('Rendering frames…', 0.05 + 0.55 * ((i + 1) / boards.length));
  }
  await f.writeFile('list.txt', list);

  const args = ['-f', 'concat', '-safe', '0', '-i', 'list.txt'];
  const a = P.audio;
  let hasAudio = false, audioName = '';
  if (a && a.blob) {
    audioName = 'audio_in' + (/\.\w+$/.exec(a.name)?.[0] || '.wav');
    await f.writeFile(audioName, await fetchFile(a.blob));
    const off = a.offsetSec || 0;
    if (off >= 0) args.push('-itsoffset', off.toFixed(3), '-i', audioName);
    else args.push('-ss', (-off).toFixed(3), '-i', audioName);
    hasAudio = true;
  }
  args.push('-map', '0:v');
  if (hasAudio) args.push('-map', '1:a', '-c:a', 'aac', '-b:a', '192k');
  args.push('-r', String(fps), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', '-t', total.toFixed(3), 'out.mp4');

  f.on('progress', ({ progress }) => { if (progress >= 0 && progress <= 1) onProgress('Encoding…', 0.6 + 0.38 * progress); });
  onProgress('Encoding…', 0.62);
  await f.exec(args);

  const data = await f.readFile('out.mp4');
  onProgress('Finishing…', 0.99);
  // cleanup
  for (let i = 0; i < boards.length; i++) { try { await f.deleteFile(`f${String(i).padStart(4, '0')}.jpg`); } catch {} }
  try { await f.deleteFile('list.txt'); } catch {}
  if (hasAudio) { try { await f.deleteFile(audioName); } catch {} }
  try { await f.deleteFile('out.mp4'); } catch {}

  const blob = new Blob([data.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a'); el.href = url; el.download = `${P.baseName}.mp4`; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  onProgress('Done', 1);
  return { W, H, total };
}

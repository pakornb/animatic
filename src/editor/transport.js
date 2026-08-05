import { timeline } from '../core/model.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Transport {
  constructor(P) {
    this.P = P;
    this.sec = 0;
    this.playing = false;
    this.holdFirst = false;
    this.raf = 0;
    this.onTick = () => {};
    this.audioEl = new Audio();
    this.audioEl.preload = 'auto';
  }

  total() { return timeline(this.P).total; }
  frameDur() { return 1 / this.P.fps; }

  mountAudio() {
    const a = this.P.audio;
    this.audioEl.pause();
    if (a && a.url) { this.audioEl.src = a.url; this.audioEl.load(); }
    else this.audioEl.removeAttribute('src');
  }

  play() {
    if (this.playing) return;
    if (this.sec >= this.total() - 1e-4) this.sec = 0;
    this.playing = true;
    this._t0 = performance.now();
    this._base = this.sec;
    this._syncAudio(true);
    this._loop();
  }
  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.audioEl.pause();
    this.onTick(this.sec, false);
  }
  toggle() { this.playing ? this.pause() : this.play(); }

  seek(sec) {
    this.sec = clamp(sec, 0, this.total());
    if (this.playing) { this._t0 = performance.now(); this._base = this.sec; this._syncAudio(true); }
    else this._syncAudio(false);
    this.onTick(this.sec, this.playing);
  }
  // step by whole frames
  stepFrames(n) { this.pause(); this.seek(this.sec + n * this.frameDur()); }

  _loop() {
    this.raf = requestAnimationFrame(() => {
      if (!this.playing) return;
      const t = this._base + (performance.now() - this._t0) / 1000;
      if (t >= this.total()) { this.sec = this.total(); this.pause(); return; }
      this.sec = t;
      this.onTick(this.sec, true);
      this._loop();
    });
  }

  _syncAudio(force) {
    const a = this.P.audio;
    if (!a || !this.audioEl.src) return;
    const inSec = a.inSec ?? 0;
    const outSec = a.outSec ?? (this.audioEl.duration || a.duration || Infinity);
    // global time -> position within the audio file
    const at = this.sec - (a.offsetSec || 0) + inSec;
    if (at >= inSec && at <= outSec) {
      if (force || Math.abs(this.audioEl.currentTime - at) > 0.06) {
        try { this.audioEl.currentTime = Math.max(0, at); } catch (e) {}
      }
      if (this.playing) this.audioEl.play().catch(() => {});
    } else {
      this.audioEl.pause();
    }
  }
}

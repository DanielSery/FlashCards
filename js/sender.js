import { encodeFrames } from './frames.js';
import { makeMatrix, drawMatrix } from './qr.js';

// capacity = alphanumeric characters that fit the QR version at error correction L.
// Lower versions have bigger modules: slower, but easier for weak cameras.
export const SEND_MODES = {
  easy: { version: 12, capacity: 535, fps: 4 },
  normal: { version: 16, capacity: 854, fps: 6 },
  fast: { version: 20, capacity: 1249, fps: 8 },
};

export class QrSender {
  constructor(canvas, { getWidth, onFrame }) {
    this.canvas = canvas;
    this.getWidth = getWidth;
    this.onFrame = onFrame;
    this.timer = null;
  }

  start(payload, modeName) {
    this.payload = payload;
    this.setMode(modeName);
  }

  setMode(modeName) {
    this.mode = SEND_MODES[modeName];
    this.frames = encodeFrames(this.payload, this.mode.capacity);
    this.matrices = new Array(this.frames.length);
    this.index = 0;
    clearInterval(this.timer);
    this.tick();
    if (this.frames.length > 1) this.timer = setInterval(() => this.tick(), 1000 / this.mode.fps);
  }

  tick() {
    const i = this.index;
    if (!this.matrices[i]) {
      this.matrices[i] = makeMatrix(this.frames[i], { version: this.mode.version, ecLevel: 'L', mode: 'Alphanumeric' });
    }
    drawMatrix(this.canvas, this.matrices[i], this.getWidth());
    this.onFrame(i, this.frames.length);
    this.index = (i + 1) % this.frames.length;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.frames = null;
    this.matrices = null;
  }
}

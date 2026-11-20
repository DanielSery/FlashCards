import { encodeBase45, decodeBase45 } from './base45.js';
import { crc32Hex } from './crc32.js';

// Frame text: FC2:<crc32 of payload>:<index>:<count>:<base45 chunk>.
// Every character is in the QR alphanumeric set, so frames encode in alphanumeric mode.
const PREFIX = 'FC2';
const FRAME_RE = /^FC2:([0-9A-F]{8}):(\d{1,5}):(\d{1,5}):/;

export function encodeFrames(payload, maxFrameChars) {
  const crc = crc32Hex(payload);
  const text = encodeBase45(payload);
  let digits = 1;
  let perFrame;
  let count;
  for (;;) {
    perFrame = maxFrameChars - (PREFIX.length + 1 + crc.length + 1 + digits + 1 + digits + 1);
    if (perFrame < 1) throw new Error('Frame size too small');
    count = Math.max(1, Math.ceil(text.length / perFrame));
    if (String(count).length <= digits) break;
    digits++;
  }
  const frames = new Array(count);
  for (let i = 0; i < count; i++) {
    frames[i] = `${PREFIX}:${crc}:${i}:${count}:${text.slice(i * perFrame, (i + 1) * perFrame)}`;
  }
  return frames;
}

export function parseFrame(text) {
  const m = FRAME_RE.exec(text);
  if (!m) return null;
  const index = Number(m[2]);
  const count = Number(m[3]);
  if (count < 1 || index >= count) return null;
  return { crc: m[1], index, count, data: text.slice(m[0].length) };
}

export function isFrame(text) {
  return typeof text === 'string' && text.startsWith(PREFIX + ':');
}

// Collects frames of possibly several transfers (the sender may change frame size mid-way,
// which restarts the sequence under a new count) and completes whichever one fills up first.
export class FrameCollector {
  constructor() {
    this.transfers = new Map();
    this.currentKey = null;
  }

  add(text) {
    const frame = parseFrame(text);
    if (!frame) return { status: 'ignored' };
    const key = `${frame.crc}/${frame.count}`;
    let t = this.transfers.get(key);
    if (!t) {
      t = { key, crc: frame.crc, count: frame.count, chunks: new Array(frame.count), received: 0 };
      this.transfers.set(key, t);
    }
    this.currentKey = key;
    if (t.chunks[frame.index] !== undefined) return { status: 'duplicate', transfer: t };
    t.chunks[frame.index] = frame.data;
    t.received++;
    if (t.received < t.count) return { status: 'progress', transfer: t };

    this.transfers.delete(key);
    let payload;
    try {
      payload = decodeBase45(t.chunks.join(''));
    } catch {
      return { status: 'corrupt', transfer: t };
    }
    if (crc32Hex(payload) !== t.crc) return { status: 'corrupt', transfer: t };
    return { status: 'complete', transfer: t, payload };
  }

  current() {
    return this.transfers.get(this.currentKey) || null;
  }

  missing(transfer) {
    const out = [];
    for (let i = 0; i < transfer.count; i++) if (transfer.chunks[i] === undefined) out.push(i);
    return out;
  }
}

// RFC 9285. The alphabet is exactly the QR alphanumeric character set.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET.charCodeAt(i)] = i;

export function encodeBase45(bytes) {
  const parts = [];
  const pairs = bytes.length - (bytes.length % 2);
  for (let i = 0; i < pairs; i += 2) {
    const n = bytes[i] * 256 + bytes[i + 1];
    parts.push(ALPHABET[n % 45], ALPHABET[Math.floor(n / 45) % 45], ALPHABET[Math.floor(n / 2025)]);
  }
  if (pairs < bytes.length) {
    const n = bytes[pairs];
    parts.push(ALPHABET[n % 45], ALPHABET[Math.floor(n / 45)]);
  }
  return parts.join('');
}

function valueAt(text, i) {
  const code = text.charCodeAt(i);
  const v = code < 128 ? VALUES[code] : -1;
  if (v < 0) throw new Error('Invalid base45 character');
  return v;
}

export function decodeBase45(text) {
  const rest = text.length % 3;
  if (rest === 1) throw new Error('Invalid base45 length');
  const triples = text.length - rest;
  const out = new Uint8Array((triples / 3) * 2 + (rest ? 1 : 0));
  let o = 0;
  for (let i = 0; i < triples; i += 3) {
    const n = valueAt(text, i) + valueAt(text, i + 1) * 45 + valueAt(text, i + 2) * 2025;
    if (n > 0xffff) throw new Error('Invalid base45 value');
    out[o++] = n >> 8;
    out[o++] = n & 0xff;
  }
  if (rest) {
    const n = valueAt(text, triples) + valueAt(text, triples + 1) * 45;
    if (n > 0xff) throw new Error('Invalid base45 value');
    out[o] = n;
  }
  return out;
}

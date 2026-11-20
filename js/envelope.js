// Transfer format shared by QR frames and deck files:
// { app: 'flashcards', v: 2, decks: [{ id, name, u, d?, cards: [[id, front, back, u] | [id, u, front]] }] }
// u = updatedAt (ms, 0 = unknown, i.e. migrated from v1), d = deletedAt of a deleted deck,
// a three-element card is a deletion tombstone. Tombstones keep the front so that a deletion
// still matches a v1 card by its front text before the devices share card ids.
const APP = 'flashcards';
const VERSION = 2;
const FORMAT_JSON = 0;
const FORMAT_DEFLATE_RAW = 1;

export function buildEnvelope(decks) {
  return {
    app: APP,
    v: VERSION,
    decks: decks.map(deck => {
      const out = { id: deck.id, name: deck.name, u: deck.updatedAt };
      if (deck.deletedAt) {
        out.d = deck.deletedAt;
        out.cards = [];
      } else {
        out.cards = deck.cards.map(c => (c.deleted ? [c.id, c.updatedAt, c.front] : [c.id, c.front, c.back, c.updatedAt]));
      }
      return out;
    }),
  };
}

const isStr = v => typeof v === 'string';
const isTime = v => Number.isFinite(v) && v >= 0;

function invalid() {
  return new Error('This is not a FlashCards deck');
}

function parseCard(raw) {
  if (!Array.isArray(raw)) throw invalid();
  if (raw.length === 3 && isStr(raw[0]) && isTime(raw[1]) && isStr(raw[2])) {
    return { id: raw[0], front: raw[2], back: '', updatedAt: raw[1], deleted: true };
  }
  if (raw.length === 4 && isStr(raw[0]) && isStr(raw[1]) && isStr(raw[2]) && isTime(raw[3])) {
    return { id: raw[0], front: raw[1], back: raw[2], updatedAt: raw[3], deleted: false };
  }
  throw invalid();
}

function parseLegacyDeck(obj) {
  if (!isStr(obj.name) || !Array.isArray(obj.cards)) throw invalid();
  return {
    id: null,
    name: obj.name,
    updatedAt: 0,
    deletedAt: 0,
    cards: obj.cards.map(c => {
      if (!Array.isArray(c) || !isStr(c[0])) throw invalid();
      return { id: null, front: c[0], back: isStr(c[1]) ? c[1] : '', updatedAt: 0, deleted: false };
    }),
  };
}

// Returns { decks: [{ id, name, updatedAt, deletedAt, cards: [{ id, front, back, updatedAt, deleted }] }] }.
// id is null for decks and cards from v1 share links, which carried no ids.
export function parseEnvelope(obj) {
  if (!obj || typeof obj !== 'object') throw invalid();
  if (obj.v === undefined && 'name' in obj && 'cards' in obj) return { decks: [parseLegacyDeck(obj)] };
  if (obj.app !== APP || !Array.isArray(obj.decks)) throw invalid();
  if (obj.v !== VERSION) throw new Error('This deck was made by a newer version of FlashCards. Reload the app to update it.');
  return {
    decks: obj.decks.map(d => {
      if (!d || !isStr(d.id) || !isStr(d.name) || !isTime(d.u) || !Array.isArray(d.cards)) throw invalid();
      const deletedAt = isTime(d.d) ? d.d : 0;
      return { id: d.id, name: d.name, updatedAt: d.u, deletedAt, cards: deletedAt ? [] : d.cards.map(parseCard) };
    }),
  };
}

export function parseEnvelopeText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw invalid();
  }
  return parseEnvelope(obj);
}

// Chrome 80-102 has CompressionStream without 'deflate-raw', so probe the format itself.
function deflateRawSupported(Ctor) {
  try {
    new Ctor('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function withPrefix(format, body) {
  const out = new Uint8Array(body.length + 1);
  out[0] = format;
  out.set(body, 1);
  return out;
}

export async function packEnvelope(envelope, { compress = true } = {}) {
  const json = new TextEncoder().encode(JSON.stringify(envelope));
  if (compress && typeof CompressionStream === 'function' && deflateRawSupported(CompressionStream)) {
    const packed = await pipe(json, new CompressionStream('deflate-raw'));
    if (packed.length < json.length) return withPrefix(FORMAT_DEFLATE_RAW, packed);
  }
  return withPrefix(FORMAT_JSON, json);
}

export async function unpackEnvelope(bytes) {
  const body = bytes.subarray(1);
  let json;
  if (bytes[0] === FORMAT_JSON) {
    json = body;
  } else if (bytes[0] === FORMAT_DEFLATE_RAW) {
    if (typeof DecompressionStream !== 'function' || !deflateRawSupported(DecompressionStream)) {
      throw new Error('This browser cannot unpack the transfer. Update it, or use a deck file instead.');
    }
    json = await pipe(body, new DecompressionStream('deflate-raw'));
  } else {
    throw invalid();
  }
  return parseEnvelopeText(new TextDecoder().decode(json));
}

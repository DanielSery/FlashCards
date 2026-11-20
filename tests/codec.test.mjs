import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase45, decodeBase45 } from '../js/base45.js';
import { crc32Hex } from '../js/crc32.js';
import { encodeFrames, parseFrame, FrameCollector } from '../js/frames.js';
import { buildEnvelope, packEnvelope, unpackEnvelope, parseEnvelope, parseEnvelopeText } from '../js/envelope.js';
import { readLegacyLink, fetchLegacyDeck } from '../js/legacy.js';
import { rng } from './fixtures.mjs';

const utf8 = s => new TextEncoder().encode(s);
const QR_ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;

test('base45 matches the RFC 9285 examples', () => {
  // Arrange
  const vectors = [['AB', 'BB8'], ['Hello!!', '%69 VD92EX0'], ['base-45', 'UJCLQE7W581'], ['ietf!', 'QED8WEX0']];

  for (const [plain, encoded] of vectors) {
    // Act & Assert
    assert.equal(encodeBase45(utf8(plain)), encoded);
    assert.equal(new TextDecoder().decode(decodeBase45(encoded)), plain);
  }
});

test('base45 round-trips every byte value and rejects invalid input', () => {
  // Arrange
  const bytes = Uint8Array.from({ length: 1001 }, (_, i) => (i * 37) & 0xff);

  // Act
  const text = encodeBase45(bytes);

  // Assert
  assert.match(text, QR_ALPHANUMERIC);
  assert.deepEqual(decodeBase45(text), bytes);
  assert.throws(() => decodeBase45('GGW'), /Invalid base45 value/);
  assert.throws(() => decodeBase45('ab'), /Invalid base45 character/);
  assert.throws(() => decodeBase45('ABCD'), /Invalid base45 length/);
});

test('crc32 matches the standard check value', () => {
  assert.equal(crc32Hex(utf8('123456789')), 'CBF43926');
});

test('frames are QR alphanumeric, fit the frame size and parse back', () => {
  // Arrange
  const random = rng(7);
  const payload = Uint8Array.from({ length: 20_000 }, () => Math.floor(random() * 256));

  // Act
  const frames = encodeFrames(payload, 854);

  // Assert
  assert.ok(frames.length > 1);
  frames.forEach((f, i) => {
    assert.ok(f.length <= 854, `frame ${i} is ${f.length} chars`);
    assert.match(f, QR_ALPHANUMERIC);
    const parsed = parseFrame(f);
    assert.equal(parsed.index, i);
    assert.equal(parsed.count, frames.length);
  });
});

test('collector completes from frames in any order, with duplicates and noise', () => {
  // Arrange
  const random = rng(11);
  const payload = Uint8Array.from({ length: 9_999 }, () => Math.floor(random() * 256));
  const frames = encodeFrames(payload, 535);
  const order = [...frames, ...frames.slice(0, 5)].sort(() => random() - 0.5);
  const collector = new FrameCollector();
  let result;

  // Act
  assert.equal(collector.add('https://example.com/not-a-frame').status, 'ignored');
  for (const f of order) {
    const r = collector.add(f);
    if (r.status === 'complete') result = r;
  }

  // Assert
  assert.ok(result);
  assert.deepEqual(result.payload, payload);
});

test('collector rejects a payload whose checksum does not match', () => {
  // Arrange
  const frames = encodeFrames(utf8('x'.repeat(3000)), 535);
  const last = frames.length - 1;
  frames[last] = frames[last].slice(0, -3) + (frames[last].endsWith('000') ? '111' : '000');
  const collector = new FrameCollector();

  // Act
  const statuses = frames.map(f => collector.add(f).status);

  // Assert
  assert.equal(statuses.at(-1), 'corrupt');
});

test('collector follows the sender when it switches frame size', () => {
  // Arrange
  const payload = utf8('y'.repeat(5000));
  const small = encodeFrames(payload, 535);
  const large = encodeFrames(payload, 1249);
  const collector = new FrameCollector();
  small.slice(0, 3).forEach(f => collector.add(f));
  let done;

  // Act
  for (const f of large) {
    const r = collector.add(f);
    if (r.status === 'complete') done = r;
  }

  // Assert
  assert.deepEqual(done.payload, payload);
});

test('envelope packs, compresses and unpacks with tombstones and unicode', async () => {
  // Arrange
  const decks = [
    { id: 'd1', name: 'Čeština ✓', updatedAt: 5, deletedAt: 0, cards: [
      { id: 'c1', front: 'pes', back: 'dog 🐶', updatedAt: 7, deleted: false },
      { id: 'c2', front: 'kočka', back: '', updatedAt: 9, deleted: true },
    ] },
    { id: 'd2', name: 'Gone', updatedAt: 1, deletedAt: 12, cards: [] },
  ];
  const envelope = buildEnvelope(decks);

  // Act
  const packed = await packEnvelope(envelope);
  const plain = await packEnvelope(envelope, { compress: false });
  const result = await unpackEnvelope(packed);

  // Assert
  assert.equal(packed[0], 1);
  assert.equal(plain[0], 0);
  assert.deepEqual(await unpackEnvelope(plain), result);
  assert.deepEqual(result.decks[0].cards, [
    { id: 'c1', front: 'pes', back: 'dog 🐶', updatedAt: 7, deleted: false },
    { id: 'c2', front: 'kočka', back: '', updatedAt: 9, deleted: true },
  ]);
  assert.equal(result.decks[1].deletedAt, 12);
});

test('envelope rejects foreign JSON and newer versions with a readable message', () => {
  assert.throws(() => parseEnvelopeText('{"hello":1}'), /not a FlashCards deck/);
  assert.throws(() => parseEnvelopeText('not json'), /not a FlashCards deck/);
  assert.throws(() => parseEnvelope({ app: 'flashcards', v: 3, decks: [] }), /newer version/);
  assert.throws(() => parseEnvelope({ app: 'flashcards', v: 2, decks: [{ id: 'x', name: 'n', u: 0, cards: [[1, 2]] }] }), /not a FlashCards deck/);
});

test('v1 share links still import', async () => {
  // Arrange: built exactly like v1's buildInlineShareURL
  const payload = JSON.stringify({ name: 'Español', cards: [['¿Qué?', 'What?'], ['sí', 'yes']] });
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  const href = 'https://example.github.io/FlashCards/?import=' + encodeURIComponent(encoded);

  // Act
  const link = readLegacyLink(href);
  const incoming = await fetchLegacyDeck(link);

  // Assert
  assert.equal(link.kind, 'inline');
  assert.deepEqual(incoming.decks[0].cards.map(c => [c.id, c.front, c.back, c.updatedAt]), [[null, '¿Qué?', 'What?', 0], [null, 'sí', 'yes', 0]]);
  assert.deepEqual(readLegacyLink('https://x.io/?store=AbC123'), { kind: 'store', key: 'AbC123', href: 'https://x.io/?store=AbC123' });
  assert.equal(readLegacyLink('https://x.io/?store=../evil'), null);
  assert.equal(readLegacyLink('not a url'), null);
});

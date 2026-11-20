import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, packEnvelope, unpackEnvelope } from '../js/envelope.js';
import { encodeFrames, FrameCollector } from '../js/frames.js';
import { SEND_MODES } from '../js/sender.js';
import { device, MemoryStore, liveView } from './helpers.mjs';
import { Library } from '../js/library.js';
import { makeDeck, rng } from './fixtures.mjs';

// Sender export -> deflate -> base45 frames -> lossy, shuffled delivery -> collector -> receiver merge.
for (const size of [500, 2000, 5000]) {
  test(`${size} cards survive the full QR round trip`, async t => {
    // Arrange
    const deck = makeDeck({ cards: size, seed: size });
    const store = new MemoryStore();
    store.decks.set(deck.id, { ...deck, cards: undefined });
    for (const c of deck.cards) store.cards.set(c.id, c);
    const sender = new Library(store, err => { throw err; });
    await sender.load();
    const receiver = await device();
    const random = rng(size);

    // Act
    const packed = await packEnvelope(buildEnvelope(sender.exportDecks()));
    const frames = encodeFrames(packed, SEND_MODES.normal.capacity);
    const collector = new FrameCollector();
    let result = null;
    let shown = 0;
    while (!result) {
      const frame = frames[shown++ % frames.length];
      if (random() < 0.25) continue;
      const r = collector.add(frame);
      if (r.status === 'complete') result = r;
    }
    const plan = receiver.planImport(await unpackEnvelope(result.payload));
    await receiver.applyImport(plan);

    // Assert
    assert.deepEqual(liveView(receiver), liveView(sender));
    assert.equal(plan.changes[0].added, size);
    t.diagnostic(`${size} cards: ${(packed.length / 1024).toFixed(1)} KB packed, ` +
      Object.entries(SEND_MODES).map(([name, m]) => `${name} ${encodeFrames(packed, m.capacity).length} frames`).join(', ') +
      `; with 25% of frames missed, ${shown} frames shown (${(shown / frames.length).toFixed(2)} loops of normal)`);
  });
}

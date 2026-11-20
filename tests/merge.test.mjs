import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { device, transfer, sync, liveView, deckByName, useClock } from './helpers.mjs';
import { parseEnvelope } from '../js/envelope.js';

let clock;
beforeEach(() => { clock = useClock(); });
afterEach(() => clock.restore());

async function pairWithDeck(cards) {
  const a = await device();
  const deck = a.createDeck('Spanish', cards);
  const b = await device();
  await sync(a, b);
  return { a, b, deckId: deck.id };
}

// v1 data as each device migrated it: same names and texts, different ids, updatedAt 0.
function v1Seed(prefix, cards, name = 'Spanish') {
  const deckId = `${prefix}-deck`;
  return {
    decks: [{ id: deckId, name, createdAt: 0, updatedAt: 0, deletedAt: 0 }],
    cards: cards.map(([front, back], i) => ({ id: `${prefix}-${i}`, deckId, front, back, createdAt: i, updatedAt: 0, deleted: false })),
  };
}

test('a first transfer creates the deck with the sender ids', async () => {
  // Arrange & Act
  const { a, b } = await pairWithDeck([{ front: 'hola', back: 'hello' }, { front: 'adiós', back: 'bye' }]);

  // Assert
  assert.deepEqual(liveView(b), liveView(a));
});

test('new cards arrive and nothing else changes', async () => {
  // Arrange
  const { a, b, deckId } = await pairWithDeck([{ front: 'hola', back: 'hello' }]);
  clock.advance();
  a.addCard(a.deck(deckId), 'gracias', 'thanks');

  // Act
  const plan = await transfer(a, b);
  await b.applyImport(plan);

  // Assert
  assert.deepEqual(plan.changes, [{ deckId, name: 'Spanish', kind: 'updated', renamedFrom: null, matchedByName: false, added: 1, changed: 0, removed: 0 }]);
  assert.deepEqual(liveView(b), liveView(a));
});

test('an edited back wins over the older copy, and an older edit loses', async () => {
  // Arrange
  const { a, b, deckId } = await pairWithDeck([{ front: 'hola', back: 'hello' }]);
  clock.advance();
  a.updateCard(a.deck(deckId).cards[0], 'hola', 'hi');

  // Act
  const plan = await transfer(a, b);
  await b.applyImport(plan);
  clock.advance();
  b.updateCard(b.deck(deckId).cards[0], 'hola', 'hello there');
  const back = await transfer(a, b);

  // Assert
  assert.equal(plan.changes[0].changed, 1);
  assert.equal(back.changes.length, 0);
  assert.equal(b.deck(deckId).cards[0].back, 'hello there');
});

test('a deletion propagates, but not over a newer edit', async () => {
  // Arrange
  const { a, b, deckId } = await pairWithDeck([{ front: 'uno', back: '1' }, { front: 'dos', back: '2' }]);
  clock.advance();
  const deckA = a.deck(deckId);
  a.deleteCard(deckA, deckA.cards[0]);
  a.deleteCard(deckA, deckA.cards[0]);
  clock.advance();
  b.updateCard(b.deck(deckId).cards[1], 'dos', 'two');

  // Act
  const plan = await sync(a, b);

  // Assert: 'uno' was deleted on A after B last saw it; 'dos' was edited on B after A deleted it.
  assert.equal(plan.changes[0].removed, 1);
  assert.deepEqual(b.deck(deckId).cards.map(c => [c.front, c.back]), [['dos', 'two']]);
});

test('a renamed deck keeps its cards and shows the old name', async () => {
  // Arrange
  const { a, b, deckId } = await pairWithDeck([{ front: 'hola', back: 'hello' }]);
  clock.advance();
  a.renameDeck(a.deck(deckId), 'Español');

  // Act
  const plan = await sync(a, b);

  // Assert
  assert.equal(plan.changes[0].renamedFrom, 'Spanish');
  assert.equal(b.deck(deckId).name, 'Español');
  assert.equal(b.deck(deckId).cards.length, 1);
});

test('v1-migrated decks with different ids merge by name and front, then adopt the sender ids', async () => {
  // Arrange
  const a = await device(v1Seed('a', [['hola', 'hi'], ['gracias', 'thanks']]));
  const b = await device(v1Seed('b', [['hola', 'hello'], ['adiós', 'bye']], 'spanish '));

  // Act
  const plan = await transfer(a, b);
  await b.applyImport(plan);
  const again = await transfer(a, b);
  const backToA = await sync(b, a);

  // Assert
  assert.deepEqual(plan.changes, [{ deckId: 'a-deck', name: 'Spanish', kind: 'updated', renamedFrom: 'spanish ', matchedByName: true, added: 1, changed: 1, removed: 0 }]);
  assert.equal(b.liveDecks().length, 1);
  assert.deepEqual(b.deck('a-deck').cards.map(c => [c.id, c.front, c.back]), [['a-0', 'hola', 'hi'], ['b-1', 'adiós', 'bye'], ['a-1', 'gracias', 'thanks']]);
  assert.equal(again.changes.length, 0);
  assert.equal(again.hasOps, false);
  assert.deepEqual(backToA.changes.map(c => [c.kind, c.added, c.matchedByName]), [['updated', 1, false]]);
  assert.deepEqual(new Set(liveView(a)[0].cards.map(String)), new Set(liveView(b)[0].cards.map(String)));
});

test('a v1 card deleted before the first v2 transfer stays deleted on both devices', async () => {
  // Arrange
  const a = await device(v1Seed('a', [['hola', 'hello'], ['adiós', 'bye']]));
  const b = await device(v1Seed('b', [['hola', 'hello'], ['adiós', 'bye']]));
  clock.advance();
  a.deleteCard(a.deck('a-deck'), a.deck('a-deck').cards[1]);

  // Act: B sends first, so its 'adiós' has no id A knows; then A answers.
  const toA = await sync(b, a);
  const toB = await sync(a, b);

  // Assert
  assert.equal(toA.changes.length, 0);
  assert.equal(toB.changes[0].removed, 1);
  assert.deepEqual(liveView(a), liveView(b));
  assert.deepEqual(a.deck('b-deck').cards.map(c => c.front), ['hola']);
});

test('a deleted deck propagates in "all decks", unless it changed here afterwards', async () => {
  // Arrange
  const a = await device();
  const keep = a.createDeck('Keep', [{ front: 'k', back: '' }]);
  const drop = a.createDeck('Drop', [{ front: 'd', back: '' }]);
  const edited = a.createDeck('Edited', [{ front: 'e', back: '' }]);
  const b = await device();
  await sync(a, b);
  clock.advance();
  a.deleteDeck(a.deck(drop.id));
  a.deleteDeck(a.deck(edited.id));
  clock.advance();
  b.addCard(b.deck(edited.id), 'newer', 'than the deletion');

  // Act
  const plan = await sync(a, b);

  // Assert
  assert.deepEqual(plan.changes.map(c => [c.name, c.kind, c.removed]), [['Drop', 'deleted', 1]]);
  assert.deepEqual(b.liveDecks().map(d => d.name), ['Keep', 'Edited']);
  assert.ok(keep);
});

test('a deck deleted here comes back when the other device changed it later', async () => {
  // Arrange
  const { a, b, deckId } = await pairWithDeck([{ front: 'hola', back: 'hello' }]);
  clock.advance();
  b.deleteDeck(b.deck(deckId));
  clock.advance();
  a.addCard(a.deck(deckId), 'nuevo', 'new');

  // Act
  const plan = await sync(a, b);

  // Assert
  assert.deepEqual(plan.changes.map(c => [c.kind, c.added]), [['restored', 2]]);
  assert.equal(b.deck(deckId).cards.length, 2);
});

test('a v1 share link adds new fronts to the same-named deck without duplicates', async () => {
  // Arrange
  const b = await device(v1Seed('b', [['hola', 'hello']]));
  clock.advance();
  b.updateCard(b.deck('b-deck').cards[0], 'hola', 'hello (edited in v2)');
  const incoming = parseEnvelope({ name: 'Spanish', cards: [['hola', 'hello'], ['gracias', 'thanks']] });

  // Act
  const plan = b.planImport(incoming);
  await b.applyImport(plan);

  // Assert
  assert.deepEqual(plan.changes.map(c => [c.kind, c.added, c.changed]), [['updated', 1, 0]]);
  assert.deepEqual(b.deck('b-deck').cards.map(c => [c.front, c.back]), [['hola', 'hello (edited in v2)'], ['gracias', 'thanks']]);
});

test('two devices that edit different cards converge after syncing both ways', async () => {
  // Arrange
  const { a, b, deckId } = await pairWithDeck([{ front: '1', back: 'one' }, { front: '2', back: 'two' }, { front: '3', back: 'three' }]);
  clock.advance();
  a.updateCard(a.deck(deckId).cards[0], '1', 'ONE');
  a.addCard(a.deck(deckId), '4', 'four');
  clock.advance();
  b.deleteCard(b.deck(deckId), b.deck(deckId).cards[2]);
  b.renameDeck(b.deck(deckId), 'Numbers');

  // Act
  await sync(a, b);
  await sync(b, a);

  // Assert
  assert.deepEqual(liveView(a), liveView(b));
  assert.deepEqual(deckByName(a, 'Numbers').cards.map(c => c.back), ['ONE', 'two', 'four']);
});

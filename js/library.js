import { newId } from './ids.js';
import { planImport } from './merge.js';

const byCreated = (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// A local edit must win over anything this device has already seen, even with a clock that runs behind.
const stamp = previous => Math.max(Date.now(), previous + 1);

// In-memory view of the IndexedDB data. Every change updates memory at once and writes only the
// records it touched. deck.cards holds the live cards in order, deck.tombstones the deleted ones.
export class Library {
  constructor(store, onSaveError) {
    this.store = store;
    this.onSaveError = onSaveError;
    this.decks = new Map();
    this.lastCreated = 0;
  }

  async load() {
    const { decks, cards } = await this.store.loadAll();
    this.decks = new Map();
    this.lastCreated = 0;
    for (const d of decks) this.decks.set(d.id, { ...d, cards: [], tombstones: [] });
    for (const c of cards) {
      const deck = this.decks.get(c.deckId);
      if (!deck) continue;
      (c.deleted ? deck.tombstones : deck.cards).push(c);
      this.lastCreated = Math.max(this.lastCreated, c.createdAt);
    }
    for (const deck of this.decks.values()) {
      deck.cards.sort(byCreated);
      this.lastCreated = Math.max(this.lastCreated, deck.createdAt);
    }
  }

  nextCreated() {
    this.lastCreated = Math.max(Date.now(), this.lastCreated + 1);
    return this.lastCreated;
  }

  save(ops) {
    return this.store.write(ops).catch(err => this.onSaveError(err));
  }

  liveDecks() {
    return [...this.decks.values()].filter(d => !d.deletedAt).sort(byCreated);
  }

  deck(id) {
    const deck = this.decks.get(id);
    return deck && !deck.deletedAt ? deck : null;
  }

  createDeck(name, cards = []) {
    const now = Date.now();
    const deck = { id: newId(), name, createdAt: this.nextCreated(), updatedAt: now, deletedAt: 0, cards: [], tombstones: [] };
    for (const c of cards) {
      deck.cards.push({ id: newId(), deckId: deck.id, front: c.front, back: c.back, createdAt: this.nextCreated(), updatedAt: now, deleted: false });
    }
    this.decks.set(deck.id, deck);
    this.save({ deckPuts: [deckRecord(deck)], cardPuts: deck.cards });
    return deck;
  }

  renameDeck(deck, name) {
    deck.name = name;
    deck.updatedAt = stamp(deck.updatedAt);
    this.save({ deckPuts: [deckRecord(deck)] });
  }

  // The deck tombstone stands for its cards, so the cards themselves are dropped.
  deleteDeck(deck) {
    const latest = deck.cards.reduce((m, c) => Math.max(m, c.updatedAt), deck.updatedAt);
    deck.deletedAt = stamp(latest);
    const cardDeletes = [...deck.cards, ...deck.tombstones].map(c => c.id);
    deck.cards = [];
    deck.tombstones = [];
    this.save({ deckPuts: [deckRecord(deck)], cardDeletes });
  }

  addCard(deck, front, back) {
    const now = Date.now();
    const card = { id: newId(), deckId: deck.id, front, back, createdAt: this.nextCreated(), updatedAt: now, deleted: false };
    deck.cards.push(card);
    this.save({ cardPuts: [card] });
    return card;
  }

  updateCard(card, front, back) {
    card.front = front;
    card.back = back;
    card.updatedAt = stamp(card.updatedAt);
    this.save({ cardPuts: [card] });
  }

  // Tombstones keep the front: see envelope.js.
  deleteCard(deck, card) {
    const i = deck.cards.indexOf(card);
    if (i >= 0) deck.cards.splice(i, 1);
    card.deleted = true;
    card.back = '';
    card.updatedAt = stamp(card.updatedAt);
    deck.tombstones.push(card);
    this.save({ cardPuts: [card] });
  }

  // deckIds null = everything, including deleted decks, so deletions reach the other device.
  exportDecks(deckIds = null) {
    const decks = deckIds ? deckIds.map(id => this.decks.get(id)).filter(Boolean) : [...this.decks.values()].sort(byCreated);
    return decks.map(d => ({ ...deckRecord(d), cards: d.deletedAt ? [] : [...d.cards, ...d.tombstones] }));
  }

  planImport(incoming) {
    return planImport(this.exportDecks(), incoming, { now: this.nextCreated(), newId });
  }

  async applyImport(plan) {
    await this.store.write(plan.ops);
    await this.load();
  }
}

function deckRecord(d) {
  return { id: d.id, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt, deletedAt: d.deletedAt };
}

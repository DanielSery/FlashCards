import { Library } from '../js/library.js';
import { buildEnvelope, packEnvelope, unpackEnvelope } from '../js/envelope.js';

// Same interface as js/store.js, kept in memory. Writes apply synchronously like a committed transaction.
export class MemoryStore {
  constructor() {
    this.decks = new Map();
    this.cards = new Map();
  }

  loadAll() {
    return Promise.resolve({
      decks: [...this.decks.values()].map(d => ({ ...d })),
      cards: [...this.cards.values()].map(c => ({ ...c })),
    });
  }

  write({ deckPuts = [], deckDeletes = [], cardPuts = [], cardDeletes = [] }) {
    for (const id of deckDeletes) this.decks.delete(id);
    for (const id of cardDeletes) this.cards.delete(id);
    for (const d of deckPuts) this.decks.set(d.id, { ...d });
    for (const c of cardPuts) this.cards.set(c.id, { ...c });
    return Promise.resolve();
  }
}

export async function device(seed = {}) {
  const store = new MemoryStore();
  for (const d of seed.decks || []) store.decks.set(d.id, d);
  for (const c of seed.cards || []) store.cards.set(c.id, c);
  const library = new Library(store, err => { throw err; });
  await library.load();
  return library;
}

// Sender export -> packed bytes -> receiver plan, exactly as the QR and file paths do.
export async function transfer(from, to, deckIds = null) {
  const packed = await packEnvelope(buildEnvelope(from.exportDecks(deckIds)));
  return to.planImport(await unpackEnvelope(packed));
}

export async function sync(from, to, deckIds = null) {
  const plan = await transfer(from, to, deckIds);
  await to.applyImport(plan);
  return plan;
}

export function liveView(library) {
  return library.liveDecks().map(d => ({ id: d.id, name: d.name, cards: d.cards.map(c => [c.id, c.front, c.back]) }));
}

export function deckByName(library, name) {
  return library.liveDecks().find(d => d.name === name);
}

// Library stamps with Date.now(); tests drive time explicitly so "later" is unambiguous.
export function useClock(start = 1_700_000_000_000) {
  const original = Date.now;
  let now = start;
  Date.now = () => now;
  return {
    advance(ms = 1000) { now += ms; },
    restore() { Date.now = original; },
  };
}

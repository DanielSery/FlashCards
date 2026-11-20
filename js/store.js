import { newId } from './ids.js';

const DB_NAME = 'flashcards';
const DB_VERSION = 1;
const V1_DATA_KEY = 'flashcards_data';

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Saving was cancelled'));
  });
}

export async function openStore() {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('decks', { keyPath: 'id' });
      db.createObjectStore('cards', { keyPath: 'id' }).createIndex('deckId', 'deckId');
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.onversionchange = () => db.close();
  return new Store(db);
}

class Store {
  constructor(db) {
    this.db = db;
  }

  async loadAll() {
    const tx = this.db.transaction(['decks', 'cards'], 'readonly');
    const [decks, cards] = await Promise.all([
      request(tx.objectStore('decks').getAll()),
      request(tx.objectStore('cards').getAll()),
    ]);
    return { decks, cards };
  }

  getMeta(key) {
    return request(this.db.transaction('meta', 'readonly').objectStore('meta').get(key));
  }

  // Deletes run before puts, so a record can move to a new id in one call.
  async write({ deckPuts = [], deckDeletes = [], cardPuts = [], cardDeletes = [], meta = {} }) {
    const tx = this.db.transaction(['decks', 'cards', 'meta'], 'readwrite');
    const decks = tx.objectStore('decks');
    const cards = tx.objectStore('cards');
    for (const id of deckDeletes) decks.delete(id);
    for (const id of cardDeletes) cards.delete(id);
    for (const d of deckPuts) decks.put(d);
    for (const c of cardPuts) cards.put(c);
    for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put(value, key);
    return finished(tx);
  }

  // v1 kept everything in one localStorage JSON string. It is left in place as a backup.
  // Migrated records get updatedAt 0 ("unknown"), so any later v2 edit wins over them.
  async migrateV1() {
    if (await this.getMeta('v1Migrated')) return 0;
    let v1Decks = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(V1_DATA_KEY) || '[]');
      if (Array.isArray(parsed)) v1Decks = parsed;
    } catch { /* unreadable v1 data: nothing to migrate */ }

    const seen = new Set();
    const uniqueId = id => {
      const out = typeof id === 'string' && id && !seen.has(id) ? id : newId();
      seen.add(out);
      return out;
    };
    const deckPuts = [];
    const cardPuts = [];
    v1Decks.forEach((deck, i) => {
      if (!deck || typeof deck.name !== 'string') return;
      const deckId = uniqueId(deck.id);
      deckPuts.push({ id: deckId, name: deck.name, createdAt: i, updatedAt: 0, deletedAt: 0 });
      (Array.isArray(deck.cards) ? deck.cards : []).forEach((card, j) => {
        if (!card || typeof card.front !== 'string') return;
        cardPuts.push({
          id: uniqueId(card.id), deckId, front: card.front, back: typeof card.back === 'string' ? card.back : '',
          createdAt: j, updatedAt: 0, deleted: false,
        });
      });
    });
    await this.write({ deckPuts, cardPuts, meta: { v1Migrated: Date.now() } });
    return deckPuts.length;
  }
}

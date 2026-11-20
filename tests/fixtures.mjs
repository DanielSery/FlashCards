// Deterministic test decks: pseudo-words from a fixed vocabulary, random ids, edits spread over 90 days.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo', 'ze', 'pra', 'sto', 'dle', 'ch', 'an', 'el', 'is', 'or', 'um', 'ber', 'gen', 'ung', 'ité', 'ción', 'mente'];

export function makeVocabulary(random, size = 3000) {
  const words = [];
  for (let i = 0; i < size; i++) {
    const n = 1 + Math.floor(random() * 3);
    let w = '';
    for (let j = 0; j < n; j++) w += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
    words.push(w);
  }
  return words;
}

export function makeId(random) {
  let s = '';
  for (let i = 0; i < 10; i++) s += Math.floor(random() * 36).toString(36);
  return s;
}

export function makeDeck({ cards, seed = 1, name = 'Generated', now = 1_763_000_000_000 }) {
  const random = rng(seed);
  const vocab = makeVocabulary(random);
  const phrase = (min, max) => {
    const n = min + Math.floor(random() * (max - min + 1));
    const out = [];
    for (let i = 0; i < n; i++) out.push(vocab[Math.floor(random() * vocab.length)]);
    return out.join(' ');
  };
  const deckId = makeId(random);
  const list = [];
  for (let i = 0; i < cards; i++) {
    list.push({
      id: makeId(random),
      deckId,
      front: phrase(1, 3),
      back: phrase(1, 5),
      createdAt: now - 90 * 86_400_000 + i,
      updatedAt: now - Math.floor(random() * 90 * 86_400_000),
      deleted: false,
    });
  }
  return { id: deckId, name, createdAt: now - 90 * 86_400_000, updatedAt: now - 80 * 86_400_000, deletedAt: 0, cards: list };
}

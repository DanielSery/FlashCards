// Plans how an incoming transfer changes the local library, without touching it.
// Per card: last writer wins by updatedAt. Decks from v1 have different ids on every device,
// so a deck with no id match falls back to its name, and its cards to their front text;
// the local records then adopt the sender's ids so later transfers match by id.

const normName = s => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const normFront = s => s.trim().replace(/\s+/g, ' ');

function sameContent(a, b) {
  return a.deleted === b.deleted && (a.deleted || (a.front === b.front && a.back === b.back));
}

function contentKey(c) {
  return JSON.stringify([c.deleted, c.front, c.back]);
}

// Equal timestamps with different content: 0 means "unknown, migrated from v1", where the sender's
// deliberate transfer wins; otherwise a content comparison makes both devices pick the same side.
function incomingWins(ic, lc) {
  if (ic.updatedAt !== lc.updatedAt) return ic.updatedAt > lc.updatedAt;
  if (sameContent(ic, lc)) return false;
  return ic.updatedAt === 0 || contentKey(ic) > contentKey(lc);
}

function deckRecord(deck) {
  return { id: deck.id, name: deck.name, createdAt: deck.createdAt, updatedAt: deck.updatedAt, deletedAt: deck.deletedAt };
}

function cardChanged(next, lc) {
  return next.id !== lc.id || next.deckId !== lc.deckId || next.updatedAt !== lc.updatedAt || !sameContent(next, lc);
}

export function planImport(localDecks, incoming, { now = Date.now(), newId }) {
  const decksById = new Map(localDecks.map(d => [d.id, d]));
  const cardsById = new Map();
  for (const d of localDecks) for (const c of d.cards) cardsById.set(c.id, c);
  const incomingDeckIds = new Set(incoming.decks.map(d => d.id).filter(Boolean));
  const claimedDecks = new Set();
  const seenDecks = new Set();
  const seenCards = new Set();
  let clock = now;
  const ops = { deckPuts: [], deckDeletes: [], cardPuts: [], cardDeletes: [] };
  const changes = [];
  let unchanged = 0;

  function mergeCards(targetId, sourceId, localCards, incomingCards, frontFallback) {
    const counts = { added: 0, changed: 0, removed: 0 };
    const matched = new Set();
    const pairs = [];
    const unmatched = [];

    for (const ic of incomingCards) {
      if (ic.id) {
        if (seenCards.has(ic.id)) continue;
        seenCards.add(ic.id);
      }
      const lc = ic.id ? cardsById.get(ic.id) : undefined;
      if (lc && !matched.has(lc.id)) {
        matched.add(lc.id);
        pairs.push([ic, lc]);
      } else {
        unmatched.push(ic);
      }
    }

    const byFront = new Map();
    const live = localCards.filter(c => !c.deleted);
    const dead = localCards.filter(c => c.deleted);
    for (const lc of [...live, ...dead]) {
      if (matched.has(lc.id)) continue;
      const key = normFront(lc.front);
      if (!key) continue;
      if (!byFront.has(key)) byFront.set(key, []);
      byFront.get(key).push(lc);
    }
    for (const ic of unmatched) {
      if ((frontFallback || !ic.id) && ic.front) {
        const lc = byFront.get(normFront(ic.front))?.shift();
        if (lc) {
          matched.add(lc.id);
          pairs.push([ic, lc]);
          continue;
        }
      }
      pairs.push([ic, null]);
    }

    for (const [ic, lc] of pairs) {
      if (!lc) {
        if (ic.deleted) continue;
        const id = ic.id && !cardsById.has(ic.id) ? ic.id : newId();
        ops.cardPuts.push({
          id, deckId: targetId, front: ic.front, back: ic.back,
          createdAt: clock++, updatedAt: ic.updatedAt, deleted: false,
        });
        counts.added++;
        continue;
      }
      const wins = incomingWins(ic, lc);
      const w = wins ? ic : lc;
      const next = {
        id: ic.id || lc.id,
        deckId: wins || lc.deckId === sourceId || lc.deckId === targetId ? targetId : lc.deckId,
        front: w.deleted ? (w.front || lc.front) : w.front,
        back: w.deleted ? '' : w.back,
        createdAt: lc.createdAt,
        updatedAt: w.updatedAt,
        deleted: w.deleted,
      };
      if (wins && !sameContent(ic, lc)) {
        if (ic.deleted) counts.removed++;
        else if (lc.deleted) counts.added++;
        else counts.changed++;
      }
      if (next.id !== lc.id) ops.cardDeletes.push(lc.id);
      if (cardChanged(next, lc)) ops.cardPuts.push(next);
    }

    for (const lc of localCards) {
      if (!matched.has(lc.id) && lc.deckId !== targetId) ops.cardPuts.push({ ...lc, deckId: targetId });
    }
    return counts;
  }

  for (const inc of incoming.decks) {
    if (inc.id) {
      if (seenDecks.has(inc.id)) continue;
      seenDecks.add(inc.id);
    }
    let local = inc.id ? decksById.get(inc.id) : undefined;
    let byName = false;
    if (!local && !inc.deletedAt) {
      const key = normName(inc.name);
      local = localDecks.find(d => !d.deletedAt && !claimedDecks.has(d.id) && !incomingDeckIds.has(d.id) && normName(d.name) === key);
      byName = Boolean(local);
    }
    if (local) {
      if (claimedDecks.has(local.id)) local = undefined;
      else claimedDecks.add(local.id);
    }
    const liveCount = deck => deck.cards.filter(c => !c.deleted).length;

    if (inc.deletedAt) {
      if (!local || local.deletedAt) { unchanged++; continue; }
      const latest = local.cards.reduce((m, c) => Math.max(m, c.updatedAt), local.updatedAt);
      if (inc.deletedAt <= latest) { unchanged++; continue; }
      ops.deckPuts.push({ ...deckRecord(local), deletedAt: inc.deletedAt });
      for (const c of local.cards) ops.cardDeletes.push(c.id);
      changes.push({ deckId: local.id, name: local.name, kind: 'deleted', added: 0, changed: 0, removed: liveCount(local) });
      continue;
    }

    if (!local) {
      const id = inc.id && !decksById.has(inc.id) ? inc.id : newId();
      ops.deckPuts.push({ id, name: inc.name, createdAt: clock++, updatedAt: inc.updatedAt, deletedAt: 0 });
      const counts = mergeCards(id, id, [], inc.cards, false);
      changes.push({ deckId: id, name: inc.name, kind: 'new', ...counts });
      continue;
    }

    if (local.deletedAt) {
      const latest = inc.cards.reduce((m, c) => Math.max(m, c.updatedAt), inc.updatedAt);
      if (latest <= local.deletedAt) { unchanged++; continue; }
      ops.deckPuts.push({ ...deckRecord(local), name: inc.name, updatedAt: inc.updatedAt, deletedAt: 0 });
      const counts = mergeCards(local.id, local.id, local.cards, inc.cards, false);
      changes.push({ deckId: local.id, name: inc.name, kind: 'restored', ...counts });
      continue;
    }

    const targetId = byName && inc.id ? inc.id : local.id;
    const nameWins = inc.updatedAt > local.updatedAt ||
      (inc.updatedAt === local.updatedAt && inc.name !== local.name && (inc.updatedAt === 0 || inc.name > local.name));
    const next = { ...deckRecord(local), id: targetId };
    if (nameWins) {
      next.name = inc.name;
      next.updatedAt = inc.updatedAt;
    }
    const renamedFrom = next.name !== local.name ? local.name : null;
    if (targetId !== local.id) ops.deckDeletes.push(local.id);
    if (targetId !== local.id || next.name !== local.name || next.updatedAt !== local.updatedAt) ops.deckPuts.push(next);
    const counts = mergeCards(targetId, local.id, local.cards, inc.cards, byName);
    if (renamedFrom || counts.added || counts.changed || counts.removed) {
      changes.push({ deckId: targetId, name: next.name, kind: 'updated', renamedFrom, matchedByName: byName, ...counts });
    } else {
      unchanged++;
    }
  }

  const hasOps = ops.deckPuts.length + ops.deckDeletes.length + ops.cardPuts.length + ops.cardDeletes.length > 0;
  return { changes, unchanged, ops, hasOps };
}

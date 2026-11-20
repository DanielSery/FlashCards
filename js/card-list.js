// Card list that stays responsive with thousands of cards: rows are created in pages as the
// user scrolls, and edits touch only their own row instead of rebuilding the list.
const PAGE = 150;

const EDIT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';

const rowTemplate = document.createElement('template');
rowTemplate.innerHTML = `<li class="card-row"><div class="card-text"><div class="card-front"></div><div class="card-preview"></div></div><button class="btn-card-edit" aria-label="Edit card">${EDIT_ICON}</button></li>`;

const normalize = s => s.toLocaleLowerCase();

export class CardList {
  constructor(listEl, { onEdit, onAdd }) {
    this.listEl = listEl;
    this.onEdit = onEdit;
    this.onAdd = onAdd;
    this.deck = null;
    this.items = [];
    this.rendered = 0;
    this.rows = new Map();
    this.query = '';
    this.sentinel = document.createElement('li');
    this.sentinel.className = 'list-sentinel';
    this.observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) this.renderMore();
    }, { rootMargin: '800px 0px' });

    listEl.addEventListener('click', e => {
      const row = e.target.closest('li');
      if (!row) return;
      if (row.classList.contains('add-card-item')) return this.onAdd();
      const card = this.cardById(row.dataset.id);
      if (card) this.onEdit(card);
    });
  }

  get matchCount() {
    return this.items.length;
  }

  matches(card) {
    return !this.query || normalize(card.front).includes(this.query) || normalize(card.back).includes(this.query);
  }

  cardById(id) {
    return this.deck?.cards.find(c => c.id === id);
  }

  show(deck, query = '') {
    this.deck = deck;
    this.query = normalize(query.trim());
    this.items = deck ? deck.cards.filter(c => this.matches(c)) : [];
    this.rendered = 0;
    this.rows.clear();
    this.observer.disconnect();
    this.listEl.replaceChildren();
    if (!this.items.length) return;
    if (!this.query) this.listEl.append(addItem());
    this.renderMore();
  }

  renderMore() {
    this.observer.disconnect();
    this.sentinel.remove();
    const end = Math.min(this.items.length, this.rendered + PAGE);
    const frag = document.createDocumentFragment();
    for (let i = this.rendered; i < end; i++) frag.append(this.row(this.items[i]));
    this.rendered = end;
    if (end < this.items.length) {
      frag.append(this.sentinel);
      this.listEl.append(frag);
      this.observer.observe(this.sentinel);
    } else {
      if (!this.query) frag.append(addItem());
      this.listEl.append(frag);
    }
  }

  row(card) {
    const li = rowTemplate.content.firstElementChild.cloneNode(true);
    li.dataset.id = card.id;
    fill(li, card);
    this.rows.set(card.id, li);
    return li;
  }

  cardAdded(card) {
    if (!this.matches(card)) return;
    if (!this.items.length) return this.show(this.deck, this.query);
    const complete = this.rendered === this.items.length;
    this.items.push(card);
    if (!complete) return;
    const last = this.listEl.lastElementChild;
    this.listEl.insertBefore(this.row(card), last?.classList.contains('add-card-item') ? last : null);
    this.rendered++;
  }

  cardUpdated(card) {
    const li = this.rows.get(card.id);
    if (li) fill(li, card);
  }

  cardRemoved(card) {
    const i = this.items.indexOf(card);
    if (i < 0) return;
    this.items.splice(i, 1);
    const li = this.rows.get(card.id);
    if (li) {
      li.remove();
      this.rows.delete(card.id);
      this.rendered--;
    }
    if (!this.items.length) this.listEl.replaceChildren();
  }
}

function fill(li, card) {
  li.querySelector('.card-front').textContent = card.front;
  li.querySelector('.card-preview').textContent = card.back;
}

function addItem() {
  const li = document.createElement('li');
  li.className = 'add-card-item';
  li.innerHTML = '<span class="add-card-icon">&#43;</span> Add card';
  return li;
}

// ── State ──
let state = {
  decks: [],          // [{ id, name, cards: [{ id, front, back }] }]
  currentDeckId: null,
  studyIndex: 0,
  studyOrder: [],     // shuffled indices
};

const STORAGE_KEY = 'flashcards_data';

// ── Persistence ──
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.decks));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.decks = JSON.parse(raw);
  } catch { state.decks = []; }
}

// ── Helpers ──
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function currentDeck() {
  return state.decks.find(d => d.id === state.currentDeckId) || null;
}

// ── DOM refs ──
const viewDecks = $('#view-decks');
const viewStudy = $('#view-study');
const viewCards = $('#view-cards');
const deckListEl = $('#deck-list');
const cardListEl = $('#card-list');
const emptyDecks = $('#empty-decks');
const emptyCards = $('#empty-cards');
const headerTitle = $('#header-title');
const btnAdd = $('#btn-add');
const btnMenu = $('#btn-menu');
const sideMenu = $('#side-menu');
const menuOverlay = $('#menu-overlay');
const menuDeckList = $('#menu-deck-list');
const modal = $('#modal');
const modalOverlay = $('#modal-overlay');
const modalTitle = $('#modal-title');
const modalForm = $('#modal-form');
const inputFront = $('#input-front');
const inputBack = $('#input-back');
const labelFront = $('#label-front');
const labelBack = $('#label-back');
const btnModalDelete = $('#btn-modal-delete');
const btnModalCancel = $('#btn-modal-cancel');
const flashcard = $('#flashcard');
const cardFrontText = $('#card-front-text');
const cardBackText = $('#card-back-text');
const studyCounter = $('#study-counter');
const progressFill = $('#progress-fill');
const btnStudy = $('#btn-study');

// ── View management ──
function showView(name) {
  [viewDecks, viewStudy, viewCards].forEach(v => v.classList.remove('active'));
  if (name === 'decks') {
    viewDecks.classList.add('active');
    headerTitle.textContent = 'FlashCards';
    btnAdd.innerHTML = '&#43;';
    btnAdd.onclick = () => openDeckModal();
  } else if (name === 'cards') {
    viewCards.classList.add('active');
    const deck = currentDeck();
    headerTitle.textContent = deck ? deck.name : 'Cards';
    btnAdd.innerHTML = '&#43;';
    btnAdd.onclick = () => openCardModal();
  } else if (name === 'study') {
    viewStudy.classList.add('active');
    headerTitle.textContent = 'Study';
    btnAdd.innerHTML = '&#10005;';
    btnAdd.onclick = () => showView('cards');
  }
}

// ── Render decks ──
function renderDecks() {
  deckListEl.innerHTML = '';
  menuDeckList.innerHTML = '';

  if (state.decks.length === 0) {
    emptyDecks.style.display = '';
    deckListEl.style.display = 'none';
  } else {
    emptyDecks.style.display = 'none';
    deckListEl.style.display = '';
    state.decks.forEach(deck => {
      // Main list
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <div class="deck-name">${esc(deck.name)}</div>
          <div class="deck-count">${deck.cards.length} card${deck.cards.length !== 1 ? 's' : ''}</div>
        </div>
        <span style="font-size:1.3rem;color:var(--text-light)">&#8250;</span>`;
      li.onclick = () => { state.currentDeckId = deck.id; renderCards(); showView('cards'); };
      deckListEl.appendChild(li);

      // Side menu
      const mli = document.createElement('li');
      mli.textContent = deck.name;
      if (deck.id === state.currentDeckId) mli.classList.add('active');
      mli.onclick = () => { state.currentDeckId = deck.id; closeMenu(); renderCards(); showView('cards'); };
      menuDeckList.appendChild(mli);
    });
  }
}

// ── Render cards ──
function renderCards() {
  const deck = currentDeck();
  cardListEl.innerHTML = '';
  if (!deck || deck.cards.length === 0) {
    emptyCards.style.display = '';
    cardListEl.style.display = 'none';
    btnStudy.style.display = 'none';
  } else {
    emptyCards.style.display = 'none';
    cardListEl.style.display = '';
    btnStudy.style.display = '';
    deck.cards.forEach(card => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div style="min-width:0">
          <div style="font-weight:600">${esc(card.front)}</div>
          <div class="card-preview">${esc(card.back)}</div>
        </div>`;
      li.onclick = () => openCardModal(card);
      cardListEl.appendChild(li);
    });
  }
}

// ── Study mode ──
function startStudy() {
  const deck = currentDeck();
  if (!deck || deck.cards.length === 0) return;
  state.studyOrder = [...Array(deck.cards.length).keys()];
  shuffleArray(state.studyOrder);
  state.studyIndex = 0;
  showView('study');
  showStudyCard();
}

function showStudyCard() {
  const deck = currentDeck();
  if (!deck) return;
  const total = deck.cards.length;
  const idx = state.studyOrder[state.studyIndex];
  const card = deck.cards[idx];
  cardFrontText.textContent = card.front;
  cardBackText.textContent = card.back;
  flashcard.classList.remove('flipped');
  studyCounter.textContent = `${state.studyIndex + 1} / ${total}`;
  progressFill.style.width = `${((state.studyIndex + 1) / total) * 100}%`;
}

function studyNext() {
  const deck = currentDeck();
  if (!deck) return;
  if (state.studyIndex < deck.cards.length - 1) {
    state.studyIndex++;
    showStudyCard();
  }
}

function studyPrev() {
  if (state.studyIndex > 0) {
    state.studyIndex--;
    showStudyCard();
  }
}

function studyShuffle() {
  const deck = currentDeck();
  if (!deck) return;
  shuffleArray(state.studyOrder);
  state.studyIndex = 0;
  showStudyCard();
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Modal: Deck ──
let modalMode = null; // 'deck-new', 'deck-edit', 'card-new', 'card-edit'
let editTarget = null;

function openDeckModal(deck) {
  modalMode = deck ? 'deck-edit' : 'deck-new';
  editTarget = deck || null;
  modalTitle.textContent = deck ? 'Edit Deck' : 'New Deck';
  labelFront.textContent = 'Deck Name';
  inputFront.value = deck ? deck.name : '';
  inputFront.setAttribute('rows', '1');
  labelBack.style.display = 'none';
  inputBack.style.display = 'none';
  btnModalDelete.style.display = deck ? '' : 'none';
  openModal();
}

function openCardModal(card) {
  modalMode = card ? 'card-edit' : 'card-new';
  editTarget = card || null;
  modalTitle.textContent = card ? 'Edit Card' : 'New Card';
  labelFront.textContent = 'Front';
  labelBack.textContent = 'Back';
  labelBack.style.display = '';
  inputBack.style.display = '';
  inputFront.setAttribute('rows', '3');
  inputFront.value = card ? card.front : '';
  inputBack.value = card ? card.back : '';
  btnModalDelete.style.display = card ? '' : 'none';
  openModal();
}

function openModal() {
  modal.classList.add('open');
  modalOverlay.classList.add('open');
  setTimeout(() => inputFront.focus(), 100);
}

function closeModal() {
  modal.classList.remove('open');
  modalOverlay.classList.remove('open');
  inputFront.value = '';
  inputBack.value = '';
}

function handleSave(e) {
  e.preventDefault();
  if (modalMode === 'deck-new') {
    const name = inputFront.value.trim();
    if (!name) return;
    const deck = { id: uid(), name, cards: [] };
    state.decks.push(deck);
    state.currentDeckId = deck.id;
    save(); renderDecks(); renderCards(); showView('cards');
  } else if (modalMode === 'deck-edit') {
    const name = inputFront.value.trim();
    if (!name || !editTarget) return;
    editTarget.name = name;
    save(); renderDecks(); renderCards();
  } else if (modalMode === 'card-new') {
    const front = inputFront.value.trim();
    const back = inputBack.value.trim();
    if (!front) return;
    const deck = currentDeck();
    if (!deck) return;
    deck.cards.push({ id: uid(), front, back });
    save(); renderCards();
    // Keep modal open for quick multi-add
    inputFront.value = '';
    inputBack.value = '';
    inputFront.focus();
    return; // don't close modal
  } else if (modalMode === 'card-edit') {
    const front = inputFront.value.trim();
    const back = inputBack.value.trim();
    if (!front || !editTarget) return;
    editTarget.front = front;
    editTarget.back = back;
    save(); renderCards();
  }
  closeModal();
}

function handleDelete() {
  if (modalMode === 'deck-edit' && editTarget) {
    state.decks = state.decks.filter(d => d.id !== editTarget.id);
    state.currentDeckId = null;
    save(); renderDecks(); showView('decks');
  } else if (modalMode === 'card-edit' && editTarget) {
    const deck = currentDeck();
    if (deck) {
      deck.cards = deck.cards.filter(c => c.id !== editTarget.id);
      save(); renderCards();
    }
  }
  closeModal();
}

// ── Side menu ──
function openMenu() {
  sideMenu.classList.add('open');
  menuOverlay.classList.add('open');
  renderDecks();
}

function closeMenu() {
  sideMenu.classList.remove('open');
  menuOverlay.classList.remove('open');
}

// ── Swipe support ──
let touchStartX = 0;
let touchStartY = 0;

function setupSwipe() {
  const container = $('#card-container');
  container.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) studyNext();
      else studyPrev();
    }
  }, { passive: true });
}

// ── Escape HTML ──
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Long-press deck name to edit ──
function setupDeckLongPress() {
  headerTitle.addEventListener('click', () => {
    const deck = currentDeck();
    if (deck && viewCards.classList.contains('active')) {
      openDeckModal(deck);
    } else if (viewCards.classList.contains('active') || viewStudy.classList.contains('active')) {
      // go back
    } else {
      // do nothing on decks view
    }
  });
}

// ── Event listeners ──
function init() {
  load();
  renderDecks();

  btnMenu.onclick = openMenu;
  menuOverlay.onclick = closeMenu;
  modalOverlay.onclick = closeModal;
  btnModalCancel.onclick = closeModal;
  modalForm.onsubmit = handleSave;
  btnModalDelete.onclick = handleDelete;
  $('#btn-create-deck').onclick = () => openDeckModal();
  $('#btn-add-first-card').onclick = () => openCardModal();
  $('#menu-create-deck').onclick = () => { closeMenu(); openDeckModal(); };
  btnStudy.onclick = startStudy;
  flashcard.onclick = () => flashcard.classList.toggle('flipped');
  $('#btn-next').onclick = studyNext;
  $('#btn-prev').onclick = studyPrev;
  $('#btn-shuffle').onclick = studyShuffle;

  setupSwipe();
  setupDeckLongPress();

  // Back navigation
  window.addEventListener('popstate', () => {
    if (modal.classList.contains('open')) { closeModal(); }
    else if (viewStudy.classList.contains('active')) { showView('cards'); }
    else if (viewCards.classList.contains('active')) { showView('decks'); renderDecks(); }
  });

  // Push state on view changes so back button works
  const origShowView = showView;
  window.showView = showView;

  // Keyboard navigation in study
  document.addEventListener('keydown', e => {
    if (!viewStudy.classList.contains('active')) return;
    if (e.key === 'ArrowLeft') studyPrev();
    else if (e.key === 'ArrowRight') studyNext();
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flashcard.classList.toggle('flipped'); }
  });
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();

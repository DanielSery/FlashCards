// ── State ──
let state = {
  decks: [],          // [{ id, name, cards: [{ id, front, back }] }]
  currentDeckId: null,
  studyIndex: 0,
  studyOrder: [],
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

function isMobile() {
  return window.innerWidth <= 600;
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
    btnAdd.onclick = () => openCreator();
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
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <div class="deck-name">${esc(deck.name)}</div>
          <div class="deck-count">${deck.cards.length} card${deck.cards.length !== 1 ? 's' : ''}</div>
        </div>
        <span style="font-size:1.3rem;color:var(--text-light)">&#8250;</span>`;
      li.onclick = () => { state.currentDeckId = deck.id; renderCards(); showView('cards'); };
      deckListEl.appendChild(li);

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

// ── Card Modal (single card add/edit) ──
let modalMode = null;
let editTarget = null;

function openDeckEditModal(deck) {
  modalMode = 'deck-edit';
  editTarget = deck;
  modalTitle.textContent = 'Edit Deck';
  labelFront.textContent = 'Deck Name';
  inputFront.value = deck.name;
  inputFront.setAttribute('rows', '1');
  labelBack.style.display = 'none';
  inputBack.style.display = 'none';
  btnModalDelete.style.display = '';
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
  if (modalMode === 'deck-edit') {
    const name = inputFront.value.trim();
    if (!name || !editTarget) return;
    editTarget.name = name;
    save(); renderDecks(); renderCards();
    headerTitle.textContent = name;
  } else if (modalMode === 'card-new') {
    const front = inputFront.value.trim();
    const back = inputBack.value.trim();
    if (!front) return;
    const deck = currentDeck();
    if (!deck) return;
    deck.cards.push({ id: uid(), front, back });
    save(); renderCards();
    inputFront.value = '';
    inputBack.value = '';
    inputFront.focus();
    return;
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

// ── Deck Creator (PC: text field for bulk cards + QR) ──
function openCreator() {
  const creatorModal = $('#creator-modal');
  const creatorOverlay = $('#creator-overlay');
  $('#creator-name').value = '';
  $('#creator-cards').value = '';
  $('#creator-preview-count').textContent = '';
  $('#creator-form').style.display = '';
  $('#creator-qr-section').style.display = 'none';
  $('#creator-title').textContent = 'Create Deck';
  creatorModal.classList.add('open');
  creatorOverlay.classList.add('open');
  setTimeout(() => $('#creator-name').focus(), 100);
}

function closeCreator() {
  $('#creator-modal').classList.remove('open');
  $('#creator-overlay').classList.remove('open');
}

function handleCreatorSave(e) {
  e.preventDefault();
  const name = $('#creator-name').value.trim();
  const cardsText = $('#creator-cards').value.trim();
  if (!name) return;

  const cards = parseCSVText(cardsText);
  const deck = { id: uid(), name, cards };
  state.decks.push(deck);
  state.currentDeckId = deck.id;
  save(); renderDecks(); renderCards();

  // Show QR code
  showCreatorQR(deck);
}

async function showCreatorQR(deck) {
  $('#creator-form').style.display = 'none';
  const qrSection = $('#creator-qr-section');
  qrSection.style.display = '';
  $('#creator-title').textContent = `"${deck.name}" created (${deck.cards.length} cards)`;

  const qrContainer = $('#creator-qr-container');
  qrContainer.innerHTML = '<p style="color:var(--text-light)">Uploading deck…</p>';
  $('#creator-link').value = '';

  const shareUrl = await buildShareURL(deck);

  try {
    qrContainer.innerHTML = QR.toSVG(shareUrl, 6, 16);
  } catch {
    qrContainer.innerHTML = '<p style="color:var(--danger);font-size:.9rem">Deck too large for QR. Use the link below.</p>';
  }

  $('#creator-link').value = shareUrl;
  $('#btn-creator-copy').onclick = () => {
    navigator.clipboard.writeText(shareUrl).then(() => showToast('Link copied!'));
  };
  $('#btn-creator-done').onclick = () => {
    closeCreator();
    showView('cards');
  };
}

// ── CSV Parsing ──
function parseCSVText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const cards = [];
  for (const line of lines) {
    const parts = parseCSVLine(line);
    if (parts.length >= 2) {
      cards.push({ id: uid(), front: parts[0].trim(), back: parts[1].trim() });
    } else if (parts.length === 1 && parts[0].trim()) {
      cards.push({ id: uid(), front: parts[0].trim(), back: '' });
    }
  }
  return cards;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',' || ch === ';' || ch === '\t') { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Share URL building ──
function baseAppUrl() {
  return window.location.href.split('#')[0].split('?')[0];
}

function buildInlineShareURL(deck) {
  const payload = JSON.stringify({ name: deck.name, cards: deck.cards.map(c => [c.front, c.back]) });
  const encoded = btoa(unescape(encodeURIComponent(payload)));
  return baseAppUrl() + '?import=' + encodeURIComponent(encoded);
}

async function uploadDeck(deck) {
  const payload = { name: deck.name, cards: deck.cards.map(c => [c.front, c.back]) };
  const body = JSON.stringify(payload);

  // bytebin.lucko.me — free paste service with full CORS support
  const res = await fetch('https://bytebin.lucko.me/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error('Upload failed');
  const result = await res.json();
  if (!result || !result.key) throw new Error('No key returned');
  return result.key;
}

async function buildShareURL(deck) {
  try {
    const key = await uploadDeck(deck);
    return baseAppUrl() + '?store=' + key;
  } catch {
    showToast('Cloud upload failed, using inline link');
    return buildInlineShareURL(deck);
  }
}

// ── Share existing deck as QR ──
async function shareDeck() {
  const deck = currentDeck();
  if (!deck || deck.cards.length === 0) return;

  const qrModal = $('#qr-modal');
  const qrOverlay = $('#qr-overlay');
  const qrContainer = $('#qr-container');

  qrContainer.innerHTML = '<p style="color:var(--text-light)">Uploading deck…</p>';
  $('#qr-link').value = '';
  qrModal.classList.add('open');
  qrOverlay.classList.add('open');

  const shareUrl = await buildShareURL(deck);

  try {
    qrContainer.innerHTML = QR.toSVG(shareUrl, 6, 16);
  } catch {
    qrContainer.innerHTML = '<p style="color:var(--danger)">Deck too large for QR. Use the link below.</p>';
  }
  $('#qr-link').value = shareUrl;

  $('#btn-copy-link').onclick = () => {
    navigator.clipboard.writeText(shareUrl).then(() => showToast('Link copied!'));
  };
  const closeQR = () => {
    qrModal.classList.remove('open');
    qrOverlay.classList.remove('open');
  };
  $('#btn-qr-close').onclick = closeQR;
  qrOverlay.onclick = closeQR;
}

// ── Import from pasted link ──
function promptImport() {
  const url = prompt('Paste the deck import link:');
  if (!url) return;
  importFromLink(url);
}

function importFromLink(url) {
  try {
    const u = new URL(url);
    const storeKey = u.searchParams.get('store');
    const data = u.searchParams.get('import');
    if (storeKey) {
      importFromStore(storeKey);
    } else if (data) {
      importData(data);
    } else {
      showToast('Invalid import link');
    }
  } catch {
    showToast('Invalid link');
  }
}

async function importFromStore(key) {
  try {
    showToast('Downloading deck…');
    const res = await fetch('https://bytebin.lucko.me/' + key);
    if (!res.ok) throw new Error('Fetch failed');
    const { name, cards: rawCards } = await res.json();
    const existing = state.decks.find(d => d.name === name);
    if (existing) {
      const existingFronts = new Set(existing.cards.map(c => c.front));
      let added = 0;
      for (const [front, back] of rawCards) {
        if (!existingFronts.has(front)) {
          existing.cards.push({ id: uid(), front, back });
          added++;
        }
      }
      state.currentDeckId = existing.id;
      save(); renderDecks(); renderCards(); showView('cards');
      showToast(added > 0 ? `Added ${added} new cards to "${name}"` : `"${name}" is already up to date`);
    } else {
      const cards = rawCards.map(([front, back]) => ({ id: uid(), front, back }));
      const deck = { id: uid(), name, cards };
      state.decks.push(deck);
      state.currentDeckId = deck.id;
      save(); renderDecks(); renderCards(); showView('cards');
      showToast(`Imported ${cards.length} cards into "${name}"`);
    }
  } catch {
    showToast('Failed to download deck');
  }
}

// ── QR Scanner ──
let scannerStream = null;
let scannerInterval = null;

function openScanner() {
  const scannerModal = $('#scanner-modal');
  const scannerOverlay = $('#scanner-overlay');
  const video = $('#scanner-video');
  const status = $('#scanner-status');

  scannerModal.classList.add('open');
  scannerOverlay.classList.add('open');
  status.textContent = 'Starting camera…';

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      scannerStream = stream;
      video.srcObject = stream;
      status.textContent = 'Point your camera at a FlashCards QR code';
      startQRDetection(video, status);
    })
    .catch(() => {
      status.textContent = 'Camera not available. Use "Paste Link" instead.';
    });
}

function startQRDetection(video, status) {
  if (!('BarcodeDetector' in window)) {
    // Fallback: try canvas-based detection or just show paste option
    status.textContent = 'QR scanning not supported on this browser. Use "Paste Link".';
    return;
  }
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  scannerInterval = setInterval(async () => {
    if (video.readyState < 2) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length > 0) {
        const url = codes[0].rawValue;
        handleScannedURL(url);
      }
    } catch { /* ignore detection errors */ }
  }, 300);
}

function handleScannedURL(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.get('store') || u.searchParams.get('import')) {
      closeScanner();
      importFromLink(url);
    }
  } catch { /* not a valid URL, keep scanning */ }
}

function closeScanner() {
  const scannerModal = $('#scanner-modal');
  const scannerOverlay = $('#scanner-overlay');
  const video = $('#scanner-video');

  if (scannerInterval) { clearInterval(scannerInterval); scannerInterval = null; }
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  video.srcObject = null;
  scannerModal.classList.remove('open');
  scannerOverlay.classList.remove('open');
}

function importFromURL() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('store') || params.get('import')) {
    const url = window.location.href;
    window.history.replaceState({}, '', window.location.pathname);
    importFromLink(url);
  }
}

function importData(encoded) {
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
    const { name, cards: rawCards } = JSON.parse(json);
    const existing = state.decks.find(d => d.name === name);
    if (existing) {
      const existingFronts = new Set(existing.cards.map(c => c.front));
      let added = 0;
      for (const [front, back] of rawCards) {
        if (!existingFronts.has(front)) {
          existing.cards.push({ id: uid(), front, back });
          added++;
        }
      }
      state.currentDeckId = existing.id;
      save(); renderDecks(); renderCards(); showView('cards');
      showToast(added > 0 ? `Added ${added} new cards to "${name}"` : `"${name}" is already up to date`);
    } else {
      const cards = rawCards.map(([front, back]) => ({ id: uid(), front, back }));
      const deck = { id: uid(), name, cards };
      state.decks.push(deck);
      state.currentDeckId = deck.id;
      save(); renderDecks(); renderCards(); showView('cards');
      showToast(`Imported ${cards.length} cards into "${name}"`);
    }
  } catch {
    showToast('Invalid import data');
  }
}

// ── Toast ──
function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Escape HTML ──
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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

// ── Tap deck title to edit ──
function setupDeckTitleEdit() {
  headerTitle.addEventListener('click', () => {
    const deck = currentDeck();
    if (deck && viewCards.classList.contains('active')) {
      openDeckEditModal(deck);
    }
  });
}

// ── Live card count in creator ──
function setupCreatorPreview() {
  const textarea = $('#creator-cards');
  const counter = $('#creator-preview-count');
  textarea.addEventListener('input', () => {
    const lines = textarea.value.split(/\r?\n/).filter(l => l.trim()).length;
    counter.textContent = lines > 0 ? `${lines} card${lines !== 1 ? 's' : ''}` : '';
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

  // Deck list buttons
  $('#btn-create-deck').onclick = () => openCreator();
  $('#btn-import-deck').onclick = () => openScanner();
  $('#btn-create-fab').onclick = () => openCreator();
  $('#btn-scan-fab').onclick = () => openScanner();

  // QR Scanner
  $('#btn-scanner-close').onclick = closeScanner;
  $('#scanner-overlay').onclick = closeScanner;
  $('#btn-scanner-paste').onclick = () => { closeScanner(); promptImport(); };

  // Card list buttons
  $('#btn-add-first-card').onclick = () => openCardModal();
  $('#btn-share-deck').onclick = shareDeck;

  // Side menu
  $('#menu-create-deck').onclick = () => { closeMenu(); openCreator(); };
  $('#menu-import-deck').onclick = () => { closeMenu(); openScanner(); };

  // Study
  btnStudy.onclick = startStudy;
  flashcard.onclick = () => flashcard.classList.toggle('flipped');
  $('#btn-next').onclick = studyNext;
  $('#btn-prev').onclick = studyPrev;
  $('#btn-shuffle').onclick = studyShuffle;

  // Creator modal
  $('#creator-form').onsubmit = handleCreatorSave;
  $('#btn-creator-cancel').onclick = closeCreator;
  $('#creator-overlay').onclick = closeCreator;
  setupCreatorPreview();

  setupSwipe();
  setupDeckTitleEdit();

  // Import from URL if present
  importFromURL();

  // Back navigation
  window.addEventListener('popstate', () => {
    if (modal.classList.contains('open')) { closeModal(); }
    else if ($('#scanner-modal').classList.contains('open')) { closeScanner(); }
    else if ($('#creator-modal').classList.contains('open')) { closeCreator(); }
    else if (viewStudy.classList.contains('active')) { showView('cards'); }
    else if (viewCards.classList.contains('active')) { showView('decks'); renderDecks(); }
  });

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

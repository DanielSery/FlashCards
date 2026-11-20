import { $, showToast, plural, openSheet, closeSheet, isSheetOpen, handleSheetPopState, keepScreenOn } from './ui.js';
import { openStore } from './store.js';
import { Library } from './library.js';
import { CardList } from './card-list.js';
import { buildEnvelope, packEnvelope, unpackEnvelope } from './envelope.js';
import { FrameCollector, isFrame } from './frames.js';
import { QrSender, SEND_MODES } from './sender.js';
import { startScanner } from './scanner.js';
import { readLegacyLink, fetchLegacyDeck } from './legacy.js';
import { saveDeckFile, readDeckFile } from './files.js';
import { qrSvg } from './qr.js';
import * as install from './install.js';

const SIDE_KEY = 'flashcards_side';
const SEND_MODE_KEY = 'flashcards_send_mode';

let library = null;
let startupDone = false;

const state = {
  currentDeckId: null,
  studyOrder: [],
  studyIndex: 0,
  studyKnown: [],
  studyUnknown: [],
  studySide: 'front',
};

const views = { decks: $('#view-decks'), cards: $('#view-cards'), study: $('#view-study') };
const headerTitle = $('#header-title');
const btnAdd = $('#btn-add');
const sideMenu = $('#side-menu');
const menuOverlay = $('#menu-overlay');
const flashcard = $('#flashcard');
const searchInput = $('#card-search');

const prefs = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch { /* storage blocked */ }
  },
};

function currentDeck() {
  return library?.deck(state.currentDeckId) || null;
}

function isNarrow() {
  return window.innerWidth <= 600;
}

function appUrl() {
  return location.origin + location.pathname;
}

// ── Views ──
let currentView = 'decks';

function applyView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
  currentView = name;
  if (name === 'decks') {
    headerTitle.textContent = 'FlashCards';
    btnAdd.innerHTML = '&#43;';
    btnAdd.setAttribute('aria-label', 'Create deck');
    btnAdd.onclick = openCreateDeck;
    renderDecks();
  } else if (name === 'cards') {
    headerTitle.textContent = currentDeck()?.name || 'Cards';
    btnAdd.innerHTML = '&#43;';
    btnAdd.setAttribute('aria-label', 'Add card');
    btnAdd.onclick = () => openCardModal();
  } else if (name === 'study') {
    headerTitle.textContent = 'Study';
    btnAdd.innerHTML = '&#10005;';
    btnAdd.setAttribute('aria-label', 'Stop studying');
    btnAdd.onclick = () => showView('cards');
  }
}

function showView(name) {
  if (name !== currentView) history.pushState({ view: name }, '');
  applyView(name);
}

function openDeck(id) {
  state.currentDeckId = id;
  searchInput.value = '';
  renderCards();
  showView('cards');
}

// ── Deck list ──
const DELETE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

function renderDecks() {
  const decks = library ? library.liveDecks() : [];
  const list = $('#deck-list');
  const menuList = $('#menu-deck-list');
  list.replaceChildren();
  menuList.replaceChildren();
  $('#empty-decks').hidden = !library || decks.length > 0;
  list.hidden = decks.length === 0;

  for (const deck of decks) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="row-text"><div class="deck-name"></div><div class="deck-count"></div></div><button class="btn-deck-delete" aria-label="Delete deck">${DELETE_ICON}</button>`;
    li.querySelector('.deck-name').textContent = deck.name;
    li.querySelector('.deck-count').textContent = plural(deck.cards.length, 'card');
    li.querySelector('.btn-deck-delete').onclick = e => {
      e.stopPropagation();
      if (confirm(`Delete "${deck.name}" and all its cards?`)) {
        library.deleteDeck(deck);
        if (state.currentDeckId === deck.id) state.currentDeckId = null;
        renderDecks();
      }
    };
    li.onclick = () => openDeck(deck.id);
    list.appendChild(li);

    const mli = document.createElement('li');
    mli.textContent = deck.name;
    if (deck.id === state.currentDeckId) mli.classList.add('active');
    mli.onclick = () => {
      closeMenu();
      openDeck(deck.id);
    };
    menuList.appendChild(mli);
  }
}

// ── Card list ──
const cardList = new CardList($('#card-list'), {
  onEdit: card => openCardModal(card),
  onAdd: () => openCardModal(),
});

function renderCards() {
  cardList.show(currentDeck(), searchInput.value);
  updateCardsChrome();
}

function updateCardsChrome() {
  const deck = currentDeck();
  const total = deck ? deck.cards.length : 0;
  const query = searchInput.value.trim();
  $('#empty-cards').hidden = total > 0;
  $('#card-search-bar').hidden = total === 0;
  $('#card-search-empty').hidden = !(total > 0 && query && cardList.matchCount === 0);
  $('#card-search-count').textContent = query ? `${cardList.matchCount} / ${total}` : plural(total, 'card');
  $('#btn-study').hidden = total === 0;
}

let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderCards, 120);
});

// ── Study ──
function studyCard(id) {
  return currentDeck()?.cards.find(c => c.id === id) || null;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function setStudyRound(ids) {
  state.studyOrder = ids;
  shuffle(state.studyOrder);
  state.studyIndex = 0;
  state.studyKnown = [];
  state.studyUnknown = [];
  $('#study-summary').hidden = true;
  $('#card-container').hidden = false;
  $('#study-side-picker').hidden = false;
  $('#study-progress').hidden = false;
}

function startStudy() {
  const deck = currentDeck();
  if (!deck || deck.cards.length === 0) return;
  setStudyRound(deck.cards.map(c => c.id));
  document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b.dataset.side === state.studySide));
  showView('study');
  showStudyCard();
}

function showStudyCard() {
  const card = studyCard(state.studyOrder[state.studyIndex]);
  if (!card) return;
  const total = state.studyOrder.length;

  // Place the new card without animating the flip or the swipe reset.
  const inner = flashcard.querySelector('.flashcard-inner');
  inner.style.transition = 'none';
  flashcard.style.transition = 'none';
  const showBack = state.studySide === 'back' || (state.studySide === 'random' && Math.random() < 0.5);
  flashcard.classList.toggle('flipped', showBack);
  $('#card-front-text').textContent = card.front;
  $('#card-back-text').textContent = card.back;
  flashcard.style.transform = '';
  flashcard.style.opacity = '';
  void flashcard.offsetHeight;
  inner.style.transition = '';
  flashcard.style.transition = '';
  $('#swipe-hint-left').style.opacity = '0';
  $('#swipe-hint-right').style.opacity = '0';

  $('#study-counter').textContent = `${state.studyIndex + 1} / ${total}`;
  $('#progress-fill').style.width = `${((state.studyIndex + 1) / total) * 100}%`;
}

function studyAnswer(known) {
  const id = state.studyOrder[state.studyIndex];
  if (!id) return;
  (known ? state.studyKnown : state.studyUnknown).push(id);

  const dir = known ? 1 : -1;
  flashcard.style.transition = 'transform .3s ease, opacity .3s ease';
  flashcard.style.transform = `translateX(${dir * 400}px) rotate(${dir * 20}deg)`;
  flashcard.style.opacity = '0';

  setTimeout(() => {
    flashcard.style.transition = '';
    if (state.studyIndex < state.studyOrder.length - 1) {
      state.studyIndex++;
      showStudyCard();
    } else {
      showStudySummary();
    }
  }, 300);
}

function showStudySummary() {
  const known = state.studyKnown.length;
  const unknown = state.studyUnknown.length;
  const total = known + unknown;
  $('#card-container').hidden = true;
  $('#study-side-picker').hidden = true;
  $('#study-progress').hidden = true;
  $('#study-summary').hidden = false;

  const pct = total > 0 ? Math.round((known / total) * 100) : 0;
  $('#summary-stats').innerHTML = `
    <div class="summary-row summary-known"><span>&#10003; Known</span><span>${known}</span></div>
    <div class="summary-row summary-unknown"><span>&#10007; Still learning</span><span>${unknown}</span></div>
    <div class="summary-row"><span>Score</span><span>${pct}%</span></div>`;

  const actions = $('#summary-actions');
  actions.replaceChildren();
  const button = (cls, text, onclick) => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.onclick = onclick;
    actions.appendChild(b);
  };
  if (unknown > 0) {
    button('btn-primary', `Retry missed (${unknown})`, () => {
      setStudyRound([...state.studyUnknown]);
      showStudyCard();
    });
  }
  button('btn-secondary', 'Study all again', startStudy);
  button('btn-secondary', 'Done', () => showView('cards'));
}

// ── Single card / deck name modal ──
let modalMode = null;
let editTarget = null;
const inputFront = $('#input-front');
const inputBack = $('#input-back');

function openNameModal(mode, deck) {
  modalMode = mode;
  editTarget = deck || null;
  $('#modal-title').textContent = deck ? 'Edit Deck' : 'New Deck';
  $('#label-front').textContent = 'Deck Name';
  inputFront.value = deck ? deck.name : '';
  inputFront.placeholder = deck ? '' : 'e.g. Spanish Vocab';
  inputFront.setAttribute('rows', '1');
  $('#label-back').hidden = true;
  inputBack.hidden = true;
  $('#btn-modal-delete').hidden = !deck;
  openModal();
}

function openCardModal(card) {
  if (!currentDeck()) return;
  modalMode = card ? 'card-edit' : 'card-new';
  editTarget = card || null;
  $('#modal-title').textContent = card ? 'Edit Card' : 'New Card';
  $('#label-front').textContent = 'Front';
  $('#label-back').hidden = false;
  inputBack.hidden = false;
  inputFront.setAttribute('rows', '3');
  inputFront.placeholder = '';
  inputFront.value = card ? card.front : '';
  inputBack.value = card ? card.back : '';
  $('#btn-modal-delete').hidden = !card;
  openModal();
}

function openModal() {
  openSheet('modal');
  setTimeout(() => inputFront.focus(), 100);
}

function handleModalSave(e) {
  e.preventDefault();
  const front = inputFront.value.trim();
  const back = inputBack.value.trim();
  if (!front) return;
  if (modalMode === 'deck-new') {
    const deck = library.createDeck(front);
    renderDecks();
    closeSheet().then(() => openDeck(deck.id));
  } else if (modalMode === 'deck-edit' && editTarget) {
    library.renameDeck(editTarget, front);
    headerTitle.textContent = front;
    renderDecks();
    closeSheet();
  } else if (modalMode === 'card-new') {
    const deck = currentDeck();
    if (!deck) return;
    cardList.cardAdded(library.addCard(deck, front, back));
    updateCardsChrome();
    inputFront.value = '';
    inputBack.value = '';
    inputFront.focus();
  } else if (modalMode === 'card-edit' && editTarget) {
    library.updateCard(editTarget, front, back);
    cardList.cardUpdated(editTarget);
    closeSheet();
  }
}

function handleModalDelete() {
  if (modalMode === 'deck-edit' && editTarget) {
    library.deleteDeck(editTarget);
    state.currentDeckId = null;
    closeSheet().then(() => showView('decks'));
  } else if (modalMode === 'card-edit' && editTarget) {
    const deck = currentDeck();
    if (deck) {
      library.deleteCard(deck, editTarget);
      cardList.cardRemoved(editTarget);
      updateCardsChrome();
    }
    closeSheet();
  }
}

// ── Deck creator (bulk "front, back" lines) ──
function openCreateDeck() {
  if (isNarrow()) openNameModal('deck-new');
  else openCreator();
}

function openCreator() {
  $('#creator-name').value = '';
  $('#creator-cards').value = '';
  $('#creator-preview-count').textContent = '';
  openSheet('creator-modal');
  setTimeout(() => $('#creator-name').focus(), 100);
}

function handleCreatorSave(e) {
  e.preventDefault();
  const name = $('#creator-name').value.trim();
  if (!name) return;
  const deck = library.createDeck(name, parseCSVText($('#creator-cards').value));
  state.currentDeckId = deck.id;
  searchInput.value = '';
  renderDecks();
  renderCards();
  const send = e.submitter?.id === 'btn-creator-send';
  closeSheet().then(() => {
    showView('cards');
    if (send) openSend(deck.id);
  });
}

function parseCSVText(text) {
  const cards = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = parseCSVLine(line);
    if (parts.length >= 2) cards.push({ front: parts[0].trim(), back: parts[1].trim() });
    else if (parts[0].trim()) cards.push({ front: parts[0].trim(), back: '' });
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
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === ';' || ch === '\t') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Send ──
let sender = null;
let sendToken = 0;
let sendEnvelope = null;
let sendLabel = '';

function fillPlainQr(el) {
  if (!el.firstChild) el.innerHTML = qrSvg(appUrl());
}

function openSend(deckId = null) {
  const decks = library.liveDecks();
  const select = $('#send-deck');
  select.replaceChildren();
  const allCards = decks.reduce((n, d) => n + d.cards.length, 0);
  select.add(new Option(`All decks (${plural(decks.length, 'deck')}, ${plural(allCards, 'card')})`, 'all'));
  for (const d of decks) select.add(new Option(`${d.name} (${plural(d.cards.length, 'card')})`, d.id));
  select.value = deckId && library.deck(deckId) ? deckId : 'all';
  const mode = prefs.get(SEND_MODE_KEY, 'normal');
  setSendModeButtons(SEND_MODES[mode] ? mode : 'normal');
  $('#send-get-app').open = false;
  $('#send-status').textContent = 'Preparing…';
  openSheet('send-modal', { onClose: stopSend });
  keepScreenOn(true);
  startSend();
}

function setSendModeButtons(mode) {
  document.querySelectorAll('#send-mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

function currentSendMode() {
  return document.querySelector('#send-mode button.active')?.dataset.mode || 'normal';
}

async function startSend() {
  const token = ++sendToken;
  const value = $('#send-deck').value;
  const decks = library.exportDecks(value === 'all' ? null : [value]);
  const live = decks.filter(d => !d.deletedAt);
  const cards = live.reduce((n, d) => n + d.cards.filter(c => !c.deleted).length, 0);
  sendLabel = value === 'all' ? 'All decks' : live[0]?.name || 'Deck';
  sendEnvelope = buildEnvelope(decks);
  const payload = await packEnvelope(sendEnvelope);
  if (token !== sendToken || !isSheetOpen('send-modal')) return;
  const summary = value === 'all' ? `${plural(live.length, 'deck')}, ${plural(cards, 'card')}` : plural(cards, 'card');
  const wrap = $('#send-qr-wrap');
  sender ||= new QrSender($('#send-qr'), {
    getWidth: () => Math.min(wrap.clientWidth, 520),
    onFrame: (i, n) => {
      $('#send-status').textContent = n > 1 ? `Code ${i + 1} of ${n} · ${sender.summary}` : sender.summary;
    },
  });
  sender.summary = summary;
  sender.start(payload, currentSendMode());
}

function stopSend() {
  sendToken++;
  if (sender) sender.stop();
  keepScreenOn(false);
}

async function sendAsFile() {
  if (!sendEnvelope) return;
  const result = await saveDeckFile(sendEnvelope, sendLabel);
  if (result === 'downloaded') showToast('File saved to your downloads');
}

// ── Receive ──
let scanner = null;
let collector = null;
let unpacking = false;

async function openReceive() {
  collector = new FrameCollector();
  unpacking = false;
  $('#receive-progress').hidden = true;
  $('#receive-link').open = false;
  $('#receive-link-input').value = '';
  $('#receive-ios-note').hidden = !install.isIosBrowser();
  const status = $('#scanner-status');
  status.textContent = 'Starting camera…';
  openSheet('receive-modal', { onClose: stopReceive });
  keepScreenOn(true);
  try {
    const s = await startScanner($('#scanner-video'), onScanText);
    if (!isSheetOpen('receive-modal')) {
      s.stop();
      return;
    }
    scanner = s;
    status.textContent = 'Point the camera at the code on the other device';
  } catch (err) {
    if (!isSheetOpen('receive-modal')) return;
    status.textContent = err?.name === 'NotAllowedError'
      ? 'Camera access was blocked. Allow it in the browser settings, or open a deck file instead.'
      : err?.name === 'NotFoundError'
        ? 'No camera found. Open a deck file instead.'
        : 'The camera could not start. Open a deck file instead.';
  }
}

function stopReceive() {
  if (scanner) scanner.stop();
  scanner = null;
  keepScreenOn(false);
}

async function onScanText(text) {
  if (unpacking || !isSheetOpen('receive-modal')) return;
  const status = $('#scanner-status');
  if (isFrame(text)) {
    const result = collector.add(text);
    if (result.status === 'ignored') return;
    const t = result.transfer;
    $('#receive-progress').hidden = false;
    $('#receive-fill').style.width = `${(t.received / t.count) * 100}%`;
    $('#receive-count').textContent = `${t.received} / ${t.count}`;
    if (result.status === 'corrupt') {
      status.textContent = 'Part of the transfer was unreadable. Keep scanning…';
      return;
    }
    if (result.status !== 'complete') {
      status.textContent = t.received < t.count ? 'Keep the code in view…' : status.textContent;
      return;
    }
    unpacking = true;
    status.textContent = 'Received. Checking…';
    try {
      const incoming = await unpackEnvelope(result.payload);
      showPreview(incoming);
    } catch (err) {
      status.textContent = err.message;
      collector = new FrameCollector();
      unpacking = false;
    }
    return;
  }
  const legacy = readLegacyLink(text);
  if (legacy) {
    unpacking = true;
    importLegacy(legacy);
    return;
  }
  if (text.startsWith(appUrl())) status.textContent = 'That code opens the app. On the other device tap Send to show the deck code.';
}

async function importLegacy(link, { afterShareLink = false } = {}) {
  if (link.kind === 'store') showToast('Downloading deck…');
  try {
    showPreview(await fetchLegacyDeck(link), { afterShareLink });
  } catch (err) {
    showToast(err.message);
    if (isSheetOpen('receive-modal')) unpacking = false;
    else if (afterShareLink) maybeAskToInstall({ afterShareLink });
  }
}

async function openFile(file) {
  let incoming;
  try {
    incoming = await readDeckFile(file);
  } catch (err) {
    showToast(err.message);
    return;
  }
  if (install.isIosBrowser()) openIosImportGate({ kind: 'file', incoming });
  else showPreview(incoming);
}

// ── Import preview ──
let previewPlan = null;
let previewAfterShareLink = false;

const KIND_LABELS = { new: 'New deck', updated: 'Updated', deleted: 'Deleted', restored: 'Restored' };

function showPreview(incoming, { afterShareLink = false } = {}) {
  const plan = library.planImport(incoming);
  previewPlan = plan;
  previewAfterShareLink = afterShareLink;
  const list = $('#preview-list');
  list.replaceChildren();
  for (const ch of plan.changes) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="preview-head"><strong></strong><span class="badge"></span></div><div class="preview-counts"></div>';
    li.querySelector('strong').textContent = ch.name;
    const badge = li.querySelector('.badge');
    badge.textContent = KIND_LABELS[ch.kind];
    badge.dataset.kind = ch.kind;
    const parts = [];
    if (ch.added) parts.push(`${ch.added} new`);
    if (ch.changed) parts.push(`${ch.changed} changed`);
    if (ch.removed) parts.push(`${ch.removed} removed`);
    if (ch.renamedFrom) parts.push(`renamed from "${ch.renamedFrom}"`);
    li.querySelector('.preview-counts').textContent = parts.join(' · ') || (ch.kind === 'new' ? 'empty deck' : '');
    list.appendChild(li);
  }
  const upToDate = plan.changes.length === 0;
  $('#preview-title').textContent = upToDate ? 'Already up to date' : 'Import';
  $('#preview-unchanged').textContent = plan.unchanged ? `${plural(plan.unchanged, 'deck')} already up to date.` : '';
  $('#btn-preview-apply').hidden = upToDate;
  $('#btn-preview-cancel').textContent = upToDate ? 'Done' : 'Cancel';
  // Nothing visible changes, but the records may still adopt the sender's ids: keep that.
  if (upToDate && plan.hasOps) library.applyImport(plan).then(refreshAfterImport, () => {});
  openSheet('preview-modal', { onClose: () => { previewPlan = null; } });
}

async function applyPreview() {
  const plan = previewPlan;
  if (!plan) return;
  const afterShareLink = previewAfterShareLink;
  $('#btn-preview-apply').disabled = true;
  try {
    await library.applyImport(plan);
  } catch {
    showToast('Could not save the import');
    return;
  } finally {
    $('#btn-preview-apply').disabled = false;
  }
  await closeSheet();
  const live = plan.changes.filter(c => c.kind !== 'deleted' && library.deck(c.deckId));
  if (plan.changes.length === 1 && live.length === 1) openDeck(live[0].deckId);
  else showView('decks');
  refreshAfterImport();
  const total = key => plan.changes.reduce((n, c) => n + c[key], 0);
  const counts = [['added', 'new'], ['changed', 'changed'], ['removed', 'removed']]
    .filter(([key]) => total(key) > 0).map(([key, word]) => `${total(key)} ${word}`).join(', ');
  const what = plan.changes.length === 1 ? plan.changes[0].name : plural(plan.changes.length, 'deck');
  showToast(counts ? `${what}: ${counts}` : `${what} updated`);
  if (afterShareLink) maybeAskToInstall({ afterShareLink });
}

// library.load() replaced every deck and card object, and a deck may have taken the sender's id.
function refreshAfterImport() {
  if (state.currentDeckId && !currentDeck()) {
    state.currentDeckId = null;
    if (currentView !== 'decks') applyView('decks');
  }
  renderDecks();
  if (currentView === 'cards') renderCards();
}

async function cancelPreview() {
  const afterShareLink = previewAfterShareLink;
  await closeSheet();
  if (afterShareLink) maybeAskToInstall({ afterShareLink });
}

// ── Install ──
let installActed = false;

const IOS_STEPS = [
  'Tap the <strong>Share</strong> button. In Safari on iOS 26 it is in the <strong>&middot;&middot;&middot;</strong> menu next to the address bar.',
  'Scroll down and tap <strong>Add to Home Screen</strong>.',
  'Keep <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.',
  'Open <strong>FlashCards</strong> from your Home Screen.',
];
const MENU_STEPS = [
  'Open the browser menu (<strong>&#8942;</strong>).',
  'Tap <strong>Install</strong> or <strong>Add to Home screen</strong>.',
];

function setSteps(el, steps) {
  el.innerHTML = steps.map(s => `<li>${s}</li>`).join('');
}

function openInstallSheet({ extraStep = null } = {}) {
  const method = install.installMethod();
  if (!method) return;
  const ios = method === 'ios';
  const steps = method === 'ios' ? [...IOS_STEPS] : method === 'menu' ? [...MENU_STEPS] : [];
  if (extraStep) steps.push(extraStep);
  setSteps($('#install-steps'), steps);
  $('#install-steps').hidden = steps.length === 0;
  $('#btn-install-go').hidden = method !== 'prompt';
  $('#install-ios-storage').hidden = !ios;
  $('#install-ios-move').hidden = !ios || extraStep !== null || !library?.liveDecks().length;
  installActed = false;
  openSheet('install-modal', {
    onClose: () => {
      if (!installActed) install.snoozeInstall();
      updateMenuItems();
    },
  });
}

function maybeAskToInstall({ afterShareLink = false } = {}) {
  if (isSheetOpen() || !install.shouldAskToInstall({ afterShareLink })) return;
  openInstallSheet();
}

function onInstallAvailabilityChange() {
  updateMenuItems();
  if (startupDone) maybeAskToInstall();
}

function openIosImportGate(source) {
  const steps = [
    'Install the app: tap <strong>Use the app</strong> below and follow the steps.',
    'Open <strong>FlashCards</strong> from your Home Screen.',
    source.kind === 'link'
      ? 'Tap <strong>Receive</strong>, open <strong>Have a share link from the old version?</strong> and paste the link. It is copied for you.'
      : 'Tap <strong>Receive</strong> &rarr; <strong>Open file</strong> and pick the same file.',
  ];
  setSteps($('#ios-import-steps'), steps);
  $('#btn-ios-import-browser').onclick = () => {
    if (source.kind === 'link') importLegacy(source.link, { afterShareLink: false });
    else showPreview(source.incoming);
  };
  $('#btn-ios-import-app').onclick = async () => {
    if (source.kind === 'link') {
      try {
        await navigator.clipboard.writeText(source.link.href);
        showToast('Link copied');
      } catch { /* the steps still say to paste it */ }
    }
    openInstallSheet({
      extraStep: source.kind === 'link'
        ? 'In the app tap <strong>Receive</strong> and paste the link into <strong>Have a share link from the old version?</strong>'
        : 'In the app tap <strong>Receive</strong> &rarr; <strong>Open file</strong>.',
    });
  };
  openSheet('ios-import-modal');
}

function openGetApp() {
  fillPlainQr($('#get-app-qr'));
  $('#get-app-url').textContent = appUrl();
  openSheet('get-app-modal');
}

function updateMenuItems() {
  $('#menu-get-app').hidden = install.isMobileDevice();
  $('#menu-install').hidden = !install.installMethod();
}

// ── Side menu ──
function openMenu() {
  sideMenu.classList.add('open');
  menuOverlay.classList.add('open');
  renderDecks();
  updateMenuItems();
}

function closeMenu() {
  sideMenu.classList.remove('open');
  menuOverlay.classList.remove('open');
}

function fromMenu(fn) {
  return () => {
    closeMenu();
    fn();
  };
}

// ── Swipe (drag the study card left or right) ──
let swipeDragging = false;
let swipeStartX = 0;
let swipeDx = 0;
const SWIPE_THRESHOLD = 80;

function setupSwipe() {
  const onStart = x => {
    if (!views.study.classList.contains('active')) return;
    swipeDragging = true;
    swipeDx = 0;
    swipeStartX = x;
    flashcard.style.transition = '';
  };
  const onMove = x => {
    if (!swipeDragging) return;
    swipeDx = x - swipeStartX;
    flashcard.style.transform = `translateX(${swipeDx}px) rotate(${swipeDx * 0.08}deg)`;
    const progress = Math.min(Math.abs(swipeDx) / SWIPE_THRESHOLD, 1);
    $('#swipe-hint-right').style.opacity = swipeDx > 0 ? progress : '0';
    $('#swipe-hint-left').style.opacity = swipeDx < 0 ? progress : '0';
  };
  const onEnd = () => {
    if (!swipeDragging) return;
    swipeDragging = false;
    if (Math.abs(swipeDx) >= SWIPE_THRESHOLD) {
      studyAnswer(swipeDx > 0);
    } else {
      flashcard.style.transition = 'transform .2s ease';
      flashcard.style.transform = '';
      $('#swipe-hint-left').style.opacity = '0';
      $('#swipe-hint-right').style.opacity = '0';
    }
  };
  flashcard.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
  flashcard.addEventListener('touchmove', e => onMove(e.touches[0].clientX), { passive: true });
  flashcard.addEventListener('touchend', onEnd, { passive: true });
  flashcard.addEventListener('mousedown', e => {
    e.preventDefault();
    onStart(e.clientX);
  });
  document.addEventListener('mousemove', e => { if (swipeDragging) onMove(e.clientX); });
  document.addEventListener('mouseup', onEnd);
}

// ── Wiring ──
function wireEvents() {
  $('#btn-menu').onclick = openMenu;
  menuOverlay.onclick = closeMenu;
  $('#sheet-overlay').onclick = () => closeSheet();

  $('#modal-form').onsubmit = handleModalSave;
  $('#btn-modal-cancel').onclick = () => closeSheet();
  $('#btn-modal-delete').onclick = handleModalDelete;

  $('#btn-create-deck').onclick = openCreateDeck;
  $('#btn-create-fab').onclick = openCreateDeck;
  $('#btn-receive-fab').onclick = openReceive;
  $('#btn-receive-empty').onclick = openReceive;

  $('#btn-add-first-card').onclick = () => openCardModal();
  $('#btn-send-deck').onclick = () => openSend(state.currentDeckId);
  $('#btn-study').onclick = startStudy;

  $('#menu-home').onclick = fromMenu(() => showView('decks'));
  $('#menu-create-deck').onclick = fromMenu(openCreateDeck);
  $('#menu-send').onclick = fromMenu(() => openSend(null));
  $('#menu-receive').onclick = fromMenu(openReceive);
  $('#menu-get-app').onclick = fromMenu(openGetApp);
  $('#menu-install').onclick = fromMenu(() => openInstallSheet());

  $('#creator-form').onsubmit = handleCreatorSave;
  $('#btn-creator-cancel').onclick = () => closeSheet();
  $('#creator-cards').addEventListener('input', e => {
    const lines = e.target.value.split(/\r?\n/).filter(l => l.trim()).length;
    $('#creator-preview-count').textContent = lines > 0 ? plural(lines, 'card') : '';
  });

  $('#send-deck').onchange = startSend;
  document.querySelectorAll('#send-mode button').forEach(b => {
    b.onclick = () => {
      setSendModeButtons(b.dataset.mode);
      prefs.set(SEND_MODE_KEY, b.dataset.mode);
      if (sender?.frames) sender.setMode(b.dataset.mode);
    };
  });
  $('#send-get-app').addEventListener('toggle', () => fillPlainQr($('#send-get-app-qr')));
  $('#btn-send-file').onclick = sendAsFile;
  $('#btn-send-close').onclick = () => closeSheet();

  $('#btn-receive-close').onclick = () => closeSheet();
  $('#btn-receive-file').onclick = () => $('#receive-file-input').click();
  $('#receive-file-input').onchange = e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) openFile(file);
  };
  $('#receive-link-form').onsubmit = e => {
    e.preventDefault();
    const link = readLegacyLink($('#receive-link-input').value.trim());
    if (!link) {
      showToast('That is not a FlashCards share link');
      return;
    }
    unpacking = true;
    importLegacy(link);
  };
  $('#btn-receive-install').onclick = () => openInstallSheet();

  $('#btn-preview-apply').onclick = applyPreview;
  $('#btn-preview-cancel').onclick = cancelPreview;

  $('#btn-install-go').onclick = async () => {
    installActed = true;
    const outcome = await install.promptInstall();
    await closeSheet();
    if (outcome === 'accepted') showToast('Installing FlashCards…');
  };
  $('#btn-install-later').onclick = () => closeSheet();
  $('#btn-install-never').onclick = () => {
    installActed = true;
    install.neverAskInstall();
    closeSheet();
  };

  $('#btn-get-app-close').onclick = () => closeSheet();

  document.querySelectorAll('.side-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b === btn));
      state.studySide = btn.dataset.side;
      prefs.set(SIDE_KEY, state.studySide);
      if (views.study.classList.contains('active')) showStudyCard();
    };
  });
  flashcard.onclick = () => {
    if (!swipeDragging && Math.abs(swipeDx) < 5) flashcard.classList.toggle('flipped');
  };
  setupSwipe();

  headerTitle.addEventListener('click', () => {
    const deck = currentDeck();
    if (deck && currentView === 'cards') openNameModal('deck-edit', deck);
  });

  window.addEventListener('popstate', e => {
    if (handleSheetPopState()) return;
    closeMenu();
    const target = e.state?.view || 'decks';
    if (target !== 'decks' && !currentDeck()) applyView('decks');
    else applyView(target);
  });

  document.addEventListener('keydown', e => {
    if (!views.study.classList.contains('active') || isSheetOpen()) return;
    if (!$('#study-summary').hidden) return;
    if (e.key === 'ArrowLeft') studyAnswer(false);
    else if (e.key === 'ArrowRight') studyAnswer(true);
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flashcard.classList.toggle('flipped');
    }
  });
}

async function init() {
  state.studySide = prefs.get(SIDE_KEY, 'front');
  install.initInstall(onInstallAvailabilityChange);
  wireEvents();
  history.replaceState({ view: 'decks' }, '');
  applyView('decks');
  updateMenuItems();

  try {
    const store = await openStore();
    await store.migrateV1();
    library = new Library(store, () => showToast('Could not save. Is the device out of storage?'));
    await library.load();
  } catch {
    $('#empty-decks').innerHTML = '<p>FlashCards cannot store decks in this browser.<br>Private browsing can cause this.</p>';
    $('#empty-decks').hidden = false;
    $('#deck-fabs').hidden = true;
    btnAdd.hidden = true;
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  renderDecks();

  const legacy = readLegacyLink(location.href);
  if (legacy) {
    history.replaceState({ view: 'decks' }, '', location.pathname);
    if (install.isIosBrowser()) openIosImportGate({ kind: 'link', link: legacy });
    else importLegacy(legacy, { afterShareLink: true });
  } else {
    setTimeout(() => maybeAskToInstall(), 800);
  }
  startupDone = true;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();

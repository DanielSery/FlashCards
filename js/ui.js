export const $ = sel => document.querySelector(sel);

export function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Bottom sheets. One is open at a time and it owns one history entry, so the phone's back
// button closes it. Opening a sheet while another is open swaps them on the same entry.
const overlay = () => $('#sheet-overlay');
let current = null;
let pendingBack = null;

export function openSheet(id, { onClose } = {}) {
  const sheet = document.getElementById(id);
  if (current) hideCurrent();
  else history.pushState({ ...history.state, sheet: true }, '');
  current = { sheet, onClose };
  sheet.classList.add('open');
  overlay().classList.add('open');
  sheet.scrollTop = 0;
}

function hideCurrent() {
  const { sheet, onClose } = current;
  current = null;
  sheet.classList.remove('open');
  overlay().classList.remove('open');
  if (onClose) onClose();
}

export function isSheetOpen(id) {
  return Boolean(current && (!id || current.sheet.id === id));
}

// Resolves once the history entry is gone, so a caller can navigate afterwards.
export function closeSheet() {
  if (!current) return Promise.resolve();
  hideCurrent();
  return new Promise(resolve => {
    const timer = setTimeout(finish, 400);
    function finish() {
      clearTimeout(timer);
      if (pendingBack === finish) pendingBack = null;
      resolve();
    }
    pendingBack = finish;
    history.back();
  });
}

export function handleSheetPopState() {
  if (pendingBack) {
    pendingBack();
    return true;
  }
  if (current) {
    hideCurrent();
    return true;
  }
  return false;
}

let wakeLock = null;
let wantAwake = false;

export async function keepScreenOn(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
    }
  } catch { /* not allowed right now, e.g. low battery */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantAwake) keepScreenOn(true);
});

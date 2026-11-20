const PREFS_KEY = 'flashcards_install';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

let deferredPrompt = null;

export function isStandalone() {
  return ['standalone', 'fullscreen', 'minimal-ui'].some(m => matchMedia(`(display-mode: ${m})`).matches) ||
    navigator.standalone === true;
}

export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isMobileDevice() {
  return isIos() || /Android|Mobi/i.test(navigator.userAgent) || navigator.userAgentData?.mobile === true;
}

export function isIosBrowser() {
  return isIos() && !isStandalone();
}

export function initInstall(onChange) {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    onChange();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    onChange();
  });
}

// 'prompt': Chromium handed us its install prompt. 'ios': Share > Add to Home Screen.
// 'menu': other mobile browsers install from their own menu. null: nothing to offer. A Chromium
// browser that never fires beforeinstallprompt has usually installed the app already.
export function installMethod() {
  if (isStandalone() || !isMobileDevice()) return null;
  if (deferredPrompt) return 'prompt';
  if (isIos()) return 'ios';
  if ('onbeforeinstallprompt' in window) return null;
  return 'menu';
}

export async function promptInstall() {
  const e = deferredPrompt;
  if (!e) return 'unavailable';
  deferredPrompt = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome;
}

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage blocked: the sheet just shows again next time */ }
}

// A share-link visit asks again even while "Not now" is in effect; "Don't ask again" always holds.
export function shouldAskToInstall({ afterShareLink = false } = {}) {
  if (!installMethod()) return false;
  const prefs = readPrefs();
  if (prefs.never) return false;
  return afterShareLink || !(prefs.snoozedUntil > Date.now());
}

export function snoozeInstall() {
  writePrefs({ ...readPrefs(), snoozedUntil: Date.now() + SNOOZE_MS });
}

export function neverAskInstall() {
  writePrefs({ ...readPrefs(), never: true });
}

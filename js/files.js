import { parseEnvelopeText } from './envelope.js';
import { isMobileDevice } from './install.js';

function fileName(label) {
  const safe = label.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Decks';
  return `FlashCards - ${safe} - ${new Date().toISOString().slice(0, 10)}.json`;
}

// Mobile: the share sheet (Save to Files, AirDrop, mail...) where it accepts the file; otherwise a download.
export async function saveDeckFile(envelope, label) {
  const file = new File([JSON.stringify(envelope)], fileName(label), { type: 'application/json' });
  if (isMobileDevice() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export async function readDeckFile(file) {
  return parseEnvelopeText(await file.text());
}

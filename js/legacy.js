// v1 share links: ?import=<base64 JSON> inline, or ?store=<key> on bytebin. v2 reads them, never writes.
import { parseEnvelope } from './envelope.js';

const STORE_URL = 'https://bytebin.lucko.me/';

export function readLegacyLink(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const key = url.searchParams.get('store');
  if (key && /^[A-Za-z0-9]+$/.test(key)) return { kind: 'store', key, href };
  const data = url.searchParams.get('import');
  if (data) return { kind: 'inline', data, href };
  return null;
}

export async function fetchLegacyDeck(link) {
  if (link.kind === 'inline') {
    let json;
    try {
      const binary = atob(decodeURIComponent(link.data));
      json = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0))));
    } catch {
      throw new Error('This share link is damaged.');
    }
    return parseEnvelope(json);
  }
  let res;
  try {
    res = await fetch(STORE_URL + link.key);
  } catch {
    throw new Error('Could not download the deck. Check your connection.');
  }
  if (!res.ok) throw new Error('This shared deck is no longer available.');
  return parseEnvelope(await res.json());
}

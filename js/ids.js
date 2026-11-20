const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let id = '';
  for (const b of bytes) id += ALPHABET[b % 36];
  return id;
}

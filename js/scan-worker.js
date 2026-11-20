// Classic worker: module workers need iOS 15+, importScripts works everywhere.
importScripts('../vendor/jsQR.js');

self.onmessage = e => {
  const { id, buffer, width, height } = e.data;
  let text = null;
  try {
    const result = jsQR(new Uint8ClampedArray(buffer), width, height, { inversionAttempts: 'dontInvert' });
    if (result) text = result.data;
  } catch { /* undecodable frame */ }
  self.postMessage({ id, text });
};

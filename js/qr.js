// `qrcode` is a global from the classic script tag in index.html, not an import.
const QUIET = 4;

export function makeMatrix(text, { version = 0, ecLevel = 'M', mode = 'Byte' } = {}) {
  const qr = qrcode(version, ecLevel);
  qr.addData(text, mode);
  qr.make();
  const size = qr.getModuleCount();
  const modules = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) modules[r * size + c] = qr.isDark(r, c) ? 1 : 0;
  return { size, modules };
}

// One device pixel per module would blur when CSS scales it, so the canvas is sized in whole
// device pixels per module and then shown at CSS size.
export function drawMatrix(canvas, { size, modules }, maxCssWidth) {
  const dpr = window.devicePixelRatio || 1;
  const total = size + QUIET * 2;
  const scale = Math.max(1, Math.floor((maxCssWidth * dpr) / total));
  const px = total * scale;
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  canvas.style.width = canvas.style.height = `${px / dpr}px`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r * size + c]) ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
    }
  }
}

export function qrSvg(text) {
  const { size, modules } = makeMatrix(text, { ecLevel: 'M' });
  const total = size + QUIET * 2;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (modules[r * size + c]) path += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

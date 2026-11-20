const MAX_DECODE_SIZE = 720;

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    if (!formats.includes('qr_code')) return null;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    return {
      name: 'native',
      failed: false,
      async detect(video) {
        const codes = await detector.detect(video);
        return codes.map(c => c.rawValue);
      },
      close() {},
    };
  } catch {
    return null;
  }
}

function workerDetector() {
  const worker = new Worker(new URL('./scan-worker.js', import.meta.url));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let nextId = 0;
  let failure = null;
  const pending = new Map();
  worker.onmessage = e => {
    const request = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (request) request.resolve(e.data.text ? [e.data.text] : []);
  };
  // The worker script or jsQR failed to load: no reply will ever come.
  worker.onerror = () => {
    failure = new Error('The code reader could not start.');
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  };
  return {
    name: 'jsQR',
    get failed() {
      return failure !== null;
    },
    detect(video) {
      if (failure) return Promise.reject(failure);
      // The viewfinder shows the centre square of the video (object-fit: cover), so decode just that.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const side = Math.min(vw, vh);
      const size = Math.min(side, MAX_DECODE_SIZE);
      if (canvas.width !== size) canvas.width = canvas.height = size;
      ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, buffer: data.buffer, width: size, height: size }, [data.buffer]);
      });
    },
    close() {
      worker.terminate();
      for (const request of pending.values()) request.resolve([]);
      pending.clear();
    },
  };
}

export async function startScanner(video, onText, onFail) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  let running = true;
  let detector = null;
  const stop = () => {
    running = false;
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    if (detector) detector.close();
  };

  try {
    video.srcObject = stream;
    await video.play().catch(() => {});
    detector = (await nativeDetector()) || workerDetector();
  } catch (err) {
    stop();
    throw err;
  }

  const nextFrame = video.requestVideoFrameCallback
    ? fn => video.requestVideoFrameCallback(() => fn())
    : fn => requestAnimationFrame(() => fn());

  const loop = async () => {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        const texts = await detector.detect(video);
        if (running) texts.forEach(onText);
      } catch (err) {
        if (detector.failed) {
          stop();
          onFail(err);
          return;
        }
      }
    }
    if (running) nextFrame(loop);
  };
  nextFrame(loop);

  return { stop, detector: detector.name };
}

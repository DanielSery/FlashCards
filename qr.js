// Minimal QR Code generator (SVG output)
// Based on the public domain QR code algorithm
const QR = (() => {
  // Error correction level L (7%)
  const EC_L = 1;

  // Mode: byte
  const MODE_BYTE = 4;

  // Galois field tables
  const EXP = new Uint8Array(256);
  const LOG = new Uint8Array(256);
  (() => {
    let v = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = v;
      LOG[v] = i;
      v = (v << 1) ^ (v & 128 ? 0x11d : 0);
    }
    EXP[255] = EXP[0];
  })();

  function gfMul(a, b) {
    return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0;
  }

  function polyMul(a, b) {
    const r = new Uint8Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++)
        r[i + j] ^= gfMul(a[i], b[j]);
    return r;
  }

  function polyRest(data, gen) {
    const r = new Uint8Array(data.length + gen.length - 1);
    r.set(data);
    for (let i = 0; i < data.length; i++) {
      if (r[i]) {
        for (let j = 0; j < gen.length; j++)
          r[i + j] ^= gfMul(gen[j], r[i]);
      }
    }
    return r.slice(data.length);
  }

  function ecGenerator(n) {
    let g = new Uint8Array([1]);
    for (let i = 0; i < n; i++)
      g = polyMul(g, new Uint8Array([1, EXP[i]]));
    return g;
  }

  // Version info: [version, totalBytes, dataBytes, ecBytesPerBlock, numBlocks]
  // EC level L only, versions 1-20
  const VERSIONS = [
    null,
    [1,26,19,7,1],[2,44,34,10,1],[3,70,55,15,1],[4,100,80,20,1],
    [5,134,108,26,1],[6,172,136,18,2],[7,196,156,20,2],[8,242,194,24,2],
    [9,292,232,30,2],[10,346,274,18,2],[11,404,324,20,4],[12,466,370,24,4],
    [13,532,428,26,4],[14,581,461,30,4],[15,655,523,22,4],[16,733,589,24,4],
    [17,815,647,28,4],[18,901,721,30,4],[19,991,795,28,4],[20,1085,861,28,4],
  ];

  function pickVersion(len) {
    // Byte mode overhead: 4 bits mode + char count bits + data
    for (let v = 1; v <= 20; v++) {
      const ccBits = v <= 9 ? 8 : 16;
      const dataBits = VERSIONS[v][2] * 8;
      const needed = 4 + ccBits + len * 8;
      if (needed <= dataBits) return v;
    }
    return null;
  }

  function encode(str) {
    const bytes = new TextEncoder().encode(str);
    const ver = pickVersion(bytes.length);
    if (!ver) throw new Error('Data too long for QR');
    const info = VERSIONS[ver];
    const dataBytes = info[2];
    const ecBytes = info[3];
    const blocks = info[4];
    const ccBits = ver <= 9 ? 8 : 16;

    // Build bit stream
    const bits = [];
    function pushBits(val, len) {
      for (let i = len - 1; i >= 0; i--)
        bits.push((val >> i) & 1);
    }
    pushBits(MODE_BYTE, 4);
    pushBits(bytes.length, ccBits);
    for (const b of bytes) pushBits(b, 8);
    // Terminator
    const capacity = dataBytes * 8;
    const termLen = Math.min(4, capacity - bits.length);
    pushBits(0, termLen);
    // Pad to byte boundary
    while (bits.length % 8) bits.push(0);
    // Pad bytes
    let pad = 0;
    while (bits.length < capacity) {
      pushBits(pad % 2 === 0 ? 0xEC : 0x11, 8);
      pad++;
    }

    // Convert bits to bytes
    const data = new Uint8Array(dataBytes);
    for (let i = 0; i < dataBytes; i++) {
      let val = 0;
      for (let b = 0; b < 8; b++) val = (val << 1) | bits[i * 8 + b];
      data[i] = val;
    }

    // EC calculation
    const blockSize = Math.floor(dataBytes / blocks);
    const gen = ecGenerator(ecBytes);
    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (let i = 0; i < blocks; i++) {
      const bSize = blockSize + (i >= blocks - (dataBytes % blocks) && dataBytes % blocks ? 1 : 0);
      const block = data.slice(offset, offset + bSize);
      offset += bSize;
      dataBlocks.push(block);
      ecBlocks.push(polyRest(block, gen));
    }

    // Interleave
    const msg = [];
    const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxDataLen; i++)
      for (const b of dataBlocks) if (i < b.length) msg.push(b[i]);
    for (let i = 0; i < ecBytes; i++)
      for (const b of ecBlocks) if (i < b.length) msg.push(b[i]);

    return { version: ver, data: msg };
  }

  // QR matrix operations
  function createMatrix(ver) {
    const size = ver * 4 + 17;
    const matrix = Array.from({ length: size }, () => new Int8Array(size)); // 0=unset, 1=black, -1=white
    const reserved = Array.from({ length: size }, () => new Uint8Array(size));

    function setPixel(r, c, black) {
      if (r >= 0 && r < size && c >= 0 && c < size) {
        matrix[r][c] = black ? 1 : -1;
        reserved[r][c] = 1;
      }
    }

    // Finder patterns
    function finder(row, col) {
      for (let r = -1; r <= 7; r++)
        for (let c = -1; c <= 7; c++) {
          const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
          setPixel(row + r, col + c, inInner || onBorder);
        }
    }
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      setPixel(6, i, i % 2 === 0);
      setPixel(i, 6, i % 2 === 0);
    }

    // Alignment patterns (for version >= 2)
    if (ver >= 2) {
      const positions = alignmentPositions(ver);
      for (const r of positions)
        for (const c of positions) {
          if (reserved[r][c]) continue;
          for (let dr = -2; dr <= 2; dr++)
            for (let dc = -2; dc <= 2; dc++)
              setPixel(r + dr, c + dc,
                Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0));
        }
    }

    // Dark module
    setPixel(size - 8, 8, true);

    // Reserve format info areas
    for (let i = 0; i < 8; i++) {
      reserved[8][i] = 1; reserved[8][size - 1 - i] = 1;
      reserved[i][8] = 1; reserved[size - 1 - i][8] = 1;
    }
    reserved[8][8] = 1;

    // Reserve version info areas (version >= 7)
    if (ver >= 7) {
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 3; j++) {
          reserved[i][size - 11 + j] = 1;
          reserved[size - 11 + j][i] = 1;
        }
    }

    return { size, matrix, reserved };
  }

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    const last = ver * 4 + 10;
    const count = Math.floor(ver / 7) + 2;
    const step = Math.ceil((last - 6) / (count - 1));
    const positions = [6];
    for (let i = 1; i < count; i++) positions.push(last - (count - 1 - i) * step);
    return positions;
  }

  function placeData(matrix, reserved, size, msgBits) {
    let bitIdx = 0;
    let upward = true;
    for (let col = size - 1; col >= 0; col -= 2) {
      if (col === 6) col = 5; // skip timing column
      const rows = upward
        ? Array.from({ length: size }, (_, i) => size - 1 - i)
        : Array.from({ length: size }, (_, i) => i);
      for (const row of rows) {
        for (let dc = 0; dc <= 1; dc++) {
          const c = col - dc;
          if (c < 0 || reserved[row][c]) continue;
          matrix[row][c] = bitIdx < msgBits.length && msgBits[bitIdx] ? 1 : -1;
          bitIdx++;
        }
      }
      upward = !upward;
    }
  }

  function applyMask(matrix, reserved, size, maskId) {
    const maskFn = [
      (r, c) => (r + c) % 2 === 0,
      (r, c) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
      (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
    ][maskId];
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (!reserved[r][c] && maskFn(r, c))
          matrix[r][c] = matrix[r][c] === 1 ? -1 : 1;
  }

  function placeFormatInfo(matrix, size, maskId) {
    // EC level L = 01, mask pattern
    const formatBits = formatInfoBits((0b01 << 3) | maskId);
    const positions1 = [[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],[8,7],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0]];
    const positions2 = [[8,size-1],[8,size-2],[8,size-3],[8,size-4],[8,size-5],[8,size-6],[8,size-7],[8,size-8],[size-7,8],[size-6,8],[size-5,8],[size-4,8],[size-3,8],[size-2,8],[size-1,8]];
    for (let i = 0; i < 15; i++) {
      const bit = (formatBits >> (14 - i)) & 1;
      matrix[positions1[i][0]][positions1[i][1]] = bit ? 1 : -1;
      matrix[positions2[i][0]][positions2[i][1]] = bit ? 1 : -1;
    }
  }

  function formatInfoBits(data) {
    let d = data << 10;
    let gen = 0b10100110111;
    for (let i = 4; i >= 0; i--) {
      if (d & (1 << (i + 10))) d ^= gen << i;
    }
    return ((data << 10) | d) ^ 0b101010000010010;
  }

  function penalty(matrix, size) {
    let score = 0;
    // Simplified: just count adjacent same-color runs
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (matrix[r][c] === matrix[r][c - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (matrix[r][c] === matrix[r - 1][c]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    return score;
  }

  function generate(text) {
    const { version, data: msg } = encode(text);
    const { size, matrix, reserved } = createMatrix(version);

    // Convert message to bits
    const msgBits = [];
    for (const byte of msg)
      for (let i = 7; i >= 0; i--) msgBits.push((byte >> i) & 1);

    placeData(matrix, reserved, size, msgBits);

    // Try all 8 masks, pick best (lowest penalty)
    let bestMask = 0, bestPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
      const copy = matrix.map(r => Int8Array.from(r));
      applyMask(copy, reserved, size, m);
      placeFormatInfo(copy, size, m);
      const p = penalty(copy, size);
      if (p < bestPenalty) { bestPenalty = p; bestMask = m; }
    }

    applyMask(matrix, reserved, size, bestMask);
    placeFormatInfo(matrix, size, bestMask);

    return { matrix, size };
  }

  function toSVG(text, moduleSize = 4, margin = 4) {
    const { matrix, size } = generate(text);
    const totalSize = size * moduleSize + margin * 2;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">`;
    svg += `<rect width="${totalSize}" height="${totalSize}" fill="white"/>`;
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (matrix[r][c] === 1)
          svg += `<rect x="${margin + c * moduleSize}" y="${margin + r * moduleSize}" width="${moduleSize}" height="${moduleSize}" fill="black"/>`;
    svg += '</svg>';
    return svg;
  }

  return { toSVG };
})();

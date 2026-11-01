// QR Model 2, version 6, error correction L, byte mode, mask 0.
// Two blocks of 68 data + 18 Reed–Solomon codewords. No remote QR service.
export function publicShareUrl(origin: string, path: string) {
  const url = new URL(path, origin);
  if (
    url.origin !== new URL(origin).origin ||
    url.search ||
    url.hash ||
    !/^\/(register|fixtures|match|live)\/[0-9a-f-]{36}$/i.test(url.pathname)
  )
    throw new Error("Only public tournament links can be shared");
  return url.href;
}
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 134) throw new Error("Link is too long for this QR code. Use Copy link instead.");
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, 8);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, 1088 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let i = 0; data.length < 136; i++) data.push(i % 2 ? 0x11 : 0xec);
  const mul = (a: number, b: number) => {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a <<= 1;
      if (a & 256) a ^= 0x11d;
      b >>>= 1;
    }
    return r;
  };
  let generator = [1],
    root = 1;
  for (let i = 0; i < 18; i++) {
    const next = new Array(generator.length + 1).fill(0);
    generator.forEach((g, j) => {
      next[j] ^= g;
      next[j + 1] ^= mul(g, root);
    });
    generator = next;
    root = mul(root, 2);
  }
  const blocks = [data.slice(0, 68), data.slice(68)];
  const parity = blocks.map((block) => {
    const work = [...block, ...new Array(18).fill(0)];
    for (let i = 0; i < 68; i++) {
      const factor = work[i];
      generator.forEach((g, j) => {
        work[i + j] ^= mul(g, factor);
      });
    }
    return work.slice(68);
  });
  const code: number[] = [];
  for (let i = 0; i < 68; i++) for (const block of blocks) code.push(block[i]);
  for (let i = 0; i < 18; i++) for (const block of parity) code.push(block[i]);
  const size = 41,
    matrix = Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
    reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const set = (x: number, y: number, v: boolean) => {
    if (x >= 0 && y >= 0 && x < size && y < size) {
      matrix[y][x] = v;
      reserved[y][x] = true;
    }
  };
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let y = -4; y <= 4; y++)
      for (let x = -4; x <= 4; x++) {
        const d = Math.max(Math.abs(x), Math.abs(y));
        set(cx + x, cy + y, d !== 2 && d !== 4);
      }
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(34 + x, 34 + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
  const format = 0x77c4;
  for (let i = 0; i < 15; i++) {
    const v = !!((format >>> i) & 1);
    if (i < 6) set(8, i, v);
    else if (i === 6) set(8, 7, v);
    else if (i === 7) set(8, 8, v);
    else if (i === 8) set(7, 8, v);
    else set(14 - i, 8, v);
    if (i < 8) set(size - 1 - i, 8, v);
    else set(8, size - 15 + i, v);
  }
  set(8, size - 8, true);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (!reserved[y][x]) {
          const bit = index < code.length * 8 ? (code[index >>> 3] >>> (7 - (index & 7))) & 1 : 0;
          matrix[y][x] = !!(bit ^ ((x + y) % 2 === 0 ? 1 : 0));
          index++;
        }
      }
    }
  }
  return matrix;
}
export function qrSvg(text: string) {
  const matrix = qrMatrix(text);
  const path = matrix.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : []))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 49 49" width="392" height="392"><rect width="49" height="49" fill="white"/><path d="${path}" fill="black"/></svg>`;
}

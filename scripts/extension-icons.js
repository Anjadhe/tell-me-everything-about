// Render the favicon (public/favicon.svg) to the PNG sizes a browser extension
// needs. Pure Node: the icon is three shapes, so it is rasterised by hand with
// 4x supersampling rather than pulling in an SVG library.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const OUT = 'extension/icons';
const SS = 4; // samples per axis per pixel

const DARK = [0x17, 0x17, 0x17], WHITE = [0xff, 0xff, 0xff], BLUE = [0x2f, 0x6b, 0xff];

// Shapes in the SVG's 32x32 space. Returns [r, g, b, a] for a point, a in 0..1.
function sample(x, y) {
  // Rounded square, rx 7.
  const r = 7;
  const cx = Math.min(Math.max(x, r), 32 - r), cy = Math.min(Math.max(y, r), 32 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  // Dot.
  if ((x - 22.5) ** 2 + (y - 21) ** 2 <= 4) return [...BLUE, 1];
  // The L: M8 22.5 V9.5 h2.2 v11.2 H17 v1.8 z
  if ((x >= 8 && x <= 10.2 && y >= 9.5 && y <= 22.5) || (x >= 8 && x <= 17 && y >= 20.7 && y <= 22.5)) return [...WHITE, 1];
  return [...DARK, 1];
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const scale = 32 / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const [sr, sg, sb, sa] = sample((i + (si + 0.5) / SS) * scale, (j + (sj + 0.5) / SS) * scale);
      r += sr * sa; g += sg * sa; b += sb * sa; a += sa;
    }
    const o = (j * size + i) * 4;
    if (a > 0) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; }
    px[o + 3] = (a / (SS * SS)) * 255;
  }
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = [];
  for (let j = 0; j < size; j++) rows.push(Buffer.from([0]), px.subarray(j * size * 4, (j + 1) * size * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const s of SIZES) writeFileSync(`${OUT}/${s}.png`, png(s, render(s)));
console.log(`icons written: ${SIZES.map(s => `${s}.png`).join(', ')}`);

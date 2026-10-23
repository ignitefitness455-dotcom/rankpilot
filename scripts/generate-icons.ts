import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Pure-Node PNG generator (no native canvas/sharp dependency).
 * Generates crisp Pilot Indigo (#5B4FE9 -> #322B85) icons with a geometric "R" mark
 * for PWA installability (192x192, 512x512, maskable 512x512, apple-touch-icon 180x180).
 */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function renderIconPng(size: number, maskable = false): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const margin = maskable ? Math.floor(size * 0.2) : Math.floor(size * 0.14);
  const radius = maskable ? 0 : Math.floor(size * 0.22);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    const t = y / size;
    const bgR = Math.round(91 * (1 - t) + 50 * t);
    const bgG = Math.round(79 * (1 - t) + 43 * t);
    const bgB = Math.round(233 * (1 - t) + 133 * t);

    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;

      let insideBg = true;
      if (!maskable && radius > 0) {
        const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
        const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
        if (dx * dx + dy * dy > radius * radius) insideBg = false;
      }

      if (!insideBg) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      const nx = (x - margin) / (size - margin * 2);
      const ny = (y - margin) / (size - margin * 2);
      let isGlyph = false;
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
        const leftStem = nx >= 0.16 && nx <= 0.34 && ny >= 0.14 && ny <= 0.86;
        const topBar = nx >= 0.16 && nx <= 0.72 && ny >= 0.14 && ny <= 0.3;
        const midBar = nx >= 0.16 && nx <= 0.68 && ny >= 0.44 && ny <= 0.58;
        const rightBowl = nx >= 0.58 && nx <= 0.76 && ny >= 0.18 && ny <= 0.54;
        const diagLeg =
          ny >= 0.52 &&
          ny <= 0.86 &&
          Math.abs(nx - (0.38 + (ny - 0.52) * 1.05)) <= 0.095;
        isGlyph = leftStem || topBar || midBar || rightBowl || diagLeg;
      }

      if (isGlyph) {
        raw[px] = 255;
        raw[px + 1] = 255;
        raw[px + 2] = 255;
        raw[px + 3] = 255;
      } else {
        raw[px] = bgR;
        raw[px + 1] = bgG;
        raw[px + 2] = bgB;
        raw[px + 3] = 255;
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function generatePwaIcons(rootDir = process.cwd()): void {
  const outDir = resolve(rootDir, "public", "icons");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "icon-192.png"), renderIconPng(192, false));
  writeFileSync(resolve(outDir, "icon-512.png"), renderIconPng(512, false));
  writeFileSync(resolve(outDir, "icon-maskable-512.png"), renderIconPng(512, true));
  writeFileSync(resolve(outDir, "apple-touch-icon.png"), renderIconPng(180, false));
}

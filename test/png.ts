// a tiny png writer for the fake apps: grey pixels, strokes stamped as round dots

import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width: number, height: number, grey: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per sample
  header[9] = 0; // greyscale
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0; // no filter
    rows.set(grey.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

// draws strokes (points in page units) onto white paper, like a page export at that scale
export function renderStrokes(
  size: { w: number; h: number },
  strokes: { points: number[][]; size?: number }[],
  scale: number,
  region: Region = { x: 0, y: 0, w: size.w, h: size.h },
  bars: Region[] = []
): { png: string; w: number; h: number; scale: number } {
  // the long side stays at 3000 px, like the app does it
  const fit = Math.min(scale, 3000 / Math.max(region.w, region.h));
  const width = Math.max(1, Math.round(region.w * fit));
  const height = Math.max(1, Math.round(region.h * fit));
  const grey = new Uint8Array(width * height).fill(252);
  const dot = (cx: number, cy: number, r: number) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || x >= width) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) grey[y * width + x] = 30;
      }
    }
  };
  for (const bar of bars) {
    for (let y = Math.round((bar.y - region.y) * fit); y < (bar.y + bar.h - region.y) * fit; y++) {
      for (let x = Math.round((bar.x - region.x) * fit); x < (bar.x + bar.w - region.x) * fit; x++) {
        if (x >= 0 && y >= 0 && x < width && y < height) grey[y * width + x] = 120;
      }
    }
  }
  for (const stroke of strokes) {
    const r = Math.max(0.6, ((stroke.size ?? 1.6) * fit) / 2);
    const points = stroke.points.map(([x, y]) => [(x - region.x) * fit, (y - region.y) * fit]);
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[Math.min(i + 1, points.length - 1)];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.7));
      for (let s = 0; s <= steps; s++) dot(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, r);
    }
  }
  return { png: encodePng(width, height, grey).toString('base64'), w: width, h: height, scale: Math.round(fit * 100) / 100 };
}

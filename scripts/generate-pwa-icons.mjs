// Rasterizes the simple source geometry in public/pwa/icon.svg without dependencies.
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

const polygon = [[256,111],[284,221],[394,249],[284,277],[256,387],[228,277],[118,249],[228,221]];
function inside(x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function raster(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgb = [0, 0, 0];
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const px = (x + (sx + 0.5) / 2) * 512 / size, py = (y + (sy + 0.5) / 2) * 512 / size;
      const color = inside(px, py) ? [246,245,239] : (px - 349) ** 2 + (py - 150) ** 2 < 144 || (px - 159) ** 2 + (py - 354) ** 2 < 64 ? [182,203,182] : [39,79,67];
      for (let channel = 0; channel < 3; channel++) rgb[channel] += color[channel] / 4;
    }
    for (let channel = 0; channel < 3; channel++) raw[y * (size * 3 + 1) + 1 + x * 3 + channel] = Math.round(rgb[channel]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await writeFile(new URL(`../public/pwa/${name}`, import.meta.url), raster(size));
}
console.log('PWA icons: 192, 512, 180 pixels');

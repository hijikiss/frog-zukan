/**
 * PWA アイコン（PNG）を生成する。
 * ビルドツールを増やしたくないので、Node 標準の zlib だけで PNG を書き出す。
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const SS = 4; // スーパーサンプリング倍率（アンチエイリアス用）

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const BG = hex('#2f6b46');
const BODY = hex('#6fc98d');
const DARK = hex('#2a5f3f');
const WHITE = [255, 255, 255];
const PUPIL = hex('#17251d');

/** 正規化座標（0〜1）で図形を重ねる */
function shapes(scale, cy) {
  const s = (v) => 0.5 + (v - 0.5) * scale;
  const y = (v) => cy + (v - 0.5) * scale;

  return [
    { kind: 'ellipse', x: s(0.5), y: y(0.61), rx: 0.344 * scale, ry: 0.293 * scale, c: BODY },
    { kind: 'ellipse', x: s(0.32), y: y(0.355), rx: 0.148 * scale, ry: 0.148 * scale, c: BODY },
    { kind: 'ellipse', x: s(0.68), y: y(0.355), rx: 0.148 * scale, ry: 0.148 * scale, c: BODY },
    { kind: 'ellipse', x: s(0.32), y: y(0.355), rx: 0.102 * scale, ry: 0.102 * scale, c: WHITE },
    { kind: 'ellipse', x: s(0.68), y: y(0.355), rx: 0.102 * scale, ry: 0.102 * scale, c: WHITE },
    { kind: 'ellipse', x: s(0.328), y: y(0.367), rx: 0.055 * scale, ry: 0.055 * scale, c: PUPIL },
    { kind: 'ellipse', x: s(0.672), y: y(0.367), rx: 0.055 * scale, ry: 0.055 * scale, c: PUPIL },
    { kind: 'ellipse', x: s(0.344), y: y(0.348), rx: 0.018 * scale, ry: 0.018 * scale, c: WHITE },
    { kind: 'ellipse', x: s(0.688), y: y(0.348), rx: 0.018 * scale, ry: 0.018 * scale, c: WHITE },
    { kind: 'ellipse', x: s(0.441), y: y(0.586), rx: 0.016 * scale, ry: 0.016 * scale, c: DARK },
    { kind: 'ellipse', x: s(0.559), y: y(0.586), rx: 0.016 * scale, ry: 0.016 * scale, c: DARK },
    // 口：下向きの弧を、大きい楕円から少し上にずらした楕円を引いて作る
    { kind: 'ellipse', x: s(0.5), y: y(0.672), rx: 0.207 * scale, ry: 0.125 * scale, c: DARK },
    { kind: 'ellipse', x: s(0.5), y: y(0.625), rx: 0.223 * scale, ry: 0.125 * scale, c: BODY },
  ];
}

function render(size, { maskable = false } = {}) {
  const W = size * SS;
  const px = new Uint8Array(W * W * 4);

  const radius = maskable ? 0 : 0.219 * W; // 角丸（maskable は全面塗り）
  const list = shapes(maskable ? 0.78 : 1, maskable ? 0.5 : 0.5);

  for (let py = 0; py < W; py++) {
    for (let pxi = 0; pxi < W; pxi++) {
      const i = (py * W + pxi) * 4;

      // 背景（角丸の外は透明）
      if (!inRoundRect(pxi + 0.5, py + 0.5, W, radius)) {
        px[i + 3] = 0;
        continue;
      }
      let [r, g, b] = BG;

      const u = (pxi + 0.5) / W;
      const v = (py + 0.5) / W;

      for (const sh of list) {
        const dx = (u - sh.x) / sh.rx;
        const dy = (v - sh.y) / sh.ry;
        if (dx * dx + dy * dy <= 1) [r, g, b] = sh.c;
      }

      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }

  return { data: downsample(px, W, size), size };
}

function inRoundRect(x, y, W, r) {
  if (r <= 0) return true;
  const cx = Math.min(Math.max(x, r), W - r);
  const cy = Math.min(Math.max(y, r), W - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** SS×SS のボックスフィルタで縮小（＝アンチエイリアス） */
function downsample(src, W, size) {
  const out = new Uint8Array(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          const al = src[i + 3] / 255;
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += src[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      const alpha = a / n;
      // 事前乗算を戻す
      const k = alpha > 0 ? 255 / alpha : 0;
      out[o] = Math.round((r / n) * k);
      out[o + 1] = Math.round((g / n) * k);
      out[o + 2] = Math.round((b / n) * k);
      out[o + 3] = Math.round(alpha);
    }
  }
  return out;
}

/* ---------------- PNG エンコーダ ---------------- */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 各行の先頭にフィルタタイプ 0 を付ける
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4)
      .copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 出力 ---------------- */

for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
]) {
  const { data } = render(size, opts);
  writeFileSync(join(OUT, name), png(data, size));
  console.log(`icons/${name}  (${size}x${size})`);
}

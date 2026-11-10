// 画像素材は1枚も持たない。スプライトもタイルも、起動時にこのコードが1ピクセルずつ描く。
import { RNG } from '../core/rng.js';

export const ATLAS_SIZE = 256;

function hex(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }

class Spr {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }
  set(x, y, c, a = 255) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, [r, g, b] = typeof c === 'number' ? hex(c) : c;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = a;
  }
  alpha(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[(y * this.w + x) * 4 + 3]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
  }
  // 陰影つきの楕円。ramp は暗→明の色の並びで、2x2 のディザで段を混ぜる。
  ball(cx, cy, rx, ry, ramp) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny;
      if (d > 1) continue;
      const nz = Math.sqrt(1 - d);
      let v = (-nx * 0.45 - ny * 0.6 + nz * 0.66 + 0.35) / 1.35;
      v = v * ramp.length + (((x & 1) ^ (y & 1)) ? 0.22 : -0.22);
      this.set(x, y, ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(v)))]);
    }
  }
  outline(c) {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.alpha(x, y)) continue;
      if (this.alpha(x - 1, y) || this.alpha(x + 1, y) || this.alpha(x, y - 1) || this.alpha(x, y + 1)) add.push(x, y);
    }
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], c);
    return this;
  }
}

const INK = 0x0a0812;

function player(f) {
  const s = new Spr(16, 16), cloak = [0x1d2b4f, 0x2f4a7d, 0x4a72b0, 0x8fb4e6];
  s.ball(7.5, 10.5, 4.3, 4.2, cloak);
  s.rect(4, 13, 7, 1, 0x1d2b4f);
  s.ball(7.5, 5.5, 3.4, 3.3, [0x1a2440, 0x2a3d6b, 0x3f5f98, 0x6d8fc8]);
  s.rect(6, 5, 4, 2, 0x0d0f1a); s.set(7, 5, 0xffe9b0); s.set(9, 5, 0xffe9b0);
  s.set(5 + f, 15, 0x161a30); s.set(6 + f, 15, 0x161a30); s.set(9 - f, 15, 0x161a30); s.set(10 - f, 15, 0x161a30);
  s.line(11, 9, 12, 8, 0x8a7a66); s.rect(12, 9 + f, 2, 1, 0x6b5a4a); s.rect(12, 10 + f, 2, 3, 0xffd27a);
  s.set(12, 11 + f, 0xfff6d8); s.rect(12, 13 + f, 2, 1, 0x6b5a4a);
  return s.outline(INK);
}
function mite(f) {
  const s = new Spr(16, 16);
  s.ball(8, 10.5 - f * 0.5, 4.2 - f * 0.3, 3.2 + f * 0.5, [0x2a1436, 0x4a2260, 0x7a3a96, 0xc07ae0]);
  s.set(6, 10, 0xffe36b); s.set(9, 10, 0xffe36b); s.set(6, 11, 0xff9a3b); s.set(9, 11, 0xff9a3b);
  for (const x of [4, 6, 9, 11]) s.set(x + (f && (x & 1) ? 1 : 0), 14, 0x2a1436);
  return s.outline(INK);
}
function spitter(f) {
  const s = new Spr(16, 16);
  s.ball(8, 9, 4.7, 4.7, [0x12301f, 0x1f5a34, 0x3a8f4e, 0x8fe08a]);
  s.ball(10.5, 10.5, 1.6 + f * 0.6, 1.6 + f * 0.6, [0x1a0d12, 0x1a0d12, 0xff5e7a]);
  s.rect(6, 6, 2, 2, 0xf4ffe8); s.set(7, 7, 0x10130f);
  s.set(5, 13, 0x12301f); s.set(10, 14, 0x12301f); s.set(7, 14, 0x12301f);
  return s.outline(INK);
}
function charger(f) {
  const s = new Spr(16, 16), body = [0x3b1616, 0x6e2a22, 0xa8452f, 0xe08a5a];
  s.ball(7, 10, 5.6, 4.2, body); s.ball(11.5, 9, 3, 3, body);
  s.line(12, 6, 14, 3, 0xf0e0c0); s.line(10, 6, 10, 3, 0xf0e0c0);
  s.set(12, 9, 0xff3b3b); s.set(13, 9, 0xffd0a0); s.rect(13, 11, 2, 1, 0x1a0b0b);
  for (const x of [3, 6, 9, 11]) s.rect(x + ((x & 1) === f ? 1 : 0), 14, 1, 2, 0x3b1616);
  return s.outline(INK);
}
function bomber(f) {
  const s = new Spr(16, 16);
  s.ball(8, 10, 4.6, 4.6, [0x4a1208, 0x8f2a10, 0xd9541e, 0xffb04a]);
  s.line(8, 5, 9, 3, 0xc8b08a); s.set(9 + f, 2 - f + 1, 0xfff3a0); s.set(10 - f, 1 + f, 0xff9a3b);
  s.set(6, 9, 0x1a0806); s.set(10, 9, 0x1a0806); s.rect(6, 12, 5, 1, 0x1a0806); s.set(7, 12, 0xffe9b0); s.set(9, 12, 0xffe9b0);
  return s.outline(INK);
}
function shade(f) {
  const s = new Spr(16, 16), ramp = [0x101838, 0x1c2c5c, 0x34509a, 0x6f8fe0];
  s.ball(8, 7, 4.6, 4.6, ramp);
  for (let y = 9; y < 15; y++) {
    const w = 4.5 - (y - 9) * 0.7, off = Math.sin(y * 1.3 + f * 2.2) * 1.1;
    for (let x = Math.round(8 - w + off); x < Math.round(8 + w + off); x++) s.set(x, y, ramp[y > 12 ? 0 : 1]);
  }
  s.rect(6, 6, 1, 2, 0xd8f4ff); s.rect(9, 6, 1, 2, 0xd8f4ff);
  return s.outline(0x05060f);
}
function weaver(f) {
  const s = new Spr(16, 16);
  for (let k = 0; k < 3; k++) {
    const y = 7 + k * 2, b = (k + f) & 1;
    s.line(4, y, 1, y + 2 - b, 0x22123a); s.line(12, y, 15, y + 2 - b, 0x22123a);
  }
  s.ball(8, 9, 4.6, 4.2, [0x22123a, 0x3d2166, 0x6a3aa8, 0xa878f0]);
  for (const [x, y] of [[6, 8], [8, 7], [10, 8], [7, 10], [9, 10]]) s.set(x, y, 0xff7ad9);
  return s.outline(INK);
}
function sentinel(f) {
  const s = new Spr(16, 16);
  s.ball(8, 9, 6, 6, [0x23242b, 0x3d3f4a, 0x62657a, 0xa4a8c4]);
  s.rect(3, 14, 10, 2, 0x23242b);
  s.ball(8, 9, 2.8, 2.8, [0x0b3a4a, 0x1890a8, 0x5fe0f0, 0xe8ffff]);
  s.rect(7 + f, 8, 2, 2, 0x04131a);
  return s.outline(INK);
}
function urn() {
  const s = new Spr(16, 16);
  s.ball(8, 10.5, 4.2, 4.6, [0x4a2f1c, 0x7a4d2c, 0xa8703f, 0xdcae7c]);
  s.rect(6, 4, 4, 3, 0x8a5a34); s.rect(5, 3, 6, 1, 0xdcae7c); s.rect(5, 9, 7, 1, 0x4a2f1c); s.rect(4, 15, 8, 1, 0x4a2f1c);
  return s.outline(INK);
}
function unlit(f) {
  const s = new Spr(40, 40), ramp = [0x0c0a16, 0x1a1630, 0x302654, 0x57468c];
  for (const [x, h] of [[9, 9], [14, 12], [20, 15], [26, 12], [31, 9]]) {
    for (let k = 0; k < h; k++) { const w = Math.max(1, Math.round(2.4 - (k * 2.4) / h)); s.rect(x - w + 1, 12 - k, w * 2 - 1, 1, k > h - 3 ? 0xe8e0f0 : 0x8f86a8); }
  }
  s.ball(20, 23, 15.5, 13, ramp);
  for (let x = 6; x < 35; x += 4) {
    const len = 3 + ((x * 7 + f * 3) % 4);
    s.rect(x + ((x >> 2) + f) % 2, 34, 2, len, ramp[1]);
  }
  for (const cx of [13.5, 26.5]) s.ball(cx, 20 + f * 0.5, 2.8, 3.8, [0xff4d5e, 0xff8a3a, 0xffd27a, 0xfff6d8]);
  s.rect(13, 20, 1, 2, 0x12060a); s.rect(26, 20, 1, 2, 0x12060a);
  s.rect(12, 28, 17, 3, 0x07050d);
  for (let x = 12; x < 29; x += 3) { s.rect(x, 28, 2, 1 + (x % 2), 0xe8e0f0); s.rect(x + 1, 30 - (x % 2), 1, 1, 0xbcb2cc); }
  return s.outline(0x05040a);
}
function ember() {
  const s = new Spr(8, 8);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const d = Math.abs(x - 3) + Math.abs(y - 3);
    if (d <= 3) s.set(x, y, d === 0 ? 0xffffff : d === 1 ? 0xffe9b0 : d === 2 ? 0xffb347 : 0xff7a2f);
  }
  return s;
}
function oil() {
  const s = new Spr(8, 10);
  s.rect(3, 0, 2, 1, 0x8a7a66); s.rect(3, 1, 2, 2, 0x9fd0e8);
  s.ball(4, 6, 3.2, 3.4, [0x8a5a12, 0xd08a1a, 0xffc24a, 0xfff0b0]);
  s.rect(2, 3, 1, 1, 0xdff4ff);
  return s.outline(INK);
}
function heart() {
  const s = new Spr(9, 8), rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  rows.forEach((r, y) => { for (let x = 0; x < 7; x++) if (r[x] === 'X') s.set(x + 1, y + 1, y < 2 && x < 3 ? 0xff9aa8 : 0xff4d5e); });
  s.set(2, 2, 0xffe0e6);
  return s.outline(INK);
}
function torch(lit) {
  const s = new Spr(8, 10);
  s.rect(3, 5, 2, 5, 0x4a3a2c); s.rect(1, 3, 6, 2, 0x6b6470); s.rect(2, 5, 4, 1, 0x3a3640);
  if (lit) { s.rect(2, 1, 4, 2, 0xff9a3b); s.rect(3, 0, 2, 2, 0xffe9b0); }
  else s.rect(2, 2, 4, 1, 0x1a1418);
  return s.outline(INK);
}
function chest(open) {
  const s = new Spr(16, 14);
  s.rect(2, 6, 12, 7, 0x6e4424); s.rect(2, 6, 12, 1, 0x3a2412); s.rect(2, 12, 12, 1, 0x3a2412);
  for (const x of [2, 7, 8, 13]) s.rect(x, 6, 1, 7, 0xd9a441);
  if (open) { s.rect(2, 1, 12, 3, 0x4a2c14); s.rect(3, 4, 10, 2, 0xfff0b0); s.rect(4, 3, 8, 1, 0xffd27a); }
  else { s.rect(2, 2, 12, 4, 0x8a5a30); s.rect(2, 2, 12, 1, 0xb07a44); s.rect(7, 5, 2, 3, 0xffe9b0); }
  return s.outline(INK);
}
function shrine(used) {
  const s = new Spr(16, 16), st = [0x2c2a36, 0x4a4858, 0x74728a, 0xa8a6c0];
  s.ball(8, 13, 6, 2.6, st); s.rect(6, 8, 4, 5, 0x4a4858); s.rect(7, 8, 1, 5, 0x74728a);
  s.ball(8, 7, 5.5, 2.4, st); s.rect(4, 6, 8, 1, used ? 0x1a1820 : 0x9fe8ff);
  if (!used) s.rect(6, 5, 4, 1, 0xe8ffff);
  return s.outline(INK);
}
function stairs() {
  const s = new Spr(16, 16);
  for (let k = 0; k < 6; k++) {
    const v = 150 - k * 24;
    s.rect(1 + k, 1 + k, 14 - k * 2, 14 - k * 2, [v, v * 0.95, v * 0.9]);
    s.rect(1 + k, 1 + k, 14 - k * 2, 1, [v * 0.55, v * 0.5, v * 0.5]);
  }
  s.rect(6, 6, 4, 4, 0x050408);
  return s;
}
function gate() {
  const s = new Spr(16, 16);
  for (let x = 1; x < 16; x += 4) { s.rect(x, 0, 2, 16, 0x5a5560); s.rect(x, 0, 1, 16, 0x8a8494); }
  s.rect(0, 3, 16, 2, 0x45414c); s.rect(0, 11, 16, 2, 0x45414c);
  for (let x = 1; x < 16; x += 4) { s.set(x, 3, 0xff6a4a); s.set(x, 11, 0xff6a4a); }
  return s;
}
function glow(n) {
  const s = new Spr(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
    if (d < 1) s.set(x, y, 0xffffff, Math.round(255 * (1 - d) * (1 - d)));
  }
  return s;
}
function ringSpr(n) {
  const s = new Spr(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2), a = 1 - Math.abs(d - 0.86) / 0.12;
    if (a > 0) s.set(x, y, 0xffffff, Math.round(255 * a));
  }
  return s;
}
function shadow() {
  const s = new Spr(16, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
    const d = ((x + 0.5 - 8) / 8) ** 2 + ((y + 0.5 - 4) / 4) ** 2;
    if (d < 1) s.set(x, y, 0x000000, Math.round(150 * (1 - d)));
  }
  return s;
}
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];
function digit(n) {
  const s = new Spr(3, 5);
  for (let i = 0; i < 15; i++) if (DIGITS[n][i] === '1') s.set(i % 3, (i / 3) | 0, 0xffffff);
  return s;
}

// --- タイル。灰色で描いておき、階層ごとの色は描画時に掛ける。
function grey(s, x, y, v) { const c = Math.max(0, Math.min(255, Math.round(v * 255))); s.set(x, y, [c, Math.round(c * 0.96), Math.round(c * 0.92)]); }
function floorTile(seed) {
  const s = new Spr(16, 16), rng = new RNG(seed), slab = [];
  for (let i = 0; i < 9; i++) slab.push(rng.range(-0.05, 0.05));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 3, ox = (x + (row ? 4 : 0)) & 15, col = ox >> 3;
    let v = 0.44 + slab[row * 2 + col] + rng.range(-0.025, 0.025);
    if ((y & 7) === 0 || (ox & 7) === 0) v = 0.24;
    else if ((y & 7) === 1 || (ox & 7) === 1) v += 0.06;
    grey(s, x, y, v);
  }
  for (let i = 0; i < 3; i++) {
    let x = rng.int(16), y = rng.int(16);
    for (let k = 0; k < rng.irange(2, 5); k++) { grey(s, x, y, 0.33); x += rng.irange(-1, 1); y += 1; }
  }
  if (seed % 2) for (let i = 0; i < 4; i++) grey(s, rng.int(16), rng.int(16), 0.62);
  return s;
}
function wallTop(seed) {
  const s = new Spr(16, 16), rng = new RNG(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let v = 0.2 + rng.range(-0.015, 0.015);
    if ((y & 7) === 7 || ((x + (y >> 3) * 8) & 15) === 15) v = 0.13;
    grey(s, x, y, v);
  }
  return s;
}
function wallFace(seed) {
  const s = new Spr(16, 16), rng = new RNG(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2, ox = (x + (row & 1) * 4) & 7;
    let v = 0.46 + rng.range(-0.035, 0.035) - y * 0.008;
    if ((y & 3) === 3 || ox === 7) v = 0.24;
    else if ((y & 3) === 0) v += 0.07;
    if (y < 2) v = 0.72 - y * 0.1;
    if (y === 15) v = 0.14;
    grey(s, x, y, v);
  }
  return s;
}
function doorFloor() {
  const s = floorTile(77);
  for (let i = 0; i < 16; i++) { grey(s, i, 0, 0.22); grey(s, i, 15, 0.22); grey(s, 0, i, 0.22); grey(s, 15, i, 0.22); }
  return s;
}

export function buildAtlas() {
  const A = ATLAS_SIZE, pixels = new Uint8Array(A * A * 4), sprites = {};
  let cx = 1, cy = 1, rowH = 0;
  const add = (name, s) => {
    if (cx + s.w + 1 > A) { cx = 1; cy += rowH + 1; rowH = 0; }
    if (cy + s.h + 1 > A) throw new Error('atlas full');
    for (let y = 0; y < s.h; y++) pixels.set(s.d.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((cy + y) * A + cx) * 4);
    sprites[name] = { u: cx / A, v: cy / A, w: s.w / A, h: s.h / A, pw: s.w, ph: s.h };
    cx += s.w + 1; rowH = Math.max(rowH, s.h);
  };
  const anim = { player, mite, spitter, charger, bomber, shade, weaver, sentinel, unlit };
  for (const k in anim) { add(k + '0', anim[k](0)); add(k + '1', anim[k](1)); }
  add('urn0', urn()); add('urn1', urn());
  add('ember', ember()); add('oil', oil()); add('heart', heart());
  add('torchOn', torch(true)); add('torchOff', torch(false));
  add('chest', chest(false)); add('chestOpen', chest(true));
  add('shrine', shrine(false)); add('shrineUsed', shrine(true));
  add('stairs', stairs()); add('gate', gate());
  add('glow', glow(32)); add('ring', ringSpr(48)); add('shadow', shadow());
  const white = new Spr(4, 4); white.rect(0, 0, 4, 4, 0xffffff); add('white', white);
  for (let i = 0; i < 10; i++) add('d' + i, digit(i));
  for (let i = 0; i < 4; i++) add('floor' + i, floorTile(100 + i));
  for (let i = 0; i < 2; i++) { add('wallTop' + i, wallTop(200 + i)); add('wallFace' + i, wallFace(300 + i)); }
  add('doorFloor', doorFloor());
  return { size: A, pixels, sprites };
}

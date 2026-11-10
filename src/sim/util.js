// 地形への問い合わせと当たり判定。
import { T_FLOOR, T_DOOR } from './dungeon.js';

export const DT = 1 / 60;
export const TAU = Math.PI * 2;

export function rebuildSolid(m) {
  for (let i = 0; i < m.tiles.length; i++) {
    const t = m.tiles[i];
    m.solid[i] = t === T_FLOOR || (t === T_DOOR && !m.barred[i]) ? 0 : 1;
  }
  m.version++;
}

export function solidAt(m, x, y) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true;
  return m.solid[(y | 0) * m.w + (x | 0)] === 1;
}

// 2点の間に壁がないか（格子を1マスずつたどる DDA）。
export function lineClear(m, x0, y0, x1, y1) {
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const ex = Math.floor(x1), ey = Math.floor(y1);
  const dx = x1 - x0, dy = y1 - y0, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx === 0 ? Infinity : Math.abs(1 / dx), tdy = dy === 0 ? Infinity : Math.abs(1 / dy);
  let tmx = dx === 0 ? Infinity : (dx > 0 ? tx + 1 - x0 : x0 - tx) * tdx;
  let tmy = dy === 0 ? Infinity : (dy > 0 ? ty + 1 - y0 : y0 - ty) * tdy;
  for (let i = 0; i < 400; i++) {
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || m.solid[ty * m.w + tx]) return false;
    if (tx === ex && ty === ey) return true;
    if (tmx < tmy) { tmx += tdx; tx += sx; } else { tmy += tdy; ty += sy; }
  }
  return false;
}

function pushOut(m, e) {
  let any = false;
  const r = e.r;
  for (let it = 0; it < 3; it++) {
    let moved = false;
    const x0 = Math.floor(e.x - r), x1 = Math.floor(e.x + r), y0 = Math.floor(e.y - r), y1 = Math.floor(e.y + r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!(tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || m.solid[ty * m.w + tx])) continue;
      const nx = Math.min(Math.max(e.x, tx), tx + 1), ny = Math.min(Math.max(e.y, ty), ty + 1);
      const ox = e.x - nx, oy = e.y - ny, d2 = ox * ox + oy * oy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), k = (r - d) / d;
        e.x += ox * k; e.y += oy * k;
      } else {
        const l = e.x - tx, rr = tx + 1 - e.x, t = e.y - ty, b = ty + 1 - e.y, mn = Math.min(l, rr, t, b);
        if (mn === l) e.x = tx - r; else if (mn === rr) e.x = tx + 1 + r; else if (mn === t) e.y = ty - r; else e.y = ty + 1 + r;
      }
      moved = true; any = true;
    }
    if (!moved) break;
  }
  return any;
}

// 円を動かして壁から押し出す。戻り値のビット: 1=横で衝突 2=縦で衝突
export function moveCircle(m, e, dx, dy) {
  let hit = 0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.3));
  for (let i = 0; i < steps; i++) {
    e.x += dx / steps; if (pushOut(m, e)) hit |= 1;
    e.y += dy / steps; if (pushOut(m, e)) hit |= 2;
  }
  return hit;
}

// 目標タイルからの歩数（4方向の幅優先探索）。届かないマスは 65535。
export function distanceField(m, tx, ty, out) {
  const W = m.w, d = out || new Uint16Array(W * m.h);
  d.fill(65535);
  if (solidAt(m, tx, ty)) return d;
  const q = distanceField.q && distanceField.q.length === d.length ? distanceField.q : (distanceField.q = new Int32Array(d.length));
  let head = 0, tail = 0;
  q[tail++] = ty * W + tx; d[ty * W + tx] = 0;
  while (head < tail) {
    const c = q[head++], nd = d[c] + 1;
    const cx = c % W;
    if (cx > 0 && !m.solid[c - 1] && d[c - 1] > nd) { d[c - 1] = nd; q[tail++] = c - 1; }
    if (cx < W - 1 && !m.solid[c + 1] && d[c + 1] > nd) { d[c + 1] = nd; q[tail++] = c + 1; }
    if (c >= W && !m.solid[c - W] && d[c - W] > nd) { d[c - W] = nd; q[tail++] = c - W; }
    if (c < d.length - W && !m.solid[c + W] && d[c + W] > nd) { d[c + W] = nd; q[tail++] = c + W; }
  }
  return d;
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1], NY = [0, 0, 1, -1, 1, -1, 1, -1];
// 距離場を下る（sign=1）か上る（sign=-1）向きの、次に目指す点を返す。
export function fieldStep(m, d, x, y, sign, out) {
  const tx = x | 0, ty = y | 0, W = m.w;
  let best = d[ty * W + tx], bx = tx, by = ty;
  if (best === 65535 && sign > 0) best = 65535;
  for (let k = 0; k < 8; k++) {
    const nx = tx + NX[k], ny = ty + NY[k];
    if (nx < 0 || ny < 0 || nx >= W || ny >= m.h || m.solid[ny * W + nx]) continue;
    if (k >= 4 && (m.solid[ty * W + nx] || m.solid[ny * W + tx])) continue; // 角をまたがない
    const v = d[ny * W + nx];
    if (v === 65535) continue;
    if (sign > 0 ? v < best : v > best) { best = v; bx = nx; by = ny; }
  }
  out.x = bx + 0.5; out.y = by + 0.5;
  return bx !== tx || by !== ty;
}

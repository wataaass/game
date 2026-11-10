// 光と視界の「見える範囲」を多角形で求める。
// 壁の辺の端点へ向けて光線を飛ばし、いちばん近い交点を角度順につなぐ（可視ポリゴン）。

// 固体と空間の境目にある辺を、同じ直線上でつないで線分にまとめる。
export function buildSegments(m) {
  const W = m.w, H = m.h, segs = [];
  const s = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 1 : m.solid[y * W + x]);
  for (let y = 0; y <= H; y++) {
    let start = 0, kind = 0;
    for (let x = 0; x <= W; x++) {
      const a = s(x, y - 1), b = s(x, y), k = x < W && a !== b ? (b ? 1 : 2) : 0;
      if (k !== kind) { if (kind) segs.push(start, y, x, y); start = x; kind = k; }
    }
  }
  for (let x = 0; x <= W; x++) {
    let start = 0, kind = 0;
    for (let y = 0; y <= H; y++) {
      const a = s(x - 1, y), b = s(x, y), k = y < H && a !== b ? (b ? 1 : 2) : 0;
      if (k !== kind) { if (kind) segs.push(x, start, x, y); start = y; kind = k; }
    }
  }
  return new Float32Array(segs);
}

let vp_near = new Float32Array(4096), vp_ang = new Float64Array(4096);

// 戻り値: 三角形ファン用の頂点列 [中心, 外周..., 外周の先頭]
export function visPolygon(segs, ox, oy, R) {
  let n = 0;
  const x0 = ox - R, x1 = ox + R, y0 = oy - R, y1 = oy + R;
  const push = (ax, ay, bx, by) => {
    if (n + 4 > vp_near.length) { const t = new Float32Array(vp_near.length * 2); t.set(vp_near); vp_near = t; }
    vp_near[n++] = ax; vp_near[n++] = ay; vp_near[n++] = bx; vp_near[n++] = by;
  };
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3];
    if (bx < x0 || ax > x1 || by < y0 || ay > y1) continue;
    push(Math.max(ax, x0), Math.max(ay, y0), Math.min(bx, x1), Math.min(by, y1));
  }
  push(x0, y0, x1, y0); push(x1, y0, x1, y1); push(x0, y1, x1, y1); push(x0, y0, x0, y1);
  const na = (n / 2) * 3;
  if (na > vp_ang.length) vp_ang = new Float64Array(na * 2);
  let k = 0;
  for (let i = 0; i < n; i += 2) {
    const a = Math.atan2(vp_near[i + 1] - oy, vp_near[i] - ox);
    vp_ang[k++] = a - 1e-4; vp_ang[k++] = a; vp_ang[k++] = a + 1e-4;
  }
  const ang = vp_ang.subarray(0, k).sort();
  const out = new Float32Array((k + 2) * 2);
  out[0] = ox; out[1] = oy;
  let o = 2;
  for (let j = 0; j < k; j++) {
    const dx = Math.cos(ang[j]), dy = Math.sin(ang[j]);
    let best = R * 1.5;
    for (let i = 0; i < n; i += 4) {
      const ax = vp_near[i], ay = vp_near[i + 1], sx = vp_near[i + 2] - ax, sy = vp_near[i + 3] - ay;
      const den = dx * sy - dy * sx;
      if (den > -1e-9 && den < 1e-9) continue;
      const t = ((ax - ox) * sy - (ay - oy) * sx) / den;
      if (t <= 0 || t >= best) continue;
      const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
      if (u >= -1e-6 && u <= 1 + 1e-6) best = t;
    }
    out[o++] = ox + dx * best; out[o++] = oy + dy * best;
  }
  out[o++] = out[2]; out[o++] = out[3];
  return out;
}

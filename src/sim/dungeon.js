// ダンジョン生成。種と階層から同じ地形を必ず再現する。
// 手順: 部屋を間隔つきで配置 → 最小全域木＋少数のループで接続 → A* で幅2の通路を掘る
//       → 部屋の内部を変形 → 扉から中心までの通り道を保証 → 到達できない床を埋める。
import { RNG, mix32 } from '../core/rng.js';

export const T_VOID = 0, T_FLOOR = 1, T_WALL = 2, T_DOOR = 3;
export const MAP_W = 84, MAP_H = 60;
const ROOM_GAP = 5; // 部屋どうしの間に幅2の通路が必ず通る間隔

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0];
    const lk = k.pop(), lv = v.pop(), n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

function tooClose(a, b, m) {
  return a.x - m < b.x + b.w && a.x + a.w + m > b.x && a.y - m < b.y + b.h && a.y + a.h + m > b.y;
}

export function generateDungeon(seed, depth) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const d = tryGenerate(mix32(mix32(seed >>> 0, depth), attempt), depth);
    if (d) { d.seed = seed >>> 0; d.depth = depth; return d; }
  }
  throw new Error('dungeon generation failed');
}

function tryGenerate(s, depth) {
  const W = MAP_W, H = MAP_H, rng = new RNG(s);
  const boss = depth % 5 === 0;
  const rooms = [];
  const place = (w, h, tries) => {
    for (let i = 0; i < tries; i++) {
      const r = { x: rng.irange(5, W - w - 6), y: rng.irange(5, H - h - 6), w, h };
      if (rooms.every(o => !tooClose(r, o, ROOM_GAP))) { rooms.push(r); return r; }
    }
    return null;
  };
  if (boss) {
    place(7, 7, 300); place(25, 17, 600); place(9, 7, 600);
    if (rooms.length < 3) return null;
  } else {
    const want = Math.min(8 + depth, 12);
    place(7, 7, 100);
    for (let i = 0; i < 500 && rooms.length < want; i++) place(rng.irange(9, 15), rng.irange(7, 11), 1);
    if (rooms.length < 6) return null;
  }
  rooms.forEach((r, i) => {
    r.id = i; r.cx = r.x + (r.w >> 1); r.cy = r.y + (r.h >> 1);
    r.links = []; r.doors = []; r.torches = []; r.props = []; r.state = 'idle'; r.role = 'combat';
  });

  // --- 接続グラフ: Prim 法の最小全域木に、近い部屋どうしのループを少し足す
  const n = rooms.length;
  const dist2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
  const edges = [], inTree = new Array(n).fill(false);
  inTree[0] = true;
  for (let c = 1; c < n; c++) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < n; i++) if (inTree[i]) for (let j = 0; j < n; j++) if (!inTree[j]) {
      const d = dist2(rooms[i], rooms[j]);
      if (d < best) { best = d; bi = i; bj = j; }
    }
    inTree[bj] = true; edges.push([bi, bj]);
  }
  const linked = (i, j) => edges.some(e => (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i));
  if (!boss) {
    let extra = 0;
    for (let i = 0; i < n && extra < 3; i++) for (let j = i + 1; j < n && extra < 3; j++) {
      if (!linked(i, j) && dist2(rooms[i], rooms[j]) < 24 * 24 && rng.chance(0.22)) { edges.push([i, j]); extra++; }
    }
  }
  for (const [i, j] of edges) { rooms[i].links.push(j); rooms[j].links.push(i); }

  // --- 通路: 幅2のブラシ（左上基準の2x2）が通れないセルを先に求める
  const tiles = new Uint8Array(W * H);
  const blocked = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x < 1 || y < 1 || x > W - 3 || y > H - 3) { blocked[y * W + x] = 1; continue; }
    for (const r of rooms) {
      if (x + 1 >= r.x - 1 && x <= r.x + r.w && y + 1 >= r.y - 1 && y <= r.y + r.h) { blocked[y * W + x] = 1; break; }
    }
  }
  const carved = new Uint8Array(W * H);
  const makeDoor = (r, o) => {
    const dx = o.cx - r.cx, dy = o.cy - r.cy;
    if (Math.abs(dx) * r.h > Math.abs(dy) * r.w) {
      const py = rng.irange(r.y + 1, r.y + r.h - 3);
      return dx > 0
        ? { cells: [[r.x + r.w, py], [r.x + r.w, py + 1]], start: [r.x + r.w + 1, py], inner: [r.x + r.w - 1, py], horiz: true }
        : { cells: [[r.x - 1, py], [r.x - 1, py + 1]], start: [r.x - 3, py], inner: [r.x, py], horiz: true };
    }
    const px = rng.irange(r.x + 1, r.x + r.w - 3);
    return dy > 0
      ? { cells: [[px, r.y + r.h], [px + 1, r.y + r.h]], start: [px, r.y + r.h + 1], inner: [px, r.y + r.h - 1], horiz: false }
      : { cells: [[px, r.y - 1], [px + 1, r.y - 1]], start: [px, r.y - 3], inner: [px, r.y], horiz: false };
  };
  const brush = (x, y) => {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { tiles[(y + j) * W + x + i] = T_FLOOR; carved[(y + j) * W + x + i] = 1; }
  };
  const lanes = [];
  for (const [i, j] of edges) {
    const da = makeDoor(rooms[i], rooms[j]), db = makeDoor(rooms[j], rooms[i]);
    const path = route(da.start, db.start, blocked, carved, W, H);
    if (!path) return null;
    for (const c of path) brush(c % W, (c / W) | 0);
    for (const [d, r] of [[da, rooms[i]], [db, rooms[j]]]) {
      for (const [x, y] of d.cells) r.doors.push({ x, y });
      lanes.push({ r, d });
    }
  }

  // --- 部屋の内部
  const solidIn = new Uint8Array(W * H); // 部屋の中に置く柱や岩
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles[y * W + x] = T_FLOOR;
  }
  // 役割: 開始部屋から最も遠い部屋が出口。行き止まりは宝部屋。
  const gd = graphDist(rooms, 0);
  rooms.forEach((r, i) => { r.dist = gd[i]; });
  if (boss) {
    rooms[0].role = 'start'; rooms[1].role = 'boss'; rooms[2].role = 'treasure';
  } else {
    rooms[0].role = 'start';
    let exit = 1;
    for (let i = 1; i < n; i++) {
      if (gd[i] > gd[exit] || (gd[i] === gd[exit] && dist2(rooms[i], rooms[0]) > dist2(rooms[exit], rooms[0]))) exit = i;
    }
    rooms[exit].role = 'exit';
    let treasures = 0;
    for (let i = 1; i < n && treasures < 2; i++) {
      if (i !== exit && rooms[i].links.length === 1) { rooms[i].role = 'treasure'; treasures++; }
    }
    const combat = rooms.filter(r => r.role === 'combat');
    if (treasures === 0 && combat.length > 4) { rng.pick(combat).role = 'treasure'; }
    const rest = rooms.filter(r => r.role === 'combat');
    if (depth >= 2 && rest.length >= 4) rng.pick(rest).role = 'shrine';
  }
  for (const r of rooms) shapeRoom(r, rng, solidIn, W);
  // 扉から部屋の中心まで、幅2の通り道を必ず空ける
  const clear2 = (x, y) => { for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) solidIn[(y + j) * W + x + i] = 0; };
  for (const { r, d } of lanes) {
    let [x, y] = d.inner;
    const tx = Math.min(Math.max(r.cx - 1, r.x), r.x + r.w - 2), ty = Math.min(Math.max(r.cy - 1, r.y), r.y + r.h - 2);
    x = Math.min(x, r.x + r.w - 2); y = Math.min(y, r.y + r.h - 2);
    clear2(x, y);
    if (d.horiz) { while (x !== tx) { x += Math.sign(tx - x); clear2(x, y); } while (y !== ty) { y += Math.sign(ty - y); clear2(x, y); } }
    else { while (y !== ty) { y += Math.sign(ty - y); clear2(x, y); } while (x !== tx) { x += Math.sign(tx - x); clear2(x, y); } }
  }
  for (const r of rooms) {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) solidIn[(r.cy + j) * W + r.cx + i] = 0;
  }
  for (let i = 0; i < W * H; i++) if (solidIn[i]) tiles[i] = T_VOID;
  for (const r of rooms) for (const d of r.doors) tiles[d.y * W + d.x] = T_DOOR;

  // --- 開始地点から届かない床を埋める
  const start = { x: rooms[0].cx + 0.5, y: rooms[0].cy + 0.5 };
  const reach = new Uint8Array(W * H), stack = [rooms[0].cy * W + rooms[0].cx];
  reach[stack[0]] = 1;
  while (stack.length) {
    const c = stack.pop(), cx = c % W, cy = (c / W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX[k], ny = cy + DY[k], ni = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || reach[ni] || tiles[ni] === T_VOID) continue;
      reach[ni] = 1; stack.push(ni);
    }
  }
  for (let i = 0; i < W * H; i++) if (tiles[i] !== T_VOID && !reach[i]) tiles[i] = T_VOID;
  for (const r of rooms) if (!reach[r.cy * W + r.cx]) return null;
  // 床に接する岩を壁にする
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (tiles[y * W + x] !== T_VOID) continue;
    let near = false;
    for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1; i++) {
      const nx = x + i, ny = y + j;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const t = tiles[ny * W + nx];
      if (t === T_FLOOR || t === T_DOOR) { near = true; break; }
    }
    if (near) tiles[y * W + x] = T_WALL;
  }

  // --- 部屋番号の対応表、松明、壺
  const roomAt = new Int8Array(W * H).fill(-1);
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomAt[y * W + x] = r.id;
  const torches = [];
  for (const r of rooms) {
    const cand = [];
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (tiles[y * W + x] !== T_WALL) continue;
      for (let k = 0; k < 4; k++) {
        const fx = x + DX[k], fy = y + DY[k];
        if (fx < r.x || fy < r.y || fx >= r.x + r.w || fy >= r.y + r.h || tiles[fy * W + fx] !== T_FLOOR) continue;
        if (r.doors.some(d => Math.abs(d.x - x) + Math.abs(d.y - y) < 3)) continue;
        cand.push({ x: x + 0.5 + DX[k] * 0.72, y: y + 0.5 + DY[k] * 0.72, wx: x, wy: y, nx: DX[k], ny: DY[k] });
        break;
      }
    }
    rng.shuffle(cand);
    const want = r.role === 'boss' ? 8 : r.w * r.h > 110 ? 5 : 4, minD = r.role === 'boss' ? 6 : 4.5;
    const got = [];
    for (const c of cand) {
      if (got.length >= want) break;
      if (got.every(g => Math.hypot(g.x - c.x, g.y - c.y) >= minD)) got.push(c);
    }
    for (const t of got) {
      t.room = r.id; t.lit = r.role === 'start'; t.k = 0;
      r.torches.push(torches.length); torches.push(t);
    }
    if (r.role === 'combat' || r.role === 'exit') {
      const count = rng.irange(0, 4);
      for (let i = 0, tries = 0; i < count && tries < 60; tries++) {
        const x = rng.irange(r.x, r.x + r.w - 1), y = rng.irange(r.y, r.y + r.h - 1);
        if (tiles[y * W + x] !== T_FLOOR) continue;
        let walls = 0;
        for (let k = 0; k < 4; k++) if (tiles[(y + DY[k]) * W + x + DX[k]] === T_WALL) walls++;
        if (walls === 0 || Math.abs(x - r.cx) + Math.abs(y - r.cy) < 3) continue;
        if (r.doors.some(d => Math.abs(d.x - x) + Math.abs(d.y - y) < 4)) continue;
        if (r.props.some(p => p.x === x + 0.5 && p.y === y + 0.5)) continue;
        r.props.push({ x: x + 0.5, y: y + 0.5 }); i++;
      }
    }
  }
  const exitRoom = rooms.find(r => r.role === 'exit' || r.role === 'boss');
  return {
    w: W, h: H, tiles, rooms, torches, roomAt, start, boss,
    stairs: { x: exitRoom.cx + 0.5, y: exitRoom.cy + 0.5, room: exitRoom.id, open: false },
    barred: new Uint8Array(W * H), solid: new Uint8Array(W * H), version: 0,
  };
}

function graphDist(rooms, from) {
  const d = new Array(rooms.length).fill(-1), q = [from];
  d[from] = 0;
  for (let h = 0; h < q.length; h++) for (const o of rooms[q[h]].links) if (d[o] < 0) { d[o] = d[q[h]] + 1; q.push(o); }
  return d;
}

// 幅2ブラシの A*。状態は（セル, 進行方向）。曲がり角にコストを足して、まっすぐな通路を好ませる。
function route(from, to, blocked, carved, W, H) {
  const N = W * H, g = new Float32Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1);
  const heap = new MinHeap(), goal = to[1] * W + to[0], s0 = from[1] * W + from[0];
  if (blocked[s0] || blocked[goal]) return null;
  for (let d = 0; d < 4; d++) { g[s0 * 4 + d] = 0; heap.push(Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]), s0 * 4 + d); }
  let end = -1;
  while (heap.size) {
    const st = heap.pop(), c = st >> 2, dir = st & 3;
    if (c === goal) { end = st; break; }
    const cx = c % W, cy = (c / W) | 0, gc = g[st];
    for (let k = 0; k < 4; k++) {
      if (((k + 2) & 3) === dir && gc > 0) continue;
      const nx = cx + DX[k], ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (blocked[ni]) continue;
      const ng = gc + (carved[ni] ? 1 : 2) + (k !== dir && gc > 0 ? 4 : 0);
      if (ng < g[ni * 4 + k]) {
        g[ni * 4 + k] = ng; prev[ni * 4 + k] = st;
        heap.push(ng + Math.abs(nx - to[0]) + Math.abs(ny - to[1]), ni * 4 + k);
      }
    }
  }
  if (end < 0) return null;
  const path = [];
  for (let st = end; st >= 0; st = prev[st]) path.push(st >> 2);
  return path;
}

function shapeRoom(r, rng, solidIn, W) {
  const set = (x, y) => { if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) solidIn[y * W + x] = 1; };
  let shape = 'rect';
  if (r.role === 'boss') shape = 'arena';
  else if (r.role === 'combat' || r.role === 'exit') shape = rng.pick(['rect', 'pillars', 'pillars', 'rounded', 'cave', 'islands', 'islands']);
  else if (r.role === 'treasure' || r.role === 'shrine') shape = 'rounded';
  r.shape = shape;
  const corner = (k) => {
    for (let j = 0; j < k; j++) for (let i = 0; i < k - j; i++) {
      set(r.x + i, r.y + j); set(r.x + r.w - 1 - i, r.y + j);
      set(r.x + i, r.y + r.h - 1 - j); set(r.x + r.w - 1 - i, r.y + r.h - 1 - j);
    }
  };
  if (shape === 'rounded') corner(2);
  else if (shape === 'arena') {
    corner(4);
    for (const [fx, fy] of [[0.25, 0.28], [0.75, 0.28], [0.25, 0.72], [0.75, 0.72]]) {
      const px = r.x + Math.round(r.w * fx) - 1, py = r.y + Math.round(r.h * fy) - 1;
      set(px, py); set(px + 1, py); set(px, py + 1); set(px + 1, py + 1);
    }
  } else if (shape === 'pillars') {
    const step = rng.pick([3, 4]);
    for (let y = r.y + 2; y < r.y + r.h - 2; y += step) for (let x = r.x + 2; x < r.x + r.w - 2; x += step) set(x, y);
  } else if (shape === 'islands') {
    const count = rng.irange(2, 4);
    for (let i = 0; i < count; i++) {
      const w = rng.irange(1, 3), h = rng.irange(1, 2), x = rng.irange(r.x + 2, r.x + r.w - 3 - w), y = rng.irange(r.y + 2, r.y + r.h - 3 - h);
      for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) set(x + k, y + j);
    }
  } else if (shape === 'cave') {
    // 縁だけを乱数で埋め、セルオートマトンでなめらかにする
    const cell = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const edge = Math.min(x, y, r.w - 1 - x, r.h - 1 - y);
      cell[y * r.w + x] = edge < 2 && rng.chance(edge === 0 ? 0.6 : 0.3) ? 1 : 0;
    }
    for (let it = 0; it < 2; it++) {
      const next = new Uint8Array(cell);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        let c = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          if (!i && !j) continue;
          const nx = x + i, ny = y + j;
          c += nx < 0 || ny < 0 || nx >= r.w || ny >= r.h ? 1 : cell[ny * r.w + nx];
        }
        next[y * r.w + x] = c >= 5 ? 1 : c <= 2 ? 0 : cell[y * r.w + x];
      }
      cell.set(next);
    }
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (cell[y * r.w + x]) set(r.x + x, r.y + y);
  }
}

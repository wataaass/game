// 弾・敵の生成と、ダメージ処理。描画や音はここで出すイベントを見て動く。
import { ENEMY } from './defs.js';
import { lineClear, TAU } from './util.js';

export function emit(G, type, x, y, a, b) { G.events.push({ type, x, y, a, b }); }

export function lanternTarget(G) {
  const p = G.player;
  return (3.0 + 6.2 * Math.sqrt(Math.max(0, p.oil) / p.stats.oilMax)) * p.stats.lightMul;
}

// その地点の明るさ（松明＋ランタン）。0 が真っ暗。
export function lightAt(G, x, y) {
  const m = G.map, p = G.player, R = G.lanternR;
  let l = G.staticLight[(y | 0) * m.w + (x | 0)] || 0;
  const d = Math.hypot(x - p.x, y - p.y);
  if (d < R && lineClear(m, p.x, p.y, x, y)) l += 1 - d / R;
  return l;
}

export const TORCH_RADIUS = 6.5;
export function rebuildStaticLight(G) {
  const m = G.map, L = G.staticLight, R = TORCH_RADIUS;
  L.fill(0);
  for (const t of m.torches) {
    if (!t.lit) continue;
    const x0 = Math.max(0, Math.floor(t.x - R)), x1 = Math.min(m.w - 1, Math.ceil(t.x + R));
    const y0 = Math.max(0, Math.floor(t.y - R)), y1 = Math.min(m.h - 1, Math.ceil(t.y + R));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const i = ty * m.w + tx;
      if (m.solid[i]) continue;
      const d = Math.hypot(tx + 0.5 - t.x, ty + 0.5 - t.y);
      if (d < R && lineClear(m, t.x, t.y, tx + 0.5, ty + 0.5)) L[i] += 1 - d / R;
    }
  }
  G.lightDirty = false; G.lightVersion++;
}

// --- 敵の空間ハッシュ（1マス2タイル）
export function buildGrid(G) {
  const g = G.grid, es = G.enemies;
  g.head.fill(-1);
  if (g.next.length < es.length) g.next = new Int32Array(es.length * 2 + 64);
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (e.dead) continue;
    const c = ((e.y * 0.5) | 0) * g.cols + ((e.x * 0.5) | 0);
    g.next[i] = g.head[c]; g.head[c] = i;
  }
  g.count = es.length;
}

export function forNear(G, x, y, r, fn) {
  const g = G.grid;
  const x0 = Math.max(0, ((x - r) * 0.5) | 0), x1 = Math.min(g.cols - 1, ((x + r) * 0.5) | 0);
  const y0 = Math.max(0, ((y - r) * 0.5) | 0), y1 = Math.min(g.rows - 1, ((y + r) * 0.5) | 0);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    for (let i = g.head[cy * g.cols + cx]; i >= 0; i = g.next[i]) fn(G.enemies[i]);
  }
}

export function spawnEnemy(G, type, x, y, opts = {}) {
  const def = ENEMY[type], elite = !!opts.elite;
  const hp = Math.round(def.hp * (def.prop ? 1 : G.hpMul) * (elite ? 2.6 : 1));
  const e = {
    id: G.nextId++, type, x, y, vx: 0, vy: 0, kx: 0, ky: 0, r: def.r * (elite ? 1.25 : 1), hp, maxHp: hp,
    speed: def.speed * (elite ? 1.12 : 1), dmg: def.dmg, state: 'idle', t: 0, n: 0, pi: 0, phase: 1,
    cd: G.rng.range(0.6, 1.8), ang: G.rng.range(0, TAU), slot: G.rng.range(-1.9, 1.9), side: G.rng.chance(0.5) ? 1 : -1,
    flash: 0, burnT: 0, burnDps: 0, burnTick: 0, room: opts.room ?? -1, elite, spawnT: opts.delay ?? 0,
    los: false, lit: 1, orbCd: 0, dashTick: -1, stun: 0, invuln: 0, blocked: false, dead: false, face: 1,
  };
  G.enemies.push(e);
  return e;
}

export function spawnBullet(G, o) {
  if (G.bullets.length >= 900) return null;
  const b = {
    team: 0, x: 0, y: 0, vx: 0, vy: 0, r: 0.14, dmg: 1, life: 1.2, pierce: 0, bounce: 0, split: 0, chain: 0,
    burn: 0, homing: 0, explode: 0, crit: false, hit: null, big: false, dead: false, age: 0,
  };
  Object.assign(b, o);
  G.bullets.push(b);
  return b;
}

export function enemyBullet(G, x, y, ang, speed, r = 0.17) {
  return spawnBullet(G, { team: 1, x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, dmg: 1, life: 6 });
}

export function bossResist(G, e) {
  const room = G.map.rooms[e.room];
  if (!room || !room.torches.length) return 1;
  let lit = 0;
  for (const ti of room.torches) if (G.map.torches[ti].lit) lit++;
  return 0.4 + 0.6 * (lit / room.torches.length);
}

export function hurtEnemy(G, e, dmg, o = {}) {
  if (e.dead || e.spawnT > 0 || e.invuln > 0) return false;
  const p = G.player, def = ENEMY[e.type];
  if (def.boss) dmg *= bossResist(G, e);
  if (p.stats.radiance > 0 && o.src !== 'burn') {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < G.lanternR * 0.75 && lineClear(G.map, p.x, p.y, e.x, e.y)) dmg *= 1 + p.stats.radiance;
  }
  e.hp -= dmg; e.flash = 0.12; G.stats.dmg += dmg;
  if (o.kx !== undefined && def.speed > 0 && !def.boss && e.state !== 'dash') {
    const k = 0.42 / e.r; e.kx += o.kx * k; e.ky += o.ky * k;
  }
  emit(G, 'hit', e.x, e.y, dmg, o.crit ? 1 : o.src === 'burn' ? 2 : 0);
  if (e.hp <= 0) killEnemy(G, e);
  return true;
}

export function killEnemy(G, e) {
  if (e.dead) return;
  e.dead = true;
  const p = G.player, def = ENEMY[e.type], rng = G.rng;
  emit(G, 'enemyDie', e.x, e.y, e.type, e.r);
  if (e.type === 'bomber') G.blasts.push({ x: e.x, y: e.y, r: 2.0, dmg: 45, team: 2 });
  if (e.burnT > 0 && p.stats.afterglow > 0) {
    G.blasts.push({ x: e.x, y: e.y, r: 1.4 + 0.4 * p.stats.afterglow, dmg: p.stats.dmg * 0.8, team: 0, burn: 1 });
  }
  const drop = (kind, v) => {
    const a = rng.range(0, TAU), s = rng.range(1.5, 4.5);
    G.pickups.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind, v, age: 0 });
  };
  if (def.prop) {
    if (rng.chance(0.55)) drop('xp', 1);
    if (rng.chance(0.24)) drop('oil', 16);
    else if (rng.chance(0.07)) drop('heart', 1);
    return;
  }
  G.stats.kills++; G.score += 10 * def.xp * (e.elite ? 4 : 1);
  let xp = def.xp * (e.elite ? 4 : 1);
  while (xp > 0) { const v = xp >= 10 ? 5 : xp >= 4 ? 2 : 1; drop('xp', v); xp -= v; }
  if (rng.chance(e.elite || def.boss ? 1 : 0.11)) drop('oil', 18);
  if (rng.chance(e.elite ? 0.3 : def.boss ? 1 : 0.014)) drop('heart', def.boss ? 4 : 1);
  if (p.stats.vamp > 0 && p.hp < p.stats.maxHp && rng.chance(p.stats.vamp)) { p.hp++; emit(G, 'heal', p.x, p.y); }
  if (def.boss) {
    for (const b of G.bullets) if (b.team !== 0) b.dead = true;
    for (const o of G.enemies) if (!o.dead && o !== e && !ENEMY[o.type].prop) killEnemy(G, o);
    G.hitstop = 24;
    emit(G, 'bossDie', e.x, e.y);
  }
}

export function hurtPlayer(G, dmg, sx, sy) {
  const p = G.player;
  if (p.inv > 0 || G.over) return false;
  p.hp -= dmg; p.inv = 0.75; G.stats.hurt += dmg; G.hitstop = 5;
  const dx = p.x - sx, dy = p.y - sy, d = Math.hypot(dx, dy) || 1;
  p.kx = (dx / d) * 7; p.ky = (dy / d) * 7;
  emit(G, 'playerHurt', p.x, p.y, dmg);
  const nova = p.stats.nova;
  if (nova > 0) {
    const n = 8 + 5 * nova;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      spawnBullet(G, { team: 0, x: p.x, y: p.y, vx: Math.cos(a) * 11, vy: Math.sin(a) * 11, dmg: p.stats.dmg * 0.9, life: 0.7, pierce: 1, burn: p.stats.burn });
    }
  }
  if (p.hp <= 0) { p.hp = 0; G.over = 'dead'; emit(G, 'death', p.x, p.y); }
  return true;
}

export function processBlasts(G) {
  const p = G.player;
  for (let n = 0; n < G.blasts.length && n < 64; n++) {
    const bl = G.blasts[n];
    emit(G, 'explode', bl.x, bl.y, bl.r, bl.team);
    forNear(G, bl.x, bl.y, bl.r + 1.4, e => {
      if (e.dead || e.spawnT > 0) return;
      const dx = e.x - bl.x, dy = e.y - bl.y, d = Math.hypot(dx, dy);
      if (d > bl.r + e.r) return;
      if (bl.burn) { e.burnT = 3; e.burnDps = Math.max(e.burnDps, p.stats.dmg * 0.35 * Math.max(1, p.stats.burn)); }
      hurtEnemy(G, e, bl.dmg, { kx: (dx / (d || 1)) * 6, ky: (dy / (d || 1)) * 6 });
    });
    if (bl.team !== 0) {
      const d = Math.hypot(p.x - bl.x, p.y - bl.y);
      if (d < bl.r + p.r && lineClear(G.map, bl.x, bl.y, p.x, p.y)) hurtPlayer(G, 2, bl.x, bl.y);
    }
  }
  G.blasts.length = 0;
}

// ゲーム本体のシミュレーション。DOM に触れず、入力の列から状態が一意に決まる。
// 1ティック = 1/60 秒。step(G, input) だけが状態を進める。
import { RNG, mix32 } from '../core/rng.js';
import { generateDungeon, T_FLOOR } from './dungeon.js';
import { ENEMY, UPGRADES, computeStats } from './defs.js';
import { DT, TAU, rebuildSolid, solidAt, lineClear, moveCircle, distanceField } from './util.js';
import {
  emit, lanternTarget, rebuildStaticLight, buildGrid, forNear, spawnEnemy, spawnBullet,
  hurtEnemy, hurtPlayer, processBlasts,
} from './combat.js';
import { updateEnemies } from './enemies.js';

export const SIM_VERSION = 1;
export const BTN_FIRE = 1, BTN_DASH = 2, BTN_USE = 4;
export const WIN_DEPTH = 5;

export function createGame(seed) {
  const G = {
    seed: seed >>> 0, tick: 0, time: 0, depth: 0, rng: new RNG(mix32(seed >>> 0, 0xc0ffee)),
    map: null, enemies: [], bullets: [], pickups: [], blasts: [], events: [], chests: [], shrines: [],
    pending: null, over: null, won: false, hitstop: 0, nextId: 1, score: 0,
    stats: { kills: 0, dmg: 0, rooms: 0, hurt: 0 },
    flow: null, flowTile: -1, staticLight: null, seen: null, grid: null,
    lanternR: 9, lightDirty: true, lightVersion: 0, tokens: 0, maxTokens: 2, activeRoom: -1,
    darkT: 0, vacuum: 0, hpMul: 1, descend: false,
    player: {
      x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, r: 0.3, hp: 6, up: {}, stats: computeStats({}), level: 1, xp: 0, xpNeed: 5,
      oil: 100, aim: 0, fireCd: 0, dashCd: 0, dashT: 0, dashDx: 1, dashDy: 0, dashId: 0, inv: 0,
      prevBtn: 0, shots: 0, orbA: 0, moving: false,
    },
  };
  enterDepth(G, 1);
  return G;
}

function enterDepth(G, depth) {
  const m = generateDungeon(G.seed, depth), p = G.player;
  G.depth = depth; G.map = m;
  rebuildSolid(m);
  G.hpMul = 1 + 0.2 * (depth - 1) + (depth > WIN_DEPTH ? 0.12 * (depth - WIN_DEPTH) : 0);
  G.maxTokens = 2 + (depth >> 1);
  G.enemies = []; G.bullets = []; G.pickups = []; G.blasts = []; G.chests = []; G.shrines = [];
  G.activeRoom = -1; G.flowTile = -1; G.darkT = 0; G.vacuum = 0;
  G.flow = new Uint16Array(m.w * m.h);
  G.staticLight = new Float32Array(m.w * m.h);
  G.seen = new Uint8Array(m.w * m.h);
  const cols = Math.ceil(m.w / 2), rows = Math.ceil(m.h / 2);
  G.grid = { cols, rows, head: new Int32Array(cols * rows).fill(-1), next: new Int32Array(256), count: 0 };
  p.x = m.start.x; p.y = m.start.y; p.vx = p.vy = p.kx = p.ky = 0; p.dashT = 0;
  for (const r of m.rooms) {
    if (r.role === 'start') r.state = 'cleared';
    for (const pr of r.props) spawnEnemy(G, 'urn', pr.x, pr.y, { room: r.id });
    if (r.role === 'treasure') G.chests.push({ x: r.cx + 0.5, y: r.cy + 0.5, room: r.id, open: false });
    if (r.role === 'shrine') G.shrines.push({ x: r.cx + 0.5, y: r.cy + 0.5, room: r.id, used: false });
  }
  rebuildStaticLight(G);
  G.lanternR = lanternTarget(G);
  markSeen(G);
  emit(G, 'descend', p.x, p.y, depth);
}

// ---------------------------------------------------------------- 部屋の戦闘
const SPAWN_WEIGHT = { mite: 5, spitter: 3, charger: 2.4, bomber: 2, shade: 2, weaver: 1, sentinel: 1.1 };

function buildWaves(G, room) {
  const rng = G.rng, depth = G.depth;
  const area = Math.min(1.3, Math.max(0.75, (room.w * room.h) / 110));
  let budget = (9 + depth * 4.6 + room.dist * 1.1) * area * (room.role === 'exit' ? 1.3 : 1);
  if (depth > WIN_DEPTH) budget *= 1 + 0.1 * (depth - WIN_DEPTH);
  const nWaves = depth >= 5 ? 4 : depth >= 2 ? 3 : 2;
  const types = Object.keys(SPAWN_WEIGHT).filter(t => ENEMY[t].minDepth <= depth);
  const waves = [];
  for (let w = 0; w < nWaves; w++) {
    let b = (budget / nWaves) * (0.85 + 0.3 * w), guard = 0;
    const wave = [], cap = { weaver: 1, sentinel: 2 };
    while (b >= 1 && wave.length < 16 && guard++ < 60) {
      const ok = types.filter(t => ENEMY[t].cost <= b && (cap[t] === undefined || cap[t] > 0));
      if (!ok.length) break;
      const t = ok[rng.weighted(ok.map(k => SPAWN_WEIGHT[k]))];
      const elite = b >= ENEMY[t].cost * 3 && rng.chance(Math.min(0.2, 0.035 * depth));
      wave.push({ type: t, elite });
      b -= ENEMY[t].cost * (elite ? 3 : 1);
      if (cap[t] !== undefined) cap[t]--;
    }
    waves.push(wave);
  }
  return waves;
}

function spawnWave(G, room) {
  const m = G.map, p = G.player, rng = G.rng, wave = room.waves[room.wave++];
  for (const w of wave) {
    let x = room.cx + 0.5, y = room.cy + 0.5;
    for (let tries = 0; tries < 40; tries++) {
      const tx = rng.irange(room.x, room.x + room.w - 1), ty = rng.irange(room.y, room.y + room.h - 1);
      if (m.tiles[ty * m.w + tx] !== T_FLOOR || m.solid[ty * m.w + tx]) continue;
      if (Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) < (tries < 30 ? 4.5 : 2.5)) continue;
      x = tx + 0.5; y = ty + 0.5; break;
    }
    spawnEnemy(G, w.type, x, y, { room: room.id, elite: w.elite, delay: rng.range(0.7, 1.2) });
  }
  emit(G, 'wave', room.cx + 0.5, room.cy + 0.5, room.wave);
}

function setDoors(G, room, barred) {
  const m = G.map;
  for (const d of room.doors) m.barred[d.y * m.w + d.x] = barred ? 1 : 0;
  rebuildSolid(m);
  G.flowTile = -1; G.lightDirty = true;
}

function lightRoom(G, room) {
  for (const ti of room.torches) G.map.torches[ti].lit = true;
  G.lightDirty = true;
}

function startEncounter(G, room) {
  room.state = 'active'; G.activeRoom = room.id;
  setDoors(G, room, true);
  emit(G, 'roomStart', room.cx + 0.5, room.cy + 0.5, room.role === 'boss' ? 1 : 0);
  if (room.role === 'boss') {
    lightRoom(G, room);
    room.waves = []; room.wave = 0;
    spawnEnemy(G, 'unlit', room.cx + 0.5, room.cy + 0.5, { room: room.id, delay: 1.2 });
  } else {
    room.waves = buildWaves(G, room); room.wave = 0;
    spawnWave(G, room);
  }
}

function updateRooms(G) {
  const m = G.map, p = G.player;
  const tx = p.x | 0, ty = p.y | 0, rid = m.roomAt[ty * m.w + tx];
  if (rid >= 0 && G.activeRoom < 0) {
    const r = m.rooms[rid];
    if (r.state === 'idle' && p.x > r.x + 0.9 && p.x < r.x + r.w - 0.9 && p.y > r.y + 0.9 && p.y < r.y + r.h - 0.9) {
      if (r.role === 'combat' || r.role === 'exit' || r.role === 'boss') startEncounter(G, r);
      else { r.state = 'cleared'; lightRoom(G, r); emit(G, 'calm', p.x, p.y); }
    }
  }
  if (G.activeRoom >= 0) {
    const r = m.rooms[G.activeRoom];
    let alive = 0;
    for (const e of G.enemies) if (!e.dead && e.room === r.id && !ENEMY[e.type].prop) alive++;
    if (alive <= (r.wave < r.waves.length ? 1 : 0)) {
      if (r.wave < r.waves.length) spawnWave(G, r);
      else {
        r.state = 'cleared'; G.activeRoom = -1;
        setDoors(G, r, false); lightRoom(G, r);
        p.oil = Math.min(p.stats.oilMax, p.oil + 22);
        G.vacuum = 100; G.stats.rooms++; G.score += r.role === 'boss' ? 1000 : 100;
        emit(G, 'roomClear', r.cx + 0.5, r.cy + 0.5);
        if (m.stairs.room === r.id) { m.stairs.open = true; emit(G, 'stairs', m.stairs.x, m.stairs.y); }
        if (r.role === 'boss' && G.depth === WIN_DEPTH && !G.won) { G.won = true; emit(G, 'win', p.x, p.y); }
      }
    }
  }
}

// ---------------------------------------------------------------- 強化
function rollChoices(G, relic) {
  const p = G.player, pool = [], weights = [];
  for (const u of UPGRADES) {
    if ((p.up[u.id] | 0) >= u.max) continue;
    if (u.req && !p.up[u.req]) continue;
    if (relic ? u.rarity < 2 : u.rarity > 2) continue;
    pool.push(u.id);
    weights.push(relic ? (u.rarity === 3 ? 5 : 3) : u.rarity === 1 ? 10 : 4.5);
  }
  const out = [];
  while (out.length < 3 && pool.length) {
    const i = G.rng.weighted(weights);
    out.push(pool[i]); pool.splice(i, 1); weights.splice(i, 1);
  }
  return out;
}

function offer(G, relic) {
  const choices = rollChoices(G, relic), p = G.player;
  if (!choices.length) { p.hp = Math.min(p.stats.maxHp, p.hp + 2); return; }
  G.pending = { kind: relic ? 'relic' : 'level', choices };
}

function takeUpgrade(G, id) {
  const p = G.player;
  p.up[id] = (p.up[id] | 0) + 1;
  const oldMax = p.stats.maxHp, oldOil = p.stats.oilMax;
  p.stats = computeStats(p.up);
  if (p.stats.maxHp > oldMax) p.hp += p.stats.maxHp - oldMax;
  if (p.stats.oilMax > oldOil) p.oil += p.stats.oilMax - oldOil;
  emit(G, 'upgrade', p.x, p.y, id);
}

function gainXp(G, v) {
  G.player.xp += v; G.score += v;
}

// ---------------------------------------------------------------- プレイヤー
function firePlayer(G) {
  const p = G.player, s = p.stats, rng = G.rng;
  p.shots++;
  const big = s.overcharge > 0 && p.shots % 5 === 0;
  const n = s.count, spread = n > 1 ? Math.min(0.9, 0.16 * (n - 1)) : 0;
  for (let i = 0; i < n; i++) {
    const a = p.aim + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0) + rng.range(-0.025, 0.025);
    const sp = s.projSpeed * (big ? 1.15 : 1);
    spawnBullet(G, {
      team: 0, x: p.x + Math.cos(a) * 0.2, y: p.y + Math.sin(a) * 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      r: big ? 0.26 : 0.14, dmg: s.dmg * (big ? 1.5 + s.overcharge : 1), life: 1.15,
      pierce: s.pierce + (big ? 3 : 0), bounce: s.bounce, split: s.split, chain: s.chain, burn: s.burn,
      homing: s.homing, explode: s.explode, crit: rng.chance(s.crit), big,
    });
  }
  emit(G, 'shoot', p.x, p.y, p.aim, big ? 1 : 0);
}

function updatePlayer(G, inp) {
  const p = G.player, s = p.stats, m = G.map;
  p.aim = (inp.aim / 32768) * Math.PI;
  let mx = inp.mx / 127, my = inp.my / 127;
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  const pressed = inp.btn & ~p.prevBtn;
  p.prevBtn = inp.btn;
  if (p.inv > 0) p.inv -= DT;
  if (p.dashCd > 0) p.dashCd -= DT;
  if (p.fireCd > 0) p.fireCd -= DT;

  if ((pressed & BTN_DASH) && p.dashCd <= 0 && p.dashT <= 0) {
    let ddx = mx, ddy = my;
    if (ml < 0.2) { ddx = Math.cos(p.aim); ddy = Math.sin(p.aim); }
    const l = Math.hypot(ddx, ddy) || 1;
    p.dashDx = ddx / l; p.dashDy = ddy / l; p.dashT = 0.17; p.dashCd = s.dashCd; p.dashId++;
    p.inv = Math.max(p.inv, 0.27);
    emit(G, 'dash', p.x, p.y, Math.atan2(p.dashDy, p.dashDx));
  }
  if (p.dashT > 0) {
    p.dashT -= DT; p.vx = p.dashDx * 17; p.vy = p.dashDy * 17;
    if (s.dashHit > 0) {
      forNear(G, p.x, p.y, 1.6, e => {
        if (e.dead || e.spawnT > 0 || e.dashTick === p.dashId) return;
        if (Math.hypot(e.x - p.x, e.y - p.y) > e.r + 0.75) return;
        e.dashTick = p.dashId;
        e.burnT = 3; e.burnDps = Math.max(e.burnDps, s.dmg * 0.35 * Math.max(1, s.burn));
        hurtEnemy(G, e, s.dmg * 1.3 * s.dashHit, { kx: p.dashDx * 5, ky: p.dashDy * 5 });
      });
    }
  } else {
    const k = Math.min(1, 16 * DT);
    p.vx += (mx * s.move - p.vx) * k; p.vy += (my * s.move - p.vy) * k;
  }
  moveCircle(m, p, (p.vx + p.kx) * DT, (p.vy + p.ky) * DT);
  p.kx *= 0.8; p.ky *= 0.8;
  p.moving = ml > 0.1;

  if ((inp.btn & BTN_FIRE) && p.fireCd <= 0 && p.dashT <= 0) { firePlayer(G); p.fireCd = 1 / s.rate; }

  // 油とランタン
  p.oil = Math.max(0, p.oil - s.oilDrain * DT);
  G.lanternR += (lanternTarget(G) - G.lanternR) * 0.08;
  if (p.oil <= 0) {
    G.darkT += DT;
    if (G.darkT > 6) {
      G.darkT = 0;
      let shades = 0;
      for (const e of G.enemies) if (!e.dead && e.type === 'shade' && e.room === -1) shades++;
      for (let tries = 0; tries < 24 && shades < 3; tries++) {
        const a = G.rng.range(0, TAU), r = G.rng.range(6, 10), x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
        if (solidAt(m, x, y) || G.flow[(y | 0) * m.w + (x | 0)] === 65535) continue;
        spawnEnemy(G, 'shade', x, y, { delay: 0.8 });
        emit(G, 'darkHunt', x, y);
        break;
      }
    }
  } else G.darkT = 0;

  // 蛍
  if (s.orbitals > 0) {
    p.orbA += DT * 3.3;
    for (let i = 0; i < s.orbitals; i++) {
      const a = p.orbA + (i * TAU) / s.orbitals, ox = p.x + Math.cos(a) * 1.35, oy = p.y + Math.sin(a) * 1.35;
      forNear(G, ox, oy, 1.6, e => {
        if (e.dead || e.spawnT > 0 || e.orbCd > 0 || Math.hypot(e.x - ox, e.y - oy) > e.r + 0.32) return;
        e.orbCd = 18;
        hurtEnemy(G, e, s.dmg * 0.6, { kx: Math.cos(a) * 2, ky: Math.sin(a) * 2 });
      });
    }
  }

  // 近くの松明に火を移す
  for (const t of m.torches) {
    if (t.lit) continue;
    if (Math.abs(t.x - p.x) < 1.4 && Math.abs(t.y - p.y) < 1.4 && Math.hypot(t.x - p.x, t.y - p.y) < 1.4) {
      t.k += DT;
      if (t.k >= 0.45) { t.lit = true; G.lightDirty = true; emit(G, 'torch', t.x, t.y); }
    } else t.k = 0;
  }

  for (const c of G.chests) {
    if (!c.open && Math.hypot(c.x - p.x, c.y - p.y) < 1.0) {
      c.open = true; offer(G, true);
      emit(G, 'chest', c.x, c.y);
    }
  }
  for (const sh of G.shrines) {
    if (!sh.used && Math.hypot(sh.x - p.x, sh.y - p.y) < 1.1) {
      sh.used = true; p.oil = s.oilMax; p.hp = Math.min(s.maxHp, p.hp + 2);
      emit(G, 'shrine', sh.x, sh.y);
    }
  }
  const st = m.stairs;
  if ((pressed & BTN_USE) && st.open && Math.hypot(st.x - p.x, st.y - p.y) < 1.3) G.descend = true;
}

// ---------------------------------------------------------------- 弾
function chainFrom(G, from, jumps, dmg, visited) {
  let cur = from;
  for (let j = 0; j < jumps; j++) {
    let best = null, bd = 3.6;
    forNear(G, cur.x, cur.y, 3.6, o => {
      if (o.dead || o.spawnT > 0 || visited.includes(o.id)) return;
      const d = Math.hypot(o.x - cur.x, o.y - cur.y);
      if (d < bd) { bd = d; best = o; }
    });
    if (!best) break;
    emit(G, 'chain', cur.x, cur.y, best.x, best.y);
    visited.push(best.id);
    hurtEnemy(G, best, dmg, {});
    cur = best;
  }
}

function endBullet(G, b) {
  b.dead = true;
  if (b.team === 0 && b.explode > 0) G.blasts.push({ x: b.x, y: b.y, r: 0.9 + 0.3 * b.explode, dmg: b.dmg * 0.6, team: 0 });
  emit(G, 'spark', b.x, b.y, b.team);
}

function updateBullets(G) {
  const m = G.map, p = G.player, bs = G.bullets, s = p.stats;
  const count = bs.length;
  for (let i = 0; i < count; i++) {
    const b = bs[i];
    if (b.dead) continue;
    b.life -= DT; b.age++;
    if (b.life <= 0) { endBullet(G, b); continue; }
    if (b.team === 0 && b.homing > 0 && b.age % 3 === 0) {
      let best = null, bd = 5.5;
      forNear(G, b.x, b.y, 5.5, e => {
        if (e.dead || e.spawnT > 0 || ENEMY[e.type].prop || (b.hit && b.hit.includes(e.id))) return;
        const d = Math.hypot(e.x - b.x, e.y - b.y);
        if (d < bd && (e.x - b.x) * b.vx + (e.y - b.y) * b.vy > 0) { bd = d; best = e; }
      });
      if (best) {
        const sp = Math.hypot(b.vx, b.vy), cur = Math.atan2(b.vy, b.vx);
        let diff = Math.atan2(best.y - b.y, best.x - b.x) - cur;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const turn = 0.11 * b.homing, a = cur + Math.max(-turn, Math.min(turn, diff));
        b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
      }
    }
    const px = b.x, py = b.y;
    b.x += b.vx * DT; b.y += b.vy * DT;
    if (solidAt(m, b.x, b.y)) {
      if (b.bounce > 0) {
        const hx = solidAt(m, b.x, py), hy = solidAt(m, px, b.y);
        if (hx || !hy) b.vx = -b.vx;
        if (hy || !hx) b.vy = -b.vy;
        b.x = px; b.y = py; b.bounce--;
        emit(G, 'bounce', px, py);
      } else { endBullet(G, b); continue; }
    }
    if (b.team === 0) {
      forNear(G, b.x, b.y, b.r + 1.5, e => {
        if (b.dead || e.dead || e.spawnT > 0) return;
        const dx = e.x - b.x, dy = e.y - b.y;
        if (dx * dx + dy * dy > (b.r + e.r) * (b.r + e.r)) return;
        if (b.hit && b.hit.includes(e.id)) return;
        const dmg = b.dmg * (b.crit ? 2 : 1), sp = Math.hypot(b.vx, b.vy) || 1;
        if (b.burn > 0) { e.burnT = 3; e.burnDps = Math.max(e.burnDps, s.dmg * 0.35 * b.burn); }
        hurtEnemy(G, e, dmg, { kx: (b.vx / sp) * 2.6, ky: (b.vy / sp) * 2.6, crit: b.crit });
        (b.hit || (b.hit = [])).push(e.id);
        if (b.chain > 0) chainFrom(G, e, b.chain, dmg * 0.5, [e.id]);
        if (b.split > 0) {
          const a0 = Math.atan2(b.vy, b.vx);
          for (let k = 0; k < 2; k++) {
            const a = a0 + (k ? 0.5 : -0.5);
            spawnBullet(G, {
              team: 0, x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 0.11, dmg: b.dmg * 0.45,
              life: 0.4, split: b.split - 1, burn: b.burn, bounce: b.bounce > 0 ? 1 : 0, hit: [e.id],
            });
          }
        }
        if (b.pierce > 0) b.pierce--; else endBullet(G, b);
      });
    } else if (p.inv <= 0) {
      const dx = p.x - b.x, dy = p.y - b.y, rr = b.r + p.r * 0.8;
      if (dx * dx + dy * dy < rr * rr) { hurtPlayer(G, b.dmg, b.x - b.vx, b.y - b.vy); b.dead = true; }
    }
  }
}

function updatePickups(G) {
  const p = G.player, s = p.stats, m = G.map;
  for (const k of G.pickups) {
    k.age++;
    const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy) || 1e-6;
    const wanted = k.kind !== 'heart' || p.hp < s.maxHp;
    const pull = wanted && k.age > 18 && (d < s.magnet || G.vacuum > 0);
    if (pull) {
      const sp = Math.min(16, 5 + k.age * 0.25);
      k.vx += ((dx / d) * sp - k.vx) * 0.25; k.vy += ((dy / d) * sp - k.vy) * 0.25;
      k.x += k.vx * DT; k.y += k.vy * DT;
    } else {
      k.vx *= 0.9; k.vy *= 0.9;
      const nx = k.x + k.vx * DT, ny = k.y + k.vy * DT;
      if (!solidAt(m, nx, k.y)) k.x = nx; else k.vx = -k.vx * 0.5;
      if (!solidAt(m, k.x, ny)) k.y = ny; else k.vy = -k.vy * 0.5;
    }
    if (wanted && k.age > 18 && d < 0.6) {
      k.dead = true;
      if (k.kind === 'xp') gainXp(G, k.v);
      else if (k.kind === 'oil') p.oil = Math.min(s.oilMax, p.oil + k.v);
      else p.hp = Math.min(s.maxHp, p.hp + k.v);
      emit(G, 'pickup', k.x, k.y, k.kind);
    }
  }
}

// プレイヤーから光線を飛ばし、見えたタイルを地図に記す
function markSeen(G) {
  const m = G.map, p = G.player, R = Math.min(12, G.lanternR + 1.5), seen = G.seen;
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * TAU, dx = Math.cos(a) * 0.5, dy = Math.sin(a) * 0.5;
    let x = p.x, y = p.y;
    for (let s = 0; s < R * 2; s++) {
      const tx = x | 0, ty = y | 0;
      if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) break;
      seen[ty * m.w + tx] = 1;
      if (m.solid[ty * m.w + tx]) break;
      x += dx; y += dy;
    }
  }
}

function compact(arr) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[n++] = arr[i];
  arr.length = n;
}

// ---------------------------------------------------------------- 1ティック
// input: { mx, my: -127..127, aim: -32768..32767（角度）, btn: ビット, choice: 0..3 }
export function step(G, inp) {
  G.events.length = 0;
  if (G.over) return;
  G.tick++;
  const p = G.player;
  if (G.pending) {
    const c = inp.choice | 0;
    if (c >= 1 && c <= G.pending.choices.length) { takeUpgrade(G, G.pending.choices[c - 1]); G.pending = null; }
    p.prevBtn = inp.btn;
    return;
  }
  if (G.hitstop > 0) { G.hitstop--; return; }
  G.time += DT;
  if (G.vacuum > 0) G.vacuum--;

  buildGrid(G);
  updatePlayer(G, inp);
  const pt = (p.y | 0) * G.map.w + (p.x | 0);
  if (pt !== G.flowTile) { G.flowTile = pt; distanceField(G.map, p.x | 0, p.y | 0, G.flow); }
  updateEnemies(G);
  updateBullets(G);
  processBlasts(G);
  updatePickups(G);
  compact(G.enemies); compact(G.bullets); compact(G.pickups);
  updateRooms(G);
  if (G.lightDirty) rebuildStaticLight(G);
  if (G.tick % 6 === 0) markSeen(G);

  if (!G.over && !G.pending && p.xp >= p.xpNeed) {
    p.xp -= p.xpNeed; p.level++; p.xpNeed = Math.round(p.xpNeed * 1.2 + 3);
    emit(G, 'levelUp', p.x, p.y, p.level);
    offer(G, false);
  }
  if (G.descend && !G.over) {
    G.descend = false;
    G.score += 500;
    p.oil = Math.min(p.stats.oilMax, p.oil + 35);
    enterDepth(G, G.depth + 1);
  }
}

// 再生の一致を確かめるための状態ハッシュ
export function hashState(G) {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  let h = mix32(G.tick, G.depth);
  const add = v => { f[0] = v; h = mix32(h, u[0]); };
  const p = G.player;
  add(p.x); add(p.y); add(p.hp); add(p.oil); add(p.xp); add(G.score);
  for (const e of G.enemies) { add(e.x); add(e.y); add(e.hp); }
  for (const b of G.bullets) { add(b.x); add(b.y); }
  h = mix32(h, G.enemies.length * 65536 + G.bullets.length);
  for (const s of G.rng.state()) h = mix32(h, s >>> 0);
  return h >>> 0;
}


// 敵の AI。経路は「プレイヤーからの距離場」を全員で共有し、見通しが通れば直接向かう。
import { ENEMY } from './defs.js';
import { DT, TAU, lineClear, moveCircle, solidAt, fieldStep } from './util.js';
import { emit, forNear, spawnEnemy, enemyBullet, hurtEnemy, hurtPlayer, killEnemy, lightAt } from './combat.js';

const TMP = { x: 0, y: 0 };

function steer(e, tx, ty, speed, accel) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  const k = Math.min(1, accel * DT);
  if (d < 1e-4) { e.vx -= e.vx * k; e.vy -= e.vy * k; return; }
  e.vx += ((dx / d) * speed - e.vx) * k;
  e.vy += ((dy / d) * speed - e.vy) * k;
}

function viaFlow(G, e, speed, accel) {
  fieldStep(G.map, G.flow, e.x, e.y, 1, TMP);
  steer(e, TMP.x, TMP.y, speed, accel);
}

// 見通しがあれば包囲する角度へ、なければ距離場をたどる
function chase(G, e, p, d, speed) {
  if (!e.los) { viaFlow(G, e, speed, 9); return; }
  let tx = p.x, ty = p.y;
  if (d > 1.2 && d < 6.5) {
    const a = Math.atan2(e.y - p.y, e.x - p.x) + e.slot, k = Math.min(d - 1, 2.4);
    const sx = p.x + Math.cos(a) * k, sy = p.y + Math.sin(a) * k;
    if (!solidAt(G.map, sx, sy)) { tx = sx; ty = sy; }
  }
  steer(e, tx, ty, speed, 9);
}

function aimAt(G, e, p, d, bulletSpeed, lead) {
  const t = (d / bulletSpeed) * lead;
  return Math.atan2(p.y + p.vy * t - e.y, p.x + p.vx * t - e.x);
}

function ring(G, e, n, speed, offset) {
  for (let k = 0; k < n; k++) enemyBullet(G, e.x, e.y, offset + (k * TAU) / n, speed);
  emit(G, 'enemyShoot', e.x, e.y);
}

function aliveCount(G) {
  let c = 0;
  for (const o of G.enemies) if (!o.dead && !ENEMY[o.type].prop) c++;
  return c;
}

function summon(G, e, type, n) {
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 8; tries++) {
      const a = G.rng.range(0, TAU), r = G.rng.range(1.0, 2.2), x = e.x + Math.cos(a) * r, y = e.y + Math.sin(a) * r;
      if (solidAt(G.map, x, y) || !lineClear(G.map, e.x, e.y, x, y)) continue;
      spawnEnemy(G, type, x, y, { room: e.room, delay: 0.55 });
      break;
    }
  }
  emit(G, 'summon', e.x, e.y);
}

const AI = {
  // 近づくと短く飛びかかる
  mite(G, e, p, dx, dy, d) {
    if (e.state === 'lunge') { e.t -= DT; if (e.t <= 0) { e.state = 'idle'; e.cd = G.rng.range(1.2, 2.2); } return; }
    e.cd -= DT;
    chase(G, e, p, d, e.speed);
    if (e.los && d < 2.6 && e.cd <= 0) {
      e.state = 'lunge'; e.t = 0.24;
      const a = Math.atan2(dy + p.vy * 0.15, dx + p.vx * 0.15);
      e.vx = Math.cos(a) * 9.5; e.vy = Math.sin(a) * 9.5;
    }
  },

  spitter(G, e, p, dx, dy, d) {
    if (e.state === 'aim') {
      e.vx *= 0.8; e.vy *= 0.8; e.t -= DT;
      if (e.t <= 0) {
        const bs = Math.min(10, 6.6 + 0.35 * G.depth), a = aimAt(G, e, p, d, bs, 0.75);
        enemyBullet(G, e.x, e.y, a, bs);
        if (e.elite) { enemyBullet(G, e.x, e.y, a - 0.24, bs); enemyBullet(G, e.x, e.y, a + 0.24, bs); }
        emit(G, 'enemyShoot', e.x, e.y);
        e.state = 'idle'; e.cd = G.rng.range(1.1, 1.9);
      }
      return;
    }
    e.cd -= DT;
    if (!e.los) viaFlow(G, e, e.speed, 8);
    else if (d < 3.6) steer(e, e.x - dx, e.y - dy, e.speed * 1.15, 8);
    else if (d > 7.5) steer(e, p.x, p.y, e.speed, 8);
    else {
      const sx = e.x + (-dy / d) * e.side, sy = e.y + (dx / d) * e.side;
      if (solidAt(G.map, sx, sy) || e.blocked) e.side = -e.side;
      steer(e, sx, sy, e.speed * 0.8, 6);
    }
    if (e.los && d < 10 && e.cd <= 0 && G.tokens < G.maxTokens) {
      e.state = 'aim'; e.t = 0.4; G.tokens++;
      emit(G, 'telegraph', e.x, e.y, e.r);
    }
  },

  charger(G, e, p, dx, dy, d) {
    if (e.state === 'wind') {
      e.vx *= 0.7; e.vy *= 0.7; e.t -= DT;
      if (e.t <= 0) { e.state = 'dash'; e.t = 0.62; e.vx = Math.cos(e.ang) * 13.5; e.vy = Math.sin(e.ang) * 13.5; emit(G, 'charge', e.x, e.y); }
      return;
    }
    if (e.state === 'dash') {
      e.t -= DT;
      if (e.blocked) { e.state = 'idle'; e.stun = 1.0; e.cd = 1.6; e.vx = e.vy = 0; emit(G, 'thud', e.x, e.y, 0.5); }
      else if (e.t <= 0) { e.state = 'idle'; e.cd = 1.7; }
      return;
    }
    e.cd -= DT;
    chase(G, e, p, d, e.speed);
    if (e.los && d < 7.5 && d > 1.4 && e.cd <= 0) {
      e.state = 'wind'; e.t = 0.55;
      e.ang = Math.atan2(dy + p.vy * 0.22, dx + p.vx * 0.22);
      emit(G, 'telegraph', e.x, e.y, e.r);
    }
  },

  bomber(G, e, p, dx, dy, d) {
    if (e.state === 'fuse') {
      e.t -= DT; e.vx *= 0.86; e.vy *= 0.86;
      if (e.t <= 0) killEnemy(G, e);
      return;
    }
    if (e.los) steer(e, p.x, p.y, e.speed, 7); else viaFlow(G, e, e.speed, 9);
    if (d < 1.4 && e.los) { e.state = 'fuse'; e.t = 0.55; emit(G, 'fuse', e.x, e.y); }
  },

  // 闇の中では速く、灯りの中では遅い。ランタンの芯に近づくと焼ける。
  shade(G, e, p, dx, dy, d) {
    if ((G.tick + e.id) % 5 === 0) e.lit = lightAt(G, e.x, e.y);
    chase(G, e, p, d, e.speed * (e.lit < 0.3 ? 1.55 : 0.62));
    if (e.los && d < G.lanternR * 0.42 && (G.tick + e.id) % 15 === 0) hurtEnemy(G, e, 2.5, { src: 'burn' });
  },

  weaver(G, e, p, dx, dy, d) {
    e.cd -= DT;
    if (d < 6.5) { fieldStep(G.map, G.flow, e.x, e.y, -1, TMP); steer(e, TMP.x, TMP.y, e.speed, 8); }
    else if (d > 10.5 || !e.los) viaFlow(G, e, e.speed * 0.7, 6);
    else { e.vx *= 0.9; e.vy *= 0.9; }
    if (e.cd <= 0 && d < 15) {
      if (aliveCount(G) < 16) summon(G, e, 'mite', e.elite ? 3 : 2);
      e.cd = 5.5;
    }
  },

  sentinel(G, e, p, dx, dy, d) {
    e.cd -= DT; e.ang += DT * 0.5;
    if (e.cd <= 0 && d < 13 && (e.los || d < 4)) {
      ring(G, e, e.elite ? 16 : 11, 4.6, e.ang + (e.n & 1) * 0.35);
      e.n++; e.cd = 1.8;
    }
  },

  // ボス「灯らぬもの」。体力の 2/3 と 1/3 で部屋の松明を消す。松明が消えているほど硬い。
  unlit(G, e, p, dx, dy, d) {
    const room = G.map.rooms[e.room];
    const ph = e.hp < e.maxHp * 0.33 ? 3 : e.hp < e.maxHp * 0.66 ? 2 : 1;
    if (e.invuln > 0) e.invuln -= DT;
    if (ph > e.phase) {
      e.phase = ph; e.state = 'roar'; e.t = 1.4; e.invuln = 1.4; e.vx = e.vy = 0;
      for (const b of G.bullets) if (b.team !== 0) b.dead = true;
      for (const ti of room.torches) { G.map.torches[ti].lit = false; G.map.torches[ti].k = 0; }
      G.lightDirty = true;
      emit(G, 'bossPhase', e.x, e.y, ph);
      return;
    }
    const rest = () => { e.state = 'rest'; e.t = 1.35 - 0.25 * ph; };
    const next = () => {
      const list = ph === 1 ? ['burst', 'spiral', 'dash', 'ring'] : ['burst', 'summon', 'spiral', 'dash', 'ring'];
      const pat = list[e.pi++ % list.length];
      if (pat === 'burst') { e.state = 'burst'; e.n = 2 + ph; e.t = 0.4; }
      else if (pat === 'spiral') { e.state = 'spiral'; e.t = 2.6 + 0.4 * ph; }
      else if (pat === 'ring') { e.state = 'ring'; e.n = ph > 1 ? 3 : 2; e.t = 0.4; }
      else if (pat === 'summon') { e.state = 'summon'; e.t = 0.8; emit(G, 'telegraph', e.x, e.y, e.r); }
      else { e.state = 'wind'; e.n = ph; e.t = 0.65; e.ang = Math.atan2(dy, dx); emit(G, 'telegraph', e.x, e.y, e.r); }
    };
    e.t -= DT;
    switch (e.state) {
      case 'idle': e.state = 'intro'; e.t = 1.6; e.invuln = 1.6; break;
      case 'intro': case 'roar': e.vx *= 0.8; e.vy *= 0.8; if (e.t <= 0) next(); break;
      case 'rest': steer(e, p.x, p.y, e.speed * (0.8 + 0.2 * ph), 4); if (e.t <= 0) next(); break;
      case 'burst':
        steer(e, p.x, p.y, e.speed * 0.5, 4);
        if (e.t <= 0) {
          const n = 7 + 2 * ph, a0 = aimAt(G, e, p, d, 7, 0.5), spread = 1.15;
          for (let k = 0; k < n; k++) enemyBullet(G, e.x, e.y, a0 + (k / (n - 1) - 0.5) * spread, 7);
          emit(G, 'enemyShoot', e.x, e.y);
          e.n--; e.t = 0.58 - 0.06 * ph;
          if (e.n <= 0) rest();
        }
        break;
      case 'spiral':
        steer(e, room.cx + 0.5, room.cy + 0.5, e.speed, 4);
        if (G.tick % 5 === 0) {
          const arms = 2 + ph;
          e.ang += 0.21;
          for (let a = 0; a < arms; a++) enemyBullet(G, e.x, e.y, e.ang + (a * TAU) / arms, 4.5 + 0.3 * ph);
          if (G.tick % 20 === 0) emit(G, 'enemyShoot', e.x, e.y);
        }
        if (e.t <= 0) rest();
        break;
      case 'ring':
        e.vx *= 0.9; e.vy *= 0.9;
        if (e.t <= 0) {
          ring(G, e, 22 + 3 * ph, 4.8, (e.n & 1) * 0.16 + e.ang);
          e.n--; e.t = 0.8;
          if (e.n <= 0) rest();
        }
        break;
      case 'summon':
        e.vx *= 0.8; e.vy *= 0.8;
        if (e.t <= 0) {
          if (aliveCount(G) < 9) { summon(G, e, 'mite', 2); summon(G, e, 'shade', ph - 1); }
          rest();
        }
        break;
      case 'wind':
        e.vx *= 0.7; e.vy *= 0.7;
        if (e.t <= 0) { e.state = 'dash'; e.t = 0.9; e.vx = Math.cos(e.ang) * 15; e.vy = Math.sin(e.ang) * 15; emit(G, 'charge', e.x, e.y); }
        break;
      case 'dash':
        if (e.blocked || e.t <= 0) {
          if (e.blocked) { ring(G, e, 10 + 2 * ph, 4.6, e.ang); emit(G, 'thud', e.x, e.y, 1); }
          e.vx = e.vy = 0; e.n--;
          if (e.n > 0) { e.state = 'wind'; e.t = 0.5; e.ang = Math.atan2(dy, dx); emit(G, 'telegraph', e.x, e.y, e.r); }
          else rest();
        }
        break;
    }
  },
};

export function updateEnemies(G) {
  const p = G.player, m = G.map, es = G.enemies;
  G.tokens = 0;
  for (const e of es) if (!e.dead && e.state === 'aim') G.tokens++;
  const count = es.length; // このティックで呼び出された敵は次のティックから動く
  for (let i = 0; i < count; i++) {
    const e = es[i];
    if (e.dead) continue;
    if (e.spawnT > 0) { e.spawnT -= DT; if (e.spawnT <= 0) emit(G, 'spawn', e.x, e.y, e.r); continue; }
    if (e.flash > 0) e.flash -= DT;
    if (e.burnT > 0) {
      e.burnT -= DT; e.burnTick -= DT;
      if (e.burnTick <= 0) { e.burnTick = 0.25; hurtEnemy(G, e, e.burnDps * 0.25, { src: 'burn' }); if (e.dead) continue; }
    }
    if (e.orbCd > 0) e.orbCd--;
    const def = ENEMY[e.type];
    if (def.prop) continue;
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1e-6;
    if ((G.tick + e.id) % 6 === 0) e.los = d < 16 && lineClear(m, e.x, e.y, p.x, p.y);
    if (e.stun > 0) { e.stun -= DT; e.vx *= 0.8; e.vy *= 0.8; }
    else AI[e.type](G, e, p, dx, dy, d);
    if (e.dead) continue;
    if (Math.abs(dx) > 0.2) e.face = dx > 0 ? 1 : -1;
    // 仲間どうしの押し合い
    let sx = 0, sy = 0;
    if (def.speed > 0 && !def.boss && e.state !== 'dash') {
      forNear(G, e.x, e.y, e.r + 0.7, o => {
        if (o === e || o.dead || o.spawnT > 0 || ENEMY[o.type].prop) return;
        const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy), min = e.r + o.r;
        if (od >= min) return;
        if (od < 1e-4) { sx += (e.id < o.id ? 1 : -1) * 0.02; return; }
        const k = ((min - od) / od) * 0.35;
        sx += ox * k; sy += oy * k;
      });
    }
    const ix = (e.vx + e.kx) * DT + sx, iy = (e.vy + e.ky) * DT + sy, ox = e.x, oy = e.y;
    e.kx *= 0.84; e.ky *= 0.84;
    if (def.speed > 0 || e.kx !== 0) {
      moveCircle(m, e, ix, iy);
      const want = Math.hypot(ix, iy);
      e.blocked = want > 0.05 && Math.hypot(e.x - ox, e.y - oy) < want * 0.45;
    }
    // 接触ダメージ
    if (e.type !== 'bomber' && e.type !== 'sentinel' && d < e.r + p.r) {
      hurtPlayer(G, e.type === 'charger' && e.state !== 'dash' ? 1 : e.dmg, e.x, e.y);
    }
  }
}

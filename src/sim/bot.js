// 自動プレイ bot。バランス調整の試行と、タイトル画面のデモに使う。
// 16方向＋停止の候補それぞれについて少し先の自分と弾・敵の位置を予測し、いちばん安全で目的に近い向きを選ぶ。
import { RNG } from '../core/rng.js';
import { ENEMY } from './defs.js';
import { TAU, lineClear, solidAt, distanceField, fieldStep } from './util.js';

const KEEP = { mite: 3.2, charger: 4.6, bomber: 4.2, shade: 3.4, spitter: 2.2, weaver: 2, sentinel: 2.4, unlit: 5.5 };
const PRIORITY = {
  twin: 10, storm: 10, sunheart: 10, kindling: 8, wick: 8, chain: 8, splinter: 7, pierce: 6, ignite: 6, orbit: 6,
  vigor: 6, keen: 5, overcharge: 5, afterglow: 5, homing: 5, volatile: 5, vamp: 6, everoil: 6, nova: 3, radiance: 4,
  reservoir: 4, fleet: 4, phase: 3, ricochet: 3, magnet: 2,
};
const BOT_TMP = { x: 0, y: 0 };

export function createBot(seed = 1, skill = 1) {
  return { rng: new RNG(seed), skill, field: null, target: -1, version: -1, dir: 0, useTick: 0, mx: 0, my: 0 };
}

export function botInput(bot, G) {
  const inp = { mx: 0, my: 0, aim: 0, btn: 0, choice: 0 };
  const p = G.player, m = G.map, s = p.stats;
  if (G.pending) {
    let best = 0, bv = -1;
    G.pending.choices.forEach((id, i) => {
      let v = (PRIORITY[id] || 3) + bot.rng.f() * 3 * (2 - bot.skill);
      if (id === 'vigor' && p.hp <= 3) v += 5;
      if (v > bv) { bv = v; best = i; }
    });
    inp.choice = best + 1;
    return inp;
  }

  // --- 狙う相手
  let tgt = null, tv = Infinity, hostile = 0;
  const threats = [];
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    const prop = ENEMY[e.type].prop;
    if (!prop && d < 14) { threats.push(e); hostile++; }
    if (e.spawnT > 0.25 || d > 13 || (prop && d > 6)) continue;
    if (!lineClear(m, p.x, p.y, e.x, e.y)) continue;
    const v = d + (prop ? 20 : 0) - (e.type === 'bomber' ? 3 : 0) - (e.type === 'weaver' ? 2 : 0);
    if (v < tv) { tv = v; tgt = e; }
  }
  if (tgt) {
    const d = Math.hypot(tgt.x - p.x, tgt.y - p.y), t = (d / s.projSpeed) * bot.skill;
    const a = Math.atan2(tgt.y + tgt.vy * t - p.y, tgt.x + tgt.vx * t - p.x) + bot.rng.range(-0.1, 0.1) * (1 - bot.skill);
    inp.aim = Math.max(-32768, Math.min(32767, Math.round((a / Math.PI) * 32768)));
    inp.btn |= 1;
  } else inp.aim = Math.round((Math.atan2(p.vy, p.vx || 1e-3) / Math.PI) * 32767);

  // --- 目的地
  const combat = hostile > 0 && (G.activeRoom >= 0 || tgt);
  let gx = p.x, gy = p.y, hasGoal = false;
  if (!combat) {
    let pk = null, pd = 9;
    for (const k of G.pickups) {
      if (k.kind === 'heart' && p.hp >= s.maxHp) continue;
      const d = Math.hypot(k.x - p.x, k.y - p.y);
      if (d < pd && lineClear(m, p.x, p.y, k.x, k.y)) { pd = d; pk = k; }
    }
    if (pk) { gx = pk.x; gy = pk.y; hasGoal = true; }
    else {
      let target = -1, bd = 65535;
      for (const r of m.rooms) {
        if (r.state !== 'idle') continue;
        const d = G.flow[r.cy * m.w + r.cx];
        if (d < bd) { bd = d; target = r.cy * m.w + r.cx; }
      }
      if (target < 0 && m.stairs.open) target = (m.stairs.y | 0) * m.w + (m.stairs.x | 0);
      if (target >= 0) {
        if (bot.target !== target || bot.version !== m.version || bot.map !== m) {
          bot.field = distanceField(m, target % m.w, (target / m.w) | 0, bot.field && bot.map === m ? bot.field : null);
          bot.target = target; bot.version = m.version; bot.map = m;
        }
        // 経路を数歩先まで見て、見通せるいちばん遠い点を目指す
        fieldStep(m, bot.field, p.x, p.y, 1, BOT_TMP);
        gx = BOT_TMP.x; gy = BOT_TMP.y; hasGoal = true;
        for (let i = 0; i < 4; i++) {
          if (!fieldStep(m, bot.field, BOT_TMP.x, BOT_TMP.y, 1, BOT_TMP) || !lineClear(m, p.x, p.y, BOT_TMP.x, BOT_TMP.y)) break;
          gx = BOT_TMP.x; gy = BOT_TMP.y;
        }
        if (m.stairs.open && target === (m.stairs.y | 0) * m.w + (m.stairs.x | 0) && Math.hypot(m.stairs.x - p.x, m.stairs.y - p.y) < 1.1) {
          if (G.tick % 4 < 2) inp.btn |= 4;
        }
      }
    }
  }
  let torch = null;
  if (combat) {
    let td = 99;
    const room = G.activeRoom >= 0 ? m.rooms[G.activeRoom] : null;
    if (room && room.role === 'boss') for (const ti of room.torches) {
      const t = m.torches[ti];
      if (t.lit) continue;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < td) { td = d; torch = t; }
    }
  }

  // --- 向きの候補を採点（3ティックに1回）
  // 腕前が低いほど判断が遅く、弾に気づく距離も短い
  const period = Math.round(3 + (1 - bot.skill) * 14), notice = 1.5 + 4.5 * bot.skill;
  if (G.tick % period === 0) {
    const room = G.activeRoom >= 0 ? m.rooms[G.activeRoom] : null;
    let bestCost = Infinity, bestDir = -1, bestMin = 9;
    for (let k = -1; k < 16; k++) {
      const a = (k / 16) * TAU, ux = k < 0 ? 0 : Math.cos(a), uy = k < 0 ? 0 : Math.sin(a);
      let cost = k === bot.dir ? -0.15 : 0, minB = 9;
      const ex = p.x + ux * s.move * 0.4, ey = p.y + uy * s.move * 0.4;
      if (k >= 0 && (solidAt(m, p.x + ux * 0.55, p.y + uy * 0.55) || !lineClear(m, p.x, p.y, ex, ey))) cost += 30;
      for (const b of G.bullets) {
        if (b.team === 0 || b.dead) continue;
        if (Math.abs(b.x - p.x) > notice || Math.abs(b.y - p.y) > notice) continue;
        for (let t = 0.08; t < 0.6; t += 0.1) {
          const dd = Math.hypot(b.x + b.vx * t - (p.x + ux * s.move * t), b.y + b.vy * t - (p.y + uy * s.move * t));
          if (dd < minB) minB = dd;
          if (dd < 0.85) cost += 60 * (0.85 - dd) * (0.7 - t) + 12;
        }
      }
      for (const e of threats) {
        if (e.spawnT > 0.35) { if (Math.hypot(e.x - ex, e.y - ey) < 1.5) cost += 3; continue; }
        const keep = KEEP[e.type] || 3;
        if (e.state === 'wind' || e.state === 'dash') {
          // 突進の線から外れる
          const rx = ex - e.x, ry = ey - e.y, cx = Math.cos(e.ang), cy = Math.sin(e.ang);
          const along = rx * cx + ry * cy, side = Math.abs(rx * cy - ry * cx);
          if (along > -0.5 && along < 11 && side < 1.6 + e.r) cost += (1.6 + e.r - side) * 14;
        }
        const dd = Math.hypot(e.x + e.vx * 0.3 - ex, e.y + e.vy * 0.3 - ey);
        if (dd < keep) cost += (keep - dd) * (e.type === 'bomber' && e.state === 'fuse' ? 14 : 6);
      }
      if (combat) {
        if (tgt) cost += Math.abs(Math.hypot(tgt.x - ex, tgt.y - ey) - 5.5) * 0.9;
        if (room) cost += Math.hypot(room.cx + 0.5 - ex, room.cy + 0.5 - ey) * 0.12;
        if (torch) cost += Math.hypot(torch.x - ex, torch.y - ey) * 0.9;
      } else if (hasGoal) cost += Math.hypot(gx - ex, gy - ey) * 2.2;
      if (cost < bestCost) { bestCost = cost; bestDir = k; bestMin = minB; }
    }
    bot.dir = bestDir;
    bot.mx = bestDir < 0 ? 0 : Math.round(Math.cos((bestDir / 16) * TAU) * 127);
    bot.my = bestDir < 0 ? 0 : Math.round(Math.sin((bestDir / 16) * TAU) * 127);
    bot.dashNow = bot.skill > 0.5 && p.dashCd <= 0 && bestDir >= 0 && (bestMin < 0.55 || bestCost > 26);
  }
  inp.mx = bot.mx; inp.my = bot.my;
  if (bot.dashNow && G.tick % 2 === 0) { inp.btn |= 2; bot.dashNow = false; }
  return inp;
}

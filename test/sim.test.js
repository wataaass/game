import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../src/core/rng.js';
import { packInputs, unpackInputs } from '../src/core/replay.js';
import { generateDungeon, T_VOID, T_FLOOR, T_DOOR, T_WALL } from '../src/sim/dungeon.js';
import { UPGRADES, ENEMY, BASE_STATS, computeStats } from '../src/sim/defs.js';
import { rebuildSolid, lineClear, moveCircle, distanceField } from '../src/sim/util.js';
import { createGame, step, hashState, WIN_DEPTH } from '../src/sim/game.js';
import { createBot, botInput } from '../src/sim/bot.js';
import { buildSegments, visPolygon } from '../src/render/visibility.js';
import { buildAtlas } from '../src/render/atlas.js';
import { AUDIO_TRACKS, au_parseLine, au_midi, createAudio } from '../src/audio/audio.js';

const idle = { mx: 0, my: 0, aim: 0, btn: 0, choice: 0 };

test('乱数: 同じ種は同じ列、違う種は違う列', () => {
  const a = new RNG(42), b = new RNG(42), c = new RNG(43);
  const sa = Array.from({ length: 50 }, () => a.u32()), sb = Array.from({ length: 50 }, () => b.u32()), sc = Array.from({ length: 50 }, () => c.u32());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  const r = new RNG(7);
  let sum = 0;
  for (let i = 0; i < 20000; i++) { const v = r.f(); assert.ok(v >= 0 && v < 1); sum += v; }
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.01, '平均が 0.5 付近');
  assert.equal(new RNG(1).weighted([0, 0]), -1);
});

test('ダンジョン: 600 枚すべてで、全部屋・階段・宝箱へ歩いて行ける', () => {
  for (let seed = 1; seed <= 100; seed++) for (let depth = 1; depth <= 6; depth++) {
    const m = generateDungeon(seed * 2654435761, depth);
    rebuildSolid(m);
    const d = distanceField(m, m.start.x | 0, m.start.y | 0);
    for (const r of m.rooms) {
      assert.ok(d[r.cy * m.w + r.cx] < 65535, `seed ${seed} depth ${depth}: 部屋 ${r.id} に届かない`);
      assert.ok(r.doors.length >= 2, '扉がある');
      for (const dr of r.doors) assert.equal(m.tiles[dr.y * m.w + dr.x], T_DOOR);
    }
    assert.ok(d[(m.stairs.y | 0) * m.w + (m.stairs.x | 0)] < 65535, '階段に届く');
    assert.equal(m.rooms.filter(r => r.role === 'start').length, 1);
    assert.equal(m.rooms.filter(r => r.role === 'exit' || r.role === 'boss').length, 1);
    assert.equal(m.boss, depth % 5 === 0);
    // 床は必ず壁か床に囲まれている（虚空に直接は面さない）
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
      const t = m.tiles[y * m.w + x];
      if (t !== T_FLOOR && t !== T_DOOR) continue;
      for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notEqual(m.tiles[(y + j) * m.w + x + i], T_VOID);
    }
    for (const t of m.torches) {
      assert.equal(m.tiles[t.wy * m.w + t.wx], T_WALL);
      assert.equal(m.solid[(t.y | 0) * m.w + (t.x | 0)], 0, '松明の光源は床の上');
    }
  }
});

test('ダンジョン: 同じ種と階層なら同じ地形', () => {
  const a = generateDungeon(999, 3), b = generateDungeon(999, 3), c = generateDungeon(999, 4);
  assert.deepEqual(a.tiles, b.tiles);
  assert.deepEqual(a.torches, b.torches);
  assert.notDeepEqual(a.tiles, c.tiles);
});

test('当たり判定: 円は壁に入らず、見通しは壁で切れる', () => {
  const m = generateDungeon(5, 1);
  rebuildSolid(m);
  const r = m.rooms[0], e = { x: r.cx + 0.5, y: r.cy + 0.5, r: 0.3 };
  const rng = new RNG(3);
  for (let i = 0; i < 4000; i++) {
    moveCircle(m, e, rng.range(-0.6, 0.6), rng.range(-0.6, 0.6));
    assert.equal(m.solid[(e.y | 0) * m.w + (e.x | 0)], 0);
    for (const [dx, dy] of [[0.29, 0], [-0.29, 0], [0, 0.29], [0, -0.29]]) {
      assert.equal(m.solid[((e.y + dy) | 0) * m.w + ((e.x + dx) | 0)], 0, '円の縁も壁の外');
    }
  }
  assert.equal(lineClear(m, r.cx + 0.5, r.cy + 0.5, r.cx + 1.5, r.cy + 0.5), true);
  assert.equal(lineClear(m, r.cx + 0.5, r.cy + 0.5, r.cx + 0.5, 0.5), false);
});

test('強化: 定義に欠けがなく、どれを取っても数値が壊れない', () => {
  const ids = new Set();
  for (const u of UPGRADES) {
    assert.ok(u.id && u.name && u.desc && u.max >= 1 && [1, 2, 3].includes(u.rarity));
    assert.ok(!ids.has(u.id), '重複なし');
    ids.add(u.id);
    if (u.req) assert.ok(UPGRADES.some(o => o.id === u.req));
  }
  const all = Object.fromEntries(UPGRADES.map(u => [u.id, u.max]));
  const s = computeStats(all);
  for (const k in BASE_STATS) assert.ok(Number.isFinite(s[k]) && s[k] >= 0, k);
  assert.ok(s.dmg > BASE_STATS.dmg && s.rate > BASE_STATS.rate && s.oilDrain < BASE_STATS.oilDrain);
  assert.deepEqual(computeStats({}), BASE_STATS);
  for (const t in ENEMY) assert.ok(ENEMY[t].hp > 0 && ENEMY[t].r > 0);
});

test('決定性: 記録した入力を流し直すと、毎ティックの状態ハッシュが一致する', () => {
  const G = createGame(20261110), bot = createBot(1, 1), inputs = [], hashes = [];
  for (let i = 0; i < 6000 && !G.over; i++) {
    const inp = botInput(bot, G);
    inputs.push(inp); step(G, inp);
    if (i % 50 === 0) hashes.push(hashState(G));
  }
  assert.ok(G.stats.kills > 10, '戦闘が起きている');
  // 保存形式を通してから再生する
  const replay = unpackInputs(packInputs(inputs));
  assert.equal(replay.length, inputs.length);
  const R = createGame(20261110), again = [];
  replay.forEach((inp, i) => { step(R, inp); if (i % 50 === 0) again.push(hashState(R)); });
  assert.deepEqual(again, hashes);
  assert.equal(hashState(R), hashState(G));
  // 入力が1つ違えば別の結果になる
  const D = createGame(20261110);
  replay.forEach((inp, i) => step(D, i === 100 ? { ...inp, mx: -inp.mx || 127, btn: inp.btn ^ 2 } : inp));
  assert.notEqual(hashState(D), hashState(G));
});

test('通しプレイ: bot が全階層を突破でき、途中で状態が壊れない', () => {
  let wins = 0;
  for (const seed of [11, 12, 13]) {
    const G = createGame(seed), bot = createBot(seed, 1);
    for (let i = 0; i < 60 * 60 * 30 && !G.over && !G.won; i++) {
      step(G, botInput(bot, G));
      if (i % 20) continue;
      const p = G.player, m = G.map;
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.equal(m.solid[(p.y | 0) * m.w + (p.x | 0)], 0, 'プレイヤーは壁の外');
      assert.ok(p.hp <= p.stats.maxHp && p.oil >= 0 && p.oil <= p.stats.oilMax + 1e-6);
      assert.ok(G.bullets.length <= 900 && G.enemies.length < 200);
      for (const e of G.enemies) {
        assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.hp));
        assert.equal(m.solid[(e.y | 0) * m.w + (e.x | 0)], 0, `${e.type} は壁の外`);
      }
    }
    if (G.won) { wins++; assert.equal(G.depth, WIN_DEPTH); }
  }
  assert.ok(wins >= 2, `3本中 ${wins} 本クリア`);
});

test('入力なしでも進行する（放置しても例外が出ない）', () => {
  const G = createGame(1);
  for (let i = 0; i < 3000; i++) step(G, idle);
  assert.equal(G.tick, 3000);
  assert.ok(G.player.oil < 100);
});

test('可視ポリゴン: 部屋の中心から見える面積は、部屋の面積を超えず大きく欠けもしない', () => {
  const m = generateDungeon(77, 1);
  rebuildSolid(m);
  const segs = buildSegments(m), r = m.rooms[0];
  assert.ok(segs.length > 40 && segs.length % 4 === 0);
  const poly = visPolygon(segs, r.cx + 0.5, r.cy + 0.5, 6);
  let area = 0;
  for (let i = 2; i + 3 < poly.length; i += 2) area += poly[i] * poly[i + 3] - poly[i + 2] * poly[i + 1];
  area = Math.abs(area) / 2;
  assert.ok(area > r.w * r.h * 0.8 && area <= 144.5, `面積 ${area.toFixed(1)}`);
  for (let i = 2; i < poly.length; i += 2) assert.ok(Math.hypot(poly[i] - poly[0], poly[i + 1] - poly[1]) <= 6 * 1.5 + 1e-3);
});

test('アトラス: 描画が参照するスプライトがすべて生成されている', () => {
  const a = buildAtlas();
  assert.equal(a.pixels.length, a.size * a.size * 4);
  const need = ['player0', 'player1', 'glow', 'ring', 'shadow', 'white', 'ember', 'oil', 'heart', 'stairs', 'gate', 'chest', 'chestOpen',
    'shrine', 'shrineUsed', 'torchOn', 'torchOff', 'doorFloor', 'floor0', 'floor3', 'wallTop1', 'wallFace1', 'd0', 'd9'];
  for (const t in ENEMY) need.push(t + '0', t + '1');
  for (const n of need) assert.ok(a.sprites[n], n);
  let opaque = 0;
  for (let i = 3; i < a.pixels.length; i += 4) if (a.pixels[i]) opaque++;
  assert.ok(opaque > 5000);
});

test('BGM: どの曲も全小節が16分音符16個ぶんで、音名と和音が正しい', () => {
  for (const [name, T] of Object.entries(AUDIO_TRACKS)) {
    assert.equal(T.lead.length, T.chords.length, name);
    T.lead.forEach((bar, i) => {
      const notes = au_parseLine(bar);
      assert.equal(notes.reduce((a, x) => a + x.len, 0), 16, `${name} 主旋律 ${i + 1} 小節目`);
      for (const x of notes) { const m = au_midi(x.n); assert.ok(m === -1 || (m >= 55 && m <= 96), `${name}: ${x.n}`); }
    });
    for (const bar of T.bass) assert.equal(au_parseLine(bar).reduce((a, x) => a + x.len, 0), 16, `${name} ベース`);
    for (const bar of T.drums) { assert.equal(bar.length, 16, `${name} ドラム`); assert.match(bar, /^[ksh.]+$/); }
    assert.ok(T.bpm >= 60 && T.bpm <= 180);
    assert.ok(['broken', 'stab', 'chip', 'octave', 'pad', 'none'].includes(T.arp), name);
    if (T.arp === 'stab') assert.equal(T.mask.length, 16, name);
  }
  // 層ごとに探索曲と戦闘曲があり、テンポか音色か和音の鳴らし方が必ず違う
  for (const kind of ['explore', 'combat']) {
    const sig = [1, 2, 3, 4, 5].map(d => { const T = AUDIO_TRACKS[kind + (d === 1 ? '' : d)]; assert.ok(T, kind + d); return [T.bpm, T.wave, T.arp, T.lead[0]].join('|'); });
    assert.equal(new Set(sig).size, 5, kind);
    assert.equal(new Set(sig.map(x => x.split('|')[0])).size, 5, kind + ' のテンポ');
  }
  assert.equal(au_midi('A4'), 69);
  assert.equal(au_midi('C#5'), 73);
  assert.equal(au_midi('Bb3'), 58);
  assert.throws(() => au_midi('H2'));
});

test('音: AudioContext のない環境では何もしない（例外を出さない）', () => {
  const a = createAudio();
  a.unlock(); a.setVolumes({ master: 1, music: 1, sfx: 1 }); a.setMuted(true); a.setScene('game');
  a.onEvents([{ type: 'hit', x: 0, y: 0, a: 1, b: 0 }], null); a.update(null, 0.016);
});

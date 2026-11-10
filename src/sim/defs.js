// 敵と強化の定義（数値の調整はここに集める）。
export const ENEMY = {
  mite:     { hp: 26,   speed: 3.7, r: 0.32, xp: 1,  cost: 1, dmg: 1, minDepth: 1 },
  spitter:  { hp: 36,   speed: 2.5, r: 0.36, xp: 2,  cost: 2, dmg: 1, minDepth: 1 },
  charger:  { hp: 80,   speed: 2.4, r: 0.46, xp: 3,  cost: 3, dmg: 2, minDepth: 2 },
  bomber:   { hp: 30,   speed: 4.1, r: 0.34, xp: 2,  cost: 2, dmg: 2, minDepth: 2 },
  shade:    { hp: 48,   speed: 3.1, r: 0.36, xp: 3,  cost: 3, dmg: 1, minDepth: 3 },
  weaver:   { hp: 90,   speed: 2.1, r: 0.42, xp: 5,  cost: 5, dmg: 1, minDepth: 3 },
  sentinel: { hp: 120,  speed: 0,   r: 0.48, xp: 5,  cost: 4, dmg: 1, minDepth: 4 },
  urn:      { hp: 8,    speed: 0,   r: 0.34, xp: 0,  cost: 0, dmg: 0, prop: true },
  unlit:    { hp: 2300, speed: 2.4, r: 1.25, xp: 60, cost: 0, dmg: 2, boss: true },
};

export const BASE_STATS = {
  dmg: 10, rate: 4, projSpeed: 14, count: 1, pierce: 0, bounce: 0, split: 0, chain: 0, burn: 0,
  homing: 0, explode: 0, crit: 0.05, move: 5.2, maxHp: 6, oilMax: 100, oilDrain: 0.8, lightMul: 1,
  radiance: 0, magnet: 2.2, dashCd: 0.9, dashHit: 0, nova: 0, orbitals: 0, vamp: 0, afterglow: 0, overcharge: 0,
};

// rarity: 1=よく出る 2=まれ 3=宝箱からだけ出る遺物
export const UPGRADES = [
  { id: 'kindling',  name: '焚きつけ',     desc: '火花の威力 +25%',                     max: 6, rarity: 1, apply: (s, n) => { s.dmg *= 1 + 0.25 * n; } },
  { id: 'wick',      name: '速い芯',       desc: '連射速度 +20%',                       max: 6, rarity: 1, apply: (s, n) => { s.rate *= 1 + 0.2 * n; } },
  { id: 'twin',      name: '双つ火',       desc: '火花を1つ追加（威力 -8%）',           max: 4, rarity: 2, apply: (s, n) => { s.count += n; s.dmg *= Math.pow(0.92, n); } },
  { id: 'pierce',    name: '貫く光',       desc: '火花が敵を1体多く貫通する',           max: 3, rarity: 1, apply: (s, n) => { s.pierce += n; } },
  { id: 'ricochet',  name: '跳ね火',       desc: '火花が壁で1回多く跳ね返る',           max: 3, rarity: 1, apply: (s, n) => { s.bounce += n; } },
  { id: 'splinter',  name: '爆ぜ火',       desc: '命中した火花が2つに裂ける',           max: 3, rarity: 2, apply: (s, n) => { s.split += n; } },
  { id: 'chain',     name: '走る稲火',     desc: '命中時、近くの敵へ火が跳ぶ',          max: 4, rarity: 2, apply: (s, n) => { s.chain += n; } },
  { id: 'ignite',    name: '延焼',         desc: '命中した敵を3秒間燃やす',             max: 4, rarity: 1, apply: (s, n) => { s.burn += n; } },
  { id: 'fleet',     name: '軽い足',       desc: '移動速度 +10%',                       max: 4, rarity: 1, apply: (s, n) => { s.move *= 1 + 0.1 * n; } },
  { id: 'vigor',     name: '強い心臓',     desc: '最大体力 +1（全回復はしない）',       max: 4, rarity: 1, apply: (s, n) => { s.maxHp += 2 * n; } },
  { id: 'reservoir', name: '深い油壺',     desc: '油の容量 +30%、減りが遅くなる',       max: 3, rarity: 1, apply: (s, n) => { s.oilMax *= 1 + 0.3 * n; s.oilDrain *= Math.pow(0.85, n); } },
  { id: 'radiance',  name: '輝き',         desc: '灯りが広がり、照らした敵への威力 +12%', max: 4, rarity: 1, apply: (s, n) => { s.lightMul *= 1 + 0.12 * n; s.radiance += 0.12 * n; } },
  { id: 'magnet',    name: '残り火集め',   desc: '残り火を引き寄せる範囲が広がる',      max: 3, rarity: 1, apply: (s, n) => { s.magnet += 1.6 * n; } },
  { id: 'phase',     name: '火走り',       desc: 'ダッシュが早く戻り、触れた敵を焼く',  max: 3, rarity: 1, apply: (s, n) => { s.dashCd *= Math.pow(0.8, n); s.dashHit += n; } },
  { id: 'nova',      name: '怒りの環',     desc: '傷を受けると火花の環を放つ',          max: 3, rarity: 2, apply: (s, n) => { s.nova += n; } },
  { id: 'orbit',     name: '蛍',           desc: '周りを回る蛍が敵を焼く',              max: 4, rarity: 2, apply: (s, n) => { s.orbitals += n; } },
  { id: 'homing',    name: '導きの火',     desc: '火花が敵へ曲がる',                    max: 2, rarity: 2, apply: (s, n) => { s.homing += n; } },
  { id: 'volatile',  name: '火薬',         desc: '火花が消えるとき小さく爆発する',      max: 3, rarity: 2, apply: (s, n) => { s.explode += n; } },
  { id: 'keen',      name: '冴えた目',     desc: '会心率 +15%（会心は威力2倍）',        max: 4, rarity: 1, apply: (s, n) => { s.crit += 0.15 * n; } },
  { id: 'afterglow', name: '燃え移り',     desc: '燃えている敵が倒れると爆ぜて周囲を燃やす', max: 2, rarity: 2, req: 'ignite', apply: (s, n) => { s.afterglow += n; } },
  { id: 'overcharge', name: '溜め火',      desc: '5発ごとに貫通する大きな火花を放つ',   max: 3, rarity: 2, apply: (s, n) => { s.overcharge += n; } },
  { id: 'vamp',      name: '命の残り火',   desc: '敵を倒すとまれに体力が戻る',          max: 2, rarity: 3, apply: (s, n) => { s.vamp += 0.035 * n; } },
  { id: 'sunheart',  name: '陽の心臓',     desc: '威力 +40%、灯りが大きく広がる',       max: 1, rarity: 3, apply: (s, n) => { s.dmg *= 1 + 0.4 * n; s.lightMul *= 1 + 0.25 * n; } },
  { id: 'storm',     name: '火花の嵐',     desc: '連射速度 +35%、火花を1つ追加',        max: 1, rarity: 3, apply: (s, n) => { s.rate *= 1 + 0.35 * n; s.count += n; } },
  { id: 'everoil',   name: '尽きぬ油',     desc: '油の減りが半分になる',                max: 1, rarity: 3, apply: (s, n) => { if (n) s.oilDrain *= 0.5; } },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

export function computeStats(up) {
  const s = { ...BASE_STATS };
  for (const u of UPGRADES) { const n = up[u.id] | 0; if (n > 0) u.apply(s, n); }
  return s;
}

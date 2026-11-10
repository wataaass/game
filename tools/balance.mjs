// バランス確認。腕前の違う bot に何十本も通しで遊ばせ、到達階層や被弾を集計する。
// 使い方: npm run balance -- [本数=30]
import { createGame, step, WIN_DEPTH } from '../src/sim/game.js';
import { createBot, botInput } from '../src/sim/bot.js';

const runs = Number(process.argv[2] || 30), LIMIT = 60 * 60 * 30;
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log('腕前  クリア率  到達階(中央)  時間(分)  被弾(中央)  Lv(中央)  死因の階');
for (const skill of [1, 0.75, 0.5, 0.25]) {
  let wins = 0;
  const depth = [], time = [], hurt = [], lvl = [], died = {};
  for (let i = 0; i < runs; i++) {
    const seed = 1000 + i * 7919, G = createGame(seed), bot = createBot(seed + 1, skill);
    let t = 0;
    while (t++ < LIMIT && !G.over && !G.won) step(G, botInput(bot, G));
    if (G.won) wins++; else died[G.depth] = (died[G.depth] || 0) + 1;
    depth.push(G.depth); time.push(G.time / 60); hurt.push(G.stats.hurt); lvl.push(G.player.level);
  }
  console.log(`${skill.toFixed(2)}   ${String(Math.round((wins / runs) * 100)).padStart(3)}%      ${median(depth)}/${WIN_DEPTH}         ${median(time).toFixed(1).padStart(5)}     ${String(median(hurt)).padStart(3)}        ${String(median(lvl)).padStart(2)}     ${JSON.stringify(died)}`);
}

// 依存なしの検査。構文、シミュレーションの決定性を壊す書き方、バンドル時に衝突する名前を見る。
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { moduleGraph, topLevelNames } from './modules.mjs';

const errors = [];
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = [...walk('src'), ...walk('tools'), ...walk('test')].filter(f => /\.(js|mjs)$/.test(f));

for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { errors.push(`${f}: 構文エラー\n${e.stderr}`); }
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    if (/\t/.test(line)) errors.push(`${at}: タブ文字`);
    if (/\s+$/.test(line)) errors.push(`${at}: 行末の空白`);
    if (f.startsWith('src/') && /console\.(log|debug)/.test(line)) errors.push(`${at}: console.log が残っている`);
    if (/^src\/(sim|core)\//.test(f)) {
      if (/Math\.random|Date\.now|performance\.now/.test(line) && !/^\s*\/\//.test(line)) errors.push(`${at}: シミュレーションで非決定的な値を使っている`);
      if (/\b(document|window|localStorage)\b/.test(line) && !/^\s*\/\//.test(line) && !/atob|btoa/.test(line)) errors.push(`${at}: シミュレーションがブラウザに依存している`);
    }
  });
}

// バンドルは全モジュールを1つのスコープに並べるので、直下の名前が重なってはいけない
const owner = new Map();
for (const m of moduleGraph()) {
  for (const name of topLevelNames(m.code)) {
    if (owner.has(name)) errors.push(`${m.rel}: 直下の名前 ${name} が ${owner.get(name)} と重なる`);
    else owner.set(name, m.rel);
  }
  if (/^import\s+\*|^export\s+(default|\{|\*)/m.test(m.code)) errors.push(`${m.rel}: バンドラが扱えない import/export`);
}

if (errors.length) { console.error(errors.join('\n')); console.error(`\n${errors.length} 件の問題`); process.exit(1); }
console.log(`lint OK（${files.length} ファイル）`);

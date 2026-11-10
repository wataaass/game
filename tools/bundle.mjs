// 配布用の単一ファイルを作る（依存なし）。ES モジュールは file:// で開けないので、
// 全モジュールを依存順に1つのスクリプトへ並べ、CSS と一緒に dist/lanternfall.html へ埋め込む。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { moduleGraph, stripModule } from './modules.mjs';

const mods = moduleGraph();
const js = mods.map(m => `// ---- ${m.rel}\n${stripModule(m.code).trim()}\n`).join('\n');
const css = readFileSync('src/ui/ui.css', 'utf8');
let html = readFileSync('index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="src/ui/ui.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>\n(() => {\n'use strict';\n${js.replace(/<\/script/g, '<\\/script')}\n})();\n</script>`);
if (html.includes('type="module"') || html.includes('rel="stylesheet"')) throw new Error('index.html の差し替えに失敗');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/lanternfall.html', html);
writeFileSync('dist/lanternfall.js', js);
console.log(`dist/lanternfall.html ${(html.length / 1024).toFixed(0)} KB（${mods.length} モジュール）`);

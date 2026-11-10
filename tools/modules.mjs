// src/main.js から import をたどり、依存の順に並べたモジュール一覧を返す（lint と bundle で共用）。
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const IMPORT = /^import\s+(?:\{([^}]*)\}\s+from\s+)?'([^']+)';?[ \t]*$/gms;

export function moduleGraph(entry = 'src/main.js') {
  const order = [], seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(file, 'utf8'), deps = [];
    for (const m of code.matchAll(IMPORT)) deps.push(resolve(dirname(file), m[2]));
    deps.forEach(visit);
    order.push({ file, rel: relative(process.cwd(), file), code, deps });
  };
  visit(resolve(entry));
  return order;
}

// import 文を取り除き、export を外した本体
export function stripModule(code) {
  return code.replace(IMPORT, '').replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '');
}

// モジュール直下で宣言している名前
export function topLevelNames(code) {
  const names = [];
  for (const m of stripModule(code).matchAll(/^(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)|^(?:const|let)\s+([^;=]+?)\s*=/gm)) {
    if (m[1]) names.push(m[1]);
    else if (!/[{[]/.test(m[2])) for (const part of m[2].split(',')) names.push(part.trim());
  }
  // 「const A = 1, B = 2;」の2つ目以降
  for (const m of stripModule(code).matchAll(/^(?:const|let)\s+(.+);[ \t]*$/gm)) {
    let depth = 0, cur = '';
    for (const ch of m[1] + ',') {
      if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { const n = cur.split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n) && !names.includes(n)) names.push(n); cur = ''; }
      else cur += ch;
    }
  }
  return names;
}

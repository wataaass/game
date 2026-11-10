import { UPGRADES, UPGRADE_BY_ID } from '../sim/defs.js';

// DOM を一度だけ組み立て、毎フレームの更新は差分があるときだけ行う。
export function createUI(root, handlers) {
  const H = handlers || {};
  root.style.pointerEvents = 'none';
  const NS = 'http://www.w3.org/2000/svg';
  const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3'
    + 'c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5'
    + 'c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const add = (parent, ...children) => {
    for (const child of children) parent.appendChild(child);
    return parent;
  };
  const call = (name, ...args) => {
    if (typeof H[name] === 'function') H[name](...args);
  };
  const fmtTime = seconds => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  const hashSeed = text => {
    // FNV-1a（32bit）
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

  const makeHeartSvg = cls => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('ui-heart-svg', cls);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', HEART_PATH);
    svg.appendChild(path);
    return svg;
  };

  // ---------------------------------------------------------------- HUD
  const hud = el('div', 'ui-hud ui-is-off');
  hud.setAttribute('aria-hidden', 'true');
  root.appendChild(hud);

  const tl = el('div', 'ui-tl ui-hud-block');
  const hearts = el('div', 'ui-hearts');
  hearts.setAttribute('role', 'img');
  hearts.setAttribute('aria-label', '体力');
  const heartSlots = [];

  const oil = el('div', 'ui-oil');
  const oilHead = el('div', 'ui-meter-head');
  const oilPctLabel = el('span', 'ui-meter-value', '100%');
  add(oilHead, el('span', 'ui-meter-label', '油'), oilPctLabel);
  const oilTrack = el('div', 'ui-bar ui-oil-track');
  const oilFill = el('div', 'ui-bar-fill ui-oil-fill');
  oilTrack.appendChild(oilFill);
  add(oil, oilHead, oilTrack);

  const xpRow = el('div', 'ui-xp');
  const xpLv = el('span', 'ui-xp-lv', 'Lv 1');
  const xpTrack = el('div', 'ui-bar ui-xp-track');
  const xpFill = el('div', 'ui-bar-fill ui-xp-fill');
  xpTrack.appendChild(xpFill);
  add(xpRow, xpLv, xpTrack);
  add(tl, hearts, oil, xpRow);
  hud.appendChild(tl);

  const boss = el('div', 'ui-boss');
  const bossTrack = el('div', 'ui-boss-track');
  const bossFill = el('div', 'ui-boss-fill');
  bossTrack.appendChild(bossFill);
  add(boss, el('div', 'ui-boss-name', '灯らぬもの'), bossTrack);
  hud.appendChild(boss);

  const tr = el('div', 'ui-tr ui-hud-block');
  const depthEl = el('div', 'ui-depth', '第1層');
  const scoreEl = el('div', 'ui-score', '000000');
  const timeEl = el('div', 'ui-time', '00:00');
  const tags = el('div', 'ui-tags');
  const autoTag = el('span', 'ui-tag', 'AUTO');
  const replayTag = el('span', 'ui-tag ui-tag-replay', 'REPLAY');
  autoTag.hidden = true;
  replayTag.hidden = true;
  add(tags, autoTag, replayTag);
  add(tr, depthEl, scoreEl, timeEl, tags);
  hud.appendChild(tr);

  const bl = el('div', 'ui-bl');
  const dash = el('div', 'ui-dash');
  const dashRing = el('div', 'ui-dash-ring');
  dashRing.style.setProperty('--ui-dash-angle', '0deg');
  const dashLabel = el('span', 'ui-dash-label', 'ダッシュ');
  add(dash, dashRing, dashLabel);
  bl.appendChild(dash);
  hud.appendChild(bl);

  const bc = el('div', 'ui-bc');
  const chips = el('div', 'ui-chips');
  bc.appendChild(chips);
  hud.appendChild(bc);

  const br = el('div', 'ui-br');
  const miniWrap = el('div', 'ui-minimap');
  const mini = document.createElement('canvas');
  mini.width = 168;
  mini.height = 120;
  mini.className = 'ui-minimap-canvas';
  mini.setAttribute('role', 'img');
  mini.setAttribute('aria-label', '周辺の地図');
  miniWrap.appendChild(mini);
  br.appendChild(miniWrap);
  hud.appendChild(br);
  let miniCtx = null;
  try {
    miniCtx = mini.getContext ? mini.getContext('2d') : null;
  } catch (err) {
    miniCtx = null;
  }

  // ---------------------------------------------------------------- タイトル
  const titleOverlay = el('div', 'ui-overlay ui-title-overlay');
  titleOverlay.setAttribute('role', 'dialog');
  titleOverlay.setAttribute('aria-modal', 'true');
  titleOverlay.setAttribute('aria-hidden', 'true');
  const titlePanel = el('div', 'ui-panel ui-title-panel');
  const titleInner = el('div', 'ui-title-inner');
  const logo = el('div', 'ui-logo', 'LANTERNFALL');
  const subtitle = el('div', 'ui-subtitle', '灯火の底');
  const premise = el('p', 'ui-premise', '油が尽きる前に、闇の底まで灯りを運べ。');
  const bestLine = el('div', 'ui-best');
  bestLine.hidden = true;
  const titleActions = el('div', 'ui-title-actions');
  const startBtn = el('button', 'ui-btn ui-btn-primary', 'はじめる');
  startBtn.type = 'button';
  const demoBtn = el('button', 'ui-btn', 'デモを見る');
  demoBtn.type = 'button';
  const replayBtn = el('button', 'ui-btn ui-btn-replay', '前回のリプレイ');
  replayBtn.type = 'button';
  replayBtn.hidden = true;
  add(titleActions, startBtn, demoBtn, replayBtn);

  const seedRow = el('label', 'ui-seed-row');
  const seedInput = el('input', 'ui-seed-input');
  seedInput.type = 'text';
  seedInput.placeholder = 'シード（空欄でランダム）';
  seedInput.setAttribute('inputmode', 'numeric');
  seedInput.setAttribute('autocomplete', 'off');
  seedInput.setAttribute('spellcheck', 'false');
  seedInput.maxLength = 40;
  add(seedRow, el('span', 'ui-seed-label', 'シード'), seedInput);

  const meta = el('div', 'ui-title-meta');
  const legendBox = el('section', 'ui-title-box');
  const legend = el('div', 'ui-legend');
  const legendLines = [
    'WASD 移動', 'マウス 照準', '左クリック 火花', 'Space ダッシュ',
    'E 階段', 'Esc ポーズ', 'M ミュート',
  ];
  for (const line of legendLines) legend.appendChild(el('span', 'ui-legend-item', line));
  add(legendBox, el('div', 'ui-box-title', '操作'), legend);

  const optionsBox = el('section', 'ui-title-box');
  const optionsGrid = el('div', 'ui-options');
  const sliderInputs = {};
  const sliderOutputs = {};
  const sliderDefs = [['master', '全体音量'], ['music', '音楽'], ['sfx', '効果音']];
  for (const [key, labelText] of sliderDefs) {
    const row = el('label', 'ui-opt');
    const input = el('input', 'ui-range');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = '0.8';
    const out = el('output', 'ui-opt-value', '80%');
    const sync = () => { out.textContent = `${Math.round(Number(input.value) * 100)}%`; };
    input.addEventListener('input', sync);
    input.addEventListener('change', () => {
      sync();
      call('setOption', key, Number(input.value));
    });
    sliderInputs[key] = input;
    sliderOutputs[key] = out;
    add(row, el('span', 'ui-opt-label', labelText), input, out);
    optionsGrid.appendChild(row);
  }
  const shakeRow = el('label', 'ui-opt ui-opt-check');
  const shakeInput = el('input', 'ui-check');
  shakeInput.type = 'checkbox';
  const shakeText = el('span', 'ui-opt-label', '画面の揺れ');
  shakeInput.addEventListener('change', () => call('setOption', 'shake', shakeInput.checked));
  add(shakeRow, shakeText, shakeInput);
  optionsGrid.appendChild(shakeRow);
  add(optionsBox, el('div', 'ui-box-title', '設定'), optionsGrid);
  add(meta, legendBox, optionsBox);

  const versionEl = el('div', 'ui-version');
  add(titleInner, logo, subtitle, premise, bestLine, titleActions, seedRow, meta, versionEl);
  titlePanel.appendChild(titleInner);
  titleOverlay.appendChild(titlePanel);
  root.appendChild(titleOverlay);

  // ---------------------------------------------------------------- 強化選択
  const upgradeOverlay = el('div', 'ui-overlay ui-upgrade-overlay');
  upgradeOverlay.setAttribute('role', 'dialog');
  upgradeOverlay.setAttribute('aria-modal', 'true');
  upgradeOverlay.setAttribute('aria-hidden', 'true');
  const upgradePanel = el('div', 'ui-panel ui-upgrade-panel');
  const upgradeHeading = el('h2', 'ui-upgrade-heading', '');
  const upgradeCardsWrap = el('div', 'ui-upgrade-cards');
  const upgradeHint = el('div', 'ui-upgrade-hint', '数字キー 1 / 2 / 3 でも選べる');
  add(upgradePanel, upgradeHeading, upgradeCardsWrap, upgradeHint);
  upgradeOverlay.appendChild(upgradePanel);
  root.appendChild(upgradeOverlay);

  // ---------------------------------------------------------------- ポーズ
  const pauseOverlay = el('div', 'ui-overlay ui-pause-overlay');
  pauseOverlay.setAttribute('role', 'dialog');
  pauseOverlay.setAttribute('aria-modal', 'true');
  pauseOverlay.setAttribute('aria-hidden', 'true');
  const pausePanel = el('div', 'ui-panel ui-pause-panel');
  const pauseHeading = el('h2', 'ui-panel-heading', '一時停止');
  const pauseActions = el('div', 'ui-menu-actions');
  const resumeBtn = el('button', 'ui-btn ui-btn-primary', 'つづける');
  resumeBtn.type = 'button';
  const restartBtn = el('button', 'ui-btn', '最初から');
  restartBtn.type = 'button';
  const titleBtn = el('button', 'ui-btn', 'タイトルへ');
  titleBtn.type = 'button';
  add(pauseActions, resumeBtn, restartBtn, titleBtn);
  const pauseSeedRow = el('div', 'ui-seed-inline');
  const pauseSeed = el('code', 'ui-seed-code', '0');
  const copyBtn = el('button', 'ui-btn ui-btn-small', 'コピー');
  copyBtn.type = 'button';
  add(pauseSeedRow, el('span', 'ui-seed-inline-label', 'シード'), pauseSeed, copyBtn);
  const ownedBox = el('div', 'ui-owned');
  const ownedList = el('div', 'ui-owned-list');
  add(ownedBox, el('div', 'ui-box-title', '所持した強化'), ownedList);
  add(pausePanel, pauseHeading, pauseActions, pauseSeedRow, ownedBox);
  pauseOverlay.appendChild(pausePanel);
  root.appendChild(pauseOverlay);

  // ---------------------------------------------------------------- リザルト
  const endOverlay = el('div', 'ui-overlay ui-end-overlay');
  endOverlay.setAttribute('role', 'dialog');
  endOverlay.setAttribute('aria-modal', 'true');
  endOverlay.setAttribute('aria-hidden', 'true');
  const endPanel = el('div', 'ui-panel ui-end-panel');
  const endHeading = el('h2', 'ui-end-heading', '');
  const endBadge = el('div', 'ui-newbest', '新記録！');
  endBadge.hidden = true;
  const endStats = el('div', 'ui-end-stats');
  const endUpgrades = el('div', 'ui-owned-list');
  const endActions = el('div', 'ui-menu-actions');
  const againBtn = el('button', 'ui-btn ui-btn-primary', 'もう一度');
  againBtn.type = 'button';
  const endTitleBtn = el('button', 'ui-btn', 'タイトルへ');
  endTitleBtn.type = 'button';
  const continueBtn = el('button', 'ui-btn ui-btn-continue', 'さらに深く');
  continueBtn.type = 'button';
  continueBtn.hidden = true;
  add(endActions, againBtn, endTitleBtn, continueBtn);
  const endSeedRow = el('div', 'ui-seed-inline');
  const endSeed = el('code', 'ui-seed-code', '0');
  add(endSeedRow, el('span', 'ui-seed-inline-label', 'シード'), endSeed);
  add(endPanel, endHeading, endBadge, endStats, el('div', 'ui-box-title', '手にした強化'), endUpgrades);
  add(endPanel, endActions, endSeedRow);
  endOverlay.appendChild(endPanel);
  root.appendChild(endOverlay);

  // ---------------------------------------------------------------- トースト / バナー
  const toastBox = el('div', 'ui-toasts');
  toastBox.setAttribute('aria-live', 'polite');
  root.appendChild(toastBox);

  const bannerEl = el('div', 'ui-banner');
  const bannerTitle = el('div', 'ui-banner-title', '');
  const bannerSub = el('div', 'ui-banner-sub', '');
  add(bannerEl, bannerTitle, bannerSub);
  root.appendChild(bannerEl);

  // ---------------------------------------------------------------- 状態
  let titleOpen = false;
  let upgradeOpen = false;
  let pauseOpen = false;
  let endOpen = false;
  let upgradeOpenedAt = 0;
  let upgradeLocked = false;
  let upgradeKey = '';
  let upgradeCards = [];
  let bannerToken = 0;
  let copyTimer = 0;

  const cache = {
    maxHp: -1, hp: -1, oilPct: -1, oilDanger: null, xpPct: -1, level: -1,
    depth: -1, score: '', time: '', auto: null, replay: null,
    bossOn: null, bossPct: -1, dashReady: null, dashPct: -1, chipSig: '',
  };

  const setOpen = (node, open) => {
    node.classList.toggle('open', open);
    node.setAttribute('aria-hidden', open ? 'false' : 'true');
  };

  function hideAllMenus() {
    titleOpen = false;
    upgradeOpen = false;
    pauseOpen = false;
    endOpen = false;
    setOpen(titleOverlay, false);
    setOpen(upgradeOverlay, false);
    setOpen(pauseOverlay, false);
    setOpen(endOverlay, false);
  }

  // ---------------------------------------------------------------- HUD 更新
  function ensureHearts(n) {
    if (heartSlots.length === n) return;
    hearts.textContent = '';
    heartSlots.length = 0;
    for (let i = 0; i < n; i++) {
      const slot = el('span', 'ui-heart empty');
      add(slot, makeHeartSvg('ui-heart-empty'), makeHeartSvg('ui-heart-fill'));
      hearts.appendChild(slot);
      heartSlots.push(slot);
    }
  }

  function upgradeSignature(up) {
    if (!up) return '';
    const parts = [];
    for (const u of UPGRADES) {
      const n = up[u.id] | 0;
      if (n > 0) parts.push(`${u.id}:${n}`);
    }
    return parts.join('|');
  }

  function rebuildChips(up) {
    chips.textContent = '';
    for (const u of UPGRADES) {
      const n = up ? (up[u.id] | 0) : 0;
      if (n <= 0) continue;
      const chip = el('span', `ui-chip ui-rarity-${u.rarity}`, `${u.name} ×${n}`);
      chips.appendChild(chip);
    }
  }

  function showHUD(visible) {
    hud.classList.toggle('ui-is-off', !visible);
    hud.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function updateHUD(G, extra) {
    if (!G || !G.player) return;
    const p = G.player;
    const stats = p.stats || {};
    const maxHp = Math.max(0, Math.round(Number(stats.maxHp) || 0));
    const hp = Math.max(0, Math.min(maxHp, Math.round(Number(p.hp) || 0)));
    const maxChanged = maxHp !== cache.maxHp;
    if (maxChanged) {
      cache.maxHp = maxHp;
      ensureHearts(Math.ceil(maxHp / 2));
    }
    const heartCount = Math.ceil(maxHp / 2);
    const hpShown = Math.max(0, Math.min(maxHp, hp));
    for (let i = 0; i < heartCount; i++) {
      const left = hpShown - i * 2;
      const state = left >= 2 ? 'full' : left === 1 ? 'half' : 'empty';
      const slot = heartSlots[i];
      if (slot && !slot.classList.contains(state)) {
        slot.classList.remove('full', 'half', 'empty');
        slot.classList.add(state);
      }
    }
    if (hp !== cache.hp || maxChanged) {
      cache.hp = hp;
      hearts.setAttribute('aria-label', `体力 ${hp} / ${maxHp}`);
    }

    const oilMax = Math.max(1, Number(stats.oilMax) || 1);
    const oilRatio = Math.max(0, Math.min(1, (Number(p.oil) || 0) / oilMax));
    const oilPct = Math.round(oilRatio * 100);
    const oilDanger = oilRatio < 0.2;
    if (oilPct !== cache.oilPct) {
      cache.oilPct = oilPct;
      oilFill.style.width = `${oilPct}%`;
      oilPctLabel.textContent = `${oilPct}%`;
    }
    if (oilDanger !== cache.oilDanger) {
      cache.oilDanger = oilDanger;
      oil.classList.toggle('is-danger', oilDanger);
    }

    const level = Math.max(1, p.level | 0 || 1);
    const xpNeed = Math.max(1, Number(p.xpNeed) || 1);
    const xpPct = Math.max(0, Math.min(100, Math.round((Number(p.xp) || 0) / xpNeed * 100)));
    if (xpPct !== cache.xpPct) {
      cache.xpPct = xpPct;
      xpFill.style.width = `${xpPct}%`;
    }
    if (level !== cache.level) {
      cache.level = level;
      xpLv.textContent = `Lv ${level}`;
    }

    const depth = G.depth | 0;
    if (depth !== cache.depth) {
      cache.depth = depth;
      depthEl.textContent = `第${depth}層`;
    }
    const score = String(Math.max(0, Math.floor(Number(G.score) || 0))).padStart(6, '0');
    if (score !== cache.score) {
      cache.score = score;
      scoreEl.textContent = score;
    }
    const time = fmtTime(G.time);
    if (time !== cache.time) {
      cache.time = time;
      timeEl.textContent = time;
    }

    const isAuto = !!(extra && extra.auto);
    const isReplay = !!(extra && extra.replay);
    if (isAuto !== cache.auto) {
      cache.auto = isAuto;
      autoTag.hidden = !isAuto;
    }
    if (isReplay !== cache.replay) {
      cache.replay = isReplay;
      replayTag.hidden = !isReplay;
    }

    let bossEnemy = null;
    if (Array.isArray(G.enemies)) {
      for (const e of G.enemies) {
        if (!e.dead && e.type === 'unlit') { bossEnemy = e; break; }
      }
    }
    const bossOn = !!bossEnemy;
    if (bossOn !== cache.bossOn) {
      cache.bossOn = bossOn;
      boss.classList.toggle('show', bossOn);
    }
    if (bossEnemy) {
      const bossMax = Math.max(1, Number(bossEnemy.maxHp) || 1);
      const frac = Math.max(0, Math.min(1, (Number(bossEnemy.hp) || 0) / bossMax));
      const pct = Math.round(frac * 1000) / 10;
      if (pct !== cache.bossPct) {
        cache.bossPct = pct;
        bossFill.style.width = `${pct}%`;
      }
    }

    const dashMax = Math.max(0.0001, Number(stats.dashCd) || 0.9);
    const remain = Math.max(0, Number(p.dashCd) || 0);
    const ready = remain <= 0.0001;
    const dashPct = ready ? 100 : Math.max(0, Math.min(100, Math.round((1 - remain / dashMax) * 100)));
    if (ready !== cache.dashReady) {
      cache.dashReady = ready;
      dash.classList.toggle('ready', ready);
    }
    if (dashPct !== cache.dashPct) {
      cache.dashPct = dashPct;
      dashRing.style.setProperty('--ui-dash-angle', `${Math.round(dashPct * 3.6)}deg`);
    }

    const up = p.up || {};
    const sig = upgradeSignature(up);
    if (sig !== cache.chipSig) {
      cache.chipSig = sig;
      rebuildChips(up);
    }
  }

  // ---------------------------------------------------------------- ミニマップ
  function drawMinimap(G) {
    if (!miniCtx) return;
    const W = 168;
    const H = 120;
    miniCtx.fillStyle = 'rgba(7, 6, 13, 0.78)';
    miniCtx.fillRect(0, 0, W, H);
    if (!G || !G.map || !G.seen) return;
    const m = G.map;
    const seen = G.seen;
    const tiles = m.tiles;
    if (!tiles || !m.w || !m.h) return;

    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const i = ty * m.w + tx;
        if (!seen[i]) continue;
        const t = tiles[i];
        if (t === 2) {
          miniCtx.fillStyle = '#5b5273';
          miniCtx.fillRect(tx * 2, ty * 2, 2, 2);
        } else if (t === 1 || t === 3) {
          miniCtx.fillStyle = '#3a3350';
          miniCtx.fillRect(tx * 2, ty * 2, 2, 2);
        }
      }
    }

    if (Array.isArray(m.rooms)) {
      for (const room of m.rooms) {
        if (!room) continue;
        const tint = room.state === 'cleared' ? '#6b5a3a' : room.state === 'active' ? '#7a2f3a' : null;
        if (!tint) continue;
        miniCtx.fillStyle = tint;
        const x0 = Math.max(0, room.x | 0);
        const y0 = Math.max(0, room.y | 0);
        const x1 = Math.min(m.w, (room.x | 0) + (room.w | 0));
        const y1 = Math.min(m.h, (room.y | 0) + (room.h | 0));
        for (let ty = y0; ty < y1; ty++) {
          for (let tx = x0; tx < x1; tx++) {
            const i = ty * m.w + tx;
            if (!seen[i] || tiles[i] !== 1) continue;
            miniCtx.fillRect(tx * 2, ty * 2, 2, 2);
          }
        }
      }
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (m.stairs && m.stairs.open) {
      // 明滅は色の濃淡で表し、点そのものは常に描く
      miniCtx.fillStyle = Math.floor(now / 420) % 2 === 0 ? '#6fa8ff' : '#35507a';
      miniCtx.fillRect((m.stairs.x | 0) * 2, (m.stairs.y | 0) * 2, 3, 3);
    }

    if (Array.isArray(m.rooms)) {
      for (const room of m.rooms) {
        if (!room || room.state !== 'idle') continue;
        if (room.role !== 'treasure' && room.role !== 'shrine') continue;
        const ci = (room.cy | 0) * m.w + (room.cx | 0);
        if (!seen[ci]) continue;
        miniCtx.fillStyle = '#c59bff';
        miniCtx.fillRect((room.cx | 0) * 2, (room.cy | 0) * 2, 3, 3);
      }
    }

    const px = Math.max(0, Math.min(m.w - 1, G.player ? G.player.x | 0 : 0));
    const py = Math.max(0, Math.min(m.h - 1, G.player ? G.player.y | 0 : 0));
    miniCtx.fillStyle = '#ffe9b0';
    miniCtx.fillRect(px * 2, py * 2, 3, 3);
  }

  // ---------------------------------------------------------------- タイトル
  function parseSeed() {
    const raw = seedInput.value.trim();
    if (!raw) return null;
    if (/^-?\d+$/.test(raw)) return Number(raw) >>> 0;
    return hashSeed(raw);
  }

  function openTitle(info) {
    hideAllMenus();
    const data = info || {};
    const best = data.best || null;
    if (best && Number.isFinite(Number(best.score)) && Number.isFinite(Number(best.depth))) {
      bestLine.textContent = `最高記録 ${Number(best.score)}点 / 第${Number(best.depth)}層`;
      bestLine.hidden = false;
    } else {
      bestLine.textContent = '';
      bestLine.hidden = true;
    }
    replayBtn.hidden = !data.hasReplay;
    const opts = data.options || {};
    for (const key of ['master', 'music', 'sfx']) {
      const value = opts[key];
      if (value === undefined || value === null) continue;
      const v = clamp01(value);
      sliderInputs[key].value = String(v);
      sliderOutputs[key].textContent = `${Math.round(v * 100)}%`;
    }
    if (opts.shake !== undefined) shakeInput.checked = !!opts.shake;
    const version = data.version ? String(data.version) : '';
    versionEl.textContent = version ? `ver. ${version}` : '';
    versionEl.hidden = !version;
    titleOpen = true;
    setOpen(titleOverlay, true);
  }

  function hideTitle() {
    titleOpen = false;
    setOpen(titleOverlay, false);
  }

  // ---------------------------------------------------------------- 強化
  function selectUpgrade(index) {
    if (!upgradeOpen || upgradeLocked) return;
    if (index < 0 || index >= upgradeCards.length) return;
    upgradeLocked = true;
    const card = upgradeCards[index];
    if (card) {
      card.classList.add('is-picked');
      for (const other of upgradeCards) other.disabled = true;
    }
    call('pick', index + 1);
  }

  function openUpgrade(pending, G) {
    if (!pending || !Array.isArray(pending.choices)) return;
    const up = G && G.player && G.player.up ? G.player.up : {};
    const key = `${pending.kind || 'level'}|${pending.choices.join(',')}|${upgradeSignature(up)}`;
    // 毎フレーム呼ばれてもカードを作り直さない
    if (upgradeOpen && key === upgradeKey) return;
    hideAllMenus();
    upgradeKey = key;
    upgradeLocked = false;
    upgradeOpenedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    upgradeHeading.textContent = pending.kind === 'relic'
      ? '遺物を見つけた'
      : '残り火が満ちた — ひとつ選べ';
    upgradeCardsWrap.textContent = '';
    upgradeCards = [];
    pending.choices.forEach((id, idx) => {
      const def = UPGRADE_BY_ID[id] || { id, name: String(id), desc: '', max: 1, rarity: 1 };
      const current = up[id] | 0;
      const max = Math.max(1, def.max | 0 || 1);
      const card = el('button', `ui-card ui-rarity-${def.rarity | 0 || 1}`);
      card.type = 'button';
      card.style.setProperty('--ui-card-i', String(idx));
      const top = el('div', 'ui-card-top');
      const key = el('span', 'ui-card-key', String(idx + 1));
      const name = el('span', 'ui-card-name', def.name);
      add(top, name, key);
      const desc = el('div', 'ui-card-desc', def.desc || '');
      const pipRow = el('div', 'ui-card-pips');
      for (let i = 0; i < max; i++) {
        let state = '';
        if (i < current) state = ' on';
        else if (i === current) state = ' next';
        pipRow.appendChild(el('span', `ui-pip${state}`, ''));
      }
      const levelText = el('div', 'ui-card-level', `${current} → ${Math.min(max, current + 1)}`);
      card.appendChild(top);
      card.appendChild(desc);
      card.appendChild(pipRow);
      card.appendChild(levelText);
      card.addEventListener('click', () => selectUpgrade(idx));
      upgradeCardsWrap.appendChild(card);
      upgradeCards.push(card);
    });
    upgradeOpen = true;
    setOpen(upgradeOverlay, true);
  }

  function hideUpgrade() {
    upgradeOpen = false;
    upgradeLocked = false;
    upgradeKey = '';
    setOpen(upgradeOverlay, false);
  }

  // ---------------------------------------------------------------- ポーズ
  function copyPauseSeed() {
    const text = pauseSeed.textContent || '';
    const finish = ok => {
      copyBtn.textContent = ok ? 'コピー済み' : 'コピー失敗';
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copyBtn.textContent = 'コピー'; }, 1500);
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => finish(true), () => finish(false));
      } else {
        finish(false);
      }
    } catch (err) {
      finish(false);
    }
  }

  function pauseOwnedList(G) {
    ownedList.textContent = '';
    const up = G && G.player && G.player.up ? G.player.up : {};
    let any = false;
    for (const u of UPGRADES) {
      const n = up[u.id] | 0;
      if (n <= 0) continue;
      any = true;
      ownedList.appendChild(el('span', `ui-owned-chip ui-rarity-${u.rarity}`, `${u.name} ×${n}`));
    }
    if (!any) ownedList.appendChild(el('span', 'ui-owned-empty', 'まだ強化はない'));
  }

  function openPause(G) {
    hideAllMenus();
    const seed = G && G.seed !== undefined && G.seed !== null ? G.seed >>> 0 : 0;
    pauseSeed.textContent = String(seed);
    copyBtn.textContent = 'コピー';
    pauseOwnedList(G);
    pauseOpen = true;
    setOpen(pauseOverlay, true);
  }

  function hidePause() {
    pauseOpen = false;
    setOpen(pauseOverlay, false);
  }

  // ---------------------------------------------------------------- リザルト
  function addEndStat(label, value) {
    endStats.appendChild(el('div', 'ui-end-stat-label', label));
    endStats.appendChild(el('div', 'ui-end-stat-value', String(value)));
  }

  function openEnd(result) {
    hideAllMenus();
    const r = result || {};
    const won = !!r.won;
    endHeading.textContent = won ? '闇は払われた' : '灯りは消えた';
    endHeading.classList.toggle('is-won', won);
    endBadge.hidden = !r.newBest;
    endStats.textContent = '';
    addEndStat('スコア', Math.max(0, Math.floor(Number(r.score) || 0)));
    addEndStat('到達', `第${Math.max(0, r.depth | 0)}層`);
    addEndStat('時間', fmtTime(r.time));
    addEndStat('討伐', Math.max(0, r.kills | 0));
    addEndStat('レベル', Math.max(1, r.level | 0 || 1));
    endUpgrades.textContent = '';
    const upgrades = Array.isArray(r.upgrades) ? r.upgrades : [];
    if (!upgrades.length) {
      endUpgrades.appendChild(el('span', 'ui-owned-empty', '強化なし'));
    } else {
      for (const u of upgrades) {
        if (!u) continue;
        const def = u.id ? UPGRADE_BY_ID[u.id] : null;
        const rarity = def ? def.rarity : 1;
        const name = u.name || (def && def.name) || String(u.id || '');
        const count = Math.max(1, u.count | 0 || 1);
        endUpgrades.appendChild(el('span', `ui-owned-chip ui-rarity-${rarity}`, `${name} ×${count}`));
      }
    }
    const seed = r.seed !== undefined && r.seed !== null ? r.seed >>> 0 : 0;
    endSeed.textContent = String(seed);
    continueBtn.hidden = !won;
    endOpen = true;
    setOpen(endOverlay, true);
  }

  function hideEnd() {
    endOpen = false;
    setOpen(endOverlay, false);
  }

  // ---------------------------------------------------------------- トースト / バナー
  function toast(text, kind) {
    const valid = kind === 'good' || kind === 'warn' || kind === 'boss' ? kind : 'info';
    while (toastBox.childElementCount >= 3) toastBox.firstElementChild.remove();
    const node = el('div', `ui-toast ui-toast-${valid}`, String(text));
    toastBox.appendChild(node);
    setTimeout(() => {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 2300);
  }

  function banner(title, subtitleText) {
    bannerTitle.textContent = String(title || '');
    bannerSub.textContent = String(subtitleText || '');
    bannerToken++;
    const token = bannerToken;
    bannerEl.classList.remove('show');
    // アニメーションを確実にやり直す
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
    setTimeout(() => {
      if (token === bannerToken) bannerEl.classList.remove('show');
    }, 2700);
  }

  function isMenuOpen() {
    return titleOpen || upgradeOpen || pauseOpen || endOpen;
  }

  // ---------------------------------------------------------------- 入力
  function onKeyDown(ev) {
    if (!ev || ev.defaultPrevented || ev.isComposing) return;
    if (upgradeOpen) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - upgradeOpenedAt < 350 || ev.repeat) return;
      let index = 0;
      if (ev.key === '1' || ev.code === 'Numpad1') index = 1;
      else if (ev.key === '2' || ev.code === 'Numpad2') index = 2;
      else if (ev.key === '3' || ev.code === 'Numpad3') index = 3;
      if (index > 0) {
        ev.preventDefault();
        selectUpgrade(index - 1);
      }
      return;
    }
    if (titleOpen && (ev.key === 'Enter' || ev.code === 'NumpadEnter') && !ev.repeat) {
      ev.preventDefault();
      if (document.activeElement === seedInput) {
        call('start', { seed: parseSeed(), auto: false });
      } else {
        call('start', { seed: null, auto: false });
      }
    }
  }

  startBtn.addEventListener('click', () => call('start', { seed: null, auto: false }));
  demoBtn.addEventListener('click', () => call('start', { seed: null, auto: true }));
  replayBtn.addEventListener('click', () => call('replay'));
  resumeBtn.addEventListener('click', () => call('resume'));
  restartBtn.addEventListener('click', () => call('restart'));
  titleBtn.addEventListener('click', () => call('toTitle'));
  copyBtn.addEventListener('click', copyPauseSeed);
  againBtn.addEventListener('click', () => call('restart'));
  endTitleBtn.addEventListener('click', () => call('toTitle'));
  continueBtn.addEventListener('click', () => call('resume'));
  window.addEventListener('keydown', onKeyDown);

  return {
    showTitle: openTitle,
    hideTitle,
    showHUD,
    updateHUD,
    drawMinimap,
    showUpgrade: openUpgrade,
    hideUpgrade,
    showPause: openPause,
    hidePause,
    showEnd: openEnd,
    hideEnd,
    toast,
    banner,
    isMenuOpen,
  };
}

// ブラウザ側のまとめ役。入力を集めてシミュレーションを進め、描画・音・UI に結果を渡す。
import { createGame, step, hashState, SIM_VERSION, BTN_FIRE, BTN_DASH, BTN_USE } from './sim/game.js';
import { createBot, botInput } from './sim/bot.js';
import { UPGRADE_BY_ID } from './sim/defs.js';
import { DT } from './sim/util.js';
import { packInputs, unpackInputs } from './core/replay.js';
import { createRenderer } from './render/renderer.js';
import { createUI } from './ui/ui.js';
import { createAudio } from './audio/audio.js';

const VERSION = '1.0.0';
const KEY_BEST = 'lanternfall.best', KEY_REPLAY = 'lanternfall.replay', KEY_OPT = 'lanternfall.options';
const MAX_REC = 60 * 60 * 40; // 録画は40分ぶんまで

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ } }

function boot() {
  const canvas = document.getElementById('game');
  let renderer;
  try { renderer = createRenderer(canvas); } catch (err) {
    const f = document.getElementById('fatal');
    f.style.display = 'flex';
    f.textContent = 'このブラウザでは WebGL2 が使えないため起動できません。\n' + err.message;
    return;
  }
  const audio = createAudio();
  const options = Object.assign({ master: 0.8, music: 0.6, sfx: 0.8, shake: true }, load(KEY_OPT, {}));
  let muted = false;

  // mode: title（デモが流れる）/ play / pause / end
  const S = {
    mode: 'title', G: null, source: 'bot', bot: null, rec: null, replay: null, replayAt: 0, seedFixed: false,
    acc: 0, last: 0, speed: 1, endTimer: 0, choice: 0, frames: 0, fps: 60, fpsT: 0, fpsN: 0, upgradeShown: false,
  };
  // tapped は「前のティック以降に一度でも押されたもの」。1フレームより短い入力を取りこぼさない。
  const keys = new Set(), tapped = new Set();
  const mouse = { x: 0, y: 0, down: false, right: false };
  const held = code => keys.has(code) || tapped.has(code);

  const ui = createUI(document.getElementById('ui'), {
    start({ seed, auto }) { audio.unlock(); newGame(seed, auto ? 'bot' : 'human'); },
    resume() {
      if (S.mode === 'pause') { ui.hidePause(); S.mode = 'play'; audio.setScene('game'); }
      else if (S.mode === 'end' && S.G && S.G.won && !S.G.over) { ui.hideEnd(); S.mode = 'play'; audio.setScene('game'); }
    },
    restart() { audio.unlock(); newGame(S.seedFixed ? S.G.seed : null, 'human'); },
    toTitle() { toTitle(); },
    pick(i) { S.choice = i; },
    replay() {
      const r = load(KEY_REPLAY, null);
      if (!r || r.v !== SIM_VERSION) { ui.toast('このリプレイは今の版では再生できません', 'warn'); return; }
      audio.unlock(); newGame(r.seed, 'replay', r);
    },
    setOption(key, value) { options[key] = value; save(KEY_OPT, options); audio.setVolumes(options); },
  });
  audio.setVolumes(options);

  function titleInfo() {
    const r = load(KEY_REPLAY, null);
    return { best: load(KEY_BEST, null), hasReplay: !!r && r.v === SIM_VERSION, options, version: VERSION };
  }
  function hideAll() { ui.hideTitle(); ui.hideUpgrade(); ui.hidePause(); ui.hideEnd(); S.upgradeShown = false; }

  function toTitle() {
    hideAll();
    S.mode = 'title'; S.source = 'bot'; S.speed = 1;
    S.G = createGame((Math.random() * 4294967296) >>> 0); S.bot = createBot(1, 0.9); S.rec = null;
    renderer.reset(); ui.showHUD(false); ui.showTitle(titleInfo()); audio.setScene('title');
  }

  function newGame(seed, source, replay = null) {
    hideAll();
    S.seedFixed = seed !== null && seed !== undefined && source === 'human';
    const s = seed === null || seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed >>> 0;
    S.G = createGame(s); S.mode = 'play'; S.source = source; S.acc = 0; S.endTimer = 0; S.choice = 0; S.speed = 1;
    S.bot = source === 'bot' ? createBot(s ^ 0x5bd1e995, 1) : null;
    S.rec = source === 'human' ? [] : null;
    S.replay = replay ? unpackInputs(replay.data) : null; S.replayAt = 0; S.replayHash = replay ? replay.hash : 0;
    renderer.reset(); ui.showHUD(true); audio.setScene('game');
    ui.banner('第1層', source === 'replay' ? 'リプレイ再生（Tab で速度切替）' : source === 'bot' ? 'デモ（bot が遊んでいます）' : '油が尽きる前に、闇の底へ');
  }

  function humanInput() {
    const G = S.G, p = G.player;
    let mx = 0, my = 0;
    if (held('KeyA') || held('ArrowLeft')) mx -= 1;
    if (held('KeyD') || held('ArrowRight')) mx += 1;
    if (held('KeyW') || held('ArrowUp')) my -= 1;
    if (held('KeyS') || held('ArrowDown')) my += 1;
    const l = Math.hypot(mx, my) || 1;
    const w = renderer.screenToWorld(mouse.x, mouse.y);
    renderer.setMouseWorld(w.x, w.y);
    const a = Math.atan2(w.y - p.y, w.x - p.x);
    let btn = 0;
    if (mouse.down || held('Mouse0') || held('KeyJ')) btn |= BTN_FIRE;
    if (held('Space') || held('ShiftLeft') || mouse.right || held('Mouse2')) btn |= BTN_DASH;
    if (held('KeyE') || held('KeyF')) btn |= BTN_USE;
    const choice = S.choice; S.choice = 0;
    tapped.clear();
    return {
      mx: Math.round((mx / l) * 127), my: Math.round((my / l) * 127),
      aim: Math.max(-32768, Math.min(32767, Math.round((a / Math.PI) * 32768))), btn, choice,
    };
  }

  function finish(won) {
    const G = S.G, p = G.player;
    const best = load(KEY_BEST, null);
    const human = S.source === 'human';
    const newBest = human && G.score > 0 && (!best || G.score > best.score);
    if (newBest) save(KEY_BEST, { score: G.score, depth: G.depth });
    if (human && S.rec && S.rec.length < MAX_REC) {
      save(KEY_REPLAY, { v: SIM_VERSION, seed: G.seed, hash: hashState(G), data: packInputs(S.rec) });
    }
    S.mode = 'end';
    audio.setScene(won ? 'win' : 'dead');
    ui.hideUpgrade(); S.upgradeShown = false;
    ui.showEnd({
      won, score: G.score, depth: G.depth, time: G.time, kills: G.stats.kills, level: p.level, seed: G.seed, newBest,
      upgrades: Object.keys(p.up).map(id => ({ id, name: UPGRADE_BY_ID[id].name, count: p.up[id] })),
    });
  }

  function tick() {
    const G = S.G;
    let inp;
    if (S.source === 'bot') inp = botInput(S.bot, G);
    else if (S.source === 'replay') {
      if (S.replayAt >= S.replay.length) {
        const ok = hashState(G) === S.replayHash;
        ui.toast(ok ? '再生終了 — 記録と状態が完全に一致' : '再生終了', ok ? 'good' : 'info');
        finish(G.won && !G.over);
        return false;
      }
      inp = S.replay[S.replayAt++];
    } else {
      if (G.pending) {
        if (!S.upgradeShown) { ui.showUpgrade(G.pending, G); S.upgradeShown = true; keys.clear(); tapped.clear(); mouse.down = false; }
        if (!S.choice) return false; // 選ぶまでシミュレーションを止める（入力も記録しない）
      }
      inp = humanInput();
      if (S.rec && S.rec.length < MAX_REC) S.rec.push(inp);
    }
    const hadPending = !!G.pending, wasWon = G.won;
    step(G, inp);
    if (hadPending && !G.pending && S.upgradeShown) { ui.hideUpgrade(); S.upgradeShown = false; }
    renderer.handleEvents(G.events, G);
    audio.onEvents(G.events, G);
    if (S.mode === 'title') return true;
    for (const e of G.events) {
      if (e.type === 'descend') ui.banner('第' + e.a + '層', e.a % 5 === 0 ? '何かが、灯りを待っている' : '');
      else if (e.type === 'roomStart' && e.a) ui.banner('灯らぬもの', '松明の火を絶やすな');
      else if (e.type === 'roomClear') ui.toast('部屋を照らした — 油 +22', 'good');
      else if (e.type === 'darkHunt') ui.toast('油が尽きた——闇が寄ってくる', 'warn');
      else if (e.type === 'bossPhase') ui.toast('松明が消えた！ 近づいて火を移せ', 'boss');
      else if (e.type === 'stairs') ui.toast('階段が開いた（E で降りる）', 'info');
      else if (e.type === 'shrine') ui.toast('祠の火が油と傷を満たした', 'good');
      else if (e.type === 'upgrade' && S.source !== 'human') ui.toast(UPGRADE_BY_ID[e.a].name + ' を得た', 'info');
    }
    if (G.won && !wasWon) { S.endTimer = 2.2; S.pendingWin = true; }
    if (G.over && S.endTimer <= 0) { S.endTimer = 1.6; S.pendingWin = false; }
    return true;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - S.last) / 1000 || 0);
    S.last = now;
    if (Math.abs(dt - DT) < 0.003) dt = DT; // 60Hz の画面ではちょうど1ティックずつ進める
    S.fpsT += dt; S.fpsN++;
    if (S.fpsT >= 0.5) { S.fps = Math.round(S.fpsN / S.fpsT); S.fpsT = 0; S.fpsN = 0; }
    const G = S.G, running = S.mode === 'play' || S.mode === 'title';
    if (running) {
      S.acc += dt * S.speed;
      let n = 0;
      while (S.acc >= DT && n < 8 * S.speed) { S.acc -= DT; n++; if (!tick()) { S.acc = 0; break; } }
      if (S.acc > DT * 4) S.acc = 0;
      if (S.endTimer > 0 && S.mode === 'play') {
        S.endTimer -= dt;
        if (S.endTimer <= 0) finish(S.pendingWin);
      }
      if (S.mode === 'title' && (S.G.over || S.G.won)) { S.G = createGame((Math.random() * 4294967296) >>> 0); S.bot = createBot(2, 0.9); renderer.reset(); }
    }
    if (S.source !== 'human' || S.mode !== 'play') renderer.setMouseWorld(S.G.player.x, S.G.player.y);
    renderer.update(S.mode === 'pause' ? 0 : dt, S.G);
    renderer.render(S.G, { dt, shake: options.shake, dim: S.mode === 'title' ? 0.55 : 1, noLook: S.source !== 'human' });
    if (S.mode !== 'title') {
      ui.updateHUD(S.G, { auto: S.source === 'bot', replay: S.source === 'replay', fps: S.fps });
      if (S.frames++ % 6 === 0) ui.drawMinimap(S.G);
    }
    audio.update(S.mode === 'title' ? null : G, dt);
  }

  // --- 入力
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    audio.unlock();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code); tapped.add(e.code);
    if (e.code === 'KeyM') { muted = !muted; audio.setMuted(muted); ui.toast(muted ? '消音' : '音あり', 'info'); }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (S.mode === 'play' && !S.upgradeShown) { S.mode = 'pause'; ui.showPause(S.G); audio.setScene('paused'); keys.clear(); }
      else if (S.mode === 'pause') { ui.hidePause(); S.mode = 'play'; audio.setScene('game'); }
    }
    if (e.code === 'Tab' && S.mode === 'play' && S.source !== 'human') {
      S.speed = S.speed >= 8 ? 1 : S.speed * 2;
      ui.toast('再生速度 ×' + S.speed, 'info');
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear(); mouse.down = false; mouse.right = false;
    if (S.mode === 'play' && S.source === 'human' && !S.upgradeShown) { S.mode = 'pause'; ui.showPause(S.G); audio.setScene('paused'); }
  });
  canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', e => {
    audio.unlock();
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (e.button === 0) mouse.down = true; else if (e.button === 2) mouse.right = true;
    tapped.add('Mouse' + e.button);
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; else if (e.button === 2) mouse.right = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // 動作確認用の窓口（自動テストがここから状態を読む）
  window.__lanternfall = {
    state: S, renderer, newGame, finish, hashState: () => hashState(S.G),
    // 描画を待たずに n ティック進める（条件 until を満たしたら止まる）
    skip(n, until) { for (let i = 0; i < n && S.mode === 'play'; i++) { if (!tick() || (until && until(S.G))) break; } return S.G.tick; },
  };

  toTitle();
  requestAnimationFrame(frame);
}

boot();

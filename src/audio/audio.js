// すべて実行時に合成する音響エンジン。外部素材は使わない。
const au_CHORDS = [
  [50, 53, 57, 60, 64], // Dm9
  [46, 50, 53, 57],     // Bbmaj7
  [43, 46, 50, 53],     // Gm7
  [45, 50, 52, 55],     // A7sus4
];
const au_WIN_CHORD = [50, 54, 57, 62, 66];
// 声・レイヤーの段で失われた音量をバスでまとめて補う。
const au_SFX_MAKEUP = 3.4;
const au_MUSIC_MAKEUP = 44;
// イベント種別ごとの最短間隔（秒）と声の寿命（秒）。
const au_EVENT_GAP = {
  shoot: 0.045, hit: 0.035, spark: 0.06, enemyShoot: 0.07, pickup: 0.04,
  bounce: 0.03, chain: 0.05, dash: 0.08, heal: 0.1, torch: 0.1,
};
const au_EVENT_VOICE = {
  shoot: 0.14, hit: 0.14, enemyDie: 0.34, bounce: 0.05, explode: 0.7,
  chain: 0.12, spark: 0.05, playerHurt: 0.32, death: 1.9, dash: 0.2,
  pickup: 0.22, levelUp: 0.52, upgrade: 0.7, roomStart: 2.0, roomClear: 0.8,
  wave: 0.7, calm: 1.5, stairs: 0.8, descend: 0.85, chest: 1.5, shrine: 1.5,
  torch: 0.5, spawn: 0.32, telegraph: 0.16, charge: 0.3, thud: 0.4,
  fuse: 0.36, summon: 0.7, enemyShoot: 0.13, bossPhase: 1.0, bossDie: 2.4,
  win: 2.3, heal: 0.4, darkHunt: 0.8,
};

function au_clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function au_mtof(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}
// 立ち上がり -> 指数減衰の短いエンベロープ。
function au_env(param, t0, dur, peak, attack) {
  const a = Math.min(Math.max(0.001, attack ?? 0.004), dur * 0.8);
  param.setValueAtTime(0.0001, t0);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
  param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  param.setValueAtTime(0, t0 + dur + 0.01);
}
function au_padEnv(param, t0, dur, peak, attack) {
  const a = Math.min(Math.max(0.1, attack), dur * 0.4);
  const rel = Math.max(0.25, dur * 0.35);
  param.setValueAtTime(0.0001, t0);
  param.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
  param.setValueAtTime(Math.max(0.0002, peak), t0 + dur - rel);
  param.exponentialRampToValueAtTime(0.0001, t0 + dur);
  param.setValueAtTime(0, t0 + dur + 0.02);
}
// 1 オシレーター + 任意のローパス + パン。停止時刻は必ず予約する。
function au_tone(c, dest, o) {
  const t0 = o.t ?? c.currentTime;
  const dur = Math.max(0.03, o.dur ?? 0.1);
  const pan = c.createStereoPanner();
  pan.pan.value = au_clamp(o.pan ?? 0, -1, 1);
  const gain = c.createGain();
  gain.connect(pan);
  pan.connect(dest);
  let tail = gain;
  if (o.lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(Math.max(30, o.lp), t0);
    f.Q.value = o.q ?? 0.7;
    f.connect(gain);
    tail = f;
  }
  const osc = c.createOscillator();
  osc.type = o.type || 'triangle';
  osc.frequency.setValueAtTime(Math.max(18, o.f0 ?? 440), t0);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(18, o.f1), t0 + dur);
  if (o.detune) osc.detune.value = o.detune;
  if (o.vib) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = o.vibRate ?? 7;
    lg.gain.value = o.vib;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.04);
  }
  osc.connect(tail);
  au_env(gain.gain, t0, dur, o.gain ?? 0.12, o.attack ?? 0.004);
  osc.start(t0);
  osc.stop(t0 + dur + 0.04);
}
// 共有ノイズバッファをフィルターへ通す短いバースト。
function au_noise(c, buf, dest, o) {
  if (!buf) return;
  const t0 = o.t ?? c.currentTime;
  const dur = Math.max(0.015, o.dur ?? 0.08);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = dur > 1.8;
  const filter = c.createBiquadFilter();
  filter.type = o.type || 'lowpass';
  filter.frequency.setValueAtTime(Math.max(40, o.f0 ?? 900), t0);
  if (o.f1 !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t0 + dur);
  filter.Q.value = o.q ?? 0.8;
  const pan = c.createStereoPanner();
  pan.pan.value = au_clamp(o.pan ?? 0, -1, 1);
  const gain = c.createGain();
  src.connect(filter);
  filter.connect(gain);
  gain.connect(pan);
  pan.connect(dest);
  au_env(gain.gain, t0, dur, o.gain ?? 0.08, o.attack ?? 0.002);
  const offset = src.loop ? 0 : Math.random() * Math.max(0, buf.duration - dur - 0.03);
  src.start(t0, offset);
  src.stop(t0 + dur + 0.04);
}

export function createAudio() {
  let ac = null, master = null, masterLP = null, sfxBus = null, musicBus = null, musicDuck = null;
  let noise = null, padGain = null, pluckGain = null, bassGain = null, drumGain = null, bossGain = null;
  const vol = { master: 1, music: 0.8, sfx: 0.9 };
  let muted = false, scene = 'title', active = [], padFilters = [];
  let pickupCombo = 0, pickupLast = -10;
  const last = Object.create(null);
  let layerLast = { pad: 0, pluck: 0, bass: 0, drums: 0, boss: 0 };
  const mus = {
    next: 0, step: 0, bar: 0, tempo: 84, intensity: 0,
    lcg: 0x1a2b3c4d, boss: false, lowOil: false, padCut: 720,
  };
  const TONE = o => au_tone(ac, sfxBus, o);
  const NOISE = o => au_noise(ac, noise, sfxBus, o);
  function au_applyVolumes() {
    if (!ac) return;
    const now = ac.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : vol.master, now, 0.04);
    sfxBus.gain.setTargetAtTime(vol.sfx * au_SFX_MAKEUP, now, 0.03);
    if (scene !== 'dead') {
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setTargetAtTime(vol.music, now, 0.08);
    }
  }
  function au_fadeMusic(seconds) {
    if (!ac) return;
    const now = ac.currentTime;
    const g = musicBus.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(0.0001, now + seconds);
  }
  function au_duckMusic(level, hold) {
    if (!ac) return;
    const now = ac.currentTime;
    const g = musicDuck.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(level, now, 0.02);
    g.setTargetAtTime(1, now + hold, 0.28);
  }
  function au_buildGraph() {
    master = ac.createGain();
    master.gain.value = vol.master;
    masterLP = ac.createBiquadFilter();
    masterLP.type = 'lowpass';
    masterLP.frequency.value = 18000;
    masterLP.Q.value = 0.7;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12;
    comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.2;
    master.connect(masterLP);
    masterLP.connect(comp);
    comp.connect(ac.destination);
    sfxBus = ac.createGain();
    sfxBus.gain.value = vol.sfx * au_SFX_MAKEUP;
    sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.gain.value = vol.music;
    musicDuck = ac.createGain(); musicDuck.gain.value = 1;
    musicBus.connect(musicDuck);
    musicDuck.connect(master);
    // 洞窟のような短いフィードバック残響。sfx だけを薄く送る。
    const roomIn = ac.createGain();
    const dA = ac.createDelay(0.3);
    const dB = ac.createDelay(0.3);
    const roomLP = ac.createBiquadFilter();
    const fb = ac.createGain();
    roomIn.gain.value = 0.18;
    dA.delayTime.value = 0.11;
    dB.delayTime.value = 0.17;
    roomLP.type = 'lowpass';
    roomLP.frequency.value = 1600;
    fb.gain.value = 0.25;
    sfxBus.connect(roomIn);
    roomIn.connect(dA);
    roomIn.connect(dB);
    dA.connect(roomLP);
    dB.connect(roomLP);
    roomLP.connect(fb);
    fb.connect(dA);
    fb.connect(dB);
    roomLP.connect(master);
    const layer = () => {
      const g = ac.createGain();
      g.gain.value = 0;
      g.connect(musicBus);
      return g;
    };
    padGain = layer(); pluckGain = layer(); bassGain = layer();
    drumGain = layer(); bossGain = layer();
    const len = Math.floor(ac.sampleRate * 2);
    noise = ac.createBuffer(1, len, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  function unlock() {
    if (ac) {
      if (ac.state === 'suspended') {
        try {
          const p = ac.resume();
          if (p && p.catch) p.catch(() => {});
        } catch {}
      }
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC();
      au_buildGraph();
    } catch {
      ac = null;
      return;
    }
    au_applyVolumes();
    au_setScene(scene);
    if (ac.state === 'suspended') {
      try {
        const p = ac.resume();
        if (p && p.catch) p.catch(() => {});
      } catch {}
    }
  }
  function setVolumes(v) {
    if (!v || typeof v !== 'object') return;
    if (Number.isFinite(v.master)) vol.master = au_clamp(v.master, 0, 1);
    if (Number.isFinite(v.music)) vol.music = au_clamp(v.music, 0, 1);
    if (Number.isFinite(v.sfx)) vol.sfx = au_clamp(v.sfx, 0, 1);
    if (ac) au_applyVolumes();
  }
  function setMuted(v) {
    muted = !!v;
    if (ac) au_applyVolumes();
  }
  function au_setScene(name) {
    if (!ac) return;
    const now = ac.currentTime;
    masterLP.frequency.cancelScheduledValues(now);
    masterLP.frequency.setTargetAtTime(name === 'paused' ? 360 : 18000, now, 0.12);
    if (name === 'dead') au_fadeMusic(2);
    else {
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setTargetAtTime(vol.music, now, 0.15);
      au_applyVolumes();
    }
    if (name === 'win') {
      mus.next = 0;
      mus.step = 0;
    }
  }
  function setScene(name) {
    if (name !== 'title' && name !== 'game' && name !== 'paused' && name !== 'dead' && name !== 'win') return;
    // 場面が変わったら小節の頭からやり直す（次の小節まで音楽が途切れるのを防ぐ）。ポーズの出入りでは続きから。
    if (name !== scene && name !== 'paused' && scene !== 'paused') { mus.step = 0; mus.next = 0; }
    scene = name;
    au_setScene(name);
  }
  function au_place(ev, G) {
    if (!G || !G.player || !Number.isFinite(ev.x) || !Number.isFinite(ev.y)) return { pan: 0, att: 1 };
    const dx = ev.x - G.player.x;
    const dy = ev.y - G.player.y;
    const dist = Math.hypot(dx, dy);
    return { pan: au_clamp(dx / 10, -1, 1), att: 1 / (1 + (dist / 9) * (dist / 9)) };
  }
  function au_voiceOK(dur, now) {
    let w = 0;
    for (let i = 0; i < active.length; i++) if (active[i] > now) active[w++] = active[i];
    active.length = w;
    if (w >= 24) return false;
    active.push(now + dur);
    return true;
  }
  function onEvents(events, G) {
    if (!ac || ac.state !== 'running' || !Array.isArray(events) || !events.length) return;
    try {
      const now = ac.currentTime + 0.004;
      for (const ev of events) {
        if (!ev || typeof ev.type !== 'string') continue;
        const dur = au_EVENT_VOICE[ev.type];
        if (!dur) continue;
        if (now - (last[ev.type] ?? -99) < (au_EVENT_GAP[ev.type] || 0)) continue;
        if (!au_voiceOK(dur, now)) continue;
        last[ev.type] = now;
        const place = au_place(ev, G);
        au_playEvent(ev, place.pan, place.att, now);
      }
    } catch {}
  }

  function au_playEvent(ev, pan, att, t) {
    const a = ev.a, b = ev.b;
    switch (ev.type) {
      case 'shoot': return au_sndShoot(b, pan, att, t);
      case 'hit': return au_sndHit(b, pan, att, t);
      case 'enemyDie': return au_sndEnemyDie(a, b, pan, att, t);
      case 'bounce': return au_sndTick(pan, att, t, 1900, 0.018);
      case 'explode': return au_sndExplode(a, pan, att, t);
      case 'chain': return au_sndChain(pan, att, t);
      case 'spark': return au_sndTick(pan, att, t, 2600, a === 1 ? 0.006 : 0.014);
      case 'playerHurt': return au_sndPlayerHurt(pan, att, t);
      case 'death': return au_sndDeath(pan, att, t);
      case 'dash': return au_sndDash(pan, att, t);
      case 'pickup': return au_sndPickup(a, pan, att, t);
      case 'levelUp': return au_sndLevelUp(pan, att, t);
      case 'upgrade': return au_sndUpgrade(pan, att, t);
      case 'roomStart': return au_sndRoomStart(a, pan, att, t);
      case 'roomClear': return au_sndRoomClear(pan, att, t);
      case 'wave': return au_sndWave(pan, att, t);
      case 'calm': return au_sndBell(392, pan, att, t, 1.4);
      case 'stairs': return au_sndStairs(pan, att, t);
      case 'descend': return au_sndDescend(pan, att, t);
      case 'chest': return au_sndBell(523.25, pan, att, t, 1.5);
      case 'shrine': return au_sndBell(440, pan, att, t, 1.5);
      case 'torch': return au_sndTorch(pan, att, t);
      case 'spawn': return au_sndSpawn(pan, att, t);
      case 'telegraph': return au_sndTelegraph(pan, att, t);
      case 'charge': return au_sndCharge(pan, att, t);
      case 'thud': return au_sndThud(a, pan, att, t);
      case 'fuse': return au_sndFuse(pan, att, t);
      case 'summon': return au_sndSummon(pan, att, t);
      case 'enemyShoot': return au_sndEnemyShoot(pan, att, t);
      case 'bossPhase': return au_sndBossPhase(a, pan, att, t);
      case 'bossDie': return au_sndBossDie(pan, att, t);
      case 'win': return au_sndWin(pan, att, t);
      case 'heal': return au_sndHeal(pan, att, t);
      case 'darkHunt': return au_sndDarkHunt(pan, att, t);
      default: return;
    }
  }
  function au_sndShoot(big, pan, att, t) {
    const f = (big === 1 ? 560 : 880) * (1 + (Math.random() * 0.08 - 0.04));
    TONE({ type: 'triangle', f0: f, f1: big === 1 ? 210 : 430, dur: big === 1 ? 0.12 : 0.06,
      gain: (big === 1 ? 0.12 : 0.075) * att, attack: 0.002, pan, t });
    NOISE({ type: 'highpass', f0: big === 1 ? 1400 : 2600, dur: 0.025,
      gain: (big === 1 ? 0.035 : 0.018) * att, attack: 0.001, pan, t });
  }
  function au_sndHit(b, pan, att, t) {
    NOISE({ type: 'lowpass', f0: 430, f1: 120, dur: 0.05, gain: 0.1 * att, attack: 0.001, pan, t });
    if (b === 1) TONE({ type: 'sine', f0: 1800, f1: 1500, dur: 0.09, gain: 0.045 * att, attack: 0.002, pan, t });
    else if (b === 2) NOISE({ type: 'highpass', f0: 3200, dur: 0.05, gain: 0.012 * att, attack: 0.001, pan, t });
  }
  function au_sndEnemyDie(type, r, pan, att, t) {
    if (type === 'urn') {
      NOISE({ type: 'bandpass', f0: 3000, f1: 2200, dur: 0.08, gain: 0.12 * att, q: 2.2, attack: 0.001, pan, t });
      TONE({ type: 'triangle', f0: 2400, f1: 1700, dur: 0.06, gain: 0.03 * att, attack: 0.001, pan, t });
      return;
    }
    const m = 1 / (1 + au_clamp(r ?? 0.35, 0.15, 2.5) * 0.9);
    TONE({ type: 'square', f0: 320 * m, f1: Math.max(30, 60 * m), dur: 0.18,
      gain: 0.055 * att, attack: 0.003, pan, t });
    NOISE({ type: 'lowpass', f0: 900, f1: 180, dur: 0.2, gain: 0.055 * att, attack: 0.002, pan, t });
  }
  function au_sndTick(pan, att, t, freq, gain) {
    TONE({ type: 'sine', f0: freq, f1: freq * 0.8, dur: 0.028, gain: gain * att, attack: 0.001, pan, t });
  }
  function au_sndExplode(r, pan, att, t) {
    const k = 0.6 + Math.min(1.4, au_clamp(r ?? 1, 0.5, 4) * 0.35);
    TONE({ type: 'sine', f0: 120, f1: 35, dur: 0.4, gain: 0.11 * k * att, attack: 0.004, pan, t });
    NOISE({ type: 'lowpass', f0: 700, f1: 90, dur: 0.35, gain: 0.09 * k * att, attack: 0.005, pan, t });
  }
  function au_sndChain(pan, att, t) {
    const osc = ac.createOscillator(), mod = ac.createOscillator();
    const mg = ac.createGain(), gain = ac.createGain(), panner = ac.createStereoPanner();
    panner.pan.value = au_clamp(pan, -1, 1);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.07);
    mod.frequency.value = 155;
    mg.gain.value = 380;
    mod.connect(mg);
    mg.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(sfxBus);
    au_env(gain.gain, t, 0.07, 0.055 * att, 0.002);
    osc.start(t); mod.start(t);
    osc.stop(t + 0.11); mod.stop(t + 0.11);
  }
  function au_sndPlayerHurt(pan, att, t) {
    TONE({ type: 'square', f0: 140, f1: 90, dur: 0.2, gain: 0.09 * att, attack: 0.002, pan, t });
    NOISE({ type: 'lowpass', f0: 520, f1: 180, dur: 0.2, gain: 0.075 * att, attack: 0.002, pan, t });
    au_duckMusic(0.3, 0.24);
  }
  function au_sndDeath(pan, att, t) {
    TONE({ type: 'sine', f0: 220, f1: 40, dur: 1.6, gain: 0.1 * att, attack: 0.02, pan, t });
    NOISE({ type: 'lowpass', f0: 800, f1: 90, dur: 1.5, gain: 0.05 * att, attack: 0.03, pan, t });
    au_fadeMusic(2);
  }
  function au_sndDash(pan, att, t) {
    NOISE({ type: 'bandpass', f0: 600, f1: 2400, dur: 0.16, gain: 0.055 * att, q: 1.2, attack: 0.01, pan, t });
  }
  function au_sndPickup(kind, pan, att, t) {
    kind = kind || 'xp';
    if (kind === 'xp') {
      const now = ac.currentTime;
      pickupCombo = now - pickupLast > 0.6 ? 0 : Math.min(12, pickupCombo + 1);
      pickupLast = now;
      const f = 660 * Math.pow(2, pickupCombo / 12);
      TONE({ type: 'sine', f0: f, f1: f * 1.01, dur: 0.1, gain: 0.042 * att, attack: 0.003, pan, t });
    } else if (kind === 'oil') {
      TONE({ type: 'sine', f0: 340, f1: 430, dur: 0.08, gain: 0.038 * att, attack: 0.004, pan, t });
      TONE({ type: 'sine', f0: 430, f1: 540, dur: 0.09, gain: 0.032 * att, attack: 0.004, pan, t: t + 0.075 });
    } else if (kind === 'heart') {
      TONE({ type: 'sine', f0: 523.25, dur: 0.34, gain: 0.04 * att, attack: 0.008, pan, t });
      TONE({ type: 'sine', f0: 659.25, dur: 0.34, gain: 0.033 * att, attack: 0.008, pan, t });
    }
  }
  function au_sndLevelUp(pan, att, t) {
    const notes = [62, 66, 69, 74];
    for (let i = 0; i < notes.length; i++) {
      TONE({ type: 'triangle', f0: au_mtof(notes[i]), dur: 0.3, gain: 0.045 * att, attack: 0.004,
        pan, t: t + i * 0.07 });
    }
  }
  function au_sndUpgrade(pan, att, t) {
    for (const n of [62, 66, 69, 74]) {
      TONE({ type: 'triangle', f0: au_mtof(n), dur: 0.55, gain: 0.024 * att, attack: 0.01, pan, t });
    }
  }
  function au_sndRoomStart(boss, pan, att, t) {
    NOISE({ type: 'lowpass', f0: 420, f1: 70, dur: 0.34, gain: 0.12 * att, attack: 0.002, pan, t });
    TONE({ type: 'sine', f0: 75, f1: 42, dur: 0.32, gain: 0.09 * att, attack: 0.002, pan, t });
    if (boss === 1) {
      TONE({ type: 'sawtooth', f0: 46, f1: 44, dur: 1.7, gain: 0.027 * att, attack: 0.8, lp: 170, pan, t });
      TONE({ type: 'sawtooth', f0: 49, f1: 47, dur: 1.7, gain: 0.023 * att, attack: 0.9, lp: 180, pan, t });
    }
  }
  function au_sndRoomClear(pan, att, t) {
    for (const n of [60, 64, 67]) {
      TONE({ type: 'triangle', f0: au_mtof(n), dur: 0.26, gain: 0.032 * att, attack: 0.004, pan, t });
    }
    for (const n of [62, 66, 69, 74]) {
      TONE({ type: 'triangle', f0: au_mtof(n), dur: 0.5, gain: 0.03 * att, attack: 0.006, pan, t: t + 0.2 });
    }
  }
  function au_sndWave(pan, att, t) {
    TONE({ type: 'sawtooth', f0: 110, f1: 116, dur: 0.52, gain: 0.05 * att, attack: 0.13, lp: 620, pan, t });
    TONE({ type: 'sawtooth', f0: 164.81, f1: 174, dur: 0.48, gain: 0.025 * att, attack: 0.15, lp: 750, pan, t });
  }
  function au_sndBell(base, pan, att, t, decay) {
    TONE({ type: 'sine', f0: base, dur: decay, gain: 0.042 * att, attack: 0.006, pan, t });
    TONE({ type: 'sine', f0: base * 2.76, dur: decay * 0.6, gain: 0.015 * att, attack: 0.004, pan, t });
    TONE({ type: 'sine', f0: base * 5.4, dur: decay * 0.35, gain: 0.006 * att, attack: 0.003, pan, t });
  }
  function au_sndStairs(pan, att, t) {
    const notes = [74, 78, 81, 86];
    for (let i = 0; i < notes.length; i++) {
      TONE({ type: 'sine', f0: au_mtof(notes[i]), dur: 0.32, gain: 0.027 * att, attack: 0.006,
        pan, t: t + i * 0.065 });
    }
  }
  function au_sndDescend(pan, att, t) {
    NOISE({ type: 'bandpass', f0: 2200, f1: 160, dur: 0.55, gain: 0.06 * att, q: 1.1, attack: 0.01, pan, t });
    TONE({ type: 'sine', f0: 90, f1: 30, dur: 0.45, gain: 0.075 * att, attack: 0.005, pan, t });
  }
  function au_sndTorch(pan, att, t) {
    NOISE({ type: 'lowpass', f0: 220, f1: 1400, dur: 0.35, gain: 0.055 * att, q: 0.9, attack: 0.08, pan, t });
    TONE({ type: 'sine', f0: 85, f1: 145, dur: 0.28, gain: 0.03 * att, attack: 0.05, pan, t });
  }
  function au_sndSpawn(pan, att, t) {
    NOISE({ type: 'bandpass', f0: 250, f1: 1600, dur: 0.16, gain: 0.05 * att, q: 1.4, attack: 0.12, pan, t });
    TONE({ type: 'sine', f0: 180, f1: 520, dur: 0.17, gain: 0.034 * att, attack: 0.12, pan, t });
  }
  function au_sndTelegraph(pan, att, t) {
    TONE({ type: 'square', f0: 1000, f1: 960, dur: 0.09, gain: 0.038 * att, attack: 0.002, pan, t });
  }
  function au_sndCharge(pan, att, t) {
    TONE({ type: 'sawtooth', f0: 80, f1: 200, dur: 0.25, gain: 0.05 * att, attack: 0.02, lp: 700, pan, t });
    NOISE({ type: 'bandpass', f0: 300, f1: 850, dur: 0.22, gain: 0.022 * att, q: 1.5, attack: 0.02, pan, t });
  }
  function au_sndThud(a, pan, att, t) {
    const k = 0.6 + au_clamp(a ?? 0.5, 0, 1) * 0.6;
    TONE({ type: 'sine', f0: 90, f1: 30, dur: 0.26, gain: 0.09 * k * att, attack: 0.002, pan, t });
    NOISE({ type: 'lowpass', f0: 320, f1: 80, dur: 0.2, gain: 0.06 * k * att, attack: 0.002, pan, t });
  }
  function au_sndFuse(pan, att, t) {
    for (let i = 0; i < 4; i++) {
      NOISE({ type: 'highpass', f0: 3200, dur: 0.018, gain: 0.025 * att, attack: 0.001, pan, t: t + i * 0.07 });
    }
  }
  function au_sndSummon(pan, att, t) {
    TONE({ type: 'sine', f0: 820, f1: 210, dur: 0.62, gain: 0.028 * att, attack: 0.02, vib: 65, vibRate: 13, pan, t });
    TONE({ type: 'sine', f0: 760, f1: 190, dur: 0.62, gain: 0.021 * att, attack: 0.02, vib: 55, vibRate: 11,
      detune: 7, pan, t });
  }
  function au_sndEnemyShoot(pan, att, t) {
    TONE({ type: 'triangle', f0: 300, f1: 150, dur: 0.09, gain: 0.045 * att, attack: 0.003, lp: 900, pan, t });
  }
  function au_sndBossPhase(phase, pan, att, t) {
    const f = 146.83 * (phase === 3 ? 0.94 : 1);
    const notes = [f, f * 1.06, f * 0.5, f * 1.5];
    for (let i = 0; i < notes.length; i++) {
      TONE({ type: 'sawtooth', f0: notes[i], f1: notes[i] * 0.995, dur: 0.9, gain: 0.024 * att,
        attack: 0.02, detune: i % 2 ? 7 : -7, lp: 950, pan, t });
    }
    NOISE({ type: 'lowpass', f0: 500, f1: 120, dur: 0.35, gain: 0.045 * att, attack: 0.003, pan, t });
  }
  function au_sndBossDie(pan, att, t) {
    NOISE({ type: 'lowpass', f0: 1200, f1: 180, dur: 2, gain: 0.075 * att, attack: 0.25, pan, t });
    const notes = [38, 50, 54, 57, 62, 66];
    for (let i = 0; i < notes.length; i++) {
      TONE({ type: 'triangle', f0: au_mtof(notes[i]), dur: 1.2, gain: 0.028 * att, attack: 0.05,
        pan, t: t + i * 0.18 });
    }
  }
  function au_sndWin(pan, att, t) {
    const notes = [50, 54, 57, 62, 66, 69];
    for (let i = 0; i < notes.length; i++) {
      TONE({ type: 'triangle', f0: au_mtof(notes[i]), dur: 0.72, gain: 0.035 * att, attack: 0.01,
        pan, t: t + i * 0.16 });
    }
  }
  function au_sndHeal(pan, att, t) {
    TONE({ type: 'sine', f0: 523.25, f1: 587.33, dur: 0.16, gain: 0.036 * att, attack: 0.008, pan, t });
    TONE({ type: 'sine', f0: 659.25, f1: 783.99, dur: 0.18, gain: 0.03 * att, attack: 0.008, pan, t: t + 0.09 });
  }
  function au_sndDarkHunt(pan, att, t) {
    NOISE({ type: 'bandpass', f0: 650, f1: 1200, dur: 0.75, gain: 0.017 * att, q: 2.2, attack: 0.2, pan, t });
    NOISE({ type: 'bandpass', f0: 1500, f1: 900, dur: 0.55, gain: 0.009 * att, q: 3, attack: 0.16,
      pan, t: t + 0.12 });
  }
  function au_hasBoss(G) {
    if (!G || !Array.isArray(G.enemies)) return false;
    for (const e of G.enemies) if (e && !e.dead && e.type === 'unlit') return true;
    return false;
  }
  function au_targetIntensity(G) {
    if (scene === 'title') return 0.12;
    if (scene === 'dead') return 0;
    if (scene === 'win') return 0.4;
    if (!G) return 0.15;
    let target = G.activeRoom >= 0 ? 0.75 : 0.15;
    if (au_hasBoss(G)) target = 1;
    if (G.player && G.player.hp <= 2) target += 0.15;
    return au_clamp(target, 0, 1);
  }
  function au_mixMusic() {
    if (!ac) return;
    const i = mus.intensity;
    let pad = 0, pluck = 0, bass = 0, drums = 0, boss = 0;
    if (scene === 'title') pad = 0.125;
    else if (scene === 'win') pad = 0.38;
    else if (scene !== 'dead') {
      pad = 0.115 + 0.1 * i;
      if (i > 0.25) pluck = 0.15 * Math.min(1, (i - 0.25) / 0.55);
      if (i > 0.4) bass = 0.14 * Math.min(1, (i - 0.4) / 0.45);
      if (i > 0.55) drums = 0.16 * Math.min(1, (i - 0.55) / 0.35);
      if (mus.boss && i > 0.5) boss = 0.1 * Math.min(1, (i - 0.5) / 0.4);
    }
    const nodes = { pad: padGain, pluck: pluckGain, bass: bassGain, drums: drumGain, boss: bossGain };
    const targets = { pad: pad * au_MUSIC_MAKEUP, pluck: pluck * au_MUSIC_MAKEUP, bass: bass * au_MUSIC_MAKEUP,
      drums: drums * au_MUSIC_MAKEUP, boss: boss * au_MUSIC_MAKEUP };
    const now = ac.currentTime;
    for (const k of Object.keys(targets)) {
      if (Math.abs(targets[k] - layerLast[k]) < 0.006) continue;
      nodes[k].gain.setTargetAtTime(targets[k], now, 0.5);
      layerLast[k] = targets[k];
    }
  }
  function au_updatePadDark() {
    const cut = mus.lowOil ? 330 : 720;
    if (Math.abs(cut - mus.padCut) < 1) return;
    mus.padCut = cut;
    if (!ac) return;
    padFilters = padFilters.filter(x => x.end > ac.currentTime);
    for (const x of padFilters) x.f.frequency.setTargetAtTime(cut, ac.currentTime, 0.6);
  }
  function au_scheduleMusic() {
    if (!ac || ac.state !== 'running') return;
    if (scene === 'dead') {
      mus.next = 0;
      return;
    }
    const now = ac.currentTime;
    if (!mus.next || mus.next < now - 0.3) mus.next = now + 0.05;
    let guard = 0;
    while (mus.next < now + 0.12 && guard++ < 20) {
      if (mus.step === 0) {
        mus.bar++;
        mus.tempo = mus.boss ? 96 : 84;
        au_schedulePad(mus.next, mus.tempo);
      }
      au_scheduleStep(mus.step, mus.next);
      mus.next += 60 / mus.tempo / 4;
      mus.step = (mus.step + 1) % 16;
    }
  }
  function au_schedulePad(t0, tempo) {
    const dur = (60 / tempo) * 4 * 1.4; // 次の小節の和音と少しだけ重ねてつなぐ
    const chord = scene === 'win' ? au_WIN_CHORD : au_CHORDS[(mus.bar - 1) % 4];
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = mus.padCut;
    lp.Q.value = 0.8;
    const lfo = ac.createOscillator();
    const lg = ac.createGain();
    lfo.frequency.value = 0.055 + (mus.bar % 3) * 0.012;
    lg.gain.value = 130;
    lfo.connect(lg);
    lg.connect(lp.frequency);
    const notes = [chord[0], chord[1] ?? chord[0], chord[3] ?? chord[2] ?? chord[0]];
    const detunes = [-7, 6, -4], levels = [0.65, 0.5, 0.38];
    for (let i = 0; i < notes.length; i++) {
      const osc = ac.createOscillator();
      osc.type = i === 2 ? 'triangle' : 'sawtooth';
      osc.frequency.value = au_mtof(notes[i]);
      osc.detune.value = detunes[i];
      const ng = ac.createGain();
      ng.gain.value = levels[i];
      const p = ac.createStereoPanner();
      p.pan.value = i === 0 ? -0.22 : i === 1 ? 0.2 : -0.05;
      osc.connect(ng);
      ng.connect(p);
      p.connect(lp);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
    const bus = ac.createGain();
    bus.gain.value = 0.0001;
    lp.connect(bus);
    bus.connect(padGain);
    au_padEnv(bus.gain, t0, dur, 0.16, 0.5);
    padFilters = padFilters.filter(x => x.end > ac.currentTime);
    padFilters.push({ f: lp, end: t0 + dur });
  }
  function au_scheduleStep(step, t) {
    if (scene === 'title' || scene === 'win' || scene === 'dead') return;
    const chord = au_CHORDS[(mus.bar - 1) % 4];
    const i = mus.intensity;
    if (i > 0.25 && step % 2 === 0) au_schedulePluck(t, chord);
    if (i > 0.4 && (step === 0 || step === 8)) au_scheduleBass(t, chord);
    if (i > 0.55) {
      if (step === 0 || step === 6 || step === 8 || step === 11) au_musicKick(t);
      au_musicHat(t, step % 2 === 0);
      if (step === 4 || step === 12) au_musicSnare(t);
    }
    if (mus.boss && step % 2 === 0) au_scheduleBoss(t, step);
    if (mus.lowOil && (step === 0 || step === 8)) au_heartbeat(t);
  }
  function au_schedulePluck(t, chord) {
    mus.lcg = (Math.imul(mus.lcg, 1664525) + 1013904223) >>> 0;
    const idx = (mus.lcg >>> 15) % chord.length;
    const octave = (mus.lcg & 0x80) ? 12 : 0;
    const f = au_mtof(chord[idx] + 12 + octave);
    const pan = (((mus.lcg >>> 8) & 31) / 31 - 0.5) * 0.7;
    au_tone(ac, pluckGain, { type: 'triangle', f0: f, f1: f * 0.998, dur: 0.28,
      gain: 0.055, attack: 0.004, pan, t });
  }
  function au_scheduleBass(t, chord) {
    const f = au_mtof(chord[0] - 12);
    au_tone(ac, bassGain, { type: 'sine', f0: f, f1: f * 0.995, dur: 0.36, gain: 0.055, attack: 0.005, pan: 0, t });
    au_tone(ac, bassGain, { type: 'sine', f0: f * 0.5, dur: 0.3, gain: 0.026, attack: 0.006, pan: 0, t });
  }
  function au_musicKick(t) {
    au_tone(ac, drumGain, { type: 'sine', f0: 110, f1: 40, dur: 0.18, gain: 0.1, attack: 0.002, pan: 0, t });
  }
  function au_musicHat(t, accent) {
    au_noise(ac, noise, drumGain, { type: 'highpass', f0: 6500, dur: 0.035,
      gain: accent ? 0.018 : 0.009, attack: 0.001, pan: accent ? -0.14 : 0.14, t });
  }
  function au_musicSnare(t) {
    au_noise(ac, noise, drumGain, { type: 'bandpass', f0: 1700, f1: 1200, dur: 0.11,
      gain: 0.035, q: 1.1, attack: 0.002, pan: 0.06, t });
    au_tone(ac, drumGain, { type: 'triangle', f0: 180, f1: 120, dur: 0.08,
      gain: 0.022, attack: 0.002, pan: 0.06, t });
  }
  function au_scheduleBoss(t, step) {
    const f = au_mtof([38, 39, 38, 44][(step / 2) % 4]);
    au_tone(ac, bossGain, { type: 'sawtooth', f0: f, f1: f * 0.997, dur: 0.24,
      gain: 0.045, attack: 0.004, lp: 420, pan: -0.15, t });
  }
  function au_heartbeat(t) {
    au_tone(ac, musicBus, { type: 'sine', f0: 55, f1: 40, dur: 0.15, gain: 0.05, attack: 0.008, pan: 0, t });
    au_tone(ac, musicBus, { type: 'sine', f0: 48, f1: 36, dur: 0.13, gain: 0.033, attack: 0.008, pan: 0, t: t + 0.2 });
  }
  function update(G, dt) {
    if (!ac || ac.state !== 'running') return;
    try {
      const d = Number.isFinite(dt) ? au_clamp(dt, 0.001, 0.1) : 0.016;
      mus.boss = au_hasBoss(G);
      const oilMax = G && G.player && G.player.stats ? G.player.stats.oilMax : 0;
      mus.lowOil = !!(G && G.player && oilMax > 0 && G.player.oil / oilMax < 0.2);
      const target = au_targetIntensity(G);
      const tau = scene === 'dead' ? 0.5 : 1.5;
      mus.intensity += (target - mus.intensity) * (1 - Math.exp(-d / tau));
      au_mixMusic();
      au_updatePadDark();
      au_scheduleMusic();
    } catch {}
  }
  return { unlock, setVolumes, setMuted, setScene, onEvents, update };
}

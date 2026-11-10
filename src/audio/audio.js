// 音はすべて Web Audio API で合成する（音声ファイルなし）。
// BGM はファミコン風の4声（パルス波の主旋律・パルス波の和音・三角波のベース・ノイズのドラム）で、
// 探索・戦闘・ボス・タイトルにそれぞれ曲を持ち、小節の頭で切り替える。
// 効果音は「アタック（短い雑音や高い音）＋本体（音程のある音）＋余韻」を重ね、鳴らすたびに音程を少し揺らす。

const au_NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 'D5' 'Bb4' 'C#6' → MIDI 番号。'-' は休符。
export function au_midi(name) {
  if (name === '-') return -1;
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return au_NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
const au_hz = n => 440 * Math.pow(2, (n - 69) / 12);
const au_CHORD = {
  Dm: ['D', 'F', 'A'], Bb: ['Bb', 'D', 'F'], F: ['F', 'A', 'C'], C: ['C', 'E', 'G'], Gm: ['G', 'Bb', 'D'],
  A: ['A', 'C#', 'E'], Eb: ['Eb', 'G', 'Bb'], Am: ['A', 'C', 'E'], D: ['D', 'F#', 'A'], G: ['G', 'B', 'D'],
};

// 曲データ。1小節 = 16分音符16個。lead は「音名:長さ」、drums は k=キック s=スネア h=ハット o=クラッシュ。
// 全曲に同じ動機（レ→ラ→レ→ファ）を置いて、場面が変わっても同じゲームの曲に聞こえるようにする。
export const AUDIO_TRACKS = {
  explore: {
    bpm: 96, duty: 0.25, leadVol: 0.17, arpVol: 0.065, bassVol: 0.38, drumVol: 0.5, arp: 'broken', echo: 0.3,
    chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'],
    lead: [
      'D5:4 A4:2 D5:2 F5:6 E5:2', 'D5:4 Bb4:2 D5:2 F5:4 G5:4', 'A5:6 G5:2 F5:4 C5:4', 'E5:4 D5:2 C5:2 E5:8',
      'D5:4 A4:2 D5:2 F5:6 E5:2', 'D5:4 F5:2 Bb5:2 A5:4 G5:4', 'G5:3 F5:3 D5:2 Bb4:4 D5:4', 'E5:6 C#5:2 A4:8',
    ],
    bass: ['1:6 1:2 5:4 1:4'],
    drums: ['k...h...k.h.h...', 'k...h...k.h.h.h.'],
  },
  combat: {
    bpm: 144, duty: 0.5, leadVol: 0.17, arpVol: 0.07, bassVol: 0.42, drumVol: 0.8, arp: 'stab', echo: 0.18,
    chords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A'],
    lead: [
      'D5:2 D5:1 F5:1 A5:2 D5:2 F5:2 A5:2 G5:2 F5:2', 'E5:2 E5:1 F5:1 G5:2 E5:2 D5:4 A4:4',
      'D5:2 D5:1 F5:1 Bb5:2 D5:2 F5:2 Bb5:2 A5:2 G5:2', 'E5:2 G5:2 C6:4 Bb5:2 G5:2 E5:4',
      'D5:2 D5:1 F5:1 A5:2 D5:2 F5:2 A5:2 D6:4', 'C6:2 A5:2 G5:2 F5:2 E5:2 F5:2 G5:4',
      'F5:3 G5:3 A5:2 Bb5:3 A5:3 G5:2', 'A5:4 G5:2 E5:2 C#5:4 E5:2 A5:2',
    ],
    bass: ['1:2 1:2 8:2 1:2 1:2 1:2 8:2 5:2'],
    drums: ['k.h.s.h.k.k.s.h.', 'k.h.s.h.k.k.s.hh', 'k.h.s.h.k.k.s.h.', 'k.h.s.hkk.k.s.ss'],
  },
  boss: {
    bpm: 160, duty: 0.25, leadVol: 0.17, arpVol: 0.07, bassVol: 0.44, drumVol: 0.85, arp: 'stab', echo: 0.15,
    chords: ['Dm', 'Eb', 'Dm', 'A', 'Dm', 'Eb', 'F', 'A'],
    lead: [
      'D5:2 A5:2 Ab5:2 A5:2 D5:2 F5:2 Eb5:2 D5:2', 'Eb5:2 Bb5:2 A5:2 Bb5:2 Eb5:2 G5:2 F5:2 Eb5:2',
      'D5:2 A5:2 Ab5:2 A5:2 D6:4 C6:2 Bb5:2', 'A5:2 C#6:2 E6:4 C#6:2 A5:2 E5:4',
      'D6:3 C6:3 Bb5:2 A5:3 G5:3 F5:2', 'Eb5:3 G5:3 Bb5:2 Eb6:4 D6:4',
      'C6:2 A5:2 F5:2 A5:2 C6:2 F6:2 E6:2 C6:2', 'C#6:2 A5:2 E5:2 A5:2 C#6:1 E6:1 A6:2 A5:4',
    ],
    bass: ['1:2 1:1 1:1 1:2 1:1 1:1 1:2 1:1 1:1 8:2 5:2'],
    drums: ['k.hhs.hhk.khs.hh', 'k.hhs.hhkkhhs.ss', 'k.hhs.hhk.khs.hh', 'kkhhs.hkk.kss.ss'],
  },
  title: {
    bpm: 80, duty: 0.125, leadVol: 0.11, arpVol: 0.045, bassVol: 0.24, drumVol: 0, arp: 'broken', echo: 0.4,
    chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'],
    lead: [
      'D5:8 A4:4 D5:4', 'F5:12 E5:4', 'A5:8 G5:4 F5:4', 'E5:12 C5:4',
      'D5:8 A4:4 D5:4', 'F5:8 Bb5:8', 'A5:6 G5:6 D5:4', 'E5:8 C#5:8',
    ],
    bass: ['1:8 5:8'],
    drums: ['................'],
  },
};

// 短い定型フレーズ（ジングル）。[音名, 開始(16分), 長さ(16分)]
const au_JINGLE = {
  win: { bpm: 132, notes: [['D5', 0, 2], ['F#5', 2, 2], ['A5', 4, 2], ['D6', 6, 4], ['B5', 10, 2], ['D6', 12, 2], ['F#6', 14, 2], ['A6', 16, 12]], chord: 'D' },
  dead: { bpm: 84, notes: [['A4', 0, 3], ['F4', 3, 3], ['E4', 6, 2], ['D4', 8, 4], ['C#4', 12, 4], ['D4', 16, 12]], chord: 'Dm' },
  clear: { bpm: 150, notes: [['D5', 0, 1], ['F#5', 1, 1], ['A5', 2, 1], ['D6', 3, 3], ['A5', 6, 1], ['D6', 7, 5]], chord: 'D' },
};

export function au_parseLine(line) {
  return line.split(' ').map(tok => { const [n, l] = tok.split(':'); return { n, len: Number(l) }; });
}

const au_GAP = { hit: 0.04, shoot: 0.05, enemyShoot: 0.07, pickup: 0.045, enemyDie: 0.04, bounce: 0.05, spawn: 0.11, telegraph: 0.1, explode: 0.06, chain: 0.05, torch: 0.1 };

export function createAudio() {
  let ac = null, master = null, lowpass = null, sfx = null, music = null, duck = null, echoIn = null, echoDelay = null, noiseBuf = null;
  const waves = {};
  const vol = { master: 0.8, music: 0.6, sfx: 0.8 };
  let muted = false, scene = 'title', voices = 0, combo = 0, comboT = -10;
  const last = Object.create(null);
  // seq: いま鳴っている曲と、小節の頭で切り替える予定の曲
  const seq = { track: null, want: 'title', next: 0, step: 0, quietUntil: 0 };

  function unlock() {
    const AC = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
    if (!AC) return;
    try {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.15;
      lowpass = ac.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 20000;
      master = ac.createGain(); master.gain.value = muted ? 0 : vol.master;
      master.connect(lowpass); lowpass.connect(comp); comp.connect(ac.destination);
      sfx = ac.createGain(); sfx.gain.value = vol.sfx; sfx.connect(master);
      music = ac.createGain(); music.gain.value = vol.music;
      duck = ac.createGain(); duck.gain.value = 1;
      // パルス波の高い倍音は耳に刺さるので、BGM 全体を少し丸める
      const soften = ac.createBiquadFilter(); soften.type = 'lowpass'; soften.frequency.value = 4800; soften.Q.value = 0.5;
      music.connect(duck); duck.connect(soften); soften.connect(master);
      // 主旋律だけにかける山びこ（残響の代わり。チップチューンの定番）
      echoIn = ac.createGain(); echoIn.gain.value = 0.3;
      echoDelay = ac.createDelay(1); echoDelay.delayTime.value = 0.3;
      const fb = ac.createGain(); fb.gain.value = 0.3;
      echoIn.connect(echoDelay); echoDelay.connect(fb); fb.connect(echoDelay); echoDelay.connect(music);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < d.length; i++) { s = (Math.imul(s, 1103515245) + 12345) | 0; d[i] = (s >> 16) / 32768; }
      // デューティ比つきのパルス波（倍音を 48 本で打ち切って、高音の折り返し雑音を防ぐ）
      for (const duty of [0.125, 0.25, 0.5]) {
        const re = new Float32Array(49), im = new Float32Array(49);
        for (let n = 1; n < 49; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
        waves[duty] = ac.createPeriodicWave(re, im);
      }
      if (ac.state === 'suspended') ac.resume();
    } catch { ac = null; }
  }
  const ready = () => !!ac && ac.state === 'running';

  function setVolumes(v) {
    if (!v) return;
    for (const k of ['master', 'music', 'sfx']) if (Number.isFinite(v[k])) vol[k] = Math.min(1, Math.max(0, v[k]));
    if (!ac) return;
    const t = ac.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : vol.master, t, 0.03);
    music.gain.setTargetAtTime(vol.music, t, 0.05); sfx.gain.setTargetAtTime(vol.sfx, t, 0.03);
  }
  function setMuted(m) { muted = !!m; if (ac) master.gain.setTargetAtTime(muted ? 0 : vol.master, ac.currentTime, 0.03); }

  // ---------------------------------------------------------------- 音の部品
  // 音程のある1音。o: { wave: 0.125|0.25|0.5|'triangle'|'square'|'sawtooth'|'sine', f0, f1, dur, vol, t, attack, steps, vib, pan }
  function tone(dest, o) {
    const t = o.t ?? ac.currentTime, dur = o.dur, osc = ac.createOscillator(), g = ac.createGain();
    if (typeof o.wave === 'number') osc.setPeriodicWave(waves[o.wave]); else osc.type = o.wave || 'square';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.steps) o.steps.forEach((f, i) => osc.frequency.setValueAtTime(f, t + i * o.stepDur)); // 高速アルペジオ
    else if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    if (o.vib && dur > 0.28) {
      const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.16);
      lg.gain.linearRampToValueAtTime(o.f0 * 0.012, t + 0.3);
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
    const a = o.attack ?? 0.003, v = o.vol;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    if (o.sustain !== undefined) { // 持続音: 少し減衰してから保ち、最後にすばやく切る
      g.gain.exponentialRampToValueAtTime(Math.max(0.0005, v * o.sustain), t + Math.min(dur * 0.5, 0.09));
      g.gain.setValueAtTime(Math.max(0.0005, v * o.sustain), t + Math.max(a + 0.001, dur - 0.02));
      g.gain.linearRampToValueAtTime(0, t + dur);
    } else g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    osc.connect(g);
    let out = g;
    if (o.pan) { const p = ac.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
    out.connect(dest);
    if (o.echo) out.connect(echoIn);
    osc.start(t); osc.stop(t + dur + 0.03);
    return osc;
  }
  // 雑音の1音。o: { type: 'lowpass'|'highpass'|'bandpass', f0, f1, q, dur, vol, t, attack, pan }
  function noise(dest, o) {
    const t = o.t ?? ac.currentTime, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = o.type || 'lowpass'; f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.vol, t + (o.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0005, t + o.dur);
    src.connect(f); f.connect(g);
    let out = g;
    if (o.pan) { const p = ac.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
    out.connect(dest);
    src.start(t, (t * 7.13) % 0.9); src.stop(t + o.dur + 0.03);
  }
  // 効果音が鳴る間だけ BGM を下げる
  function duckMusic(level, hold) {
    const t = ac.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setTargetAtTime(level, t, 0.015);
    duck.gain.setTargetAtTime(1, t + hold, 0.2);
  }
  function arpRun(names, step, o = {}) { // 音名の列を順に鳴らす短いフレーズ
    names.forEach((n, i) => tone(sfx, {
      wave: o.wave ?? 0.25, f0: au_hz(au_midi(n) + (o.shift ?? -12)), dur: i === names.length - 1 ? (o.last ?? step * 3) : step * 1.1, vol: o.vol ?? 0.2,
      t: ac.currentTime + i * step + (o.delay ?? 0), pan: o.pan, sustain: i === names.length - 1 ? 0.6 : undefined,
    }));
  }

  // ---------------------------------------------------------------- 効果音
  const FX = {
    shoot(e, k) {
      const r = 1 + (Math.random() - 0.5) * 0.08;
      if (e.b) { tone(sfx, { wave: 0.25, f0: 520 * r, f1: 130, dur: 0.13, vol: 0.2 * k.g, pan: k.pan }); noise(sfx, { type: 'bandpass', f0: 2400, f1: 500, dur: 0.09, vol: 0.16 * k.g, pan: k.pan }); }
      else { tone(sfx, { wave: 0.25, f0: 820 * r, f1: 300 * r, dur: 0.06, vol: 0.12 * k.g, pan: k.pan }); noise(sfx, { type: 'bandpass', f0: 2200, dur: 0.02, vol: 0.07 * k.g, pan: k.pan }); }
    },
    hit(e, k) {
      if (e.b === 2) return; // 燃焼の継続ダメージは無音（鳴らすとうるさい）
      const r = 1 + (Math.random() - 0.5) * 0.14;
      noise(sfx, { type: 'bandpass', f0: 1100 * r, f1: 300, q: 1.2, dur: 0.055, vol: 0.26 * k.g, pan: k.pan });
      tone(sfx, { wave: 'square', f0: 190 * r, f1: 85, dur: 0.05, vol: 0.13 * k.g, pan: k.pan });
      if (e.b === 1) tone(sfx, { wave: 0.25, f0: 988, f1: 1480, dur: 0.09, vol: 0.14 * k.g, pan: k.pan });
    },
    enemyDie(e, k) {
      if (e.a === 'urn') {
        noise(sfx, { type: 'bandpass', f0: 2200, q: 3, dur: 0.05, vol: 0.2 * k.g, pan: k.pan });
        noise(sfx, { type: 'bandpass', f0: 3000, q: 4, dur: 0.07, vol: 0.14 * k.g, t: ac.currentTime + 0.035, pan: k.pan });
        tone(sfx, { wave: 'triangle', f0: 880, f1: 380, dur: 0.07, vol: 0.12 * k.g, pan: k.pan });
        return;
      }
      const big = (e.b || 0.3) > 1, base = big ? 150 : 520 / (0.6 + (e.b || 0.35));
      noise(sfx, { type: 'lowpass', f0: big ? 1800 : 2600, f1: 180, dur: big ? 0.7 : 0.17, vol: (big ? 0.42 : 0.24) * k.g, pan: k.pan });
      tone(sfx, { wave: 0.5, f0: base, dur: big ? 0.5 : 0.13, vol: 0.16 * k.g, steps: [base, base * 0.75, base * 0.5, base * 0.37], stepDur: big ? 0.12 : 0.032, pan: k.pan });
    },
    explode(e, k) {
      const s = Math.min(1.5, 0.5 + (e.a || 1) * 0.35);
      noise(sfx, { type: 'highpass', f0: 3000, dur: 0.02, vol: 0.3 * k.g * s, pan: k.pan });
      tone(sfx, { wave: 'triangle', f0: 130, f1: 32, dur: 0.38, vol: 0.5 * k.g * s, pan: k.pan });
      noise(sfx, { type: 'lowpass', f0: 3200, f1: 140, dur: 0.42, vol: 0.38 * k.g * s, pan: k.pan });
      if (k.g > 0.5) duckMusic(0.6, 0.12);
    },
    chain(e, k) { tone(sfx, { wave: 'sawtooth', f0: 1600, dur: 0.075, vol: 0.1 * k.g, steps: [1000, 560, 1200, 440, 880, 320], stepDur: 0.012, pan: k.pan }); },
    bounce(e, k) { tone(sfx, { wave: 0.25, f0: 560, f1: 840, dur: 0.03, vol: 0.06 * k.g, pan: k.pan }); },
    playerHurt() {
      tone(sfx, { wave: 'square', f0: 240, f1: 62, dur: 0.26, vol: 0.34 });
      noise(sfx, { type: 'lowpass', f0: 2000, f1: 200, dur: 0.2, vol: 0.3 });
      tone(sfx, { wave: 0.25, f0: 466, dur: 0.16, vol: 0.14, steps: [466, 440, 415, 392], stepDur: 0.04 });
      duckMusic(0.3, 0.3);
    },
    death() { seq.track = null; seq.quietUntil = ac.currentTime + 60; jingle('dead'); noise(sfx, { type: 'lowpass', f0: 1500, f1: 80, dur: 1.2, vol: 0.3 }); },
    dash() { noise(sfx, { type: 'bandpass', f0: 500, f1: 3200, q: 1.5, dur: 0.14, vol: 0.22 }); tone(sfx, { wave: 'triangle', f0: 260, f1: 620, dur: 0.1, vol: 0.12 }); },
    pickup(e) {
      const t = ac.currentTime;
      if (e.a === 'xp') {
        combo = t - comboT < 0.7 ? Math.min(combo + 1, 14) : 0; comboT = t;
        const f = au_hz(69 + [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24][combo]); // レの短音階を1歩ずつ上がる
        tone(sfx, { wave: 0.25, f0: f, dur: 0.035, vol: 0.1 }); tone(sfx, { wave: 0.25, f0: f * 1.5, dur: 0.07, vol: 0.1, t: t + 0.035 });
      } else if (e.a === 'oil') {
        tone(sfx, { wave: 'triangle', f0: 380, f1: 760, dur: 0.07, vol: 0.26 }); tone(sfx, { wave: 'triangle', f0: 560, f1: 1120, dur: 0.1, vol: 0.24, t: t + 0.07 });
      } else arpRun(['C6', 'E6', 'G6', 'C7'], 0.045, { vol: 0.16, wave: 0.5 });
    },
    levelUp() { arpRun(['D5', 'F5', 'A5', 'D6', 'F6', 'A6'], 0.055, { vol: 0.2, last: 0.35 }); duckMusic(0.5, 0.45); },
    upgrade() { arpRun(['A5', 'D6'], 0.07, { vol: 0.2, wave: 0.5, last: 0.2 }); },
    roomStart(e) {
      tone(sfx, { wave: 'triangle', f0: 95, f1: 38, dur: 0.3, vol: 0.5 }); noise(sfx, { type: 'lowpass', f0: 900, f1: 120, dur: 0.25, vol: 0.34 });
      noise(sfx, { type: 'bandpass', f0: 2600, q: 5, dur: 0.06, vol: 0.14, t: ac.currentTime + 0.02 }); // 鉄格子の金属音
      if (e.a) arpRun(['D3', 'Eb3', 'D3', 'Ab2', 'D2'], 0.16, { vol: 0.3, wave: 0.25, last: 0.9, shift: 0 });
    },
    roomClear() { seq.track = null; seq.quietUntil = ac.currentTime + 1.3; jingle('clear'); },
    wave() { tone(sfx, { wave: 0.25, f0: 110, dur: 0.1, vol: 0.2, sustain: 0.7 }); tone(sfx, { wave: 0.25, f0: 110, dur: 0.16, vol: 0.22, sustain: 0.7, t: ac.currentTime + 0.14 }); },
    calm() { arpRun(['A5', 'D6', 'F6'], 0.09, { vol: 0.12, wave: 'triangle', last: 0.4 }); },
    shrine() { arpRun(['D5', 'A5', 'D6', 'F#6', 'A6'], 0.1, { vol: 0.18, wave: 'triangle', last: 0.7 }); },
    chest() { arpRun(['G5', 'B5', 'D6', 'G6', 'B6', 'D7'], 0.06, { vol: 0.18, wave: 0.125, last: 0.5 }); duckMusic(0.5, 0.5); },
    stairs() { arpRun(['D5', 'E5', 'F5', 'A5', 'D6', 'A6'], 0.06, { vol: 0.16, wave: 0.125, last: 0.4 }); },
    descend() { arpRun(['A5', 'F5', 'D5', 'A4', 'F4', 'D4'], 0.07, { vol: 0.18, wave: 0.25 }); tone(sfx, { wave: 'triangle', f0: 90, f1: 34, dur: 0.4, vol: 0.4, t: ac.currentTime + 0.42 }); },
    torch(e, k) { noise(sfx, { type: 'lowpass', f0: 300, f1: 2600, dur: 0.16, vol: 0.2 * k.g, attack: 0.03, pan: k.pan }); tone(sfx, { wave: 'triangle', f0: 220, f1: 330, dur: 0.12, vol: 0.12 * k.g, pan: k.pan }); },
    // 敵の出現: 闇が集まるような低いうなり → 実体化の短い打撃
    spawn(e, k) {
      const r = 1 + (Math.random() - 0.5) * 0.16, big = (e.a || 0.3) > 0.8 ? 0.6 : 1;
      noise(sfx, { type: 'lowpass', f0: 260, f1: 1100, dur: 0.16, vol: 0.2 * k.g, attack: 0.1, pan: k.pan });
      tone(sfx, { wave: 0.5, f0: 196 * r * big, f1: 92 * r * big, dur: 0.17, vol: 0.14 * k.g, attack: 0.02, pan: k.pan });
      tone(sfx, { wave: 'triangle', f0: 150 * big, f1: 55, dur: 0.1, vol: 0.3 * k.g, t: ac.currentTime + 0.13, pan: k.pan });
      noise(sfx, { type: 'bandpass', f0: 900, q: 1.5, dur: 0.045, vol: 0.16 * k.g, t: ac.currentTime + 0.13, pan: k.pan });
    },
    telegraph(e, k) { for (let i = 0; i < 2; i++) tone(sfx, { wave: 0.5, f0: 587, dur: 0.05, vol: 0.13 * k.g, sustain: 0.9, t: ac.currentTime + i * 0.08, pan: k.pan }); },
    charge(e, k) { tone(sfx, { wave: 'sawtooth', f0: 80, f1: 260, dur: 0.24, vol: 0.16 * k.g, pan: k.pan }); noise(sfx, { type: 'bandpass', f0: 400, f1: 1600, dur: 0.22, vol: 0.12 * k.g, pan: k.pan }); },
    thud(e, k) { tone(sfx, { wave: 'triangle', f0: 110, f1: 34, dur: 0.24, vol: 0.5 * k.g * (e.a || 0.5) + 0.1, pan: k.pan }); noise(sfx, { type: 'lowpass', f0: 1400, f1: 150, dur: 0.2, vol: 0.3 * k.g, pan: k.pan }); },
    fuse(e, k) { for (let i = 0; i < 4; i++) tone(sfx, { wave: 0.25, f0: 440 + i * 110, dur: 0.035, vol: 0.14 * k.g, t: ac.currentTime + i * 0.11, pan: k.pan }); },
    summon(e, k) { tone(sfx, { wave: 0.25, f0: 370, dur: 0.3, vol: 0.14 * k.g, steps: [370, 311, 370, 277, 311, 233, 277, 208], stepDur: 0.038, pan: k.pan }); },
    enemyShoot(e, k) { tone(sfx, { wave: 0.25, f0: 430, f1: 190, dur: 0.08, vol: 0.1 * k.g, pan: k.pan }); },
    bossPhase() {
      for (const n of ['D3', 'Eb3', 'A3']) tone(sfx, { wave: 0.25, f0: au_hz(au_midi(n)), dur: 0.9, vol: 0.2, sustain: 0.8 });
      noise(sfx, { type: 'highpass', f0: 3500, dur: 0.9, vol: 0.2 }); tone(sfx, { wave: 'triangle', f0: 70, f1: 30, dur: 0.6, vol: 0.5 });
      duckMusic(0.2, 0.9);
    },
    bossDie() {
      seq.track = null; seq.quietUntil = ac.currentTime + 2.4;
      noise(sfx, { type: 'lowpass', f0: 4000, f1: 100, dur: 1.8, vol: 0.4 });
      for (let i = 0; i < 6; i++) tone(sfx, { wave: 'triangle', f0: 140 - i * 14, f1: 30, dur: 0.3, vol: 0.4, t: ac.currentTime + i * 0.22 });
    },
    win() { seq.track = null; seq.quietUntil = ac.currentTime + 60; jingle('win', 2.2); },
    heal() { arpRun(['E6', 'A6'], 0.07, { vol: 0.14, wave: 'triangle', last: 0.2 }); },
    darkHunt() { for (let i = 0; i < 5; i++) tone(sfx, { wave: 'triangle', f0: 73.4, dur: 0.11, vol: 0.34, t: ac.currentTime + i * 0.13 }); },
  };

  function jingle(name, delay = 0) {
    const j = au_JINGLE[name], s = 60 / j.bpm / 4, t0 = ac.currentTime + 0.03 + delay, ch = au_CHORD[j.chord];
    for (const [n, at, len] of j.notes) tone(music, { wave: 0.25, f0: au_hz(au_midi(n) - 12), dur: len * s * 0.95, vol: 0.22, sustain: 0.7, t: t0 + at * s, vib: true, echo: true });
    const end = Math.max(...j.notes.map(x => x[1] + x[2]));
    for (let st = 0; st < end; st += 2) tone(music, { wave: 'triangle', f0: au_hz(au_midi(ch[(st >> 1) % 3 === 2 ? 2 : 0] + '2')), dur: s * 1.8, vol: 0.3, sustain: 0.8, t: t0 + st * s });
    if (name !== 'dead') noise(music, { type: 'highpass', f0: 5000, dur: 0.5, vol: 0.14, t: t0 });
  }

  function onEvents(events, G) {
    if (!ready() || !events || !events.length || scene === 'title') return; // タイトルのデモは BGM だけ
    const now = ac.currentTime;
    try {
      for (const e of events) {
        const fn = FX[e.type];
        if (!fn) continue;
        const gap = au_GAP[e.type];
        if (gap && now - (last[e.type] || -10) < gap) continue;
        let g = 1, pan = 0;
        if (G && G.player && Number.isFinite(e.x)) {
          const dx = e.x - G.player.x, d = Math.hypot(dx, e.y - G.player.y);
          g = 1 / (1 + (d / 9) * (d / 9)); pan = Math.max(-0.8, Math.min(0.8, dx / 12));
          if (g < 0.08) continue; // 遠すぎる音は鳴らさない
        }
        if (voices > 22 && gap) continue; // 鳴りすぎたら、頻度の高い音から間引く
        last[e.type] = now; voices++;
        setTimeout(() => { voices--; }, 180);
        fn(e, { g, pan });
      }
    } catch { /* 音の失敗でゲームを止めない */ }
  }

  // ---------------------------------------------------------------- BGM
  const compiled = {};
  function compile(name) { // 曲データを「16分音符ごとに何を鳴らすか」の表に直す
    if (compiled[name]) return compiled[name];
    const T = AUDIO_TRACKS[name], bars = T.lead.length, lead = [], bass = [];
    for (let b = 0; b < bars; b++) {
      let at = b * 16; // 主旋律は譜面より1オクターブ下で鳴らす
      for (const x of au_parseLine(T.lead[b])) { if (x.n !== '-') lead[at] = { f: au_hz(au_midi(x.n) - 12), len: x.len }; at += x.len; }
      const root = au_midi(au_CHORD[T.chords[b]][0] + '2');
      at = b * 16;
      for (const x of au_parseLine(T.bass[b % T.bass.length])) {
        const semi = x.n === '1' ? 0 : x.n === '5' ? 7 : x.n === '8' ? 12 : -1;
        if (semi >= 0) bass[at] = { f: au_hz(root + semi), len: x.len };
        at += x.len;
      }
    }
    return (compiled[name] = { T, bars, lead, bass });
  }

  function scheduleStep(c, step, t, s) {
    const T = c.T, bar = (step / 16) | 0, pos = step % 16, ch = au_CHORD[T.chords[bar]];
    const L = c.lead[step];
    if (L) tone(music, { wave: T.duty, f0: L.f, dur: Math.max(0.05, L.len * s * 0.92), vol: T.leadVol, sustain: 0.62, t, vib: true, echo: true, pan: -0.12 });
    const B = c.bass[step];
    if (B) tone(music, { wave: 'triangle', f0: B.f, dur: Math.max(0.05, B.len * s * 0.9), vol: T.bassVol, sustain: 0.85, t });
    if (T.arp === 'broken') { // 8分音符の分散和音
      if (pos % 2 === 0) {
        const n = ch[[0, 1, 2, 1, 0, 2, 1, 2][pos >> 1]], oct = pos % 8 === 6 ? '4' : '3';
        tone(music, { wave: 0.125, f0: au_hz(au_midi(n + oct)), dur: s * 1.7, vol: T.arpVol, t, pan: 0.3 });
      }
    } else if ('x..x..x.x..x..x.'[pos] === 'x') { // 和音を高速で回す「チップ和音」をリズムで刻む
      const f = ch.map(n => au_hz(au_midi(n + '3')));
      tone(music, { wave: 0.125, f0: f[0], dur: s * 1.6, vol: T.arpVol, t, steps: [f[0], f[1], f[2], f[0] * 2, f[1], f[2]], stepDur: (s * 1.6) / 6, pan: 0.3, sustain: 0.8 });
    }
    if (T.drumVol > 0) {
      const d = T.drums[bar % T.drums.length][pos], v = T.drumVol;
      if (d === 'k') { tone(music, { wave: 'triangle', f0: 160, f1: 42, dur: 0.11, vol: 0.55 * v, t }); noise(music, { type: 'lowpass', f0: 900, dur: 0.02, vol: 0.12 * v, t }); }
      else if (d === 's') { noise(music, { type: 'bandpass', f0: 1900, q: 0.7, dur: 0.12, vol: 0.3 * v, t }); tone(music, { wave: 'triangle', f0: 230, f1: 150, dur: 0.06, vol: 0.2 * v, t }); }
      else if (d === 'h') noise(music, { type: 'highpass', f0: 5500, dur: 0.03, vol: (pos % 4 === 2 ? 0.13 : 0.08) * v, t });
      if (step === 0) noise(music, { type: 'highpass', f0: 5200, dur: 0.5, vol: 0.12 * v, t }); // 曲の頭にクラッシュ
    }
  }

  function wantedTrack(G) {
    if (scene === 'title') return 'title';
    if (scene === 'dead' || scene === 'win' || !G) return null;
    for (const e of G.enemies) if (e.type === 'unlit' && !e.dead) return 'boss';
    return G.activeRoom >= 0 ? 'combat' : 'explore';
  }

  function update(G) {
    if (!ready()) return;
    try {
      const now = ac.currentTime, want = wantedTrack(G);
      if (now < 0.05) return; // 出力が動き出す前は時計が進まないので、予約を始めない
      if (now < seq.quietUntil) return; // ジングルが鳴り終わるまで BGM を止めておく
      if (!want) { seq.track = null; return; }
      // 別の曲へは小節の頭で切り替える（ボス戦だけは即座に）
      const cur = seq.track;
      if (cur !== want && (cur === null || seq.step % 16 === 0 || want === 'boss')) {
        if (cur !== null && seq.next > now + 0.25) return;
        seq.track = want; seq.step = 0; seq.quietUntil = 0;
        seq.next = Math.max(now + 0.06, cur === null ? 0 : seq.next);
        const T = AUDIO_TRACKS[want];
        echoDelay.delayTime.setValueAtTime((60 / T.bpm / 4) * 3, now); // 付点8分の山びこ
        echoIn.gain.setValueAtTime(T.echo, now);
        if (cur !== null && want !== 'title') { noise(music, { type: 'bandpass', f0: 1900, dur: 0.1, vol: 0.2, t: seq.next - 0.11 }); }
      }
      if (!seq.track) return;
      const c = compile(seq.track), s = 60 / c.T.bpm / 4;
      if (seq.next < now) seq.next = now + 0.03;
      let guard = 0;
      // 描画が遅いフレームでも音が途切れないよう、0.35 秒先まで予約しておく
      while (seq.next < now + 0.35 && guard++ < 48) {
        scheduleStep(c, seq.step, seq.next, s);
        seq.next += s; seq.step = (seq.step + 1) % (c.bars * 16);
        if (seq.step % 16 === 0 && wantedTrack(G) !== seq.track) break; // 小節の頭に来たら切り替えを優先
      }
    } catch { /* 音の失敗でゲームを止めない */ }
  }

  function setScene(name) {
    if (!['title', 'game', 'paused', 'dead', 'win'].includes(name)) return;
    const prev = scene;
    scene = name;
    if (!ac) return;
    const t = ac.currentTime;
    lowpass.frequency.setTargetAtTime(name === 'paused' ? 500 : 20000, t, 0.08); // ポーズ中はこもらせる
    if (name !== 'paused' && prev !== 'paused' && name !== prev) { seq.track = null; if (name === 'game' || name === 'title') seq.quietUntil = 0; }
  }

  return { unlock, setVolumes, setMuted, setScene, onEvents, update };
}

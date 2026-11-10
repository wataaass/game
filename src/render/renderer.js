// WebGL2 の描画エンジン（ライブラリなし）。
// 1) 低解像度のシーン（アルベド＋自発光）  2) 影つきライトを加算した光バッファ
// 3) 合成 → ブルーム → 色調整、の順に描く。
import { buildAtlas } from './atlas.js';
import { buildSegments, visPolygon } from './visibility.js';
import {
  BLUR_FS, BRIGHT_FS, DOWN_FS, FINAL_FS, FULL_VS, LIGHT_FS, LIGHT_VS, POINT_FS, POINT_VS, SCENE_FS, SCENE_VS, UP_FS,
} from './shaders.js';
import { T_FLOOR, T_WALL, T_DOOR } from '../sim/dungeon.js';
import { ENEMY } from '../sim/defs.js';
import { TORCH_RADIUS } from '../sim/combat.js';
import { TAU } from '../sim/util.js';

const VIEW_W = 416, VIEW_H = 234, SW = VIEW_W + 2, SH_ = VIEW_H + 2, TILES_X = VIEW_W / 16, TILES_Y = VIEW_H / 16;
const STRIDE = 16, MAX_SPR = 7000, MAX_PL = 400;
const THEMES = [[1.0, 0.93, 0.84], [0.82, 1.0, 0.86], [0.8, 0.92, 1.12], [1.12, 0.82, 0.76], [0.96, 0.8, 1.12]];
const ENEMY_COLOR = {
  mite: [0.75, 0.45, 0.9], spitter: [0.5, 0.9, 0.5], charger: [0.9, 0.5, 0.3], bomber: [1, 0.6, 0.2], shade: [0.4, 0.55, 1],
  weaver: [0.7, 0.45, 1], sentinel: [0.4, 0.9, 1], urn: [0.85, 0.65, 0.45], unlit: [0.8, 0.3, 0.5],
};

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace('[0]', ''); u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}
function texture(gl, w, h, internal, format, type, filter, data = null) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function target(gl, w, h, hdr, count = 1) {
  const fbo = gl.createFramebuffer(), tex = [];
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  for (let i = 0; i < count; i++) {
    const t = hdr ? texture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR) : texture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    tex.push(t);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  return { fbo, tex, w, h };
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 が使えません');
  const hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');

  const atlas = buildAtlas(), S = atlas.sprites;
  const atlasTex = texture(gl, atlas.size, atlas.size, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, atlas.pixels);
  const P = {
    scene: program(gl, SCENE_VS, SCENE_FS), light: program(gl, LIGHT_VS, LIGHT_FS),
    point: program(gl, POINT_VS, POINT_FS), blur: program(gl, FULL_VS, BLUR_FS),
    bright: program(gl, FULL_VS, BRIGHT_FS), down: program(gl, FULL_VS, DOWN_FS),
    up: program(gl, FULL_VS, UP_FS), final: program(gl, FULL_VS, FINAL_FS),
  };
  const LW = SW * 2, LH = SH_ * 2;
  const sceneT = target(gl, SW, SH_, false, 2);
  const lightA = target(gl, LW, LH, hdr), lightB = target(gl, LW, LH, hdr);
  const bloom = [];
  for (let i = 0, w = SW, h = SH_; i < 4; i++, w >>= 1, h >>= 1) bloom.push(target(gl, w, h, hdr));

  // --- 頂点配列
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
  const sprVAO = gl.createVertexArray(), sprBuf = gl.createBuffer();
  gl.bindVertexArray(sprVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, corner); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, sprBuf); gl.bufferData(gl.ARRAY_BUFFER, MAX_SPR * STRIDE * 4, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STRIDE * 4, i * 16); gl.vertexAttribDivisor(1 + i, 1);
  }
  const plVAO = gl.createVertexArray(), plBuf = gl.createBuffer();
  gl.bindVertexArray(plVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, corner); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, plBuf); gl.bufferData(gl.ARRAY_BUFFER, MAX_PL * 24, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 12); gl.vertexAttribDivisor(2, 1);
  const fanVAO = gl.createVertexArray(), fanBuf = gl.createBuffer();
  gl.bindVertexArray(fanVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, fanBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const fullVAO = gl.createVertexArray();
  gl.bindVertexArray(null);

  const lit = { d: new Float32Array(MAX_SPR * STRIDE), n: 0 }, glow = { d: new Float32Array(MAX_SPR * STRIDE), n: 0 };
  const pl = { d: new Float32Array(MAX_PL * 6), n: 0 };
  function spr(batch, s, x, y, w, h, r, g, b, a, rot = 0, emis = 0, wall = 0, flash = 0) {
    if (batch.n >= MAX_SPR) return;
    const d = batch.d, o = batch.n++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h;
    d[o + 4] = s.u; d[o + 5] = s.v; d[o + 6] = s.w; d[o + 7] = s.h;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    d[o + 12] = rot; d[o + 13] = emis; d[o + 14] = wall; d[o + 15] = flash;
  }
  function pointLight(x, y, R, r, g, b) {
    if (pl.n >= MAX_PL) return;
    const o = pl.n++ * 6;
    pl.d[o] = x; pl.d[o + 1] = y; pl.d[o + 2] = R; pl.d[o + 3] = r; pl.d[o + 4] = g; pl.d[o + 5] = b;
  }

  // --- 見た目だけの状態（シミュレーションには影響しない）
  const parts = [], flashes = [];
  const st = {
    camX: 0, camY: 0, camInit: false, shake: 0, hurt: 0, white: 0, fade: 0, time: 0, map: null, version: -1, segs: null,
    torchPoly: new Map(), tlx: 0, tly: 0, mouseX: 0, mouseY: 0, digitT: 0, digitN: 6,
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function part(x, y, vx, vy, ttl, size, c, o = {}) {
    if (parts.length > 2600) return;
    parts.push({ x, y, vx, vy, t: ttl, ttl, size, r: c[0], g: c[1], b: c[2], drag: o.drag ?? 3, grav: o.grav ?? 0, kind: o.kind ?? 0, grow: o.grow ?? 0, rot: o.rot ?? 0, w: o.w ?? 0 });
  }
  function burst(x, y, n, speed, c, ttl = 0.4, size = 0.22, o) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * rnd(0.25, 1);
      part(x, y, Math.cos(a) * s, Math.sin(a) * s, ttl * rnd(0.5, 1), size * rnd(0.6, 1.2), c, o);
    }
  }
  function ringFx(x, y, r0, r1, ttl, c) { part(x, y, 0, 0, ttl, r0 * 2, c, { kind: 1, grow: ((r1 - r0) * 2) / ttl, drag: 0 }); }
  function flashLight(x, y, R, c, ttl, shadow = false) { flashes.push({ x, y, R, r: c[0], g: c[1], b: c[2], t: ttl, ttl, shadow }); }
  function digits(x, y, value, c, size) {
    const str = String(Math.max(1, Math.round(value)));
    for (let i = 0; i < str.length; i++) {
      part(x + (i - (str.length - 1) / 2) * size * 0.8 + rnd(-0.1, 0.1), y - 0.4, 0, -1.6, 0.6, size, c, { kind: 2 + +str[i], drag: 2 });
    }
  }
  const FIRE = [1, 0.62, 0.25], HOT = [1, 0.9, 0.6], RED = [1, 0.25, 0.3], BLUE = [0.45, 0.7, 1], VIOLET = [0.75, 0.5, 1], GREEN = [0.5, 1, 0.65];

  function handleEvents(events, G) {
    const p = G.player;
    for (const e of events) {
      const near = Math.abs(e.x - p.x) < 20 && Math.abs(e.y - p.y) < 13;
      if (!near && e.type !== 'descend') continue;
      switch (e.type) {
        case 'shoot':
          flashLight(e.x, e.y, e.b ? 3.4 : 2.4, FIRE, 0.07);
          for (let i = 0; i < 2; i++) { const a = e.a + rnd(-0.5, 0.5); part(e.x, e.y, Math.cos(a) * rnd(3, 7), Math.sin(a) * rnd(3, 7), 0.18, 0.16, HOT); }
          break;
        case 'hit':
          if (e.b === 2) { if (st.digitT <= 0) { digits(e.x, e.y, e.a, FIRE, 0.28); st.digitT = 0.08; } break; }
          burst(e.x, e.y, e.b ? 9 : 4, e.b ? 9 : 6, e.b ? HOT : FIRE, 0.28, 0.2);
          // 数字が重なって読めなくならないよう、出す数に上限を設ける（会心は必ず出す）
          if (e.b || st.digitN >= 1) { st.digitN--; digits(e.x + rnd(-0.3, 0.3), e.y + rnd(-0.2, 0.2), e.a, e.b ? [1, 0.9, 0.3] : [0.8, 0.8, 0.8], e.b ? 0.4 : 0.28); }
          if (e.b) st.shake = Math.max(st.shake, 0.12);
          break;
        case 'enemyDie': {
          const c = ENEMY_COLOR[e.a] || FIRE, big = e.b > 1;
          burst(e.x, e.y, big ? 90 : 16, big ? 14 : 8, c, big ? 1.2 : 0.5, 0.3);
          burst(e.x, e.y, 6, 4, HOT, 0.35, 0.2);
          ringFx(e.x, e.y, e.b, e.b * 3.2, 0.3, c);
          flashLight(e.x, e.y, 3 + e.b * 3, c, 0.2);
          st.shake = Math.max(st.shake, 0.1 + e.b * 0.2);
          break;
        }
        case 'explode':
          burst(e.x, e.y, 34, 13, FIRE, 0.55, 0.36); burst(e.x, e.y, 14, 6, HOT, 0.4, 0.5);
          ringFx(e.x, e.y, 0.3, e.a * 1.15, 0.28, HOT);
          flashLight(e.x, e.y, e.a * 4.5, [1.4, 0.8, 0.35], 0.3, true);
          st.shake = Math.max(st.shake, 0.25 + e.a * 0.18);
          break;
        case 'chain': {
          const n = Math.ceil(Math.hypot(e.a - e.x, e.b - e.y) * 3.5);
          for (let i = 0; i <= n; i++) part(e.x + ((e.a - e.x) * i) / n + rnd(-0.14, 0.14), e.y + ((e.b - e.y) * i) / n + rnd(-0.14, 0.14), 0, 0, rnd(0.08, 0.16), 0.3, [0.7, 0.9, 1], { drag: 0 });
          flashLight(e.a, e.b, 2.4, BLUE, 0.1);
          break;
        }
        case 'spark': burst(e.x, e.y, 3, 4, e.a ? RED : FIRE, 0.22, 0.16); break;
        case 'bounce': burst(e.x, e.y, 2, 3, HOT, 0.15, 0.14); break;
        case 'playerHurt':
          st.shake = Math.max(st.shake, 0.6); st.hurt = 1;
          burst(e.x, e.y, 22, 9, RED, 0.5, 0.26); ringFx(e.x, e.y, 0.3, 2.6, 0.3, RED);
          break;
        case 'death': burst(e.x, e.y, 80, 12, FIRE, 1.4, 0.3); st.shake = 1; break;
        case 'dash':
          for (let i = 0; i < 9; i++) part(e.x - Math.cos(e.a) * i * 0.12 + rnd(-0.2, 0.2), e.y - Math.sin(e.a) * i * 0.12 + rnd(-0.2, 0.2), -Math.cos(e.a) * 2, -Math.sin(e.a) * 2, 0.28, 0.5, [0.5, 0.75, 1]);
          break;
        case 'pickup': burst(e.x, e.y, 4, 3, e.a === 'heart' ? RED : e.a === 'oil' ? [1, 0.8, 0.3] : FIRE, 0.25, 0.16); break;
        case 'levelUp':
          ringFx(e.x, e.y, 0.3, 5, 0.5, HOT); flashLight(e.x, e.y, 9, [0.6, 0.5, 0.3], 0.5);
          for (let i = 0; i < 30; i++) part(e.x + rnd(-0.6, 0.6), e.y + rnd(-0.2, 0.4), 0, rnd(-7, -2), rnd(0.4, 0.9), 0.24, HOT, { drag: 1 });
          break;
        case 'upgrade': ringFx(e.x, e.y, 0.3, 3, 0.35, HOT); break;
        case 'roomStart': st.shake = Math.max(st.shake, e.a ? 0.7 : 0.3); break;
        case 'roomClear': ringFx(e.x, e.y, 0.5, 11, 0.7, HOT); flashLight(e.x, e.y, 13, [0.5, 0.4, 0.25], 0.7); break;
        case 'torch': burst(e.x, e.y, 14, 4, FIRE, 0.5, 0.24, { grav: -4 }); flashLight(e.x, e.y, 4, FIRE, 0.3); break;
        case 'spawn': ringFx(e.x, e.y, e.a * 2.6, 0.1, 0.18, RED); burst(e.x, e.y, 8, 4, [0.8, 0.3, 0.5], 0.3, 0.2); break;
        case 'telegraph': ringFx(e.x, e.y, e.a * 0.5, e.a * 2.4, 0.25, RED); break;
        case 'charge': burst(e.x, e.y, 8, 5, [0.8, 0.6, 0.5], 0.3, 0.2); break;
        case 'thud': st.shake = Math.max(st.shake, 0.35 * (e.a || 0.5) + 0.2); burst(e.x, e.y, 16, 8, [0.8, 0.75, 0.7], 0.4, 0.22); ringFx(e.x, e.y, 0.3, 2.5, 0.25, [0.8, 0.75, 0.7]); break;
        case 'summon': ringFx(e.x, e.y, 0.3, 2.6, 0.35, VIOLET); burst(e.x, e.y, 10, 4, VIOLET, 0.4, 0.2); break;
        case 'enemyShoot': flashLight(e.x, e.y, 2.2, RED, 0.08); break;
        case 'bossPhase': st.shake = 1; st.white = 0.7; ringFx(e.x, e.y, 1, 16, 0.7, RED); burst(e.x, e.y, 60, 14, [0.5, 0.2, 0.6], 0.9, 0.34); break;
        case 'bossDie': st.shake = 1.4; st.white = 1; ringFx(e.x, e.y, 1, 20, 1.0, HOT); flashLight(e.x, e.y, 22, [1.5, 1.2, 0.8], 1.2); break;
        case 'descend': st.fade = 1; st.camInit = false; parts.length = 0; flashes.length = 0; break;
        case 'stairs': ringFx(e.x, e.y, 0.3, 4, 0.6, BLUE); burst(e.x, e.y, 20, 5, BLUE, 0.7, 0.22); break;
        case 'shrine': ringFx(e.x, e.y, 0.3, 5, 0.6, BLUE); burst(e.x, e.y, 30, 6, [0.7, 0.95, 1], 0.8, 0.24, { grav: -3 }); break;
        case 'chest': ringFx(e.x, e.y, 0.3, 4, 0.5, VIOLET); burst(e.x, e.y, 30, 7, [1, 0.85, 0.4], 0.8, 0.24); break;
        case 'heal': burst(e.x, e.y, 10, 3, GREEN, 0.5, 0.2, { grav: -3 }); break;
        case 'darkHunt': ringFx(e.x, e.y, 2, 0.2, 0.5, BLUE); break;
        case 'fuse': ringFx(e.x, e.y, 0.3, 2.0, 0.5, [1, 0.5, 0.2]); break;
        default: break;
      }
    }
  }

  function update(dt, G) {
    st.time += dt;
    st.shake = Math.max(0, st.shake - dt * 2.4); st.hurt = Math.max(0, st.hurt - dt * 2.2);
    st.white = Math.max(0, st.white - dt * 1.6); st.fade = Math.max(0, st.fade - dt * 1.4); st.digitT -= dt; st.digitN = Math.min(6, st.digitN + dt * 18);
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      q.t -= dt;
      if (q.t <= 0) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy = q.vy * k + q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.size += q.grow * dt;
      parts[n++] = q;
    }
    parts.length = n;
    n = 0;
    for (let i = 0; i < flashes.length; i++) { flashes[i].t -= dt; if (flashes[i].t > 0) flashes[n++] = flashes[i]; }
    flashes.length = n;
    if (!G) return;
    // 松明から立ちのぼる火の粉
    const m = G.map;
    for (const t of m.torches) {
      if (!t.lit || Math.abs(t.x - st.camX) > 17 || Math.abs(t.y - st.camY) > 10) continue;
      if (Math.random() < dt * 9) part(t.x - t.nx * 0.2 + rnd(-0.1, 0.1), t.y - t.ny * 0.2 - 0.3, rnd(-0.4, 0.4), rnd(-2.2, -1), rnd(0.4, 0.9), 0.17, FIRE, { drag: 0.5 });
    }
    for (const e of G.enemies) {
      if (e.burnT > 0 && Math.random() < dt * 14) part(e.x + rnd(-e.r, e.r), e.y + rnd(-e.r, e.r), 0, rnd(-3, -1.2), 0.4, 0.22, FIRE, { drag: 1 });
      if (e.elite && Math.random() < dt * 8) part(e.x + rnd(-e.r, e.r), e.y + rnd(-e.r, e.r), 0, rnd(-1.5, -0.5), 0.5, 0.18, [1, 0.85, 0.3], { drag: 1 });
    }
    for (const b of G.bullets) if (b.team === 0 && Math.random() < dt * 30) part(b.x, b.y, rnd(-0.6, 0.6), rnd(-0.6, 0.6), 0.2, b.big ? 0.3 : 0.17, FIRE);
    for (const s of G.shrines) if (!s.used && Math.random() < dt * 10) part(s.x + rnd(-0.3, 0.3), s.y - 0.3, 0, rnd(-2, -1), 0.6, 0.2, [0.6, 0.9, 1], { drag: 0.5 });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(2560, Math.max(320, Math.round(canvas.clientWidth * dpr))), h = Math.round((w * 9) / 16);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function screenToWorld(cx, cy) {
    const r = canvas.getBoundingClientRect();
    return { x: st.tlx + ((cx - r.left) / r.width) * TILES_X, y: st.tly + ((cy - r.top) / r.height) * TILES_Y };
  }

  function drawFan(poly, x, y, R, r, g, b, a) {
    gl.bufferData(gl.ARRAY_BUFFER, poly, gl.DYNAMIC_DRAW);
    gl.uniform3f(P.light.u.uLight, x, y, R); gl.uniform4f(P.light.u.uColor, r, g, b, a);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, poly.length / 2);
  }
  function flush(batch) {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.d.subarray(0, batch.n * STRIDE));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.n);
  }
  const quad = () => { gl.bindVertexArray(fullVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  function render(G, opt = {}) {
    resize();
    const m = G.map, p = G.player, t = st.time, theme = THEMES[(G.depth - 1) % THEMES.length];
    if (st.map !== m || st.version !== m.version) {
      st.map = m; st.version = m.version; st.segs = buildSegments(m); st.torchPoly.clear();
    }
    // --- カメラ: 照準の方向へ少し先を映す
    const ax = Math.max(-3, Math.min(3, (st.mouseX - p.x) * 0.16)), ay = Math.max(-2, Math.min(2, (st.mouseY - p.y) * 0.16));
    const tx = p.x + (opt.noLook ? 0 : ax), ty = p.y + (opt.noLook ? 0 : ay);
    if (!st.camInit) { st.camX = tx; st.camY = ty; st.camInit = true; }
    const ck = 1 - Math.exp(-(opt.dt || 0.016) * 7);
    st.camX += (tx - st.camX) * ck; st.camY += (ty - st.camY) * ck;
    const sh = opt.shake === false ? 0 : st.shake * st.shake * 0.45;
    const tlx = st.camX - TILES_X / 2 + Math.sin(t * 71) * sh, tly = st.camY - TILES_Y / 2 + Math.cos(t * 83) * sh;
    st.tlx = tlx; st.tly = tly;
    const camX = Math.floor(tlx * 16) / 16, camY = Math.floor(tly * 16) / 16, fx = (tlx - camX) * 16, fy = (tly - camY) * 16;

    lit.n = 0; glow.n = 0; pl.n = 0;
    // --- タイル
    const x0 = Math.max(0, Math.floor(camX) - 1), x1 = Math.min(m.w - 1, Math.floor(camX + TILES_X) + 2);
    const y0 = Math.max(0, Math.floor(camY) - 1), y1 = Math.min(m.h - 1, Math.floor(camY + TILES_Y) + 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * m.w + x, tile = m.tiles[i];
      if (!tile) continue;
      const hsh = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
      if (tile === T_FLOOR) spr(lit, S['floor' + (hsh % 4)], x + 0.5, y + 0.5, 1, 1, theme[0], theme[1], theme[2], 1);
      else if (tile === T_DOOR) {
        spr(lit, S.doorFloor, x + 0.5, y + 0.5, 1, 1, theme[0], theme[1], theme[2], 1);
        if (m.barred[i]) spr(lit, S.gate, x + 0.5, y + 0.5, 1, 1, 1, 1, 1, 1, 0, 0.35, 1);
      } else if (tile === T_WALL) {
        const below = y + 1 < m.h ? m.tiles[i + m.w] : 0, face = below === T_FLOOR || below === T_DOOR;
        spr(lit, S[(face ? 'wallFace' : 'wallTop') + (hsh % 2)], x + 0.5, y + 0.5, 1, 1, theme[0], theme[1], theme[2], 1, 0, 0, 1);
      }
    }
    // --- 置物
    const stairs = m.stairs;
    spr(lit, S.stairs, stairs.x, stairs.y, 1, 1, stairs.open ? 1 : 0.35, stairs.open ? 1 : 0.35, stairs.open ? 1 : 0.4, 1, 0, stairs.open ? 0.25 : 0);
    if (stairs.open) { spr(glow, S.glow, stairs.x, stairs.y, 2.6 + Math.sin(t * 3) * 0.3, 2.6 + Math.sin(t * 3) * 0.3, 0.25, 0.45, 0.9, 0.5); pointLight(stairs.x, stairs.y, 3.5, 0.2, 0.4, 0.9); }
    for (const c of G.chests) { const s = c.open ? S.chestOpen : S.chest; spr(lit, s, c.x, c.y - 0.1, 1, 14 / 16, 1, 1, 1, 1, 0, c.open ? 0.1 : 0.3); if (!c.open) pointLight(c.x, c.y, 2.6, 0.5, 0.35, 0.8); }
    for (const s of G.shrines) { spr(lit, s.used ? S.shrineUsed : S.shrine, s.x, s.y - 0.1, 1, 1, 1, 1, 1, 1, 0, s.used ? 0 : 0.5); if (!s.used) { pointLight(s.x, s.y, 4.5, 0.3, 0.6, 0.9); spr(glow, S.glow, s.x, s.y - 0.35, 1.5, 1.5, 0.3, 0.7, 1, 0.6); } }
    for (const tc of m.torches) {
      if (tc.x < camX - 2 || tc.x > camX + TILES_X + 2 || tc.y < camY - 2 || tc.y > camY + TILES_Y + 2) continue;
      const bx = tc.x - tc.nx * 0.3, by = tc.y - tc.ny * 0.3 - 0.15;
      spr(lit, tc.lit ? S.torchOn : S.torchOff, bx, by, 0.5, 10 / 16, 1, 1, 1, 1, 0, tc.lit ? 1 : 0);
      if (tc.lit) { const f = 1 + Math.sin(t * 13 + tc.x * 5) * 0.12; spr(glow, S.glow, bx, by - 0.2, 1.5 * f, 1.5 * f, 1, 0.55, 0.2, 0.7); }
      else if (tc.k > 0) spr(glow, S.ring, tc.x, tc.y, 1.2, 1.2, 1, 0.7, 0.3, tc.k * 2);
    }

    // --- 動くもの（奥から手前へ）
    const ents = [];
    for (const k of G.pickups) ents.push({ y: k.y, k });
    for (const e of G.enemies) ents.push({ y: e.y + e.r, e });
    ents.push({ y: p.y + p.r, p });
    ents.sort((a, b) => a.y - b.y);
    for (const it of ents) {
      if (it.k) {
        const k = it.k, bob = Math.sin(t * 5 + k.x * 3) * 0.06;
        if (k.kind === 'xp') { const s = 0.3 + k.v * 0.05; spr(lit, S.ember, k.x, k.y + bob, s, s, 1, 1, 1, 1, 0, 1); pointLight(k.x, k.y, 1.3, 0.5, 0.3, 0.1); }
        else if (k.kind === 'oil') { spr(lit, S.shadow, k.x, k.y + 0.3, 0.5, 0.25, 1, 1, 1, 0.6); spr(lit, S.oil, k.x, k.y + bob, 0.5, 10 / 16, 1, 1, 1, 1, 0, 0.6); pointLight(k.x, k.y, 1.8, 0.5, 0.4, 0.1); }
        else { spr(lit, S.heart, k.x, k.y + bob, 9 / 16, 0.5, 1, 1, 1, 1, 0, 0.7); pointLight(k.x, k.y, 1.8, 0.6, 0.15, 0.2); }
        continue;
      }
      if (it.e) {
        const e = it.e, def = ENEMY[e.type], base = e.type === 'unlit' ? 2.5 : 1, sc = (e.r / def.r) * base;
        if (e.spawnT > 0) {
          const k = 1 - Math.min(1, e.spawnT / 1.2), rr = e.r * (3.2 - 2.2 * k);
          spr(glow, S.ring, e.x, e.y, rr * 2, rr * 2, 1, 0.25, 0.3, 0.3 + 0.6 * k);
          spr(glow, S.glow, e.x, e.y, e.r * 3 * k, e.r * 3 * k, 1, 0.2, 0.3, 0.7 * k);
          continue;
        }
        const frame = def.prop ? 0 : (Math.floor(t * 6 + e.id) & 1);
        let alpha = 1, flash = e.flash > 0 ? 1 : 0;
        if (e.type === 'shade') alpha = Math.max(0.16, Math.min(1, 0.16 + e.lit * 1.4));
        if (e.type === 'bomber' && e.state === 'fuse') flash = Math.floor(t * 20) & 1;
        if (e.invuln > 0 && (Math.floor(t * 16) & 1)) alpha *= 0.5;
        let cr = 1, cg = 1, cb = 1;
        if (e.elite) { cr = 1.25; cg = 1.1; cb = 0.7; }
        if (e.burnT > 0) { cr *= 1.3; cg *= 0.85; cb *= 0.6; }
        if (e.stun > 0) { cr *= 0.7; cg *= 0.7; cb *= 0.9; }
        spr(lit, S.shadow, e.x, e.y + e.r * 0.85, e.r * 2.3, e.r * 0.9, 1, 1, 1, 0.8 * alpha);
        const wob = e.state === 'wind' ? Math.sin(t * 60) * 0.04 : 0;
        spr(lit, S[e.type + frame], e.x + wob, e.y - 0.12 * sc, sc * e.face, sc, cr, cg, cb, alpha, 0, e.type === 'unlit' ? 0.25 : e.type === 'sentinel' ? 0.2 : 0.06, 0, flash);
        if (e.state === 'wind') {
          const len = def.boss ? 15 : 8, w = def.boss ? 0.5 : 0.22, a = 0.35 + 0.35 * Math.sin(t * 40);
          spr(glow, S.white, e.x + Math.cos(e.ang) * len / 2, e.y + Math.sin(e.ang) * len / 2, len, w, 1, 0.15, 0.2, a, e.ang);
        }
        if (e.state === 'aim') spr(glow, S.glow, e.x, e.y, 1.6, 1.6, 1, 0.2, 0.3, 0.8);
        if (e.elite) spr(glow, S.glow, e.x, e.y, e.r * 4.4, e.r * 4.4, 1, 0.75, 0.2, 0.22);
        if (def.boss) pointLight(e.x, e.y, 5, 0.5, 0.1, 0.2);
        if (e.hp < e.maxHp && !def.boss && !def.prop) {
          const w = e.r * 2, f = Math.max(0, e.hp / e.maxHp);
          spr(glow, S.white, e.x - w / 2 + (w * f) / 2, e.y - e.r - 0.42 * sc, w * f, 0.07, 1, 0.25, 0.3, 0.9);
        }
        continue;
      }
      // プレイヤー
      const face = Math.cos(p.aim) >= 0 ? 1 : -1, frame = p.moving ? Math.floor(t * 9) & 1 : 0;
      const blink = p.inv > 0 && p.dashT <= 0 && (Math.floor(t * 18) & 1) ? 0.35 : 1;
      spr(lit, S.shadow, p.x, p.y + 0.3, 0.75, 0.3, 1, 1, 1, 0.8);
      spr(lit, S['player' + frame], p.x, p.y - 0.18, face, 1, 1, 1, 1, blink, 0, 0.12, 0, st.hurt > 0.8 ? 1 : 0);
      const fl = 1 + Math.sin(t * 17) * 0.06 + Math.sin(t * 7.3) * 0.05;
      spr(glow, S.glow, p.x + 0.3 * face, p.y, 1.5 * fl, 1.5 * fl, 1, 0.65, 0.25, 0.55);
      for (let i = 0; i < p.stats.orbitals; i++) {
        const a = p.orbA + (i * TAU) / p.stats.orbitals, ox = p.x + Math.cos(a) * 1.35, oy = p.y + Math.sin(a) * 1.35;
        spr(glow, S.glow, ox, oy, 0.9, 0.9, 0.7, 1, 0.4, 1); spr(glow, S.glow, ox, oy, 0.35, 0.35, 1, 1, 1, 1);
        pointLight(ox, oy, 1.8, 0.3, 0.5, 0.15);
      }
    }
    // --- 弾
    for (const b of G.bullets) {
      const a = Math.atan2(b.vy, b.vx);
      if (b.team === 0) {
        const c = b.crit ? [1, 0.95, 0.5] : [1, 0.6, 0.22];
        spr(glow, S.glow, b.x, b.y, b.r * 9, b.r * 4.5, c[0], c[1], c[2], 0.95, a);
        spr(glow, S.glow, b.x, b.y, b.r * 3.4, b.r * 2.6, 1, 1, 0.9, 1, a);
        pointLight(b.x, b.y, b.big ? 3 : 2, 0.5, 0.3, 0.12);
      } else {
        const pu = 1 + Math.sin(t * 20 + b.x) * 0.12;
        spr(glow, S.glow, b.x, b.y, b.r * 6.5 * pu, b.r * 6.5 * pu, 1, 0.15, 0.4, 1);
        spr(glow, S.glow, b.x, b.y, b.r * 2.6, b.r * 2.6, 1, 0.9, 0.95, 1);
        pointLight(b.x, b.y, 1.5, 0.5, 0.06, 0.18);
      }
    }
    // --- パーティクル
    for (const q of parts) {
      const k = q.t / q.ttl;
      if (q.kind === 0) spr(glow, S.glow, q.x, q.y, q.size * (0.4 + 0.6 * k), q.size * (0.4 + 0.6 * k), q.r, q.g, q.b, Math.min(1, k * 2));
      else if (q.kind === 1) spr(glow, S.ring, q.x, q.y, Math.max(0.01, q.size), Math.max(0.01, q.size), q.r, q.g, q.b, k * Math.min(0.8, 1.6 / Math.max(0.5, q.size)));
      else spr(glow, S['d' + (q.kind - 2)], q.x, q.y, q.size * 0.6, q.size, q.r, q.g, q.b, Math.min(1, k * 3));
    }

    // === パス1: シーン
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo); gl.viewport(0, 0, SW, SH_);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P.scene.p);
    gl.uniform2f(P.scene.u.uCam, camX, camY); gl.uniform2f(P.scene.u.uTarget, SW, SH_);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(P.scene.u.uAtlas, 0);
    gl.bindVertexArray(sprVAO); gl.bindBuffer(gl.ARRAY_BUFFER, sprBuf);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    flush(lit);
    gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = 0; i < glow.n; i++) glow.d[i * STRIDE + 13] = 1;
    flush(glow);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    // === パス2: 光
    gl.bindFramebuffer(gl.FRAMEBUFFER, lightA.fbo); gl.viewport(0, 0, LW, LH);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P.light.p);
    gl.uniform2f(P.light.u.uCam, camX, camY); gl.uniform2f(P.light.u.uTarget, SW, SH_);
    gl.bindVertexArray(fanVAO); gl.bindBuffer(gl.ARRAY_BUFFER, fanBuf);
    const los = visPolygon(st.segs, p.x, p.y, 26);
    gl.colorMask(false, false, false, true);
    drawFan(los, p.x, p.y, 1e6, 0, 0, 0, 1);
    gl.colorMask(true, true, true, true);
    const flick = 1 + Math.sin(t * 11) * 0.03 + Math.sin(t * 5.3) * 0.03, R = G.lanternR * flick;
    drawFan(R <= 26 ? los : visPolygon(st.segs, p.x, p.y, R), p.x, p.y, R, 1.2, 0.86, 0.5, 0);
    for (let i = 0; i < m.torches.length; i++) {
      const tc = m.torches[i];
      if (!tc.lit || tc.x < camX - 7 || tc.x > camX + TILES_X + 7 || tc.y < camY - 7 || tc.y > camY + TILES_Y + 7) continue;
      let poly = st.torchPoly.get(i);
      if (!poly) { poly = visPolygon(st.segs, tc.x, tc.y, TORCH_RADIUS + 1); st.torchPoly.set(i, poly); }
      const f = 0.86 + Math.sin(t * 9 + i * 2.1) * 0.06 + Math.sin(t * 23 + i) * 0.04;
      drawFan(poly, tc.x, tc.y, TORCH_RADIUS + 1, 0.8 * f, 0.4 * f, 0.16 * f, 0);
    }
    for (const f of flashes) {
      const k = f.t / f.ttl;
      if (f.shadow) drawFan(visPolygon(st.segs, f.x, f.y, f.R), f.x, f.y, f.R, f.r * k, f.g * k, f.b * k, 0);
      else pointLight(f.x, f.y, f.R, f.r * k * 0.7, f.g * k * 0.7, f.b * k * 0.7);
    }
    gl.useProgram(P.point.p);
    gl.uniform2f(P.point.u.uCam, camX, camY); gl.uniform2f(P.point.u.uTarget, SW, SH_);
    gl.bindVertexArray(plVAO); gl.bindBuffer(gl.ARRAY_BUFFER, plBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pl.d.subarray(0, pl.n * 6));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pl.n);
    gl.disable(gl.BLEND);
    // 影の縁をぼかす
    gl.useProgram(P.blur.p); gl.uniform1i(P.blur.u.uTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, lightB.fbo); gl.bindTexture(gl.TEXTURE_2D, lightA.tex[0]); gl.uniform2f(P.blur.u.uDir, 1.2 / LW, 0); quad();
    gl.bindFramebuffer(gl.FRAMEBUFFER, lightA.fbo); gl.bindTexture(gl.TEXTURE_2D, lightB.tex[0]); gl.uniform2f(P.blur.u.uDir, 0, 1.2 / LH); quad();

    // === パス3: ブルーム
    const oilK = p.oil / p.stats.oilMax;
    const bindComposite = (pr, pxScale) => {
      gl.useProgram(pr.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneT.tex[0]); gl.uniform1i(pr.u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sceneT.tex[1]); gl.uniform1i(pr.u.uEmis, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, lightA.tex[0]); gl.uniform1i(pr.u.uLightTex, 2);
      gl.uniform2f(pr.u.uFrac, fx, fy); gl.uniform2f(pr.u.uSceneSize, SW, SH_); gl.uniform2f(pr.u.uView, VIEW_W, VIEW_H);
      gl.uniform3f(pr.u.uAmbient, 0.035, 0.04, 0.075); gl.uniform1f(pr.u.uPx, pxScale);
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[0].fbo); gl.viewport(0, 0, bloom[0].w, bloom[0].h);
    bindComposite(P.bright, 1); quad();
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(P.down.p); gl.uniform1i(P.down.u.uTex, 0);
    for (let i = 1; i < bloom.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[i].fbo); gl.viewport(0, 0, bloom[i].w, bloom[i].h);
      gl.bindTexture(gl.TEXTURE_2D, bloom[i - 1].tex[0]); gl.uniform2f(P.down.u.uTexel, 1 / bloom[i - 1].w, 1 / bloom[i - 1].h); quad();
    }
    gl.useProgram(P.up.p); gl.uniform1i(P.up.u.uTex, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = bloom.length - 1; i > 0; i--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[i - 1].fbo); gl.viewport(0, 0, bloom[i - 1].w, bloom[i - 1].h);
      gl.bindTexture(gl.TEXTURE_2D, bloom[i].tex[0]); gl.uniform2f(P.up.u.uTexel, 0.5 / bloom[i].w, 0.5 / bloom[i].h); quad();
    }
    gl.disable(gl.BLEND);

    // === パス4: 画面へ
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    bindComposite(P.final, canvas.width / VIEW_W);
    const u = P.final.u;
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, bloom[0].tex[0]); gl.uniform1i(u.uBloom, 3);
    const low = p.hp <= 2 && !G.over ? 0.25 + 0.2 * Math.sin(t * 6) : 0;
    gl.uniform3f(u.uTint, 1, 1, 1); gl.uniform1f(u.uTime, t % 100); gl.uniform1f(u.uBloomK, 0.36);
    gl.uniform1f(u.uVig, 0.55 + (1 - oilK) * 0.3); gl.uniform1f(u.uDesat, (G.over ? 0.8 : 0) + Math.max(0, 0.25 - oilK) * 1.2);
    gl.uniform1f(u.uCA, 0.004 + st.hurt * 0.02 + st.shake * 0.006);
    if (st.white > 0) gl.uniform4f(u.uFlash, 1, 1, 1, st.white * 0.5);
    else gl.uniform4f(u.uFlash, 1, 0.1, 0.15, Math.max(st.hurt * 0.55, low * 0.4));
    gl.uniform1f(u.uFade, (1 - st.fade) * (opt.dim ?? 1));
    quad();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  return {
    render, update, handleEvents, screenToWorld, resize,
    setMouseWorld(x, y) { st.mouseX = x; st.mouseY = y; },
    reset() { parts.length = 0; flashes.length = 0; st.camInit = false; st.shake = 0; st.hurt = 0; st.white = 0; st.fade = 1; },
    stats: () => ({ sprites: lit.n + glow.n, particles: parts.length, lights: pl.n, hdr }),
  };
}

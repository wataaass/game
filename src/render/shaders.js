// GLSL ES 3.00 のシェーダー一式。
const HEAD = '#version 300 es\nprecision highp float;\n';

export const SCENE_VS = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aPosSize;
layout(location=2) in vec4 aUV;
layout(location=3) in vec4 aColor;
layout(location=4) in vec4 aParams; // 回転, 自発光, 壁フラグ, 白フラッシュ
uniform vec2 uCam; uniform vec2 uTarget;
out vec2 vUV; out vec4 vColor; out vec3 vParams;
void main() {
  float c = cos(aParams.x), s = sin(aParams.x);
  vec2 p = aCorner * aPosSize.zw;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 px = (aPosSize.xy + p - uCam) * 16.0 + 1.0;
  gl_Position = vec4(px.x / uTarget.x * 2.0 - 1.0, 1.0 - px.y / uTarget.y * 2.0, 0.0, 1.0);
  vUV = aUV.xy + (aCorner + 0.5) * aUV.zw;
  vColor = aColor; vParams = aParams.yzw;
}`;

export const SCENE_FS = HEAD + `
uniform sampler2D uAtlas;
in vec2 vUV; in vec4 vColor; in vec3 vParams;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
void main() {
  vec4 t = texture(uAtlas, vUV);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 c = mix(t.rgb * vColor.rgb, vec3(1.0), vParams.z);
  o0 = vec4(c * a, a);
  o1 = vec4(c * vParams.x * a, vParams.y * a);
}`;

export const LIGHT_VS = HEAD + `
layout(location=0) in vec2 aPos;
uniform vec2 uCam; uniform vec2 uTarget;
out vec2 vW;
void main() {
  vec2 px = (aPos - uCam) * 16.0 + 1.0;
  gl_Position = vec4(px.x / uTarget.x * 2.0 - 1.0, 1.0 - px.y / uTarget.y * 2.0, 0.0, 1.0);
  vW = aPos;
}`;

export const LIGHT_FS = HEAD + `
uniform vec3 uLight; uniform vec4 uColor;
in vec2 vW; out vec4 o;
void main() {
  float a = clamp(1.0 - length(vW - uLight.xy) / uLight.z, 0.0, 1.0);
  a = a * a * (1.6 - 0.6 * a) * (1.0 + 0.9 * a * a * a);
  o = vec4(uColor.rgb * a, uColor.a);
}`;

export const POINT_VS = HEAD + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aLight;
layout(location=2) in vec3 aColor;
uniform vec2 uCam; uniform vec2 uTarget;
out vec2 vL; out vec3 vColor;
void main() {
  vec2 px = (aLight.xy + aCorner * 2.0 * aLight.z - uCam) * 16.0 + 1.0;
  gl_Position = vec4(px.x / uTarget.x * 2.0 - 1.0, 1.0 - px.y / uTarget.y * 2.0, 0.0, 1.0);
  vL = aCorner * 2.0; vColor = aColor;
}`;

export const POINT_FS = HEAD + `
in vec2 vL; in vec3 vColor; out vec4 o;
void main() {
  float a = clamp(1.0 - length(vL), 0.0, 1.0);
  o = vec4(vColor * a * a, 0.0);
}`;

export const FULL_VS = HEAD + `
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BLUR_FS = HEAD + `
uniform sampler2D uTex; uniform vec2 uDir;
in vec2 vUV; out vec4 o;
void main() {
  o = texture(uTex, vUV) * 0.2270270 +
      (texture(uTex, vUV + uDir * 1.3846154) + texture(uTex, vUV - uDir * 1.3846154)) * 0.3162162 +
      (texture(uTex, vUV + uDir * 3.2307692) + texture(uTex, vUV - uDir * 3.2307692)) * 0.0702703;
}`;

// アルベド×光＋自発光。壁は自分では光を受けないので、隣の床の明るさを借りる。
const COMPOSITE = `
uniform sampler2D uScene, uEmis, uLightTex;
uniform vec2 uFrac; uniform vec2 uSceneSize; uniform vec2 uView; uniform vec3 uAmbient; uniform float uPx;
const vec2 DIRS[8] = vec2[8](vec2(1,0), vec2(-1,0), vec2(0,1), vec2(0,-1), vec2(.7,.7), vec2(-.7,.7), vec2(.7,-.7), vec2(-.7,-.7));
vec3 composite(vec2 uv) {
  vec2 px = vec2(uv.x * uView.x + 1.0 + uFrac.x, (1.0 - uv.y) * uView.y + 1.0 + uFrac.y);
  vec2 seam = floor(px + 0.5);
  vec2 sp = seam + clamp((px - seam) * uPx, -0.5, 0.5);
  vec2 suv = vec2(sp.x / uSceneSize.x, 1.0 - sp.y / uSceneSize.y);
  vec2 luv = vec2(px.x / uSceneSize.x, 1.0 - px.y / uSceneSize.y);
  vec4 alb = texture(uScene, suv), em = texture(uEmis, suv), L = texture(uLightTex, luv);
  if (em.a > 0.5) {
    vec2 o = 10.0 / uSceneSize;
    for (int i = 0; i < 8; i++) {
      L = max(L, texture(uLightTex, luv + DIRS[i] * o) * 0.9);
      L = max(L, texture(uLightTex, luv + DIRS[i] * o * 1.9) * 0.7);
    }
  }
  float vis = smoothstep(0.04, 0.55, L.a);
  return (alb.rgb * (uAmbient + L.rgb) + em.rgb) * vis;
}`;

export const BRIGHT_FS = HEAD + COMPOSITE + `
in vec2 vUV; out vec4 o;
void main() {
  vec3 c = composite(vUV);
  float m = max(c.r, max(c.g, c.b));
  o = vec4(c * smoothstep(0.55, 1.5, m), 1.0);
}`;

export const DOWN_FS = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel;
in vec2 vUV; out vec4 o;
void main() {
  o = texture(uTex, vUV) * 0.5 + (texture(uTex, vUV + uTexel) + texture(uTex, vUV - uTexel) +
      texture(uTex, vUV + vec2(uTexel.x, -uTexel.y)) + texture(uTex, vUV - vec2(uTexel.x, -uTexel.y))) * 0.125;
}`;

export const UP_FS = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel;
in vec2 vUV; out vec4 o;
void main() {
  vec2 t = uTexel;
  o = (texture(uTex, vUV + vec2(-t.x * 2.0, 0.0)) + texture(uTex, vUV + vec2(t.x * 2.0, 0.0)) +
       texture(uTex, vUV + vec2(0.0, t.y * 2.0)) + texture(uTex, vUV + vec2(0.0, -t.y * 2.0))) / 12.0 +
      (texture(uTex, vUV + vec2(-t.x, t.y)) + texture(uTex, vUV + vec2(t.x, t.y)) +
       texture(uTex, vUV + vec2(-t.x, -t.y)) + texture(uTex, vUV + vec2(t.x, -t.y))) / 6.0;
}`;

export const FINAL_FS = HEAD + COMPOSITE + `
uniform sampler2D uBloom;
uniform vec3 uTint; uniform vec4 uFlash; uniform float uTime, uBloomK, uVig, uDesat, uCA, uFade;
in vec2 vUV; out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 d = vUV - 0.5;
  float r2 = dot(d, d);
  vec3 c = composite(vUV);
  vec3 b = vec3(texture(uBloom, vUV + d * uCA).r, texture(uBloom, vUV).g, texture(uBloom, vUV - d * uCA).b);
  c += b * uBloomK;
  c *= uTint;
  c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))), uDesat);
  c = 1.0 - exp(-c * 1.25);
  c *= 1.0 - uVig * smoothstep(0.12, 0.6, r2);
  c += uFlash.rgb * uFlash.a * (0.35 + 1.6 * r2);
  c += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.022;
  o = vec4(c * uFade, 1.0);
}`;

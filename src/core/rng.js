// 種から同じ乱数列を必ず再現する PRNG（sfc32）。Math.random はシミュレーションで使わない。
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function mix32(a, b) {
  let z = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) | 0;
  z = Math.imul(z ^ (z >>> 15), 0x2c1b3c6d);
  z = Math.imul(z ^ (z >>> 12), 0x297a2d39);
  return (z ^ (z >>> 15)) >>> 0;
}

export class RNG {
  constructor(seed) {
    let s = seed >>> 0;
    const sm = () => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = 1;
    for (let i = 0; i < 12; i++) this.u32();
  }
  u32() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }
  f() { return this.u32() / 4294967296; }
  range(a, b) { return a + (b - a) * this.f(); }
  int(n) { return (this.f() * n) | 0; }
  irange(a, b) { return a + this.int(b - a + 1); }
  chance(p) { return this.f() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  // 重み付き抽選。weights の合計が 0 なら -1。
  weighted(weights) {
    let sum = 0;
    for (const w of weights) sum += w;
    if (sum <= 0) return -1;
    let r = this.f() * sum;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
    return weights.length - 1;
  }
  state() { return [this.a, this.b, this.c, this.d]; }
}

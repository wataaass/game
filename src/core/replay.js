// リプレイの保存形式。シミュレーションは決定的なので、種と入力の列だけで1プレイを丸ごと再現できる。
// 入力1ティック = 6バイト（移動x, 移動y, 照準の下位・上位, ボタン, 選択）
export function packInputs(list) {
  const b = new Uint8Array(list.length * 6);
  list.forEach((inp, i) => {
    const o = i * 6, aim = inp.aim & 0xffff;
    b[o] = inp.mx & 255; b[o + 1] = inp.my & 255; b[o + 2] = aim & 255; b[o + 3] = aim >> 8; b[o + 4] = inp.btn; b[o + 5] = inp.choice;
  });
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unpackInputs(str) {
  const s = atob(str), out = [];
  for (let o = 0; o + 5 < s.length; o += 6) {
    const aim = s.charCodeAt(o + 2) | (s.charCodeAt(o + 3) << 8);
    out.push({
      mx: (s.charCodeAt(o) << 24) >> 24, my: (s.charCodeAt(o + 1) << 24) >> 24, aim: (aim << 16) >> 16,
      btn: s.charCodeAt(o + 4), choice: s.charCodeAt(o + 5),
    });
  }
  return out;
}

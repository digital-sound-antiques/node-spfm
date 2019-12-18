const F = [57, 57, 57, 57, 77, 102, 128, 153];

function ensureInt16Array(pcm: Int16Array | Uint8Array): Int16Array {
  if (pcm instanceof Uint8Array) {
    const result = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      result[i] = (pcm[i] - 128) * 256;
    }
    return result;
  }
  return pcm;
}

export function YM2608_ADPCM_encode(pcm: Int16Array | Uint8Array): Uint8Array {
  const inp = ensureInt16Array(pcm);
  const adpcm = new Uint8Array(Math.round(pcm.length / 2));
  let x = 0;
  let D = 127;
  let dh = 0;

  for (let n = 0; n < inp.length; n++) {
    const d = inp[n] - x;
    const L4 = d < 0 ? 1 : 0;
    const l = Math.abs(d) / D;
    let L31 = Math.min(7, Math.floor(l / 0.25));
    x = (((1 - 2 * L4) * (L31 * 2 + 1) * D) >> 3) + x;
    D = (F[L31] * D) >> 6;
    D = Math.min(0x5fff, Math.max(127, D));

    if (n & 1) {
      const dl = (L4 << 3) | L31;
      adpcm[n >> 1] = (dh << 4) | dl;
    } else {
      dh = (L4 << 3) | L31;
    }
  }
  return adpcm;
}

export function YM2608_ADPCM_decode(adpcm: Uint8Array): Int16Array {
  const pcm = new Int16Array(adpcm.length * 2);
  let out = 0;
  let diff = 0;
  for (let i = 0; i < adpcm.length * 2; i++) {
    const val = i & 1 ? adpcm[i >> 1] & 0xf : adpcm[i >> 1] >> 4;
    if (val & 8) {
      out -= (diff * ((val & 7) * 2 + 1)) >> 3;
    } else {
      out += (diff * ((val & 7) * 2 + 1)) >> 3;
    }
    out = Math.min(32767, Math.max(-32768, out));
    diff = Math.min(0x5fff, Math.max(127, (diff * F[val & 7]) >> 6));
    pcm[i] = out;
  }
  return pcm;
}

export function OKIM6258_ADPCM_decode(adpcm: Uint8Array): Int16Array {
  const index_shift = [-1, -1, -1, -1, 2, 4, 6, 8];
  const M = (step: number, nib: number) => {
    const a = Math.floor(16.0 * Math.pow(11.0 / 10.0, step));
    const p = nib & 8 ? -1 : 1;
    // Note: l3 to 0 must be integer, not floating point.
    const l3 = nib & 4 ? a : 0;
    const l2 = nib & 2 ? a >> 1 : 0;
    const l1 = nib & 1 ? a >> 2 : 0;
    const l0 = a >> 3;
    return p * (l3 + l2 + l1 + l0);
  };
  const pcm = new Int16Array(adpcm.length * 2);
  let out = 0;
  let step = 0;
  for (let i = 0; i < adpcm.length * 2; i++) {
    const nib = i & 1 ? adpcm[i >> 1] >> 4 : adpcm[i >> 1] & 0xf;
    const sample = M(step, nib);
    out = ((sample << 8) + out * 245) >> 8;
    step = Math.min(48, Math.max(0, step + index_shift[nib & 7]));
    pcm[i] = out << 4;
  }
  return pcm;
}

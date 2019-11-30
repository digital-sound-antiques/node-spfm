const F = [57, 57, 57, 57, 77, 102, 128, 153];

export function ADPCM_encode(pcm: Uint8Array) {
  const adpcm = new Uint8Array(Math.round(pcm.length / 2));
  let x = 0;
  let D = 127;
  let dh = 0;

  for (let n = 0; n < pcm.length; n++) {
    const d = (pcm[n] - 128) * 256 - x;
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

export function ADPCM_decode(adpcm: Uint8Array): Uint8Array {
  const pcm = new Uint8Array(adpcm.length * 2);
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

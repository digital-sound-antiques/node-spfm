import { RegisterFilter, RegisterData } from "./register-filter";
import YM2413DACTable from "./ym2413-dac-table";
import SPFMModule from "src/spfm-module";
import { toOPNVoice, OPNVoice } from "./opn-voices";

const voices = [
  { inst: 0, voff: 0 },
  { inst: 0, voff: 0 },
  { inst: 0, voff: 0 },
  { inst: 0, voff: 0 },
  { inst: 0, voff: 0 },
  { inst: 0, voff: 0 }
];

/** instrument data to voice and volue offset (attenuation) */
const voiceMap: { [key: string]: { inst: number; voff: number } } = {
  // "41315242179e9e9e1f3f1f3f06000c0805040c060f0f0f0e000000003d40": { inst: 1, voff: -1 },
};

const LW = 32;
/* resolution of sinc(x) table. sinc(x) where 0.0≦x≦1.0 corresponds to sinc_table[0..SINC_RESO] */
const SINC_RESO = 256;
const SINC_AMP_BITS = 12;

function blackman(x: number) {
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
}
function sinc(x: number) {
  return x == 0.0 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
}
function windowed_sinc(x: number) {
  return blackman(0.5 + (0.5 * x) / (LW / 2)) * sinc(x);
}

function lookup_sinc_table(table: Int16Array, x: number) {
  let index = Math.floor(x * SINC_RESO);
  if (index < 0) {
    index = -index;
  }
  return table[Math.min((SINC_RESO * LW) / 2 - 1, index)];
}

/* f_inp: input frequency. f_out: output frequencey, ch: number of channels */
class RConv {
  _ratio: number;
  _buf: Int16Array;
  _sinc_table: Int16Array;
  _timer: number = 0;
  constructor(f_inp: number, f_out: number) {
    this._ratio = f_inp / f_out;
    this._buf = new Int16Array(LW);
    this._sinc_table = new Int16Array((SINC_RESO * LW) / 2);
    for (let i = 0; i < (SINC_RESO * LW) / 2; i++) {
      const x = i / SINC_RESO;
      if (f_out < f_inp) {
        /* for downsampling */
        this._sinc_table[i] = ((1 << SINC_AMP_BITS) * windowed_sinc(x / this._ratio)) / this._ratio;
      } else {
        /* for upsampling */
        this._sinc_table[i] = (1 << SINC_AMP_BITS) * windowed_sinc(x);
      }
    }
  }

  reset() {
    this._timer = 0;
  }

  /* put original data to this converter at f_inp. */
  putData(data: number) {
    for (let i = 0; i < LW - 1; i++) {
      this._buf[i] = this._buf[i + 1];
    }
    this._buf[LW - 1] = data;
  }

  /* get resampled data from this converter at f_out. */
  /* this function must be called f_out / f_inp times per one putData call. */
  getData() {
    this._timer += this._ratio;
    const dn = this._timer - Math.floor(this._timer);
    let sum = 0;
    for (let k = 0; k < LW; k++) {
      const x = k - (LW / 2 - 1) - dn;
      sum += this._buf[k] * lookup_sinc_table(this._sinc_table, x);
    }
    return sum >> SINC_AMP_BITS;
  }
}

export default class YM2612ToYM2413Filter implements RegisterFilter {
  _voiceHashMap: { [key: string]: OPNVoice } = {};
  _currentVoice: {
    hash: string;
    inst: number;
    voff: number;
  }[] = [];

  _div = 0;
  _regs = [new Uint8Array(256), new Uint8Array(256)];
  _outRegs = new Int16Array(256);
  _keyFlags = [0, 0, 0, 0, 0, 0];

  constructor() {
    this._outRegs.fill(-1);
  }

  async initialize(mod: SPFMModule) {
    let data: Array<RegisterData> = [];
    // select FM 9-ch mode
    data.push({ port: 0, a: 14, d: 0 });

    // make sure all channels key-off
    data.push({ port: 0, a: 38, d: 0 });
    data.push({ port: 0, a: 39, d: 0 });
    data.push({ port: 0, a: 40, d: 0 });

    // select violin tone whose modulator AR is 15.
    data.push({ port: 0, a: 54, d: (1 << 4) | 15 });
    data.push({ port: 0, a: 55, d: (1 << 4) | 15 });
    data.push({ port: 0, a: 56, d: (1 << 4) | 15 });

    // set f-number fnum=1 is the most accurate but need longer wait time.
    const fnum = 8;
    data.push({ port: 0, a: 22, d: fnum });
    data.push({ port: 0, a: 23, d: fnum });
    data.push({ port: 0, a: 24, d: fnum });

    // start phase generator
    data.push({ port: 0, a: 38, d: 16 });
    data.push({ port: 0, a: 39, d: 16 });
    data.push({ port: 0, a: 40, d: 16 });
    await mod.spfm.writeRegs(mod.slot, data, 1);

    // wait until 1/4 cycle of phase generator
    const freq = (fnum * mod.rawClock) / 72 / (1 << 19);
    const cycleInMillis = 1000 / freq;
    await new Promise(resolve => setTimeout(resolve, Math.round(cycleInMillis / 4)));

    // stop phase generator
    data = [];
    data.push({ port: 0, a: 22, d: 0 });
    data.push({ port: 0, a: 23, d: 0 });
    data.push({ port: 0, a: 24, d: 0 });

    /** setup user vocie (saw-like sound) */
    data.push({ port: 0, a: 0, d: 0x21 });
    data.push({ port: 0, a: 1, d: 0x01 });
    data.push({ port: 0, a: 2, d: 0x1c });
    data.push({ port: 0, a: 3, d: 0x07 });
    data.push({ port: 0, a: 4, d: 0xf0 });
    data.push({ port: 0, a: 5, d: 0xf4 });
    data.push({ port: 0, a: 6, d: 0x00 });
    data.push({ port: 0, a: 7, d: 0x22 });
    await mod.spfm.writeRegs(mod.slot, data, 1);
  }

  _prevVS = [0, 0, 0];

  _identifyVoice(ch: number) {
    const port = ch < 3 ? 0 : 1;
    const nch = ch < 3 ? ch : (ch + 1) & 3;
    const regs = this._regs[port];
    const rawVoice = [
      regs[0x30 + nch],
      regs[0x34 + nch],
      regs[0x38 + nch],
      regs[0x3c + nch],
      regs[0x40 + nch],
      regs[0x44 + nch],
      regs[0x48 + nch],
      regs[0x4c + nch],
      regs[0x50 + nch],
      regs[0x54 + nch],
      regs[0x58 + nch],
      regs[0x5c + nch],
      regs[0x60 + nch],
      regs[0x64 + nch],
      regs[0x68 + nch],
      regs[0x6c + nch],
      regs[0x70 + nch],
      regs[0x74 + nch],
      regs[0x78 + nch],
      regs[0x7c + nch],
      regs[0x80 + nch],
      regs[0x84 + nch],
      regs[0x88 + nch],
      regs[0x8c + nch],
      regs[0x90 + nch],
      regs[0x94 + nch],
      regs[0x98 + nch],
      regs[0x9c + nch],
      regs[0xb0 + nch],
      regs[0xb4 + nch]
    ];
    const nextHash = rawVoice.map(e => ("0" + e.toString(16)).slice(-2)).join("");
    const prevVoice = this._currentVoice[ch];
    if (prevVoice == null || nextHash != prevVoice.hash) {
      const isNew = this._voiceHashMap[nextHash] == null;
      if (isNew) {
        console.log(`CH${ch},${nextHash}`);
      }
      const opnVoice = toOPNVoice(rawVoice);
      this._voiceHashMap[nextHash] = opnVoice;
      this._currentVoice[ch] = {
        hash: nextHash,
        ...(voiceMap[nextHash] || voices[ch])
      };
    }
  }

  _updateInstVol(result: Array<RegisterData>, port: number, nch: number) {
    const regs = this._regs[port];
    const ch = nch + port * 3;
    const alg = regs[0xb0 + nch] & 7;
    if (this._currentVoice[ch] == null) {
      this._identifyVoice(ch);
    }
    const { inst, voff } = this._currentVoice[ch];
    const amps = [regs[0x40 + nch] & 0x7f, regs[0x44 + nch] & 0x7f, regs[0x48 + nch] & 0x7f, regs[0x4c + nch] & 0x7f];
    let vol; // 7f * 4
    switch (alg) {
      case 4:
        vol = (amps[2] + amps[3]) / 2;
        break;
      case 5:
      case 6:
        vol = (amps[1] + amps[2] + amps[3]) / 3;
        break;
      case 7:
        vol = (amps[0] + amps[1] + amps[2] + amps[3]) / 4;
        break;
      default:
        vol = amps[3];
        break;
    }
    const vv = (vol >> 3) + voff;
    const d = (inst << 4) | Math.min(15, Math.max(0, vv));
    if (this._outRegs[0x30 + ch] != d) {
      result.push({ port: 0, a: 0x30 + ch, d });
      this._outRegs[0x30 + ch] = d;
    }
  }

  _conv = new RConv(4, 2); // For LOW PASS

  filterReg(context: any, data: RegisterData): RegisterData[] {
    let result = Array<RegisterData>();
    const adr = data.a!;
    const regs = this._regs[data.port!];
    regs[adr] = data.d;
    if (data.port == 0) {
      if (adr == 0x2a) {
        const v = Math.min(765, Math.round(data.d * 3));
        this._conv.putData(v);
        if (this._div % 4 !== 0) {
          const idx = Math.max(0, Math.min(765, Math.floor(this._conv.getData())));
          const vs = YM2413DACTable[idx];
          for (let i = 0; i < 3; i++) {
            // Note: differential writing is possible but disable here because it may make jitter on USB serial transfer.
            // if (this._prevVS[i] != vs[i]) {
            result.push({ port: 0, a: 56 - i, d: (8 << 4) | vs[i] });
            this._prevVS[i] = vs[i];
            // }
          }
        }
        this._div++;
      }
      if (adr === 0x28) {
        const nch = data.d & 3;
        if (nch !== 3) {
          const ch = nch + (data.d & 4 ? 3 : 0);
          const al = 0xa0 + nch;
          const ah = 0xa4 + nch;
          const fnum = (((regs[ah] & 7) << 8) | regs[al]) >> 2;
          const blk = (regs[ah] >> 3) & 7;
          // const key = 0;
          const key = data.d >> 4 != 0 ? 1 : 0;
          if (key != this._keyFlags[ch]) {
            if (key) {
              this._identifyVoice(ch);
              this._updateInstVol(result, data.port!, nch);
            }
            this._keyFlags[ch] = key;
          }
          const dl = fnum & 0xff;
          const dh = (key << 4) | (blk << 1) | (fnum >> 8);
          if (this._outRegs[0x20 + ch] != dh) {
            result.push({ port: 0, a: 0x20 + ch, d: dh });
            this._outRegs[0x20 + ch] = dh;
          }
          if (this._outRegs[0x10 + ch] != dl) {
            result.push({ port: 0, a: 0x10 + ch, d: dl });
            this._outRegs[0x10 + ch] = dl;
          }
        }
      }
    }

    if (0x40 <= adr && adr <= 0x4f) {
      const nch = adr & 3;
      if (nch !== 3) {
        this._updateInstVol(result, data.port!, nch);
      }
    }

    if ((0xa0 <= adr && adr <= 0xa2) || (0xa4 <= adr && adr < 0xa6)) {
      const nch = adr & 3;
      const ch = nch + data.port! * 3;
      const al = 0xa0 + nch;
      const ah = 0xa4 + nch;
      const fnum = (((regs[ah] & 7) << 8) | regs[al]) >> 2;
      const blk = (regs[ah] >> 3) & 7;
      const key = this._keyFlags[ch];
      const dl = fnum & 0xff;
      const dh = (key << 4) | (blk << 1) | (fnum >> 8);
      if (this._outRegs[0x20 + ch] != dh) {
        result.push({ port: 0, a: 0x20 + ch, d: dh });
        this._outRegs[0x20 + ch] = dh;
      }
      if (this._outRegs[0x10 + ch] != dl) {
        result.push({ port: 0, a: 0x10 + ch, d: dl });
        this._outRegs[0x10 + ch] = dl;
      }
    }

    return result;
  }
}

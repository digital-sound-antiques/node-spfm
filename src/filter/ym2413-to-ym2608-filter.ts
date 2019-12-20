import { RegisterFilter, RegisterData } from "./register-filter";
import { OPLL_VOICES, OPLLVoice, toOPLLVoice } from "./opll-voices";
import SPFMModule from "src/spfm-module";
import RegisterDataBuffer from "./register-data-buffer";
import { OPNVoice, OPNSlotParam, OPLLVoiceToOPNVoice } from "./opn-voices";

/* level key scaling table */
const KSLTable = [0, 24, 32, 37, 40, 43, 45, 47, 48, 50, 51, 52, 53, 54, 55, 56];

type OPNVoiceEx = OPNVoice & {
  slots: Array<OPNSlotParam & { pm: number; kl: number }>;
};

function OPLLVoiceToOPNVoiceEx(opll: OPLLVoice): OPNVoiceEx {
  const opn = OPLLVoiceToOPNVoice(opll);
  return {
    fb: opn.fb,
    con: opn.con,
    ams: opn.ams,
    pms: opn.pms,
    slots: [
      { ...opn.slots[0], pm: opll.slots[0].pm, kl: opll.slots[0].kl },
      { ...opn.slots[1], pm: 0, kl: 0 },
      { ...opn.slots[2], pm: 0, kl: 0 },
      { ...opn.slots[3], pm: opll.slots[1].pm, kl: opll.slots[1].kl }
    ]
  };
}

const ROM_VOICES: Array<OPNVoiceEx> = [];
for (let i = 0; i < OPLL_VOICES.length; i++) {
  ROM_VOICES.push(OPLLVoiceToOPNVoiceEx(OPLL_VOICES[i]));
}

export default class YM2413ToYM2608Filter implements RegisterFilter {
  _regs = new Uint8Array(256).fill(0);
  _buf = new RegisterDataBuffer(256, 2);
  _userVoice: OPNVoiceEx = ROM_VOICES[0];
  _voiceMap = [ROM_VOICES[0], ROM_VOICES[0], ROM_VOICES[0], ROM_VOICES[0], ROM_VOICES[0], ROM_VOICES[0]];
  async initialize(mod: SPFMModule) {
    const data: Array<RegisterData> = [
      { port: 0, a: 0x22, d: 0x0b }, // LFO ON 6.02Hz
      { port: 0, a: 0x29, d: 0x80 }, // enable FM 4-6ch
      { port: 0, a: 0x11, d: 0x38 }, // Rhythm TL
      { port: 0, a: 0x18, d: 0xdf }, // bd
      { port: 0, a: 0x19, d: 0xdf }, // sd
      { port: 0, a: 0x1a, d: 0xdf }, // top
      { port: 0, a: 0x1b, d: 0xdf }, // hh
      { port: 0, a: 0x1c, d: 0xdf }, // tom
      { port: 0, a: 0x1d, d: 0xdf } // rym
    ];
    await mod.spfm.writeRegs(mod.slot, data);
  }

  _setSlotVolume(port: number, nch: number, blk_fnum: number, volume: number) {
    const ch = port * 3 + nch;
    const fnum_h = (blk_fnum >> 5) & 15;
    const oct = (blk_fnum >> 9) & 7;
    const voice = this._voiceMap[ch];

    /* level key scale emulation */
    const kll = Math.max(0, KSLTable[fnum_h] - 8 * (7 - oct));
    const tll = (vl: number, slot: OPNSlotParam & { kl: number }) => {
      return Math.min(127, vl + slot.tl + (slot.kl ? kll >> (3 - slot.kl) : 0));
    };
    this._buf.push({ port, a: 0x40 + nch, d: tll(0, voice.slots[0]) });
    this._buf.push({ port, a: 0x44 + nch, d: tll(0, voice.slots[1]) });
    this._buf.push({ port, a: 0x48 + nch, d: tll(0, voice.slots[2]) });
    this._buf.push({ port, a: 0x4c + nch, d: tll(volume << 2, voice.slots[3]) });
  }

  _setInstVolume(port: number, nch: number, iv: number) {
    const inst = iv >> 4;
    const volume = iv & 15;
    const ch = port * 3 + nch;

    const voice = inst === 0 ? this._userVoice : ROM_VOICES[inst];
    this._voiceMap[ch] = voice;

    this._buf.push({ port, a: 0xb0 + nch, d: (voice.fb << 3) | voice.con });
    this._buf.push({ port, a: 0xb4 + nch, d: 0xc0 | (voice.ams << 4) | voice.pms });

    for (let i = 0; i < 4; i++) {
      this._buf.push({ port, a: 0x30 + i * 4 + nch, d: (voice.slots[i].dt << 4) | voice.slots[i].ml });
      this._buf.push({ port, a: 0x50 + i * 4 + nch, d: (voice.slots[i].ks << 6) | voice.slots[i].ar });
      this._buf.push({ port, a: 0x60 + i * 4 + nch, d: (voice.slots[i].am << 7) | voice.slots[i].dr });
      this._buf.push({ port, a: 0x70 + i * 4 + nch, d: voice.slots[i].sr });
      this._buf.push({ port, a: 0x80 + i * 4 + nch, d: (voice.slots[i].sl << 4) | voice.slots[i].rr });
    }
    const blk_fnum = ((this._regs[0x20 + ch] & 0xf) << 8) | this._regs[0x10 + ch];
    this._setSlotVolume(port, nch, blk_fnum, volume);
  }

  filterReg(context: any, data: RegisterData): RegisterData[] {
    const a = data.a!;
    const d = data.d;

    if (a < 0x08) {
      this._regs[a] = d;
      this._userVoice = OPLLVoiceToOPNVoiceEx(toOPLLVoice(this._regs));
      for (let ch = 0; ch < 6; ch++) {
        const iv = this._regs[0x30 + ch];
        if (iv >> 4 === 0) {
          const port = ch < 3 ? 0 : 1;
          const nch = (3 <= ch ? ch + 1 : ch) & 3;
          this._setInstVolume(port, nch, iv);
        }
      }
    } else if (a === 0x0e) {
      if (d & 32) {
        const prev = this._regs[0x0e];
        const hh = ~prev & d & 1;
        const top = (~prev & d & 2) >> 1;
        const tom = (~prev & d & 4) >> 2;
        const sd = (~prev & d & 8) >> 3;
        const bd = (~prev & d & 16) >> 4;
        this._buf.push({ port: 0, a: 0x10, d: (tom << 4) | (hh << 3) | (top << 2) | (sd << 1) | bd }, false);
      } else {
        this._buf.push({ port: 0, a: 0x10, d: 0xff }, false);
      }
      this._regs[a] = d;
    } else if (0x10 <= a && a < 0x16) {
      // F-Num 1
      const ch = a - 0x10;
      const port = ch < 3 ? 0 : 1;
      const nch = (3 <= ch ? ch + 1 : ch) & 3;

      const al = 0xa0 + nch;
      const ah = 0xa4 + nch;
      const blk_fnum = ((this._regs[0x20 + ch] & 0xf) << 8) | d;
      this._buf.push({ port, a: ah, d: blk_fnum >> 6 }, false);
      this._buf.push({ port, a: al, d: (blk_fnum << 2) & 0xff }, false);
      this._regs[a] = d;
      this._setSlotVolume(port, nch, blk_fnum, this._regs[0x30 + ch] & 0xf);
    } else if (0x20 <= a && a < 0x26) {
      // BLOCK & F-Num 2
      const ch = a - 0x20;
      const port = ch < 3 ? 0 : 1;
      const nch = (3 <= ch ? ch + 1 : ch) & 3;

      const al = 0xa0 + nch;
      const blk_fnum = ((d & 0xf) << 8) | this._regs[0x10 + ch];
      const ah = 0xa4 + nch;
      const prevKey = (this._regs[0x20 + ch] >> 4) & 1;
      const nextKey = (d >> 4) & 1;
      this._buf.push({ port, a: ah, d: blk_fnum >> 6 }, false);
      this._buf.push({ port, a: al, d: (blk_fnum << 2) & 0xff }, false);
      this._setSlotVolume(port, nch, blk_fnum, this._regs[0x30 + ch] & 0xf);
      if (prevKey != nextKey) {
        this._buf.push({ port: 0, a: 0x28, d: (nextKey ? 0xf0 : 0) | (port * 4 + nch) }, false);
      }
      this._regs[a] = d;
    } else if (0x30 <= a && a < 0x36) {
      // INST & VOLUME
      const ch = a - 0x30;
      const port = ch < 3 ? 0 : 1;
      const nch = (3 <= ch ? ch + 1 : ch) & 3;
      this._setInstVolume(port, nch, d);
      this._regs[a] = d;
    } else if (a === 0x36) {
      const bd_vol = 15 - (d & 0xf);
      this._buf.push({ port: 0, a: 0x18, d: 0xc0 | (bd_vol << 1) });
      this._regs[a] = d;
    } else if (a === 0x37) {
      const sd_vol = 15 - (d & 0xf);
      const hh_vol = 15 - (d >> 4);
      this._buf.push({ port: 0, a: 0x19, d: 0xc0 | (sd_vol << 1) });
      this._buf.push({ port: 0, a: 0x1b, d: 0xc0 | hh_vol });
      this._regs[a] = d;
    } else if (a === 0x38) {
      const top_vol = 15 - (d & 0xf);
      const tom_vol = 15 - (d >> 4);
      this._buf.push({ port: 0, a: 0x1a, d: 0xc0 | (top_vol << 1) });
      this._buf.push({ port: 0, a: 0x1c, d: 0xc0 | Math.round(tom_vol * 1.5) });
      this._regs[a] = d;
    } else {
      this._regs[a] = d;
    }

    return this._buf.commit();
  }
}

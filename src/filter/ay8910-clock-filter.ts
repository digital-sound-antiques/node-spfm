import { RegisterFilter, RegisterData } from "./register-filter";

export default class AY8910ClockFilter implements RegisterFilter {
  _ratio: number;
  _regs = new Uint8Array(16);
  constructor(inClock: number, outClock: number) {
    if (1789770 <= outClock && outClock <= 1789773) {
      // correct clock for inaccurate VGM header.
      outClock = 3579545 / 2;
    }
    this._ratio = inClock / outClock;
  }

  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (this._ratio !== 1.0 && data.a != null && 0 <= data.a && data.a < 16) {
      this._regs[data.a] = data.d;
      if (data.a < 6) {
        // freq
        const ah = data.a | 1;
        const al = data.a & 6;
        const raw = ((this._regs[ah] & 0x0f) << 8) | this._regs[al];
        const adj = Math.min(0x0fff, Math.round(raw * this._ratio));
        return [
          { port: data.port, a: al, d: adj & 0xff },
          { port: data.port, a: ah, d: adj >> 8 }
        ];
      } else if (data.a === 6) {
        // noise freq
        const raw = this._regs[6] & 0x1f;
        const adj = Math.min(0xfff, Math.round(raw * this._ratio));
        return [{ port: data.port, a: data.a, d: adj }];
      } else if (data.a == 11 || data.a == 12) {
        // envelope freq
        const ah = 12;
        const al = 11;
        const raw = (this._regs[ah] << 8) | this._regs[al];
        const adj = Math.min(0xffff, Math.round(raw * this._ratio));
        return [
          { port: data.port, a: al, d: adj & 0xff },
          { port: data.port, a: ah, d: adj >> 8 }
        ];
      }
    }
    return [data];
  }
}

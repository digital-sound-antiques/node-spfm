import { RegisterFilter, RegisterData } from "./register-filter";

const keyCodeToIndex = [0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12];
const keyIndexToCode = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];

export class YM2151ClockFilter implements RegisterFilter {
  _ratio: number;
  _regs = new Uint8Array(256);
  _outRegs = new Uint8Array(256);
  _initialized = false;
  _keyDiff: number;
  _lfoDiff = 0;

  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
    this._keyDiff = Math.round(12 * Math.log2(1.0 / this._ratio) * 256);

    /* LFO_FREQ = CLOCK * POWER(2, LFRQ/16 - 32) = CLOCK' * POWER(2, LFRQ'/16 - 32) */
    /* => LFRQ' = 16 * LOG2(CLOCK/CLOCK') + LFRQ */
    this._lfoDiff = Math.round(16 * Math.log2(1.0 / this._ratio));
    for (let i = 0; i < this._outRegs.length; i++) {
      this._outRegs[i] = -1;
    }
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (this._ratio !== 1.0 && data.a != null) {
      const result = Array<RegisterData>();

      if (!this._initialized) {
        const lfrq = Math.max(0, Math.min(255, this._lfoDiff));
        result.push({ port: data.port, a: 0x18, d: lfrq });
        this._initialized = true;
      }

      this._regs[data.a] = data.d;
      if ((0x28 <= data.a && data.a <= 0x2f) || (0x30 <= data.a && data.a <= 0x37)) {
        const ch = data.a - (data.a < 0x30 ? 0x28 : 0x30);
        const orgKeyIndex = keyCodeToIndex[this._regs[0x28 + ch] & 0xf];
        const orgKey = (orgKeyIndex << 8) | (this._regs[0x30 + ch] & 0xfc);
        let octave = (this._regs[0x28 + ch] >> 4) & 0x7;
        let newKey = orgKey + this._keyDiff;
        if (newKey < 0) {
          if (0 < octave) {
            octave--;
            newKey += 12 << 8;
          } else {
            newKey = 0;
          }
        } else if (newKey >= 12 << 8) {
          if (octave < 7) {
            octave++;
            newKey -= 12 << 8;
          } else {
            newKey = (12 << 8) - 1;
          }
        }
        const okc = (octave << 4) | keyIndexToCode[newKey >> 8];
        if (this._outRegs[0x28 + ch] != okc) {
          result.push({ port: data.port, a: 0x28 + ch, d: okc });
          this._outRegs[0x28 + ch] = okc;
        }
        const kf = newKey & 0xfc;
        if (this._outRegs[0x30 + ch] != kf) {
          result.push({ port: data.port, a: 0x30 + ch, d: kf });
          this._outRegs[0x30 + ch] = kf;
        }
        return result;
      } else if (data.a === 0x0f) {
        const nfrq = Math.min(0x1f, Math.round((data.d & 0x1f) * this._ratio));
        result.push({ port: data.port, a: data.a, d: (data.d & 0xe0) | nfrq });
        return result;
      } else if (data.a === 0x18) {
        const lfrq = Math.max(0, Math.min(255, Math.round(this._lfoDiff + data.d)));
        result.push({ port: data.port, a: data.a, d: lfrq });
        return result;
      }
    }
    return [data];
  }
}

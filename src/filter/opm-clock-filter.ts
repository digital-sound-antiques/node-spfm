import { RegisterFilter, RegisterData } from "./register-filter";

const keyCodeToIndex = [0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12];
const keyIndexToCode = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];

export class YM2151ClockFilter implements RegisterFilter {
  _ratio: number;
  _diff: number;
  _regs = new Uint8Array(256);

  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
    this._diff = Math.round(12 * Math.log2(1.0 / this._ratio) * 256);
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (this._ratio !== 1.0 && data.a != null) {
      this._regs[data.a] = data.d;
      if ((0x28 <= data.a && data.a <= 0x2f) || (0x30 <= data.a && data.a <= 0x37)) {
        const ch = data.a - (data.a < 0x30 ? 0x28 : 0x30);
        const orgKeyIndex = keyCodeToIndex[this._regs[0x28 + ch] & 0xf];
        const orgKey = (orgKeyIndex << 8) | this._regs[0x28 + ch];
        let octave = (this._regs[0x28 + ch] >> 4) & 0x7;
        let newKey = orgKey + this._diff;
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
        return [
          { port: data.port, a: 0x30 + ch, d: newKey & 0xfc },
          { port: data.port, a: 0x28 + ch, d: (octave << 4) | keyIndexToCode[newKey >> 8] }
        ];
      } else if (data.a === 0x0f) {
        const nfrq = Math.min(0x1f, Math.round((data.d & 0x1f) * this._ratio));
        return [{ port: data.port, a: data.a, d: (data.d & 0xe0) | nfrq }];
      } else if (data.a === 0x18) {
        const lfrq = Math.min(0xff, Math.round(data.d * this._ratio));
        return [{ port: data.port, a: data.a, d: (data.d & 0xe0) | lfrq }];
      }
    }
    return [data];
  }
}

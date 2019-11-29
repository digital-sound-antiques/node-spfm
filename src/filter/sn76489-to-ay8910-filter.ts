import { RegisterFilter, RegisterData } from "./register-filter";

const voltbl = [15, 14, 14, 13, 12, 12, 11, 10, 10, 9, 8, 8, 7, 6, 6, 0];

export default class SN76489ToAY8910Filter implements RegisterFilter {
  _freq = new Uint16Array(4);
  _ay8910Regs = new Uint8Array(16);
  _ch = 0;
  _type = 0;
  _initialized = false;

  _makeDiff(src: RegisterData[]) {
    const diff = src.filter(e => this._ay8910Regs[e.a!] != e.d);
    for (const e of src) {
      this._ay8910Regs[e.a!] = e.d;
    }
    return diff;
  }

  filterReg(context: any, data: RegisterData): RegisterData[] {
    const port = 0;
    const result = [];

    if (!this._initialized) {
      result.push({ port, a: 7, d: 0x38 });
      this._initialized = true;
    }

    if (data.d & 0x80) {
      const ch = (data.d >> 5) & 3;
      const type = (data.d >> 4) & 1;
      this._ch = ch;
      this._type = type;
      if (type) {
        if (ch < 3) {
          result.push({ port, a: 8 + ch, d: voltbl[data.d & 0xf] });
        }
      } else {
        if (ch < 3) {
          const new_freq = (this._freq[ch] & 0x3f0) | (data.d & 0xf);
          result.push({ port, a: ch * 2, d: new_freq & 0xff });
          this._freq[ch] = new_freq;
        }
      }
    } else {
      const ch = this._ch;
      const type = this._type;
      if (type) {
        if (ch < 3) {
          result.push({ port, a: 8 + ch, d: voltbl[data.d & 0xf] });
        }
      } else {
        if (ch < 3) {
          const new_freq = ((data.d & 0x3f) << 4) | (this._freq[ch] & 0xf);
          result.push({ port, a: ch * 2, d: new_freq & 0xff });
          result.push({ port, a: ch * 2 + 1, d: new_freq >> 8 });
          this._freq[ch] = new_freq;
        }
      }
    }

    return this._makeDiff(result);
  }
}

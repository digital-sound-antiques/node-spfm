import { RegisterFilter, RegisterData } from "./register-filter";

export default class SN76489ClockFilter implements RegisterFilter {
  _freq = new Uint16Array(4);
  _dh = new Uint8Array(4);
  _dl = new Uint8Array(4);
  _ch = 0;
  _type = 0;
  _ratio = 1.0;
  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
  }

  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (data.d & 0x80) {
      const ch = (data.d >> 5) & 3;
      const type = (data.d >> 4) & 1;
      this._ch = ch;
      this._type = type;

      if (type === 0) {
        if (ch < 3) {
          const freq = (this._freq[ch] & 0x3f0) | (data.d & 0xf);
          this._freq[ch] = freq;
          const adj_freq = Math.min(0x3ff, Math.round(freq * this._ratio));
          const dl = 0x80 | (ch << 5) | (adj_freq & 0xf);
          this._dl[ch] = dl;
          const dh = adj_freq >> 4;
          if (this._dh[ch] != dh) {
            this._dh[ch] = dh;
            return [
              { port: data.port, a: data.a, d: dl },
              { port: data.port, a: data.a, d: dh },
              { port: data.port, a: data.a, d: dl } // latch again
            ];
          } else {
            return [{ port: data.port, a: data.a, d: dl }];
          }
        }
      }
    } else {
      const ch = this._ch;
      const type = this._type;

      if (type === 0) {
        if (ch < 3) {
          const freq = ((data.d & 0x3f) << 4) | (this._freq[ch] & 0xf);
          this._freq[ch] = freq;
          const adj_freq = Math.min(0x3ff, Math.round(freq * this._ratio));
          const dl = 0x80 | (ch << 5) | (adj_freq & 0xf);
          const dh = adj_freq >> 4;
          this._dh[ch] = dh;
          if (this._dl[ch] != dl) {
            return [
              { port: data.port, a: data.a, d: dl },
              { port: data.port, a: data.a, d: dh }
            ];
          } else {
            return [{ port: data.port, a: data.a, d: dh }];
          }
        }
      }
    }
    return [data];
  }
}

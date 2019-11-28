import { RegisterFilter, RegisterData } from "./register-filter";

export class YM3526ClockFilter implements RegisterFilter {
  _ratio: number;
  _regs = new Uint8Array(256);
  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (this._ratio !== 1.0 && data.a != null) {
      if (0xa0 <= data.a && data.a < 0xc0) {
        this._regs[data.a] = data.d;
        const al = data.a & 0xaf;
        const ah = (data.a & 0xaf) + 0x10;
        const fnum = ((this._regs[ah] & 3) << 8) | this._regs[al];
        const new_fnum = Math.min(0x3ff, fnum / this._ratio);
        const dl = new_fnum & 0xff;
        const dh = (this._regs[ah] & 0xfc) | (new_fnum >> 8);
        return [
          { port: data.port, a: ah, d: dh },
          { port: data.port, a: al, d: dl }
        ];
      }
    }
    return [data];
  }
}

export class YM2413ClockFilter implements RegisterFilter {
  _ratio: number;
  _regs = new Uint8Array(256);
  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (this._ratio !== 1.0 && data.a != null) {
      if (0x10 <= data.a && data.a < 0x30) {
        this._regs[data.a] = data.d;
        const al = (data.a & 0xf) + 0x10;
        const ah = (data.a & 0xf) + 0x20;
        const fnum = ((this._regs[ah] & 1) << 8) | this._regs[al];
        const new_fnum = Math.min(0x1ff, fnum / this._ratio);
        const dl = new_fnum & 0xff;
        const dh = (this._regs[ah] & 0xfe) | (new_fnum >> 8);
        return [
          { port: data.port, a: ah, d: dh },
          { port: data.port, a: al, d: dl }
        ];
      }
    }
    return [data];
  }
}

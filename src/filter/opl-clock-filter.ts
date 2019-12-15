import { RegisterFilter, RegisterData } from "./register-filter";

export class YM3526ClockFilter implements RegisterFilter {
  _ratio: number;
  _regs = new Uint8Array(256);
  _outRegs = new Uint8Array(256);
  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
    for (let i = 0; i < this._outRegs.length; i++) {
      this._outRegs[i] = -1;
    }
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (this._ratio !== 1.0 && data.a != null) {
      if (0xa0 <= data.a && data.a < 0xc0) {
        this._regs[data.a] = data.d;
        const al = data.a & 0xaf;
        const ah = (data.a & 0xaf) + 0x10;
        const fnum = ((this._regs[ah] & 3) << 8) | this._regs[al];
        let new_fnum = Math.round(fnum / this._ratio);
        let new_blk = (this._regs[ah] & 0x1c) >> 2;
        while (new_fnum > 0x3ff) {
          new_fnum >>= 1;
          new_blk++;
        }
        if (new_blk > 7) {
          new_blk = 7;
          new_fnum = 0x3ff;
        }
        const dl = new_fnum & 0xff;
        const dh = (this._regs[ah] & 0xe0) | (new_blk << 2) | (new_fnum >> 8);
        const result = [];
        if (this._outRegs[ah] != dh) {
          result.push({ port: data.port, a: ah, d: dh });
          this._outRegs[ah] = dh;
        }
        if (this._outRegs[al] != dl) {
          result.push({ port: data.port, a: al, d: dl });
          this._outRegs[al] = dl;
        }
        return result;
      }
    }
    return [data];
  }
}

export class YM2413ClockFilter implements RegisterFilter {
  _ratio: number;
  _regs = new Uint8Array(256);
  _outRegs = new Uint8Array(256);
  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
    for (let i = 0; i < this._outRegs.length; i++) {
      this._outRegs[i] = -1;
    }
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (this._ratio !== 1.0 && data.a != null) {
      if (0x10 <= data.a && data.a < 0x30) {
        this._regs[data.a] = data.d;
        const al = (data.a & 0xf) + 0x10;
        const ah = (data.a & 0xf) + 0x20;
        const fnum = ((this._regs[ah] & 1) << 8) | this._regs[al];
        let new_fnum = Math.round(fnum / this._ratio);
        let new_blk = (this._regs[ah] & 0xe) >> 1;
        while (new_fnum > 0x1ff) {
          new_fnum >>= 1;
          new_blk++;
        }
        if (new_blk > 7) {
          new_blk = 7;
          new_fnum = 0x1ff;
        }
        const dl = new_fnum & 0xff;
        const dh = (this._regs[ah] & 0xf0) | (new_blk << 1) | (new_fnum >> 8);
        const result = [];
        if (this._outRegs[ah] != dh) {
          result.push({ port: data.port, a: ah, d: dh });
          this._outRegs[ah] = dh;
        }
        if (this._outRegs[al] != dl) {
          result.push({ port: data.port, a: al, d: dl });
          this._outRegs[al] = dl;
        }
        return result;
      }
    }
    return [data];
  }
}

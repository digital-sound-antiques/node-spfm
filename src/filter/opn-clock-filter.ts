import { RegisterFilter, RegisterData } from "./register-filter";
import AY8910ClockFilter from "./ay8910-clock-filter";

abstract class OPNClockFilterBase implements RegisterFilter {
  _ratio: number;
  _regs = [new Uint8Array(256), new Uint8Array(256)];
  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (this._ratio !== 1.0 && data.port != null && data.a != null) {
      const regs = this._regs[data.port];
      regs[data.a] = data.d;
      if (0xa0 <= data.a && data.a < 0xb0) {
        const al = 0xa0 + (data.a & 3) + (data.a & 8);
        const ah = al + 4;
        const fnum = ((regs[ah] & 7) << 8) | regs[al];
        let new_fnum = Math.round(fnum / this._ratio);
        let new_blk = (regs[ah] >> 3) & 7;
        while (new_fnum > 0x7ff) {
          new_fnum >>= 1;
          new_blk++;
        }
        if (new_blk > 7) {
          new_blk = 7;
          new_fnum = 0x7ff;
        }
        const dl = new_fnum & 0xff;
        const dh = (new_blk << 3) | (new_fnum >> 8);
        return [
          { port: data.port, a: ah, d: dh },
          { port: data.port, a: al, d: dl }
        ];
      }
    }
    return [data];
  }
}

export class YM2612ClockFilter extends OPNClockFilterBase {}

export class YM2203ClockFilter extends OPNClockFilterBase {
  _psgFilter: AY8910ClockFilter;

  constructor(inClock: number, outClock: number) {
    super(inClock, outClock);
    this._psgFilter = new AY8910ClockFilter(inClock, outClock);
  }

  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (data.a != null) {
      if (data.a < 0x10) {
        return this._psgFilter.filterReg(context, data);
      }
    }
    return super.filterReg(context, data);
  }
}

export class YM2608ClockFilter extends OPNClockFilterBase {
  _psgFilter: AY8910ClockFilter;

  constructor(inClock: number, outClock: number) {
    super(inClock, outClock);
    this._psgFilter = new AY8910ClockFilter(inClock, outClock);
  }

  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (data.a != null) {
      if (data.port === 0 && data.a < 0x10) {
        return this._psgFilter.filterReg(context, data);
      }
    }
    return super.filterReg(context, data);
  }
}

import { RegisterFilter, RegisterData } from "./register-filter";
import AY8910ClockFilter from "./ay8910-clock-filter";

abstract class OPNClockFilterBase implements RegisterFilter {
  _ratio: number;
  _regs = new Uint8Array(256);
  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (data.a != null) {
      if (0xa0 <= data.a && data.a < 0xb0) {
        this._regs[data.a] = data.d;
        const al = data.a & 0xfb;
        const ah = (data.a & 0xfb) + 4;
        const fnum = ((this._regs[ah] & 7) << 8) | this._regs[al];
        const new_fnum = Math.min(0x7ff, fnum / this._ratio);
        const dl = new_fnum & 0xff;
        const dh = (this._regs[ah] & 0xf8) | (new_fnum >> 8);
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

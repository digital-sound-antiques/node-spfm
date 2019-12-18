import { RegisterFilter, RegisterData } from "./register-filter";

export class OKIM6258ClockFilter implements RegisterFilter {
  _ratio: number;
  _regs = new Uint8Array(8);
  constructor(inClock: number, outClock: number) {
    this._ratio = inClock / outClock;
  }
  filterReg(context: any, data: RegisterData): RegisterData[] {
    return [];
  }
}

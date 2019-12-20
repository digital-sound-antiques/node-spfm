import { RegisterData } from "./register-filter";

export default class RegisterDataBuffer {
  _outRegs: Int16Array[] = [];
  _buf: Array<RegisterData> = [];
  constructor(maxRegs: number, maxPorts: number = 1) {
    for (let i = 0; i < maxPorts; i++) {
      this._outRegs.push(new Int16Array(maxRegs).fill(-1));
    }
  }

  push(e: RegisterData, optimize = true) {
    if (optimize) {
      if (this._outRegs[e.port!][e.a!] !== e.d) {
        const index = this._buf.findIndex(x => x.port === e.port && x.a === e.a);
        if (0 <= index) {
          this._buf.splice(index, 1);
        }
        this._buf.push(e);
      }
    } else {
      this._buf.push(e);
    }
  }

  commit(): RegisterData[] {
    const result = Array<RegisterData>();
    for (const e of this._buf) {
      this._outRegs[e.port!][e.a!] = e.d;
      result.push(e);
    }
    this._buf = [];
    return result;
  }
}

import { RegisterFilter, RegisterData } from "./register-filter";

export default class YM2612ToYM2608Filter implements RegisterFilter {
  _initialized = false;
  filterReg(context: any, data: RegisterData): RegisterData[] {
    if (data.port == 0 && !this._initialized) {
      this._initialized = true;
      return [{ port: data.port, a: 0x29, d: 0x80 }, data];
    }
    return [data];
  }
}

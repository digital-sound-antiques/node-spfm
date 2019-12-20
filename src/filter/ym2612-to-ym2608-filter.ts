import { RegisterFilter, RegisterData } from "./register-filter";
import PSGDACTable from "./psg-dac-table";
import SPFMModule from "src/spfm-module";

export default class YM2612ToYM2608Filter implements RegisterFilter {
  _div = 0;
  _dacEnabled = false;
  async initialize(mod: SPFMModule) {
    const data: Array<RegisterData> = [
      { port: 0, a: 0x29, d: 0x80 }, // enable FM 4-6ch
      { port: 0, a: 0x07, d: 0x3f }, // ssg all mute for pcm
      { port: 0, a: 0x08, d: 0 },
      { port: 0, a: 0x09, d: 0 },
      { port: 0, a: 0x0a, d: 0 }
    ];
    await mod.spfm.writeRegs(mod.slot, data);
  }

  filterReg(context: any, data: RegisterData): RegisterData[] {
    const result = Array<RegisterData>();

    if (data.port === 0) {
      if (data.a === 0x2a) {
        if (this._dacEnabled && this._div % 2 === 0) {
          const v = Math.min(765, Math.round(data.d * 4));
          const r = PSGDACTable[v];
          result.push({ port: 0, a: 0x08, d: r[0] });
          result.push({ port: 0, a: 0x09, d: r[1] });
          result.push({ port: 0, a: 0x0a, d: r[2] });
        }
        this._div++;
      } else if (data.a === 0x2b) {
        this._dacEnabled = data.d & 0x80 ? true : false;
      } else {
        result.push(data);
      }
    } else {
      result.push(data);
    }

    return result;
  }
}

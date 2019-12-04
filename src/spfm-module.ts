import SPFM from "./spfm";
import { RegisterFilter, RegisterFilterBuilder, RegisterData } from "./filter/register-filter";

export type SPFMModuleInfo = {
  deviceId: string;
  rawType: string;
  type: string;
  slot: number;
  rawClock: number;
  clock: number;
  clockConverter: RegisterFilterBuilder | null;
  typeConverter: RegisterFilterBuilder | null;
};

export default class SPFMModule {
  spfm: SPFM;
  moduleInfo: SPFMModuleInfo;
  type: string;
  slot: number;
  requestedClock: number;
  _filters: RegisterFilter[] = [];
  _writeWait = 0;
  constructor(spfm: SPFM, moduleInfo: SPFMModuleInfo, requestedClock: number) {
    this.spfm = spfm;
    this.moduleInfo = moduleInfo;
    this.type = moduleInfo.type;
    this.slot = moduleInfo.slot;
    this.requestedClock = requestedClock;

    const outModuleInfo = { ...moduleInfo, clock: requestedClock };
    if (moduleInfo.clockConverter) {
      this._filters.push(moduleInfo.clockConverter(moduleInfo, outModuleInfo));
    }
    if (moduleInfo.typeConverter) {
      this._filters.push(moduleInfo.typeConverter(moduleInfo, outModuleInfo));
    }

    this._writeWait = this.moduleInfo.rawType === "ym2413" ? 1 : 0;
  }

  get isCompatible() {
    return this.type !== this.rawType;
  }

  get rawType() {
    return this.moduleInfo.rawType;
  }

  get rawClock() {
    return this.moduleInfo.rawClock;
  }

  get clock() {
    return this.moduleInfo.clock;
  }

  get deviceId() {
    return this.moduleInfo.deviceId;
  }

  addFilter(filter: RegisterFilter) {
    this._filters.push(filter);
  }

  async writeNop(n: number) {
    return this.spfm.writeNop(n);
  }

  async writeReg(port: number | null, a: number | null, d: number) {
    let regDatas: RegisterData[] = [{ port, a, d }];
    for (const filter of this._filters) {
      let res: RegisterData[] = [];
      for (const data of regDatas) {
        const filtered = filter.filterReg(this, data);
        for (const data of filtered) {
          res.push(data);
        }
      }
      regDatas = res;
    }
    await this.spfm.writeRegs(this.slot, regDatas, this._writeWait);
  }

  getDebugString() {
    return `${this.spfm.path} slot${this.slot}=${this.type}`;
  }
}

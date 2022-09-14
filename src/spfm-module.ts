import SPFM from "./spfm";
import { RegisterFilter, RegisterFilterBuilder, RegisterData } from "./filter/register-filter";

async function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}

export type SPFMModuleInfo = {
  deviceId: string;
  rawType: string;
  group?: number;
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

    switch (this.moduleInfo.rawType) {
      case "ym2413":
      case "ym3812":
      case "ym3526":
      case "y8950":
        this._writeWait = 1; // wait for slow chips
        break;
      default:
        this._writeWait = 0;
        break;
    }
  }

  async initialize() {
    switch (this.rawType) {
      case "ym2413":
        for (let i = 0; i < 0x40; i++) {
          await this.spfm.writeReg(this.slot, 0, i, 0);
        }
        break;
    }
    for (const filter of this._filters) {
      if ((filter as any).initialize != null) {
        await (filter as any).initialize(this);
      }
    }
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

  async damp() {
    switch (this.type) {
      case "ym2151":
        /* sl=15,rr=15 */
        for (let i = 0xe0; i < 0xff; i++) {
          await this.writeReg(0, i, 0xff);
        }
        /* fm key-off */
        for (let i = 0; i < 8; i++) {
          await this.writeReg(0, 0x08, i);
        }
        /* full reset */
        for (let i = 0; i <= 0xff; i++) {
          await this.writeReg(0, i, 0);
        }
        break;
      case "ym2608":
        /* ssg mute */
        await this.writeReg(0, 6, 0x3f);
        await this.writeReg(0, 8, 0x00);
        await this.writeReg(0, 9, 0x00);
        await this.writeReg(0, 10, 0x00);
        /* adpcm reset */
        await this.writeReg(1, 0x00, 0x01);
        /* rhythm damp */
        await this.writeReg(0, 0x10, 0xff);
        /* sl=15,rr=15 */
        for (let i = 0x80; i < 0x90; i++) {
          await this.writeReg(0, i, 0xff);
          await this.writeReg(1, i, 0xff);
        }
        /* fm key-off */
        for (let i = 0; i < 8; i++) {
          await this.writeReg(0, 0x28, i);
        }
        break;
      case "ym2612":
        /* sl=15,rr=15 */
        for (let i = 0x80; i < 0x90; i++) {
          await this.writeReg(0, i, 0xff);
          await this.writeReg(1, i, 0xff);
        }
        /* fm key-off */
        for (let i = 0; i < 8; i++) {
          await this.writeReg(0, 0x28, i);
        }
        break;
      case "ym2203":
        /* ssg mute */
        await this.writeReg(0, 6, 0x3f);
        await this.writeReg(0, 8, 0x00);
        await this.writeReg(0, 9, 0x00);
        await this.writeReg(0, 10, 0x00);
        /* sl=15,rr=15 */
        for (let i = 0x80; i < 0x90; i++) {
          await this.writeReg(0, i, 0xff);
        }
        /* fm key-off */
        for (let i = 0; i < 4; i++) {
          await this.writeReg(0, 0x28, i);
        }
        break;
      case "ym3526":
      case "ym3812":
      case "y8950":
        /* sl=15,rr=15 */
        for (let i = 0x80; i < 0xa0; i++) {
          await this.writeReg(0, i, 0xff);
        }
        /* freq=0, key-off */
        for (let i = 0xa0; i < 0xc0; i++) {
          await this.writeReg(0, i, 0);
        }
        /* rhythm off */
        await this.writeReg(0, 0xbd, 0);
        break;
      case "ym2413":
        /* freq=0, key-off */
        for (let i = 0x10; i < 0x30; i++) {
          await this.writeReg(0, i, 0);
        }
        break;
      case "ay8910":
        /* psg mute */
        await this.writeReg(0, 6, 0x3f);
        await this.writeReg(0, 8, 0x00);
        await this.writeReg(0, 9, 0x00);
        await this.writeReg(0, 10, 0x00);
        break;
      case "sn76489":
        /* vol = 0 */
        await this.writeReg(null, null, 0x9f);
        await this.writeReg(null, null, 0xbf);
        await this.writeReg(null, null, 0xdf);
        await this.writeReg(null, null, 0xff);
        /* freq = 0 */
        await this.writeReg(null, null, 0x80 | (0 << 5));
        await this.writeReg(null, null, 0);
        await this.writeReg(null, null, 0x80 | (1 << 5));
        await this.writeReg(null, null, 0);
        await this.writeReg(null, null, 0x80 | (2 << 5));
        await this.writeReg(null, null, 0);
        await this.writeReg(null, null, 0x80 | (3 << 5));
        await this.writeReg(null, null, 0);
        break;
      default:
        await this.spfm.reset();
        break;
    }
  }

  getDebugString() {
    return `${this.spfm.path} slot${this.slot}=${this.type}`;
  }
}

import SPFM from "./spfm";
import SPFMMapperConfig from "./spfm-mapper-config";

export type CompatSpec = {
  type: string;
  clockDiv: number;
};

export type RegisterData = {
  port: number | null;
  a: number | null;
  d: number;
};

export interface SPFMRegisterFilter {
  filterReg(mod: ReBirthModule, data: RegisterData): RegisterData[];
}

export class AY8910RateFilter implements SPFMRegisterFilter {
  _ratio: number;
  _regs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  constructor(inClock: number, outClock: number) {
    if (1789770 <= outClock && outClock <= 1789773) {
      // correct clock for inaccurate VGM header.
      outClock = 3579545 / 2;
    }
    this._ratio = inClock / outClock;
  }

  filterReg(mod: any, data: RegisterData): RegisterData[] {
    if (data.a != null && 0 <= data.a && data.a < 16) {
      this._regs[data.a] = data.d;
      if (data.a < 6) {
        // freq
        const ah = data.a | 1;
        const al = data.a & 6;
        const raw = ((this._regs[ah] & 0x0f) << 8) | this._regs[al];
        const adj = Math.min(0x0fff, Math.round(raw * this._ratio));
        return [
          { port: data.port, a: al, d: adj & 0xff },
          { port: data.port, a: ah, d: adj >> 8 }
        ];
      } else if (data.a === 6) {
        // noise freq
        const raw = this._regs[6] & 0x1f;
        const adj = Math.min(0xfff, Math.round(raw * this._ratio));
        return [{ port: data.port, a: data.a, d: adj }];
      } else if (data.a == 11 || data.a == 12) {
        // envelope freq
        const ah = 12;
        const al = 11;
        const raw = (this._regs[ah] << 8) | this._regs[al];
        const adj = Math.min(0xffff, Math.round(raw * this._ratio));
        return [
          { port: data.port, a: al, d: adj & 0xff },
          { port: data.port, a: ah, d: adj >> 8 }
        ];
      }
    }
    return [data];
  }
}

export class ReBirthModule {
  spfm: SPFM;
  type: string;
  slot: number;
  clock: number;
  requestedClock: number;
  _filters: SPFMRegisterFilter[] = [];
  constructor(spfm: SPFM, slot: number, type: string, clock: number, requestedClock: number) {
    this.spfm = spfm;
    this.type = type;
    this.slot = slot;
    this.clock = clock;
    this.requestedClock = requestedClock;
  }

  addFilter(filter: SPFMRegisterFilter) {
    this._filters.push(filter);
  }

  async writeReg(port: number | null, a: number | null, d: number) {
    let regDatas: RegisterData[] = [{ port, a, d }];
    for (let filter of this._filters) {
      let res: RegisterData[] = [];
      for (let data of regDatas) {
        res = res.concat(filter.filterReg(this, data));
      }
      regDatas = res;
    }
    for (let data of regDatas) {
      await this.spfm.writeReg(this.slot, data.port, data.a, data.d);
    }
  }

  getDebugString() {
    return `${this.spfm._path} slot${this.slot}=${this.type}`;
  }
}

export function getCompatibleDevices(type: string): CompatSpec[] {
  switch (type) {
    case "ym3526":
      return [{ type: "y8950", clockDiv: 1 }];
    case "ym8950":
      return [{ type: "ym3526", clockDiv: 1 }];
    case "ym3812":
      return [
        { type: "ym3526", clockDiv: 1 },
        { type: "y8950", clockDiv: 1 }
      ];
    case "ym2203":
      return [{ type: "ay8910", clockDiv: 2 }];
    case "ym2608":
      return [
        { type: "ym2612", clockDiv: 2 },
        { type: "ym2203", clockDiv: 2 },
        { type: "ay8910", clockDiv: 4 }
      ];
    default:
      return [];
  }
}

export function createCompatibleModule(mod: ReBirthModule, compat: CompatSpec): ReBirthModule {
  if (compat.type === "ay8910") {
    const filter = new AY8910RateFilter(mod.clock / compat.clockDiv, mod.requestedClock / compat.clockDiv);
    mod.addFilter(filter);
  }
  return mod;
}

export default class SPFMMapper {
  _config: SPFMMapperConfig;
  _spfms: SPFM[] = [];
  _spfmMap: { [key: string]: ReBirthModule } = {};

  constructor(config: SPFMMapperConfig) {
    this._config = config;
  }

  async open(devicesToOpen: { [key: string]: number }) {
    const spfms: { [key: string]: SPFM } = {};
    const ports = await SPFM.rawList();

    for (const device of this._config.devices) {
      const { id, modules } = device;
      try {
        const port = ports.find(e => e.serialNumber === id);
        if (port == null) {
          throw new Error("Can't find the device ${id}.");
        }
        const spfm = new SPFM(port.path);
        await spfm.open();
        this._spfms.push(spfm);

        for (const module of modules) {
          if (module.type) {
            const { slot, type, clock } = module;

            /* prepare primary module */
            const requestedClock = devicesToOpen[type];
            if (requestedClock != null) {
              const newMod = new ReBirthModule(spfm, slot, type, clock, requestedClock);
              const oldMod = this._spfmMap[module.type];
              if (oldMod) {
                /* if the same module is installed, nearest clock module will be  used. */
                if (Math.abs(oldMod.clock - requestedClock) > Math.abs(newMod.clock - requestedClock)) {
                  this._spfmMap[module.type] = newMod;
                }
              } else {
                this._spfmMap[module.type] = newMod;
              }
            }

            /* prepare compatible module */
            const compats = getCompatibleDevices(type);
            for (const compat of compats) {
              if (this._spfmMap[compat.type] == null) {
                const requestedClock = devicesToOpen[compat.type];
                if (requestedClock != null) {
                  const mod = createCompatibleModule(
                    new ReBirthModule(spfm, slot, type, clock, requestedClock * compat.clockDiv),
                    compat
                  );
                  if (mod != null) {
                    this._spfmMap[compat.type] = mod;
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.info(e.message);
      }
    }
    return this._spfmMap;
  }

  getModule(type: string) {
    return this._spfmMap[type];
  }

  async writeReg(type: string, port: number | null, a: number | null, d: number) {
    const mod = this.getModule(type);
    if (mod) {
      await mod.writeReg(port, a, d);
    }
  }

  async reset() {
    for (const spfm of this._spfms) {
      await spfm.reset();
    }
  }

  async close() {
    for (const spfm of this._spfms) {
      await spfm.close();
    }
    this._spfms = [];
    this._spfmMap = {};
  }
}

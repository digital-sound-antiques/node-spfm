import SPFM from "./spfm";
import SPFMMapperConfig, { SPFMModuleConfig, SPFMDeviceConfig } from "./spfm-mapper-config";

export type CompatSpec = {
  type: string;
  clockDiv: number;
};

export type RegisterData = {
  port: number | null;
  a: number | null;
  d: number;
};

type ModuleInfo = {
  deviceId: string;
  rawType: string;
  type: string;
  slot: number;
  rawClock: number;
  clock: number;
  clockConverter: SPFMRegisterFilterBuilder | null;
};

export interface SPFMRegisterFilter {
  filterReg(mod: SPFMModule, data: RegisterData): RegisterData[];
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

export class SPFMModule {
  spfm: SPFM;
  moduleInfo: ModuleInfo;
  type: string;
  slot: number;
  requestedClock: number;
  _filters: SPFMRegisterFilter[] = [];
  constructor(spfm: SPFM, moduleInfo: ModuleInfo, requestedClock: number) {
    this.spfm = spfm;
    this.moduleInfo = moduleInfo;
    this.type = moduleInfo.type;
    this.slot = moduleInfo.slot;
    this.requestedClock = requestedClock;
    if (moduleInfo.clockConverter) {
      this._filters.push(moduleInfo.clockConverter(moduleInfo, { ...moduleInfo, clock: requestedClock }));
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

  addFilter(filter: SPFMRegisterFilter) {
    this._filters.push(filter);
  }

  async writeNop(n: number) {
    return this.spfm.writeNop(n);
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
    return `${this.spfm.path} slot${this.slot}=${this.type}`;
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

type SPFMRegisterFilterBuilder = (inModule: SPFMModuleConfig, outModule: SPFMModuleConfig) => SPFMRegisterFilter;

function fuzzyClockMatch(a: number, b: number) {
  return b / 1.02 <= a && a <= b * 1.02;
}

export async function getAvailableDevices(
  config: SPFMMapperConfig,
  includeOffline: boolean = false
): Promise<SPFMDeviceConfig[]> {
  if (includeOffline) {
    return config.devices.slice(0);
  }
  const ports = await SPFM.rawList();
  return config.devices.filter(d => {
    if (ports.find(p => p.serialNumber === d.id) != null) {
      return true;
    }
    return false;
  });
}

export function getTypeConverterBuilder(inType: string, outType: string): SPFMRegisterFilterBuilder | null {
  return null;
}

export function getClockConverterBuilder(type: string): SPFMRegisterFilterBuilder | null {
  if (type === "ay8910") {
    return (inModule: SPFMModuleConfig, outModule: SPFMModuleConfig) =>
      new AY8910RateFilter(inModule.clock, outModule.clock);
  }
  return null;
}

export function getAvailableModules(
  availableDevices: SPFMDeviceConfig[],
  options: {
    useClockConverter?: boolean;
    useTypeConverter?: boolean;
  }
): ModuleInfo[] {
  const availableModules: ModuleInfo[] = [];

  // enumerate exact modules
  for (const device of availableDevices) {
    for (let i in device.modules) {
      const module = device.modules[i];
      if (module.type != null) {
        availableModules.push({
          deviceId: device.id,
          rawType: module.type,
          type: module.type,
          slot: module.slot,
          rawClock: module.clock,
          clock: module.clock,
          clockConverter: options.useClockConverter ? getClockConverterBuilder(module.type) : null
        });
      }
    }
  }

  // enumerate compatible modules
  for (const device of availableDevices) {
    for (let i in device.modules) {
      const module = device.modules[i];
      if (module.type != null) {
        const compats = getCompatibleDevices(module.type);
        for (const compat of compats) {
          availableModules.push({
            deviceId: device.id,
            rawType: module.type,
            type: compat.type,
            slot: module.slot,
            rawClock: module.clock,
            clock: module.clock / compat.clockDiv,
            clockConverter: options.useClockConverter ? getClockConverterBuilder(compat.type) : null
          });
        }
      }
    }
  }

  return availableModules;
}

function findModule(availableModules: ModuleInfo[], type: string, clock: number, fuzzyMatch: boolean = false) {
  return availableModules.find(m => {
    if (m.clockConverter == null) {
      if (fuzzyMatch) {
        if (!fuzzyClockMatch(m.clock, clock)) return false;
      } else {
        if (m.clock !== clock) return false;
      }
    }
    return m.type === type;
  });
}

export default class SPFMMapper {
  _config: SPFMMapperConfig;
  _spfms: SPFM[] = [];
  _spfmMap: { [key: string]: [SPFMModule] } = {};

  constructor(config: SPFMMapperConfig) {
    this._config = config;
  }

  async open(modulesToOpen: { type: string; clock: number }[]) {
    const devices = await getAvailableDevices(this._config);
    let availableModules = getAvailableModules(devices, { useClockConverter: true, useTypeConverter: false });

    const ports = await SPFM.rawList();
    const spfms: { [key: string]: SPFM } = {};

    for (const requestedModule of modulesToOpen) {
      const target =
        findModule(availableModules, requestedModule.type, requestedModule.clock) ||
        findModule(availableModules, requestedModule.type, requestedModule.clock, true);

      if (target != null) {
        try {
          const port = ports.find(e => e.serialNumber === target.deviceId);
          if (port == null) {
            throw new Error("Can't find the device ${id}.");
          }
          let spfm = spfms[port.path];
          if (spfm == null) {
            spfm = new SPFM(port.path);
            await spfm.open();
            spfms[port.path] = spfm;
          }
          const mod = new SPFMModule(spfm, target, requestedModule.clock);
          if (this._spfmMap[requestedModule.type] == null) {
            this._spfmMap[requestedModule.type] = [mod];
          } else {
            this._spfmMap[requestedModule.type].push(mod);
          }
          availableModules = availableModules.filter(e => e.deviceId !== target.deviceId || e.slot !== target.slot);
        } catch (e) {
          console.info(e.message);
        }
      }
    }

    this._spfms = Object.values(spfms);
    return this._spfmMap;
  }

  getModule(type: string, index: number): SPFMModule | null {
    const spfms = this._spfmMap[type];
    if (spfms != null) {
      return spfms[index];
    }
    return null;
  }

  async writeReg(type: string, index: number, port: number | null, a: number | null, d: number) {
    const mod = this.getModule(type, index);
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

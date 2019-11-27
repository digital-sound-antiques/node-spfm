import SPFM from "./spfm";
import SPFMMapperConfig, { SPFMModuleConfig, SPFMDeviceConfig } from "./spfm-mapper-config";
import AY8910ClockFilter from "./filter/ay8910-clock-filter";
import { RegisterFilterBuilder } from "./filter/register-filter";
import SPFMModule, { SPFMModuleInfo } from "./spfm-module";
import { YM2203ClockFilter, YM2608ClockFilter, YM2612ClockFilter } from "./filter/opn-clock-filter";
import YM2612ToYM2608Filter from "./filter/ym2612-to-ym2608-filter";

export type CompatSpec = {
  type: string;
  clockDiv: number;
};

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
        { type: "ym2612", clockDiv: 1 },
        { type: "ym2203", clockDiv: 2 },
        { type: "ay8910", clockDiv: 4 }
      ];
    default:
      return [];
  }
}

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

export function getTypeConverterBuilder(inType: string, outType: string): RegisterFilterBuilder | null {
  if (inType === "ym2612" && outType === "ym2608") {
    return () => new YM2612ToYM2608Filter();
  }
  return null;
}

export function getClockConverterBuilder(type: string): RegisterFilterBuilder | null {
  if (type === "ay8910") {
    return (inModule, outModule) => new AY8910ClockFilter(inModule.clock, outModule.clock);
  }
  if (type === "ym2203") {
    return (inModule, outModule) => new YM2203ClockFilter(inModule.clock, outModule.clock);
  }
  if (type === "ym2608") {
    return (inModule, outModule) => new YM2608ClockFilter(inModule.clock, outModule.clock);
  }
  if (type === "ym2612") {
    return (inModule, outModule) => new YM2612ClockFilter(inModule.clock, outModule.clock);
  }
  return null;
}

export function getAvailableModules(
  availableDevices: SPFMDeviceConfig[],
  options: {
    useClockConverter?: boolean;
  }
): SPFMModuleInfo[] {
  const result: SPFMModuleInfo[] = [];

  // enumerate exact modules
  for (const device of availableDevices) {
    for (let i in device.modules) {
      const module = device.modules[i];
      if (module.type != null) {
        result.push({
          deviceId: device.id,
          rawType: module.type,
          type: module.type,
          slot: module.slot,
          rawClock: module.clock,
          clock: module.clock,
          clockConverter: options.useClockConverter ? getClockConverterBuilder(module.type) : null,
          typeConverter: null
        });
      }
    }
  }
  return result;
}

export function getAvailableCompatibleModules(
  availableDevices: SPFMDeviceConfig[],
  options: {
    useClockConverter?: boolean;
    useTypeConverter?: boolean;
  }
): SPFMModuleInfo[] {
  const result: SPFMModuleInfo[] = [];
  for (const device of availableDevices) {
    for (let i in device.modules) {
      const module = device.modules[i];
      if (module.type != null) {
        const compats = getCompatibleDevices(module.type);
        for (const compat of compats) {
          result.push({
            deviceId: device.id,
            rawType: module.type,
            type: compat.type,
            slot: module.slot,
            rawClock: module.clock,
            clock: module.clock / compat.clockDiv,
            clockConverter: options.useClockConverter ? getClockConverterBuilder(compat.type) : null,
            typeConverter: options.useTypeConverter ? getTypeConverterBuilder(compat.type, module.type) : null
          });
        }
      }
    }
  }

  return result;
}

function findModule(availableModules: SPFMModuleInfo[], type: string, clock: number, fuzzyMatch: boolean = false) {
  return availableModules.find(m => {
    if (m.clockConverter == null) {
      if (fuzzyMatch) {
        if (!fuzzyClockMatch(m.clock, clock)) return false;
      } else {
        if (m.clock !== clock) return false;
      }
    }
    if (m.typeConverter != null) return true;
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
    let availableModules = getAvailableModules(devices, { useClockConverter: true });
    let availableCompatibleModules = getAvailableCompatibleModules(devices, {
      useClockConverter: true,
      useTypeConverter: true
    });

    const ports = await SPFM.rawList();
    const spfms: { [key: string]: SPFM } = {};

    for (const requestedModule of modulesToOpen) {
      const target =
        findModule(availableModules, requestedModule.type, requestedModule.clock) ||
        findModule(availableModules, requestedModule.type, requestedModule.clock, true) ||
        findModule(availableCompatibleModules, requestedModule.type, requestedModule.clock) ||
        findModule(availableCompatibleModules, requestedModule.type, requestedModule.clock, true);

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

          /* remove target */
          availableModules = availableModules.filter(e => e.deviceId !== target.deviceId || e.slot !== target.slot);
          availableCompatibleModules = availableCompatibleModules.filter(
            e => e.deviceId !== target.deviceId || e.slot !== target.slot
          );
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

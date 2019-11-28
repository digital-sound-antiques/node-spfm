import SPFM from "./spfm";
import SPFMMapperConfig, { SPFMDeviceConfig } from "./spfm-mapper-config";
import AY8910ClockFilter from "./filter/ay8910-clock-filter";
import { RegisterFilterBuilder } from "./filter/register-filter";
import SPFMModule, { SPFMModuleInfo } from "./spfm-module";
import { YM2203ClockFilter, YM2608ClockFilter, YM2612ClockFilter } from "./filter/opn-clock-filter";
import { YM2413ClockFilter, YM3526ClockFilter } from "./filter/opl-clock-filter";
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
  if (type === "ym2413") {
    return (inModule, outModule) => new YM2413ClockFilter(inModule.clock, outModule.clock);
  }
  if (type === "ym3526" || type === "ym3812" || type === "y8950") {
    return (inModule, outModule) => new YM3526ClockFilter(inModule.clock, outModule.clock);
  }
  return null;
}

export function getAvailableModules(
  availableDevices: SPFMDeviceConfig[],
  options: {
    useClockConverter?: boolean;
  }
): SPFMModuleInfo[] {
  const exacts: SPFMModuleInfo[] = [];
  const adjusts: SPFMModuleInfo[] = [];

  // enumerate exact modules
  for (const device of availableDevices) {
    for (let i in device.modules) {
      const module = device.modules[i];
      if (module.type != null) {
        const info = {
          deviceId: device.id,
          rawType: module.type,
          type: module.type,
          slot: module.slot,
          rawClock: module.clock,
          clock: module.clock,
          clockConverter: null,
          typeConverter: null
        };

        exacts.push(info);

        if (options.useClockConverter) {
          const clockConverter = getClockConverterBuilder(module.type);
          if (clockConverter) {
            adjusts.push({ ...info, clockConverter });
          }
        }
      }
    }
  }
  return exacts.concat(adjusts);
}

export function getAvailableCompatibleModules(
  availableDevices: SPFMDeviceConfig[],
  options: {
    useClockConverter?: boolean;
    useTypeConverter?: boolean;
  }
): SPFMModuleInfo[] {
  const exacts: SPFMModuleInfo[] = [];
  const adjusts: SPFMModuleInfo[] = [];

  for (const device of availableDevices) {
    for (let i in device.modules) {
      const module = device.modules[i];
      if (module.type != null) {
        const compats = getCompatibleDevices(module.type);
        for (const compat of compats) {
          const info = {
            deviceId: device.id,
            rawType: module.type,
            type: compat.type,
            slot: module.slot,
            rawClock: module.clock,
            clock: module.clock / compat.clockDiv,
            clockConverter: null,
            typeConverter: options.useTypeConverter ? getTypeConverterBuilder(compat.type, module.type) : null
          };
          exacts.push(info);
          if (options.useClockConverter) {
            const clockConverter = getClockConverterBuilder(compat.type);
            if (clockConverter) {
              adjusts.push({ ...info, clockConverter });
            }
          }
        }
      }
    }
  }
  return exacts.concat(adjusts);
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
    return m.type === type;
  });
}

export default class SPFMMapper {
  _config: SPFMMapperConfig;
  _spfmMap: { [key: string]: SPFM } = {};
  _spfmModuleMap: { [key: string]: [SPFMModule] } = {};

  constructor(config: SPFMMapperConfig) {
    this._config = config;
  }

  async open(modulesToOpen: { type: string; clock: number }[]) {
    this._spfmModuleMap = {};

    const devices = await getAvailableDevices(this._config);
    let availableModules = getAvailableModules(devices, { useClockConverter: true });
    let availableCompatibleModules = getAvailableCompatibleModules(devices, {
      useClockConverter: true,
      useTypeConverter: true
    });

    const ports = await SPFM.rawList();

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
          let spfm = this._spfmMap[port.path];
          if (spfm == null) {
            spfm = new SPFM(port.path);
            await spfm.open();
            this._spfmMap[port.path] = spfm;
          } else {
          }
          const mod = new SPFMModule(spfm, target, requestedModule.clock);
          if (this._spfmModuleMap[requestedModule.type] == null) {
            this._spfmModuleMap[requestedModule.type] = [mod];
          } else {
            this._spfmModuleMap[requestedModule.type].push(mod);
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
    return this._spfmModuleMap;
  }

  getModule(type: string, index: number): SPFMModule | null {
    const spfms = this._spfmModuleMap[type];
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
    for (const spfm of Object.values(this._spfmMap)) {
      await spfm.reset();
    }
  }

  async damp() {
    for (const mods of Object.values(this._spfmModuleMap)) {
      for (const mod of mods) {
        switch (mod.rawType) {
          case "ym2608":
            /* ssg mute */
            await mod.writeReg(0, 6, 0x3f);
            await mod.writeReg(0, 8, 0x00);
            await mod.writeReg(0, 9, 0x00);
            await mod.writeReg(0, 10, 0x00);
            /* adpcm reset */
            await mod.writeReg(1, 0x00, 0x01);
            /* rhythm damp */
            await mod.writeReg(0, 0x10, 0);
            /* sl=15,rr=15 */
            for (let i = 0x80; i < 0x90; i++) {
              await mod.writeReg(0, i, 0xff);
              await mod.writeReg(1, i, 0xff);
            }
            /* fm key-off */
            for (let i = 0; i < 8; i++) {
              await mod.writeReg(0, 0x28, i);
            }
            break;
          case "ym2612":
            /* sl=15,rr=15 */
            for (let i = 0x80; i < 0x90; i++) {
              await mod.writeReg(0, i, 0xff);
              await mod.writeReg(1, i, 0xff);
            }
            /* fm key-off */
            for (let i = 0; i < 8; i++) {
              await mod.writeReg(0, 0x28, i);
            }
            break;
          case "ym2203":
            /* ssg mute */
            await mod.writeReg(0, 6, 0x3f);
            await mod.writeReg(0, 8, 0x00);
            await mod.writeReg(0, 9, 0x00);
            await mod.writeReg(0, 10, 0x00);
            /* sl=15,rr=15 */
            for (let i = 0x80; i < 0x90; i++) {
              await mod.writeReg(0, i, 0xff);
            }
            /* fm key-off */
            for (let i = 0; i < 4; i++) {
              await mod.writeReg(0, 0x28, i);
            }
            break;
          case "ym3526":
          case "ym3812":
          case "y8950":
            /* sl=15,rr=15 */
            for (let i = 0x80; i < 0xa0; i++) {
              await mod.writeReg(0, i, 0xff);
            }
            /* freq=0, key-off */
            for (let i = 0xa0; i < 0xc0; i++) {
              await mod.writeReg(0, i, 0);
            }
            /* rhythm off */
            await mod.writeReg(0, 0xbd, 0);
            break;
          case "ym2413":
            /* freq=0, key-off */
            for (let i = 0x10; i < 0x30; i++) {
              await mod.writeReg(0, i, 0);
            }
            break;
          case "ay8910":
            /* psg mute */
            await mod.writeReg(0, 6, 0x3f);
            await mod.writeReg(0, 8, 0x00);
            await mod.writeReg(0, 9, 0x00);
            await mod.writeReg(0, 10, 0x00);
            break;
          default:
            await mod.spfm.reset();
            break;
        }
      }
    }
  }

  async close() {
    for (const spfm of Object.values(this._spfmMap)) {
      await spfm.close();
    }
    this._spfmMap = {};
    this._spfmModuleMap = {};
  }
}

import SPFM from "./spfm";
import SPFMMapperConfig, { SPFMDeviceConfig } from "./spfm-mapper-config";
import AY8910ClockFilter from "./filter/ay8910-clock-filter";
import { RegisterFilterBuilder } from "./filter/register-filter";
import SPFMModule, { SPFMModuleInfo } from "./spfm-module";
import { YM2203ClockFilter, YM2608ClockFilter, YM2612ClockFilter } from "./filter/opn-clock-filter";
import { YM2413ClockFilter, YM3526ClockFilter } from "./filter/opl-clock-filter";
import { YM2151ClockFilter } from "./filter/opm-clock-filter";
import SN76489ClockFilter from "./filter/sn76489-clock-filter";
import YM2612ToYM2608Filter from "./filter/ym2612-to-ym2608-filter";
import SN76489ToAY8910Filter from "./filter/sn76489-to-ay8910-filter";
import SN76489ToYM2203Filter from "./filter/sn76489-to-ym2203-filter";
import { SerialPort } from "serialport";
import { PortInfo } from '@serialport/bindings-cpp';
import { OKIM6258ToYM2608Filter } from "./filter/okim6258-to-ym2608-filter";
import { OKIM6258ClockFilter } from "./filter/okim6258-clock-filter";
import YM2413ToYM2608Filter from "./filter/ym2413-to-ym2608-filter";

export type CompatSpec = {
  type: string;
  group?: number;
  clockDiv: number;
  experiment?: boolean;
};

export function getCompatibleDevices(type: string): CompatSpec[] {
  switch (type) {
    case "ym3526":
      return [
        { type: "y8950", clockDiv: 1 },
        { type: "ym3812", clockDiv: 1, experiment: true }
      ];
    case "ym8950":
      return [
        { type: "ym3526", clockDiv: 1 },
        { type: "ym3812", clockDiv: 1, experiment: true }
      ];
    case "ym3812":
      return [
        { type: "ym3526", clockDiv: 1 },
        { type: "y8950", clockDiv: 1 }
      ];
    case "ym2203":
      return [
        { type: "sn76489", clockDiv: 1 },
        { type: "ay8910", clockDiv: 2 }
      ];
    case "ym2608":
      return [
        { type: "ym2612", group: 1 | 2, clockDiv: 1 },
        { type: "ym2203", group: 1 | 2, clockDiv: 2 },
        { type: "ym2413", group: 1, clockDiv: 2, experiment: true },
        { type: "sn76489", group: 1 | 2, clockDiv: 2 },
        { type: "ay8910", group: 2, clockDiv: 4 },
        { type: "okim6258", group: 4, clockDiv: 1 }
      ];
    case "ay8910":
      return [{ type: "sn76489", clockDiv: 0.5 }];
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
  if (inType === "ym2413" && outType === "ym2608") {
    return () => new YM2413ToYM2608Filter();
  }
  if (inType === "sn76489" && outType === "ay8910") {
    return () => new SN76489ToAY8910Filter();
  }
  if (inType === "sn76489" && outType === "ym2203") {
    return () => new SN76489ToYM2203Filter();
  }
  if (inType === "sn76489" && outType === "ym2608") {
    return () => new SN76489ToYM2203Filter();
  }
  if (inType === "okim6258" && outType === "ym2608") {
    return () => new OKIM6258ToYM2608Filter();
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
  if (type === "sn76489") {
    return (inModule, outModule) => new SN76489ClockFilter(inModule.clock, outModule.clock);
  }
  if (type === "ym2151") {
    return (inModule, outModule) => new YM2151ClockFilter(inModule.clock, outModule.clock);
  }
  if (type === "okim6258") {
    return (inModule, outModule) => new OKIM6258ClockFilter(inModule.clock, outModule.clock);
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
            group: compat.group,
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

function findModule(
  availableModules: SPFMModuleInfo[],
  type: string,
  clock: number,
  matchMode: "exact" | "fuzzy" | "convert"
) {
  return availableModules.find(m => {
    if (matchMode === "exact") {
      return m.type === type && m.clock === clock;
    }
    if (matchMode === "fuzzy") {
      return m.type === type && fuzzyClockMatch(m.clock, clock);
    }
    return m.type === type && m.clockConverter != null;
  });
}

type TargetInfo = SPFMModuleInfo & { requestedClock: number };

function checkModuleAlive(mod: SPFMModuleInfo, used: SPFMModuleInfo) {
  if (mod.deviceId !== used.deviceId) {
    return true;
  }
  if (mod.slot !== used.slot) {
    return true;
  }
  if (mod.group != null && used.group != null && (mod.group & used.group) === 0) {
    return true;
  }
  return false;
}

function findTargets(
  ports: PortInfo[],
  directModules: SPFMModuleInfo[],
  compatModules: SPFMModuleInfo[],
  modulesToOpen: { type: string; clock: number }[]
): TargetInfo[] {
  const result: TargetInfo[] = [];
  let directs = [...directModules];
  let compats = [...compatModules];

  for (const m of modulesToOpen) {
    const target =
      findModule(directs, m.type, m.clock, "exact") ||
      findModule(directs, m.type, m.clock, "fuzzy") ||
      findModule(directs, m.type, m.clock, "convert") ||
      findModule(compats, m.type, m.clock, "exact") ||
      findModule(compats, m.type, m.clock, "fuzzy") ||
      findModule(compats, m.type, m.clock, "convert");
    if (target != null) {
      const port = ports.find(e => e.serialNumber === target.deviceId);
      if (port != null) {
        result.push({ requestedClock: m.clock, ...target });
        /* remove used target */
        directs = directs.filter(e => checkModuleAlive(e, target));
        compats = compats.filter(e => checkModuleAlive(e, target));
      }
    }
  }
  return result;
}

function makeCombinations<T>(array: T[], nestLimit: number = 0): T[][] {
  const results: T[][] = [];
  if (nestLimit == 0) {
    nestLimit = array.length;
  }
  if (nestLimit == 1 || array.length == 1) {
    return [array];
  }
  for (let i = 0; i < array.length; i++) {
    const pick = array[i];
    const remains = array.slice(0);
    remains.splice(i, 1);
    const combo = makeCombinations(remains, nestLimit - 1);
    for (const a of combo) {
      results.push([pick].concat(a));
    }
  }
  return results;
}

function findOptimalTargets(
  ports: PortInfo[],
  directModules: SPFMModuleInfo[],
  compatModules: SPFMModuleInfo[],
  modulesToOpen: { type: string; clock: number }[],
  modulePriority: string[]
): TargetInfo[] {
  const priors = [];
  const others = [];
  for (const type of modulePriority) {
    for (const m of modulesToOpen) {
      if (m.type === type) priors.push(m);
    }
  }
  for (const m of modulesToOpen) {
    if (modulePriority.indexOf(m.type) < 0) {
      others.push(m);
    }
  }
  if (1 < others.length && others.length <= 6) {
    const combos = makeCombinations(others, 6);
    let result: TargetInfo[] = [];
    for (const aseq of combos) {
      const targets = findTargets(ports, directModules, compatModules, priors.concat(aseq));
      if (targets.length > result.length) {
        result = targets;
        if (result.length === modulesToOpen.length) {
          break;
        }
      }
    }
    return result;
  }
  return findTargets(ports, directModules, compatModules, priors.concat(others));
}

export default class SPFMMapper {
  _config: SPFMMapperConfig;
  _spfmMap: { [key: string]: SPFM } = {};
  _spfmModuleMap: { [key: string]: [SPFMModule] } = {};

  constructor(config: SPFMMapperConfig) {
    this._config = config;
  }

  async open(modulesToOpen: { type: string; clock: number }[], modulePriority: string[]) {
    this._spfmModuleMap = {};

    const devices = await getAvailableDevices(this._config);
    let directModules = getAvailableModules(devices, { useClockConverter: true });
    let compatModules = getAvailableCompatibleModules(devices, {
      useClockConverter: true,
      useTypeConverter: true
    });

    const ports = await SPFM.rawList();
    const targets = findOptimalTargets(ports, directModules, compatModules, modulesToOpen, modulePriority);

    for (const target of targets) {
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
        }
        const mod = new SPFMModule(spfm, target, target.requestedClock);
        await mod.initialize();
        if (this._spfmModuleMap[target.type] == null) {
          this._spfmModuleMap[target.type] = [mod];
        } else {
          this._spfmModuleMap[target.type].push(mod);
        }
      } catch (e) {
        console.info(e);
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
        switch (mod.type) {
          case "ym2151":
            /* sl=15,rr=15 */
            for (let i = 0xe0; i < 0xff; i++) {
              await mod.writeReg(0, i, 0xff);
            }
            /* fm key-off */
            for (let i = 0; i < 8; i++) {
              await mod.writeReg(0, 0x08, i);
            }
            /* full reset */
            for (let i = 0; i <= 0xff; i++) {
              await mod.writeReg(0, i, 0);
            }
            break;
          case "ym2608":
            /* ssg mute */
            await mod.writeReg(0, 6, 0x3f);
            await mod.writeReg(0, 8, 0x00);
            await mod.writeReg(0, 9, 0x00);
            await mod.writeReg(0, 10, 0x00);
            /* adpcm reset */
            await mod.writeReg(1, 0x00, 0x01);
            /* rhythm damp */
            await mod.writeReg(0, 0x10, 0xff);
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
          case "sn76489":
            /* vol = 0 */
            await mod.writeReg(null, null, 0x9f);
            await mod.writeReg(null, null, 0xbf);
            await mod.writeReg(null, null, 0xdf);
            await mod.writeReg(null, null, 0xff);
            /* freq = 0 */
            await mod.writeReg(null, null, 0x80 | (0 << 5));
            await mod.writeReg(null, null, 0);
            await mod.writeReg(null, null, 0x80 | (1 << 5));
            await mod.writeReg(null, null, 0);
            await mod.writeReg(null, null, 0x80 | (2 << 5));
            await mod.writeReg(null, null, 0);
            await mod.writeReg(null, null, 0x80 | (3 << 5));
            await mod.writeReg(null, null, 0);
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

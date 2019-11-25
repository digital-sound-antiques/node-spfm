import SPFM from "./spfm";
import SPFMMapperConfig from "./spfm-mapper-config";

export class ReBirthModule {
  parent: SPFM;
  type: string;
  slot: number;
  constructor(parent: SPFM, type: string, slot: number) {
    this.parent = parent;
    this.type = type;
    this.slot = slot;
  }

  async writeData(d: number) {
    this.parent.writeData(this.slot, d);
  }

  async writeReg(port: number, a: number, d: number) {
    return this.parent.writeReg(this.slot, port, a, d);
  }

  getDebugString() {
    return `${this.parent._path} slot${this.slot}=${this.type}`;
  }
}

export function getCompatibleDevices(chip: string) {
  switch (chip) {
    case "ym3526":
      return ["y8950"];
    case "ym8950":
      return ["y3526"];
    case "ym3812":
      return ["ym3526", "y8950"];
    case "ym2203":
      return ["ay8910"];
    case "ym2608":
      return ["ym2612", "ym2203", "ay8910"];
    default:
      return [];
  }
}

export default class SPFMMapper {
  _config: SPFMMapperConfig;
  _spfms: SPFM[] = [];
  _spfmMap: { [key: string]: ReBirthModule } = {};

  constructor(config: SPFMMapperConfig) {
    this._config = config;
  }

  async open() {
    const spfms: { [key: string]: SPFM } = {};
    const ports = await SPFM.rawList();

    for (const device of this._config.devices) {
      const { id, modules } = device;
      try {
        const port = ports.find(e => e.serialNumber === id);
        if (port == null) {
          throw new Error("Can't find the device ${id}.");
        }
        const spfm = new SPFM(port.comName);
        await spfm.open();
        this._spfms.push(spfm);
        for (const module of modules) {
          if (module.type) {
            const mod = new ReBirthModule(spfm, module.type, module.slot);
            this._spfmMap[module.type] = mod;
            const compats = getCompatibleDevices(module.type);
            for (const type of compats) {
              if (this._spfmMap[type] == null) {
                this._spfmMap[type] = mod;
              }
            }
          }
        }
      } catch (e) {
        console.info(e.message);
      }
    }
    return spfms;
  }

  getModule(type: string) {
    return this._spfmMap[type];
  }

  async writeData(type: string, d: number) {
    const mod = this.getModule(type);
    if (mod) {
      await mod.writeData(d);
    }
  }

  async writeReg(type: string, port: number, a: number, d: number) {
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

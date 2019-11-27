import fs from "fs-extra";
import path from "path";

export const Version = "0.2.0";

export type SPFMModuleConfig = {
  type: string;
  slot: number;
  clock: number;
};

export type SPFMDeviceConfig = {
  id: string /* serialNumber */;
  modules: SPFMModuleConfig[];
};

export type SPFMMapperConfigObject = {
  version?: string;
  devices: SPFMDeviceConfig[];
};

const stringifyOptions = {
  encoding: "utf-8",
  replacer: null,
  spaces: 2
};

let _defaultConfig: SPFMMapperConfig | null = null;

const NullConfigObject: SPFMMapperConfigObject = {
  version: Version,
  devices: []
};

export default class SPFMMapperConfig {
  static get default(): SPFMMapperConfig {
    if (!_defaultConfig) {
      const homeDir = process.env[process.platform === "win32" ? "USERPROFILE" : "HOME"];
      const cfgHome = process.env["XDG_CONFIG_HOME"] || `${homeDir}/.config`;
      const cfgDir = `${cfgHome}/node-spfm`;
      const cfgFile = `${cfgDir}/mapper.json`;
      _defaultConfig = new SPFMMapperConfig(cfgFile);
    }
    return _defaultConfig;
  }

  _obj: SPFMMapperConfigObject = NullConfigObject;

  _file: string | null;

  constructor(file: string | null) {
    if (file) {
      this._file = file;
      const dir = path.dirname(file);
      if (fs.existsSync(file)) {
        try {
          this._obj = fs.readJSONSync(file, { encoding: "utf-8" }) as SPFMMapperConfigObject;
          return;
        } catch (e) {
          console.error(e);
        }
      }
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
      }
      fs.writeJSONSync(file, this._obj, stringifyOptions);
    } else {
      this._file = null;
    }
  }

  get file(): string | null {
    return this._file;
  }

  get devices(): SPFMDeviceConfig[] {
    return this._obj.devices;
  }

  findDeviceById(id: string): SPFMDeviceConfig | undefined {
    return this._obj.devices.find(e => e.id === id);
  }

  updateDevice(device: SPFMDeviceConfig): void {
    const index = this._obj.devices.findIndex(d => d.id == device.id);
    if (index < 0) {
      this._obj.devices.push(device);
    } else {
      this._obj.devices[index] = device;
    }
    if (this._file) {
      fs.writeJSONSync(this._file, this._obj, stringifyOptions);
    }
  }

  clear(): void {
    if (this._file) {
      fs.unlinkSync(this._file);
    }
    this._obj = NullConfigObject;
  }
}

import fs from "fs-extra";

import { SPFMDeviceConfig } from "./type";

export type SPFMConfig = {
  devices: SPFMDeviceConfig[];
};

const stringifyOptions = {
  encoding: "utf-8",
  replacer: null,
  spaces: 2
};

class _singleton {
  _obj: SPFMConfig = { devices: [] };
  _cfgDir: string;
  _cfgFile: string;

  constructor() {
    const homeDir = process.env[process.platform === "win32" ? "USERPROFILE" : "HOME"];
    const cfgHome = process.env["XDG_CONFIG_HOME"] || `${homeDir}/.config`;
    this._cfgDir = `${cfgHome}/node-spfm`;
    this._cfgFile = `${this._cfgDir}/config.json`;

    if (!fs.existsSync(this._cfgDir)) {
      fs.mkdirSync(this._cfgDir);
    }

    if (fs.existsSync(this._cfgFile)) {
      try {
        this._obj = fs.readJSONSync(this._cfgFile, { encoding: "utf-8" }) as SPFMConfig;
        return;
      } catch (e) {
        console.error(e);
      }
    }
    fs.writeJSONSync(this._cfgFile, this._obj, stringifyOptions);
  }

  get deviceConfigs(): SPFMDeviceConfig[] {
    return this._obj.devices;
  }

  findDeviceConfigByPath(path: string): SPFMDeviceConfig | undefined {
    return this._obj.devices.find(e => e.path === path);
  }

  writeDeviceConfig(device: SPFMDeviceConfig) {
    const index = this._obj.devices.findIndex(d => d.path == device.path);
    if (index < 0) {
      this._obj.devices.push(device);
    } else {
      this._obj.devices[index] = device;
    }
    fs.writeJSONSync(this._cfgFile, this._obj, stringifyOptions);
  }
}

export default new _singleton();

import SerialPort, { parsers } from "serialport";

export type SPFMType = "SPFM" | "SPFM_Light" | null;

export type SPFMPortInfo = SerialPort.PortInfo & {
  type: SPFMType;
};

export default class SPFM {
  path: string;
  baudRate: number;
  _port: SerialPort;

  type: SPFMType = null;

  constructor(path: string, baudRate: number = 1500000) {
    this.path = path;
    this.baudRate = baudRate;
    this._port = new SerialPort(path, {
      baudRate: this.baudRate,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      xon: false,
      xoff: false,
      xany: false,
      rtscts: false,
      highWaterMark: 256 * 1024,
      autoOpen: false
    });
    this._port.setEncoding("utf-8");
  }

  static async rawList(): Promise<SerialPort.PortInfo[]> {
    return (await SerialPort.list()).filter(p => p.vendorId === "0403");
  }

  static async list(): Promise<SPFMPortInfo[]> {
    const portInfos = await this.rawList();
    const result: SPFMPortInfo[] = [];
    for (let portInfo of portInfos) {
      try {
        const spfm = new SPFM(portInfo.path);
        await spfm.open();
        result.push({ ...portInfo, type: spfm.type });
        await spfm.close();
      } catch (e) {
        console.error(e.message); // not a SPFM or permission denied.
      }
    }
    return result;
  }

  get isHighSpeed() {
    return this.baudRate === 1500000;
  }

  async _identify() {
    const byteLength = new parsers.ByteLength({ length: 2 });
    const parser = this._port.pipe(byteLength);
    try {
      await new Promise(async (resolve, reject) => {
        setTimeout(async () => {
          reject(`Serial Connection Timeout`);
        }, 1000);

        parser.on("data", async chunk => {
          const res = chunk.toString();
          try {
            if (res === "LT") {
              this.type = "SPFM_Light";
              await this._write([0xfe]);
            } else if (res === "OK") {
              if (this.type == null) {
                this.type = "SPFM";
              }
              resolve();
            } else {
              reject(`Unknown Response: ${res}`);
            }
          } catch (e) {
            reject(e);
          }
        });

        await this._write([0xff]);
      });
    } finally {
      // console.debug(`Type: ${this.type}, Rate: ${this._baudRate}bps`);
      this._port.unpipe(byteLength);
    }
  }

  async open() {
    return new Promise(async (resolve, reject) => {
      this._port.open(async err => {
        if (err) {
          reject(err);
          return;
        }
        try {
          await this._identify();
          resolve();
        } catch (e) {
          await this.close();
          reject(e);
        }
      });
    });
  }

  async isOpen() {
    return this._port.isOpen;
  }

  async reset() {
    if (this.type === "SPFM_Light") {
      await this._write([0xfe]);
    } else if (this.type === "SPFM") {
      await this._write([0xff]);
    } else {
      // Ignore
    }
  }

  async close() {
    return new Promise(async (resolve, reject) => {
      if (this._port.isOpen) {
        await this.reset();
        this._port.close(err => {
          if (err) {
            reject(err);
          } else {
            this.type = null;
            resolve();
          }
        });
      }
    });
  }

  async _write(data: number[]): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this._port.write(data, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async writeNop(n: number) {
    const d = [];
    for (let i = 0; i < n; i++) {
      d.push(0);
    }
    return this._write(d);
  }

  async writeReg(slot: number, port: number | null, a: number | null, d: number) {
    if (this.type === "SPFM_Light") {
      if (port != null && a != null) {
        await this._write([slot & 1, (port & 7) << 1, a, d, 0x80]);
      } else {
        await this._write([slot & 1, 0x20, d, 0x80]);
      }
    } else if (this.type === "SPFM") {
      if (port != null && a != null) {
        await this._write([((slot & 7) << 4) | (port & 3), a, d, 0x80]);
      } else {
        // Not supported
      }
    }
  }
}

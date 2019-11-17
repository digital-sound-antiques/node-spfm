import SPFMMapper from "../spfm-mapper";

export type Command = {
  type: string;
  port: number;
  a: number;
  d: number;
  nowait?: boolean;
};

export default class CommandBuffer {
  _buf: Command[] = [];

  reset(): void {
    this._buf = [];
  }

  push(cmd: Command): void {
    this._buf.push(cmd);
  }

  get length(): number {
    return this._buf.length;
  }

  async flushTo(mapper: SPFMMapper): Promise<number> {
    let count = 0;
    while (this._buf.length > 0) {
      const cmd = this._buf.shift();
      if (cmd) {
        if (cmd.a >= 0) {
          if (cmd.nowait) {
            await mapper.writeRegNoWait(cmd.type, cmd.port, cmd.a, cmd.d);
          } else {
            await mapper.writeReg(cmd.type, cmd.port, cmd.a, cmd.d);
          }
        } else {
          await mapper.writeData(cmd.type, cmd.d);
        }
      }
      count++;
    }
    return count;
  }
}

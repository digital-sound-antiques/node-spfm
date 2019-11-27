import SPFMMapper from "../spfm-mapper";

export type Command = {
  type: string;
  index: number;
  port: number | null;
  a: number | null;
  d: number;
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
      const cmd = this._buf.shift()!;
      await mapper.writeReg(cmd.type, cmd.index, cmd.port, cmd.a, cmd.d);
      count++;
    }
    return count;
  }
}

import microtime from "microtime";
import SPFMMapper from "../spfm-mapper";
import { VGM } from "vgm-parser";
import AccurateSleeper, { processNodeEventLoop } from "./sleeper";
import Player from "./player";

export default class VGMPlayer implements Player<VGM> {
  _mapper: SPFMMapper;
  _vgm?: VGM;
  _index = 0;
  _data?: DataView;
  _eos = false;
  _sleeper = new AccurateSleeper();
  _currentFrame = 0;
  _waitingFrame = 0;
  _speedRatio = 1.0;
  _loop = 2;

  constructor(mapper: SPFMMapper) {
    this._mapper = mapper;
  }

  reset(): void {
    this._index = 0;
    this._eos = false;
    this._currentFrame = 0;
    this._waitingFrame = 0;
    this._speedRatio = 1.0;
  }

  setData(vgm: VGM): void {
    this._vgm = vgm;
    this._data = new DataView(this._vgm.data);
    this.reset();
  }

  setSpeed(speed: number): void {
    this._speedRatio = Math.pow(2, speed / 4);
  }

  setLoop(loop: number): void {
    this._loop = loop;
  }

  stop(): void {
    this._eos = true;
  }

  release(): void {}

  _peekByte() {
    return this._data!.getUint8(this._index);
  }

  _readByte() {
    return this._data!.getUint8(this._index++);
  }

  _peekWord() {
    return this._data!.getUint16(this._index, true);
  }

  _readWord() {
    const ret = this._data!.getUint16(this._index, true);
    this._index += 2;
    return ret;
  }

  _peekDword() {
    return this._data!.getUint32(this._index, true);
  }

  _readDword() {
    const ret = this._data!.getUint32(this._index, true);
    this._index += 4;
    return ret;
  }

  _processDataBlock() {
    if (this._readByte() != 0x66) {
      throw new Error();
    }
    return {
      type: this._readByte(),
      size: this._readDword()
    };
  }

  async _writeGameGearPsg() {
    const d = this._readByte();
    // do nothing;
  }

  async _writeSn76489() {
    const d = this._readByte();
    return this._mapper.writeData("sn76489", d);
  }

  async _write(chip: string, port: number = 0) {
    const a = this._readByte();
    const d = this._readByte();
    return this._mapper.writeReg(chip, port, a, d);
  }

  _writeYm2612_2a(n: number) {
    this._waitingFrame += n;
  }

  _seekPcmDataBank() {
    var offset = this._readDword();
    return offset;
  }

  async _YM2608RamWrite(address: number, data: number[]) {
    let start = address;
    let stop = start + data.length - 1;
    const limit = 0xffff;

    console.log("YM2608 RAM Write [start=" + start + " size=" + data.length + "]");

    start >>= 5;
    stop >>= 5;

    const mod = this._mapper.getModule("ym2608");
    if (mod) {
      await mod.writeReg(1, 0x10, 0x13); // BRDY EOS Enable
      await mod.writeReg(1, 0x10, 0x80); // Rest Flags
      await mod.writeReg(1, 0x00, 0x60); // Memory Write
      await mod.writeReg(1, 0x01, 0x02); // Memory Type
      await mod.writeReg(1, 0x02, start & 0xff);
      await mod.writeReg(1, 0x03, start >> 8);
      await mod.writeReg(1, 0x04, stop & 0xff);
      await mod.writeReg(1, 0x05, stop >> 8);
      await mod.writeReg(1, 0x0c, limit & 0xff);
      await mod.writeReg(1, 0x0d, limit >> 8);

      for (let i = 0; i < data.length; i++) {
        await mod.writeRegNoWait(1, 0x08, data[i]);
        await mod.writeRegNoWait(1, 0x10, 0x1b);
        await mod.writeRegNoWait(1, 0x10, 0x13);
      }
      await mod.writeReg(1, 0, 0x00);
      await mod.writeReg(1, 0x10, 0x80);
    }
  }

  async _processYM2608DeltaPCMData(block: { type: number; size: number }) {
    let romSize = this._readDword();
    let address = this._readDword();
    const data = Array<number>();
    for (let i = 0; i < block.size - 8; i++) {
      data.push(this._readByte());
    }
    await this._YM2608RamWrite(address, data);
  }

  async _playLoop() {
    const d = this._readByte();
    if (d == 0x67) {
      var block = this._processDataBlock();
      if (block.type == 0x81) {
        await this._processYM2608DeltaPCMData(block);
      } else {
        this._index += block.size;
      }
    } else if (d == 0x61) {
      this._waitingFrame += this._readWord();
    } else if (d == 0x62) {
      this._waitingFrame += 735;
    } else if (d == 0x63) {
      this._waitingFrame += 882;
    } else if (d == 0x4f) {
      await this._writeGameGearPsg();
    } else if (d == 0x50) {
      await this._writeSn76489();
    } else if (d == 0x51) {
      await this._write("ym2413");
    } else if (d == 0x52) {
      await this._write("ym2612", 0);
    } else if (d == 0x53) {
      await this._write("ym2612", 1);
    } else if (d == 0x54) {
      await this._write("ym2151");
    } else if (d == 0x55) {
      await this._write("ym2203");
    } else if (d == 0x56) {
      await this._write("ym2608", 0);
    } else if (d == 0x57) {
      await this._write("ym2608", 1);
    } else if (d == 0x58) {
      await this._write("ym2610", 0);
    } else if (d == 0x59) {
      await this._write("ym2610", 1);
    } else if (d == 0x5a) {
      await this._write("ym3812");
    } else if (d == 0x5b) {
      await this._write("ym3526");
    } else if (d == 0x5c) {
      await this._write("y8950");
    } else if (d == 0x5d) {
      await this._write("ymz280b");
    } else if (d == 0x5e) {
      await this._write("ymf262", 0);
    } else if (d == 0x5f) {
      await this._write("ymz262", 1);
    } else if (d == 0xa0) {
      await this._write("ay8910");
    } else if (d == 0xb4) {
      await this._write("nesApu");
    } else if (d == 0xd2) {
      const port = this._readByte();
      await this._write("scc1", port);
    } else if (d == 0xe0) {
      await this._seekPcmDataBank();
    } else if (0x70 <= d && d <= 0x7f) {
      this._waitingFrame += (d & 0xf) + 1;
    } else if (0x80 <= d && d <= 0x8f) {
      await this._writeYm2612_2a(d & 0xf);
    } else if (d == 0x66) {
      if (this._vgm!.offsets.loop) {
        this._index = this._vgm!.offsets.loop - this._vgm!.offsets.data;
      } else {
        this._eos = true;
      }
    } else {
      throw new Error("Unknown command: 0x" + d.toString(16));
    }
  }

  _headSamples: number = 0;
  _loopSamples: number = 0;

  async _sendProgress(head: number, loop: number) {
    if (process.send) {
      const total = head + loop;
      let current = head + ((this._currentFrame - head) % loop);
      process.send({ type: "progress", current, total });
    }
  }

  async play() {
    const sleepType = process.platform === "win32" ? "busyloop" : "atomics";

    this._headSamples = this._vgm!.samples.total - (this._vgm!.samples.loop || 0);
    this._loopSamples = this._vgm!.samples.loop || this._vgm!.samples.total;

    let t = microtime.now();

    while (!this._eos && this._index < this._data!.byteLength) {
      const elapsed = microtime.now() - t;

      await this._sendProgress(this._headSamples, this._loopSamples * this._loop);

      if (elapsed >= 100 * 1000) {
        await processNodeEventLoop();
        t = microtime.now();
      }

      if (this._currentFrame > this._headSamples + this._loopSamples * this._loop) {
        this._eos = true;
        return;
      }

      if (this._waitingFrame > 0) {
        const d = this._waitingFrame < 1000 ? this._waitingFrame : 1000;
        this._waitingFrame -= d;
        this._currentFrame += d;
        await this._sleeper.sleep(((1000000 / 44100) * d) / this._speedRatio, sleepType);
      } else {
        await this._playLoop();
      }
    }
  }
}

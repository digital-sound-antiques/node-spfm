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

  async _writeSn76489(index: number) {
    const d = this._readByte();
    return this._mapper.writeReg("sn76489", index, null, null, d);
  }

  _ym2608_port1_regs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  async _ym2608ADPCMAddressFix(index: number, a: number, d: number): Promise<boolean> {
    const chip = "ym2608";
    const port = 1;
    if (a < 0x10) {
      this._ym2608_port1_regs[a] = d;
    }
    if (a === 0x01) {
      await this._mapper.writeReg(chip, index, port, a, d & ~2 & 0xff);
      return true;
    }
    if (this._ym2608_port1_regs[0x01] & 0x02) {
      if ((0x02 <= a && a <= 0x05) || (0x0c <= a && a <= 0x0d)) {
        const al = a & ~1;
        const ah = a | 1;
        const d = ((this._ym2608_port1_regs[ah] << 8) | this._ym2608_port1_regs[al]) << 3;
        await this._mapper.writeReg(chip, index, port, al, d & 0xff);
        await this._mapper.writeReg(chip, index, port, ah, d >> 8);
        return true;
      }
    }
    return false;
  }

  async _write(chip: string, index: number, port: number = 0) {
    const a = this._readByte();
    const d = this._readByte();

    if (chip === "ym2608" && port === 1) {
      if (await this._ym2608ADPCMAddressFix(index, a, d)) return;
    }
    return this._mapper.writeReg(chip, index, port, a, d);
  }

  async _write2(chip: string, port: number = 0) {
    const a = this._readByte();
    const d = this._readByte();
    const index = a & 0x80 ? 1 : 0;
    return this._mapper.writeReg(chip, index, port, a & 0x7f, d);
  }

  _writeYm2612_2a(n: number) {
    this._waitingFrame += n;
  }

  _seekPcmDataBank() {
    var offset = this._readDword();
    return offset;
  }

  async _ramWriteProgress(title: string, current: number, total: number) {
    if (process.send) {
      new Promise(resolve => {
        process.send!({ type: "ram_write", title, current, total }, () => resolve());
      });
    }
  }

  async _YM2608RamWrite(index: number, address: number, data: Uint8Array) {
    let start = address;
    let stop = start + data.length - 1;
    let limit = Math.min(stop, 0x40000 - 1);
    const title = `YM2608 ADPCM (0x${("0000" + start.toString(16)).slice(-5)})`;

    start >>= 2;
    stop >>= 2;
    limit >>= 2;

    const mod = this._mapper.getModule("ym2608", index);

    if (mod) {
      await mod.writeReg(1, 0x10, 0x13); // BRDY EOS Enable
      await mod.writeReg(1, 0x10, 0x80); // Rest Flags
      await mod.writeReg(1, 0x00, 0x60); // Memory Write
      await mod.writeReg(1, 0x01, 0x00); // Memory Type
      await mod.writeReg(1, 0x02, start & 0xff);
      await mod.writeReg(1, 0x03, start >> 8);
      await mod.writeReg(1, 0x04, stop & 0xff);
      await mod.writeReg(1, 0x05, stop >> 8);
      await mod.writeReg(1, 0x0c, limit & 0xff);
      await mod.writeReg(1, 0x0d, limit >> 8);

      for (let i = 0; i < data.length; i++) {
        if (i % 256 === 0 || i === data.length - 1) {
          this._ramWriteProgress(title, i, data.length);
        }
        await mod.writeReg(1, 0x08, data[i]);
        await mod.writeReg(1, 0x10, 0x1b);
        await mod.writeReg(1, 0x10, 0x13);
      }
      await mod.writeReg(1, 0x00, 0x00);
      await mod.writeReg(1, 0x10, 0x80);
    }
  }

  async _processYM2608DeltaPCMData(index: number, block: { type: number; size: number }) {
    let ramSize = this._readDword();
    let address = this._readDword();
    const data = new Uint8Array(block.size - 8);
    for (let i = 0; i < block.size - 8; i++) {
      data[i] = this._readByte();
    }
    await this._YM2608RamWrite(index, address, data);
  }

  async _playLoop() {
    const d = this._readByte();
    if (d == 0x67) {
      var block = this._processDataBlock();
      if (block.type == 0x81) {
        await this._processYM2608DeltaPCMData(0, block);
      } else {
        this._index += block.size;
      }
    } else if (d == 0x61) {
      this._waitingFrame += this._readWord();
    } else if (d == 0x62) {
      this._waitingFrame += 735;
    } else if (d == 0x63) {
      this._waitingFrame += 882;
    } else if (d == 0x4f || d == 0x3f) {
      await this._writeGameGearPsg();
    } else if (d == 0x50 || d == 0x30) {
      await this._writeSn76489(d == 0x30 ? 1 : 0);
    } else if (d == 0x51 || d == 0xa1) {
      await this._write("ym2413", d == 0xa1 ? 1 : 0, 0);
    } else if (d == 0x52 || d == 0xa2) {
      await this._write("ym2612", d == 0xa2 ? 1 : 0, 0);
    } else if (d == 0x53 || d == 0xa3) {
      await this._write("ym2612", d == 0xa3 ? 1 : 0, 1);
    } else if (d == 0x54 || d == 0xa4) {
      await this._write("ym2151", d == 0xa4 ? 1 : 0);
    } else if (d == 0x55 || d == 0xa5) {
      await this._write("ym2203", d == 0xa5 ? 1 : 0);
    } else if (d == 0x56 || d == 0xa6) {
      await this._write("ym2608", d == 0xa6 ? 1 : 0, 0);
    } else if (d == 0x57 || d == 0xa7) {
      await this._write("ym2608", d == 0xa7 ? 1 : 0, 1);
    } else if (d == 0x58 || d == 0xa8) {
      await this._write("ym2610", d == 0xa8 ? 1 : 0, 0);
    } else if (d == 0x59 || d == 0xa9) {
      await this._write("ym2610", d == 0xa9 ? 1 : 0, 1);
    } else if (d == 0x5a || d == 0xaa) {
      await this._write("ym3812", d == 0xaa ? 1 : 0);
    } else if (d == 0x5b || d == 0xab) {
      await this._write("ym3526", d == 0xab ? 1 : 0);
    } else if (d == 0x5c || d == 0xac) {
      await this._write("y8950", d == 0xac ? 1 : 0);
    } else if (d == 0x5d || d == 0xab) {
      await this._write("ymz280b", d == 0xab ? 1 : 0);
    } else if (d == 0x5e || d == 0xae) {
      await this._write("ymf262", d == 0xae ? 1 : 0, 0);
    } else if (d == 0x5f || d == 0xaf) {
      await this._write("ymz262", d == 0xaf ? 1 : 0, 1);
    } else if (d == 0xa0) {
      await this._write2("ay8910");
    } else if (d == 0xb4) {
      await this._write2("nesApu");
    } else if (d == 0xd2) {
      const port = this._readByte();
      await this._write2("k051649", port);
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
      throw new Error("Unsupported command: 0x" + d.toString(16));
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
    const sleepType = "atomics";

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

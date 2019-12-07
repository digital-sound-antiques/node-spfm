import microtime from "microtime";
import SPFMMapper from "../spfm-mapper";
import {
  VGM,
  parseVGMCommand,
  VGMDataBlockCommand,
  VGMWaitCommand,
  VGMWriteDataCommand,
  VGMSeekPCMCommand,
  VGMWrite2ACommand,
  VGMEndCommand,
  VGMStartStreamCommand,
} from "vgm-parser";
import AccurateSleeper, { processNodeEventLoop } from "./sleeper";
import Player from "./player";
import YM2612DACAnalyzer, { YM2612DACAnalyzerResult } from "./ym2612-dac-analyzer";

type VGMPlayerOptions = {
  ym2612DACEmulationMode?: string;
};

export default class VGMPlayer implements Player<VGM> {
  _mapper: SPFMMapper;
  _vgm?: VGM;
  _index = 0;
  _data?: Uint8Array;
  _eos = false;
  _sleeper = new AccurateSleeper();
  _currentFrame = 0;
  _waitingFrame = 0;
  _speedRatio = 1.0;
  _loop = 2;
  _options: VGMPlayerOptions;
  _dac2ssg = false;
  _dac2adpcm = false;
  _ym2612_pcm_lr = 0xc0;
  _ym2612_pcm_offset = 0;
  _ym2612_pcm_data = new Uint8Array(0);
  _ym2612_dac_info: YM2612DACAnalyzerResult | null = null;

  constructor(mapper: SPFMMapper, options: VGMPlayerOptions = {}) {
    this._mapper = mapper;
    this._options = options;
    if (options.ym2612DACEmulationMode === "ssg") {
      this._dac2ssg = true;
    }
    if (options.ym2612DACEmulationMode === "adpcm") {
      this._dac2adpcm = true;
    }
    if (options.ym2612DACEmulationMode === "adpcm2") {
      this._dac2adpcm = true;
    }
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
    this._data = new Uint8Array(this._vgm.data);
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

  async _write(cmd: VGMWriteDataCommand) {
    const { chip, index, port, addr, data } = cmd;

    if (chip === "ym2608" && port === 1) {
      if (await this._ym2608ADPCMAddressFix(index, addr!, data)) return;
    }
    if (chip === "ym2612" && port === 1 && addr === 0xb6) {
      this._ym2612_pcm_lr = data & 0xc0;
      await this._mapper.writeReg(chip, index, 1, 1, data & 0xc0);
    }
    return this._mapper.writeReg(chip, index, port, addr, data);
  }

  async _ym2612_adpcm_keyOn(offset: number, freq: number, size: number = -1) {
    const mod = this._mapper.getModule("ym2612", 0);
    if (mod && mod.rawType === "ym2608") {
      const spfm = mod.spfm;
      const start = offset >> 2;
      const stop = size < 0 ? 0xffff : Math.min(0xffff, (offset + size - 1) >> 2);
      const delta = Math.min(0xffff, Math.round((0x10000 * freq) / (mod.rawClock / 2 / 72)));
      await spfm.writeRegs(mod.slot, [
        { port: 1, a: 0x00, d: 0x01 },
        { port: 1, a: 0x00, d: 0x20 },
        { port: 1, a: 0x01, d: this._ym2612_pcm_lr },
        { port: 1, a: 0x02, d: start & 0xff }, // start(L)
        { port: 1, a: 0x03, d: start >> 8 }, // start(H)
        { port: 1, a: 0x04, d: stop & 0xff }, // stop(L)
        { port: 1, a: 0x05, d: stop >> 8 }, // stop(H)
        { port: 1, a: 0x0c, d: 0xff }, // limit(L)
        { port: 1, a: 0x0d, d: 0xff }, // limit(H)
        { port: 1, a: 0x09, d: delta & 0xff }, // delta(L)
        { port: 1, a: 0x0a, d: delta >> 8 }, // delta(H)
        { port: 1, a: 0x0b, d: 0x50 }, // vol
        { port: 1, a: 0x00, d: 0xa0 } // key-on
      ]);
    }
  }

  async _ym2612_adpcm_keyOff() {
    const mod = this._mapper.getModule("ym2612", 0);
    if (mod && mod.rawType === "ym2608") {
      const spfm = mod.spfm;
      await spfm.writeReg(mod.slot, 1, 0x00, 0xa1);
    }
  }

  async _writeYm2612_2a_adpcm() {
    const fragment = this._ym2612_dac_info!.findFragment(this._index, this._ym2612_pcm_offset);
    if (fragment) {
      const { offset, freq, size } = fragment;
      await this._ym2612_adpcm_keyOn(offset, freq, size);
    }
  }

  async _writeYm2612_2a(n: number) {
    this._waitingFrame += n;
    if (this._dac2ssg) {
      const index = this._ym2612_pcm_offset;
      if (0 < n && index < this._ym2612_pcm_data.length) {
        await this._mapper.writeReg("ym2612", 0, 0, 0x2a, this._ym2612_pcm_data[index]);
      }
    }
    if (this._dac2adpcm) {
      await this._writeYm2612_2a_adpcm();
    }
    this._ym2612_pcm_offset++;
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
      await mod.writeReg(1, 0x00, 0x01); //
      await mod.writeReg(1, 0x10, 0x80); // Reset Flags
      await mod.writeReg(1, 0x00, 0x60); // Memory Write
      await mod.writeReg(1, 0x01, 0x00); // Memory Type
      await mod.writeReg(1, 0x02, start & 0xff);
      await mod.writeReg(1, 0x03, start >> 8);
      await mod.writeReg(1, 0x04, stop & 0xff);
      await mod.writeReg(1, 0x05, stop >> 8);
      await mod.writeReg(1, 0x0c, limit & 0xff);
      await mod.writeReg(1, 0x0d, limit >> 8);

      for (let i = 0; i < data.length; i++) {
        if (this._eos) break;
        if (i % 256 === 0 || i === data.length - 1) {
          this._ramWriteProgress(title, i, data.length); /* omit await */
        }
        await mod.writeReg(1, 0x08, data[i]);
      }
      await mod.writeReg(1, 0x00, 0x00);
      await mod.writeReg(1, 0x10, 0x80);
    }
  }

  async _YM2612toYM2608RamWrite(index: number, address: number, data: Uint8Array) {
    let start = address;
    let stop = start + data.length - 1;
    let limit = Math.min(stop, 0x40000 - 1);
    const title = `YM2612 PCM => YM2608 ADPCM (0x${("0000" + start.toString(16)).slice(-5)})`;

    start >>= 2;
    stop >>= 2;
    limit >>= 2;

    const mod = this._mapper.getModule("ym2612", index);

    if (mod && mod.rawType === "ym2608") {
      const spfm = mod.spfm;
      const slot = mod.slot;
      await spfm.writeRegs(slot, [
        { port: 1, a: 0x00, d: 0x01 }, //
        { port: 1, a: 0x10, d: 0x80 }, // Reset Flags
        { port: 1, a: 0x00, d: 0x60 }, // Memory Write
        { port: 1, a: 0x01, d: 0x00 }, // Memory Type
        { port: 1, a: 0x02, d: start & 0xff },
        { port: 1, a: 0x03, d: start >> 8 },
        { port: 1, a: 0x04, d: stop & 0xff },
        { port: 1, a: 0x05, d: stop >> 8 },
        { port: 1, a: 0x0c, d: limit & 0xff },
        { port: 1, a: 0x0d, d: limit >> 8 }
      ]);

      let buf = [];
      for (let i = 0; i < data.length; i++) {
        if (this._eos) break;
        if (i % 256 === 0 || i === data.length - 1) {
          this._ramWriteProgress(title, i, data.length);
          await spfm.writeRegs(slot, buf);
          buf = [];
        }
        buf.push({ port: 1, a: 0x08, d: data[i] });
      }
      buf.push({ port: 1, a: 0x00, d: 0x00 });
      buf.push({ port: 1, a: 0x10, d: 0x80 });
      await spfm.writeRegs(slot, buf);
    }
  }
  async _processYM2608DeltaPCMData(cmd: VGMDataBlockCommand) {
    const view = new DataView(cmd.blockData.buffer, cmd.blockData.byteOffset);
    const address = view.getUint32(4, true);
    await this._YM2608RamWrite(0, address, cmd.blockData.slice(8));
  }

  async _processDataBlock(cmd: VGMDataBlockCommand) {
    if (cmd.blockType == 0x00) {
      this._ym2612_pcm_data = cmd.blockData;
      if (this._dac2adpcm) {
        const mode2 = this._options.ym2612DACEmulationMode === "adpcm2";
        this._ym2612_dac_info = new YM2612DACAnalyzer(this._data!, {
          splitLimitInSamples: mode2 ? 32 : 735,
          frequencyAnalysis: mode2,
          overlapAnalysis: mode2
        }).analyze();
        await this._YM2612toYM2608RamWrite(0, 0, this._ym2612_dac_info.adpcmData);
        await new Promise(resolve => setTimeout(() => resolve(), 250));
        this._sleeper.reset();
      }
    }
    if (cmd.blockType == 0x81) {
      await this._processYM2608DeltaPCMData(cmd);
      await new Promise(resolve => setTimeout(() => resolve(), 250));
      this._sleeper.reset();
    }
  }

  async _processStartStream(cmd: VGMStartStreamCommand) {
    if (cmd.streamId === 0) {
      const fragment = this._ym2612_dac_info!.findFragment(this._index, cmd.offset);
      if (fragment) {
        const { offset, freq, size } = fragment;
        return this._ym2612_adpcm_keyOn(offset, freq, size);
      }
    }
  }

  async _playLoop() {
    const cmd = parseVGMCommand(this._vgmCommands!, this._index);
    let nextIndex = this._index + cmd.size;
    if (cmd instanceof VGMDataBlockCommand) {
      await this._processDataBlock(cmd);
    } else if (cmd instanceof VGMWaitCommand) {
      this._waitingFrame += cmd.count;
    } else if (cmd instanceof VGMWriteDataCommand) {
      await this._write(cmd);
    } else if (cmd instanceof VGMSeekPCMCommand) {
      this._ym2612_pcm_offset = cmd.offset;
    } else if (cmd instanceof VGMWrite2ACommand) {
      await this._writeYm2612_2a(cmd.count);
    } else if (cmd instanceof VGMStartStreamCommand) {
      await this._processStartStream(cmd);
    } else if (cmd instanceof VGMEndCommand) {
      if (this._vgm!.offsets.loop) {
        nextIndex = this._vgm!.offsets.loop - this._vgm!.offsets.data;
      } else {
        this._eos = true;
      }
    }
    this._index = nextIndex;
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

  _vgmCommands: Uint8Array | null = null;

  async play() {
    const sleepType = "atomics";

    this._vgmCommands = new Uint8Array(this._vgm!.data);

    if (0 < this._vgm!.offsets.loop) {
      this._headSamples = this._vgm!.samples.total - this._vgm!.samples.loop;
      this._loopSamples = this._vgm!.samples.loop * this._loop;
    } else {
      this._headSamples = 0;
      this._loopSamples = this._vgm!.samples.total;
    }

    let t = microtime.now();

    while (!this._eos && this._index < this._data!.byteLength) {
      const elapsed = microtime.now() - t;

      if (elapsed >= 100 * 1000) {
        await this._sendProgress(this._headSamples, this._loopSamples);
        await processNodeEventLoop();
        t = microtime.now();
      }

      if (this._currentFrame > this._headSamples + this._loopSamples) {
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

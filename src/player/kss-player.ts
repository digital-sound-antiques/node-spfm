import SPFMMapper from "../spfm-mapper";
import { KSS, KSSPlay } from "libkss-js";
import Player from "./player";
import AccurateSleeper, { processNodeEventLoop } from "./sleeper";
import CommandBuffer from "./command-buffer";

const SAMPLE_FREQ = 44100;

export default class KSSPlayer implements Player<KSS> {
  _mapper: SPFMMapper;
  _kssplay = new KSSPlay(SAMPLE_FREQ);
  _index = 0;
  _data?: DataView;
  _eos = false;
  _currentFrame = 0;
  _sleeper = new AccurateSleeper();
  _speedRatio = 1;
  _buffer = new CommandBuffer();
  _loop = 2;
  _fadeSamples = 0;
  _song = 0;

  constructor(mapper: SPFMMapper) {
    this._mapper = mapper;
    this._kssplay.setIOWriteHandler(this._ioWriteHandler.bind(this));
  }

  static ensureInitialize(): Promise<void> {
    return KSSPlay.initialize();
  }

  reset(): void {
    this._index = 0;
    this._eos = false;
    this._kssplay.reset(this._song);
    this._buffer.reset();
  }

  setSpeed(speed: number) {
    this._speedRatio = Math.pow(2, speed / 2);
  }

  setLoop(loop: number) {
    this._loop = loop;
  }

  setFadeTime(timeInSec: number): void {
    this._fadeSamples = Math.round(SAMPLE_FREQ * timeInSec);
  }

  stop() {
    this._eos = true;
  }

  release() {
    this._kssplay.release();
  }

  _opll_adr = 0;
  _opl_adr = 0;
  _psg_adr = 0;
  _sng_adr = 0;

  _ioWriteHandler(c: any, a: number, d: number) {
    if (a === 0x7c || a === 0xf0) {
      // YM2413(A)
      this._opll_adr = d;
    } else if (a == 0x7d || a == 0xf1) {
      // YM2413(D)
      this._write("ym2413", 0, this._opll_adr, d);
    } else if (a == 0xc0) {
      this._opl_adr = d;
      if (d == 0x0f) {
        // y8950_adpcm;
      }
    } else if (a == 0xc1) {
      this._write("y8950", 0, this._opl_adr, d);
    } else if (a == 0xa0) {
      this._psg_adr = d;
    } else if (a == 0xa1) {
      // PSG(D)
      this._write("ay8910", 0, this._psg_adr, d);
    } else if (a == 0x7e || a == 0x7f) {
      // SN76489
      this._writeSn76489(d);
    } else if (a == 0x06) {
      this._writeGameGearPsg(d);
    }
  }

  setData(kss: KSS) {
    this._kssplay.setData(kss);
    this.reset();
  }

  async _waitSamples(frames: number) {
    this._currentFrame += frames;
    return this._sleeper.sleep(((1000000 / 44100) * frames) / this._speedRatio);
  }

  async _writeGameGearPsg(d: number) {
    //
  }

  _writeSn76489(d: number) {
    this._buffer.push({ type: "sn76489", index: 0, port: -1, a: -1, d });
  }

  _write(type: string, port: number, a: number, d: number) {
    this._buffer.push({ type, index: 0, port, a, d });
  }

  async play() {
    const step = 4;
    let loopOverCount = -1;
    let count = 0;

    while (!this._eos) {
      if (count % 4096 === 0) {
        if (process.send) {
          process.send({ type: "progress", current: count, total: 0 });
        }
      }
      if (count % 512 === 0) {
        await processNodeEventLoop();
      }
      this._kssplay.calcSilent(step);
      count += step;
      await this._buffer.flushTo(this._mapper);
      await this._waitSamples(step);

      if (loopOverCount < 0 && this._kssplay.getLoopCount() >= this._loop) {
        loopOverCount = count;
      }

      if (0 <= loopOverCount && loopOverCount + this._fadeSamples < count) {
        this._eos = true;
      }

      if (this._kssplay.getStopFlag()) {
        this._eos = true;
      }
    }
  }
}

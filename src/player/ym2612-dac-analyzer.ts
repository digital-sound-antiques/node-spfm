import { YM2608_ADPCM_encode } from "./adpcm-util";
import {
  parseVGMCommand,
  VGMDataBlockCommand,
  VGMWaitCommand,
  VGMSeekPCMCommand,
  VGMWrite2ACommand,
  VGMEndCommand,
  VGMStartStreamCommand,
  VGMSetupStreamCommand,
  VGMSetStreamDataCommand,
  VGMSetStreamFrequencyCommand,
  VGMStartStreamFastCommand,
  VGMStopStreamCommand
} from "vgm-parser";
const _pad = (s: number) => ("0000000" + s).slice(-8);

export class PCMFragment {
  index: number;
  offset: number;
  size: number;
  samples: number;
  shouldOptimizeOffset: boolean = false;
  _merged: Array<PCMFragment> | null = null;
  constructor(index: number, offset: number, size: number, samples: number) {
    this.index = index;
    this.offset = offset;
    this.size = size;
    this.samples = samples;
  }
  get freq(): number {
    return (44100 * this.size) / this.samples;
  }
  clone(): PCMFragment {
    return new PCMFragment(this.index, this.offset, this.size, this.samples);
  }

  merge(e: PCMFragment) {
    this.size += e.size;
    this.samples += e.samples;
    if (this._merged == null) {
      this._merged = [this.clone()];
    }
    this._merged.push(e);
  }

  get mergedFragments(): Array<PCMFragment> | null {
    return this._merged;
  }

  toString(): string {
    return `${this.shouldOptimizeOffset ? "!" : ""}${_pad(this.index)}\toffset:${_pad(this.offset)}\tsize:${_pad(
      this.size
    )}\tsam:${_pad(this.samples)}\t${this.freq.toFixed(1)}Hz\t${this._merged ? this._merged.length : 0}`;
  }
}

export class ADPCMFragment {
  index: number;
  offset: number;
  size: number;
  freq: number;
  src: PCMFragment | null = null;
  constructor(index: number, offset: number, size: number, freq: number) {
    this.index = index;
    this.offset = offset;
    this.size = size;
    this.freq = freq;
  }
  toString(): string {
    return `${_pad(this.index)}\toffset:${_pad(this.offset)}\tsize:${_pad(this.size)}\t${this.freq.toFixed(1)}Hz`;
  }
}

const K = 512;

type YM2612DACAnalyzerOptions = {
  frequencyAnalysis?: boolean;
  overlapAnalysis?: boolean;
  splitLimitInSamples?: number;
};

export default class YM2612DACAnalyzer {
  _data: Uint8Array;
  _index = 0;
  _fragments: Array<PCMFragment> = [];
  _pcm = new Uint8Array(0);
  _pcmStart = -1;
  _pcmOffset = 0;
  _pcmSamples = 0;
  _currentTime = 0; // time in samples
  _lastTime2AWritten = -1;
  _pcmKeyOnIndex = -1;
  _waitTimeArray: Array<number> = [];
  _frequencyChangeCount = 0;
  _options: YM2612DACAnalyzerOptions;

  constructor(data: Uint8Array, options: YM2612DACAnalyzerOptions) {
    this._data = data;
    this._options = options;
  }

  _shouldOptimizeOffset = false;

  _updatePcmDataUnit(callWhenFreqChanged = false) {
    if (0 < this._pcmKeyOnIndex && 0 < this._pcmOffset && 0 < this._pcmSamples) {
      const fragment = new PCMFragment(
        this._pcmKeyOnIndex,
        this._pcmStart,
        this._pcmOffset - this._pcmStart,
        this._pcmSamples
      );
      fragment.shouldOptimizeOffset = this._shouldOptimizeOffset;
      this._fragments.push(fragment);
      this._pcmStart = this._pcmOffset;
      this._pcmSamples = 0;
      this._pcmKeyOnIndex = -1;
      this._lastTime2AWritten = -1;
      this._waitTimeArray = [];
      this._shouldOptimizeOffset = callWhenFreqChanged;
    }
  }

  _seekPcmDataBank(offset: number) {
    // treat seek command as key-on.
    this._updatePcmDataUnit();
    this._pcmStart = offset;
    this._pcmOffset = this._pcmStart;
    this._pcmSamples = 0;
    this._pcmKeyOnIndex = -1;
    this._lastTime2AWritten = -1;
    this._waitTimeArray = [];
  }

  async _writeYm2612_2a(n: number) {
    if (this._lastTime2AWritten < 0) {
      this._pcmKeyOnIndex = this._index;
    }
    this._lastTime2AWritten = this._currentTime;
    this._pcmSamples += n;
    this._currentTime += n;
    this._pcmOffset++;

    /* force frequencyAnalysis to detect invalid DAC access before first key-on. */
    if (this._options.frequencyAnalysis || this._frequencyChangeCount === 0) {
      if (K <= this._waitTimeArray.length) {
        let preSum = 0;
        for (let i = 0; i < K / 2; i++) {
          preSum += this._waitTimeArray[i];
        }
        let postSum = 0;
        for (let i = K / 2; i < K; i++) {
          postSum += this._waitTimeArray[i];
        }
        if (postSum < preSum / 1.1 || preSum * 1.1 < postSum) {
          this._updatePcmDataUnit(true);
          this._frequencyChangeCount++;
        }
        this._waitTimeArray.shift();
      }
      this._waitTimeArray.push(n);
    }
  }

  _streamFrequency = 0;
  _streamCommandSize = 1;
  _streamDataBankId = -1;
  _useDACStreamControl = false;

  _processSetupStream(cmd: VGMSetupStreamCommand) {
    if (cmd.streamId === 0 && cmd.type === 0x02) {
      this._useDACStreamControl = true;
    }
  }

  _processSetStreamData(cmd: VGMSetStreamDataCommand) {
    if (cmd.streamId === 0) {
      this._streamDataBankId = cmd.dataBankId;
    }
  }

  _processSetStreamFrequency(cmd: VGMSetStreamFrequencyCommand) {
    if (cmd.streamId === 0 && this._streamDataBankId === 0) {
      this._streamFrequency = cmd.frequency;
    }
  }

  _processStartStream(cmd: VGMStartStreamCommand) {
    if (cmd.streamId === 0 && this._streamDataBankId === 0) {
      let length = 0;
      if (cmd.lengthMode === 1) {
        length = cmd.dataLength * this._streamCommandSize;
      } else if (cmd.lengthMode === 2) {
        length = (44100 * cmd.dataLength) / 1000;
      }
      if (0 < length) {
        const fragment = new PCMFragment(
          this._index,
          cmd.offset,
          length,
          Math.round((length / this._streamFrequency) * 44100)
        );
        this._fragments.push(fragment);
      }
    }
  }

  analyze(): YM2612DACAnalyzerResult {
    this._index = 0;
    this._pcmStart = 0;
    this._pcmOffset = 0;
    this._pcmSamples = 0;
    this._currentTime = 0;
    this._lastTime2AWritten = -1;
    const splitLimit = this._options.splitLimitInSamples || 512;

    while (this._index < this._data.length) {
      const cmd = parseVGMCommand(this._data, this._index);
      let nextIndex = this._index + cmd.size;
      if (cmd instanceof VGMDataBlockCommand) {
        this._pcm = cmd.blockData;
      } else if (cmd instanceof VGMWaitCommand) {
        this._currentTime += cmd.count;
      } else if (cmd instanceof VGMSeekPCMCommand) {
        this._seekPcmDataBank(cmd.offset);
      } else if (cmd instanceof VGMWrite2ACommand) {
        this._writeYm2612_2a(cmd.count);
      } else if (cmd instanceof VGMSetupStreamCommand) {
        this._processSetupStream(cmd);
      } else if (cmd instanceof VGMSetStreamDataCommand) {
        this._processSetStreamData(cmd);
      } else if (cmd instanceof VGMSetStreamFrequencyCommand) {
        this._processSetStreamFrequency(cmd);
      } else if (cmd instanceof VGMStartStreamCommand) {
        this._processStartStream(cmd);
      } else if (cmd instanceof VGMEndCommand) {
        this._updatePcmDataUnit();
        break;
      }
      if (0 <= this._lastTime2AWritten && splitLimit <= this._currentTime - this._lastTime2AWritten) {
        this._updatePcmDataUnit();
      }
      this._index = nextIndex;
    }

    return new YM2612DACAnalyzerResult(this._pcm, this._fragments, this._useDACStreamControl, this._options);
  }
}

function fixOffsetOfFragments(fragments: Array<PCMFragment>): void {
  // fix offset for frequency analysis
  const offsetToFragment = new Map<number, PCMFragment>();
  fragments.forEach(v => {
    offsetToFragment.set(v.offset, v);
  });
  fragments.forEach(e => {
    if (e.shouldOptimizeOffset) {
      offsetToFragment.forEach((v, k) => {
        const diff = e.offset - v.offset;
        if (0 < diff && diff <= K) {
          // process.stderr.write(`OFFSET OPTIMIZED ${e.offset} -> ${v.offset}\n`);
          e.offset = v.offset;
          const newSize = e.size + diff;
          const newSamples = Math.round((e.samples * newSize) / e.size);
          e.size = newSize;
          e.samples = newSamples;
          e.shouldOptimizeOffset = false;
        }
      });
    }
  });
}

function getOptimizedFragments(fragments: Array<PCMFragment>): Array<PCMFragment> {
  // Merge small fragments
  const isNearFreq = (f1: number, f2: number) => f1 / 1.03 < f2 && f2 < f1 * 1.03;

  const getMergedFragment = (i: number) => {
    let res = fragments[i].clone();
    for (let j = i + 1; j < fragments.length; j++) {
      const frag = fragments[j];
      if (res.offset + res.size === frag.offset) {
        if (isNearFreq(res.freq, frag.freq) && (res.samples < 441 || frag.samples < 441)) {
          res.merge(frag);
          continue;
        }
      }
      break;
    }
    return res;
  };

  let result = new Array<PCMFragment>();
  let i = 0;
  while (i < fragments.length) {
    const fragment = getMergedFragment(i);
    if (441 <= fragment.samples) {
      result.push(fragment);
    }
    if (fragment.mergedFragments) {
      i += fragment.mergedFragments.length;
    } else {
      i++;
    }
  }
  return result;
}

function divideOverlaps(fragments: Array<PCMFragment>): Array<PCMFragment> {
  /* If the later part of a PCMFragment overlapped with another one, two PCM data might be packed. Divide such fragment here. 
      It is possible that three or more PCM data have been packed, however, it is very rare situation so gently ignored here. */
  const result = new Array<PCMFragment>();
  fragments.forEach(v => {
    const overlap = fragments.find(
      e => v.offset < e.offset && e.offset <= v.offset + v.size && v.offset + v.size <= e.offset + e.size
    );
    if (overlap) {
      const preSize = overlap.offset - v.offset;
      const postSize = v.size - preSize;
      if (0 < preSize && 0 < postSize) {
        const preSamples = Math.round((v.samples * preSize) / v.size);
        const postSamples = Math.round((overlap.samples * postSize) / overlap.size);
        if (1000 < preSamples && 1000 < postSamples) {
          const pre = new PCMFragment(v.index, v.offset, preSize, preSamples);
          const post = new PCMFragment(-v.index, overlap.offset, postSize, postSamples);
          result.push(pre);
          result.push(post);
        } else {
          result.push(v);
        }
      } else {
        result.push(v);
      }
    } else {
      result.push(v);
    }
  });
  return result;
}
export class YM2612DACAnalyzerResult {
  indexToAdpcmMap = new Map<number, ADPCMFragment>();
  offsetToAdpcmMap = new Map<number, ADPCMFragment>();
  adpcmData = new Uint8Array(256 * 1024);

  constructor(
    pcmData: Uint8Array,
    fragments: Array<PCMFragment>,
    useDACStreamControl: boolean,
    options: YM2612DACAnalyzerOptions
  ) {
    let optimizedFragments;
    if (!useDACStreamControl) {
      if (options.frequencyAnalysis) {
        fixOffsetOfFragments(fragments);
      }
      optimizedFragments = getOptimizedFragments(fragments);
      if (options.overlapAnalysis) {
        optimizedFragments = divideOverlaps(optimizedFragments);
      }
    } else {
      optimizedFragments = fragments;
    }
    const indexToFragmentMap = new Map<number, PCMFragment>();
    const offsetToLargestFragmentMap = new Map<number, PCMFragment>();
    optimizedFragments.forEach(v => {
      const fragment = offsetToLargestFragmentMap.get(v.offset);
      if (!fragment || fragment.size < v.size) {
        offsetToLargestFragmentMap.set(v.offset, v);
      }
      indexToFragmentMap.set(v.index, v);
    });

    let adpcmWritten = 0;
    const PCMToADPCMOffsetMap = new Map<number, number>();
    offsetToLargestFragmentMap.forEach(v => {
      PCMToADPCMOffsetMap.set(v.offset, adpcmWritten);
      const packet = YM2608_ADPCM_encode(pcmData.slice(v.offset, v.offset + v.size));
      this.adpcmData.set(packet, adpcmWritten);
      adpcmWritten += packet.length;
    });
    this.adpcmData = this.adpcmData.slice(0, adpcmWritten);

    indexToFragmentMap.forEach(v => {
      const offset = PCMToADPCMOffsetMap.get(v.offset);
      const frag = new ADPCMFragment(v.index, offset!, v.size >> 1, v.freq);
      frag.src = v;
      if (0 <= v.index) {
        this.indexToAdpcmMap.set(v.index, frag);
      } else {
        this.offsetToAdpcmMap.set(v.offset, frag);
      }
    });
  }

  findFragment(index: number, offset: number): ADPCMFragment | undefined {
    return this.indexToAdpcmMap.get(index) || this.offsetToAdpcmMap.get(offset);
  }
}

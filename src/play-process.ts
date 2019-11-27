import fs from "fs";
import path from "path";
import SPFMMapperConfig from "./spfm-mapper-config";

import commandLineArgs, { CommandLineOptions } from "command-line-args";

import zlib from "zlib";
import SPFMMapper, { SPFMModule } from "./spfm-mapper";
import VGMPlayer from "./player/vgm-player";
import { VGM, formatMinSec } from "vgm-parser";
import KSSPlayer from "./player/kss-player";
import { KSS } from "libkss-js";
import Player from "./player/player";

async function stdoutSync(message: string) {
  return new Promise((resolve, reject) => {
    process.stdout.write(message, err => {
      resolve();
    });
  });
}

const mapper = new SPFMMapper(SPFMMapperConfig.default);

function formatHz(hz: number): string {
  return `${(hz / 1000000).toFixed(2)}MHz`;
}

function toArrayBuffer(b: Buffer) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function getVGMInfoString(file: string, vgm: VGM) {
  const gain = Math.pow(2, vgm.volumeModifier / 32).toFixed(2);
  const loop = vgm.samples.loop ? `YES (${formatMinSec(vgm.samples.loop)})` : "NO";
  const gd3 = vgm.gd3tag;
  const usedChips = vgm.usedChips.map(chip => {
    const chipObj = vgm.chips[chip];
    if (chipObj) {
      return `${chipObj.dual ? "2x" : ""}${chip.toUpperCase()}(${formatHz(chipObj.clock)})`;
    }
  });
  return `File Name:      ${path.basename(file)}

Track Title:    ${gd3.trackTitle}
Game Name:      ${gd3.gameName}
System:         ${gd3.system}
Composer:       ${gd3.composer}
Release:        ${gd3.releaseDate}
Version:        ${vgm.version.major}.${vgm.version.minor}\tGain: ${gain}\tLoop: ${loop}
VGM by:         ${gd3.vgmBy}
Notes:          ${gd3.notes}

Used chips:     ${usedChips.join(", ")}

`;
}

function getKSSInfoString(file: string, kss: KSS, song: number) {
  return `File Name:      ${path.basename(file)}

Track Title:    ${kss.getTitle()}


`;
}

function getInfoString(file: string, data: VGM | KSS, song: number = 0) {
  if (data instanceof VGM) {
    return getVGMInfoString(file, data);
  }
  return getKSSInfoString(file, data, song);
}

function getModuleTableString(chips: string[], spfms: { [key: string]: [SPFMModule] }) {
  const result = [];
  for (const chip of chips) {
    const spfm = spfms[chip];
    if (spfm) {
      for (const mod of spfm) {
        if (mod != null) {
          const name = `${chip.toUpperCase()} => ${mod.deviceId}:${mod.rawType.toUpperCase()}`;
          let clock;
          if (mod.clock != mod.requestedClock) {
            const div = (mod.rawClock / mod.clock).toFixed(1);
            if (mod.moduleInfo.clockConverter == null) {
              clock = `(${formatHz(mod.rawClock)}/${div}, clock mismatch)`;
            } else {
              clock = `(${formatHz(mod.rawClock)}/${div}, software adjusted)`;
            }
          } else {
            clock = `(${formatHz(mod.clock)})`;
          }
          result.push(`${name}${clock}`);
        }
      }
    }
  }
  return "Mapped modules: " + result.join("\n                ");
}

function parseSongNumber(s: string | null) {
  if (s == null) {
    return 0;
  }
  if (s.indexOf("0x") === 0) {
    return parseInt(s.slice(2), 16);
  }
  return parseInt(s);
}

function loadFile(file: string): VGM | KSS {
  const buf = fs.readFileSync(file);
  if (/\.vg(m|z)$/.test(file)) {
    let vgmContext: Buffer;
    try {
      vgmContext = zlib.gunzipSync(buf);
    } catch (e) {
      vgmContext = buf;
    }
    return VGM.parse(toArrayBuffer(vgmContext));
  }

  return new KSS(new Uint8Array(toArrayBuffer(buf)), path.basename(file));
}

async function play(file: string, options: CommandLineOptions) {
  if (!file) {
    throw new Error("Missing argument.");
  }

  let player: Player<any> | null = null;
  process.on("message", msg => {
    if (msg && msg.type === "stop") {
      if (player) {
        player.stop();
      }
    }
    if (msg && msg.type === "speed") {
      if (player) {
        player.setSpeed(msg.value);
      }
    }
  });

  let exitCode = 0;
  try {
    const data: VGM | KSS = loadFile(file);
    const song = parseSongNumber(options.song);
    stdoutSync((options.banner || "") + getInfoString(file, data, song));

    let modules: { type: string; clock: number }[] = [];
    if (data instanceof VGM) {
      const chips: any = data.chips;
      for (const chip in chips) {
        if (chips[chip] != null) {
          modules.push({ type: chip, clock: chips[chip].clock });
          if (chips[chip].dual) {
            modules.push({ type: chip, clock: chips[chip].clock });
          }
        }
      }
    } else {
      modules = [
        { type: "ay8910", clock: Math.round(3579545 / 2) },
        { type: "ym2413", clock: 3579545 },
        { type: "y8950", clock: 3579545 },
        { type: "k051649", clock: Math.round(3579545 / 2) }
      ];
    }
    const spfms = await mapper.open(modules);
    if (Object.keys(spfms).length == 0) {
      stdoutSync("Can't assign any modules. Use `spfm config -m` to see a recognizable chip types.");
      process.exit(0);
    }
    const types = modules.map(e => e.type).filter((elem, index, self) => self.indexOf(elem) === index);
    stdoutSync(`${getModuleTableString(types, spfms)}\n\n`);

    if (data instanceof VGM) {
      player = new VGMPlayer(mapper);
      player.setData(data);
    } else {
      player = new KSSPlayer(mapper);
      player.setData(data, song);
    }
    await player.play();
    stdoutSync("\nPlaying finished.\n");
  } catch (e) {
    console.error(e.message);
    exitCode = 1;
  } finally {
    await mapper.close();
    if (player) {
      player.release();
    }
  }
  process.exit(exitCode);
}

const optionDefinitions = [
  { name: "file", defaultOption: true },
  { name: "banner", type: String },
  { name: "song", alias: "s", type: String }
];

const options = commandLineArgs(optionDefinitions);
play(options.file, options);

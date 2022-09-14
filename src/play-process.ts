import fs from "fs";
import path from "path";
import commandLineArgs, { CommandLineOptions } from "command-line-args";
import zlib from "zlib";
import { KSS } from "libkss-js";
import { VGM, formatMinSec, createEmptyGD3TagObject } from "vgm-parser";
import { S98, convertS98ToVGM } from "s98-to-vgm";

import SPFMMapperConfig from "./spfm-mapper-config";
import SPFMMapper from "./spfm-mapper";
import VGMPlayer from "./player/vgm-player";
import KSSPlayer from "./player/kss-player";
import Player from "./player/player";
import SPFMModule from "./spfm-module";

const defaultModulePriority = [
  "ym2151",
  "ym2612",
  "ym2608",
  "ym2203",
  "ym3812",
  "ym3526",
  "y8950",
  "ym2413",
  "ay8910",
  "sn76489"
];

async function stdoutSync(message: string) {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(message, err => {
      resolve();
    });
  });
}

const mapper = new SPFMMapper(SPFMMapperConfig.default);

function formatHz(hz: number): string {
  return `${(hz / 1000000).toFixed(6)}MHz`;
}

function toArrayBuffer(b: Buffer) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function getVGMInfoString(file: string, vgm: VGM) {
  const gain = Math.pow(2, vgm.volumeModifier / 32).toFixed(2);
  const loop = vgm.samples.loop ? `YES (${formatMinSec(vgm.samples.loop)})` : "NO";
  const gd3 = vgm.gd3tag || createEmptyGD3TagObject();
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

function getKSSInfoString(file: string, kss: KSS, m3u?: M3UItem) {
  if (m3u) {
    return `File Name:      ${path.basename(m3u.file)} $${("0" + m3u.song.toString(16)).slice(-2)}(${m3u.song})

Track Title:    ${m3u.title || kss.getTitle()}


`;
  } else {
    return `File Name:      ${path.basename(file)}

    Track Title:    ${kss.getTitle()}
    
    
    `;
  }
}

function getPlayListInfoString(entry: number, entries: string[]) {
  return 1 < entries.length ? `Playlist Entry: ${entry + 1} / ${entries.length}\n` : "";
}

function getInfoString(file: string, data: VGM | KSS, m3u?: M3UItem) {
  if (data instanceof VGM) {
    return getVGMInfoString(file, data);
  }
  return getKSSInfoString(file, data, m3u);
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
          if (Math.abs(mod.clock - mod.requestedClock) > 2.0) {
            const div = mod.rawClock / mod.clock;
            const divStr = div === 1.0 ? "" : `/${div.toFixed(1)}`;
            if (mod.moduleInfo.clockConverter == null) {
              clock = `(${formatHz(mod.rawClock)}${divStr}, clock mismatch)`;
            } else {
              clock = `(${formatHz(mod.rawClock)}${divStr}, clock adjusted)`;
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

function parseSongNumber(s: string | null): number | undefined {
  if (s == null) {
    return undefined;
  }
  if (s.indexOf("0x") === 0) {
    return parseInt(s.slice(2), 16);
  } else if (s.indexOf("$") === 0) {
    return parseInt(s.slice(1), 16);
  }
  return parseInt(s);
}

type M3UItem = {
  type: string;
  file: string;
  basename: string;
  ext: string;
  song: number;
  title: string;
};

function parseM3UItem(item: string): M3UItem | undefined {
  const m = item.match(/^(.*)\.(kss|zip)::kss\s*,\s*(\$?[0-9A-F]+)(\s*,\s*(.*))?$/i);
  if (m != null) {
    return {
      type: "kss",
      file: `${m[1]}.${m[2]}`,
      basename: m[1],
      ext: m[2],
      song: parseSongNumber(m[3]) || 0,
      title: m[5].trim().replace(/\\,/g, ",")
    };
  }
  return undefined;
}

function loadFromM3UItem(item: M3UItem): KSS {
  const file = item.basename + ".kss";
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    return new KSS(new Uint8Array(toArrayBuffer(buf)), path.basename(file), item.song);
  }
  const zipFile = item.basename + ".zip";
  if (fs.existsSync(file)) {
    const zip = fs.readFileSync(zipFile);
    const buf = zlib.gunzipSync(zip);
    return new KSS(new Uint8Array(toArrayBuffer(buf)), path.basename(zipFile), item.song);
  }
  throw new Error(`Can't load entry: ${item.file}`);
}

function loadFile(file: string, song: number): VGM | KSS {
  const buf = fs.readFileSync(file);
  const ab = toArrayBuffer(buf);
  if (/\.s98$/i.test(file)) {
    const vgm = convertS98ToVGM(S98.parse(ab));
    return VGM.parse(vgm.build());
  }

  if (/\.vg(m|z)$/i.test(file)) {
    return VGM.parse(ab);
  }
  return new KSS(new Uint8Array(ab), path.basename(file), song);
}

let playIndex = 0;
let forceResetRequested = false;
let stopExternally = false;
let quitRequested = false;
let player: Player<any> | null = null;

function sendMessage(message: { type: string } & any) {
  if (process.send) {
    process.send(message);
  }
}

function messageHandler(msg: any) {
  if (msg && msg.type === "reload") {
    if (player != null) player.stop();
    stopExternally = true;
  }
  if (msg && msg.type === "goto") {
    playIndex = msg.index;
    if (player != null) player.stop();
    stopExternally = true;
  }
  if (msg && msg.type === "quit") {
    if (player != null) player.stop();
    quitRequested = true;
    stopExternally = true;
  }
  if (msg && msg.type === "speed") {
    if (player != null) player.setSpeed(msg.value);
  }
}

async function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}

async function play(index: number, options: CommandLineOptions): Promise<number> {
  const file = options.files[index];
  await KSSPlayer.ensureInitialize();

  if (!file) {
    throw new Error("Missing argument.");
  }

  try {
    process.on("message", messageHandler);

    const song = parseSongNumber(options.song) || 0;
    const item = parseM3UItem(file);
    const data: VGM | KSS = item ? loadFromM3UItem(item) : loadFile(file, song);

    sendMessage({ type: "start", index });
    stdoutSync((options.banner || "") + getPlayListInfoString(index, options.files) + getInfoString(file, data, item));

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
        { type: "sn76489", clock: 3579545 },
        { type: "ym2413", clock: 3579545 },
        { type: "y8950", clock: 3579545 },
        { type: "k051649", clock: Math.round(3579545 / 2) }
      ];
    }

    const modulePriority = options.prioritize || defaultModulePriority;

    const spfms = await mapper.open(modules, modulePriority);
    await sleep(250);

    if (Object.keys(spfms).length == 0) {
      sendMessage({
        type: "error",
        message: "Can't assign any modules. Make sure proper module is installed on SPFM device."
      });
      return 1;
    }

    const types = modules.map(e => e.type).filter((elem, index, self) => self.indexOf(elem) === index);
    stdoutSync(`${getModuleTableString(types, spfms)}\n\n`);

    if (options.prioritize == null && 6 < modules.length) {
      sendMessage({
        type: "warn",
        message:
          "Optimal module binding feature has been disabled due to too many chips are used in a single VGM. Consider to use `--prioritize` option to specify priority chip types."
      });
    }

    if (data instanceof VGM) {
      const vgmPlayerOptions = {
        ym2612DACEmulationMode: options["simulate-ym2612-dac"]
      };
      player = new VGMPlayer(mapper, vgmPlayerOptions);
      player.setData(data);
    } else {
      player = new KSSPlayer(mapper);
      player.setData(data);
    }
    const fadeTime = options["fade-time"];
    const loopCount = options["loop-count"];
    if (loopCount) {
      player.setLoop(loopCount);
    }
    if (fadeTime) {
      player.setFadeTime(fadeTime);
    }

    await player.play();
    sendMessage({ type: "stop", index });
    stdoutSync("\nPlaying finished.\n");
  } catch (e: any) {
    sendMessage({ type: "error", message: e.message });
    if (options.files.length === 1) {
      throw e;
    }
    while (!stopExternally && !quitRequested) {
      await sleep(100);
    }
  } finally {
    process.off("message", messageHandler);
    if (forceResetRequested) {
      await mapper.reset();
      forceResetRequested = false;
    } else {
      await mapper.damp();
    }
    await sleep(100);
    if (player) {
      player.release();
    }
  }
  return 0;
}

const optionDefinitions = [
  { name: "files", defaultOption: true, multiple: true },
  { name: "banner", type: String },
  { name: "song", type: String },
  { name: "force-reset", type: Boolean },
  { name: "simulate-ym2612-dac", type: String },
  { name: "prioritize", type: String, lazyMultiple: true },
  { name: "loop-count", type: Number },
  { name: "fade-time", type: Number }
];

const options = commandLineArgs(optionDefinitions);

(async function () {
  let exitCode = 0;
  try {
    while (!quitRequested && 0 <= playIndex && playIndex < options.files.length) {
      if (options["force-reset"]) {
        forceResetRequested = true;
      }
      stopExternally = false;
      exitCode = await play(playIndex, options);
      if (!stopExternally) playIndex++;
    }
  } finally {
    await mapper.close();
    process.exit(exitCode);
  }
})();

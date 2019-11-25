import fs from "fs";
import path from "path";
import SPFMMapperConfig from "./spfm-mapper-config";

import commandLineArgs, { CommandLineOptions } from "command-line-args";

import zlib from "zlib";
import SPFMMapper from "./spfm-mapper";
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

function toArrayBuffer(b: Buffer) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function getVGMInfoString(file: string, vgm: VGM) {
  const gain = Math.pow(2, vgm.volumeModifier / 32).toFixed(2);
  const loop = vgm.samples.loop ? `YES (${formatMinSec(vgm.samples.loop)})` : "NO";
  const gd3 = vgm.gd3tag;
  return `File Name:      ${path.basename(file)}

Track Title:    ${gd3.trackTitle}
Game Name:      ${gd3.gameName}
System:         ${gd3.system}
Composer:       ${gd3.composer}
Release:        ${gd3.releaseDate}
Version:        ${vgm.version.major}.${vgm.version.minor}\tGain: ${gain}\tLoop: ${loop}
VGM by:         ${gd3.vgmBy}
Notes:          ${gd3.notes}

Used chips:     ${vgm.usedChips.join(", ").toUpperCase()}


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
    await mapper.open();
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

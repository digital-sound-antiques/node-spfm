import fs from "fs";
import path from "path";
const keypress = require("keypress");
import { ChildProcess, fork } from "child_process";

import commandLineArgs from "command-line-args";
import { formatMinSec } from "vgm-parser";
import commandLineUsage from "command-line-usage";
import SPFMMapperConfig from "../spfm-mapper-config";

function getHeaderString() {
  return `SPFM Player
-----------
`;
}

function getPlayListInfoString(file: string, entry: number, entries: string[]) {
  return 1 < entries.length
    ? `
Playlist File:  ${file}
Playlist Entry: ${entry} / ${entries.length}
`
    : "";
}

function getGaugeString(current: number, total: number, width: number) {
  const progress = Math.round((current / total) * width);
  const array = [];
  for (let i = 0; i < width; i++) {
    if (i < progress) {
      array.push(">");
    } else {
      array.push("-");
    }
  }
  return array.join("");
}

function loadM3UPlayList(file: string) {
  const dirname = path.dirname(file);
  return fs
    .readFileSync(file, { encoding: "utf-8" })
    .replace(/^#.*$/gm, "")
    .replace(/\r\n/g, "\n")
    .split(/\n/)
    .filter(e => !/^\s*$/.test(e))
    .map(e => dirname + "/" + e);
}

export default async function main(argv: string[]) {
  const optionDefinitions = [
    { name: "file", defaultOption: true },
    { name: "song", alias: "s", typeLabel: "{underline num}", description: "KSS subsong number.", type: Number },
    { name: "help", alias: "h", type: Boolean, description: "Show this help." }
  ];
  const sections = [
    {
      header: "spfm-play",
      content: "Play music files with SPFM-Light."
    },
    {
      header: "SYNOPSIS",
      content: ["{underline spfm} {underline play} [<option>] <file>"]
    },
    {
      header: "OPTIONS",
      optionList: optionDefinitions
    },
    {
      header: "KEYS",
      content: [
        "Cursor Left/Right - Down/Up playback speed.",
        "Cursor Down - Default playback speed.",
        "R - Restart current Track",
        "PageUp/B - Previous Track",
        "PageDown/N - Next Track"
      ]
    },
    {
      header: "SUPPORTED FILETYPES",
      content: [
        "Video Game Music Files (.vgm, .vgz)",
        "KSS Files (.kss)",
        "MGSDRV Files (.mgs)",
        "MuSICA / Kinrou5 Files (.bgm)",
        "MPK Files (.mpk)",
        "OPLL Driver Files (.opx)"
      ]
    },
    {
      header: "SUPPORTED MODULES",
      content: [
        "AY-3-8910 (PSG)",
        "SN76489 (DPSG)",
        "YM2203 (OPN)",
        "YM2608 (OPNA)",
        "YM2413 (OPLL)",
        "YM3526 (OPL)",
        "YM3812 (OPL2)"
      ]
    }
  ];
  const options = commandLineArgs(optionDefinitions, { argv });
  if (options.help) {
    console.log(commandLineUsage(sections));
    return;
  }

  if (SPFMMapperConfig.default.devices.length === 0) {
    throw new Error("No configurations. Try `spfm config` first.");
  }

  if (options.file == null) {
    throw new Error("Missing file argument.");
  }
  const file = options.file;

  keypress(process.stdin);

  process.stdin.setRawMode(true);
  process.stdin.resume();

  let onKeyPress;

  try {
    let playlist;

    if (/.m3u$/i.test(file)) {
      playlist = loadM3UPlayList(file);
    } else {
      playlist = [file];
    }

    const child_options = options.song ? ["-s", options.song] : [];

    let child: ChildProcess;
    let index = 0;
    let indexOffset = 0;
    let speed = 0;
    let ctrlc = 0;

    onKeyPress = (ch: any, key: any) => {
      if (key) {
        if (playlist.length > 1 && index < playlist.length - 1 && (key.name === "n" || key.name === "pagedown")) {
          child.send({ type: "stop" });
          indexOffset = 1;
        }
        if (playlist.length > 1 && 0 < index && (key.name === "b" || key.name === "pageup")) {
          indexOffset = -1;
          child.send({ type: "stop" });
        }
        if (key.name === "q") {
          child.send({ type: "stop" });
          indexOffset = playlist.length;
        }

        if (key.name === "r") {
          child.send({ type: "stop" });
          indexOffset = 0;
        }

        if (key.ctrl && key.name === "c") {
          console.log("Ctrl-C pressed.");
          ctrlc++;
          child.send({ type: "stop" });
          indexOffset = playlist.length;
        }

        if (key.name === "right") {
          speed = Math.min(16, speed + 1);
          child.send({ type: "speed", value: speed });
        }
        if (key.name === "left") {
          speed = Math.max(-16, speed - 1);
          child.send({ type: "speed", value: speed });
        }
        if (key.name === "down") {
          speed = 0;
          child.send({ type: "speed", value: speed });
        }
      }
    };
    process.stdin.on("keypress", onKeyPress);

    while (index < playlist.length) {
      const file = playlist[index];
      const banner =
        (1 < playlist.length ? "\u001bc" : "") + getHeaderString() + getPlayListInfoString(file, index + 1, playlist);
      speed = 0;
      indexOffset = 1;
      await new Promise((resolve, reject) => {
        try {
          const target = [__dirname, "../play-process"].join("/");
          child = fork(target, ["--banner", banner, ...child_options, file]);
          child.on("message", msg => {
            if (msg.type === "progress") {
              if (msg.total) {
                const playing = ((msg.current / msg.total) * 100).toFixed(2);
                process.stdout.write(
                  `Playing ${playing}% \b\b\b\t${formatMinSec(msg.current)} / ${formatMinSec(msg.total)} seconds\r`
                );
              } else {
                process.stdout.write(`Playing\t${formatMinSec(msg.current)} seconds\r`);
              }
            } else if (msg.type === "ram_write") {
              if (msg.total) {
                process.stdout.write(`${msg.title} [${getGaugeString(msg.current, msg.total, 16)}]              \r`);
              } else {
                process.stdout.write(`${msg.title}...`);
              }
            }
          });
          child.on("close", () => resolve());
        } catch (e) {
          reject();
        }
      });
      index += indexOffset;
    }
  } catch (e) {
    throw e;
  } finally {
    if (onKeyPress) {
      process.stdin.off("keypress", onKeyPress);
    }
    process.stdin.pause();
    process.stdin.setRawMode(false);
  }
}

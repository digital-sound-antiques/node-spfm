import fs from "fs";
import path from "path";
const keypress = require("keypress");
import { ChildProcess, fork } from "child_process";
import chalk from "chalk";

import commandLineArgs from "command-line-args";
import { formatMinSec } from "vgm-parser";
import commandLineUsage from "command-line-usage";
import SPFMMapperConfig from "../spfm-mapper-config";

function getHeaderString(playlist: boolean, file: string) {
  if (playlist) {
    return `\u001bcSPFM Player
-----------

Playlist File: ${file}
`;
  }
  return `SPFM Player
-----------

`;
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
  let text = fs.readFileSync(file, { encoding: "utf-8" });
  return text
    .replace(/^\ufeff/, "")
    .replace(/^#.*$/gm, "")
    .replace(/\r\n/g, "\n")
    .split(/\n/)
    .filter(e => !/^\s*$/.test(e))
    .map(e => dirname + "/" + e);
}

function buildPlayerProcessOptions(options: commandLineArgs.CommandLineOptions): Array<string> {
  const child_options = Array<string>();
  if (options.song) {
    child_options.push("--song");
    child_options.push(options.song);
  }
  if (options["force-reset"]) {
    child_options.push("--force-reset");
  }
  if (options.prioritize) {
    for (const p of options.prioritize) {
      child_options.push("--prioritize");
      child_options.push(p.toLowerCase());
    }
  }
  if (options["simulate-ym2612-dac"] != null) {
    const value = options["simulate-ym2612-dac"].toLowerCase();
    if (["none", "ssg", "adpcm", "adpcm2"].indexOf(value) < 0) {
      throw new Error(`Invalid parameter: ${value}`);
    }
    child_options.push("--simulate-ym2612-dac");
    child_options.push(value);
  }
  if (options["loop-count"] != null) {
    child_options.push("--loop-count");
    child_options.push(options["loop-count"]);
  }
  if (options["fade-time"] != null) {
    child_options.push("--fade-time");
    child_options.push(options["fade-time"]);
  }
  return child_options;
}

export default async function main(argv: string[]) {
  const optionDefinitions = [
    { name: "file", defaultOption: true },
    { name: "song", alias: "s", typeLabel: "{underline num}", description: "KSS subsong number.", type: Number },
    { name: "help", alias: "h", type: Boolean, description: "Show this help." },
    { name: "force-reset", type: Boolean, description: "Always reset device after stop playing." },
    {
      name: "fade-time",
      type: Number,
      description:
        "Specify time to continue playing in seconds after the loop count is exceeded. Fade-out works only if implemented (currently none of chips supports it)."
    },
    {
      name: "loop-count",
      type: Number,
      description: "Specifies the number of loops to be played."
    },
    {
      name: "prioritize",
      alias: "p",
      type: String,
      typeLabel: "{underline chip}",
      lazyMultiple: true,
      description: "Assign modules with priority to the specified chip type."
    },
    {
      name: "simulate-ym2612-dac",
      type: String,
      typeLabel: "{underline mode}",
      defaultValue: "adpcm",
      description:
        "(Experimental) Simulate YM2612 DAC stream with YM2608's SSG or ADPCM. Valid values are 'none', 'ssg', 'adpcm' or 'adpcm2'. The default value is 'adpcm'. If 'adpcm' results wrong playback, use 'adpcm2' instead."
    }
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
        "PageDown/N - Next Track",
        "Shift + PageUp/B - Previous 10 Tracks",
        "Shift + PageDown/N - Next 10 Tracks"
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
        "YM2612 (OPN2)",
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
    let playlist: string[];

    if (/.m3u$/i.test(file)) {
      playlist = loadM3UPlayList(file);
    } else {
      playlist = [file];
    }

    let child: ChildProcess;
    let index = 0;
    let speed = 0;

    onKeyPress = (ch: any, key: any) => {
      if (key) {
        if (key.name === "n" || key.name === "pagedown") {
          if (index < playlist.length - 1) {
            index += key.shift ? 10 : 1;
            index = Math.min(playlist.length - 1, index);
            child.send({ type: "goto", index });
          }
        }
        if (key.name === "b" || key.name === "pageup") {
          if (0 < index) {
            index -= key.shift ? 10 : 1;
            index = Math.max(0, index);
            child.send({ type: "goto", index });
          }
        }
        if (key.name === "r") {
          child.send({ type: "reload", index });
        }
        if (key.name === "q") {
          child.send({ type: "quit" });
        }
        if (key.ctrl && key.name === "c") {
          console.log("Ctrl-C pressed.");
          child.send({ type: "quit" });
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

    const banner = getHeaderString(1 < playlist.length, file);
    speed = 0;

    await new Promise<void>((resolve, reject) => {
      try {
        const target = [__dirname, "../play-process"].join("/");
        child = fork(target, ["--banner", banner, ...buildPlayerProcessOptions(options), ...playlist]);
        child.on("message", (msg: any) => {
          if (msg.type === "error") {
            console.error(`${chalk.red("Error: " + msg.message)}\n`);
          } else if (msg.type === "warn") {
            console.warn(`${chalk.yellow("Warning: " + msg.message)}\n`);
          } else if (msg.type === "start") {
            index = msg.index;
          } else if (msg.type === "stop") {
          } else if (msg.type === "progress") {
            if (msg.total) {
              const playing = ((msg.current / msg.total) * 100).toFixed(2);
              process.stdout.write(
                `Playing ${playing}% ${formatMinSec(msg.current)} / ${formatMinSec(msg.total)} seconds              \r`
              );
            } else {
              process.stdout.write(`Playing\t${formatMinSec(msg.current)} seconds          \r`);
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

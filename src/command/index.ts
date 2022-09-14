import commandLineArgs from "command-line-args";
import commandLineUsage from "command-line-usage";

import chalk from "chalk";

import doDevicesCommand from "./devices";
import doPlayCommand from "./play";
import doConfigCommand from "./config";

const banner = `░▓░░░░▓░░▓▓▓▓░░▓▓▓▓▓░░▓▓▓▓▓▓░░░░░░░░▓▓▓▓░░▓▓▓▓▓░░▓▓▓▓▓▓░▓░░░░▓░
░▓▓░░░▓░▓░░░░▓░▓░░░░▓░▓░░░░░░░░░░░░▓░░░░░░▓░░░░▓░▓░░░░░░▓▓░░▓▓░
░█░█░░█░█░░░░█░█░░░░█░█████░░█████░░████░░█░░░░█░█████░░█░██░█░
░█░░█░█░█░░░░█░█░░░░█░█░░░░░░░░░░░░░░░░░█░█████░░█░░░░░░█░░░░█░
░▓░░░▓▓░▓░░░░▓░▓░░░░▓░▓░░░░░░░░░░░░▓░░░░▓░▓░░░░░░▓░░░░░░▓░░░░▓░
░▒░░░░▒░░▒▒▒▒░░▒▒▒▒▒░░▒▒▒▒▒▒░░░░░░░░▒▒▒▒░░▒░░░░░░▒░░░░░░▒░░░░▒░`;

const sections = [
  {
    raw: true,
    content: chalk.blueBright(banner)
  },
  {
    header: "NODE-SPFM",
    content: "A command-line controller for SPFM-Light."
  },
  {
    header: "SYNOPSIS",
    content: ["{underline spfm play} [<option>] <file>", "{underline spfm devices} [-l]", "{underline spfm config}"]
  },
  {
    header: "COMMANDS",
    content: [
      { name: "play", summary: "Play music files." },
      { name: "devices", summary: "Show connected devices." },
      { name: "config", summary: "Interactive configuration." },
      { name: "version", summary: "Show version of this commmand." }
    ]
  },
  {
    content: ["See 'spfm <command> --help' to read about a specific command usage."],
    raw: true
  }
];

export default async function main(argv: string[]) {
  const usage = commandLineUsage(sections);
  const mainDefinitions = [{ name: "command", defaultOption: true }];
  const mainOptions = commandLineArgs(mainDefinitions, { stopAtFirstUnknown: true });

  try {
    const args = mainOptions._unknown || [];
    if (mainOptions.command === "devices") {
      await doDevicesCommand(args);
    } else if (mainOptions.command === "play") {
      await doPlayCommand(args);
    } else if (mainOptions.command === "config") {
      await doConfigCommand(args);
    } else if (mainOptions.command === "version") {
      var json = require("../../package.json");
      console.info(json.version);
    } else if (mainOptions.command === "help") {
      console.info(usage);
    } else {
      console.info(usage);
    }
  } catch (e: any) {
    console.error(e.message);
  }
}

main(process.argv);

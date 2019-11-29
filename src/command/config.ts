import inquirer from "inquirer";
import spfm from "../spfm";
import commandLineArgs from "command-line-args";
import commandLineUsage from "command-line-usage";
import SPFMMapperConfig, { SPFMDeviceConfig } from "../spfm-mapper-config";
import chalk from "chalk";
import {
  getCompatibleDevices,
  getAvailableDevices,
  getAvailableModules,
  getAvailableCompatibleModules
} from "../spfm-mapper";
import { SPFMModuleInfo } from "src/spfm-module";

function formatHz(hz: number): string {
  return `${(hz / 1000000).toFixed(2)}MHz`;
}

const clocks = [
  { name: formatHz(1789773), value: 1789773 },
  { name: formatHz(3579545), value: 3579545 },
  { name: formatHz(3993600), value: 3993600 },
  { name: formatHz(4000000), value: 4000000 },
  { name: formatHz(7670454), value: 7670454 },
  { name: formatHz(7987200), value: 7987200 },
  { name: formatHz(8000000), value: 8000000 },
  { name: formatHz(14318180), value: 14318180 },
  { name: formatHz(33868800), value: 33868800 }
];

function getDefaultClockIndex(chip: string) {
  const clock = getDefaultClock(chip);
  return clocks.findIndex(e => e.value === clock);
}

function getDefaultClock(chip: string) {
  switch (chip) {
    case "ym3812":
    case "ym3526":
    case "ym2413":
    case "y8950":
      return 3579545;
    case "ym2203":
    case "ym2151":
      return 4000000;
    case "ym2612":
      return 7670454;
    case "ym2608":
      return 8000000;
    case "k051649":
    case "ay8910":
      return 1789773;
    case "ymf262":
      return 14318180;
    case "ymf278b":
      return 33868800;
    default:
      return 0;
  }
}

export function printConfig() {
  for (let d of SPFMMapperConfig.default.devices) {
    console.log(chalk.underline(chalk.bold(`\n${d.id}\n`)));
    for (let i = 0; i < 2; i++) {
      const m = d.modules[i];
      const mod = `SLOT${i}:`;
      if (m.type) {
        const type = d.modules[i].type.toUpperCase();
        const clock = `${formatHz(d.modules[i].clock)}`;
        const compats = getCompatibleDevices(m.type);
        const ctext =
          compats.length === 0
            ? ""
            : "c/w " +
              compats
                .map(e => {
                  return `${e.type.toUpperCase()}`;
                })
                .join(" ");
        console.log(`- ${mod} ${type} ${clock} ${chalk.grey(ctext)}`);
      } else {
        console.log(chalk.grey(`- ${mod} ${"EMPTY"}`));
      }
    }
  }
  console.log("");
}

function printModules(modules: SPFMModuleInfo[]) {
  for (const m of modules) {
    const clock = m.clockConverter ? `${formatHz(m.clock)} * (clock adjust)` : `${formatHz(m.clock)}`;
    if (m.type === m.rawType) {
      console.info(`${m.deviceId} SLOT${m.slot}: ${m.type.toUpperCase()} ${clock}`);
    } else {
      console.info(
        `${m.deviceId} SLOT${m.slot}: ${m.rawType.toUpperCase()} ${formatHz(
          m.rawClock
        )} as ${m.type.toUpperCase()} ${clock}`
      );
    }
  }
}

export default async function main(argv: string[]) {
  const optionDefinitions = [
    { name: "show", type: Boolean, alias: "s", description: "Show current configuration." },
    {
      name: "map",
      type: Boolean,
      alias: "m",
      description: "List of available module mapping on current configuration."
    },
    { name: "clear", type: Boolean, alias: "c", description: "Clear all configuration data." },
    { name: "help", type: Boolean, alias: "h", description: "Show this help." }
  ];
  const sections = [
    {
      header: "spfm-config",
      content: "Configure settings interactively."
    },
    {
      header: "SYNOPSIS",
      content: ["{underline spfm} {underline config} [<option>]"]
    },
    {
      header: "OPTIONS",
      optionList: optionDefinitions
    },
    {
      header: "FILES",
      content: [
        "{underline $HOME/.config/node-spfm} is used as configuration directory. If {bold $XDG_CONFIG_HOME} is set, {underline $XDG_CONFIG_HOME/node-spfm} will be used."
      ]
    },
    {
      header: "SUPPORTED DEVICES",
      content: ["SPFM Light"]
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
    console.info(commandLineUsage(sections));
    return;
  }

  if (options.show) {
    printConfig();
    return;
  }

  if (options.clear) {
    const answer = await inquirer.prompt([
      { name: "confirm", type: "confirm", message: "Are you sure to clear configuration?" }
    ]);
    if (answer.confirm) {
      SPFMMapperConfig.default.clear();
      console.info("Done.");
    }
    return;
  }

  if (options.map) {
    const devices = await getAvailableDevices(SPFMMapperConfig.default, true);
    const modules = getAvailableModules(devices, { useClockConverter: true });
    const compatibleModules = getAvailableCompatibleModules(devices, {
      useClockConverter: true,
      useTypeConverter: false
    });
    console.info("List of possible module mapping\n");
    printModules(modules);
    console.info("");
    printModules(compatibleModules);
    console.info("");
    return;
  }

  const spfms = await spfm.list();
  const names = spfms.map(e => {
    return {
      name: `${e.serialNumber} (${e.path})`,
      value: e.serialNumber,
      short: e.serialNumber
    };
  });

  for (const d of SPFMMapperConfig.default.devices) {
    if (names.findIndex(e => e.value === d.id) < 0) {
      names.push({
        name: `${d.id} (Offline)`,
        value: d.id,
        short: d.id
      });
    }
  }

  if (names.length === 0) {
    throw new Error("No device found. Connect SPFM Light and try again.");
  }

  const chips = [
    { name: "(none)", value: null },
    { name: "AY8910 (PSG)", value: "ay8910" },
    { name: "YM2151 (OPM)", value: "ym2151" },
    { name: "YM2203 (OPN)", value: "ym2203" },
    { name: "YM2413 (OPLL)", value: "ym2413" },
    { name: "YM2612 (OPN2)", value: "ym2612" },
    { name: "YM2608 (OPNA)", value: "ym2608" },
    { name: "YM3526 (OPL)", value: "ym3526" },
    { name: "YM3812 (OPL2)", value: "ym3812" },
    { name: "Y8950 (OPL)", value: "y8950" },
    { name: "YMF262 (OPL3)", value: "ymf262" },
    { name: "K051649 (SCC)", value: "k051649" },
    { name: "SN76489 (DPSG)", value: "sn76489" }
  ];

  const answer: SPFMDeviceConfig = await inquirer.prompt([
    { name: "id", type: "list", choices: names, message: "Select device to configure:" },
    {
      name: "modules.0.type",
      type: "list",
      choices: chips,
      message: "Select 1st module:",
      default: (ans: any) => {
        const device = SPFMMapperConfig.default.findDeviceById(ans.id);
        if (device) {
          return chips.findIndex(e => device.modules[0].type === e.value);
        }
        return -1;
      }
    },
    {
      name: "modules.0.clock",
      type: "list",
      choices: clocks,
      message: (ans: any) => `Select 1st module clock:`,
      when: (ans: any) => {
        return ans.modules[0].type != undefined;
      },
      default: (ans: any) => {
        const device = SPFMMapperConfig.default.findDeviceById(ans.id);
        if (device && device.modules[0].type == ans.modules[0].type) {
          return clocks.findIndex(e => device.modules[0].clock === e.value);
        }
        return getDefaultClockIndex(ans.modules[0].type);
      }
    },
    {
      name: "modules.1.type",
      type: "list",
      choices: chips,
      message: "Select 2nd module:",
      default: (ans: any) => {
        const device = SPFMMapperConfig.default.findDeviceById(ans.id);
        if (device) {
          return chips.findIndex(e => device.modules[1].type === e.value);
        }
        return -1;
      }
    },
    {
      name: "modules.1.clock",
      type: "list",
      choices: clocks,
      message: (ans: any) => `Select 2nd module clock:`,
      when: (ans: any) => {
        return ans.modules[1].type != undefined;
      },
      default: (ans: any) => {
        const device = SPFMMapperConfig.default.findDeviceById(ans.id);
        if (device && device.modules[1].type == ans.modules[1].type) {
          return clocks.findIndex(e => device.modules[1].clock === e.value);
        }
        return getDefaultClockIndex(ans.modules[1].type);
      }
    }
  ]);

  answer.modules[0].slot = 0;
  answer.modules[1].slot = 1;

  SPFMMapperConfig.default.updateDevice(answer);
  console.info(`Updated: ${SPFMMapperConfig.default.file}`);
}

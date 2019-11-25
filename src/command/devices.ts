import CommandLineArgs from "command-line-args";
import SPFM, { SPFMPortInfo } from "../spfm";
import commandLineUsage from "command-line-usage";

async function list(): Promise<SPFMPortInfo[]> {
  const ports = await SPFM.list();
  return ports.filter(p => p.vendorId === "0403");
}

export default async function(argv: string[]) {
  const optionDefinitions = [
    { name: "long", type: Boolean, alias: "l", description: "Show device properties with longer format." },
    { name: "help", type: Boolean, alias: "h", description: "Show this help." }
  ];
  const sections = [
    {
      header: "spfm-devices",
      content: "List connected devices."
    },
    {
      header: "SYNOPSIS",
      content: ["{underline spfm} {underline devices} [<option>]"]
    },
    {
      header: "OPTIONS",
      optionList: optionDefinitions
    },
    {
      header: "SUPPORTED DEVICES",
      content: ["SPFM Light"]
    }
  ];
  const options = CommandLineArgs(optionDefinitions, { argv });
  if (options.help) {
    console.log(commandLineUsage(sections));
    return;
  }

  const devices = await list();

  if (devices.length === 0) {
    console.info("No devices attached");
    return;
  }

  console.info("List of devices attached");
  if (options.long) {
    console.info(
      devices
        .map((d, i) => {
          return `${d.path}\t${d.type}\tserial:${d.serialNumber} manufacture:${d.manufacturer} product:${d.productId} vendor:${d.vendorId}`;
        })
        .join("\n")
    );
  } else {
    console.info(
      devices
        .map((d, i) => {
          return `${d.path}\t${d.type}`;
        })
        .join("\n")
    );
  }
}

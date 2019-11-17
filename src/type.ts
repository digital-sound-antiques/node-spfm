import { ChipName } from "vgm-parser";

export type SPFMType = "SPFM" | "SPFM_Light" | null;

export type SPFMDeviceConfig = {
  path: string;
  modules: ReBirthModuleConfig[];
};

export type ReBirthModuleConfig = {
  type: ChipName;
  slot: number;
  clock: number;
};

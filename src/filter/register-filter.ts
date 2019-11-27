export type RegisterData = {
  port: number | null;
  a: number | null;
  d: number;
};

type ModuleConfig = {
  type: string;
  slot: number;
  clock: number;
};

export interface RegisterFilter {
  filterReg(context: any, data: RegisterData): RegisterData[];
}

export type RegisterFilterBuilder = (inModule: ModuleConfig, outModule: ModuleConfig) => RegisterFilter;

import { RegisterFilter, RegisterData } from "./register-filter";

export class OKIM6258ToYM2608Filter implements RegisterFilter {
  filterReg(context: any, data: RegisterData): RegisterData[] {
    return [];
  }
}

import { OPLLVoice, OPLLSlotParam } from "./opll-voices";

export type OPNSlotParam = {
  dt: number;
  ml: number;
  tl: number;
  ks: number;
  ar: number;
  am: number;
  dr: number;
  sr: number;
  sl: number;
  rr: number;
  ssg: number;
};

export type OPNVoice = {
  fb: number;
  con: number;
  ams: number;
  pms: number;
  slots: OPNSlotParam[]; // slots[0...3] corresponds to slot1, slot3, slot2, slot4
};

function R(rate: number): number {
  switch (rate) {
    case 0:
      return 0;
    case 15:
      return 31;
    default:
      return Math.min(31, Math.round((rate + 1.5) * 2));
  }
}

function DR(rate: number): number {
  return [0,6,7,10,12,14,16,18,20,22,24,26,28,30,31,31][rate];
}

export function OPLLToOPNSlotParam(slot: OPLLSlotParam, car: boolean): OPNSlotParam {
  return {
    dt: 0,
    ml: slot.ml,
    tl: Math.min(127, slot.tl + (slot.wf ? (car ? 8 : 5) : 0)),
    ks: slot.kr * 2,
    ar: DR(slot.ar),
    am: slot.am,
    dr: DR(slot.dr),
    sr: DR(slot.eg ? 0 : slot.rr),
    sl: slot.sl,
    rr: slot.eg ? Math.min(15, slot.rr) : car ? 6 : 0,
    ssg: 0
  };
}

export function createOPNSlotParam(): OPNSlotParam {
  return {
    dt: 0,
    ml: 0,
    tl: 0,
    ks: 0,
    ar: 0,
    am: 0,
    dr: 0,
    sr: 0,
    sl: 0,
    rr: 0,
    ssg: 0
  };
}

const emptySlot = createOPNSlotParam();

export function OPLLVoiceToOPNVoice(opll: OPLLVoice): OPNVoice {
  return {
    fb: opll.slots[0].wf ? Math.min(7, opll.fb * 2) : opll.fb,
    con: 2,
    ams: 4, // 5.9dB
    pms: opll.slots[0].pm || opll.slots[1].pm ? 2 : 0, // 6.7cent or 0
    slots: [OPLLToOPNSlotParam(opll.slots[0], false), emptySlot, emptySlot, OPLLToOPNSlotParam(opll.slots[1], true)]
  };
}

export function createOPNVoice(): OPNVoice {
  return {
    fb: 0,
    con: 0,
    ams: 0,
    pms: 0,
    slots: [emptySlot, emptySlot, emptySlot, emptySlot]
  };
}

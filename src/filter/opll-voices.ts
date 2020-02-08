export type OPLLSlotParam = {
  am: number;
  pm: number;
  eg: number;
  ml: number;
  kr: number;
  kl: number;
  tl: number;
  ar: number;
  dr: number;
  sl: number;
  rr: number;
  wf: number;
};

export type OPLLVoice = {
  fb: number;
  slots: OPLLSlotParam[];
};

export const OPLL_RAW_VOICES = [
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], // 0: Original
  [0x61, 0x61, 0x1e, 0x17, 0xf0, 0x78, 0x00, 0x17], // 1: Violin
  [0x13, 0x41, 0x19, 0x0e, 0xf8, 0xf8, 0x23, 0x13], // 2: Guitar
  [0x13, 0x01, 0x99, 0x00, 0xf2, 0xc4, 0x21, 0x23], // 3: Piano
  [0x11, 0x61, 0x0e, 0x07, 0xfd, 0x64, 0x70, 0x27], // 4: Flute
  [0x32, 0x21, 0x1e, 0x06, 0xf1, 0x76, 0x01, 0x28], // 5: Clarinet
  [0x21, 0x22, 0x16, 0x05, 0xf0, 0x71, 0x00, 0x18], // 6: Oboe
  [0x21, 0x61, 0x1d, 0x07, 0x82, 0x81, 0x11, 0x07], // 7: Trumpet
  [0x33, 0x21, 0x2d, 0x13, 0xb0, 0x70, 0x00, 0x07], // 8: Organ
  [0x61, 0x61, 0x1b, 0x06, 0x64, 0x65, 0x10, 0x17], // 9: Horn
  [0x41, 0x61, 0x0b, 0x1b, 0x85, 0xf0, 0x71, 0x07], // A: Synthesizer
  [0x33, 0x01, 0x83, 0x11, 0xfa, 0xef, 0x10, 0x04], // B: Harpsichord
  [0x17, 0xc1, 0x20, 0x07, 0xfe, 0xf7, 0x22, 0x22], // C: Vibraphone
  [0x61, 0x50, 0x0c, 0x05, 0xd2, 0xf5, 0x40, 0x42], // D: Synthesizer Bass
  [0x01, 0x01, 0x56, 0x03, 0xf4, 0x90, 0x03, 0x02], // E: Acoustic Bass
  [0x41, 0x41, 0x89, 0x03, 0xf1, 0xe4, 0xc0, 0x13], // F: Electric Guitar
  [0x01, 0x01, 0x18, 0x0f, 0xdf, 0xf8, 0x6a, 0x6d], // R: Bass Drum
  [0x01, 0x01, 0x00, 0x00, 0xc8, 0xd8, 0xa7, 0x68], // R: High-Hat(M) / Snare Drum(C)
  [0x05, 0x01, 0x00, 0x00, 0xf8, 0xaa, 0x59, 0x55] // R: Tom-tom(M) / Top Cymbal(C)
];
export const VRC7_RAW_VOICES = [
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  [0x03, 0x21, 0x05, 0x06, 0xe8, 0x81, 0x42, 0x27],
  [0x13, 0x41, 0x14, 0x0d, 0xd8, 0xf6, 0x23, 0x12],
  [0x11, 0x11, 0x08, 0x08, 0xfa, 0xb2, 0x20, 0x12],
  [0x31, 0x61, 0x0c, 0x07, 0xa8, 0x64, 0x61, 0x27],
  [0x32, 0x21, 0x1e, 0x06, 0xe1, 0x76, 0x01, 0x28],
  [0x02, 0x01, 0x06, 0x00, 0xa3, 0xe2, 0xf4, 0xf4],
  [0x21, 0x61, 0x1d, 0x07, 0x82, 0x81, 0x11, 0x07],
  [0x23, 0x21, 0x22, 0x17, 0xa2, 0x72, 0x01, 0x17],
  [0x35, 0x11, 0x25, 0x00, 0x40, 0x73, 0x72, 0x01],
  [0xb5, 0x01, 0x0f, 0x0f, 0xa8, 0xa5, 0x51, 0x02],
  [0x17, 0xc1, 0x24, 0x07, 0xf8, 0xf8, 0x22, 0x12],
  [0x71, 0x23, 0x11, 0x06, 0x65, 0x74, 0x18, 0x16],
  [0x01, 0x02, 0xd3, 0x05, 0xc9, 0x95, 0x03, 0x02],
  [0x61, 0x63, 0x0c, 0x00, 0x94, 0xc0, 0x33, 0xf6],
  [0x21, 0x72, 0x0d, 0x00, 0xc1, 0xd5, 0x56, 0x06],
  [0x01, 0x01, 0x18, 0x0f, 0xdf, 0xf8, 0x6a, 0x6d],
  [0x01, 0x01, 0x00, 0x00, 0xc8, 0xd8, 0xa7, 0x68],
  [0x05, 0x01, 0x00, 0x00, 0xf8, 0xaa, 0x59, 0x55]
];

export function toOPLLVoice(d: ArrayLike<number>): OPLLVoice {
  return {
    fb: d[3] & 7,
    slots: [
      {
        am: (d[0] >> 7) & 1,
        pm: (d[0] >> 6) & 1,
        eg: (d[0] >> 5) & 1,
        kr: (d[0] >> 4) & 1,
        ml: d[0] & 0xf,
        kl: (d[2] >> 6) & 3,
        tl: d[2] & 0x3f,
        ar: (d[4] >> 4) & 0xf,
        dr: d[4] & 0xf,
        sl: (d[6] >> 4) & 0xf,
        rr: d[6] & 0xf,
        wf: (d[3] >> 3) & 1
      },
      {
        am: (d[1] >> 7) & 1,
        pm: (d[1] >> 6) & 1,
        eg: (d[1] >> 5) & 1,
        kr: (d[1] >> 4) & 1,
        ml: d[1] & 0xf,
        kl: (d[3] >> 6) & 3,
        tl: 0,
        ar: (d[5] >> 4) & 0xf,
        dr: d[5] & 0xf,
        sl: (d[7] >> 4) & 0xf,
        rr: d[7] & 0xf,
        wf: (d[3] >> 4) & 1
      }
    ]
  };
}

export const OPLL_VOICES: OPLLVoice[] = OPLL_RAW_VOICES.map(toOPLLVoice);
export const VRC7_VOICES: OPLLVoice[] = VRC7_RAW_VOICES.map(toOPLLVoice);
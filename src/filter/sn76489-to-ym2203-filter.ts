import { RegisterFilter, RegisterData } from "./register-filter";

const voltbl = [15, 14, 13, 13, 12, 12, 11, 10, 9, 9, 8, 7, 7, 6, 5, 0];

function makeSQRVoice(port: number, ch: number) {
  return [
    { port, a: 0x30 + ch, d: 0x02 }, // FM 1_1 DT/MULTI
    { port, a: 0x3c + ch, d: 0x01 }, // FM 1_4 DT/MULTI
    { port, a: 0x40 + ch, d: 0x18 }, // FM 1_1 TL
    { port, a: 0x4c + ch, d: 0x7f }, // FM 1_4 TL
    { port, a: 0x50 + ch, d: 0x1f }, // FM 1_1 KS/AR
    { port, a: 0x5c + ch, d: 0x1f }, // FM 1_4 KS/AR
    { port, a: 0x60 + ch, d: 0x00 }, // FM 1_1 AM/DR
    { port, a: 0x6c + ch, d: 0x00 }, // FM 1_4 AM/DR
    { port, a: 0x70 + ch, d: 0x00 }, // FM 1_1 SR
    { port, a: 0x7c + ch, d: 0x00 }, // FM 1_4 SR
    { port, a: 0x80 + ch, d: 0x00 }, // FM 1_1 SL/RR
    { port, a: 0x8c + ch, d: 0x0f }, // FM 1_4 SL/RR
    { port, a: 0xb0 + ch, d: 0x3d }, // FM 1 FB:7/ALG:5
    { port, a: 0xb4 + ch, d: 0xc0 } // FM 1 LR/AMS/PMS
  ];
}

function fdiv2fnum(fdiv: number) {
  if (fdiv == 0) return 0;
  const clk = 1.0;
  const freq = clk / (2 * 16 * fdiv);
  let fnum = Math.round((144 * freq * (1 << 20)) / clk);
  let blk = 0;
  while (fnum > 0x7ff) {
    fnum >>= 1;
    blk++;
  }
  blk = Math.min(7, blk);
  return (blk << 11) | fnum;
}

export default class SN76489ToYM2203Filter implements RegisterFilter {
  _fdiv = new Uint16Array(4);
  _ch = 0;
  _type = 0;
  _initialized = false;

  filterReg(context: any, data: RegisterData): RegisterData[] {
    const port = 0;
    let result = new Array<RegisterData>();

    if (!this._initialized) {
      result.push({ port, a: 7, d: 0x01c });
      result = result.concat(makeSQRVoice(port, 0));
      result = result.concat(makeSQRVoice(port, 1));
      result = result.concat(makeSQRVoice(port, 2));
      result.push({ port, a: 0x28, d: 0x90 }); // KEY-ON FM 1
      result.push({ port, a: 0x28, d: 0x91 }); // KEY-ON FM 2
      result.push({ port, a: 0x28, d: 0x92 }); // KEY-ON FM 3
      this._initialized = true;
    }

    if (data.d & 0x80) {
      const ch = (data.d >> 5) & 3;
      const type = (data.d >> 4) & 1;
      this._ch = ch;
      this._type = type;
      if (type) {
        const v = data.d & 0xf;
        if (ch < 3) {
          const tl = v == 0xf ? 0x7f : Math.round(((data.d & 0xf) * 2) / 0.75 + 4);
          result.push({ port, a: 0x4c + ch, d: tl });
        } else {
          result.push({ port, a: 10, d: voltbl[v] });
        }
      } else {
        if (ch < 3) {
          const new_fdiv = (this._fdiv[ch] & 0x3f0) | (data.d & 0xf);
          const blk_fnum = fdiv2fnum(new_fdiv);
          result.push({ port, a: 0xa4 + ch, d: blk_fnum >> 8 });
          result.push({ port, a: 0xa0 + ch, d: blk_fnum & 0xff });
          this._fdiv[ch] = new_fdiv;
        } else {
          const n = data.d & 0x3;
          switch (n) {
            case 0:
            case 1:
            case 2:
              result.push({ port, a: 0x6, d: Math.min(31, 16 << n) });
              break;
            case 3:
              const fdiv = Math.min(31, Math.round((this._fdiv[2] + 1) << 2));
              result.push({ port, a: 0x6, d: fdiv });
              break;
          }
          this._fdiv[ch] = n;
        }
      }
    } else {
      const ch = this._ch;
      const type = this._type;
      if (type) {
        const v = data.d & 0xf;
        if (ch < 3) {
          const tl = v == 0xf ? 0x7f : Math.round(((data.d & 0xf) * 2) / 0.75 + 4);
          result.push({ port, a: 0x4c + ch, d: tl });
        } else {
          result.push({ port, a: 10, d: voltbl[v] });
        }
      } else {
        if (ch < 3) {
          const new_fdiv = ((data.d & 0x3f) << 4) | (this._fdiv[ch] & 0xf);
          const blk_fnum = fdiv2fnum(new_fdiv);
          result.push({ port, a: 0xa4 + ch, d: blk_fnum >> 8 });
          result.push({ port, a: 0xa0 + ch, d: blk_fnum & 0xff });
          this._fdiv[ch] = new_fdiv;
          if (ch === 2 && this._fdiv[3] == 3) {
            const freq = Math.min(31, Math.round((this._fdiv[2] + 1) << 2));
            result.push({ port, a: 0x6, d: freq });
          }
        }
      }
    }

    return result;
  }
}

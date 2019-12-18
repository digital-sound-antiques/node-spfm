import SPFM from "../spfm";

export async function YM2608RAMWrite(
  spfm: SPFM,
  slot: number,
  address: number,
  data: Uint8Array,
  cb: (progress: number, total: number) => boolean
) {
  let start = address;
  let stop = start + data.length - 1;
  let limit = Math.min(stop, 0x40000 - 1);

  start >>= 2;
  stop >>= 2;
  limit >>= 2;

  await spfm.writeRegs(slot, [
    { port: 1, a: 0x00, d: 0x01 }, //
    { port: 1, a: 0x10, d: 0x80 }, // Reset Flags
    { port: 1, a: 0x00, d: 0x60 }, // Memory Write
    { port: 1, a: 0x01, d: 0x00 }, // Memory Type
    { port: 1, a: 0x02, d: start & 0xff },
    { port: 1, a: 0x03, d: start >> 8 },
    { port: 1, a: 0x04, d: stop & 0xff },
    { port: 1, a: 0x05, d: stop >> 8 },
    { port: 1, a: 0x0c, d: limit & 0xff },
    { port: 1, a: 0x0d, d: limit >> 8 }
  ]);

  let buf = [];
  for (let i = 0; i < data.length; i++) {
    if (i % 256 === 0 || i === data.length - 1) {
      if (cb != null) {
        const abort = cb(i, data.length);
        if (abort) {
          console.log("ABORT");
          break;
        }
      }
      await spfm.writeRegs(slot, buf);
      buf = [];
    }
    buf.push({ port: 1, a: 0x08, d: data[i] });
  }
  buf.push({ port: 1, a: 0x00, d: 0x00 });
  buf.push({ port: 1, a: 0x10, d: 0x80 });
  await spfm.writeRegs(slot, buf);
}

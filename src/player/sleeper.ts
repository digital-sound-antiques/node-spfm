import microtime from "microtime";

function busySleep(n: number) {
  const till = microtime.now() + n;
  while (till > microtime.now());
}

export type SleepType = "busyloop" | "atomics";

export default class AccurateSleeper {
  _sarray = new Int32Array(new SharedArrayBuffer(4));
  _timeLastWaitFinished = 0;
  _waitRequested = 0;

  reset(): void {
    this._timeLastWaitFinished = 0;
    this._waitRequested = 0;
  }

  async sleep(waitInMicros: number, type: SleepType = "atomics", adjustCallInterval: boolean = true) {
    if (adjustCallInterval && this._timeLastWaitFinished) {
      this._waitRequested -= microtime.now() - this._timeLastWaitFinished;
    }
    this._waitRequested += waitInMicros;

    if (this._waitRequested > 0) {
      const start = microtime.now();
      if (type === "atomics") {
        Atomics.wait(this._sarray, 0, 0, Math.round(this._waitRequested / 1000));
      } else {
        busySleep(this._waitRequested);
      }
      const elapsed = microtime.now() - start;
      this._waitRequested -= elapsed;
    }
    this._timeLastWaitFinished = microtime.now();
  }
}

export async function processNodeEventLoop() {
  return new Promise<void>(resolve => {
    setImmediate(() => resolve());
  });
}

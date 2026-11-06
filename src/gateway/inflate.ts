import { constants, inflateSync } from "node:zlib";

const SUFFIX = Buffer.from([0x00, 0x00, 0xff, 0xff]);

export interface ZlibStreamInflater {
  push(chunk: Uint8Array): string | null;
  reset(): void;
}

export function createZlibStreamInflater(): ZlibStreamInflater {
  let history = Buffer.alloc(0);
  let emitted = 0;

  return {
    push(chunk: Uint8Array): string | null {
      history = Buffer.concat([history, Buffer.from(chunk)]);
      if (history.length < 4 || !history.subarray(-4).equals(SUFFIX)) return null;

      const full = inflateSync(history, { finishFlush: constants.Z_SYNC_FLUSH });
      const text = full.subarray(emitted).toString("utf8");
      emitted = full.length;
      return text;
    },
    reset(): void {
      history = Buffer.alloc(0);
      emitted = 0;
    },
  };
}

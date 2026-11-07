import { FRAME_BYTES } from "./constants";

export interface Framer {
  push(chunk: Uint8Array): Uint8Array[];
  pending(): number;
  clear(): void;
}

export function createFramer(frameBytes: number = FRAME_BYTES): Framer {
  let buffer = new Uint8Array(0);

  function append(chunk: Uint8Array): void {
    const next = new Uint8Array(buffer.length + chunk.length);
    next.set(buffer, 0);
    next.set(chunk, buffer.length);
    buffer = next;
  }

  return {
    push(chunk: Uint8Array): Uint8Array[] {
      append(chunk);
      const frames: Uint8Array[] = [];
      while (buffer.length >= frameBytes) {
        frames.push(buffer.slice(0, frameBytes));
        buffer = buffer.slice(frameBytes);
      }
      return frames;
    },
    pending(): number {
      return buffer.length;
    },
    clear(): void {
      buffer = new Uint8Array(0);
    },
  };
}

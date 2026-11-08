export interface JitterBuffer {
  push(pcm: Uint8Array): void;
  pop(): Uint8Array | null;
  readonly size: number;
  reset(): void;
}

/**
 * Buffer FIFO de frames PCM. Junta `prebufferFrames` antes de entregar; si se vacía
 * vuelve a prebufferear (nunca repite el último frame). Lleno → tira el más viejo.
 */
export function createJitterBuffer(opts?: {
  prebufferFrames?: number;
  maxFrames?: number;
  /** Frames para volver a entregar después de vaciarse a mitad de una frase (menos que el prebuffer inicial). */
  rebufferFrames?: number;
}): JitterBuffer {
  const prebufferFrames = opts?.prebufferFrames ?? 3;
  const rebufferFrames = opts?.rebufferFrames ?? prebufferFrames;
  let threshold = prebufferFrames;
  const maxFrames = opts?.maxFrames ?? 10;
  let frames: Uint8Array[] = [];
  let primed = false;

  return {
    push(pcm: Uint8Array): void {
      frames.push(pcm);
      while (frames.length > maxFrames) frames.shift();
      if (frames.length >= threshold) primed = true;
    },
    pop(): Uint8Array | null {
      if (!primed) return null;
      const frame = frames.shift();
      if (frames.length === 0) {
        primed = false;
        threshold = rebufferFrames;
      }
      return frame ?? null;
    },
    get size(): number {
      return frames.length;
    },
    reset(): void {
      frames = [];
      primed = false;
      threshold = prebufferFrames;
    },
  };
}

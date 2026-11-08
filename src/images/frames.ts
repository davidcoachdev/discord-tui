import { imageCache } from "./cache";
import { decodeAnimated, type Animation } from "./gif";

/** Pixeles que se piden por celda al achicar (los mismos que `sizedUrl`). */
export const CELL_PX = { width: 10, height: 20 };

export interface FrameCache {
  /** Cuadros de `url` para una caja de `cols × rows` celdas; null si no es un GIF animado o falló. */
  get(url: string, cols: number, rows: number): Promise<Animation | null>;
  readonly bytes: number;
}

/**
 * LRU de GIFs ya decodificados, por URL y tamaño, con tope de bytes RGBA. Los "no animado" también
 * se recuerdan (sin costo) para no volver a decodificar.
 */
export function createFrameCache(deps: {
  load(url: string): Promise<Uint8Array | null>;
  decode(bytes: Uint8Array, maxWidth: number, maxHeight: number): Promise<Animation | null>;
  maxBytes?: number;
}): FrameCache {
  const maxBytes = deps.maxBytes ?? 64 * 1024 * 1024;
  const entries = new Map<string, Animation | null>();
  const pending = new Map<string, Promise<Animation | null>>();
  let total = 0;

  function remember(key: string, value: Animation | null): void {
    if (value && value.bytes > maxBytes) value = null;
    entries.set(key, value);
    total += value?.bytes ?? 0;
    for (const [k, v] of entries) {
      if (total <= maxBytes) break;
      if (k === key) continue;
      entries.delete(k);
      total -= v?.bytes ?? 0;
    }
  }

  return {
    get bytes() {
      return total;
    },
    async get(url, cols, rows) {
      const key = `${cols}x${rows} ${url}`;
      if (entries.has(key)) {
        const hit = entries.get(key)!;
        entries.delete(key);
        entries.set(key, hit);
        return hit;
      }
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const job = (async (): Promise<Animation | null> => {
        try {
          const bytes = await deps.load(url);
          if (!bytes) return null; // falla de red: no se recuerda, se reintenta la próxima vez
          remember(key, await deps.decode(bytes, cols * CELL_PX.width, rows * CELL_PX.height));
          return entries.get(key) ?? null;
        } catch {
          return null;
        } finally {
          pending.delete(key);
        }
      })();
      pending.set(key, job);
      return job;
    },
  };
}

export const frameCache = createFrameCache({ load: (url) => imageCache.get(url), decode: (bytes, w, h) => decodeAnimated(bytes, w, h) });

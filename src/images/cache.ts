import { isAllowedImageHost } from "./cdn";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface ImageCache {
  get(url: string): Promise<Uint8Array | null>;
  /** Bytes que ocupa hoy (para el log de memoria). */
  readonly bytes?: number;
}

/** LRU de imágenes del CDN. Nunca manda Authorization ni headers de cliente: es un GET pelado. */
export function createImageCache(deps: { fetch: typeof fetch; maxBytes?: number }): ImageCache {
  // Bytes descargados (comprimidos): lo que sale se vuelve a bajar si hace falta.
  const maxBytes = deps.maxBytes ?? 16 * 1024 * 1024;
  const entries = new Map<string, Uint8Array>();
  const pending = new Map<string, Promise<Uint8Array | null>>();
  let total = 0;

  function remember(url: string, bytes: Uint8Array): void {
    entries.set(url, bytes);
    total += bytes.byteLength;
    for (const [key, value] of entries) {
      if (total <= maxBytes) break;
      entries.delete(key);
      total -= value.byteLength;
    }
  }

  return {
    get bytes() {
      return total;
    },
    async get(url: string): Promise<Uint8Array | null> {
      if (!isAllowedImageHost(url)) return null;
      const hit = entries.get(url);
      if (hit) {
        entries.delete(url);
        entries.set(url, hit);
        return hit;
      }
      const inFlight = pending.get(url);
      if (inFlight) return inFlight;
      const job = (async (): Promise<Uint8Array | null> => {
        try {
          const response = await deps.fetch(url, { method: "GET" });
          if (!response.ok) return null;
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
          remember(url, bytes);
          return bytes;
        } catch {
          return null;
        } finally {
          pending.delete(url);
        }
      })();
      pending.set(url, job);
      return job;
    },
  };
}

// `globalThis.fetch` se lee en cada pedido (no al importar) para que los tests lo reemplacen y nunca salgan a la red.
export const imageCache = createImageCache({ fetch: ((input, init) => globalThis.fetch(input, init)) as typeof fetch });

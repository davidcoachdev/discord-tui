// Helpers de PCM s16le 48 kHz estéreo. Todos devuelven frames de 3840 bytes.

export const FRAME_SAMPLES = 960;
export const CHANNELS = 2;
export const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;
export const SAMPLE_RATE = 48_000;

function frameFrom(fn: (index: number) => number): Uint8Array {
  const out = new Uint8Array(FRAME_BYTES);
  const view = new DataView(out.buffer);
  for (let i = 0; i < FRAME_SAMPLES * CHANNELS; i += 1) {
    view.setInt16(i * 2, fn(i), true);
  }
  return out;
}

/** Frame de silencio absoluto (todas las muestras en 0). */
export function silence(): Uint8Array {
  return new Uint8Array(FRAME_BYTES);
}

/** Frame con todas las muestras en `sample`. */
export function pcmOf(sample: number): Uint8Array {
  return frameFrom(() => sample);
}

/** Onda cuadrada de amplitud `amp` (positivo / negativo alternado). */
export function square(amp: number): Uint8Array {
  return frameFrom((i) => (i % 2 === 0 ? amp : -amp));
}

/** Seno de amplitud `ampFraction` (de 32767) a `hz`, por defecto 440. */
export function sine(ampFraction: number, hz = 440): Uint8Array {
  return frameFrom((i) => Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * 32767 * ampFraction));
}

/** Seno de 440 Hz a media escala. */
export function sine440(): Uint8Array {
  return sine(0.5);
}

/** Frame fuerte: -10 dBFS. */
export function loud(): Uint8Array {
  return sine(10 ** (-10 / 20));
}

/** Frame a `db` dBFS. */
export function quiet(db: number): Uint8Array {
  return sine(10 ** (db / 20));
}

export function sampleAt(pcm: Uint8Array, i: number): number {
  return new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength).getInt16(i * 2, true);
}

/** Correlación normalizada entre dos frames del mismo tamaño (1 = idénticos). */
export function correlation(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length) / 2;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const x = sampleAt(a, i);
    const y = sampleAt(b, i);
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

/**
 * Correlación máxima entre `a` y `b` probando desplazamientos de hasta `maxLag` muestras.
 * Opus mete delay algorítmico, así que comparar alineado a fase da valores engañosos.
 */
export function bestCorrelation(a: Uint8Array, b: Uint8Array, maxLag = 1200): number {
  let best = -1;
  for (let lag = 0; lag < maxLag; lag += 1) {
    const length = Math.min(a.length / 2 - lag, b.length / 2);
    if (length < 100) break;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < length; i += 1) {
      const x = sampleAt(a, i + lag);
      const y = sampleAt(b, i);
      dot += x * y;
      normA += x * x;
      normB += y * y;
    }
    if (normA === 0 || normB === 0) continue;
    const value = dot / Math.sqrt(normA * normB);
    if (value > best) best = value;
  }
  return best;
}

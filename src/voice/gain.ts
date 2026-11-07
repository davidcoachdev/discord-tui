/** Aplica ganancia porcentual a un frame s16le, saturado a [-32768, 32767]. */
export function applyGain(pcm: Uint8Array, percent: number): Uint8Array {
  if (percent === 100) return pcm;
  const out = new Uint8Array(pcm.byteLength);
  const input = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const output = new DataView(out.buffer);
  const factor = percent / 100;
  const count = pcm.byteLength / 2;
  for (let i = 0; i < count; i += 1) {
    const sample = input.getInt16(i * 2, true) * factor;
    const clamped = Math.max(-32768, Math.min(32767, Math.round(sample)));
    output.setInt16(i * 2, clamped, true);
  }
  return out;
}

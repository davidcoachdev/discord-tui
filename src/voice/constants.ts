export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const FRAME_SAMPLES = 960;
export const FRAME_MS = 20;
export const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;
export const SILENCE_FRAME = Uint8Array.of(0xf8, 0xff, 0xfe);

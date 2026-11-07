import { FRAME_SAMPLES } from "./constants";

export interface OpusCodec {
  encode(pcm: Uint8Array): Uint8Array;
  decode(opus: Uint8Array): Uint8Array;
  backend: "native" | "wasm";
}

interface NativeOpus {
  encode(buffer: Buffer, frameSize: number): Buffer;
  decode(buffer: Buffer, frameSize: number): Buffer;
}

interface WasmOpus {
  encode(buffer: Buffer, frameSize: number): Buffer;
  decode(buffer: Buffer): Buffer;
}

function loadNative(): NativeOpus | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@discordjs/opus");
    const Ctor = mod.Opus ?? mod.default?.Opus ?? mod;
    const instance = new Ctor(48_000, 2) as NativeOpus;
    // Forzar la carga del binario nativo acá; si falta el prebuild tira al construir o al usar.
    instance.encode(Buffer.alloc(3840), FRAME_SAMPLES);
    return new Ctor(48_000, 2) as NativeOpus;
  } catch {
    return null;
  }
}

function loadWasm(): WasmOpus | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("opusscript");
    const Ctor = mod.default ?? mod;
    const Application = Ctor.Application ?? { AUDIO: 2049 };
    return new Ctor(48_000, 2, Application.AUDIO) as WasmOpus;
  } catch {
    return null;
  }
}

export function createOpusCodec(opts?: { prefer?: "native" | "wasm" }): OpusCodec {
  const prefer = opts?.prefer ?? "native";
  const order = prefer === "wasm" ? [loadWasm, loadNative] : [loadNative, loadWasm];

  let backend: "native" | "wasm" | null = null;
  let engine: NativeOpus | WasmOpus | null = null;

  for (const load of order) {
    const loaded = load();
    if (loaded) {
      engine = loaded;
      backend = load === loadNative ? "native" : "wasm";
      break;
    }
  }

  if (!engine || !backend) throw new Error("no pude cargar Opus (ni @discordjs/opus ni opusscript)");

  const opus = engine;
  const which = backend;

  return {
    backend: which,
    encode(pcm: Uint8Array): Uint8Array {
      const out = opus.encode(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), FRAME_SAMPLES);
      return new Uint8Array(out);
    },
    decode(opusPacket: Uint8Array): Uint8Array {
      const input = Buffer.from(opusPacket.buffer, opusPacket.byteOffset, opusPacket.byteLength);
      const out = which === "native" ? (opus as NativeOpus).decode(input, FRAME_SAMPLES) : (opus as WasmOpus).decode(input);
      return new Uint8Array(out);
    },
  };
}

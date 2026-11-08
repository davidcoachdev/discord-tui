import type { VoiceActions } from "../../src/actions/voice";
import type { Store } from "../../src/store/store";
import { selectWatchableStreamers } from "../../src/store/selectors";
import type { DecodedFrame } from "../../src/watch/decode";

/** Barras de colores que se corren (video sintético de la demo, sin red ni decodificador). */
export function syntheticFrame(width: number, height: number, t: number, out?: Uint8Array): DecodedFrame {
  const rgba = out && out.length === width * height * 4 ? out : new Uint8Array(width * height * 4);
  const bars = [
    [235, 235, 235],
    [235, 235, 16],
    [16, 235, 235],
    [16, 235, 16],
    [235, 16, 235],
    [235, 16, 16],
    [16, 16, 235],
  ];
  const shift = Math.floor(t * 4) % width;
  for (let x = 0; x < width; x++) {
    const c = bars[Math.floor((((x + shift) % width) / width) * bars.length)]!;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const shade = y > height * 0.8 ? 0.4 : 1;
      rgba[i] = c[0]! * shade;
      rgba[i + 1] = c[1]! * shade;
      rgba[i + 2] = c[2]! * shade;
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** Ver transmisiones simulado: `⏳ conectando…` un rato y después barras de colores a 12 fps. No usa la red. */
export function demoWatchActions(store: Store): Pick<VoiceActions, "watchStream" | "toggleWatch" | "stopWatching" | "watchFrames"> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const notice = (text: string) => store.dispatch({ type: "notice/push", key: "watch", level: "info", text });
  const actions = {
    async watchStream(userId: string) {
      const state = store.getState();
      if (state.voice.status !== "connected") return notice("entrá al canal de voz de quien transmite para verlo");
      if (!selectWatchableStreamers(state).includes(userId)) return notice("esa persona no está transmitiendo");
      store.dispatch({ type: "voice/watch", patch: { status: "connecting", userId, error: null } });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (store.getState().voice.watch.status === "connecting") store.dispatch({ type: "voice/watch", patch: { status: "watching" } });
      }, 500);
    },
    async toggleWatch(userId: string) {
      const w = store.getState().voice.watch;
      return w.status !== "idle" && w.userId === userId ? actions.stopWatching() : actions.watchStream(userId);
    },
    async stopWatching() {
      if (timer) clearTimeout(timer);
      timer = null;
      store.dispatch({ type: "voice/watch", patch: { status: "idle", userId: null, error: null } });
    },
    watchFrames(width: number, height: number, onFrame: (f: DecodedFrame) => void) {
      let box = { width: Math.min(480, width), height: Math.min(270, height) };
      const t0 = Date.now();
      let buf: Uint8Array | undefined;
      const tick = setInterval(() => {
        if (store.getState().voice.watch.status !== "watching") return;
        const f = syntheticFrame(box.width, box.height, (Date.now() - t0) / 1000 * 60, buf);
        buf = f.rgba;
        onFrame(f);
      }, 1000 / 12);
      return {
        resize(w: number, h: number) {
          box = { width: Math.min(480, w), height: Math.min(270, h) };
        },
        unsubscribe() {
          clearInterval(tick);
        },
      };
    },
  };
  return actions;
}

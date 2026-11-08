// 🧍 SOLO LO CORRE GON (spike Go Live, 2026-11-08). Usa la cuenta real: entra a un canal
// de voz con NUESTRA voz (@discordjs/voice + DAVE), transmite UN monitor 60 s con Go Live
// por @dank074/discord-video-stream (vía streamer-shim.ts, sin selfbot Client) y sale.
//
// Uso: bun scripts/spike-golive/golive-spike.ts <guild_id> <channel_id> [monitor]
//   monitor: nombre de `hyprctl monitors` (ej. DP-1). Por defecto el primero.
// Captura: wf-recorder si está instalado (wlr-screencopy, sin portal); si no, grim en loop
// (~10 fps). Se codifica con ffmpeg a H264 720p30 sin B-frames y se manda por pipe NUT;
// nada se guarda en disco. No imprime payloads, tokens ni session_id: solo estados.
import { spawn } from "node:child_process";

import { playStream } from "@dank074/discord-video-stream";

import { loadSession } from "../../src/auth/session";
import { fetchBuildNumber } from "../../src/client-props/build-number";
import { createClientProps } from "../../src/client-props/props";
import { createGateway } from "../../src/gateway/connection";
import { createVoiceAdapterCreator } from "../../src/voice/adapter";
import { createDjsVoiceSession } from "../../src/voice/session";
import { createGoLiveStreamer } from "./streamer-shim";

const [guildId, channelId, monitorArg] = process.argv.slice(2);
if (!guildId || !channelId || !/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(channelId)) {
  console.log("uso: bun scripts/spike-golive/golive-spike.ts <guild_id> <channel_id> [monitor]");
  process.exit(2);
}
const monitor = monitorArg ?? "";
if (monitor && !/^[A-Za-z0-9-]+$/.test(monitor)) {
  console.log("monitor inválido");
  process.exit(2);
}

const session = await loadSession();
if (!session) {
  console.log("GOLIVE FAIL no hay sesión: corré bun run dev y logueate primero");
  process.exit(1);
}

const { value: buildNumber } = await fetchBuildNumber({ fetch });
const gateway = createGateway({ token: session.token, props: createClientProps({ buildNumber }) });
gateway.on("status", (status) => console.log(`gateway: ${status}`));
gateway.connect();
await new Promise<void>((resolve) => gateway.on("session", () => resolve()));

// session_id de NUESTRA voz: el del VOICE_STATE_UPDATE propio (no se imprime).
let voiceSessionId: string | null = null;
gateway.on("dispatch", (t, d) => {
  if (t === "VOICE_STATE_UPDATE" && d?.user_id === session.userId && d?.guild_id === guildId) voiceSessionId = d.session_id ?? null;
  if (t === "STREAM_CREATE" || t === "STREAM_SERVER_UPDATE" || t === "STREAM_DELETE") console.log(`gateway: ${t}`);
});

const voice = createDjsVoiceSession({
  adapterCreator: createVoiceAdapterCreator({ gateway, meId: () => session.userId }),
  meId: () => session.userId,
});
voice.onStatus((status, error) => console.log(`voz: ${status}${error ? ` (${error})` : ""}`));
await voice.join(guildId, channelId, { selfMute: true, selfDeaf: false });
if (!voiceSessionId) {
  console.log("GOLIVE FAIL no llegó el session_id de voz");
  process.exit(1);
}

const golive = createGoLiveStreamer({ gateway, meId: session.userId });
golive.attachVoice(guildId, channelId, voiceSessionId);

// Captura → ffmpeg → NUT por stdout. Nada a disco.
const hasWf = Bun.spawnSync(["sh", "-c", "command -v wf-recorder"]).exitCode === 0;
const capture = hasWf
  ? `wf-recorder -y ${monitor ? `-o ${monitor}` : ""} -c rawvideo -m nut -x yuv420p -r 30 -f /dev/stdout 2>/dev/null`
  : `while :; do grim -t ppm ${monitor ? `-o ${monitor}` : ""} - 2>/dev/null || exit; done`;
const inputArgs = hasWf ? "-f nut -i -" : "-f image2pipe -c:v ppm -framerate 10 -i -";
const pipeline = `${capture} | ffmpeg -hide_banner -nostdin -loglevel error ${inputArgs} -vf scale=-2:720,fps=30 -c:v libx264 -preset ultrafast -tune zerolatency -bf 0 -g 60 -forced-idr 1 -pix_fmt yuv420p -b:v 2500k -maxrate 3500k -bufsize 1500k -an -f nut -`;
console.log(`captura: ${hasWf ? "wf-recorder" : "grim (fallback ~10 fps)"} · monitor: ${monitor || "por defecto"}`);
// env limpio (spec 8): solo lo que necesita la captura de Wayland.
const env = { PATH: process.env.PATH ?? "/usr/bin", WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? "", XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "" };
const proc = spawn("sh", ["-c", pipeline], { stdio: ["ignore", "pipe", "inherit"], env });

const abort = new AbortController();
const done = playStream(proc.stdout, golive.streamer, { type: "go-live", format: "nut" }, abort.signal)
  .then(() => "terminó")
  .catch((e: unknown) => (abort.signal.aborted ? "cortado" : `error: ${e instanceof Error ? e.message : "?"}`));

console.log("transmitiendo 60 s. Pedile a tu amigo que haga click en LIVE en el canal.");
for (let s = 10; s <= 60; s += 10) {
  await Bun.sleep(10_000);
  console.log(`  ${s} s`);
}
abort.abort();
proc.kill("SIGTERM");
console.log(`stream: ${await done}`);
golive.detachVoice();
golive.destroy();
await voice.leave();
gateway.close();
console.log("GOLIVE FIN — contale a Claude qué vio tu amigo (imagen, fps, código de privacidad del stream)");
process.exit(0);

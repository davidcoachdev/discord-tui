// 🧍 Lo corre Gon (E4b Task 1, Step 6): entra a un canal de voz real con DAVE, se queda 60 s y sale.
// Uso: bun run voice-spike <guild_id> <channel_id>
// Nunca imprime payloads ni el token: solo estados, códigos de cierre y si hay código de privacidad.
import { loadSession } from "../src/auth/session";
import { fetchBuildNumber } from "../src/client-props/build-number";
import { createClientProps } from "../src/client-props/props";
import { createGateway } from "../src/gateway/connection";
import { createVoiceAdapterCreator } from "../src/voice/adapter";
import { createDjsVoiceSession } from "../src/voice/session";

const [guildId, channelId] = process.argv.slice(2);
if (!guildId || !channelId || !/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(channelId)) {
  console.log("uso: bun run voice-spike <guild_id> <channel_id>");
  process.exit(2);
}

const session = await loadSession();
if (!session) {
  console.log("SPIKE FAIL no hay sesión: corré bun run dev y logueate primero");
  process.exit(1);
}

const { value: buildNumber } = await fetchBuildNumber({ fetch });
const gateway = createGateway({ token: session.token, props: createClientProps({ buildNumber }) });
gateway.on("status", (status) => console.log(`gateway: ${status}`));
gateway.connect();

await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("el gateway no llegó a READY en 20 s")), 20_000);
  gateway.on("session", () => {
    clearTimeout(timer);
    resolve();
  });
}).catch((error: Error) => {
  console.log(`SPIKE FAIL ${error.message}`);
  process.exit(1);
});

const voice = createDjsVoiceSession({
  adapterCreator: createVoiceAdapterCreator({ gateway, meId: () => session.userId }),
  meId: () => session.userId,
});

let failure: string | null = null;
const started = Date.now();
voice.onStatus((status, error) => {
  console.log(`voz: ${status}${error ? ` (${error})` : ""} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (status === "error") failure = error ?? "error";
});

console.log("entrando muteado (selfMute) con DAVE…");
await voice.join(guildId, channelId, { selfMute: true, selfDeaf: false });
const readyAfter = (Date.now() - started) / 1000;

if (failure === null) {
  console.log(`conectado en ${readyAfter.toFixed(1)} s; me quedo 60 s. Mirá el canal desde el teléfono (sin entrar).`);
  for (let second = 10; second <= 60 && failure === null; second += 10) {
    await Bun.sleep(10_000);
    console.log(`  ${second} s · código de privacidad DAVE: ${voice.privacyCode() ? "sí" : "todavía no"}`);
  }
}

await voice.leave();
gateway.close();
if (failure !== null) console.log(`SPIKE FAIL ${failure}`);
else if (readyAfter > 15) console.log(`SPIKE FAIL tardó ${readyAfter.toFixed(1)} s en conectar (límite 15 s)`);
else console.log("SPIKE OK");
process.exit(failure === null ? 0 : 1);

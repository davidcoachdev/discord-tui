# discord-tui E4b (voz real, Gon solo): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** tarea por tarea, en orden. TDD: test que falla → mínimo código → verde. Antes de tildar un `- [ ]` corrés la verificación y pegás la salida. Al cerrar cada tarea: commit **y** `git push origin main`. Los **🧍 Paso de Gon** los hace Gon; frenás y esperás. Nunca leés el token ni `session.json`, y nunca corrés los scripts que se conectan a Discord. **Task 1 decide la rama:** si el spike pasa, seguís con Tasks 2–6 (plan A); si falla, hacés Task 2 sin `createDjsVoiceSession` (la interfaz y el store sí), después la "Rama B" del final, y después Tasks 3–6 sobre `createOwnVoiceSession`. No hagas las dos.

**Goal:** entrar a un canal de voz real del servidor de prueba con DAVE activo, transmitir con VAD o Push-to-Talk, mute y deafen que se reflejan en el teléfono, y salir liberando el canal.

**Architecture:** plan A de la spec 7.2: `@discordjs/voice` con un adapter atado a nuestro gateway (`voice/adapter.ts`). `voice/session.ts` es la única puerta: la UI y `actions` hablan con una interfaz `VoiceSession` que no sabe si abajo está `@discordjs/voice` (A) o `voice/own/` (B). El audio que sale lo arma `voice/tx.ts` (captura → VAD/PTT → Opus) en ráfagas: cada vez que la compuerta abre se crea un `AudioResource` nuevo de Opus crudo y al cerrar se termina.

**Tech Stack:** lo de E4a; de `@discordjs/voice` 0.19.2: `joinVoiceChannel`, `createAudioPlayer`, `createAudioResource`, `StreamType.Opus`, `VoiceConnectionStatus`, `DiscordGatewayAdapterCreator`.

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (6.6, 7.2, 7.5, 7.6, 9/E4b, 10.4).

## Global Constraints

- Las de E0–E4a.
- Entrar: op 4 `{ guild_id, channel_id, self_mute, self_deaf }` por nuestro gateway, con la **forma** de `fixtures/browser/op4-join.json`; esperar `VOICE_STATE_UPDATE` (propio) y `VOICE_SERVER_UPDATE`; cambiar de canal en el mismo guild = sesión de voz nueva (spec 6.6).
- `joinVoiceChannel` siempre con `selfDeaf` y `selfMute` explícitos (el default de la librería es `selfDeaf: true`) y `daveEncryption: true`.
- Modo de entrada **[Gon]**: `voice_activity` (default) o `push_to_talk`; mute y deafen son toggles aparte que viajan como `self_mute`/`self_deaf` en el op 4 (spec 7.6). **[nuestra]** Deafen también silencia, como el cliente oficial; al sacar el deafen vuelve el mute que había antes.
- PTT: Kitty keyboard protocol con eventos (ya activado en `main.tsx` desde E0); se ignoran los `repeat`; sin `release` → modo interruptor con aviso (spec 7.6).
- Al dejar de hablar: 5 frames de silencio y Speaking 0 (spec 6.6). Con el plan A lo hace `AudioPlayer` (`silencePaddingFrames: 5` del `AudioResource`); no se mandan silencios a mano encima.
- Los mensajes de `debug` de `@discordjs/voice` pueden incluir el token de voz: **no** se loguean crudos, solo lo que deja pasar `sanitizeVoiceDebug`.
- Teclas (spec 7.5): `v` entrar/salir del canal de voz seleccionado, `m` mute, `D` deafen, `Espacio` sostenido PTT (solo en modo PTT y en modo normal), `M` cambia el modo de entrada.

## Review Focus

- Una línea de debug de `@discordjs/voice` con `"token":"…"` o `"session_id"`: no llega al archivo de log (Task 1).
- Gon aprieta `v` sobre otro canal de voz del mismo guild estando conectado: se sale del primero y entra al segundo con una sesión nueva, sin quedar en los dos (Task 2).
- El servidor cierra con 4014 (lo movieron o lo echaron) o 4017: la barra muestra el motivo en español y el estado vuelve a `idle`, sin reintentar en loop (Task 2).
- Espacio sostenido en modo `voice_activity` o con el composer en insert: no transmite ni cambia nada (Task 4).
- `q` con la voz conectada: sale del canal (op 4 con `channel_id: null`) antes de cerrar la app (Task 2).

---

### Task 1: Adapter y spike contra Discord real [sin verificar en spec 6.6 y 10.4]

**Files:**
- Create: `src/voice/adapter.ts`, `src/voice/debug.ts`, `scripts/voice-spike.ts`
- Test: `tests/voice/adapter.test.ts`, `tests/voice/debug.test.ts`

**Interfaces:**
- Consumes: `Gateway` (E2), `log`.
- Produces:
  - `createVoiceAdapterCreator(deps: { gateway: Gateway; meId: string }): (guildId: string) => DiscordGatewayAdapterCreator`. `sendPayload(p)` reenvía por `gateway.send(4, toOfficialOp4(p.d))` y devuelve `true` si el gateway está `ready`; `onVoiceStateUpdate` recibe solo los `VOICE_STATE_UPDATE` con `user_id === meId` de ese guild; `onVoiceServerUpdate` los de ese guild; `destroy()` se desuscribe.
  - `toOfficialOp4(d: { guild_id: string; channel_id: string | null; self_mute: boolean; self_deaf: boolean }): Record<string, unknown>`: agrega los campos extra que tenga la captura (p. ej. `self_video: false`, `flags`) con sus valores por defecto.
  - `sanitizeVoiceDebug(line: string): string | null`: deja pasar solo cambios de estado, `op <n>` y `close code <n>`; todo lo que tenga `{` o la palabra `token` devuelve `null`.
  - `scripts/voice-spike.ts <guild_id> <channel_id>` (lo corre Gon): usa la sesión, levanta el runtime de E2, hace `joinVoiceChannel` con `selfMute: true, selfDeaf: false, daveEncryption: true`, imprime cada `stateChange` (`signalling → connecting → ready`) y cada código de cierre, se queda 60 s y sale con `destroy()`. Imprime al final `SPIKE OK` o `SPIKE FAIL <motivo>`.

- [x] **Step 1: Tests**

```ts
test("joinVoiceChannel through the adapter sends op 4 with the captured shape", () => {
  expect(shapeOf(fakeGateway.sent.at(-1))).toEqual(shapeOf(capturedOp4));
  expect(fakeGateway.sent.at(-1).d).toMatchObject({ self_mute: false, self_deaf: false });
});
test("only own VOICE_STATE_UPDATE of that guild reaches the library", () => {});
test("sanitizeVoiceDebug drops payloads and tokens", () => {
  expect(sanitizeVoiceDebug('[WS] >> {"op":0,"d":{"token":"abc"}}')).toBeNull();
  expect(sanitizeVoiceDebug("state change: from signalling to connecting")).not.toBeNull();
});
```

- [x] **Step 2–4:** FAIL → implementar → `bun test tests/voice` PASS.
- [x] **Step 5:** commit `feat(e4b): gateway adapter for @discordjs/voice and voice spike` + push.
- [ ] **Step 6: 🧍 Paso de Gon — spike.** Con la sesión activa y nadie más usando su cuenta en voz (el teléfono **no** en voz, spec 8.2):
  `bun scripts/voice-spike.ts <id del servidor de prueba> <id del canal Voz>`
  En el teléfono, mirando el canal `Voz` sin entrar, tiene que verse a sí mismo dentro del canal (con el ícono de muteado) durante un minuto. Le pasa al agente la salida del script (no tiene datos sensibles) y si se vio en el teléfono.
- [ ] **Step 7: Criterio.** **Pass (plan A):** llega a `ready` en menos de 15 s, sin cierre 4017, se mantiene 60 s y Gon se vio en el canal. **Fail:** 4017 persistente (dos corridas), el adapter no anda en Bun o nunca llega a `ready` → **Rama B** (spec 7.2 y 9/E4). Anotar el resultado en `docs/protocol-notes.md`, sección "Voz real".

---

### Task 2: `VoiceSession`, estado de voz en el store y acciones

**Files:**
- Create: `src/voice/session.ts`, `src/store/reducers/voice.ts`, `src/actions/voice.ts`, `src/voice/close-codes.ts`
- Modify: `src/store/types.ts`, `src/store/reduce.ts`, `src/actions/index.ts`, `src/app/runtime.ts` (`stop()` sale de voz antes de cerrar)
- Test: `tests/voice/session.test.ts`, `tests/store/voice.test.ts`, `tests/actions/voice.test.ts`

**Interfaces:**
- Consumes: `createVoiceAdapterCreator` (Task 1).
- Produces:
  - `interface VoiceSession { join(guildId: string, channelId: string, flags: { selfMute: boolean; selfDeaf: boolean }): Promise<void>; setFlags(flags): void; leave(): Promise<void>; onStatus(fn: (s: VoiceStatus, err?: string) => void): () => void; playSpurt(frames: AsyncIterable<Uint8Array>): void; privacyCode(): string | null }`; `type VoiceStatus = "idle" | "joining" | "connected" | "reconnecting" | "error"`. `createDjsVoiceSession(deps: { adapterCreator; meId: string }): VoiceSession` (plan A).
  - Slice `voice: { guildId: string | null; channelId: string | null; status: VoiceStatus; error: string | null; selfMute: boolean; selfDeaf: boolean; muteBeforeDeaf: boolean; inputMode: "voice_activity" | "push_to_talk"; selfSpeaking: boolean; speaking: Record<string, true>; states: Record<string /*guildId*/, Record<string /*userId*/, { channelId: string; mute: boolean; deaf: boolean; selfMute: boolean; selfDeaf: boolean }>>; privacyCode: string | null; pttWarning: string | null }`. Carga `voice_states` de los guilds de READY y aplica `VOICE_STATE_UPDATE`.
  - `closeCodeMessage(code: number): string`: 4014 `te desconectaron del canal`, 4017 `Discord exige cifrado E2EE (DAVE) y no se pudo negociar`, 4006 `la sesión de voz ya no es válida`, otro `se cortó la voz (código <n>)`.
  - Acciones: `actions.toggleVoice(channelId: string)`, `actions.toggleMute()`, `actions.toggleDeaf()`, `actions.setInputMode(m)`.

- [x] **Step 1: Tests** (con un `VoiceSession` falso para las acciones y un `@discordjs/voice` real sobre el gateway falso para `session.ts` hasta `signalling`)

```ts
test("toggleVoice joins, and again leaves", async () => {});
test("toggleVoice on another channel of the same guild leaves first, then joins", async () => { expect(calls).toEqual(["leave", "join:B"]); });
test("deafen also mutes; undeafen restores the previous mute", () => {});
test("mute/deaf changes call setFlags (op 4 with new self_mute/self_deaf)", () => {});
test("close 4014 sets status idle with the spanish message and does not rejoin", () => {});
test("runtime.stop leaves voice before closing the gateway", async () => {});
test("READY voice_states and VOICE_STATE_UPDATE fill who is in each channel", () => {});
```

- [x] **Step 2–4:** FAIL → implementar → PASS.
- [x] **Step 5:** commit `feat(e4b): voice session, store slice and actions` + push.

---

### Task 3: Transmisión por ráfagas con VAD

**Files:**
- Create: `src/voice/tx.ts`
- Modify: `src/voice/session.ts` (`playSpurt` con `createAudioResource(Readable.from(frames), { inputType: StreamType.Opus, silencePaddingFrames: 5 })` y un `AudioPlayer` suscripto a la conexión)
- Test: `tests/voice/tx.test.ts`

**Interfaces:**
- Consumes: `startCapture`, `createOpusCodec`, `createVad` (E4a), `VoiceSession.playSpurt`.
- Produces: `createTransmitter(deps: { capture: AudioCapture; codec; vad; session: Pick<VoiceSession, "playSpurt">; getGate: () => "vad" | "ptt"; isMuted: () => boolean; onSelfSpeaking(on: boolean): void }): { setPtt(on: boolean): void; stop(): void }`. La compuerta abre con el VAD (modo `vad`) o con `setPtt(true)` (modo `ptt`); muteado nunca abre. Al abrir: `playSpurt` con un iterable que entrega los frames Opus mientras siga abierta y termina al cerrar.

- [x] **Step 1: Tests**

```ts
test("vad mode: one spurt per open/close, with only the frames while open", async () => {});
test("ptt mode ignores the vad and follows setPtt", async () => {});
test("muted never opens and onSelfSpeaking stays false", async () => {});
test("we do not push F8 FF FE frames ourselves (the player pads 5)", async () => {});
test("onSelfSpeaking toggles with each spurt", async () => {});
```

- [x] **Step 2–4:** FAIL → implementar → PASS.
- [x] **Step 5:** commit `feat(e4b): voice transmitter with vad and ptt gate` + push.

---

### Task 4: Push-to-Talk y teclas de voz

**Files:**
- Create: `src/voice/ptt.ts`
- Modify: `src/ui/keymap.ts` (`voice.toggle` `v`, `voice.mute` `m`, `voice.deaf` `D`, `voice.inputMode` `M`), `src/ui/App.tsx` (escucha `keypress`/`keyrelease` de `renderer.keyInput` para `space`, mirando `eventType` y `repeated` del `KeyEvent`)
- Test: `tests/voice/ptt.test.ts`, `tests/ui/voice-keys.test.tsx`

**Interfaces:**
- Produces: `createPtt(opts: { kittyKeyboard: boolean }): { onKey(e: { name: string; eventType: "press" | "repeat" | "release"; repeated?: boolean }): void; transmitting: boolean; mode: "hold" | "toggle"; warning: string | null; onChange(fn: () => void): () => void }`. `kittyKeyboard` sale de `renderer.capabilities?.kitty_keyboard`. Sin protocolo → arranca en `toggle` con `warning = "tu terminal no avisa cuando soltás la tecla: el PTT funciona como interruptor"`. En `hold`, si llega un `press` no repetido estando `transmitting` sin un `release` antes, pasa a `toggle` con el mismo aviso.

- [x] **Step 1: Tests**

```ts
test("hold: press starts, repeats are ignored, release stops", () => {});
test("no kitty keyboard: toggle mode with warning", () => {});
test("press, press without release switches to toggle", () => {});
```
```tsx
test("space does nothing in voice_activity mode or while typing in the composer", async () => {});
test("m, D and M dispatch mute, deafen and input mode", async () => {});
```

- [x] **Step 2–4:** FAIL → implementar → PASS.
- [x] **Step 5:** commit `feat(e4b): push-to-talk and voice keys` + push.

---

### Task 5: Barra de voz y participantes en la lista de canales

**Files:**
- Create: `src/ui/components/VoiceBar.tsx`
- Modify: `src/ui/components/ChannelList.tsx` (debajo de cada canal de voz, sus participantes), `src/ui/App.tsx`
- Test: `tests/ui/voice-bar.test.tsx`

**Interfaces:**
- Produces: `VoiceBar(props: { store: Store })`. Textos: `🔊 <canal> · 🔒 E2EE · VAD|PTT`, `● vos` cuando `selfSpeaking`, `[mute]`, `[deaf]`, el error de `closeCodeMessage` en rojo, `pttWarning` en amarillo. Participantes en `ChannelList`: `  · <usuario> [mute]`, y `●` delante del que habla.

- [x] **Step 1: Tests**

```tsx
test("connected bar shows channel, E2EE and input mode", async () => {});
test("self speaking shows the dot", async () => {});
test("mute/deaf badges and error text", async () => {});
test("participants appear under the voice channel", async () => {});
```

- [x] **Step 2–4:** FAIL → implementar → PASS.
- [x] **Step 5:** commit `feat(e4b): voice bar and channel participants` + push.

---

### Task 6: 🧍 Paso de Gon — checkpoint E4b

Con auriculares, el TUI en Ghostty y el teléfono mirando el canal `Voz` **sin entrar**:

- [ ] 1. Selecciona `Voz` en la lista y aprieta `v` → la barra dice `🔊 Voz · 🔒 E2EE · VAD`; en el teléfono aparece en el canal. No hay mensaje de 4017.
- [ ] 2. Habla → `● vos` prende en la barra y en el teléfono se ve el anillo verde de que habla. Callado, se apaga.
- [ ] 3. `M` → `PTT`. Sostiene Espacio y habla → prende; suelta → se apaga al toque. Si aparece el aviso amarillo de interruptor, contárselo al agente (en Ghostty no debería).
- [ ] 4. `m` → el teléfono muestra el ícono de mic tachado. `D` → ícono de auriculares tachado; `D` otra vez → vuelve el mute que tenía.
- [ ] 5. `v` → sale; en el teléfono ya no está en el canal. Entra de nuevo y sale con `q` → también lo libera.
- [ ] 6. `bun run leak-check` → `OK`.
- [ ] Le pasa al agente qué puntos dieron bien y, de los que no, lo que vio y el log redactado.

---

## Rama B (solo si Task 1 falló): `voice/own/` sobre davey 0.2.0

Cada tarea con su ciclo TDD, commit y push, igual que arriba. Fuentes: spec 6.6, docs oficial de voice connections y discord.food; concord sirve para leer cómo resuelve cada paso, no para copiar.

### Task B1: davey 0.2.0 y voice gateway v8 propio

**Files:** Create `src/voice/own/voice-gateway.ts`; Test `tests/voice/own/voice-gateway.test.ts` (servidor WS falso de voz).
**Interfaces:** `createVoiceGateway(deps: { endpoint: string; serverId: string; userId: string; sessionId: string; token: Secret; maxDaveVersion: number }): VoiceGateway` con identify op 0 (`server_id`, `user_id`, `session_id`, `token`, `max_dave_protocol_version`), `?v=8`, `wss://` antepuesto, heartbeat op 3 con `seq_ack`, ready op 2 (`ssrc`, `ip`, `port`, `modes`), select protocol op 1, session description op 4 (`secret_key`, `dave_protocol_version`), speaking op 5, resume op 7, y frames binarios DAVE (2 bytes de seq de servidor, 1 de opcode, payload) para 25, 26, 27, 28, 30.
- [ ] `bun remove @discordjs/voice && bun add --exact @snazzah/davey@0.2.0` y sacar el `overrides`.
- [ ] Tests: identify trae `max_dave_protocol_version >= 1`; los frames binarios se parsean con y sin seq; heartbeat con `seq_ack`. FAIL → implementar → PASS → commit + push.

### Task B2: Conexión UDP real con IP discovery y cripto de E4a
**Files:** Create `src/voice/own/udp.ts`; Test `tests/voice/own/udp.test.ts` (loopback que contesta IP discovery).
**Interfaces:** `createVoiceUdp(deps: { ip: string; port: number; ssrc: number }): { discover(): Promise<{ ip: string; port: number }>; send(opus: Uint8Array): void; onPacket(fn: (ssrc: number, opus: Uint8Array) => void): () => void; setKey(key: Uint8Array): void; close(): void }` usando `buildIpDiscoveryRequest`, `encryptRtpsize`, `decryptRtpsize` de E4a.
- [ ] Tests → implementar → PASS → commit + push.

### Task B3: DAVE con davey 0.2.0
**Files:** Create `src/voice/own/dave.ts`; Test `tests/voice/own/dave.test.ts` (con los vectores de E4a).
**Interfaces:** `createDave(deps: { userId: string; channelId: string; send(op: number, payload: Uint8Array | object): void }): { onOp(op: number, payload: unknown): void; encrypt(opus: Uint8Array): Uint8Array; decrypt(userId: string, packet: Uint8Array): Uint8Array | null; privacyCode(): string | null }` que maneja 21–31 según spec 6.6 (prepare/execute transition, external sender, key package, proposals → commit/welcome, invalid commit welcome → reset y key package nuevo).
- [ ] Tests → implementar → PASS → commit + push.

### Task B4: `createOwnVoiceSession` que cumple `VoiceSession`
**Files:** Create `src/voice/own/session.ts`; Test `tests/voice/own/session.test.ts`.
**Interfaces:** `createOwnVoiceSession(deps: { gateway: Gateway; meId: string }): VoiceSession` (misma interfaz de Task 2; `playSpurt` manda Speaking op 5 con `VOICE`, los frames con RTP y, al terminar, 5 `SILENCE_FRAME` y Speaking 0).
- [ ] Tests → implementar → PASS → commit + push.
- [ ] **🧍 Paso de Gon:** repetir Task 1 Step 6 con `bun scripts/voice-spike.ts --own <guild> <channel>`. Si pasa, seguir con Tasks 3–6 usando `createOwnVoiceSession`. Si también falla, frenar: Gon decide.

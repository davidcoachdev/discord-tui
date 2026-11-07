# discord-tui E4c (voz en las dos direcciones, con [2ª]): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** tarea por tarea, en orden. TDD: test que falla → mínimo código → verde. Antes de tildar un `- [ ]` corrés la verificación y pegás la salida. Al cerrar cada tarea: commit **y** `git push origin main`. Los **🧍 Paso de Gon** los hace Gon con la segunda cuenta o un amigo **[2ª]**; frenás y esperás. Nunca leés el token ni `session.json`. Requiere E4b cerrada (plan A o rama B, la que haya quedado).

**Goal:** escuchar a los demás: recibir el audio de cada participante, descifrarlo (DAVE), decodificarlo, mezclarlo y reproducirlo por un solo `pw-cat`; ver quién habla; mostrar el código de privacidad; y aguantar una llamada de 10 minutos sin cortes.

**Architecture:** `VoiceSession` (E4b) suma dos eventos, `onSpeaking` y `onOpus`, que cada implementación llena (A: `connection.receiver`; B: UDP + mapa SSRC→usuario del op 5). `voice/rx.ts` decodifica por usuario y empuja a un `JitterBuffer` de 60 ms; `voice/mixer.ts` suma con saturación cada 20 ms y escribe en `AudioPlayback`.

**Tech Stack:** lo de E4a/E4b; plan A: `connection.receiver.speaking` y `connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 300 } })`.

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (6.6, 7.3, 8.2, 9/E4c).

## Global Constraints

- Las de E0–E4b.
- Mezcla: un mixer propio suma el PCM de cada usuario con saturación a s16 y lo manda a **un único** `pw-cat` (spec 7.3).
- Jitter buffer simple de **60 ms** por usuario (3 frames) (spec 7.3).
- Recibir 5 frames `F8 FF FE` seguidos = esa persona dejó de hablar (spec 6.6).
- Deafen: no se reproduce nada (y no se decodifica), pero los indicadores de quién habla siguen.
- El código de privacidad es `voicePrivacyCode` de davey (spec 9/E4c). Si no hay sesión DAVE lista, no se muestra nada.

## Review Focus

- Una persona deja de mandar paquetes de golpe (se le corta la red) sin los 5 silencios: su buffer se vacía, no se repite el último frame en loop, y su `●` se apaga a los 300 ms (Task 2 y Task 3).
- Dos personas gritando a la vez: la suma satura a ±32767/−32768 en vez de dar la vuelta (overflow) (Task 2).
- Un paquete que DAVE no puede descifrar (transición de época): se descarta y se cuenta, no corta el audio de los demás (Task 3).
- Alguien entra y sale del canal muchas veces: no quedan decoders ni buffers de usuarios que ya se fueron (Task 3).
- El timer de 20 ms se atrasa (GC, carga): el mixer se pone al día sin acumular latencia, tirando frames viejos si el atraso pasa de 100 ms (Task 2).

---

### Task 1: 🧍 Paso de Gon [2ª] — spike del código de privacidad [sin verificar en spec 9/E4c]

Sin el TUI: Gon desde el teléfono y la segunda cuenta o el amigo desde su cliente oficial, los dos en el canal `Voz`.

- [ ] Buscar en el cliente oficial dónde se ve la verificación de cifrado de la llamada (por ejemplo tocando el candado 🔒 o el panel de la llamada) y si muestra un código de números.
- [ ] Contarle al agente: (a) si existe ese código y dónde está, (b) cuántos dígitos y cómo están agrupados. No hace falta pasar el código.
- [ ] **Criterio.** **Pass:** el cliente oficial muestra un código de la llamada → en Task 4 el TUI lo muestra con el mismo formato y en el checkpoint se comparan. **Fail:** no hay código visible → **[nuestra]** fallback: el checkpoint verifica solo que los dos clientes muestren la llamada como cifrada, y el TUI muestra el código igual (es útil entre dos TUIs). El agente anota el resultado en `docs/protocol-notes.md`, sección "Código de privacidad".

---

### Task 2: Jitter buffer y mixer

**Files:**
- Create: `src/voice/jitter.ts`, `src/voice/mixer.ts`
- Test: `tests/voice/jitter.test.ts`, `tests/voice/mixer.test.ts`

**Interfaces:**
- Produces:
  - `createJitterBuffer(opts?: { prebufferFrames?: number; maxFrames?: number }): { push(pcm: Uint8Array): void; pop(): Uint8Array | null; size: number; reset(): void }` (default `prebufferFrames 3` = 60 ms, `maxFrames 10`; `pop()` da `null` hasta juntar el prebuffer; si se vacía vuelve a prebufferear; si se llena tira el más viejo).
  - `mixFrames(frames: Uint8Array[]): Uint8Array` (s16le, suma con saturación; sin frames → silencio de 3840 bytes).
  - `createMixer(deps: { playback: Pick<AudioPlayback, "write">; now?: () => number; setTimer?: typeof setInterval }): { buffer(userId: string): JitterBuffer; remove(userId: string): void; start(): void; stop(): void; setMuted(m: boolean): void }`: en cada tick calcula cuántos frames de 20 ms tocan por tiempo transcurrido; si el atraso pasa de 100 ms, descarta y se realinea.

- [x] **Step 1: Tests**

```ts
test("jitter: null until 3 frames, then FIFO", () => {});
test("jitter: drained buffer prebuffers again instead of repeating", () => {});
test("jitter: overflow drops the oldest", () => {});
test("mixFrames saturates", () => {
  expect(sampleAt(mixFrames([pcmOf(30000), pcmOf(30000)]), 0)).toBe(32767);
  expect(sampleAt(mixFrames([pcmOf(-30000), pcmOf(-30000)]), 0)).toBe(-32768);
  expect(mixFrames([]).length).toBe(3840);
});
test("mixer writes one frame per 20 ms and catches up after a 60 ms stall", () => {});
test("mixer resyncs when lag exceeds 100 ms", () => {});
test("muted mixer writes nothing", () => {});
```

- [x] **Step 2–4:** FAIL → implementar → `bun test tests/voice` PASS.
- [x] **Step 5:** commit `feat(e4c): jitter buffer and saturating mixer` + push.

---

### Task 3: Camino de recepción

**Files:**
- Create: `src/voice/rx.ts`
- Modify: `src/voice/session.ts` (plan A) o `src/voice/own/session.ts` (rama B): `VoiceSession` suma `onSpeaking(fn: (userId: string, on: boolean) => void): () => void` y `onOpus(fn: (userId: string, opus: Uint8Array) => void): () => void`
- Modify: `src/actions/voice.ts` (al conectar arranca `rx` y el mixer; al salir los para), `src/store/reducers/voice.ts` (`voice/speaking` `{ userId; on }`)
- Test: `tests/voice/rx.test.ts`, `tests/voice/session-rx.test.ts`

**Interfaces:**
- Consumes: `createOpusCodec` (un decoder por usuario), `createMixer`, `startPlayback`.
- Produces: `createReceiver(deps: { session: Pick<VoiceSession, "onOpus" | "onSpeaking">; mixer; makeDecoder: () => { decode(o: Uint8Array): Uint8Array }; isDeaf: () => boolean; onSpeaking(userId: string, on: boolean): void }): { stats(): { packets: number; decodeErrors: number; usersActive: number }; stop(): void }`. Un frame `F8 FF FE` no se decodifica; 5 seguidos marcan fin de habla. Sin paquetes de un usuario por 300 ms → `onSpeaking(userId, false)`. Usuario que sale del canal (`VOICE_STATE_UPDATE` con otro `channel_id`) → `mixer.remove` y se libera su decoder.

- [x] **Step 1: Tests**

```ts
test("opus from two users ends up mixed in playback", async () => {});
test("five silence frames end speaking without decoding them", () => {});
test("300 ms without packets ends speaking", () => {});
test("deafened: nothing decoded nor played, speaking still reported", () => {});
test("decode error is counted and other users keep playing", () => {});
test("user leaving the channel frees its decoder and buffer", () => {});
test("plan A: receiver.speaking start subscribes once per user with AfterSilence 300", () => {});
```

- [x] **Step 2–4:** FAIL → implementar → PASS.
- [x] **Step 5:** commit `feat(e4c): voice receive path` + push.

---

### Task 4: Quién habla, código de privacidad y estadísticas

**Files:**
- Modify: `src/ui/components/VoiceBar.tsx`, `src/ui/components/ChannelList.tsx`, `src/actions/voice.ts`
- Create: `src/voice/stats.ts`
- Modify: `src/log/logger.ts` (suma `packets` y `decode_errors` a `ALLOWED_FIELDS`)
- Test: `tests/ui/voice-speaking.test.tsx`, `tests/voice/stats.test.ts`

**Interfaces:**
- Produces:
  - En `ChannelList`, `●` delante de cada participante que habla; en `VoiceBar`, `hablando: <a>, <b>` (máx. 3 nombres, después `+N`).
  - `formatPrivacyCode(code: string): string` con el agrupamiento que anotó Task 1 (si no hubo, grupos de 5 dígitos separados por espacio **[nuestra]**). La barra muestra `🔒 <código>` cuando `privacyCode` no es `null`; se actualiza en cada transición de época.
  - `createVoiceStats(deps: { log; every?: number })`: cada 60 s loguea `event: "voice.stats"` con `packets`, `decode_errors` y `state` (campos de la lista blanca; nada de ids de usuarios).

- [x] **Step 1: Tests**

```tsx
test("speaking users get a dot and appear in the bar", async () => {});
test("privacy code is formatted and hidden when null", async () => {});
```
```ts
test("stats log only allowlisted fields every 60 s", () => {});
```

- [x] **Step 2–4:** FAIL → implementar → PASS.
- [x] **Step 5:** commit `feat(e4c): speaking indicators, privacy code and voice stats` + push.

---

### Task 5: 🧍 Paso de Gon [2ª] — llamada de 10 minutos (checkpoint E4c)

Gon con el TUI en Ghostty y auriculares; la otra persona en su cliente oficial; los dos en `Voz` del servidor de prueba. El teléfono de Gon **fuera** de voz (spec 8.2).

- [ ] 1. Los dos se escuchan en las dos direcciones apenas entran.
- [ ] 2. Cuando la otra persona habla, su `●` prende en el TUI; cuando habla Gon, el cliente de la otra persona muestra su anillo verde.
- [ ] 3. Hablan 10 minutos seguidos (pueden poner música de un lado un rato): sin cortes, sin robotización sostenida, sin que se caiga la conexión.
- [ ] 4. `D` → Gon deja de escuchar y la otra persona ve el ícono de auriculares tachado; `D` otra vez → vuelve el audio.
- [ ] 5. Si Task 1 dio Pass: el código `🔒` del TUI coincide con el que muestra el cliente oficial de la otra persona.
- [ ] 6. Sale con `v`. `bun run leak-check` → `OK`.
- [ ] Le pasa al agente: qué puntos dieron bien, y las líneas `voice.stats` del log (ya redactadas) para ver pérdidas y errores de decodificación.

# discord-tui E4a (voz local, sin red): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** tarea por tarea, en orden. TDD: test que falla → mínimo código → verde. Antes de tildar un `- [ ]` corrés la verificación y pegás la salida. Al cerrar cada tarea: commit **y** `git push origin main`. Los **🧍 Paso de Gon** los hace Gon (vos no podés escuchar); frenás y esperás. Esta etapa no toca Discord: nada de red salvo `127.0.0.1`.

**Goal:** tener probadas en local todas las piezas de voz que no necesitan a Discord: captura y reproducción por PipeWire, Opus, medidor de nivel y VAD, RTP con `aead_aes256_gcm_rtpsize` sobre un loopback UDP, y DAVE con davey hasta donde se puede sin servidor.

**Architecture:** `voice/audio-io.ts` maneja `pw-record` y `pw-cat` como subprocesos con PCM s16le 48 kHz estéreo; `voice/pcm-framer.ts` corta el stream en frames de 20 ms; `voice/opus.ts` envuelve `@discordjs/opus` con caída a `opusscript`; `voice/vad.ts` decide abrir y cerrar. `voice/own/` (RTP, IP discovery, cripto de transporte) es la base del plan B de la spec 7.2: con el plan A la usa `@discordjs/voice` por dentro, así que acá solo se prueba en loopback.

**Tech Stack:** `@discordjs/voice@0.19.2`, `@snazzah/davey@0.1.12` (forzado con `overrides`), `@discordjs/opus@0.11.0`, `opusscript@0.1.1`, `node:crypto` (`aes-256-gcm`), `Bun.udpSocket`, `pw-record`/`pw-cat` del sistema.

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (4 corrección a–c, 6.6, 6.7, 7.2, 7.3, 7.4, 7.6, 9/E4a).

## Global Constraints

- Las de E0–E3 (`spawnClean` con `cleanEnv`, versiones exactas).
- Audio: 48 000 Hz, 2 canales, s16le, frames de 20 ms = 960 muestras por canal = **3840 bytes**; timestamp RTP +960 por frame; payload type 120 (`0x78`); frame de silencio Opus `F8 FF FE`, 5 al dejar de hablar (spec 6.6).
- Captura: `pw-record --raw --format s16 --rate 48000 --channels 2 --latency 20ms -`. Reproducción: `pw-cat --playback --raw --format s16 --rate 48000 --channels 2 -` (spec 6.7).
- VAD **[Gon: modo de entrada como Discord; parámetros nuestros, spec 7.6]**: RMS por frame en dBFS; abre tras **2** frames sobre el umbral; cierra tras **300 ms** (15 frames) por debajo; sensibilidad `auto` por defecto (piso de ruido + margen) o fija en dBFS.
- Cifrado de transporte: `aead_aes256_gcm_rtpsize`; nonce de 32 bits al final del paquete; AAD = header RTP + CSRC + preámbulo de 4 bytes de la extensión (spec 6.6). Bun no tiene `chacha20-poly1305` (probado en la spec); XChaCha no se implementa salvo que el plan B lo exija.
- **[nuestra]** davey en 0.1.12, que es lo que resuelve `@discordjs/voice` 0.19.2 (`^0.1.9`), para tener una sola copia; 0.2.0 queda para el plan B.

## Review Focus

- `pw-record` entrega chunks de cualquier tamaño (1000 bytes, 7000 bytes, un byte impar): el framer arma siempre frames exactos de 3840 y guarda el resto (Task 2).
- `pw-record` no existe o PipeWire no corre: `startCapture` rechaza con `no pude abrir el micrófono (pw-record: <motivo>)` y no deja procesos colgados (Task 3).
- Ruido de fondo constante (ventilador): con `auto` el umbral sube con el piso y el VAD no queda abierto todo el tiempo (Task 4).
- Una palabra cortada en dos con una pausa de 200 ms: el VAD **no** cierra en el medio (Task 4).
- Paquete RTP manipulado o con la clave equivocada: `decryptRtpsize` devuelve `null`, no tira (Task 6).

---

### Task 1: Spike de dependencias de voz y de DAVE local [sin verificar en spec 4(c) y 6.6]

**Files:**
- Modify: `package.json` (deps y `"overrides": { "@snazzah/davey": "0.1.12" }`)
- Create: `scripts/spike-voice-deps.ts`, `scripts/spike-dave-local.ts`, `tests/fixtures/davey/` (vectores de prueba copiados de `davey-node/test/session.test.ts` de https://github.com/Snazzah/davey, MIT, con la licencia al lado)
- Modify: `docs/protocol-notes.md` (sección "Voz: dependencias y DAVE local")

- [ ] **Step 1:** `bun add --exact @discordjs/voice@0.19.2 @discordjs/opus@0.11.0 opusscript@0.1.1 @snazzah/davey@0.1.12`. Run: `bun pm ls --all | grep -c "@snazzah/davey@"` · Expected: `1` (una sola copia, 0.1.12).
- [ ] **Step 2:** `scripts/spike-voice-deps.ts` imprime `generateDependencyReport()` de `@discordjs/voice`. Run: `bun scripts/spike-voice-deps.ts`. **Pass:** el reporte lista `@discordjs/opus`, `@snazzah/davey` y `aes-256-gcm` como presentes. **Fail:** si falta opus nativo, se sigue con `opusscript` y se anota; si falta davey, frenar y avisar a Gon.
- [ ] **Step 3:** `scripts/spike-dave-local.ts`. Lo que verificamos al escribir este plan: davey **no exporta** un "external sender" (el rol del servidor en MLS); sus tests usan vectores fijos (`EXTERNAL_SENDER`, `APPENDING_PROPOSALS`). Probar en este orden y parar en el primero que pase:
  - **(a) dos sesiones:** A y B con `setExternalSender(EXTERNAL_SENDER)`; A procesa `APPENDING_PROPOSALS` → `{ commit, welcome }`; A `processCommit(commit)`; B `processWelcome(welcome)`. **Pass:** `A.ready && B.ready`, `A.voicePrivacyCode === B.voicePrivacyCode` y `B.decrypt(A.userId, MediaType.AUDIO, A.encryptOpus(opus))` devuelve el Opus original.
  - **(b) una sesión:** A llega a `ready` con su propio commit y `A.voicePrivacyCode !== ""`.
  - **(c) solo API:** `getSerializedKeyPackage()` devuelve bytes distintos en cada llamada, `setPassthroughMode(true)` deja pasar Opus sin cifrar, y `encryptOpus` antes de `ready` no corrompe el frame.
  Run: `bun scripts/spike-dave-local.ts` · Expected: imprime `DAVE local: a`, `b` o `c`.
- [ ] **Step 4: Fallback (decisión nuestra, anotada en `docs/protocol-notes.md`):** si sale (b) o (c), el handshake MLS de dos sesiones que pide la spec 9/E4a no se puede hacer sin servidor con la API pública de davey 0.1.12; se prueba en local lo que salió, y el handshake real queda verificado en E4b (DAVE activo, sin 4017) y E4c (`voicePrivacyCode` igual al del otro cliente).
- [ ] **Step 5:** commit `chore(e4a): voice deps and DAVE local spike` + push.

---

### Task 2: Framer de PCM y Opus

**Files:**
- Create: `src/voice/constants.ts`, `src/voice/pcm-framer.ts`, `src/voice/opus.ts`
- Create: `tests/helpers/pcm.ts`
- Test: `tests/voice/pcm-framer.test.ts`, `tests/voice/opus.test.ts`

**Interfaces:**
- Produces:
  - `SAMPLE_RATE = 48000`, `CHANNELS = 2`, `FRAME_SAMPLES = 960`, `FRAME_BYTES = 3840`, `FRAME_MS = 20`, `SILENCE_FRAME = Uint8Array.of(0xf8, 0xff, 0xfe)`.
  - Helpers de test en `tests/helpers/pcm.ts` (los usan E4a–E5): `silence(): Uint8Array`, `pcmOf(sample: number): Uint8Array` (frame con todas las muestras iguales), `square(amp: number)`, `sine(ampFraction: number, hz?: number)`, `sine440()`, `loud()` (-10 dBFS), `quiet(db: number)`, `sampleAt(pcm: Uint8Array, i: number): number`, `correlation(a: Uint8Array, b: Uint8Array): number`. Todos devuelven frames de 3840 bytes.
  - `createFramer(frameBytes?: number): { push(chunk: Uint8Array): Uint8Array[]; pending(): number }`.
  - `createOpusCodec(opts?: { prefer?: "native" | "wasm" }): { encode(pcm: Uint8Array): Uint8Array; decode(opus: Uint8Array): Uint8Array; backend: "native" | "wasm" }` (cae a `opusscript` si `@discordjs/opus` no carga).

- [ ] **Step 1: Tests**

```ts
test("framer emits exact 3840-byte frames and keeps the remainder", () => {
  const f = createFramer();
  expect(f.push(new Uint8Array(1000))).toHaveLength(0);
  const out = f.push(new Uint8Array(7000));
  expect(out).toHaveLength(2); expect(out.every(x => x.length === 3840)).toBe(true); expect(f.pending()).toBe(320);
});
test("odd-sized chunks still align", () => {});
test.each(["native", "wasm"] as const)("opus %s round-trips a 440 Hz sine with the same length", (prefer) => {
  const c = createOpusCodec({ prefer });
  const out = c.decode(c.encode(sine440()));
  expect(out.length).toBe(3840);
  expect(correlation(sine440(), out)).toBeGreaterThan(0.8); // sobre el 2º frame, para saltar el arranque del codec
});
test("encode+decode p99 under 5 ms per frame", () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → `bun test tests/voice` PASS.
- [ ] **Step 5:** commit `feat(e4a): pcm framer and opus codec` + push.

---

### Task 3: Captura y reproducción por PipeWire

**Files:**
- Create: `src/voice/audio-io.ts`
- Test: `tests/voice/audio-io.test.ts`

**Interfaces:**
- Consumes: `spawnClean` (E3 Task 7), `createFramer`.
- Produces:
  - `startCapture(opts?: { target?: string; spawn?: typeof spawnClean }): Promise<AudioCapture>` con `onFrame(fn: (pcm: Uint8Array) => void): () => void`, `stop(): Promise<void>`. Comando: el de Global Constraints, más `--target <target>` si viene.
  - `startPlayback(opts?: { target?: string; spawn?: typeof spawnClean }): Promise<AudioPlayback>` con `write(pcm: Uint8Array): void` (si stdin está lleno, descarta el frame más viejo en vez de acumular), `stop(): Promise<void>`.
  - `class AudioDeviceError extends Error` con mensaje `no pude abrir el micrófono (pw-record: <motivo>)` o `no pude abrir la salida de audio (pw-cat: <motivo>)`.

- [ ] **Step 1: Tests** (con un `spawn` falso que emite bytes y registra stdin)

```ts
test("capture spawns pw-record with the exact args and clean env", async () => {
  expect(call.cmd).toEqual(["pw-record", "--raw", "--format", "s16", "--rate", "48000", "--channels", "2", "--latency", "20ms", "-"]);
});
test("target adds --target", async () => {});
test("capture emits 3840-byte frames from arbitrary chunks", async () => {});
test("process that exits immediately rejects with AudioDeviceError", async () => {});
test("stop kills the process and resolves", async () => { expect(fake.killed).toBe(true); });
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e4a): pipewire capture and playback` + push.

---

### Task 4: Medidor de nivel y VAD

**Files:**
- Create: `src/voice/vad.ts`
- Test: `tests/voice/vad.test.ts`

**Interfaces:**
- Produces:
  - `rmsDbfs(pcm: Uint8Array): number` (s16le interleaved; silencio absoluto → `-96`).
  - `createVad(opts?: { sensitivity?: "auto" | number; openFrames?: number; hangoverMs?: number; marginDb?: number }): { push(pcm: Uint8Array): "open" | "close" | null; isOpen: boolean; thresholdDb: number; levelDb: number }`. Defaults: `openFrames 2`, `hangoverMs 300`, **[nuestra]** `marginDb 12`; en `auto` el piso es el percentil 10 de los últimos 3 s de frames con el VAD cerrado, y el umbral = piso + margen, acotado entre **-60** y **-20** dBFS; arranca en -45 hasta juntar 1 s.

- [ ] **Step 1: Tests**

```ts
test("rmsDbfs", () => {
  expect(rmsDbfs(silence())).toBe(-96);
  expect(rmsDbfs(square(32767))).toBeCloseTo(0, 1);
  expect(rmsDbfs(sine(0.5))).toBeCloseTo(-9.03, 1);
});
test("opens on the 2nd loud frame, not the 1st", () => {
  const v = createVad({ sensitivity: -40 });
  expect(v.push(loud())).toBeNull(); expect(v.push(loud())).toBe("open");
});
test("stays open through 280 ms of silence and closes at 300 ms", () => {
  // 14 frames quietos → null; el 15º → "close"
});
test("a 200 ms pause inside a word does not close", () => {});
test("auto threshold follows a -50 dBFS noise floor: -45 does not open, -30 opens", () => {});
test("threshold is clamped to [-60, -20]", () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e4a): level meter and energy VAD` + push.

---

### Task 5: `bun run mic-test` (eco local con medidor)

**Files:**
- Create: `scripts/mic-test.tsx`, `src/voice/echo.ts`, `src/ui/components/LevelMeter.tsx`
- Test: `tests/voice/echo.test.ts`, `tests/ui/level-meter.test.tsx`

**Interfaces:**
- Consumes: `startCapture`, `startPlayback`, `createOpusCodec`, `createVad`.
- Produces:
  - `createEcho(deps: { capture: AudioCapture; playback: AudioPlayback; codec; vad; gate?: "vad" | "always" }): { stop(): Promise<void>; stats(): { frames: number; dropped: number; p99ProcessingMs: number } }`: cada frame va captura → Opus → decode → reproducción; con `gate: "vad"` solo suena con el VAD abierto. E5 lo reusa para "probar mic".
  - `LevelMeter(props: { levelDb: number; thresholdDb: number; open: boolean; width: number })`: barra de -60 a 0 dBFS, línea `|` en el umbral, `● hablando` cuando `open`.
  - Script: `"mic-test": "bun scripts/mic-test.tsx"`; teclas `g` alterna `vad`/`always`, `+`/`-` mueven la sensibilidad manual de a 3 dB, `a` vuelve a `auto`, `q` sale.

- [ ] **Step 1: Tests**

```ts
test("echo pipes captured frames through opus into playback", async () => { expect(playback.frames).toHaveLength(captured.length); });
test("vad gate only plays while open", async () => {});
test("p99 processing per frame is under 5 ms", async () => {});
```
```tsx
test("meter draws the threshold marker and the speaking dot", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS. Además, el agente corre `timeout 5 bun scripts/mic-test.tsx < /dev/null; echo exit=$?` y pega la salida (Expected: sin stack trace; `pw-record` es local y no toca la cuenta).
- [ ] **Step 5:** commit `feat(e4a): mic echo test with level meter` + push.

---

### Task 6: RTP, IP discovery y cifrado de transporte en loopback (base del plan B)

**Files:**
- Create: `src/voice/own/rtp.ts`, `src/voice/own/ip-discovery.ts`, `src/voice/own/transport-crypto.ts`
- Test: `tests/voice/own/rtp.test.ts`, `tests/voice/own/ip-discovery.test.ts`, `tests/voice/own/loopback.test.ts`

**Interfaces:**
- Produces:
  - `buildRtpHeader(h: { seq: number; timestamp: number; ssrc: number }): Uint8Array` (12 bytes: `0x80, 0x78`, seq u16 BE, timestamp u32 BE, ssrc u32 BE); `parseRtp(packet: Uint8Array): { seq; timestamp; ssrc; headerLen: number; hasExtension: boolean }`.
  - `buildIpDiscoveryRequest(ssrc: number): Uint8Array` (74 bytes: type `0x0001`, length `70`, ssrc, 64 bytes de dirección en cero, puerto `0`, todo BE); `parseIpDiscoveryResponse(b: Uint8Array): { ip: string; port: number }` (type `0x0002`, ip null-terminated desde el byte 8, puerto u16 BE en el byte 72).
  - `encryptRtpsize(header: Uint8Array, opus: Uint8Array, key: Uint8Array, counter: number): Uint8Array` → `header | ciphertext | tag(16) | counter(4, BE)`; nonce AES-GCM de 12 bytes = counter BE en los primeros 4 y ceros; AAD = header (+ CSRC + preámbulo de extensión si hay).
  - `decryptRtpsize(packet: Uint8Array, key: Uint8Array): Uint8Array | null` (si hay extensión, saca el cuerpo de la extensión del plaintext usando la longitud del preámbulo).

- [ ] **Step 1: Tests**

```ts
test("rtp header bytes", () => {
  expect([...buildRtpHeader({ seq: 1, timestamp: 960, ssrc: 0x01020304 })]).toEqual([0x80, 0x78, 0, 1, 0, 0, 3, 0xc0, 1, 2, 3, 4]);
});
test("ip discovery request is 74 bytes with type 1 and length 70", () => {
  const b = buildIpDiscoveryRequest(42);
  expect(b.length).toBe(74); expect([...b.slice(0, 8)]).toEqual([0, 1, 0, 70, 0, 0, 0, 42]);
});
test("ip discovery response parses ip and port", () => {});
test("encrypt/decrypt round-trip; tampered byte or wrong key → null", () => {});
test("decrypt strips an RTP header extension body", () => {});
test("50 packets over a 127.0.0.1 UDP loopback arrive decrypted and in order", async () => {
  // dos Bun.udpSocket; seq 0..49, timestamp += 960, counter += 1
  expect(received.map(p => p.seq)).toEqual([...Array(50).keys()]);
});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e4a): rtp, ip discovery and rtpsize crypto with udp loopback` + push.

---

### Task 7: Test de DAVE local

**Files:**
- Create: `tests/voice/dave-local.test.ts`

**Interfaces:**
- Consumes: el resultado de Task 1 (`a`, `b` o `c`) y los vectores de `tests/fixtures/davey/`.

- [ ] **Step 1:** convertir el camino que pasó en Task 1 en tests de `bun test` (los asserts de (a), (b) o (c) tal cual están en Task 1, Step 3), más: `new DAVESession(DAVE_PROTOCOL_VERSION + 1, …)` tira (igual que el test de davey "throws on invalid protocol version"), y `DAVE_PROTOCOL_VERSION >= 1` (con 0, Discord cierra con 4017, spec 6.6).
- [ ] **Step 2:** Run `bun test tests/voice/dave-local.test.ts` · Expected: PASS.
- [ ] **Step 3:** commit `test(e4a): local DAVE checks` + push.

---

### Task 8: 🧍 Paso de Gon — escuchar el eco (checkpoint E4a)

Con auriculares (para que el parlante no vuelva al mic), en Ghostty:

- [ ] `bun run mic-test`. Habla y se escucha a sí mismo. Aplaude cerca del mic: el aplauso tiene que sonar "pegado", sin eco perceptible (objetivo de la spec: menos de 150 ms).
- [ ] La barra sube al hablar y la línea del umbral se ve. En modo `vad` (tecla `g`): callado no se oye nada, al hablar abre al toque, y entre palabras no corta.
- [ ] Con un ventilador o música bajita de fondo, en `auto`: el umbral sube y no queda `● hablando` todo el tiempo. Con `+`/`-` se puede ajustar a mano.
- [ ] `q` sale sin dejar procesos: `pgrep -a pw-record` no muestra nada.
- [ ] Le cuenta al agente: si el eco se sintió con retardo, si el VAD cortaba palabras o abría con ruido, y la línea de `stats` que imprime el script al salir.

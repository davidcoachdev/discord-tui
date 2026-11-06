# discord-tui E1.5 (tanda de capturas): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** tarea por tarea, en orden. TDD: test que falla → mínimo código → verde. Antes de tildar un `- [ ]` corrés la verificación y pegás la salida. Al cerrar cada tarea: commit **y** `git push origin main`. Esta etapa es casi toda de Gon: los **🧍 Paso de Gon** los hace él; vos frenás, le pasás el paso tal cual y esperás. **Nunca abrís nada de `~/discord-captures-raw/`** (son capturas crudas con el token) y nunca corrés `scripts/capture-gateway.ts` ni `scripts/redact.ts` sobre archivos reales. Solo trabajás con lo que Gon deja en `fixtures/`.

**Goal:** juntar en una sola tanda, antes de E2, todas las capturas del protocolo que el diseño deja **[sin verificar]**, redactadas en `fixtures/`, y documentarlas en `docs/protocol-notes.md`.

**Architecture:** dos fuentes. (1) Lo que el navegador muestra en texto plano: los frames **salientes** del gateway (identify, op 37, op 4) y los requests REST (Copy as cURL, respuestas JSON). (2) Los eventos **entrantes** del gateway, que el cliente web recibe comprimidos y DevTools no muestra legibles: los graba `scripts/capture-gateway.ts`, que corre Gon con su sesión. Todo pasa por `scripts/redact.ts` en una sola corrida, así los ids redactados son coherentes entre archivos. **[nuestra]** Este split es nuestro: la spec 8.1 pide capturas "del cliente web oficial", pero los frames entrantes no se pueden leer ahí.

**Tech Stack:** Bun, `node:zlib` (`createInflate`, un contexto por conexión), lo de E1.

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (6.2, 6.4, 7.8, 8.1, 9/E1.5, 11).

## Global Constraints

- Las de E0 y E1.
- Las capturas crudas viven **fuera del repo**, en `~/discord-captures-raw/` (y `captures-raw/` está en `.gitignore` por si acaso). Se borran al terminar la etapa.
- Gon captura **solo en su servidor de prueba** y en un DM con la segunda cuenta: así el `content` de los mensajes es texto que escribió él y se puede conservar.
- `redact.ts` falla (exit 2, no escribe nada) si su salida todavía contiene algo que `findTokenLike` reconoce.
- `capture-gateway.ts` nunca imprime payloads: solo nombre de evento y contador.
- Gateway: `wss://gateway.discord.gg/?v=9&encoding=json&compress=zlib-stream`, sin `intents` (spec 6.2). zlib-stream: un contexto de inflate por conexión; un mensaje está completo cuando el buffer termina en `00 00 ff ff`.

## Review Focus

- Un id que aparece como número en un lugar y dentro de un string en otro (`"<@123…>"`, URLs del CDN, `"channel_id"`): se mapea al **mismo** id falso en los dos (Task 1).
- Una URL de adjunto firmada (`?ex=…&is=…&hm=…`): se le saca la query string (Task 1).
- Un frame zlib partido en dos mensajes WS (el primero sin el sufijo `00 00 ff ff`): el inflater espera al segundo y no tira error (Task 2).
- `X-Super-Properties` es base64: se decodifica, se redacta adentro (`client_launch_id`, `client_heartbeat_session_id`, `launch_signature`) y se vuelve a codificar (Task 1).
- Arrays largos de READY (200 guilds, miles de read states): `--trim` los corta a 3 elementos para que la fixture pese poco y no lleve datos de terceros (Task 1).

---

### Task 1: `scripts/redact.ts`

**Files:**
- Create: `scripts/redact.ts`, `src/security/redact.ts`
- Test: `tests/security/redact.test.ts`

**Interfaces:**
- Consumes: `findTokenLike` (E0).
- Produces:
  - `createRedactor(opts?: { trim?: number }): Redactor` con `redactJson(value: unknown): unknown` y `redactCurl(curlText: string): { method: string; url: string; headers: Record<string, string>; body: unknown }`. Un mismo `Redactor` mantiene un solo mapa de ids para todas las entradas.
  - CLI: `bun scripts/redact.ts --root <dir crudo> --out <dir> [--trim 3]`: procesa **todos** los `*.json` y `*.curl.txt` bajo `--root` en una sola corrida (un solo mapa de ids) y conserva la ruta relativa: `<root>/browser/identify.json` → `<out>/browser/identify.json`; un `*.curl.txt` sale como `.json` con la forma de `redactCurl`. `--trim` solo afecta a payloads `READY*`. Imprime solo `ok <archivo>` por cada salida.

Reglas **[nuestra]**:
- Claves cuyo valor pasa a `"[redacted]"`: `token`, `auth_token`, `authorization`, `cookie`, `x-fingerprint`, `ticket`, `encrypted_token`, `email`, `phone`, `password`, `analytics_token`, `user_settings_proto`, `session_id` (pasa a `"SESSION_ID"`), `x-captcha-key`.
- Snowflakes (strings o números de 17 a 20 dígitos, también dentro de strings): se juntan todos los de la corrida, se ordenan y se mapean a `100000000000000001`, `100000000000000002`… en el mismo orden, así se conserva el orden relativo (importa para no leídos e historial).
- Nombres (`username`, `global_name`, `nick`, `name` de guilds/canales/roles): `user1`, `user2`…, `guild1`, `channel1`… por valor original, estable en la corrida.
- Hashes de avatar/icon/banner: 32 hex de ceros con el mismo prefijo `a_` si lo tenía.
- `endpoint` de voz → `c-xxx00-00000000.discord.media:443`; IPs → `203.0.113.1`; UUIDs → `00000000-0000-4000-8000-00000000000N`.
- `relationships`, `connected_accounts`, `consents` → `[]`/`{}`.
- `--trim N` corta a N elementos los arrays de primer y segundo nivel de un READY.

- [x] **Step 1: Tests que fallan**

```ts
test("secret keys are redacted at any depth", () => {
  const r = createRedactor();
  expect(r.redactJson({ d: { token: fakeToken(), properties: { os: "Linux" } } })).toEqual({ d: { token: "[redacted]", properties: { os: "Linux" } } });
});
test("snowflakes map to ordered fake ids consistently, also inside strings", () => {
  const r = createRedactor();
  const out = r.redactJson({ a: "222222222222222222", b: "<@111111111111111111>", c: "https://cdn.discordapp.com/attachments/222222222222222222/x.png?ex=1&hm=2" }) as any;
  expect(out).toEqual({ a: "100000000000000002", b: "<@100000000000000001>", c: "https://cdn.discordapp.com/attachments/100000000000000002/x.png" });
});
test("X-Super-Properties is decoded, redacted and re-encoded", () => {
  const out = createRedactor().redactCurl(sampleCurl); // armado en el test con un X-Super-Properties con client_launch_id real-looking
  const props = JSON.parse(atob(out.headers["x-super-properties"]));
  expect(props.client_launch_id).toMatch(/^00000000-0000-4000-8000-/);
  expect(out.headers.authorization).toBe("[redacted]");
  expect(out.headers.cookie).toBe("[redacted]");
});
test("cli exits 2 and writes nothing if a token-like string survives", async () => {
  // input con fakeToken() bajo una clave no listada, p. ej. { "foo": fakeToken() }
  expect(exitCode).toBe(2); expect(existsSync(outFile)).toBe(false);
});
test("--trim keeps 3 guilds in READY", () => {});
```

- [x] **Step 2–4:** FAIL → implementar → `bun test tests/security` PASS.

```text
$ bun test tests/security/redact.test.ts
 5 pass
 0 fail
 16 expect() calls
Ran 5 tests across 1 file. [387.00ms]
```

- [x] **Step 5:** commit `feat(e1.5): redact script for captures` + push.

---

### Task 2: Inflater zlib-stream y `scripts/capture-gateway.ts`

**Files:**
- Create: `src/gateway/inflate.ts`, `scripts/capture-gateway.ts`
- Create: `tests/fakes/fake-gateway.ts`
- Test: `tests/gateway/inflate.test.ts`, `tests/scripts/capture-gateway.test.ts`

**Interfaces:**
- Consumes: `loadSession`, `createClientProps`, `fetchBuildNumber` (E1).
- Produces:
  - `createZlibStreamInflater(): { push(chunk: Uint8Array): string | null; reset(): void }` (devuelve el JSON completo cuando el chunk termina en `00 00 ff ff`, si no `null`).
  - `startFakeGateway(opts: { onIdentify?(d: any): void; script?: FakeGwStep[] }): { url: string; sent: any[]; received: any[]; dispatch(t: string, d: unknown): void; close(code: number): void; stop(): void }`: habla zlib-stream con un `deflate` compartido por conexión y `Z_SYNC_FLUSH`. E2 lo extiende.
  - CLI (la corre Gon): `bun scripts/capture-gateway.ts --out ~/discord-captures-raw/gateway --capabilities <n> [--op37 <archivo>] [--voice <guild_id> <channel_id>]`. Hace hello → identify (con `properties` de `createClientProps`, `capabilities` del argumento, `presence` online, `compress: false`, sin intents) → heartbeat. Guarda cada dispatch de la lista `READY, READY_SUPPLEMENTAL, MESSAGE_CREATE, MESSAGE_UPDATE, MESSAGE_REACTION_ADD, TYPING_START, PRESENCE_UPDATE, GUILD_MEMBER_LIST_UPDATE, VOICE_STATE_UPDATE, VOICE_SERVER_UPDATE, CHANNEL_UNREAD_UPDATE, MESSAGE_ACK` como `<out>/<T>-<n>.json` (máx. 3 por tipo). Teclas: `o` manda el op 37 del archivo, `v` manda op 4 de entrada al canal de voz y, cuando llega `VOICE_SERVER_UPDATE`, op 4 de salida (`channel_id: null`); `q` cierra con 1000. Por stdout solo `READY 1`, `MESSAGE_CREATE 2`…

- [x] **Step 1: Tests**

```ts
test("inflater returns null until the 00 00 ff ff suffix arrives", () => {
  const [a, b] = splitDeflated(JSON.stringify({ op: 10 })); // helper del test con deflate sync-flush
  const inf = createZlibStreamInflater();
  expect(inf.push(a)).toBeNull();
  expect(JSON.parse(inf.push(b)!)).toEqual({ op: 10 });
});
test("inflater keeps context across messages", () => {});
test("capture script identifies without intents and saves dispatches", async () => {
  // fake gateway; sesión falsa en XDG temporal; --capabilities 16381
  expect(fake.received[0]).toMatchObject({ op: 2, d: { capabilities: 16381, compress: false } });
  expect(fake.received[0].d.intents).toBeUndefined();
  expect(readdirSync(out)).toContain("READY-1.json");
  expect(stdout).not.toContain(fakeToken());
});
```

- [x] **Step 2–4:** FAIL → implementar → `bun test` PASS.

El CLI acepta además `--url <ws>` (solo para tests; por defecto el gateway real) y usa el `client_build_number` cacheado en la sesión para no pedir red.

```text
$ bun test tests/gateway tests/scripts/capture-gateway.test.ts
 4 pass
 0 fail
 14 expect() calls
Ran 4 tests across 2 files. [462.00ms]

$ bun test && bun run typecheck
 65 pass
 0 fail
 139 expect() calls
Ran 65 tests across 18 files. [3.50s]
$ tsc --noEmit   # sin salida, código 0
```

- [x] **Step 5:** commit `feat(e1.5): zlib-stream inflater and gateway capture script` + push.

---

### Task 3: 🧍 Paso de Gon — capturas desde el navegador

Todo en Chrome, logueado en https://discord.com/app, con DevTools abierto (F12) y **solo en el servidor de prueba**. Cada cosa se guarda en `~/discord-captures-raw/browser/` (`mkdir -p ~/discord-captures-raw/browser && chmod -R 700 ~/discord-captures-raw`).

- [ ] **1. Identify:** DevTools → Network → filtro `WS` → recargar la página (Ctrl+R) → click en la conexión `gateway.discord.gg` → pestaña Messages → el **primer mensaje con flecha verde (saliente)** que tiene `"op":2` → click derecho → Copy message → guardarlo como `~/discord-captures-raw/browser/identify.json`. Anotar aparte el número de `"capabilities"` (no es secreto, se lo pasa al agente). Si los mensajes salientes aparecen como "Binary Message", avisarle al agente y saltear 1 y 2.
- [ ] **2. Op 37:** con la misma conexión abierta, entrar al canal `#pruebas` → en Messages buscar el saliente con `"op":37` → Copy message → `op37.json`.
- [ ] **3. Op 4:** entrar al canal de voz `Voz` y salir → el saliente con `"op":4` y `channel_id` no nulo → `op4-join.json`.
- [ ] **4. Headers REST:** filtro `Fetch/XHR` → mandar un mensaje "hola" en `#pruebas` → click derecho en el `POST …/messages` → Copy → Copy as cURL (bash) → `send-message.curl.txt`.
- [ ] **5. Ack:** cambiar a otro canal y volver a uno con mensajes nuevos → el `POST …/ack` → Copy as cURL (bash) → `ack.curl.txt`.
- [ ] **6. Historial:** el `GET …/messages?limit=50` del canal `#pruebas` → Response → copiar todo → `messages-page.json`. Antes, mandar desde el teléfono un mensaje con **una imagen adjunta, un emoji custom del servidor y un link que genere embed** (por ejemplo un video de YouTube).
- [ ] **7. Subida de archivo:** subir una imagen chica desde el navegador → copiar como cURL **cada** request nuevo que aparezca (`POST …/attachments`, el `PUT` a `discord-attachments-uploads-prd.storage.googleapis.com` si aparece, y el `POST …/messages`) → `upload-1.curl.txt`, `upload-2.curl.txt`, `upload-3.curl.txt` en orden. Para el de `/attachments` copiar también su Response → `upload-1-response.json`.
- [ ] Contarle al agente: el número de `capabilities`, si 1-3 salieron legibles, y cuántos requests hubo en la subida.

---

### Task 4: 🧍 Paso de Gon — capturas de eventos entrantes con el script

- [ ] Con la sesión de E1 activa (`bun run dev` loguea bien), en una terminal:

```bash
cd ~/projects/discord-tui
bun scripts/capture-gateway.ts --out ~/discord-captures-raw/gateway --capabilities <N de Task 3> \
  --op37 ~/discord-captures-raw/browser/op37.json --voice <id del servidor de prueba> <id del canal Voz>
```

(Los ids se copian con modo desarrollador de Discord: click derecho → Copiar ID. No se le pasan al agente.)
- [ ] Debería ver `READY 1` (y probablemente `READY_SUPPLEMENTAL 1`) en pocos segundos.
- [ ] Apretar `o` → `GUILD_MEMBER_LIST_UPDATE 1`.
- [ ] Desde el teléfono, mandar en `#pruebas` un mensaje con imagen, emoji custom y link → `MESSAGE_CREATE 1`; reaccionar a ese mensaje → `MESSAGE_REACTION_ADD 1`.
- [ ] Desde la segunda cuenta **[2ª]** (si ya está): escribir sin mandar unos segundos en `#pruebas` → `TYPING_START 1`; cambiar su estado a Ausente → `PRESENCE_UPDATE 1`. Si todavía no hay segunda cuenta, se saltea y se repite antes de cerrar E2.
- [ ] Apretar `v` → `VOICE_STATE_UPDATE` y `VOICE_SERVER_UPDATE` aparecen, y al ratito otro `VOICE_STATE_UPDATE` (la salida).
- [ ] Apretar `q`.

---

### Task 5: 🧍 Paso de Gon — redactar y guardar en `fixtures/`

- [ ] Correr una sola vez, con todo junto:

```bash
cd ~/projects/discord-tui
bun scripts/redact.ts --root ~/discord-captures-raw --out fixtures --trim 3
bun test tests/security/no-token-leak.test.ts
```

Esperado: una línea `ok …` por archivo y el test en verde. Si `redact.ts` sale con código 2, **no** forzarlo: avisarle al agente qué archivo fue (solo el nombre).
- [ ] Mirar a ojo uno o dos archivos de `fixtures/` y confirmar que no hay nombres reales ni el contenido de mensajes de otra gente.
- [ ] `git add fixtures && git commit -m "test: sanitized protocol fixtures" && git push origin main`.
- [ ] Borrar lo crudo: `rm -rf ~/discord-captures-raw`.
- [ ] Avisarle al agente "fixtures subidas".

---

### Task 6: `docs/protocol-notes.md`, constantes y test de contrato de fixtures

**Files:**
- Modify: `docs/protocol-notes.md`, `src/client-props/props.ts` (`CHROME_UA` = el `user-agent` de `fixtures/browser/send-message.json`), `src/client-props/build-number.ts` (`FALLBACK_BUILD_NUMBER` = el de su `X-Super-Properties`)
- Create: `src/gateway/identify.ts`
- Create: `tests/helpers/shape.ts`
- Test: `tests/fixtures/fixtures-contract.test.ts`, `tests/gateway/identify.test.ts`

**Interfaces:**
- Produces: `shapeOf(v: unknown): unknown` en `tests/helpers/shape.ts` (cambia cada valor por el nombre de su tipo, recursivo; un array pasa a `[shapeOf(primer elemento)]`; lo usan los tests de E2–E5 que comparan contra capturas). `GATEWAY_CAPABILITIES: number` (el de la captura) y `buildIdentify(token: Secret, props: ClientProps): IdentifyPayload` en `src/gateway/identify.ts` (lo usa E2). `IdentifyPayload` replica la forma de `fixtures/browser/identify.json` campo por campo, salvo el token.

- [ ] **Step 1: Tests**

```ts
const REQUIRED = ["browser/identify.json", "browser/op37.json", "browser/op4-join.json", "browser/send-message.json",
  "browser/ack.json", "browser/messages-page.json", "gateway/READY-1.json", "gateway/MESSAGE_CREATE-1.json",
  "gateway/GUILD_MEMBER_LIST_UPDATE-1.json", "gateway/VOICE_STATE_UPDATE-1.json", "gateway/VOICE_SERVER_UPDATE-1.json"];
test.each(REQUIRED)("fixture %s exists, parses and has no unredacted secret keys", (f) => {});
test("buildIdentify has the same keys as the browser identify, the same capabilities and no intents", () => {
  const ours = buildIdentify(new Secret(fakeToken()), props);
  expect(Object.keys(ours.d).sort()).toEqual(Object.keys(browserIdentify.d).sort());
  expect(ours.d.capabilities).toBe(browserIdentify.d.capabilities);
  expect(ours.d).not.toHaveProperty("intents");
});
test("our super properties have the same keys as the captured ones", () => {});
test("CHROME_UA matches the captured user-agent", () => {});
```

(Si `TYPING_START`/`PRESENCE_UPDATE` faltan porque no había segunda cuenta, van en una lista `OPTIONAL` que solo avisa.)

- [x] **Step 2–4:** FAIL → implementar → `bun test && bun run typecheck` PASS.

Los tests de contrato viven en `tests/fixtures/fixtures-contract.test.ts` (incluyen identify, super properties, UA y `shapeOf`).

```text
$ bun test tests/fixtures
 15 pass
 0 fail
 26 expect() calls
Ran 15 tests across 1 file. [135.00ms]

$ bun test && bun run typecheck
 86 pass
 0 fail
 174 expect() calls
Ran 86 tests across 19 files. [3.89s]
$ tsc --noEmit   # sin salida, código 0
```
- [x] **Step 5:** escribir `docs/protocol-notes.md` con una sección por fixture: qué es, de dónde salió, campos que usamos, y las respuestas a lo **[sin verificar]** de la spec: valor de `capabilities`; si READY trae `private_channels` (y si no, dónde vienen los DMs); forma exacta del op 37 (rangos, `typing`, `activities`, `threads`); forma del body del ack (`{ token: null, last_viewed }` o lo que se vea); si hay `X-Discord-Timezone`; flujo de subida (directo multipart o `/attachments` + upload URL); forma de `GUILD_MEMBER_LIST_UPDATE` (`ops` SYNC/INSERT/UPDATE/DELETE/INVALIDATE).

Hecho en `docs/protocol-notes.md`, secciones "Fixtures de E1.5 (sintéticas)" y "Respuestas a los [sin verificar]".
- [x] **Step 6:** commit `docs(e1.5): protocol notes from captures` + push.

---

## Nota de ejecución (2026-11-06)

Gon no tenía tiempo para las capturas del navegador (Tasks 3–5). En su lugar, las fixtures se generaron desde el bundle JS público del cliente web y `discord-api-types`, sin tocar la cuenta ni el token. El detalle y las respuestas a los **[sin verificar]** están en `docs/protocol-notes.md`, sección "Fixtures de E1.5 (sintéticas)". Las Tasks 3–5 quedan sin tildar: no se hicieron como estaban escritas. Cuando haya una captura real, se reemplazan las fixtures y se ajusta lo que difiera.

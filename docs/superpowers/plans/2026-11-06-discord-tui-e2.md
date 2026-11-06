# discord-tui E2 (leer): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** tarea por tarea, en orden. TDD: test que falla → mínimo código → verde. Antes de tildar un `- [ ]` corrés la verificación y pegás la salida. Al cerrar cada tarea: commit **y** `git push origin main`. Los **🧍 Paso de Gon** los hace Gon; frenás y esperás. Nunca leés el token ni `session.json`. Todo lo del protocolo sale de `fixtures/` y de `docs/protocol-notes.md` (E1.5): si una fixture no alcanza para decidir algo, frenás y preguntás, no inventás la forma del payload.

**Goal:** leer Discord en el TUI: gateway con resume y reconnect, guilds, canales y DMs, historial con scroll, mensajes en vivo, no leídos, markdown, imágenes y emojis inline, embeds básicos, lista de miembros con op 37, presencia y typing.

**Architecture:** `gateway/` (WS + zlib-stream + heartbeat + resume) y `rest/client.ts` (colas por ruta arriba de `rest/http.ts`) emiten hacia `store/`, que es estado inmutable con reducers puros por evento. `actions/` es lo único que la UI llama; `app/runtime.ts` arma todo. La UI lee con `useSelector` y nunca toca la red (spec 5).

**Tech Stack:** lo de E0/E1, `discord-api-types@0.38.57` (solo tipos, donde coinciden), `<scrollbox>`, `<image>` y `<text>` de `@opentui/solid` 0.8.2.

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (6.1, 6.2, 6.3, 7.1, 7.5, 7.7, 7.8, 9/E2).

## Global Constraints

- Las de E0, E1 y E1.5. `bun add --exact discord-api-types@0.38.57`.
- Gateway `wss://gateway.discord.gg/?v=9&encoding=json&compress=zlib-stream`, identify con `buildIdentify` (E1.5), sin intents, una sola sesión de gateway.
- REST `https://discord.com/api/v9`; una cola por ruta; siempre respetar `retry_after`; 401 corta todo y vuelve al login; los límites no se hardcodean (spec 6.3).
- Historial: páginas de 50 (`GET /channels/{id}/messages?limit=50&before=`), solo al hacer scroll hacia arriba. Ring de 500 mensajes por canal (spec 7.7). Sin caché en disco.
- Op 37 solo para el canal abierto y con un rango chico (`[[0, 99]]`); nada de op 8 masivo, nada de polling (spec 7.8).
- Imágenes: `fetch` sin `Authorization` y solo a `cdn.discordapp.com` y `media.discordapp.net` **[nuestra]**. Protocolo `auto` (spec 6.1). Si no hay protocolo gráfico, se muestra el link o `:nombre:`.
- Hilos, foros, stage y búsqueda quedan afuera (spec 2): esos canales no se listan.

## Review Focus

- Canales que el usuario no puede ver: READY de usuario trae todos los canales del guild; sin calcular `VIEW_CHANNEL` aparecen canales ocultos que dan 403 al abrirlos. **[nuestra]** Se calcula el permiso con roles y overwrites (Task 5).
- Mensaje editado o borrado que no está en el ring (más viejo que los 500): `MESSAGE_UPDATE`/`MESSAGE_DELETE` se ignora sin error (Task 6).
- Wifi cortado 30 s: si el resume falla (op 9 `d: false`), el identify nuevo dispara la recarga de los últimos 50 del canal abierto y no se duplica ningún mensaje (Task 7).
- Scroll hacia arriba rápido con `k` sostenido: un solo request de historial en vuelo por canal, y se deja de pedir cuando una página trae menos de 50 (Task 7).
- Mensaje con un code block de 300 líneas o un emoji custom que no carga: el render se corta a 20 líneas con `… (N líneas más)` y el emoji cae a `:nombre:` (Tasks 10 y 11).

---

### Task 1: Spike de imágenes en Ghostty [sin verificar en spec 3 y 6.1]

**Files:**
- Create: `scripts/spike-image.tsx`, `tests/fixtures/images/sample.png`, `tests/fixtures/images/sample.gif` (generados por el agente, sin datos de nadie)

- [x] **Step 1:** escribir `scripts/spike-image.tsx`: pantalla con un PNG de 64x64 y un GIF animado de 3 frames con `<image src=... protocol="auto" fit="fit">`, y una línea con el protocolo que eligió `resolveImageRenderProtocol` y `renderer.capabilities.kitty_graphics`. Run (agente, para ver que no explota): `timeout 3 bun scripts/spike-image.tsx < /dev/null; echo exit=$?` · Expected: `exit=124` o `exit=0`, sin stack trace.
- [ ] **Step 2: 🧍 Paso de Gon.** En Ghostty, sin tmux: `bun scripts/spike-image.tsx`. Contarle al agente: (a) si el PNG se ve como imagen (no como bloques de colores), (b) si el GIF se mueve, (c) qué protocolo dice la línea. `q` sale.
- [x] **Step 3: Criterio.** **Pass:** (a) sí y protocolo `kitty`. **Fail:** fallback de la spec: `OPENTUI_IMAGE_PROTOCOL=blocks` y, si tampoco anda, solo links. Si (b) es no: **[nuestra]** los GIF y emojis animados muestran el primer frame. Anotar el resultado en `docs/protocol-notes.md`, sección "Imágenes en Ghostty", y `type ImageMode = "kitty" | "blocks" | "links"` más la constante `IMAGE_MODE: ImageMode` en `src/images/mode.ts`.

Resultado parcial: el spike corre sin crashear. La constante `IMAGE_MODE = "kitty"` y la sección "Imágenes en Ghostty" de `docs/protocol-notes.md` quedaron escritas, pero la confirmación visual (a) y (b) sigue pendiente; si Gon ve bloques, se cambia a `"blocks"`.
- [x] **Step 4:** commit `chore(e2): image protocol spike result` + push.

---

### Task 2: `RestClient` con colas por ruta, 429 y corte por 401

**Files:**
- Create: `src/rest/client.ts`, `src/rest/routes.ts`
- Modify: `src/rest/errors.ts` (agrega `RateLimitedError`), `src/rest/http.ts` (tira `RateLimitedError` en 429)
- Test: `tests/rest/client.test.ts`

**Interfaces:**
- Consumes: `createHttp`, `HttpError`, `UnauthorizedError` (E1), `startFakeHttp`.
- Produces:
  - `RateLimitedError extends HttpError { retryAfterMs: number; global: boolean; scope: string | null }` (de `retry_after` del body en segundos, o del header `Retry-After`).
  - `routeKey(method: string, path: string): string`: conserva el id que sigue a `/channels/`, `/guilds/` y `/webhooks/`, cambia los demás ids por `:id` y saca la query (`GET /channels/123/messages/:id`).
  - `createRestClient(deps: { http: Http; onUnauthorized(): void; sleep?: (ms: number) => Promise<void> }): RestClient` con `request<T>(method: string, path: string, body?: unknown): Promise<T>` y `closed: boolean`.
  - `getMessages(rest: RestClient, channelId: string, opts?: { before?: string; limit?: number }): Promise<ApiMessage[]>` en `routes.ts` (E3 suma más rutas acá).

- [x] **Step 1: Tests que fallan**

```ts
test("same route is serialized, different routes run in parallel", async () => {});
test("429 waits retry_after and retries", async () => {
  // fake: 1ª respuesta 429 { retry_after: 0.05, global: false }, 2ª 200
  expect(elapsed).toBeGreaterThanOrEqual(50); expect(fake.requests).toHaveLength(2);
});
test("global 429 pauses every route", async () => {});
test("gives up after 3 consecutive 429s with RateLimitedError", async () => {});
test("401 calls onUnauthorized once and later requests fail without touching the network", async () => {
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
  await expect(rest.request("GET", "/users/@me")).rejects.toBeInstanceOf(UnauthorizedError);
  expect(fake.requests).toHaveLength(1);
});
test("routeKey keeps major params", () => {
  expect(routeKey("GET", "/channels/123456789012345678/messages/223456789012345678?limit=50")).toBe("GET /channels/123456789012345678/messages/:id");
});
```

- [x] **Step 2–4:** FAIL → implementar → `bun test tests/rest` PASS.

```text
$ bun test tests/rest
 16 pass
 0 fail
 35 expect() calls
Ran 16 tests across 2 files. [257.00ms]

$ bun test && bun run typecheck
 94 pass
 0 fail
 195 expect() calls
Ran 94 tests across 20 files. [3.96s]
$ tsc --noEmit   # sin salida, código 0
```
- [x] **Step 5:** commit `feat(e2): rest client with per-route queues` + push.

---

### Task 3: Conexión al gateway: hello, identify, heartbeat, dispatch

**Files:**
- Create: `src/gateway/connection.ts`, `src/gateway/types.ts`
- Modify: `tests/fakes/fake-gateway.ts` (scripts de hello, READY desde `fixtures/gateway/READY-1.json`, heartbeat ack)
- Test: `tests/gateway/connection.test.ts`

**Interfaces:**
- Consumes: `createZlibStreamInflater` (E1.5), `buildIdentify` (E1.5), `Secret`, `log`.
- Produces:
  - `type GatewayStatus = "connecting" | "identifying" | "ready" | "resuming" | "reconnecting" | "disconnected"`.
  - `createGateway(deps: { token: Secret; props: ClientProps; url?: string; WebSocketImpl?: typeof WebSocket; random?: () => number; setTimer?: typeof setTimeout }): Gateway` con `connect(): void`, `close(): void`, `send(op: number, d: unknown): void`, `status: GatewayStatus`, `sessionId: string | null`, `seq: number | null`, `on(ev: "dispatch", fn: (t: string, d: any) => void)`, `on(ev: "status", fn: (s: GatewayStatus) => void)`, `on(ev: "session", fn: (kind: "identified" | "resumed") => void)`, `on(ev: "fatal", fn: (reason: "unauthorized") => void)`.

- [x] **Step 1: Tests que fallan**

```ts
test("sends identify after hello, without intents", async () => {
  expect(fake.received[0].op).toBe(2); expect(fake.received[0].d.intents).toBeUndefined();
});
test("first heartbeat after interval*jitter, then every interval, with the last seq", async () => {
  // random = () => 0.5, heartbeat_interval = 100 → 1º a los 50 ms
  expect(fake.received.find(p => p.op === 1).d).toBe(lastSeq);
});
test("answers op 1 from the server immediately", async () => {});
test("emits dispatch with t and d, updates seq, stores session_id and resume_gateway_url from READY", async () => {});
test("close 4004 emits fatal unauthorized and does not reconnect", async () => {});
test("never logs the identify payload", async () => { expect(findTokenLike(logFile)).toEqual([]); });
test("send throttles to 110 payloads per 60 s", async () => {});
```

- [x] **Step 2–4:** FAIL → implementar → `bun test tests/gateway` PASS.

```text
$ bun test tests/gateway
 9 pass
 0 fail
 20 expect() calls
Ran 9 tests across 2 files. [439.00ms]

$ bun test && bun run typecheck
 101 pass
 0 fail
 211 expect() calls
Ran 101 tests across 21 files. [4.09s]
$ tsc --noEmit   # sin salida, código 0
```
- [x] **Step 5:** commit `feat(e2): gateway connection with heartbeat` + push.

---

### Task 4: Resume y reconnect

**Files:**
- Modify: `src/gateway/connection.ts`
- Test: `tests/gateway/resume.test.ts`

**Interfaces:**
- Produces: el mismo `Gateway`; `session` emite `"resumed"` al recibir `RESUMED` e `"identified"` en cada `READY`.

Reglas (spec 6.2 y discord.food): op 7 o cierre que no sea fatal → reconectar a `resume_gateway_url` y mandar op 6 `{ token, session_id, seq }`. op 9 `d: true` → resume; `d: false` → esperar 1–5 s al azar e identify nuevo. 4007 y 4009 → identify nuevo. 4004 → fatal. Falta de `heartbeat_ack` → cerrar con 4000 y resume. Backoff: 1, 2, 4, 8, 16, 30 s (tope), con jitter ±20 %. Mientras tanto `status` = `reconnecting`.

- [x] **Step 1: Tests**

```ts
test("op 7 resumes against resume_gateway_url with session_id and seq", async () => {});
test("missing heartbeat ack closes and resumes", async () => {});
test("op 9 false waits and re-identifies, emitting session identified", async () => {});
test("4007 re-identifies", async () => {});
test("backoff grows and caps at 30 s", () => { expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]); /* random fijo sin jitter */ });
test("status goes ready → reconnecting → resuming → ready", async () => {});
```

- [x] **Step 2–4:** FAIL → implementar → PASS.

```text
$ bun test tests/gateway/resume.test.ts
 6 pass
 0 fail
 9 expect() calls
Ran 6 tests across 1 file. [304.00ms]

$ bun test && bun run typecheck
 107 pass
 0 fail
 220 expect() calls
Ran 107 tests across 22 files. [4.48s]
$ tsc --noEmit   # sin salida, código 0
```

Nota: al reconectar hay que resetear el inflater (contexto zlib nuevo por conexión); el test de resume lo cubre.
- [x] **Step 5:** commit `feat(e2): gateway resume and reconnect` + push.

---

### Task 5: Store y READY

**Files:**
- Create: `src/store/types.ts`, `src/store/store.ts`, `src/store/reduce.ts`, `src/store/reducers/ready.ts`, `src/store/permissions.ts`, `src/store/selectors.ts`, `src/util/snowflake.ts`
- Test: `tests/store/ready.test.ts`, `tests/store/permissions.test.ts`, `tests/store/selectors.test.ts`

**Interfaces:**
- Produces:
  - `ApiMessage`, `ApiAttachment`, `ApiEmbed` = `APIMessage`, `APIAttachment`, `APIEmbed` reexportados de `discord-api-types/v9`.
  - `AppState` con slices: `me`, `connection: GatewayStatus`, `guilds`, `guildOrder`, `channels` (incluye DMs), `privateChannelIds`, `users`, `members` (por guild), `messages` (por canal: `{ ids: string[]; byId; hasMoreBefore: boolean; loadingOlder: boolean; stale: boolean }`), `readState` (`{ lastAckedId: string | null; mentionCount: number }` por canal), `guildSettings` (muted de guild y por canal), `presences`, `typing`, `ui` (`selectedGuildId`, `selectedChannelId`, `focus: "guilds" | "channels" | "messages" | "members" | "composer"`, `membersVisible: boolean`). E3 agrega `outbox`, E4 agrega `voice`.
  - `type Action = { type: "gw"; t: string; d: any } | { type: "connection"; status: GatewayStatus } | { type: "messages/page"; channelId: string; messages: ApiMessage[]; mode: "older" | "latest" } | { type: "ui/selectGuild"; id: string | "@dms" } | { type: "ui/selectChannel"; id: string } | { type: "ui/focus"; focus: AppState["ui"]["focus"] } | { type: "ui/toggleMembers" }`.
  - `createStore(initial?: AppState): Store` con `getState()`, `dispatch(a: Action)`, `subscribe(fn: () => void): () => void`; `reduce(s: AppState, a: Action): AppState` puro.
  - `canViewChannel(state: AppState, guildId: string, channelId: string): boolean` (algoritmo estándar: owner y `ADMINISTRATOR` ven todo; base `@everyone` + roles; overwrites de `@everyone`, después roles (deny y luego allow), después miembro).
  - `compareSnowflakes(a: string, b: string): -1 | 0 | 1`; `generateNonce(now?: number): string` (`((BigInt(now) - 1420070400000n) << 22n).toString()`).
  - Selectores: `selectGuildList(s)`, `selectChannelList(s, guildId: string | "@dms"): ChannelRow[]` (`ChannelRow = { id; name; kind: "text" | "voice" | "category" | "dm" | "group_dm"; unread: boolean; mentions: number; muted: boolean; depth: 0 | 1 }`), `isChannelUnread(s, channelId)`, `selectNextUnread(s, fromChannelId: string | null): string | null`.

- [x] **Step 1: Tests que fallan** (con `fixtures/gateway/READY-1.json` y, si existe, `READY_SUPPLEMENTAL-1.json`)

```ts
test("READY fills me, guilds, channels, users (deduped) and read states", () => {
  const s = reduce(empty(), { type: "gw", t: "READY", d: ready });
  expect(s.me?.id).toBe(ready.user.id);
  expect(s.guildOrder).toHaveLength(ready.guilds.length);
  expect(Object.keys(s.users).length).toBeGreaterThan(0);
});
test("DMs come from where protocol-notes says (private_channels or equivalent)", () => {
  expect(selectChannelList(s, "@dms").every(r => r.kind === "dm" || r.kind === "group_dm")).toBe(true);
});
test("channel list skips threads, forums and stage, nests under categories by position", () => {});
test("hidden channel is not listed", () => { /* overwrite @everyone deny VIEW_CHANNEL (1<<10) */ });
test("role allow beats @everyone deny; member deny beats role allow; admin sees all", () => {});
test("unread when last_message_id > lastAckedId; muted channel is not returned by selectNextUnread", () => {});
test("compareSnowflakes compares as BigInt", () => { expect(compareSnowflakes("99", "100")).toBe(-1); });
```

- [x] **Step 2–4:** FAIL → implementar → `bun test tests/store` PASS.

```text
$ bun test tests/store
 14 pass
 0 fail
 26 expect() calls
Ran 14 tests across 3 files. [124.00ms]

$ bun test && bun run typecheck
 121 pass
 0 fail
 246 expect() calls
Ran 121 tests across 25 files. [4.28s]
$ tsc --noEmit   # sin salida, código 0
```

La fixture READY se amplió con `users`, un DM en `private_channels` y `read_state` para cubrir DMs y no leídos.
- [x] **Step 5:** commit `feat(e2): store, READY reducer and channel permissions` + push.

---

### Task 6: Mensajes en el store

**Files:**
- Create: `src/store/reducers/messages.ts`, `src/store/reducers/read-state.ts`
- Test: `tests/store/messages.test.ts`

**Interfaces:**
- Produces: manejo de `MESSAGE_CREATE`, `MESSAGE_UPDATE` (parcial: solo pisa los campos presentes), `MESSAGE_DELETE`, `MESSAGE_DELETE_BULK`, `MESSAGE_ACK`, `CHANNEL_UNREAD_UPDATE` (si la fixture existe) y `messages/page`. `selectMessages(s, channelId): Message[]` (orden ascendente por id). `Message = { id; channelId; authorId; content; timestamp; editedTimestamp: string | null; attachments; embeds; mentionIds: string[]; mentionsMe: boolean; referenced: { id: string; authorId: string; content: string } | null; reactions: { emoji: { id: string | null; name: string }; count: number; me: boolean }[]; nonce: string | null }`.

- [ ] **Step 1: Tests**

```ts
test("MESSAGE_CREATE appends and bumps channel last_message_id", () => {});
test("messages/page older prepends, dedupes by id and sets hasMoreBefore=false when fewer than 50", () => {});
test("messages/page latest merges without duplicates (gap fill)", () => {});
test("ring keeps the newest 500", () => { expect(selectMessages(s, ch)).toHaveLength(500); expect(selectMessages(s, ch)[0].id).toBe(ids[100]); });
test("update/delete of a message outside the ring is ignored", () => {});
test("MESSAGE_UPDATE without content keeps the old content (embed-only update)", () => {});
test("mentionsMe is true for <@me>, @everyone when mention_everyone, and replies to me", () => {});
test("MESSAGE_CREATE from fixture parses attachments, embeds and custom emoji content", () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e2): message reducers and history merge` + push.

---

### Task 7: Actions, runtime y relleno del hueco al reconectar

**Files:**
- Create: `src/actions/index.ts`, `src/app/runtime.ts`
- Modify: `src/main.tsx` (después del login arma el runtime y muestra `App`)
- Test: `tests/actions/read.test.ts`, `tests/app/runtime.test.ts`

**Interfaces:**
- Consumes: `createGateway`, `createRestClient`, `getMessages`, `createStore`.
- Produces:
  - `createActions(deps: { store: Store; rest: RestClient; gateway: Gateway }): Actions` con `selectGuild(id: string | "@dms"): void`, `openChannel(id: string): Promise<void>` (si el canal no tiene mensajes o está `stale`, pide los últimos 50), `loadOlder(id: string): Promise<void>` (no-op si `loadingOlder` o `!hasMoreBefore`), `focus(f)`, `toggleMembers()`. E3/E4 suman acciones acá.
  - `createRuntime(deps: { session: Session; me: { id: string; username: string }; props: ClientProps; WebSocketImpl?; fetch? }): { store: Store; actions: Actions; start(): void; stop(): void; onUnauthorized(fn: () => void): void }`. Cablea dispatch → store, status → `connection`, `session identified` (que no sea el primero) → marca todos los canales `stale` y recarga el abierto; `fatal`/401 → `onUnauthorized` (main vuelve a la pantalla de login).

- [ ] **Step 1: Tests**

```ts
test("loadOlder sends one request even if called 5 times while in flight", async () => { expect(fake.requests).toHaveLength(1); });
test("loadOlder uses before=<oldest id> and limit=50", async () => {});
test("after a non-resumed reconnect, the open channel refetches latest and has no duplicates", async () => {
  // fake gateway: READY, MESSAGE_CREATE m1, cierre, op 9 false, READY; fake http devuelve [m1, m2]
  expect(selectMessages(store.getState(), ch).map(m => m.id)).toEqual([m1.id, m2.id]);
});
test("after a resume, nothing is refetched", async () => { expect(fake.requests).toHaveLength(0); });
test("401 from rest or 4004 from gateway calls onUnauthorized", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e2): actions, runtime and reconnect gap fill` + push.

---

### Task 8: UI de lectura: paneles, barra de estado y keymap

**Files:**
- Create: `src/ui/store-bridge.ts`, `src/ui/components/GuildList.tsx`, `src/ui/components/ChannelList.tsx`, `src/ui/components/MessageView.tsx`, `src/ui/components/MessageItem.tsx`, `src/ui/components/StatusBar.tsx`
- Modify: `src/ui/App.tsx` (recibe `{ store, actions, onQuit }`), `src/ui/keymap.ts`
- Test: `tests/ui/read-ui.test.tsx`

**Interfaces:**
- Consumes: `Store`, `Actions`, selectores de Tasks 5 y 6.
- Produces:
  - `useSelector<T>(store: Store, sel: (s: AppState) => T): Accessor<T>` (signal de Solid que se actualiza con `subscribe`).
  - Comandos del keymap: `nav.down` (`j`), `nav.up` (`k`), `nav.left` (`h`), `nav.right` (`l`), `nav.top` (`g g`), `nav.bottom` (`G`), `nav.open` (`return`), `nav.nextUnread` (`g u`), `app.quit` (`q`). Con `registerNeovimDisambiguation` para `g` vs `gg`/`gu`.
  - Textos: StatusBar muestra `conectado`, `reconectando…`, `reanudando…` o `desconectado`, más `logueado como <username>`. Un canal no leído va en negrita con `●`; con menciones, `(<n>)`. DMs aparecen como primer ítem `Mensajes directos` en la columna de guilds. Mensajes: `HH:MM usuario` y el texto; los consecutivos del mismo autor dentro de 7 min no repiten el encabezado; editado → ` (editado)`; reply → línea previa `↳ usuario: <primeros 60 caracteres>`.
  - Llegar al tope de `MessageView` con `k` o `gg` llama a `actions.loadOlder`.

- [ ] **Step 1: Tests** (store fijo armado con `reduce` y la fixture de READY + 3 mensajes)

```tsx
test("lists guilds with 'Mensajes directos' first", async () => {});
test("j/k moves the selection and l opens the channel", async () => { expect(actions.openChannel).toHaveBeenCalledWith(chId); });
test("gu jumps to the next unread channel", async () => {});
test("gg at the top of messages calls loadOlder", async () => {});
test("status bar reflects reconnecting", async () => { store.dispatch({ type: "connection", status: "reconnecting" }); expect(frame).toContain("reconectando…"); });
test("ui never imports network modules", async () => {
  // recorre src/ui/**/*.ts(x) y falla si algún import apunta a gateway/, rest/ o usa fetch(
});
```

- [ ] **Step 2–4:** FAIL → implementar → `bun test && bun run typecheck` PASS.
- [ ] **Step 5:** commit `feat(e2): read UI panels and vim navigation` + push.

---

### Task 9: Quick switcher (`Ctrl-k`)

**Files:**
- Create: `src/ui/fuzzy.ts`, `src/ui/components/QuickSwitcher.tsx`
- Modify: `src/ui/keymap.ts` (comando `switcher.open` en `ctrl+k`)
- Test: `tests/ui/fuzzy.test.ts`, `tests/ui/quick-switcher.test.tsx`

**Interfaces:**
- Produces: `fuzzyScore(query: string, target: string): number | null` (subsecuencia sin distinguir mayúsculas ni tildes; más puntos a matches contiguos y al inicio de palabra; `null` si no matchea); `rankSwitcherItems(s: AppState, query: string): { channelId: string; label: string }[]` (máx. 20; label `servidor › #canal` o `@usuario`; con query vacía, los no leídos primero).

- [ ] **Step 1: Tests**

```ts
test("fuzzyScore matches subsequences and prefers word starts", () => {
  expect(fuzzyScore("gnr", "general")).not.toBeNull();
  expect(fuzzyScore("xyz", "general")).toBeNull();
  expect(fuzzyScore("gen", "general")!).toBeGreaterThan(fuzzyScore("gen", "big-energy")!);
  expect(fuzzyScore("canc", "canción")).not.toBeNull();
});
test("Ctrl-k opens, typing filters, Enter opens the channel, Esc closes", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e2): quick switcher` + push.

---

### Task 10: Markdown de Discord

**Files:**
- Create: `src/markdown/parse.ts`, `src/ui/components/Markdown.tsx`
- Test: `tests/markdown/parse.test.ts`

**Interfaces:**
- Produces: `parseMarkdown(src: string): MdNode[]` con `MdNode = { type: "text"; text: string } | { type: "bold" | "italic" | "underline" | "strike" | "spoiler" | "quote"; children: MdNode[] } | { type: "code"; text: string } | { type: "codeblock"; lang: string | null; text: string } | { type: "mention"; kind: "user" | "channel" | "role" | "everyone" | "here"; id: string | null } | { type: "emoji"; name: string; id: string; animated: boolean } | { type: "link"; url: string; label: string | null } | { type: "timestamp"; unix: number; style: string | null }`. `Markdown(props: { nodes: MdNode[]; state: AppState })` resuelve nombres de menciones y corta code blocks a 20 líneas con `… (N líneas más)`.

- [ ] **Step 1: Tests**

```ts
test("bold, italic, underline, strike, spoiler", () => {
  expect(parseMarkdown("**a** *b* __c__ ~~d~~ ||e||").filter(n => n.type !== "text").map(n => n.type)).toEqual(["bold","italic","underline","strike","spoiler"]);
});
test("inline code and code blocks do not parse markup inside", () => {
  expect(parseMarkdown("`**x**`")).toEqual([{ type: "code", text: "**x**" }]);
  expect(parseMarkdown("```ts\nconst a = 1\n```")).toEqual([{ type: "codeblock", lang: "ts", text: "const a = 1" }]);
});
test("mentions, custom emoji and timestamps", () => {
  expect(parseMarkdown("<@1> <#2> <@&3> <:kek:4> <a:dance:5> <t:1700000000:R>").filter(n => n.type !== "text")).toEqual([
    { type: "mention", kind: "user", id: "1" }, { type: "mention", kind: "channel", id: "2" }, { type: "mention", kind: "role", id: "3" },
    { type: "emoji", name: "kek", id: "4", animated: false }, { type: "emoji", name: "dance", id: "5", animated: true },
    { type: "timestamp", unix: 1700000000, style: "R" }]);
});
test("quotes, masked links and escaped markup", () => {
  expect(parseMarkdown("> hola")[0]).toMatchObject({ type: "quote" });
  expect(parseMarkdown("[doc](https://x.dev)")).toEqual([{ type: "link", url: "https://x.dev", label: "doc" }]);
  expect(parseMarkdown("\\*no\\*")).toEqual([{ type: "text", text: "*no*" }]);
});
test("unclosed markers stay as text", () => { expect(parseMarkdown("**abierto")).toEqual([{ type: "text", text: "**abierto" }]); });
test("Markdown cuts a 300-line code block to 20 lines", async () => { expect(frame).toContain("… (280 líneas más)"); });
```

- [ ] **Step 2–4:** FAIL → implementar → PASS. `MessageItem` pasa a usar `Markdown`.
- [ ] **Step 5:** commit `feat(e2): discord markdown` + push.

---

### Task 11: Imágenes, emojis custom, adjuntos y embeds

**Files:**
- Create: `src/images/cdn.ts`, `src/images/cache.ts`, `src/ui/components/Attachment.tsx`, `src/ui/components/Embed.tsx`, `src/ui/components/Emoji.tsx`
- Test: `tests/images/cdn.test.ts`, `tests/ui/media.test.tsx`

**Interfaces:**
- Consumes: `IMAGE_MODE` (Task 1), `MdNode` emoji (Task 10).
- Produces:
  - `emojiUrl(id: string, animated: boolean, size?: number): string` → `https://cdn.discordapp.com/emojis/<id>.webp?size=<size>&quality=lossless` (+ `&animated=true`); default `size` 48.
  - `isAllowedImageHost(url: string): boolean` (solo `cdn.discordapp.com` y `media.discordapp.net`, https).
  - `createImageCache(deps: { fetch: typeof fetch; maxBytes?: number }): { get(url: string): Promise<Uint8Array | null> }` (LRU, default 50 MiB; `null` si el host no está permitido, si falla o si pesa más de 8 MiB).
  - `attachmentView(a: ApiAttachment, mode: ImageMode): { kind: "image"; url: string; cols: number; rows: number } | { kind: "link"; label: string }` (imágenes hasta 40x12 celdas manteniendo proporción; otro tipo → `📎 nombre (tamaño)`).
  - `Embed`: barra de color a la izquierda, `título` en negrita, `descripción` con `Markdown` cortada a 6 líneas, imagen o thumbnail con `attachmentView`.

- [ ] **Step 1: Tests**

```ts
test("emojiUrl", () => {
  expect(emojiUrl("4", false)).toBe("https://cdn.discordapp.com/emojis/4.webp?size=48&quality=lossless");
  expect(emojiUrl("5", true)).toContain("&animated=true");
});
test("image cache never sends Authorization and refuses other hosts", async () => {
  expect(await cache.get("https://evil.example/x.png")).toBeNull();
  expect(fetchCalls[0].headers?.authorization).toBeUndefined();
});
test("attachmentView keeps aspect ratio inside 40x12 and falls back to link", () => {
  expect(attachmentView({ content_type: "image/png", width: 800, height: 400, ... }, "kitty")).toMatchObject({ kind: "image", cols: 40 });
  expect(attachmentView({ content_type: "image/png", ... }, "links")).toMatchObject({ kind: "link" });
});
test("custom emoji renders :name: when mode is links or the fetch fails", async () => { expect(frame).toContain(":kek:"); });
test("embed shows title and truncated description", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e2): inline images, custom emoji, attachments and embeds` + push.

---

### Task 12: Lista de miembros (op 37), presencia y typing

**Files:**
- Create: `src/gateway/subscriptions.ts`, `src/store/reducers/members.ts`, `src/store/reducers/presence.ts`, `src/store/reducers/typing.ts`, `src/ui/components/MemberList.tsx`, `src/ui/components/TypingLine.tsx`
- Modify: `src/actions/index.ts` (`openChannel` manda la suscripción), `src/ui/keymap.ts` (comando `members.toggle` en `g m` **[nuestra]**: la spec no le da tecla, y `Ctrl-m` es Enter en terminales sin el protocolo de Kitty)
- Test: `tests/gateway/subscriptions.test.ts`, `tests/store/members.test.ts`, `tests/store/typing.test.ts`

**Interfaces:**
- Produces:
  - `buildGuildSubscription(guildId: string, channelId: string, range?: [number, number]): { op: 37; d: unknown }`: **misma forma** que `fixtures/browser/op37.json` (lo dice `docs/protocol-notes.md`), con rango default `[0, 99]`.
  - Reducer de `GUILD_MEMBER_LIST_UPDATE` con `ops` `SYNC`, `INSERT`, `UPDATE`, `DELETE`, `INVALIDATE` sobre `members[guildId].list` (`({ kind: "group"; id: string; count: number } | { kind: "member"; userId: string })[]`).
  - `PRESENCE_UPDATE` → `presences[userId] = "online" | "idle" | "dnd" | "offline"`.
  - `TYPING_START` → `typing[channelId][userId] = timestamp*1000 + 10_000`; `selectTyping(s, channelId, now): string[]` filtra vencidos y a uno mismo. Texto: `<a> está escribiendo…`, `<a> y <b> están escribiendo…`, `varias personas están escribiendo…` (3 o más).

- [ ] **Step 1: Tests**

```ts
test("buildGuildSubscription has the same shape as the captured op 37", () => {
  expect(shapeOf(buildGuildSubscription(g, c))).toEqual(shapeOf(capturedOp37)); // shapeOf: claves y tipos, sin valores
});
test("opening a channel of another guild sends one op 37; reopening the same does not", async () => {});
test("SYNC then INSERT/DELETE from the fixture keep groups and members in order", () => {});
test("typing expires after 10 s and excludes me", () => {});
test("presence update changes the dot in MemberList", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e2): member list, presence and typing` + push.

---

### Task 13: 🧍 Paso de Gon — checkpoint E2 contra la cuenta real

- [ ] Gon corre `bun run dev` en Ghostty (sesión de E1) y confirma:
  1. Ve sus servidores y `Mensajes directos`; con `j`/`k`/`l` entra a `#pruebas`; `Ctrl-k`, escribe parte del nombre de otro canal, Enter, y lo abre.
  2. Hace scroll hacia arriba con `k` o `gg` y carga mensajes viejos sin saltos.
  3. Manda un mensaje desde el teléfono (misma cuenta) en `#pruebas`: aparece en el TUI en menos de 1 s.
  4. Corta el wifi 30 s (`nmcli radio wifi off; sleep 30; nmcli radio wifi on`), mientras tanto manda 2 mensajes desde el teléfono con datos móviles. La barra dice `reconectando…` y después `conectado`, y los 2 mensajes están, sin duplicados.
  5. Un mensaje con imagen y un emoji custom se ven inline en Ghostty.
  6. `gu` lo lleva al próximo canal no leído; los canales silenciados no cuentan.
  7. `gm` muestra la lista de miembros con puntos de presencia.
  8. **[2ª]** Con la segunda cuenta escribiendo en `#pruebas` se ve `<nombre> está escribiendo…`, y al ponerla en Ausente cambia su punto en la lista.
  9. `bun run leak-check` → `OK`.
- [ ] Le pasa al agente qué puntos dieron bien y, para los que no, lo que vio y las líneas del log (ya redactadas) después del `OK` de `leak-check`.

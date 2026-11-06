# discord-tui E3 (escribir): plan de implementación

> **Para el agente ejecutor (DeepSeek V4 Pro en dsh):** tarea por tarea, en orden. TDD: test que falla → mínimo código → verde. Antes de tildar un `- [ ]` corrés la verificación y pegás la salida. Al cerrar cada tarea: commit **y** `git push origin main`. Los **🧍 Paso de Gon** los hace Gon; frenás y esperás. Nunca leés el token ni `session.json`. Toda escritura que programes sale de una tecla del usuario: nada de envíos automáticos ni reintentos solos (spec 2, anti-objetivos).

**Goal:** escribir desde el TUI: mandar, responder, @mencionar con autocompletado, editar y borrar los propios, reaccionar, typing, ack, subir archivos (portapapeles o path) y notificaciones de escritorio, sin perder nunca un mensaje en silencio.

**Architecture:** una `outbox` en el store guarda cada envío con su `nonce` y estado `pending | sent | failed`; el `MESSAGE_CREATE` con el mismo nonce lo confirma. Las acciones nuevas viven en `actions/` y usan rutas nuevas de `rest/routes.ts`. Los subprocesos (`wl-paste`, `notify-send`) pasan por `proc/spawn.ts`, que arma un `env` con lista blanca.

**Tech Stack:** lo de E2. `wl-paste` y `notify-send` del sistema (instalados, spec 2 y 6.8).

**Spec:** `docs/superpowers/specs/2026-11-06-discord-tui-design.md` (2, 6.8, 7.5, 7.7, 7.8, 8, 9/E3).

## Global Constraints

- Las de E0–E2.
- Typing: como máximo un `POST /channels/{id}/typing` cada 8 s y solo mientras Gon escribe (spec 7.8).
- Ack: solo del canal que se está mirando, con debounce **[nuestra]** de 1.5 s; body con la forma de `fixtures/browser/ack.json` (spec 7.8: "Recomendación: mandarlo").
- Outbox: un 429 lo maneja `RestClient` esperando `retry_after`; cualquier otro error deja el mensaje `failed`, visible, y **solo** se reintenta con `R` (spec 2).
- Subprocesos: `Bun.spawn` con argumentos en array y `env: cleanEnv()`; nunca un string de shell, nunca el token (spec 6.8 y 8).
- Notificar solo si: mención, DM o reply a vos; el guild/canal no está silenciado en `user_guild_settings`; no es tu propio mensaje; y no estás mirando ese canal (spec 6.8).
- Subida: el flujo que muestra `fixtures/browser/upload-*.json` (anotado en `docs/protocol-notes.md`). El `PUT` al bucket de subida va **sin** `Authorization` ni `X-Super-Properties`.
- No-objetivos de la spec 2: nada de abrir DMs nuevos, stickers, hilos ni búsqueda.

## Review Focus

- Gon manda y en ese momento se corta la red: el mensaje queda `failed` con `✗ no se envió · R reintenta`, y `R` lo reintenta con el **mismo nonce** para que Discord no lo duplique si el primero sí llegó (Task 1).
- El `MESSAGE_CREATE` propio llega por el gateway **antes** de que termine el `POST`: se reconcilia por nonce y no queda un duplicado (Task 1).
- Mensaje de más de 2000 caracteres: no se manda; el composer muestra `<n>/2000 · el mensaje es muy largo` (por ejemplo `2001/2000`) y conserva el texto (Task 2).
- `wl-paste` sin imagen en el portapapeles (solo texto) o sin Wayland: `Ctrl-v` en el composer pega el texto como siempre y no muestra error (Task 7).
- `dd` sobre un mensaje ajeno o `e` sobre uno ajeno: no manda nada y muestra `solo podés editar o borrar tus mensajes` (Task 4).

---

### Task 1: Outbox y envío

**Files:**
- Create: `src/store/reducers/outbox.ts`, `src/actions/send.ts`
- Modify: `src/rest/routes.ts` (`postMessage`), `src/store/types.ts` (`outbox`), `src/store/reduce.ts`, `src/actions/index.ts`
- Test: `tests/actions/outbox.test.ts`

**Interfaces:**
- Consumes: `generateNonce` (E2 Task 5), `RestClient`, `createStore`.
- Produces:
  - `OutboxItem = { nonce: string; channelId: string; content: string; replyTo: string | null; attachments: PendingAttachment[]; state: "pending" | "sent" | "failed"; error: string | null; createdAt: number }`; `outbox: Record<string /*nonce*/, OutboxItem>`.
  - Acciones de store: `{ type: "outbox/enqueue"; item }`, `{ type: "outbox/sent"; nonce; messageId }`, `{ type: "outbox/failed"; nonce; error }`, `{ type: "outbox/retry"; nonce }`. `MESSAGE_CREATE` con `nonce` de la outbox lo pasa a `sent` y lo saca de la outbox.
  - `postMessage(rest, channelId, body: { content: string; nonce: string; tts: false; flags: 0; message_reference?: { message_id: string; channel_id: string; guild_id?: string }; allowed_mentions?: { parse: string[]; replied_user: boolean }; attachments?: unknown[] }): Promise<ApiMessage>`.
  - `actions.send(channelId: string, content: string, opts?: { replyTo?: string; attachments?: PendingAttachment[] }): Promise<void>`; `actions.retry(nonce: string): Promise<void>`.
  - `selectOutbox(s, channelId): OutboxItem[]`; `MessageView` muestra los `pending` atenuados y los `failed` con `✗ no se envió · R reintenta`.

- [ ] **Step 1: Tests que fallan** (contra `startFakeHttp`)

```ts
test("429 then 200: waits retry_after and ends sent with 2 requests", async () => {});
test("500: ends failed after exactly 1 request, no automatic retry", async () => {
  expect(item.state).toBe("failed"); await sleep(200); expect(fake.requests).toHaveLength(1);
});
test("network error ends failed with a visible error", async () => {});
test("retry resends with the same nonce", async () => { expect(bodies[0].nonce).toBe(bodies[1].nonce); });
test("gateway MESSAGE_CREATE with our nonce before the POST resolves leaves a single message", async () => {
  expect(selectMessages(s, ch).filter(m => m.nonce === nonce)).toHaveLength(1);
  expect(selectOutbox(s, ch)).toHaveLength(0);
});
test("failed item stays after other messages arrive", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → `bun test tests/actions` PASS.
- [ ] **Step 5:** commit `feat(e3): outbox with nonce reconciliation` + push.

---

### Task 2: Composer, modo insert y reply

**Files:**
- Create: `src/ui/components/Composer.tsx`, `src/ui/composer-state.ts`
- Modify: `src/ui/App.tsx`, `src/ui/keymap.ts`, `src/ui/components/MessageView.tsx` (selección de mensaje)
- Test: `tests/ui/composer.test.tsx`, `tests/ui/composer-state.test.ts`

**Interfaces:**
- Consumes: `actions.send`, `actions.retry`.
- Produces:
  - `ComposerState = { mode: "normal" | "insert"; text: string; replyTo: string | null; editing: string | null; attachments: PendingAttachment[]; mentions: { start: number; end: number; userId: string }[] }`, borradores por canal en memoria.
  - `validateOutgoing(text: string, attachments: number): { ok: true } | { ok: false; reason: "empty" | "too_long" }` (tope 2000 caracteres).
  - Comandos: `composer.insert` (`i`), `composer.normal` (`escape`), `composer.send` (`return` en insert), salto de línea con `shift+return` y `alt+return`, `message.reply` (`r` en normal, sobre el mensaje seleccionado), `outbox.retry` (`R` sobre un `failed`).
  - Reply: banner `respondiendo a <usuario> · Esc cancela`; el envío lleva `message_reference` y `allowed_mentions: { parse: ["users", "roles", "everyone"], replied_user: true }`.
  - Con el composer en insert, `q`, `j`, `k`, etc. escriben letras (la capa global no los toma).

- [ ] **Step 1: Tests**

```ts
test("validateOutgoing", () => {
  expect(validateOutgoing("", 0)).toEqual({ ok: false, reason: "empty" });
  expect(validateOutgoing("", 1)).toEqual({ ok: true });
  expect(validateOutgoing("x".repeat(2001), 0)).toEqual({ ok: false, reason: "too_long" });
});
```
```tsx
test("i, type, Enter sends and clears; q while typing types q", async () => { expect(send).toHaveBeenCalledWith(ch, "hola q", {}); });
test("r on a message shows the reply banner and sends message_reference", async () => {});
test("too long keeps the text and shows the counter", async () => { expect(frame).toContain("2001/2000"); });
test("draft survives switching channels", async () => {});
test("R on a failed item calls retry", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e3): composer, insert mode and replies` + push.

---

### Task 3: Autocompletado de @menciones

**Files:**
- Create: `src/ui/mentions.ts`, `src/ui/components/MentionPopup.tsx`
- Modify: `src/ui/components/Composer.tsx`
- Test: `tests/ui/mentions.test.ts`

**Interfaces:**
- Produces:
  - `mentionCandidates(s: AppState, channelId: string, query: string): { userId: string; label: string }[]` (máx. 8; fuentes: miembros ya cargados por op 37, autores de los mensajes del canal en el ring, destinatarios del DM. **No** pide miembros por op 8 ni op 35 **[nuestra]**, spec 7.8).
  - `serializeComposer(text: string, mentions: ComposerState["mentions"]): string`: cambia cada rango `@nombre` elegido del popup por `<@id>`; el `@algo` escrito a mano sin elegir queda como texto.
  - En insert, `@` + letras abre el popup; `tab` o `return` elige; `escape` lo cierra sin salir de insert.

- [ ] **Step 1: Tests**

```ts
test("candidates rank by fuzzyScore and include recent authors", () => {});
test("serializeComposer converts only picked mentions", () => {
  expect(serializeComposer("hola @gon y @nadie", [{ start: 5, end: 9, userId: "7" }])).toBe("hola <@7> y @nadie");
});
test("editing text before a mention shifts its range", () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e3): mention autocomplete` + push.

---

### Task 4: Editar y borrar los propios

**Files:**
- Create: `src/actions/edit.ts`, `src/ui/components/ConfirmBar.tsx`
- Modify: `src/rest/routes.ts` (`patchMessage`, `deleteMessage`), `src/ui/keymap.ts`, `src/ui/components/Composer.tsx`
- Test: `tests/actions/edit.test.ts`, `tests/ui/edit-delete.test.tsx`

**Interfaces:**
- Produces: `patchMessage(rest, channelId, messageId, body: { content: string }): Promise<ApiMessage>`; `deleteMessage(rest, channelId, messageId): Promise<void>`; `actions.edit(channelId, messageId, content): Promise<void>`; `actions.remove(channelId, messageId): Promise<void>`. Comandos `message.edit` (`e`) y `message.delete` (`d d`); `dd` muestra `¿Borrar este mensaje? y/n`. Si falla, `ConfirmBar` muestra `no se pudo <editar|borrar>: <status>` y el mensaje queda como estaba.

- [ ] **Step 1: Tests**

```ts
test("e on own message opens the composer with its content and Enter sends PATCH", async () => {});
test("e or dd on someone else's message sends nothing and shows the hint", async () => {
  expect(fake.requests).toHaveLength(0); expect(frame).toContain("solo podés editar o borrar tus mensajes");
});
test("dd then y sends DELETE; dd then n sends nothing", async () => {});
test("PATCH failure keeps the original content", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e3): edit and delete own messages` + push.

---

### Task 5: Reacciones

**Files:**
- Create: `src/emoji/common.ts`, `src/ui/components/EmojiPicker.tsx`, `src/actions/react.ts`, `src/store/reducers/reactions.ts`
- Modify: `src/rest/routes.ts` (`putReaction`, `deleteOwnReaction`), `src/ui/keymap.ts` (`message.react` en `+`)
- Test: `tests/actions/react.test.ts`, `tests/store/reactions.test.ts`

**Interfaces:**
- Produces:
  - `COMMON_EMOJI: { name: string; char: string }[]` (unos 60 de uso diario, a mano, con nombres en inglés tipo `thumbsup`, `heart`, `joy`) **[nuestra]**: sin dependencia de un catálogo entero.
  - `reactionPath(emoji: { id: string | null; name: string }): string` → unicode: `encodeURIComponent(name)`; custom: `encodeURIComponent(`${name}:${id}`)`.
  - `actions.toggleReaction(channelId, messageId, emoji)`: si ya reaccionaste con ese, `DELETE …/reactions/<e>/@me`; si no, `PUT`.
  - Reducer de `MESSAGE_REACTION_ADD`, `MESSAGE_REACTION_REMOVE`, `MESSAGE_REACTION_REMOVE_ALL`, `MESSAGE_REACTION_REMOVE_EMOJI` (con `me` cuando `user_id` es el propio).
  - Picker: lista filtrable (fuzzy) con los emojis custom del guild primero y después `COMMON_EMOJI`.

- [ ] **Step 1: Tests**

```ts
test("reactionPath", () => {
  expect(reactionPath({ id: null, name: "👍" })).toBe("%F0%9F%91%8D");
  expect(reactionPath({ id: "4", name: "kek" })).toBe("kek%3A4");
});
test("toggle sends PUT first time and DELETE when me is true", async () => {});
test("reaction add/remove update count and me", () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e3): reactions` + push.

---

### Task 6: Typing y ack

**Files:**
- Create: `src/actions/typing.ts`, `src/actions/ack.ts`
- Modify: `src/rest/routes.ts` (`postTyping`, `postAck`), `src/ui/components/Composer.tsx`, `src/app/runtime.ts`
- Test: `tests/actions/typing.test.ts`, `tests/actions/ack.test.ts`

**Interfaces:**
- Produces:
  - `createTypingNotifier(deps: { postTyping(channelId: string): Promise<void>; now: () => number }): { onKeystroke(channelId: string, textAfter: string): void; onSent(channelId: string): void }` (manda solo si `textAfter` no está vacío y pasaron ≥ 8000 ms desde el último en ese canal; `onSent` resetea).
  - `createAckScheduler(deps: { postAck(channelId: string, messageId: string): Promise<void>; setTimer?; debounceMs?: number }): { viewing(channelId: string | null, newestVisibleId: string | null): void }` (debounce 1500 ms; ackea solo el canal que se está mirando, solo si `newestVisibleId` es más nuevo que el `lastAckedId`; cambiar de canal antes de que venza cancela el pendiente).
  - `postAck(rest, channelId, messageId)` con el body de `fixtures/browser/ack.json`.

- [ ] **Step 1: Tests**

```ts
test("typing: 1 request for 20 keystrokes within 8 s, a 2nd after 8 s, none for empty text", () => {});
test("ack: debounced to one request, only for the viewed channel", () => {});
test("ack: leaving the channel before 1.5 s cancels it", () => {});
test("ack body has the captured shape", async () => { expect(shapeOf(body)).toEqual(shapeOf(capturedAckBody)); });
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e3): typing indicator and read acks` + push.

---

### Task 7: Subir archivos (portapapeles y path)

**Files:**
- Create: `src/proc/spawn.ts`, `src/uploads/clipboard.ts`, `src/uploads/file.ts`, `src/uploads/upload.ts`, `src/ui/components/AttachPrompt.tsx`
- Modify: `src/actions/send.ts` (adjuntos), `src/rest/routes.ts`, `src/ui/keymap.ts` (`attach.path` en `a`, `composer.paste` en `ctrl+v` dentro del composer)
- Test: `tests/proc/spawn.test.ts`, `tests/uploads/clipboard.test.ts`, `tests/uploads/upload.test.ts`

**Interfaces:**
- Produces:
  - `cleanEnv(src?: Record<string, string | undefined>): Record<string, string>`: solo `PATH`, `HOME`, `LANG`, `LC_ALL`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `WAYLAND_DISPLAY`, `PIPEWIRE_RUNTIME_DIR`, `PULSE_SERVER`. `spawnClean(cmd: string[], opts?: { stdin?: "pipe" | "ignore"; stdout?: "pipe" | "ignore" }): Subprocess`. E4 y E5 lo reusan.
  - `readClipboardImage(deps?: { spawn?: typeof spawnClean }): Promise<{ bytes: Uint8Array; mime: string; filename: string } | null>`: `wl-paste --list-types`, elige el primero de `image/png`, `image/jpeg`, `image/webp`, `image/gif`, y lo lee con `wl-paste --type <mime>`; filename `captura-<YYYYMMDD-HHMMSS>.<ext>`. `null` si no hay imagen o falla.
  - `readAttachmentFromPath(p: string): Promise<PendingAttachment>` (expande `~`; error `no existe`, `es una carpeta` o `pesa más de 10 MiB`) **[nuestra]**: 10 MiB es el límite de cuentas sin Nitro **[sin verificar]**; si Discord rechaza por tamaño se muestra el error que devuelva.
  - `PendingAttachment = { filename: string; mime: string; bytes: Uint8Array }`.
  - `uploadAttachments(rest: RestClient, fetchFn: typeof fetch, channelId: string, files: PendingAttachment[]): Promise<unknown[]>` que sigue el flujo de `docs/protocol-notes.md` y devuelve el array `attachments` para `postMessage`.
  - Composer: `📎 captura-….png (120 KB) · x quita`.

- [ ] **Step 1: Tests**

```ts
test("cleanEnv keeps only the allowlist", () => {
  expect(cleanEnv({ PATH: "/bin", DISCORD_TOKEN: fakeToken(), FOO: "1", WAYLAND_DISPLAY: "w" })).toEqual({ PATH: "/bin", WAYLAND_DISPLAY: "w" });
});
test("readClipboardImage picks png and returns null for text-only", async () => {
  // spawn falso: --list-types → "text/plain\nimage/png\n"; --type image/png → bytes
  expect(calls).toEqual([["wl-paste", "--list-types"], ["wl-paste", "--type", "image/png"]]);
});
test("upload PUT to the bucket has no Authorization nor X-Super-Properties", async () => {});
test("message is posted with the attachments returned by the upload step", async () => {});
test("Ctrl-v with no image pastes text normally", async () => {});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e3): file uploads from clipboard and path` + push.

---

### Task 8: Notificaciones de escritorio

**Files:**
- Create: `src/notify/notify.ts`
- Modify: `src/app/runtime.ts` (en cada `MESSAGE_CREATE`)
- Test: `tests/notify/notify.test.ts`

**Interfaces:**
- Consumes: `spawnClean` (Task 7).
- Produces: `shouldNotify(s: AppState, msg: Message, viewingChannelId: string | null): boolean`; `notify(title: string, body: string, deps?: { spawn?: typeof spawnClean }): void` → `["notify-send", "-a", "discord-tui", title, body]`. Título: `<usuario> en #canal (<servidor>)` o `<usuario> (DM)`; cuerpo: el texto plano del mensaje, máx. 200 caracteres.

- [ ] **Step 1: Tests**

```ts
test.each([
  ["mention in another channel", true], ["DM", true], ["reply to me", true],
  ["own message", false], ["muted guild", false], ["muted channel", false],
  ["viewing that channel", false], ["plain message, no mention", false],
])("shouldNotify: %s → %p", () => {});
test("notify spawns notify-send with an args array and clean env", () => {
  expect(call.cmd).toEqual(["notify-send", "-a", "discord-tui", "gon (DM)", "hola"]);
});
```

- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** commit `feat(e3): desktop notifications` + push.

---

### Task 9: 🧍 Paso de Gon — checkpoint E3 contra la cuenta real

En el servidor de prueba, con `bun run dev` en Ghostty y el teléfono al lado mirando `#pruebas`:

- [ ] 1. `i`, escribe "hola desde discord-tui", Enter → aparece en el teléfono.
- [ ] 2. `r` sobre un mensaje, responde → en el teléfono se ve como reply.
- [ ] 3. `i`, `@` + parte del nombre de la segunda cuenta (o de alguien del server), Tab, Enter → en el teléfono es una mención real (azul), no texto.
- [ ] 4. `e` sobre el propio, cambia el texto, Enter → el teléfono muestra "(editado)". `dd`, `y` → desaparece.
- [ ] 5. `+`, busca `thumbsup`, Enter → la reacción aparece en el teléfono; `+` y el mismo otra vez → se va.
- [ ] 6. **[2ª]** Mientras escribe en el TUI, la segunda cuenta ve "está escribiendo…" (si todavía no hay [2ª], se hace junto con el punto 10).
- [ ] 7. Abre en el TUI un canal con no leídos, espera 2 s → en el teléfono ese canal deja de figurar no leído.
- [ ] 8. Saca una captura (`Print` de Omarchy al portapapeles), en el composer `Ctrl-v`, Enter → la imagen llega. `a`, un path a un archivo chico, Enter → llega.
- [ ] 9. Corta el wifi, manda "sin red" → queda `✗ no se envió · R reintenta`. Vuelve el wifi, `R` → llega una sola vez.
- [ ] 10. **[2ª]** Desde la segunda cuenta, mencionar a Gon en `#pruebas` mientras el TUI mira otro canal → aparece la notificación de escritorio. Un mensaje sin mención no notifica.
- [ ] 11. `bun run leak-check` → `OK`.
- [ ] Le pasa al agente qué puntos dieron bien y, de los que no, lo que vio y el log redactado.

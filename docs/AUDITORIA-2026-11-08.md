# Auditoría de bugs — discord-tui

**Fecha:** 2026-11-08
**Base:** `main` @ `6178d1c` + cambios locales en curso (rebrand a `zcord`, splash); 704 tests, 114 archivos, `bun run typecheck` limpio
**Método:** revisión estática del código, del bundle del cliente web de Discord (para contrastar el READY real) y de las docs de discord.food. **No** ejecuté nada contra la cuenta real: no leí token ni sesión. No toqué los archivos con cambios locales de otra sesión.
**Alcance:** bugs de lógica/protocolo/recursos. Las features que faltan según los planes no están acá.

## Resumen

| # | Severidad | Área | Síntoma |
|---|---|---|---|
| B1 | Alta | auth | Un 401 en la sesión existente no vuelve al login: la app queda viva pero muerta |
| B2 | Alta | rate limits | Un 429 global avisado solo por headers se trata como límite de ruta |
| B3 | Baja | READY | Se ignora el `merged_members` del READY (solo tu member); se depende del supplemental |
| B4 | Alta | voz | Si un moderador te mueve de canal, la sesión de voz sigue en el canal viejo |
| B22 | Alta | read state | `read_state` y `user_guild_settings` llegan versionados y no se parsean: todo queda sin leer y los mutes se ignoran |
| B5 | Alta | HTTP | Sin timeout: un request colgado bloquea la cola de esa ruta para siempre |
| B6 | Media | navegación | `selectGuild` pide el historial del primer canal en cada `j`/`k` de guilds |
| B7 | Media | memoria | `applyPage` no poda `byId`: los mensajes viejos nunca se liberan |
| B8 | Media | unread | Faltan las automatizaciones de read state: menciones y mensajes propios |
| B9 | Media | perf | Un `writeSync` por cada dispatch del gateway + log sin rotación |
| B10 | Media | settings | Salir antes de 500 ms pierde el último cambio de settings |
| B11 | Media | audio | Volumen por usuario en 0 no se guarda (vuelve a 100 %) |
| B12 | Media | notificaciones | `notify-send` puede tirar excepción fuera del try del dispatch |
| B13 | Baja | diagnóstico | Quedó el log `ready.shape` en producción |
| B14 | Baja | uploads | Reintentar un mensaje con adjuntos los sube de nuevo |
| B15 | Baja | REST | El mapa de colas por ruta crece para siempre |
| B16 | Baja | gateway | Timers de throttle pueden mandar payloads viejos en un socket nuevo |
| B17 | Baja | imágenes | Baja el cuerpo entero antes de chequear el límite de 8 MB |
| B18 | Baja | presencia | `op 3` puede salir antes del READY (no hay gate `ready`) |
| B19 | Baja | notificaciones | Grupos DM titulados "(DM)"; el mute de DMs depende de un shape dudoso |
| B20 | Baja | UX | `l` en el foco de mensajes no hace nada; `Esc` salta al fondo desde cualquier foco |
| B21 | Media | unread | El ack manda `token: null` y `last_viewed: 0` siempre |

---

## B1 — Un 401 con sesión existente no vuelve al login

**Dónde:** `src/main.tsx:146-161` (arranque con sesión guardada) vs. `src/main.tsx:46-49` (login).

**Qué pasa:** en el flujo de login se registra `runtime.onUnauthorized(...)` para parar el runtime y volver a `LoginScreen`. En el arranque con sesión ya guardada (`result.kind === "main"` u `"offline"`) se crea el runtime y se renderiza `App`, pero **nunca se registra** ese handler. `createRuntime` arma el `RestClient` con `onUnauthorized: notifyUnauthorized`, y ese set queda vacío.

**Por qué importa:** si el token se revoca/cambia la contraseña, el REST se cierra (`closed = true`), todas las llamadas tiran `UnauthorizedError`, y la app se queda mostrando datos viejos sin ninguna salida. Tampoco hay aviso: los `catch` de la UI se lo comen.

**Cómo verificar:** en `main.tsx` no existe ninguna llamada a `runtime.onUnauthorized` fuera de `LoginRoot`; `grep -n onUnauthorized src/main.tsx` solo da la línea 46.

**Arreglo propuesto:** registrar el handler también en el camino de sesión existente (parar runtime, borrar sesión y volver a montar `LoginRoot`), o mejor: mover la creación del runtime a un componente raíz único que siempre registre `onUnauthorized`.

---

## B2 — 429 global solo por headers

**Dónde:** `src/rest/http.ts:82-87`.

**Qué pasa:** el flag global sale únicamente de `parsed?.global === true` (body). Para cuentas de usuario la doc dice que *usualmente* solo llegan `Retry-After`, `X-RateLimit-Global` y `X-RateLimit-Scope` (sin el body completo). El código lee `x-ratelimit-scope` para `scope`, pero **no** usa `x-ratelimit-global` ni `scope === "global"` para decidir `global`.

**Por qué importa:** un 429 global se trata como límite de ruta; las demás rutas siguen pegándole a Discord durante la ventana global. Es la forma más rápida de comer otro 429 o un castigo más largo.

**Cómo verificar:** `RateLimitedError` se construye con `parsed?.global === true`; no hay ninguna lectura de `x-ratelimit-global`.

**Arreglo propuesto:**

```ts
const global =
  parsed?.global === true ||
  response.headers.get("x-ratelimit-global") === "true" ||
  scope === "global";
```

Y de paso: si `retry_after` y `Retry-After` faltan o no son numéricos, `Math.max(0, NaN)` da `NaN` y el sleep es 0 (reintento caliente). Usar un default de 1 s.

---

## B3 — El `merged_members` del READY se ignora (hoy solo trae tu member)

**Dónde:** `src/store/reducers/ready.ts:101-146` (recorre `rawGuild.members`), `src/store/reducers/voice.ts:59-81` (lo usa solo en READY_SUPPLEMENTAL), `src/gateway/identify.ts:4`.

**Qué pasa:** con `DEDUPE_USER_OBJECTS` (1<<4) los miembros de cada guild llegan colapsados en el top-level `merged_members` y `guild.members` no viene. Con `PRIORITIZED_READY_PAYLOAD` (1<<5) —ambas están en `1734653`— el `merged_members` del **READY** trae **solo tu propio member** por guild; el resto llega en `READY_SUPPLEMENTAL`, que sí parseamos (`applySupplementalMembers`).

**Por qué importa (bajo):** el flujo normal funciona porque el supplemental llega enseguida. Pero:
- Ignoramos el member propio del READY, que es la única fuente inmediata para calcular permisos al primer render: hasta que llega el supplemental (o el op 37), `me` no tiene roles y `canViewChannel` usa solo `@everyone`, así que canales con `VIEW_CHANNEL` por rol pueden aparecer/desaparecer.
- Si un día el supplemental se atrasa, se pierde o cambia de orden, los miembros quedan vacíos.

**Arreglo propuesto:** aplicar `d.merged_members[index]` también en `applyReady` (es barato y cubre el member propio), y mantener el parseo del supplemental como está.

## B4 — Mover de canal en voz no se propaga a la sesión de voz

**Dónde:** `src/actions/voice.ts:283-307` (detecta el move), `src/store/reducers/voice.ts:143-144`, `src/voice/session.ts:150-200` (manejo de 4014).

**Qué pasa:** cuando un moderador te mueve, `VOICE_STATE_UPDATE` cambia tu `channelId`. El subscriber de `voice.ts` hace:

```ts
store.dispatch({ type: "voice/moved", channelId: mine.channelId });
```

Eso actualiza la UI (`voice.channelId`), pero **no** toca `voiceSession`: la conexión de voz sigue con el `joinConfig.channelId` viejo y `wantedFlags` viejos. El código de la sesión, ante un cierre 4014 (típico de "te movieron"), reintenta/rejoinea con el canal viejo.

**Por qué importa:** después de un move, el audio puede seguir en el canal anterior (o moverte de vuelta), el `guildId` de la UI no se actualiza, y el Go Live sigue atado al canal viejo.

**Cómo verificar:** `grep -n "voice/moved" -A2` muestra que solo hay dispatch; no hay `session.join/leave` en ese camino.

**Arreglo propuesto:** en el subscriber, si `mine.channelId !== v.channelId` y cambia de canal (mismo guild), hacer `serial(() => session.join(v.guildId, mine.channelId, flagsActuales))` (o `leave` + `join`) y actualizar también `guildId` en el reducer si cambia de guild. Si el move llega mientras `status === "joining"`, encolarlo.

---

## B5 — Sin timeout de HTTP

**Dónde:** `src/rest/http.ts:49-55`.

**Qué pasa:** `doFetch(url, { method, headers, body })` no lleva `signal`. Si la conexión queda en negro (wifi que se corta sin RST, VPN, etc.), la promesa no resuelve nunca. La cola por ruta (`rest/client.ts:78-89`) encadena las siguientes llamadas a esa promesa: **toda** la ruta queda trabada. La UI no muestra error porque nunca hay excepción.

**Por qué importa:** un solo request colgado deja sin cargar mensajes/canales hasta reiniciar la app.

**Arreglo propuesto:** `signal: AbortSignal.timeout(30_000)` (o configurable), mapear `AbortError`/`TimeoutError` a `NetworkError` y dejar que la cola siga. Ojo: subidas (PUT a googleapis) usan otro `fetch`, también conviene.

---

## B6 — `selectGuild` pide historial en cada movimiento de guild

**Dónde:** `src/actions/index.ts:246-252`.

**Qué pasa:** `selectGuild` despacha `ui/selectGuild` y **siempre** busca el primer canal de texto/DM y llama `openChannel(first.id)`, que hace `GET /channels/{id}/messages?limit=50`. Pasar con `j`/`k` por 10 servidores dispara 10 requests de historial (y sus correspondientes entradas de rate limit), aunque el usuario no haya abierto nada.

**Por qué importa:** ruido de rate limit y latencia; con muchos guilds se nota.

**Arreglo propuesto:** no abrir canal en `selectGuild`; abrir recién en `openSelected`/Enter (o al entrar al foco de canales). Si se quiere preview, hacerlo con debounce y solo si el usuario se detiene.

---

## B7 — `applyPage` no poda `byId`

**Dónde:** `src/store/reducers/messages.ts:150-170` (y comparar con `appendMessage`, `:53-65`, que sí reconstruye `byId`).

**Qué pasa:** `applyPage` arma `byId` con lo previo + lo nuevo, ordena `ids` y recorta a `RING_SIZE = 500`, pero **deja `byId` con todos los mensajes que pasaron alguna vez**. `appendMessage` sí recorta `byId`, pero la paginación (historial, gaps) no.

**Por qué importa:** una sesión larga navegando canales acumula mensajes completos (con embeds/adjuntos) en memoria sin techo. En un cliente TUI que puede quedar días abierto es una fuga real.

**Arreglo propuesto:** después de calcular `trimmed`, reconstruir `byId` solo con esos ids (como `appendMessage`), o borrar las claves que quedaron fuera.

---

## B8 — Faltan las automatizaciones de read state (menciones y mensajes propios)

**Dónde:** `src/store/reduce.ts:47-60` (MESSAGE_CREATE), `src/store/reducers/read-state.ts:1-13`, `src/store/selectors.ts:77` (badge = `readState[channel].mentionCount`).

**Qué pasa:** la doc de [read state](https://docs.discord.food/topics/read-state#channel-read-state-automations) dice que el cliente **debe** mantener esto solo:

1. `MESSAGE_CREATE` que menciona al usuario (en guild) o llega a un DM no silenciado → `mention_count += 1`.
2. `MESSAGE_CREATE` propio → `last_message_id = id` del mensaje propio y `mention_count = 0`.
3. También cuenta role mentions / `@everyone` según notification settings.

Nada de eso está implementado: el único incremento de `mentionCount` viene del `READY.read_state` (que encima hoy se pierde, ver B22) o de `CHANNEL_UNREAD_UPDATE`, y el único "ack" es el debounce del canal abierto.

**Por qué importa:**
- El badge de menciones de un canal que no estás mirando queda viejo hasta reconectar.
- **Tus propios mensajes dejan el canal como no leído**: `withLastMessage` actualiza `channels[id].lastMessageId` con tu mensaje, pero el read state no se mueve. Si mandás y enseguida cambiás de canal, aparece el puntito de no leído por tu propio mensaje.

**Cómo verificar:** un test que aplique `MESSAGE_CREATE` con `mentionsMe` da `mentionCount === 0`; otro con autor = `me` deja `lastAckedId` atrás del propio mensaje.

**Arreglo propuesto:** en el reducer de `MESSAGE_CREATE`:
- si `author.id === me.id` → `readState[channel] = { lastAckedId: id, mentionCount: 0 }`;
- si no, y `mentionsMe` (o DM no silenciado) → `mentionCount + 1`;
- el ack real sigue reseteando.

---

## B21 — El ack no guarda el token ni calcula `last_viewed`

**Dónde:** `src/rest/routes.ts:35-37` (`postAck`), `src/actions/ack.ts:35`.

**Qué pasa:** el body del ack es siempre `{ token: null, last_viewed: 0 }` y se ignora la respuesta. La doc de [ack tokens](https://docs.discord.food/topics/read-state#ack-tokens) dice que el cliente debe guardar el `token` que devuelve el servidor y mandarlo en el próximo ack (y resetearlo a `null` al cambiar de cuenta). Además `last_viewed` son los días desde la época de Discord **al momento de ver el canal**; mandar `0` explícito lo pisa (si se omite, el server conserva el valor actual).

**Por qué importa:** cada ack se identifica como cliente nuevo, y `last_viewed = 0` puede romper el estado de "visto" que usan otros dispositivos / el mobile. Discord igual guarda el read state, pero no es el protocolo correcto.

**Cómo verificar:** `postAck` no devuelve ni usa el `token` de la respuesta; no hay ningún `lastViewed` calculado con `Date.now()` y la época.

**Arreglo propuesto:** que `postAck` devuelva `{ token }` y el scheduler guarde el token por canal (o global); mandar `last_viewed` calculado (`Math.floor((Date.now() - 1420070400000) / 86400000)`) solo si cambió, y `flags` calculado (IS_GUILD_CHANNEL / IS_THREAD) antes de ackear.

---

## B22 — `read_state` y `user_guild_settings` versionados no se parsean

**Dónde:** `src/store/reducers/ready.ts:155-174` (los lee con `asList`), `src/gateway/identify.ts:4` (`GATEWAY_CAPABILITIES = 1734653`).

**Qué pasa:** `1734653` tiene prendidos `VERSIONED_READ_STATES` (1<<2 = 4) y `VERSIONED_USER_GUILD_SETTINGS` (1<<3 = 8). Según la [tabla de capabilities](https://docs.discord.food/gateway/using-gateway#list-of-capabilities), con esas flags `read_state` y `user_guild_settings` del READY ya no son arrays: son una [versioned structure](https://docs.discord.food/gateway/gateway-events#versioned-structure) `{ entries: [...], partial: boolean, version: integer }`.

`asList` no conoce ese shape: al ver el objeto itera sus claves y arma basura:

```ts
asList({ entries: [...], partial: false, version: 3 }, "id")
// => [{id:"entries"}, {id:"partial"}, {id:"version"}]   // pierde todos los entries
```

**Por qué importa (alto):**
- **Read states perdidos:** `readState` queda con tres entradas basura; ningún canal tiene `lastAckedId` → `isChannelUnread` da true para todo canal con `lastMessageId`. Es exactamente el patrón de "todos los canales con puntito" que se ve al abrir la app.
- **Mutes y notification settings perdidos:** `guildSettings.mutedGuilds/mutedChannels` quedan vacíos → notificás guilds/canales silenciados.
- `mention_count` de READY también se pierde (se suma a lo de B8).

**Cómo verificar:** `(1734653 & 4) === 4` y `(1734653 & 8) === 8` (bits de ambas capabilities); un READY sintético con `read_state: { entries: [...], partial: false, version: 1 }` deja `state.readState` sin las entradas reales. Es el patrón de "todos los canales con puntito" de la captura.

**Arreglo propuesto:** helper para versioned:

```ts
function entriesOf(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  const record = value as { entries?: unknown } | null;
  if (record && Array.isArray(record.entries)) return record.entries;
  return asList(value, "id"); // fallback para mapas viejos
}
```

y usarlo en `read_state`, `user_guild_settings` (y revisar `guild_join_requests`, `notification_settings` si vienen versionados). Idealmente, un test que aplique el shape real.

---

## B9 — Un `writeSync` por dispatch + log sin rotación

**Dónde:** `src/gateway/connection.ts:148-150` (`log.info("gateway.dispatch", ...)` para **cada** dispatch), `src/log/logger.ts:50-60` (`writeSync`).

**Qué pasa:** cada `MESSAGE_CREATE`, `TYPING_START`, `PRESENCE_UPDATE`, `VOICE_STATE_UPDATE`, `GUILD_MEMBER_LIST_UPDATE`… escribe una línea al archivo de log de forma **sincrónica** en el hilo principal. En un guild grande con presencias/typing eso es decenas de escrituras por segundo bloqueando el event loop (y el render). Además el archivo crece sin límite: no hay rotación ni tamaño máximo.

**Por qué importa:** jank perceptible y un log que en días puede ser enorme (y `leak-check` lo escanea entero).

**Arreglo propuesto:** no loguear cada dispatch (o solo a nivel debug detrás de env var); escribir con buffer asíncrono (`appendFile` con cola) o al menos no `writeSync` por evento; rotar por tamaño (p. ej. 10 MB → `.1`).

---

## B10 — Salir antes de 500 ms pierde el último cambio de settings

**Dónde:** `src/settings/persist.ts:30-36`, usado por `runtime.stop()` (`src/app/runtime.ts:230`).

**Qué pasa:** `attachSettingsPersistence` guarda con debounce de 500 ms; la función de detach hace `clearTimeout(timer)` y **no** flushea. `runtime.stop()` la llama al salir.

**Por qué importa:** cambiás volumen/tema/tamaño y cerrás rápido → el cambio no queda en disco.

**Arreglo propuesto:** en el detach, si hay un save pendiente, ejecutarlo (o devolver una promesa `flush()` que `runtime.stop()` espere).

---

## B11 — Volumen por usuario 0 no se guarda

**Dónde:** `src/settings/settings.ts:90-99` (`parseVolumes`), UI en `src/ui/App.tsx:355-361`.

**Qué pasa:** la UI permite bajar a 0 % (`Math.max(0, ...)`) y lo escribe en `settings.userVolumes[userId] = 0`. Al cargar, `parseVolumes` hace:

```ts
if (volume === MIN_VOLUME && raw <= MIN_VOLUME) continue;
```

Es decir, descarta la entrada 0 y el usuario vuelve a sonar al 100 %.

**Por qué importa:** silenciar a alguien no persiste entre sesiones.

**Arreglo propuesto:** guardar el 0 tal cual (o representar "sin entrada" como ausencia y no como 0, y que la UI use un mínimo de 1 si el 0 es ambiguo).

---

## B12 — `notify-send` puede tirar afuera del try del dispatch

**Dónde:** `src/notify/notify.ts:31-34`, llamado desde `src/app/runtime.ts:160-166` **fuera** del `try` que protege `store.dispatch`.

**Qué pasa:** `spawnClean` usa `Bun.spawn`; si `notify-send` no existe (o el entorno no lo permite) tira sincrónicamente. Esa excepción sale del listener de dispatch, dentro del callback del WebSocket. También el hijo no se espera ni se maneja su salida.

**Por qué importa:** un fallo de notificación no debería romper el manejo de un evento del gateway; en el peor caso tira el callback y se pierde el resto del dispatch.

**Arreglo propuesto:** `try { spawn(...) } catch { log.warn("notify.failed", {...}) }` y, si se quiere, `.exited.catch(() => {})`.

---

## B13 — Quedó el log de diagnóstico `ready.shape`

**Dónde:** `src/app/runtime.ts:132-146`.

**Qué pasa:** en cada READY se loguea un JSON con `dKeys`, `guildKeys`, `channelKeys`, tipos y si hay `name`. Fue útil para el bug de los nombres, pero quedó en producción.

**Por qué importa:** ruido y una foto de la estructura del payload (nombres de campos, no valores) en cada arranque.

**Arreglo propuesto:** borrarlo o condicionarlo a `process.env.DISCORD_TUI_DEBUG`.

---

## B14 — Reintentar un mensaje con adjuntos los sube de nuevo

**Dónde:** `src/actions/send.ts:26-46`.

**Qué pasa:** `deliver(item)` llama `deps.upload(channelId, attachments)` **cada vez**. `retry(nonce)` vuelve a llamar `deliver` con el mismo item. Si el POST falló después de subir, el reintento sube los archivos otra vez (slots nuevos, archivos huérfanos en el CDN) y arma otro `uploaded_filename`.

**Por qué importa:** adjuntos duplicados/huérfanos y más tráfico; el mensaje igual no se duplica (mismo nonce), pero la subida sí.

**Arreglo propuesto:** cachear los slots subidos en el `OutboxItem` (`uploaded?: UploadedAttachment[]`) y reusarlos en el reintento.

---

## B15 — El mapa de colas de REST crece para siempre

**Dónde:** `src/rest/client.ts:36` (`const queues = new Map()`) y `:78-89`.

**Qué pasa:** cada `routeKey` distinto queda en el mapa con una promesa ya resuelta. No se borra nunca.

**Por qué importa:** un proceso de días con muchas rutas (canales/guilds) acumula entradas; es chico pero innecesario.

**Arreglo propuesto:** borrar la entrada cuando la cola queda vacía (comparar identidad) o usar un límite LRU.

---

## B16 — Timers del throttle del gateway pueden mandar en el socket nuevo

**Dónde:** `src/gateway/connection.ts:84-97`.

**Qué pasa:** al superar `110` envíos/60 s, el payload se reprograma con `setTimer` y el callback hace `rawSend(...)`, que usa el `socket` **actual** en ese momento. Si en el medio hubo reconexión, el payload viejo (p. ej. un op 37 de la sesión anterior, o un heartbeat con `d` viejo) sale por el socket nuevo.

**Por qué importa:** payloads fuera de contexto en la sesión nueva; en el mejor caso se ignora, en el peor confunde el estado.

**Arreglo propuesto:** capturar `const ws = socket` en `send` y mandar solo si `ws === socket`; o descartar los pendientes al cerrar el socket.

---

## B17 — La caché de imágenes baja el cuerpo entero antes de chequear el límite

**Dónde:** `src/images/cache.ts:30-40`.

**Qué pasa:** hace `await response.arrayBuffer()` y **después** chequea `bytes.byteLength > MAX_IMAGE_BYTES (8 MB)`. Una imagen de 200 MB se descarga completa en memoria para después descartarla.

**Por qué importa:** pico de memoria en una TUI; un adjunto grande puede colgar/ matar el proceso.

**Arreglo propuesto:** mirar `Content-Length` antes de leer, y si no está, leer por stream con tope y abortar al pasarse.

---

## B18 — `op 3` (presencia) puede salir antes del READY

**Dónde:** `src/app/runtime.ts:89-92` crea `createIdlePresence({ gateway, settings })` sin `ready`; en `src/actions/presence.ts:39` el default es `() => true`.

**Qué pasa:** si el usuario cambia de estado en settings apenas arranca (o algo llama `statusChanged`) antes de que llegue el READY, se manda `op 3` antes del identify. Discord no espera ese op ahí; puede rechazar/cerrar o ignorarlo.

**Por qué importa:** condición de carrera de arranque que puede cortar la conexión.

**Arreglo propuesto:** pasar `ready: () => gateway.status === "ready"` (el runtime ya tiene el gateway) y, si no está listo, no mandar (el identify ya lleva `current()`).

---

## B19 — Notificaciones: grupos DM y mutes de DM

**Dónde:** `src/notify/notify.ts:18-22` y `src/notify/notify.ts:7-15`.

**Qué pasa:**
- Para un grupo DM (`type 3`, `guildId === null`) el título es `"<autor> (DM)"`, sin el nombre del grupo.
- `isChannelMuted` mira `guildSettings.mutedChannels`, que se llena desde `user_guild_settings[].channel_overrides` (`ready.ts:165-174`). El mute de un DM en Discord no viene en ese shape para cuentas de usuario (suele estar en las entradas de settings), así que un DM silenciado puede seguir notificando.

**Por qué importa:** notificaciones de conversaciones que el usuario silenció.

**Arreglo propuesto:** usar `channel.name`/`ownName` para el título de grupos; verificar el shape real de mutes de DM (hay que capturarlo) y contemplarlo en `isChannelMuted`.

---

## B20 — Inconsistencias chicas de teclado

**Dónde:** `src/ui/App.tsx:964-968` (caso `l`) y `:934-937` (`Esc` en modo normal).

**Qué pasa:**
- En el foco de mensajes, `l` no hace nada (el caso solo contempla `channels` y `guilds`); `h` sí vuelve a canales.
- `Esc` en modo normal hace `toBottom()` (salta al fondo del historial) desde cualquier foco, incluso en la lista de guilds.

**Por qué importa:** choca con la expectativa vim (`l` = entrar) y con "Esc cancela".

**Arreglo propuesto:** en `messages`, `l` podría abrir el hilo/enfocar el composer; `Esc` solo debería hacer `toBottom` cuando el foco es `messages`.

---

## Riesgos que no puedo confirmar sin la cuenta real

1. **Voice (DAVE / @discordjs/voice):** no hay forma de validar el handshake DAVE, el jitter buffer ni el manejo de 4014 sin una llamada real. B4 es el caso de move; el resto depende de pruebas de Gon.
2. **Go Live:** usa un paquete de terceros (`@dank074/discord-video-stream`), `wf-recorder`/`gstreamer` y encoders; los caminos de error/cleanup están, pero no se pueden confirmar sin transmitir.
3. **Fixtures sintéticos:** los bugs B3 y B22 muestran que los tests no cubren el shape real del READY (versioned arrays, `merged_members`, `merged_presences`). Conviene un fixture real redactado (el README de fixtures ya tiene el proceso) para READY, READY_SUPPLEMENTAL y op 37.
4. **Status proto (`PATCH /users/@me/settings-proto/1`):** está documentado como **[nuestra]** interpretación; un error de encoding puede pisar el estado personalizado de la cuenta. Los tests cubren ida/vuelta, pero no el servidor real.

## Lo que revisé y está bien

- No hay token en logs: el logger filtra por allowlist y redacta patrones; el HTTP solo manda `Authorization` a discord.com/127.0.0.1/localhost.
- Sesión atómica 0600/0700 y `SessionPermissionError` en boot.
- Reconexión del gateway: guard contra doble timer, `dropSocket` + resume/identify, inflater reseteado por socket, heartbeat con ack y cierre 4000.
- REST: cola por ruta, presupuesto de 3 reintentos por 429, 401 cierra y corta llamadas nuevas.
- Composer: cursor por canal, borradores, mentions, adjuntos y prompts; la lógica de `printable` filtra ctrl/meta y acepta AltGr.
- Outbox: nonce, reconciliación por `MESSAGE_CREATE`/`outbox/sent`, estado failed visible.
- Voz: cleanup de procesos en `stop()` con timeouts, mic/playback con avisos, refresh de pw-cat por drift, PTT hold/toggle según Kitty.
- Go Live: se corta solo al salir de voz (subscriber de store), abort controller, timeout de `createStream`.

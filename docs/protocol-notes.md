# Notas de protocolo

Datos que el agente resuelve y documenta mientras construye. Sin tokens ni ids reales.

## client_build_number

- Fecha: 2026-11-06.
- Método que anduvo: el número viene en el propio HTML de `https://discord.com/app`, dentro del objeto inline `window.GLOBAL_ENV` (`"BUILD_NUMBER":"663810"`). Un solo GET alcanza; no hace falta bajar los assets `.js`.
- Spike: `bun scripts/spike-build-number.ts` imprime `663810` en ~0,3 s (límite: 10 s). Pass.
- Regex: `build(?:Number|_number)["']?\s*[:=]\s*["']?(\d{5,7})` (case-insensitive), aplicado al HTML y, de respaldo, a los `/assets/*.js`.
- Plan B: si el HTML deja de traerlo, se escanean los `<script src="/assets/…js">`; si tampoco, se usa el `cached` de `session.json` y al final `FALLBACK_BUILD_NUMBER`.
- `FALLBACK_BUILD_NUMBER`: 663810. En E1.5 se reemplaza por el número de la captura de Gon si difiere.
- Nota: el plan original hablaba de buscar solo en los assets; en la realidad el dato está en el HTML. Por eso el spike mira el HTML primero y los assets como respaldo (spec 6.4 deja el método exacto a cargo del builder).

## Fixtures de E1.5 (sintéticas)

- Gon no tenía tiempo para hacer las capturas del navegador (E1.5 Tasks 3-5), así que las fixtures de `fixtures/` se generaron **sin tocar la cuenta** a partir de dos fuentes públicas: el bundle JS del cliente web oficial (`/assets/*.js` de `discord.com/app`, consultado 2026-11-06) y `discord-api-types` 0.38.57.
- Todos los ids, nombres, hashes y el token son falsos (ids `100000000000000001…`, `user1`/`user2`, `guild1`, `channel1`/`channel2`).
- Lo que no se pudo verificar queda marcado abajo. Cuando haya una captura real, se reemplazan estos archivos y se corrigen las diferencias.
- `scripts/redact.ts` sigue siendo el camino para redactar capturas reales cuando existan.

## Respuestas a los [sin verificar] de la spec

- **capabilities**: el cliente web manda `1734653`; con el experimento `useChannelObfuscation` activo, `1767421` (bundle, `handleIdentify`). Nuestro cliente usa `1734653`.
- **Identify**: `{ token, capabilities, properties, presence, compress, client_state, qos_token }`; **sin** `intents` (bundle, `[IDENTIFY]`). `client_state` es `{ guild_versions: {} }` y `qos_token` va `null` en esta fixture.
- **READY**: trae `private_channels` (el cliente web hace `hydrateReady({ users, private_channels, merged_members, guilds, … })`), así que los DMs vienen ahí. `READY_SUPPLEMENTAL` trae `lazy_private_channels` y `presences`.
- **op 37** (`GUILD_SUBSCRIPTIONS_BULK`): `{ subscriptions: { <guild_id>: { typing, threads, activities, members, member_updates, channels, thread_member_lists } } }`. `channels` es un objeto `{ <channel_id>: [[desde, hasta]] }` (bundle, `updateGuildSubscriptions` + `get()`). **Corrección 2026-11-07 (primera prueba real de Gon):** la fixture sintética decía que `members` también eran rangos; con `members: [[0, 99]]` Discord cerraba el gateway justo después de READY. Según discord.food `members` es una lista de ids de usuario y `thread_member_lists` una lista de ids de hilos; ahora no se mandan y la lista de miembros sale de los rangos de `channels`.
- **Ack**: `POST /channels/<channel_id>/messages/<message_id>/ack` con body `{ token, last_viewed, flags }`; la respuesta devuelve un `token` nuevo que se reusa en el próximo ack (bundle, `MESSAGE_ACK`).
- **X-Discord-Timezone**: sí existe; el cliente web manda el header cuando tiene la zona (bundle, `e.set("X-Discord-Timezone", c)`).
- **Subida de archivos**: `POST /channels/<channel_id>/attachments` → respuesta `{ attachments: [{ upload_url, upload_filename }] }` → `PUT` al `upload_url` → `POST` del mensaje con `attachments: [{ filename, uploaded_filename, … }]` (bundle, request de upload URL + `uploaded_filename`).
- **GUILD_MEMBER_LIST_UPDATE**: `{ guild_id, id: "everyone", member_count, online_count, ops: [{ op: "SYNC", range: [a, b], items: [{ member }] }], groups: [{ id, count }] }`; los `op` son `SYNC`/`INSERT`/`UPDATE`/`DELETE`/`INVALIDATE`.

## Imágenes en Ghostty

- Spike: `bun scripts/spike-image.tsx` (PNG 64x64 + GIF de 3 frames) corre sin stack trace; con `timeout 3` sale 124 porque queda vivo esperando `q`. Probado también bajo una PTY, mismo resultado.
- Falta la confirmación visual de Gon (Task 1, Step 2). `resolveImageRenderProtocol` depende de las capabilities que reporta la terminal; en la PTY del spike no hay respuesta, así que el protocolo que elige ahí no es representativo de Ghostty.
- `IMAGE_MODE = "kitty"` por la doc de Ghostty (spec 6.1). Si la confirmación visual muestra bloques, se cambia a `"blocks"`; si no hay protocolo gráfico, a `"links"`.
- GIF: si no anima, se muestra el primer frame (decisión [nuestra] del plan).

## Voz: dependencias y DAVE local (E4a Task 1)

- `generateDependencyReport()` de `@discordjs/voice` 0.19.2: `@discordjs/opus` 0.11.0 presente, `@snazzah/davey` 0.1.12 presente, `aes-256-gcm` nativo: sí. `opusscript` 0.1.1 también instalado como fallback. `sodium-native`/`sodium`/`libsodium-wrappers`/`@stablelib/xchacha20poly1305`/`@noble/ciphers`: ninguno instalado (no hacen falta para `aead_aes256_gcm_rtpsize`).
- `bun pm ls --all | grep -c "@snazzah/davey@"` → `1` (una sola copia, 0.1.12, fijada con `overrides`).
- `scripts/spike-dave-local.ts`: el intento (a) con dos sesiones falla al procesar el `welcome` (`CreatingStagedWelcomeFailed(NoMatchingKeyPackage)`) porque los vectores de `davey-node/test/session.test.ts` vienen de una captura real donde el `welcome` referencia el key package que el servidor vio en ese momento, no uno que generemos nosotros en una segunda sesión local; sin servidor que arme el `welcome` a medida no hay forma de que calce. El intento (b) (una sesión, hasta `ready` con su propio commit) **sale**: `DAVE local: b`.
- **Fallback (decisión nuestra):** como salió (b), no se prueba el handshake MLS de dos sesiones en local con la API pública de davey 0.1.12. Lo que queda probado acá: una sesión llega a `ready`, tiene `voicePrivacyCode` no vacío, `getSerializedKeyPackage()` no se repite entre llamadas, `setPassthroughMode(true)` dejapasar el Opus, y protocolo inválido (`0`) tira. El handshake real de dos sesiones se verifica en E4b (DAVE activo, sin cierre 4017) y en E4c (`voicePrivacyCode` igual al del otro cliente).
- `@discordjs/opus` 0.11.0 figura en el reporte pero su prebuild nativo no carga con Bun 1.4.3 (`prebuild/node-v147-napi-v3-linux-x64-glibc-2.44/opus.node` no existe para esta versión de Node ABI). `createOpusCodec()` cae a `opusscript` (WASM) y lo reporta en `backend`. Anotado como el fallback que el plan permite; si en la máquina de Gon el nativo carga, se usa ese.
- Opus tiene delay algorítmico y normaliza ganancia: los tests comparan forma de onda con correlación a mejor desfasaje (`bestCorrelation` en `tests/helpers/pcm.ts`), no fase ni nivel exactos.

## Voz real (E4b/E4c) — verificación local, 2026-11-07

- **Plan A** (`@discordjs/voice` 0.19.2 con adapter propio), sin rama B por ahora. Falta el spike de Gon contra Discord real (`bun run voice-spike <guild> <canal>`): es lo único que confirma DAVE con cuenta de usuario.
- Probado en Bun 1.4.3 contra un **servidor de voz falso local** (`tests/fakes/fake-voice-server.ts`: WS TLS `?v=8` + UDP): identify con `max_dave_protocol_version >= 1`, IP discovery, `aead_aes256_gcm_rtpsize`, Speaking 1/0, envío y recepción de Opus, op 4 de mute/deaf, cierre 4017 sin loop de reintentos (`tests/voice/session-e2e.test.ts`). El server falso responde `dave_protocol_version: 0`, así que el handshake MLS no se ejercita acá.
- Pipeline completo (`tests/voice/pipeline-e2e.test.ts`): tono sintético → VAD → Opus real (opusscript) → servidor; audio de otro usuario → descifrado → decoder por usuario → jitter → mixer → salida; mute no transmite, deafen no reproduce.
- **Desvío del plan:** el plan decía transmitir con `AudioPlayer` + `AudioResource` por ráfaga. Se usa `connection.playOpusPacket()` por cada frame capturado + `setSpeaking()`, porque el `AudioPlayer` corta Speaking si en un tick de 20 ms no hay frame (con mic en vivo pasa seguido). Los 5 silencios `F8 FF FE` los manda `voice/tx.ts` (davey no cifra los silencios).
- **Gotchas de la librería:** arma `wss://${endpoint}?v=8` fijo; ante cualquier cierre que no sea 4014 hace rejoin sola, así que `voice/session.ts` escucha `networking.once("close")` y destruye la conexión en los códigos fatales (4014, 4016, 4017, 4004, 4011) o después de 3 rejoins. Los mensajes de debug pasan por `sanitizeVoiceDebug` (nada con `{`, `token`, `session_id` o `secret`).
- Mensajes de cierre en español: `src/voice/close-codes.ts`.
- Revisión (2026-11-07), arreglado con tests en `tests/voice/session-e2e.test.ts`: salir mientras la librería carga o mientras espera a Discord ya no deja una conexión viva; `rejoin()` para mute/deaf solo se usa con la conexión lista y el gateway listo (si no, los flags se mandan al quedar lista); 4014 espera 5 s por si es un "te movieron" antes de rendirse; si la voz se cae con el gateway principal caído, reintenta cuando vuelve (`gatewayReady`); `v`/`m`/`D`/`M` ignoran la autorepetición de teclas.

## Código de privacidad

- Pendiente E4c Task 1 (Gon + [2ª]): no se sabe todavía si el cliente oficial lo muestra ni con qué formato. Mientras tanto la barra de voz lo muestra en grupos de 5 dígitos **[nuestra]** (`src/voice/privacy-code.ts`).

## Push-to-Talk y el protocolo de teclado de Kitty

- El plan daba por hecho que `useKittyKeyboard: { events: true }` alcanzaba para el PTT. No alcanza: OpenTUI arma los flags `7` (disambiguate + alternate keys + event types) y, sin "report all keys as escape codes" (flag 8), las teclas que producen texto (Espacio incluido) se mandan como texto plano y la terminal **no avisa cuándo se sueltan** (docs del protocolo de Kitty). El PTT habría caído siempre en modo interruptor.
- Ahora `src/ui/kitty.ts` pide `{ events: true, allKeysAsEscapes: true }` (flags 15). Probado con `parseKeypress`: Enter, Backspace, Esc, Tab, flechas, Ctrl-letra, `ñ`/`Ñ`, Shift+letras (`D`, `M`, `G`, `R`) y `?`/`+` se siguen decodificando bien, y Espacio trae press/repeat/release.
- Falta la confirmación de Gon en Ghostty (E4b Task 6, punto 3).

## Mouse (2026-11-07)

- OpenTUI 0.8.2 entrega `onMouseDown`, `onMouseOver`, `onMouseOut` y `onMouseScroll` en `<box>` y `<text>`; los `<span>` dentro de un `<text>` **no** reciben eventos, así que cada botón es su propio `<text>` (`src/ui/components/Button.tsx`) y hace `stopPropagation()` para no disparar la fila de atrás.
- La barra de acciones de un mensaje aparece solo en el mensaje **seleccionado** (click o j/k), no en el que tiene el mouse encima: mostrarla al pasar el mouse cambia el alto del mensaje, corre todo lo de abajo y el mouse queda sobre otro mensaje (parpadeo). El hover solo resalta el fondo.
- Los links dentro del texto de un mensaje son hipervínculos OSC 8 (en Ghostty se abren con Ctrl+click o el click que tengas configurado). Adjuntos y títulos de embeds sí se abren con click normal vía `xdg-open` (`src/proc/open-url.ts`, solo https, sin shell).
- La rueda arriba de todo de un canal pide historial (`actions.loadOlder`).

## Primera llamada real (2026-11-07, Gon)

- **Funciona con la cuenta de usuario y DAVE**: entra en ~2 s, se ve el código de privacidad, se escucha a los demás y se ve quién habla. El plan A (`@discordjs/voice` + adapter) queda confirmado; no hace falta la rama B.
- **opusscript 0.1.1 rompe con varias instancias.** Su wrapper JS arma los buffers de PCM con `HEAPU16.subarray(punteroEnBytes, …)`, o sea en `2 × puntero`, memoria que nunca reservó (el C++ espera un byte por cada elemento u16). Desde la 5.ª instancia viva esa zona pisa el estado de otro códec y el decoder aborta (`Aborted()` en opus_decoder.c); en una llamada hay un decoder por persona, así que rompía con el 3.º/4.º que hablaba. Reproducido con opusscript puro (`N=4 decoders + 1 encoder → aborta en el primer decode del 4.º`). Arreglo: `src/voice/opus-wasm.ts` usa el mismo módulo WASM con buffers bien reservados (encode idéntico byte a byte al original; probado con 90 decoders vivos). Además el receptor no reintenta crear un decoder en cada paquete si falla (antes llenaba la consola) y los códecs se liberan al salir.
- **Participantes de voz:** en cuentas de usuario el READY trae los guilds `lazy` sin `voice_states`; llegan en `READY_SUPPLEMENTAL.guilds[].voice_states` (mismo orden que READY) junto con `merged_members`. Antes solo se veía a uno mismo.

## DMs (2026-11-07)

- READY de usuario manda `private_channels` con `recipient_ids` (los usuarios van deduplicados en `users`), no con `recipients`: antes todos los DMs se llamaban "DM". `toPrivateChannel` (src/store/reducers/ready.ts) acepta las dos formas; los grupos usan su `name` si lo tienen.
- La lista se ordena por `last_message_id` (actividad) como el cliente oficial; un mensaje nuevo sube el DM.
- `CHANNEL_CREATE` agrega DMs nuevos; además, el primer mensaje de alguien que no estaba en la lista crea el DM (`ensureDmForMessage`). `CHANNEL_UPDATE`/`DELETE`, `CHANNEL_RECIPIENT_ADD`/`REMOVE` y `GUILD_MEMBER_UPDATE` ahora se aplican.
- Presencia de los DMs: `READY_SUPPLEMENTAL.merged_presences.friends`.
- Bug arreglado de paso: un autor de mensaje sin `global_name` pisaba el nombre ya conocido (los DMs mostraban el username).

## Hilos y foros (2026-11-07)

Fuente de las formas: https://docs.discord.food (Gateway Events y Channel, leídas el 2026-11-07). Nada de esto se probó todavía contra la cuenta real: todo sale de la docs y de fixtures armados a mano.

- **Hilo** = canal con `type` 10 (anuncios), 11 (público) o 12 (privado), `guild_id`, `parent_id` (el canal de texto o el foro), `name`, `owner_id`, `last_message_id`, `message_count`, `member_count` (los dos cortan en 50) y `thread_metadata { archived, locked, auto_archive_duration, archive_timestamp, invitable?, create_timestamp? }`. Se guarda como `ChannelState` con `thread: { archived, locked, ownerId, messageCount, memberCount }` (`src/store/reducers/threads.ts`).
- **Fuentes:** `READY.guilds[].threads` (en cuentas de usuario, según la docs, solo los hilos que seguís), `THREAD_CREATE` (canal completo + `newly_created`, y `member` si te agregan a uno privado), `THREAD_UPDATE` (canal; **no** se manda cuando cambia `last_message_id`, por eso se conserva el que había y lo mueve `MESSAGE_CREATE`), `THREAD_DELETE` (solo `id`, `guild_id`, `parent_id`, `type`) y `CHANNEL_CREATE`/`CHANNEL_UPDATE` si el `type` es de hilo.
- **`THREAD_LIST_SYNC { guild_id, channel_ids?, threads, members }`:** reemplaza los hilos activos de los canales de `channel_ids` (puede traer canales sin hilos para que los borres); sin `channel_ids`, de todo el guild. Según la docs, en cuentas de usuario la lista completa llega acá después de suscribirse al guild (op 37 con `threads: true`, que ya mandamos). Decisión nuestra: no se borran los archivados que ya estaban ni el hilo abierto.
- **Payloads rotos** (sin `id`, sin `parent_id`, `type` que no es de hilo, `threads` que no es lista) dejan el estado igual; tests en `tests/store/threads.test.ts`.
- **Lista de canales:** los hilos activos van debajo de su canal de texto con `└`, el de actividad más reciente arriba (`last_message_id`, o el id si no tiene), y se colapsan con la categoría de su canal. Un hilo se ve si se ve su canal. **[nuestra]** Un hilo cuenta como no leído solo si tiene read state (los que seguís), como hace el cliente oficial; si no, cualquier hilo con mensajes prendería el servidor.
- **Foros (15) y medios (16)** aparecen en la lista (`💬`/`🖼`). Al abrirlos no se piden mensajes (no tienen) y no se manda op 37 para el foro: el panel muestra los posts (sus hilos) que ya están en el store. Abrir un post hace `GET /channels/{post}/messages` como cualquier canal, y el op 37 de un hilo usa el id de su canal de texto **[sin verificar]** (falta ver qué canal suscribe el cliente oficial al abrir un hilo).
- **Posts archivados**, solo con click o `a` (spec 7.8): `GET /channels/{foro}/threads/search?archived=true&sort_by=last_message_time&sort_order=desc&limit=25&offset=N` → `{ threads, members, has_more, total_results, first_messages? }`. Si el índice no está listo responde 202 con `code` 110000 y `retry_after` (sin `threads`): mostramos un aviso. **[sin verificar]** que una cuenta de usuario pueda usarlo sin más (la docs no lo marca como "not usable by user accounts", a diferencia de List Active Threads).
- **Sin verificar con la cuenta real:** que `READY.guilds[].threads` venga en guilds `lazy`, qué trae exactamente el `THREAD_LIST_SYNC` que llega al suscribirse (y si incluye los posts activos de los foros), y si mandar mensajes, typing, ack y reacciones en un hilo archivado lo desarchiva o da error.

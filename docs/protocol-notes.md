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

## Interferencia al escuchar (2026-11-08, Gon)

- **Sin colchón en pw-cat.** El mixer escribía exactamente un frame por slot de 20 ms y nada cuando no había audio: cualquier demora del timer (el audio comparte el event loop con la UI de OpenTUI) o un paquete tardío dejaba a PipeWire sin datos → chasquidos. Ahora el mixer de la llamada es continuo (silencio cuando nadie habla) con un colchón inicial de 100 ms (`prerollFrames: 5`) que se repone tras una pausa larga del event loop o al sacar el deafen. Simulación de 60 s con jitter de red y pausas de 40–120 ms del event loop: 23 huecos → 2. Costo: ~100 ms más de latencia de escucha.
- El jitter buffer, si se vaciaba a mitad de frase, esperaba 3 frames otra vez (cortes de 60 ms); ahora vuelve con 2.
- **Ciphertext de DAVE al decoder.** `@discordjs/voice` (`DAVESession.decrypt`) devuelve el paquete sin descifrar cuando la sesión DAVE no está lista (al entrar o en una transición de época). Decodificarlo como Opus suena a ruido; se descartan los frames que terminan con el marcador 0xFAFA.
- El decoder WASM propio da salida idéntica byte a byte a opusscript (50/50 paquetes): no era la fuente del ruido.
## Encuestas y stickers

Fuentes (consultadas 2026-11-07): docs.discord.food → Messages (Poll Object, "Create Poll Vote"), Gateway Events ("Message Poll Vote Add/Remove") y Stickers. Probado solo con fixtures y la demo; falta la prueba de Gon contra la cuenta real.

- **`message.poll`**: `{ question: { text }, answers: [{ answer_id, poll_media: { text, emoji? } }], expiry, allow_multiselect, layout_type, results? }`. `results = { is_finalized, answer_counts: [{ id, count, me_voted }] }`; una respuesta que no figura en `answer_counts` tiene 0 votos. Si falta `results`, los resultados son desconocidos: un `MESSAGE_UPDATE` con la encuesta sin `results` conserva los que ya teníamos (`updateMessage`).
- **Votos en vivo**: `MESSAGE_POLL_VOTE_ADD` / `MESSAGE_POLL_VOTE_REMOVE` con `{ user_id, channel_id, message_id, guild_id?, answer_id }` (`answer_id` es entero, los demás snowflakes); en multiselección llega uno por respuesta. `me_voted` cambia solo si `user_id` soy yo (`src/store/reducers/polls.ts`).
- **Votar**: `PUT /channels/{channel_id}/polls/{message_id}/answers/@me` con `{ answer_ids: [...] }` (array de enteros; vacío saca el voto), responde 204 y Discord dispara los eventos de voto, también por los propios: por eso no hay cambio optimista. Multiselección alterna la respuesta tocada sobre mis votos actuales; selección única la reemplaza y tocar la misma saca el voto. Encuestas vencidas (`expiry` pasado) o con `is_finalized` no mandan nada.
- **[sin verificar]** si el cliente web manda los `answer_ids` como strings (`["1"]`) en vez de enteros; discord.food dice `array[integer]` y seguimos eso. Tampoco se probó el voto contra la cuenta real.
- Terminar una encuesta (`POST /channels/{c}/polls/{m}/expire`, solo el autor) no está implementado.
- **Stickers**: `message.sticker_items = [{ id, name, format_type }]`, `format_type` 1 PNG, 2 APNG, 3 Lottie, 4 GIF. Se muestran como imagen desde `https://media.discordapp.net/stickers/{id}.png?size=160` (o `.gif`; discord.food aclara que los GIF no están en el CDN y van por `media.discordapp.net`). El host ya estaba en la lista permitida; no se tocó. Lottie y "imágenes apagadas" muestran `🏷 nombre`. **[sin verificar]** el parámetro `size=160` (lo pidió el plan; discord.food no lo menciona) y que `<image>` anime APNG/GIF (se espera el primer frame).
## Mensajes nuevos (2026-11-07)

- Al **seleccionar** un canal (`ui/selectChannel` con un id distinto al actual) el reducer guarda `ui.unreadMarker = { channelId, afterId: readState.lastAckedId }`, antes de que el ack con debounce de 1,5 s (`actions.viewing`) mueva `lastAckedId`. El marcador no cambia mientras sigas en el canal (ni con nuestro ack ni con `MESSAGE_ACK`/`CHANNEL_UNREAD_UPDATE` de otro cliente) y se recalcula al volver a abrirlo. Lógica en `src/store/unread.ts`.
- Sin read state del canal no hay divisor (no se sabe desde dónde). Si el último mensaje del canal no es más nuevo que `lastAckedId`, tampoco: los que lleguen mientras mirás no cuentan como nuevos (para eso está el chip "↓ ir al final").
- El divisor rojo `──── mensajes nuevos ────` va antes del primer mensaje cargado más nuevo que `afterId` que **no sea propio**.
- Si hay sin leer más viejos que lo cargado (`hasMoreBefore` y el más viejo cargado > `afterId`) se muestra la barra `↑ N+ mensajes nuevos desde … · click o gn para saltar`. La hora sale del snowflake de `afterId`. Recién con el click o `gn` se piden páginas `before` (las mismas de `loadOlder`), como máximo 9 (los 500 mensajes que guarda el canal), y se selecciona el primero sin leer. La API también acepta `around`/`after`, pero dejarían huecos en el slice; no se usan.
- Al abrir, si el divisor está cargado la vista lo pone arriba (si todo lo nuevo entra, queda al final). `Esc`/`G` siempre bajan al final; el chip "↓ ir al final" aparece si llegaron mensajes estando arriba o con un mensaje seleccionado.

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
- **op 37** (`GUILD_SUBSCRIPTIONS_BULK`): `{ subscriptions: { <guild_id>: { typing, threads, activities, members, member_updates, channels, thread_member_lists } } }`. `members` y `channels` son rangos (`[[0, 99]]`); `channels` es un objeto `{ <channel_id>: [[desde, hasta]] }` (bundle, `updateGuildSubscriptions` + `get()`).
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

## Código de privacidad

- Pendiente E4c Task 1 (Gon + [2ª]): no se sabe todavía si el cliente oficial lo muestra ni con qué formato. Mientras tanto la barra de voz lo muestra en grupos de 5 dígitos **[nuestra]** (`src/voice/privacy-code.ts`).

## Push-to-Talk y el protocolo de teclado de Kitty

- El plan daba por hecho que `useKittyKeyboard: { events: true }` alcanzaba para el PTT. No alcanza: OpenTUI arma los flags `7` (disambiguate + alternate keys + event types) y, sin "report all keys as escape codes" (flag 8), las teclas que producen texto (Espacio incluido) se mandan como texto plano y la terminal **no avisa cuándo se sueltan** (docs del protocolo de Kitty). El PTT habría caído siempre en modo interruptor.
- Ahora `src/ui/kitty.ts` pide `{ events: true, allKeysAsEscapes: true }` (flags 15). Probado con `parseKeypress`: Enter, Backspace, Esc, Tab, flechas, Ctrl-letra, `ñ`/`Ñ`, Shift+letras (`D`, `M`, `G`, `R`) y `?`/`+` se siguen decodificando bien, y Espacio trae press/repeat/release.
- Falta la confirmación de Gon en Ghostty (E4b Task 6, punto 3).

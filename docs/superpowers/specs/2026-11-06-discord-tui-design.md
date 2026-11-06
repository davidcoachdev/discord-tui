# discord-tui: diseño

Fecha: 2026-11-06 · Estado: diseño aprobado en forma, listo para que el builder arme el plan.
Builder: DeepSeek V4 Pro corriendo en DeepSeek Harness (dsh).

Convenciones del doc:

- **[Gon]** = decidido por Gon. No se cambia sin preguntarle.
- **[nuestra]** = decisión nuestra (revisable). El builder la puede cambiar si encuentra algo mejor, dejando el motivo escrito.
- **[sin verificar]** = no lo pude confirmar con una fuente o una prueba. Hay que comprobarlo antes de construir encima.
- Las fuentes van al lado de cada dato, con la fecha en que se consultaron. Todas se consultaron el 2026-11-06. "Probado local" quiere decir que lo corrí en esta máquina (Bun 1.4.3, Omarchy) el 2026-11-06.

---

## 0. Riesgo aceptado (leer primero)

El cliente usa **la cuenta personal de Discord de Gon** con su user token, no un bot. Los clientes no oficiales y la automatización de cuentas de usuario violan los Términos de Servicio de Discord, y la cuenta puede quedar **baneada para siempre**. Otros clientes de terminal lo advierten igual: discordo dice "Automated user accounts or self-bots are against Discord's Terms of Service" (https://github.com/ayn2op/discordo, 2026-11-06), endcord dice "Using third-party client is against Discord's Terms of Service and may cause your account to be banned!" (https://github.com/sparklost/endcord, 2026-11-06). La página oficial de soporte sobre self-bots (https://support.discord.com/hc/en-us/articles/115002192352) devolvió 403 al consultarla, así que su texto exacto queda **[sin verificar]**.

**[Gon]** Se le explicó y lo acepta en forma explícita: "sí, con mi cuenta, no importa".

Lo que el diseño hace al respecto: comportarse como un cliente humano normal (sección 7.8). **No** intenta saltear sistemas de seguridad: nada de resolver captchas, nada de automatizar acciones y nada de spoofear la huella TLS.

---

## 1. Intención

Reemplazar la app de Discord en el uso diario con un cliente de terminal hecho con OpenTUI. Se maneja con teclado estilo vim, corre en Ghostty o Kitty sobre Omarchy y tiene texto y voz funcionando bien desde la v1. La razón es usar Discord sin Electron, sin salir de la terminal y con atajos propios.

## 2. Objetivos, no-objetivos y anti-objetivos

**Objetivos (v1):**

- Login por QR escaneado con la app móvil, con la opción de pegar el token como alternativa. La sesión persiste.
- Texto completo para el uso diario:
  - servidores, canales y DMs;
  - leer con scroll e historial;
  - mandar mensajes, responder y hacer @menciones;
  - editar y borrar los mensajes propios;
  - reacciones;
  - indicador de typing;
  - presencia y lista de miembros;
  - imágenes inline;
  - notificación de escritorio cuando te mencionan;
  - estado de no leídos.
- Voz en canales de servidor y en llamadas de DM (las llamadas de DM son **[nuestra]**, ver 7.6):
  - entrar y salir con una tecla;
  - ver quién habla;
  - mute, deafen y push-to-talk;
  - **DAVE E2EE**.
- Funciona contra la cuenta real en cada etapa.

**No-objetivos (fuera de la v1) [Gon]:** video, screen share, stage channels. **[nuestra]** También quedan afuera:

- hilos y foros completos (en la v1 se muestran como canal, en solo lectura si complica);
- crear servidores o canales;
- mandar solicitudes de amistad;
- abrir DMs nuevos con desconocidos;
- editar el perfil;
- pagos y Nitro.

Concord y endcord los evitan a propósito porque disparan filtros antispam (https://docs.rs/crate/concord/latest, https://github.com/sparklost/endcord, 2026-11-06).

**Anti-objetivos (nunca):**

- Mandar cualquier cosa de forma automática: ni auto-reply, ni scripts, ni macros, ni "marcar todo leído" en loop. Toda escritura (mensaje, reacción, edición, borrado, typing) sale de una tecla que apretó Gon.
- Perder mensajes en silencio. Si un envío falla, el mensaje queda en el composer o en una cola visible con el error, y se reintenta a mano. Si se cae el gateway, se ve en la barra de estado, y al reconectar se rellena el hueco por REST.
- Filtrar el token:
  - no va a logs, ni a la pantalla, ni a crash dumps, ni a mensajes de error;
  - no va en argumentos de procesos hijos ni en variables de entorno de subprocesos;
  - el archivo de sesión queda con modo 600.
- Saltear captchas o protecciones antiabuso.

## 3. Restricciones

- **SO:** Linux (Omarchy/Arch, Hyprland). Probado local con kernel 7.2.8, 2026-11-06.
- **Terminal:** Ghostty (principal) o Kitty. Las dos soportan el protocolo gráfico de Kitty (https://ghostty.org/docs/features, 2026-11-06). Que Ghostty 1.4 tenga cobertura completa del protocolo lo dice una sola fuente secundaria (https://alternativeto.net/news/2026/10/ghostty-1-4-brings-full-kitty-graphics-support-and-performance-and-memory-improvements/, 2026-11-06), así que queda **[sin verificar]**.
- **Audio:** PipeWire. Los binarios `pw-cat`, `pw-record`, `ffmpeg` (n9.0.2, con libopus) y `notify-send` están instalados (probado local).
- **Runtime:** Bun. Local hay 1.4.3. `@opentui/core` 0.8.2 pide `bun >=1.3.14` (`npm view @opentui/core engines`, 2026-11-06).
- **Lenguaje:** TypeScript.

## 4. Lo que decidió Gon

1. Reemplaza la app de Discord en el uso diario, todo en la terminal, con **OpenTUI**.
2. Usa la **cuenta personal** (user token). El riesgo de ban está aceptado (sección 0).
3. La v1 tiene **texto y voz**, y los dos funcionan bien.
4. Lo construye DeepSeek V4 Pro en dsh. El plan va en pasos chicos, concretos y verificables.
5. La forma aprobada ("ok todo me sirve"):
   - **Login:** QR en la terminal que se escanea con la app móvil (remote auth, igual que el QR del cliente de escritorio). La alternativa es pegar el token. La sesión se guarda en un archivo chmod 600.
   - **Texto:** a la izquierda servidores y canales, al medio los mensajes, abajo el composer. Incluye DMs, replies, @menciones, editar y borrar los propios, reacciones, typing, presencia y lista de miembros, imágenes inline si la terminal puede (si no, el link) y notificación de escritorio cuando te mencionan.
   - **Voz:** entrar a un canal con una tecla, ver quién habla, mute, deafen y push-to-talk, con audio por PipeWire y **DAVE incluido**. Video, screen share y stage quedan afuera.
   - Se maneja con el teclado estilo vim (j/k, atajos para saltar a un canal). El mouse es un extra.
   - TypeScript y Bun.
   - Se construye por etapas, y cada una se prueba contra la cuenta real: login, leer, escribir, transporte de voz, DAVE y pulido.

**Corrección sobre lo que se le dijo a Gon.** Le dijimos que la voz se podía probar primero "sin cifrado contra un servidor local de prueba". Eso **no sirve tal cual**. Desde el 1 de marzo de 2026 Discord solo acepta llamadas E2EE en DMs, DMs grupales, canales de voz y Go Live. Un cliente sin DAVE no puede entrar: el servidor cierra con el código 4017 "E2EE required". Fuentes:

- https://docs.discord.com/developers/topics/voice-connections (2026-11-06)
- https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted (post del 2026-05-18, consultado 2026-11-06)
- https://www.helpnetsecurity.com/2026/05/19/discord-voice-and-video-call-encryption/ (2026-11-06)
- https://docs.discord.food/topics/opcodes-and-status-codes (2026-11-06)

Además, no existe un "servidor de voz de Discord local". Lo que sí se puede y conviene hacer:

- (a) Probar el **pipeline de audio** (PipeWire, PCM, Opus y vuelta a PipeWire) en local, sin red.
- (b) Probar el **framing RTP y el cifrado de transporte** con un loopback UDP local (dos sockets en 127.0.0.1), sin Discord.
- (c) Probar **DAVE** en local con dos `DAVESession` de davey que hacen el handshake MLS entre sí, sin red.
- (d) Contra Discord real, voz con DAVE **desde la primera conexión**. Por eso, en el plan, las etapas "transporte de voz" y "DAVE" se juntan para la prueba contra la cuenta real (sección 9).

## 5. Arquitectura

```
                         ┌──────────────────────── UI (OpenTUI) ────────────────────────┐
                         │ GuildList │ ChannelList │ MessageView │ MemberList │ VoiceBar │
                         │ Composer  │ QuickSwitcher │ StatusBar │ Keymap (vim)          │
                         └───────────────▲───────────────────────────────┬──────────────┘
                              selectores  │                               │ acciones del usuario
                                          │                               ▼
┌────────────┐  token   ┌─────────────────┴────────────────┐      ┌──────────────┐
│ auth       │────────▶ │ store (estado + caché en memoria)│◀────▶│ actions      │
│ QR / token │          │ guilds, channels, messages,      │      │ (send, edit, │
│ session.json (600)    │ members, presence, read_state,   │      │  react, join │
└────────────┘          │ voice_states, typing, outbox     │      │  voice, …)   │
                        └───▲──────────────────────▲───────┘      └──┬────────┬──┘
                   dispatch │                      │ respuestas      │        │
                  ┌─────────┴───────┐      ┌───────┴────────┐        │        │
                  │ gateway (WS v9) │◀─────│ client-props   │───────▶│ rest   │
                  │ zlib/zstd,      │      │ X-Super-Props, │  headers│ (v9,  │
                  │ heartbeat,      │      │ UA, locale     │        │ rate   │
                  │ resume, op 37   │      └────────────────┘        │ limits)│
                  └───────┬─────────┘                                └────────┘
                          │ op 4 / VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE
                  ┌───────▼──────────────────────── voice ─────────────────────────┐
                  │ voice-gw (WS v8) ─ UDP (IP discovery, RTP) ─ transport crypto  │
                  │ (aead_aes256_gcm_rtpsize) ─ DAVE (davey/MLS) ─ Opus enc/dec    │
                  │ ─ mixer/jitter ─ audio-io (pw-record ⇄ pw-cat)                 │
                  └────────────────────────────────────────────────────────────────┘
                  notify (notify-send)    images (ImageRenderable, kitty/sixel/blocks)
```

**Módulos [nuestra]** (cada uno se puede probar por separado):

| Módulo | Qué hace | Cómo se prueba |
|---|---|---|
| `auth` | QR remote auth, token pegado, `session.json` | test con un WS falso del remote-auth; prueba real con el teléfono |
| `client-props` | arma X-Super-Properties, User-Agent y headers comunes | snapshot del objeto; nunca contiene el token |
| `gateway` | WS, compresión, heartbeat, resume y reconnect, dispatch tipado, suscripciones | replay de capturas grabadas (sin el token) |
| `rest` | fetch con headers, colas por bucket, 429, outbox | servidor HTTP falso que devuelve 429 |
| `store` | estado normalizado, reducers puros por evento | unit tests evento → estado |
| `ui` | componentes OpenTUI, keymap | test de render de OpenTUI con un store fijo |
| `voice/*` | voice gateway, UDP, cripto, DAVE, Opus, audio-io | loopback local y llamada real |
| `notify`, `images` | notify-send, ImageRenderable | manual |

Regla: `ui` nunca habla con la red. Solo lee el `store` y llama a `actions`.

## 6. Datos verificados que el builder necesita

### 6.1 OpenTUI

- Paquetes:
  - `@opentui/core`, `@opentui/react`, `@opentui/solid`, `@opentui/keymap` y `@opentui/qrcode` ("QR code encoder and renderable for OpenTUI"). Todos van por la 0.8.2, publicada el 2026-11-03 (`npm view`, 2026-11-06).
  - Además existen `@opentui/three` y `@opentui/ssh` (https://github.com/sst/opentui, 2026-11-06).
- Runtime: core pide `bun >=1.3.14` o `node >=26.4.0` con `--experimental-ffi` (`npm view @opentui/core engines`, 2026-11-06). Para desarrollar OpenTUI en sí hacen falta Zig y Bun más nuevos, pero eso no afecta a quien lo consume (https://github.com/sst/opentui, 2026-11-06).
- Madurez: sigue en 0.x. Ya tiene más de 300 versiones publicadas (https://socket.dev/npm/package/@opentui/core/overview/0.6.7, 2026-11-06). Lo usa en producción OpenCode (https://github.com/sst/opentui, 2026-11-06). Hay que esperar cambios de API entre versiones menores, así que conviene **fijar la versión exacta** **[nuestra]**.
- **Imágenes:** existe `ImageRenderable`. Lee PNG, JPEG, WebP y GIF desde un path, una URL http(s), un `Uint8Array` y otras fuentes. Tiene los protocolos `auto | kitty | sixel | blocks` y los modos de ajuste `fit | cover | fill`. Hay un tope de unos 8 MiB de salida de imagen por frame. Si corrés dentro de tmux, `auto` cae a blocks. Se configura con las variables de entorno `OPENTUI_IMAGE_PROTOCOL` y `OPENTUI_GRAPHICS=false` (https://opentui.com/docs/components/image, 2026-11-06). En la 0.8.2 están exportados `ImageRenderable`, `NativeImage` y `resolveImageRenderProtocol` (probado local). La animación de GIF queda **[sin verificar]**.
- **QR:** se usa `@opentui/qrcode` para el login, así no hace falta otra librería.

### 6.2 Gateway para cuentas de usuario

Fuente principal: https://docs.discord.food (documentación de la API de usuario hecha por la comunidad con ingeniería inversa; no es oficial), consultada el 2026-11-06.

- **Versión de la API:** los clientes oficiales usan **v9** por defecto, y v10 existe (https://docs.discord.food/reference, 2026-11-06). Por eso el gateway va con `wss://gateway.discord.gg/?v=9&encoding=json&compress=zlib-stream` y REST con `https://discord.com/api/v9` **[nuestra]**, para parecerse al cliente oficial. Con v10 el tráfico sería distinto al del cliente oficial.
- **Identify (op 2):**
  - va el `token` crudo, sin "Bot " adelante;
  - `capabilities` es un bitfield, y discord.food lista 17 flags pero no da un valor recomendado;
  - `properties` lleva las client properties (6.4);
  - además `presence` y `compress`.
  - "User accounts do not require intents and their usage is not recommended", así que **no se mandan intents** (https://docs.discord.food/topics/gateway, 2026-11-06).
  - El valor de `capabilities` hay que sacarlo de una captura del cliente web oficial, y el que se use se documenta **[sin verificar]**.
- **READY:** trae `session_id`, `resume_gateway_url`, `guilds`, `read_state`, `user_guild_settings`, `users`, `merged_members`, `user_settings_proto` y otros. Con la capability `DEDUPE_USER_OBJECTS` los usuarios vienen deduplicados en `users`. Con `PRIORITIZED_READY_PAYLOAD` llega además `READY_SUPPLEMENTAL` (https://docs.discord.food/topics/gateway, 2026-11-06). La docs no lista `private_channels` (los DMs), así que hay que verlo en una captura **[sin verificar]**.
- **Opcodes relevantes:** 3 Presence Update, 4 Voice State Update, 8 Request Guild Members (rate limit de 1 por guild cada 30 s por sesión), 14 Guild Subscriptions (**deprecated**), **37 Guild Subscriptions Bulk** (es el que reemplaza al 14 para typing, actividades y rangos de la lista de miembros), 34 Request Last Messages, 35 Search Recent Members, 43 Request Channel Info (https://docs.discord.food/topics/opcodes-and-status-codes, 2026-11-06). El payload exacto del op 37 (los rangos de member list y `typing`/`activities`) hay que sacarlo de la página de guild subscriptions de discord.food o de una captura **[sin verificar]**. Como referencia sirve la explicación de discord.py-self: hoy los guilds de menos de 75k miembros se suscriben solos al conectar, y la lista de miembros llega por rangos (https://discordpy-self.rtfd.io/en/latest/guild_subscriptions.html, 2026-11-06).
- **Compresión:** transporte `zlib-stream` (un contexto por conexión; cada mensaje termina en `00 00 ff ff`) o `zstd-stream` (https://docs.discord.food/topics/gateway, 2026-11-06). Se arranca con zlib-stream, que Bun trae en `node:zlib` **[nuestra]**.
- **Límites de cuenta de usuario:** 200 guilds, 50 sesiones de gateway activas, `max_concurrency` de 1 y nunca hace falta sharding (https://docs.discord.food/topics/gateway, 2026-11-06).

### 6.3 REST y rate limits

Fuente: https://docs.discord.food/topics/rate-limits (2026-11-06).

- Límite global de 50 req/s por usuario.
- Una respuesta 429 trae `retry_after`, `global` y `X-RateLimit-Scope`.
- Las respuestas 401, 403 y 429 cuentan como inválidas: más de 10.000 en 10 minutos te dan un ban de IP de 24 h.
- Las cuentas de usuario muchas veces reciben solo `Retry-After`, `X-RateLimit-Global` y `X-RateLimit-Scope`, sin el set completo de headers de bucket.
- Los límites no se hardcodean.

**[nuestra]** Las consecuencias para el diseño:

- una cola por ruta;
- respetar `retry_after` siempre;
- si llega un 401, se corta todo y se vuelve a la pantalla de login (nada de reintentar en loop);
- el historial se pide en páginas de 50 y solo cuando hacés scroll.

### 6.4 Client properties y headers

Fuente: https://docs.discord.food/reference (2026-11-06).

- `X-Super-Properties` es un JSON en base64 y va en **cada request HTTP**. Lo mismo va como `properties` en el identify. La docs dice que es "strongly recommended because of its role in anti-abuse systems".
- Campos: `os`, `browser`, `release_channel`, `client_build_number`, `os_version`, `browser_user_agent`, `browser_version`, `system_locale`, `client_launch_id` y `client_heartbeat_session_id` (este se regenera cada 30 min), entre otros.
- Si mandás `browser_user_agent`, tiene que **coincidir** con el header `User-Agent`.
- También van `X-Discord-Locale` y `X-Debug-Options`. La docs no cubre `X-Discord-Timezone` **[sin verificar]**.
- **[nuestra]** El cliente se presenta como el **cliente web oficial en Chrome sobre Linux**: `os: "Linux"`, `browser: "Chrome"`, un `browser_user_agent` real de Chrome igual al `User-Agent`, y `release_channel: "stable"`.
- **[nuestra]** El `client_build_number` se saca **en cada arranque** de los assets de `https://discord.com/app` (es lo que hacen las librerías de usuario). Si falla, se usa el último guardado en caché. El método exacto queda **[sin verificar]**: lo resuelve el builder y lo documenta.
- **[nuestra]** Nos hacemos pasar por el **web** y no por el desktop por coherencia. El web habla con el mismo gateway y REST, y no hace falta inventar `native_build_number`. La voz del web oficial va por WebRTC; nosotros usamos el protocolo UDP de los clientes nativos y las librerías de voz. Esa mezcla podría ser una señal rara (**[sin verificar]**: no hay fuente sobre si Discord la mira). La alternativa es presentarse como desktop (`browser: "Discord Client"`), que exige copiar más campos.

### 6.5 Login por QR (remote auth)

Fuente: https://docs.discord.food/remote-authentication/desktop (2026-11-06).

1. Conectar por WS a `wss://remote-auth-gateway.discord.gg/?v=2`, con el header `Origin: https://discord.com`. **Otro Origin se rechaza.** La v1 del protocolo está discontinuada.
2. Generar un par **RSA-OAEP de 2048 bits** (e=65537, SHA-256 para el hash y para MGF1, sin label).
3. Recibir `hello` (`heartbeat_interval`, `timeout_ms`) y mandar `init` con `encoded_public_key`, que es la SPKI DER en base64.
4. Recibir `nonce_proof` con `encrypted_nonce`. Lo descifrás y mandás `nonce_proof` con `nonce` en base64url sin padding.
5. Recibir `pending_remote_init` con `fingerprint`, que es el SHA-256 de la clave pública en base64url. Verificar que coincida con la tuya; si no coincide, reconectar. Mostrar el QR con el contenido `https://discord.com/ra/<fingerprint>`.
6. Cuando el teléfono escanea llega `pending_ticket` con `encrypted_user_payload` (`id:discriminator:avatar:username`). Mostrar "¿sos vos, <username>?".
7. Cuando el usuario confirma llega `pending_login` con `ticket`. Si cancela llega `cancel`. En los dos casos el servidor cierra con 1000.
8. Hacer `POST /users/@me/remote-auth/login` con `{ticket}`. La respuesta trae `encrypted_token`, que se descifra con RSA-OAEP y se decodifica como UTF-8.
9. Mantener el heartbeat todo el tiempo y reconectar si falta un `heartbeat_ack`. Los cierres posibles son 4000, 4001, 4002 (reintentar), 4003 (expiró: generar un QR nuevo) y 1000.

Viabilidad:

- WebCrypto en Bun genera RSA-OAEP 2048 con SHA-256 y exporta SPKI (probado local).
- discordo y concord, dos clientes de terceros, ofrecen login por QR hoy (https://github.com/ayn2op/discordo, https://docs.rs/crate/concord/latest, 2026-11-06).
- **Riesgo:** concord avisa que el login por email y el de QR "may trigger a CAPTCHA, which Concord cannot solve" y recomienda el token (https://docs.rs/crate/concord/latest, 2026-11-06). Lo más probable es que el captcha aparezca en el paso 8. Si la respuesta trae `captcha_key` o `captcha_sitekey`, **no se intenta resolver**: se muestra "Discord pidió captcha, pegá el token" y se pasa a la alternativa **[nuestra]**.
- **Token pegado:** se explica en pantalla cómo sacarlo del cliente web (DevTools, Network, header `Authorization`). Se valida con `GET /users/@me`.

**Sesión [Gon + nuestra]:**

- Va en `~/.config/discord-tui/session.json`, con modo 0600 desde que se crea (open con mode 0o600, no chmod después), y la carpeta en 0700.
- Contiene el token, el user id y el `client_build_number` cacheado.
- Al arrancar, si los permisos no son 600, el programa se niega a arrancar.
- `discord-tui logout` borra el archivo.
- Guardarlo en un keyring (libsecret) queda como mejora para después **[nuestra]**.

### 6.6 Voz

Fuentes: https://docs.discord.com/developers/topics/voice-connections (oficial) y https://docs.discord.food/topics/voice-connections, las dos consultadas el 2026-11-06.

- **Entrar a un canal:**
  1. Mandar op 4 Voice State Update (`guild_id`, `channel_id`, `self_mute`, `self_deaf`) por el gateway principal.
  2. Esperar **dos** eventos: `VOICE_STATE_UPDATE` (trae `session_id`) y `VOICE_SERVER_UPDATE` (trae `token` y `endpoint`).
  3. Al `endpoint` le falta el esquema, así que hay que anteponer `wss://`.
  4. Si te cambiás de canal dentro del mismo guild, el token cambia y la sesión de voz no se reusa.
- **Voice gateway:**
  - Hay que pasar `?v=` siempre. La docs oficial marca v8 como recomendada (agrega buffered resume). discord.food lista v9, que agrega `channel_id` en identify y resume.
  - `@discordjs/voice` 0.19.2 usa `v=8` (probado local, en el código de `dist/index.js`).
  - Identify (op 0): `server_id`, `user_id`, `session_id`, `token` y **`max_dave_protocol_version`**. Si vale 0 o falta, el servidor entiende que no soportás DAVE y el canal te cierra con 4017.
- **UDP:**
  - IP discovery con un paquete de 74 bytes: tipo 0x1 o 0x2, largo 70, SSRC, dirección (64 bytes) y puerto, todo en big-endian.
  - Después va Select Protocol (op 1) con el modo de cifrado.
  - Antes de mandar o recibir audio hay que mandar Speaking (op 5) con flag `VOICE` (1<<0). Si no, te desconectan por SSRC inválido.
- **Cifrado de transporte:**
  - El modo **requerido** es `aead_xchacha20_poly1305_rtpsize` y el **preferido** es `aead_aes256_gcm_rtpsize`.
  - `xsalsa20_*`, `aead_aes256_gcm` (el que no es rtpsize) y `xsalsa20_poly1305_lite_rtpsize` están deprecated y se rechazan.
  - En los modos rtpsize el nonce es un contador de 32 bits que va al final del paquete. El AAD es el header RTP, los CSRC y el preámbulo de 4 bytes de la extensión.
  - Bun soporta `aes-256-gcm` nativo en `node:crypto`, pero **no** tiene `chacha20-poly1305` (`ERR_CRYPTO_UNKNOWN_CIPHER`, probado local). Si alguna vez se necesita XChaCha, va con `libsodium-wrappers` (0.8.4, `npm view`, 2026-11-06) o `@noble/ciphers`.
- **Opus:**
  - 48 kHz, estéreo, frames de 20 ms (960 muestras por canal); el timestamp RTP avanza de a 960.
  - El payload type es 120 (byte 0x78).
  - Al dejar de hablar se mandan 5 frames de silencio `F8 FF FE`. Del otro lado, recibir esos 5 frames quiere decir que esa persona dejó de hablar.
- **DAVE:**
  - Está basado en MLS (RFC 9420) y usa los opcodes de voz 21 a 31 (21 Prepare Transition, 22 Execute Transition, 23 Transition Ready, 24 Prepare Epoch, 25 External Sender, 26 Key Package, 27 Proposals, 28 Commit Welcome, 29 Announce Commit, 30 Welcome, 31 Invalid Commit Welcome).
  - Los opcodes 25, 26, 27, 28 y 30 son **binarios**: 2 bytes de seq opcional (solo de servidor a cliente), 1 byte de opcode y el payload.
  - El frame E2EE va dentro del payload Opus: AES-128-GCM con tag truncado de 8 bytes, nonce ULEB128, rangos sin cifrar, un byte de tamaño y el marcador mágico `0xFAFA`.
  - El cliente tiene que seguir soportando las versiones de DAVE que no fueron discontinuadas.
  - Fuentes: docs oficial y https://docs.discord.food/topics/opcodes-and-status-codes, 2026-11-06.
- **DAVE en JS: existe y anda en Bun.**
  - `@snazzah/davey` va por la 0.2.0, publicada el 2026-11-02. Es una implementación en Rust sobre OpenMLS, con binding napi para Node, licencia MIT y prebuild `linux-x64-gnu` (https://github.com/Snazzah/davey; `npm view @snazzah/davey optionalDependencies`, 2026-11-06).
  - En Bun 1.4.3 carga bien y da `DAVE_PROTOCOL_VERSION = 1` (probado local).
  - Los métodos de `DAVESession` son `setExternalSender`, `getSerializedKeyPackage`, `processProposals`, `processCommit`, `processWelcome`, `prepareTransition`, `executeTransition`, `encryptOpus`, `decrypt`, `setPassthroughMode`, `getVerificationCode` y `voicePrivacyCode`, entre otros (probado local).
- **`@discordjs/voice` integra DAVE.**
  - La 0.19.2 es del 2026-11-05. Depende de `@snazzah/davey ^0.1.9`; con esa versión se instaló davey 0.1.12, no la 0.2.0. Tiene las opciones `daveEncryption` y `decryptionFailureTolerance` (probado local, `index.d.ts`).
  - Su docs dice que davey "is the only supported DAVE protocol library" (https://discord.js.org/docs/packages/voice/main, 2026-11-06). La guía de discord.js advierte que davey puede no instalarse en producción si no lo instalás vos a mano (https://github.com/discordjs/guide/pull/1630/files, 2026-11-06).
  - Elige `aead_aes256_gcm_rtpsize` si hay AES nativo y cae a XChaCha si no (probado local).
  - Bajo Bun corre `generateDependencyReport()` y detecta Opus, AES nativo, davey y ffmpeg (probado local).
  - Se conecta a cualquier gateway con un **adapter** propio que implementa `sendPayload`, `onVoiceServerUpdate` y `onVoiceStateUpdate` (probado local, `index.d.ts`).
- **Voz con cuenta de usuario:**
  - El protocolo de voz no distingue entre bot y usuario: el identify usa el `user_id`, el `session_id` y el `token` de `VOICE_SERVER_UPDATE`.
  - La librería de selfbot `discord.js-selfbot-v13` usaba `@discordjs/voice` con este mismo esquema. concord (Rust, con davey de dependencia) y endcord anuncian llamadas de voz con cuenta de usuario hoy (https://docs.rs/crate/concord/latest, https://github.com/sparklost/endcord, 2026-11-06).
  - Que DAVE ande con una cuenta de usuario y `@discordjs/voice` **en Bun contra Discord real** queda **[sin verificar]**. Es lo primero que se prueba en la etapa 4.

### 6.7 Audio en Bun sobre PipeWire

- **Captura:**

  ```
  pw-record --raw --format s16 --rate 48000 --channels 2 --latency 20ms -
  ```

  Sale PCM por stdout. **Reproducción:** `pw-cat --playback --raw --format s16 --rate 48000 --channels 2 -`, que lee de stdin. `pw-cat` tiene `--raw`, `--format`, `--rate`, `--channels`, `--latency` y `--target` (`pw-cat --help`, probado local).
- **Opus:**
  - `@discordjs/opus` 0.11.0 (nativo, node-addon-api/pre-gyp) **carga y codifica y decodifica en Bun** (probado local).
  - `opusscript` 0.1.1 (WASM, sin cambios desde 2023-10) también anda (probado local).
  - Bun implementa Node-API "from scratch" y "most existing Node-API extensions work with Bun out of the box" (https://bun.com/docs/runtime/node-api, 2026-11-06).
- **ffmpeg:** no hace falta en el camino caliente.

### 6.8 Notificaciones

`notify-send` está instalado (probado local). Se llama con `Bun.spawn(["notify-send", "-a", "discord-tui", título, cuerpo])`, con los argumentos en un array (nunca un string de shell) y sin pasar el token. **[nuestra]** Solo se notifica si hay mención, DM o reply a vos, el canal no está silenciado en `user_guild_settings` y no lo estás mirando en ese momento.

### 6.9 Antecedentes

| Cliente | Lenguaje | Voz | QR | Imágenes | Fuente (2026-11-06) |
|---|---|---|---|---|---|
| discordo | Go | sí (build con libpulse o alsa) | sí | tag kitty-graphics, no confirmado | https://github.com/ayn2op/discordo |
| concord | Rust | sí, con PTT, supresión de ruido y DAVE vía `davey` | sí (avisa del captcha) | Kitty, iTerm2, Sixel, halfblocks | https://docs.rs/crate/concord/latest (2.7.0, 2026-11-05) |
| endcord | Python | sí, con RNNoise y PTT; DAVE no se menciona | sí | Kitty, ASCII | https://github.com/sparklost/endcord |
| vimcord, DiscordCLI | — | **[sin verificar]** (no los revisé) | | | |

Lecciones:

- concord es **la referencia más cercana**: usa la misma librería DAVE (`davey`) y tiene la misma lista de features. Su código sirve para leer cómo resuelve cada paso, no para copiarlo.
- Los tres evitan acciones que disparan los filtros antispam (abrir DMs nuevos, mandar solicitudes de amistad, crear threads). concord también avisa que abrir un DM con un desconocido puede bloquear la cuenta por un tiempo.
- discordo tiene la opción `no_spoof_tls_fingerprint`, o sea que **spoofea la huella TLS**. Nosotros **no** lo hacemos (sección 0) **[nuestra]**.

## 7. Decisiones técnicas clave

### 7.1 Gateway y REST: capa propia y delgada **[nuestra]**

Elegimos una capa propia de unas 1.500 a 2.500 líneas: WS, zlib-stream, heartbeat, resume, dispatch tipado, REST con colas y client properties. Las razones:

- `discord.js-selfbot-v13` está **archivada desde el 2025-10-11** (https://github.com/aiko-chan-ai/discord.js-selfbot-v13; última versión 3.7.1, `npm view`, 2026-11-06).
- Su fork comunitario `djs-selfbot-v13` (10.9.25, del 2026-10-31, https://github.com/002-sans/djs-selfbot-v13) sigue vivo, pero arrastra la API de discord.js v13, es CommonJS y pesado, y no controlamos qué headers y patrones manda.
- `discord-user-bots` no se toca desde 2025-03 (`npm view`, 2026-11-06).
- Una capa chica es fácil de auditar para que el token nunca se filtre, se acopla bien a un store propio y le deja al builder pasos verificables.
- Los tipos se pueden tomar de `discord-api-types` donde coincidan con los de usuario. Lo que falte, como READY de usuario o el op 37, se tipa a mano según discord.food.

Las alternativas: usar `djs-selfbot-v13` para salir más rápido, a cambio de menos control y del riesgo de que el fork se abandone, o portar la lógica de concord.

### 7.2 Voz: `@discordjs/voice` con un adapter propio primero, y davey directo como plan B **[nuestra]**

`@discordjs/voice` ya resuelve el voice gateway v8, la UDP con IP discovery, el cifrado rtpsize, DAVE con davey, el receive por SSRC y los cambios de transición. Le pasamos un adapter atado a nuestro gateway. Para el audio se le da Opus crudo (`StreamType.Opus`), codificado por nosotros desde `pw-record`, y del receive se decodifica Opus hacia `pw-cat`.

- Riesgos: está pensada para bots y Node 22 o más (su `engines` dice `node >=22.12.0`), y fija davey en ^0.1.x, cuando la última es 0.2.0. Hay que fijar una versión que funcione.
- Plan B: si en la etapa 4 falla con la cuenta de usuario en Bun, se implementa `voice/` a mano sobre `@snazzah/davey` 0.2.0 siguiendo la sección 6.6. Son unas 1.500 líneas y concord sirve de guía.

### 7.3 Audio: subprocesos de PipeWire **[nuestra]**

Se usan `pw-record` y `pw-cat` con PCM s16le a 48 kHz estéreo por pipes. Son pocas piezas, sin bindings nativos de audio, y Hyprland y PipeWire ya están.

- **Mezcla:** un mixer propio suma el PCM decodificado de cada SSRC con saturación y lo manda a un único `pw-cat`.
- **Jitter buffer:** uno simple de 60 ms por usuario.
- **Alternativas:** bindings nativos de PipeWire, que en Bun serían frágiles, o ffmpeg con `-f pulse`, que es más pesado.

### 7.4 Opus: `@discordjs/opus` **[nuestra]**

Es nativo, anda en Bun (probado local) y es rápido. Si el build nativo falla en otra máquina, se cae a `opusscript`.

### 7.5 UI: OpenTUI con Solid o React

**[nuestra]** Usamos `@opentui/solid` por su reactividad fina, que le sirve a una lista de mensajes con mucho cambio. La alternativa es `@opentui/react`, si el builder la conoce mejor. Lo que importa es elegir **una** y fijar la versión.

Layout:

- columna de guilds (iconos o iniciales);
- columna de canales;
- mensajes;
- miembros (se muestra u oculta);
- abajo el composer y la barra de voz y estado.

**Keymap [nuestra]**, sobre `@opentui/keymap`:

| Tecla | Acción |
|---|---|
| `j` / `k` | moverse |
| `h` / `l` | cambiar de panel |
| `gg` / `G` | ir al principio o al final |
| `i` | escribir |
| `Esc` | modo normal |
| `r` | reply |
| `e` | editar el propio |
| `dd` | borrar el propio, con confirmación |
| `+` | reaccionar con el selector de emoji |
| `Ctrl-k` | quick switcher fuzzy de canales y DMs |
| `gu` | ir al próximo no leído |
| `v` | entrar o salir de voz en el canal de voz seleccionado |
| `m` | mute |
| `D` | deafen |
| `Espacio` sostenido | PTT |
| `?` | ayuda |
| `q` | salir |

El mouse es un extra: click para seleccionar y scroll.

### 7.6 PTT en terminal

Una terminal no avisa cuando soltás una tecla, salvo con el **Kitty keyboard protocol** activado con los "report event types". Ghostty y Kitty lo soportan (https://ghostty.org/docs/features, 2026-11-06), pero que OpenTUI exponga los eventos de soltar tecla queda **[sin verificar]**.

**[nuestra]** El plan:

1. Primero, PTT por eventos press y release si OpenTUI los entrega.
2. Si no los entrega, PTT con un toggle: una tecla prende la transmisión y la misma la apaga, con un indicador grande en pantalla.
3. PTT global, fuera de foco, vía un bind de Hyprland que llama a un socket local. Queda como mejora para después.

Llamadas de DM: usan op 4 con `guild_id: null` y además los eventos de call (op 13 Call Connect). **[nuestra]** Entran en la v1 si salen fácil después de los canales de guild. Si no, pasan a v1.1.

### 7.7 Store y caché

**[nuestra]** El estado vive en memoria y se normaliza por id. Los mensajes se guardan por canal, en un ring de hasta 500. El historial se pide por REST (`GET /channels/{id}/messages?before=`) a medida que hacés scroll.

- No hay caché en disco en la v1: menos superficie para filtraciones y menos estado viejo.
- Al reconectar con resume no se pierde nada. Si hubo un identify nuevo, se vuelven a pedir los últimos mensajes del canal abierto.
- Hay una **outbox**: cada envío tiene un `nonce` (el cliente oficial lo usa para deduplicar) y su estado es pending, sent o failed. Los que fallan quedan visibles.

### 7.8 Bajar los motivos de ban (sin evadir seguridad)

Hecho: la docs dice que `X-Super-Properties` cuenta para los sistemas antiabuso (https://docs.discord.food/reference, 2026-11-06). Lo demás que sigue son prácticas que repiten los clientes de terceros, **sin una fuente oficial sobre qué dispara un ban**: el resto es **[sin verificar]**.

**[nuestra]**:

- Mandar siempre las client properties y los headers coherentes (6.4), con el build number actual.
- Usar una sola sesión de gateway.
- No hacer polling. El historial se pide solo cuando hacés scroll, y la lista de miembros solo para el canal abierto (op 37 con un rango chico).
- No mandar el op 8 masivo ni abrir DMs nuevos.
- Respetar todos los 429.
- El typing se manda como máximo cada 8 s y solo mientras escribís.
- Marcar como leído (ack) solo el canal que estás mirando, con debounce. **[sin verificar]** Falta saber si conviene mandar ack: el cliente oficial lo manda, y no mandarlo deja todo "no leído" en el teléfono. Recomendación: mandarlo.
- No mandar nada en segundo plano que el cliente oficial no mande.
- Para la presencia, imitar al cliente oficial: online al conectar, e idle opcional por inactividad.

## 8. Seguridad del token (checklist del builder)

- El token solo existe en `auth` y en el header `Authorization` de `rest` y `gateway`. Para eso hay un tipo opaco `Secret` cuyo `toString()` devuelve `"[redacted]"`.
- El logger usa una lista de campos permitidos y tiene un test que falla si aparece un string con forma de token.
- En los errores de red se loguea solo el método, la ruta, el status y el código de Discord, nunca los headers.
- El archivo de sesión se crea con modo 0600 y la carpeta con 0700, y hay un test que lo verifica.
- Los subprocesos (`pw-*`, `notify-send`) se lanzan con `env` limpio.
- No hay modo "debug" que vuelque payloads con el token. Si se graba una captura del gateway para tests, se redacta `d.token` y `auth_token`.

## 9. Etapas

Cada etapa termina en algo que Gon puede usar o mirar, y se verifica **contra la cuenta real**.

**E0. Esqueleto.**

- Arranca Bun con OpenTUI 0.8.2 fijada, muestra un layout vacío de tres columnas y hay tests corriendo.
- *Hecho:* `bun run dev` dibuja el layout, `bun test` pasa, `q` sale.
- *Verificar:* manual y con CI local.

**E1. Login.**

- QR, token pegado y `session.json` 0600.
- *Hecho:* escaneás el QR con el teléfono y aparece "logueado como <username>". Si reiniciás, entra sin pedir login. `logout` borra la sesión. Si hay captcha, cae a pegar el token con un mensaje claro.
- *Verificar:* contra la cuenta real; `stat -c %a session.json` da 600; `grep` del token en los logs da vacío.

**E2. Leer.**

- Gateway (identify, READY, resume y reconnect), guilds, canales, DMs, historial, mensajes en vivo, no leídos, imágenes inline, lista de miembros con op 37 y presencia.
- *Hecho:* navegás con j/k y Ctrl-k. Un mensaje que mandás desde el teléfono aparece en menos de 1 s. Si cortás el wifi 30 s, se reconecta y no falta ningún mensaje. Una imagen se ve inline en Ghostty y, si se usa `OPENTUI_IMAGE_PROTOCOL=blocks`, sale en bloques o como link.
- *Verificar:* contra la cuenta real, en un servidor propio de prueba con los mensajes contados.

**E3. Escribir.**

- Mandar, reply, @mención con autocompletado, editar y borrar los propios, reacciones, typing, outbox, ack y notificaciones.
- *Hecho:* todo lo anterior se ve bien en el teléfono. Un envío con la red cortada queda como "failed" y se reintenta con una tecla. Una mención desde otra cuenta o desde el teléfono dispara `notify-send`.
- *Verificar:* contra la cuenta real en el servidor de prueba. Un test de la outbox con un servidor falso que devuelve 429 y 500.

**E4. Voz (transporte y DAVE juntos contra Discord; por separado en local).**

- E4a, local y sin red:
  - pw-record → Opus → pw-cat hace eco en los auriculares con menos de 150 ms de latencia;
  - loopback UDP con RTP y `aead_aes256_gcm_rtpsize` entre dos sockets;
  - dos `DAVESession` de davey hacen el handshake y un frame cifrado con una se descifra con la otra.
- E4b, contra la cuenta real:
  - entrar a un canal de voz del servidor de prueba con `@discordjs/voice` y el adapter, con DAVE activo;
  - el teléfono de Gon, conectado como segundo participante, escucha y es escuchado;
  - se ve quién habla;
  - mute, deafen y PTT andan;
  - el canal muestra el escudo E2EE en el teléfono **[sin verificar]** (hay que ver si la app lo muestra);
  - salir de verdad libera el canal.
- *Hecho:* una llamada de 10 minutos sin cortes, y el código de privacidad (`voicePrivacyCode`) coincide con el que muestra el teléfono **[sin verificar]** (hay que ver si el teléfono lo muestra).
- *Plan B:* si E4b falla (un 4017 persistente, o el adapter no anda en Bun), se pasa a `voice/` propio sobre davey 0.2.0 y se repite E4b.
- *Verificar:* local con tests, y contra la cuenta real con la llamada.

**E5. Pulido.**

- Keymap completo y ayuda `?`, temas, settings de audio (dispositivo con `--target`, volumen por usuario), llamadas de DM si no entraron antes, y manejo de errores visibles.
- *Hecho:* Gon usa discord-tui un día entero de laburo sin abrir la app oficial.

## 10. Riesgos y preguntas abiertas

1. **Ban:** aceptado (sección 0). Se mitiga con la sección 7.8.
2. **Captcha en el login QR:** probable según concord. La salida es pegar el token.
3. **El build number y la forma del identify cambian:** depende de lo que se descubra en el arranque y de discord.food. Si Discord cambia algo, el login o el READY pueden romperse sin aviso, así que los errores de identify se muestran en pantalla.
4. **@discordjs/voice con usuario y en Bun:** **[sin verificar]** en real (E4b). El plan B está definido.
5. **Cambios de DAVE:** Discord puede subir la versión del protocolo. La versión de davey se fija y se actualiza a propósito. La docs exige soportar las versiones de DAVE que no se discontinuaron.
6. **Eventos de soltar tecla en OpenTUI para PTT:** **[sin verificar]**. La salida es el toggle.
7. **Op 37 y lista de miembros:** el formato exacto está **[sin verificar]**, y en servidores enormes la lista es parcial por diseño.
8. **OpenTUI 0.x:** puede romper la API, así que la versión va fijada.
9. **Mezclar la identidad de web con voz UDP:** **[sin verificar]** si importa.
10. **Pregunta para Gon (no bloquea):** ¿quiere llamadas de DM en la v1 sí o sí, o alcanza con los canales de voz de servidor? Este doc asume que van si salen fácil.

## 11. Lo que queda para el builder

- Elegir entre Solid y React (7.5) y dejar fijadas las versiones exactas de `@opentui/*`, `@discordjs/voice`, `@snazzah/davey` y `@discordjs/opus`.
- Capturar del cliente web oficial, con la cuenta de Gon y en su navegador:
  - el `capabilities` del identify;
  - las client properties completas;
  - los headers de REST;
  - el payload del op 37 y el de los acks.

  Documentarlo en `docs/protocol-notes.md`, con el token redactado.
- Resolver cómo se saca el `client_build_number`.
- Escribir el plan en pasos chicos siguiendo las etapas de la sección 9, cada uno con un comando o una acción que verifique el "hecho".
- Armar un servidor de Discord propio de prueba, con un canal de texto y uno de voz, para todas las pruebas reales.
- Revisar vimcord y DiscordCLI si hace falta (quedaron **[sin verificar]**).

# Backlog post-v1

Pendientes que quedan fuera de la v1 (spec 9 y decisiones nuestras). Se completan con lo que salga del
checkpoint de Gon de E5 (Task 6).

## Funcionalidad

- **Llamadas de DM** (fuera de E5 por decisión [nuestra]): voz en MD/grupo, mismo camino que E4b/E4c.
- **Keyring** para el token en vez de `session.json` (la spec lo deja para después).
- **Push-to-talk global con Hyprland**: hoy `Espacio` funciona solo con la TUI enfocada.
- **VAD con modelo** (silero/webrtc) en vez del VAD de energía por RMS.

## Deuda técnica conocida

- `@discordjs/opus` 0.11.0 no trae prebuild para el ABI de Bun 1.4.3; el códec cae a `opusscript` (WASM).
  Si en la máquina de Gon carga el nativo, se usa ese y esto se puede borrar.
- El handshake DAVE de dos sesiones no se probó en local (salió el camino (b) del spike): se verifica en E4b/E4c.
- E4b y E4c (voz real con Discord) están implementadas y probadas contra un servidor de voz falso local; falta
  el spike de Gon contra Discord real (DAVE con cuenta de usuario) y la llamada de 10 minutos con [2ª].
- Emojis custom se muestran como `:nombre:` (no como imagen inline). Las imágenes de adjuntos y embeds sí van inline.
- El composer escribe siempre al final del texto (no hay cursor movible con flechas).
- La integración con `@opentui/keymap` no se hizo: la app usa `useKeyboard` crudo y `SPEC_KEYS` es solo la
  tabla de datos para la ayuda. Unificarlo es opcional.

# AGENTS.md — reglas del repo

discord-tui usa la cuenta personal de Gon. Estas reglas mandan sobre cualquier otra cosa.

1. Nunca leas, abras, imprimas ni copies el token de Discord ni `~/.config/discord-tui/session.json`. Nunca corras comandos que lo lean (`cat`, `jq`, `grep` sobre esa carpeta, `bun scripts/leak-check.ts`). Si una tarea parece pedirlo, frená y preguntale a Gon.
2. Nunca veas payloads autenticados crudos. Trabajás solo con `fixtures/`, que Gon ya redactó.
3. Toda prueba contra la cuenta real es un **🧍 Paso de Gon**: frenás y esperás su resultado.
4. Después de cada tarea: `bun test`, `bun run typecheck`, commit y `git push origin main`.
5. Versiones exactas (`bun add --exact`). No actualices dependencias sin que el plan lo diga.
6. En tests, los tokens falsos se arman con `fakeToken()`; nunca escribas un literal con forma de token.
7. Cómo correr: `bun install`, `bun test`, `bun run typecheck`, `bun run dev`.

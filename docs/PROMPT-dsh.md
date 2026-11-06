# Prompt para arrancar en DeepSeek Harness

Pegar en una sesión nueva de dsh abierta en el workspace `~/projects/discord-tui`, con DeepSeek V4 Pro.

```
Vas a construir discord-tui, un cliente de Discord para la terminal hecho con OpenTUI y Bun, que uso todos los días con mi cuenta personal: texto y voz con cifrado DAVE. Trabajás en este repo: /home/gonza/projects/discord-tui

Antes de tocar nada, leé completos y en este orden:
1. docs/superpowers/specs/2026-11-06-discord-tui-design.md (el diseño aprobado)
2. docs/superpowers/plans/README.md (el índice de planes: orden de etapas, dependencias y quién verifica cada cosa)
3. El plan de la primera etapa que marca el índice (docs/superpowers/plans/2026-11-06-discord-tui-e0.md)
Si ya existe AGENTS.md en la raíz, leelo también: son las reglas del repo y mandan. Si no existe, lo creás vos en la primera tarea de E0.

Después ejecutá los planes en el orden del índice. Dentro de cada plan, hacé las tareas en orden y paso por paso:
- Primero escribí el test que falla y corrélo para ver que falla. Después escribí el código mínimo y corré el test para ver que pasa.
- Corré los comandos de verificación del plan y pegá el output antes de tildar cada checkbox (- [ ] a - [x] en el archivo del plan).
- Al terminar cada tarea, hacé commit y git push. No acumules tareas sin subir.
- Usá exactamente las versiones, nombres de archivos, firmas y valores que fija el plan. No agregues features que el plan no pide.

Reglas que no se rompen:
- Nunca leas, imprimas ni copies mi token de Discord ni el archivo de sesión. Tampoco abras payloads autenticados crudos. Trabajás solo con los fixtures sanitizados de fixtures/. Si algo te pide ver el token, frená y avisame.
- Cuando llegues a un paso marcado "🧍 Paso de Gon", frená. Decime exactamente qué tengo que hacer y qué tengo que ver, y esperá a que te confirme antes de seguir.
- Si un plan choca con la realidad (una versión que no existe, una API que cambió, un spike que falla), no improvises un cambio grande. Si el plan trae un plan B, usalo y anotalo en el plan. Si no trae, frená y explicame qué encontraste y qué proponés.
- Al terminar cada etapa, frená: pasame un resumen corto (qué anda, cómo lo pruebo, commits) y esperá mi OK antes de arrancar la siguiente.

Arrancá leyendo esos archivos y contame en 5 líneas qué vas a hacer en la etapa E0.
```

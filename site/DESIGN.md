# DESIGN.md — landing de zcord (site/)

Solo para la landing (zcord.gonzalorocca.com). La app de terminal tiene su propio tema (`src/ui/theme.ts`) y esto no
lo reemplaza.

## Idea
Aire de TUI sin copiar la app: una sola columna de 80 caracteres, como una terminal, contada como un `cat README`.
Simple: texto, líneas de caja y una sola imagen (la demo).

## Tokens
| token | valor | uso |
|---|---|---|
| `--ground` | `#141311` | fondo de toda la página (grafito cálido) |
| `--ink` | `#ebe6dc` | texto y logo |
| `--dim` | `#8e897f` | texto secundario, prompts, ramas de `tree` (5,3:1 sobre el fondo) |
| `--rule` | `#3b3833` | bordes de caja y líneas de sección |
| `--amber` | `#f2b33d` | el único acento: `$`, teclas, caja "probalo", botón copiar, cursor, selección |
| `--amber-ink` | `#1b1608` | texto sobre ámbar |

Tipografía: Iosevka 400/700, servida desde `site/fonts/` y recortada a latín + líneas de caja + bloques
(`pyftsubset`, unos 17 KB por peso). Cuerpo 17px/1.55 (15px en celular), números tabulares.

## Componentes
- **Prompt**: `gon@sanluis ~ $` en dim, el comando en ink y el cursor ámbar. Tipea una vez al cargar; es el único
  momento animado y respeta `prefers-reduced-motion`.
- **Logo**: SVG generado desde la grilla de medios bloques (`▀▄█`); cada celda es un carácter. Usa `currentColor`
  y tiene un ancho máximo de 46ch.
- **Caja con título en el borde** (`.box > .t`): borde de 1px, el título se apoya sobre el borde y la acción
  (`[ copiar ]`) va sobre el borde de abajo. La caja de instalar va en ámbar, la de riesgo en ámbar apagado.
- **Encabezado de sección** (`h2`): el nombre en negrita más una línea que llena el resto del ancho.
- **Listas**: `qué hace` es la salida de `tree` (`├──`/`└──`, grilla `4ch 10ch 1fr`), las teclas van en dos
  columnas y los requisitos son `necesita` / `opcional`.

## Reglas
- Sin sombras, degradés, glow ni tarjetas. La profundidad la dan solo las cajas de 1px.
- El ámbar es el único color: no se agregan más.
- Teclas de la página: `y` copia el comando, `j` y `k` bajan y suben, `g` y `G` van al principio y al final.

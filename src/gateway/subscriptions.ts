export type MemberRange = [number, number];

/** Tamaño de cada ventana de la lista de miembros (como el cliente oficial: 0-99, 100-199, …). */
export const MEMBER_RANGE_SIZE = 100;
/** Máximo de rangos por canal en un op 37: el primero fijo y una ventana de dos que se corre. */
export const MAX_MEMBER_RANGES = 3;

/** Op 37 (GUILD_SUBSCRIPTIONS_BULK) con la forma de fixtures/browser/op37.json. */
export function buildGuildSubscription(
  guildId: string,
  channelId: string,
  ranges: MemberRange[] = [[0, MEMBER_RANGE_SIZE - 1]],
): { op: 37; d: unknown } {
  return {
    op: 37,
    d: {
      subscriptions: {
        // `members` (si va) es una lista de ids de usuario, no rangos: un rango ahí hace que
        // Discord cierre el gateway. La lista de miembros sale de los rangos de `channels`.
        [guildId]: {
          typing: true,
          threads: true,
          activities: true,
          channels: { [channelId]: ranges.map(([from, to]): MemberRange => [from, to]) },
        },
      },
    },
  };
}

/**
 * Rangos para ver hasta la ventana `chunk` (0 = filas 0-99): siempre 0-99 y, como mucho, la
 * ventana anterior y esa. `[[0,99]]` → `[[0,99],[100,199]]` → `[[0,99],[100,199],[200,299]]`
 * → `[[0,99],[200,299],[300,399]]` …
 */
export function memberRangesUpTo(chunk: number): MemberRange[] {
  const chunks = [...new Set([0, chunk - 1, chunk].filter((c) => c >= 0))].sort((a, b) => a - b);
  return chunks
    .slice(-MAX_MEMBER_RANGES)
    .map((c): MemberRange => [c * MEMBER_RANGE_SIZE, c * MEMBER_RANGE_SIZE + MEMBER_RANGE_SIZE - 1]);
}

/**
 * La siguiente ventana a pedir cuando el usuario llega al final de lo cargado, o `null` si no hay
 * más: si Discord no llenó el último rango pedido, la lista termina ahí.
 */
export function nextMemberRanges(subscribed: MemberRange[], loadedRows: number): MemberRange[] | null {
  const lastEnd = subscribed.reduce((max, [, to]) => Math.max(max, to), -1);
  if (loadedRows <= lastEnd) return null;
  return memberRangesUpTo(Math.floor((lastEnd + 1) / MEMBER_RANGE_SIZE));
}

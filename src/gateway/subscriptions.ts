/** Op 37 (GUILD_SUBSCRIPTIONS_BULK) con la forma de fixtures/browser/op37.json. */
export function buildGuildSubscription(
  guildId: string,
  channelId: string,
  range: [number, number] = [0, 99],
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
          channels: { [channelId]: [range] },
        },
      },
    },
  };
}

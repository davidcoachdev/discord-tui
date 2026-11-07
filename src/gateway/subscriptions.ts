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
        [guildId]: {
          typing: true,
          threads: false,
          activities: true,
          members: [range],
          member_updates: false,
          channels: { [channelId]: [range] },
          thread_member_lists: {},
        },
      },
    },
  };
}

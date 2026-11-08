import type { Store } from "../../src/store/store";

/** Emojis custom en #general de la demo: jumbo, reacciones custom y texto mezclado. Ids y nombres falsos. */
const GENERAL = "920000000000000002";
const GUILD = "910000000000000001";
export const DEMO_EMOJI = {
  kek: "950000000000000001",
  baile: "950000000000000002",
  jumboMsg: "930000000000000903",
  reactedMsg: "930000000000000904",
  mixedMsg: "930000000000000905",
};

export function seedEmoji(store: Store): void {
  const base = {
    channel_id: GENERAL,
    guild_id: GUILD,
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_everyone: false,
    referenced_message: null,
    reactions: [],
  };
  const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const cinlo = { id: "900000000000000102", username: "cinlo", global_name: "CinLo💜" };
  const ragnar = { id: "900000000000000101", username: "ragnar", global_name: "Ragnar" };
  const messages = [
    { ...base, id: DEMO_EMOJI.jumboMsg, author: cinlo, timestamp: at(398), content: `<:kek:${DEMO_EMOJI.kek}> <a:baile:${DEMO_EMOJI.baile}> 🎉` },
    {
      ...base,
      id: DEMO_EMOJI.reactedMsg,
      author: ragnar,
      timestamp: at(397),
      content: "ya anda el voice en la terminal",
      reactions: [
        { emoji: { id: DEMO_EMOJI.kek, name: "kek" }, count: 2, me: true },
        { emoji: { id: DEMO_EMOJI.baile, name: "baile", animated: true }, count: 1, me: false },
        { emoji: { id: null, name: "🔥" }, count: 4, me: false },
      ],
    },
    { ...base, id: DEMO_EMOJI.mixedMsg, author: cinlo, timestamp: at(396), content: `nooo <:kek:${DEMO_EMOJI.kek}> qué crack` },
  ];
  for (const d of messages) store.dispatch({ type: "gw", t: "MESSAGE_CREATE", d });
}

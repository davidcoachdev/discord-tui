import type { Store } from "../../src/store/store";

/** Una encuesta y un sticker en #general de la demo. Ids y nombres falsos. */
const GENERAL = "920000000000000002";
const GUILD = "910000000000000001";
export const DEMO_POLL_ID = "930000000000000901";
export const DEMO_STICKER_MSG_ID = "930000000000000902";

export function seedPolls(store: Store): void {
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
  store.dispatch({
    type: "gw",
    t: "MESSAGE_CREATE",
    d: {
      ...base,
      id: DEMO_POLL_ID,
      author: { id: "900000000000000103", username: "dfuentes", global_name: "dfuentes" },
      content: "",
      timestamp: new Date(Date.now() - 400 * 60_000).toISOString(),
      poll: {
        question: { text: "¿Qué jugamos el viernes?" },
        answers: [
          { answer_id: 1, poll_media: { text: "Mu Online", emoji: { id: null, name: "⚔️" } } },
          { answer_id: 2, poll_media: { text: "Ajedrez", emoji: { id: null, name: "♟️" } } },
          { answer_id: 3, poll_media: { text: "Nada, a programar" } },
        ],
        expiry: new Date(Date.now() + 5 * 3_600_000).toISOString(),
        allow_multiselect: false,
        layout_type: 1,
        results: {
          is_finalized: false,
          answer_counts: [
            { id: 1, count: 5, me_voted: false },
            { id: 2, count: 3, me_voted: true },
            { id: 3, count: 1, me_voted: false },
          ],
        },
      },
    },
  });
  store.dispatch({
    type: "gw",
    t: "MESSAGE_CREATE",
    d: {
      ...base,
      id: DEMO_STICKER_MSG_ID,
      author: { id: "900000000000000102", username: "celes", global_name: "Celes💜" },
      content: "",
      timestamp: new Date(Date.now() - 399 * 60_000).toISOString(),
      sticker_items: [{ id: "960000000000000001", name: "Wumpus saluda", format_type: 1 }],
    },
  });
}

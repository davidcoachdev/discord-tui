import type { Store } from "../../src/store/store";

const GENERAL = "920000000000000002";
const DEVLAND = "920000000000000006";
const G1 = "910000000000000001";
const RAGNAR = "900000000000000101";
const ZERO = "900000000000000106";

/**
 * Mensajes nuevos de la demo: en #general se leyó hasta el mensaje 7, así que los últimos quedan
 * debajo del divisor rojo; en #devland hay más sin leer que los cargados (barra "↑ N+ mensajes nuevos").
 * Va antes de seleccionar el canal: el divisor se calcula al abrirlo.
 */
export function seedUnread(store: Store): void {
  store.dispatch({
    type: "gw",
    t: "CHANNEL_UNREAD_UPDATE",
    d: { channel_id: GENERAL, last_message_id: "930000000000001010", last_read_message_id: "930000000000001007", mention_count: 1 },
  });
  // #devland: leído hasta antes de lo cargado (los ids de la demo son de enero de 2022).
  store.dispatch({
    type: "gw",
    t: "CHANNEL_UNREAD_UPDATE",
    d: { channel_id: DEVLAND, last_message_id: "930000000000001103", last_read_message_id: "930000000000001000", mention_count: 2 },
  });
  const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const devland = [
    [1101, RAGNAR, "¿alguien probó bun 1.4 con opentui?", 50],
    [1102, ZERO, "sí, anda joya, el scrollbox nuevo es otra cosa", 45],
    [1103, RAGNAR, "buenísimo, lo pruebo a la noche", 44],
  ] as const;
  store.dispatch({
    type: "messages/page",
    channelId: DEVLAND,
    mode: "latest",
    messages: devland.map(([n, author, content, minutesAgo]) => ({
      id: `93000000000000${n}`,
      channel_id: DEVLAND,
      guild_id: G1,
      author: { id: author, username: author === RAGNAR ? "ramiro" : "zero", global_name: author === RAGNAR ? "Ramiro" : "zero" },
      content,
      timestamp: at(minutesAgo),
      edited_timestamp: null,
      attachments: [],
      embeds: [],
      mentions: [],
      mention_everyone: false,
      referenced_message: null,
      reactions: [],
    })) as never,
  });
}

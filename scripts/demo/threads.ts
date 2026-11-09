import type { Store } from "../../src/store/store";

/** Hilos y un foro para la demo. Ids y nombres falsos, como el resto de demo-state. */
const GUILD = "910000000000000001";
const CAT_COMMUNITY = "920000000000000051";
const GENERAL = "920000000000000002";
const DEVLAND = "920000000000000006";
const ME = "900000000000000001";
const RAGNAR = "900000000000000101";
const CINLO = "900000000000000102";

export const DEMO_THREADS = {
  forum: "920000000000000700",
  ajedrez: "920000000000000801",
  musica: "920000000000000802",
  opentui: "920000000000000803",
  postBug: "920000000000000811",
  postIdea: "920000000000000812",
  postViejo: "920000000000000813",
};

function thread(id: string, parent: string, name: string, lastMessageId: string, messageCount: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    guild_id: GUILD,
    parent_id: parent,
    type: 11,
    name,
    owner_id: RAGNAR,
    last_message_id: lastMessageId,
    message_count: messageCount,
    member_count: 3,
    thread_metadata: { archived: false, locked: false, auto_archive_duration: 1440, archive_timestamp: new Date().toISOString() },
    ...extra,
  };
}

function message(id: string, channelId: string, author: [string, string, string], content: string, minutesAgo: number) {
  return {
    id,
    channel_id: channelId,
    guild_id: GUILD,
    author: { id: author[0], username: author[1], global_name: author[2] },
    content,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    edited_timestamp: null,
    attachments: [],
    embeds: [],
    mentions: [],
    mention_everyone: false,
    referenced_message: null,
    reactions: [],
  };
}

export function seedThreads(store: Store): void {
  store.dispatch({
    type: "gw",
    t: "CHANNEL_CREATE",
    d: { id: DEMO_THREADS.forum, guild_id: GUILD, type: 15, name: "🆘-ayuda", position: 4, parent_id: CAT_COMMUNITY, permission_overwrites: [] },
  });
  store.dispatch({
    type: "gw",
    t: "THREAD_LIST_SYNC",
    d: {
      guild_id: GUILD,
      channel_ids: [GENERAL, DEVLAND, DEMO_THREADS.forum],
      threads: [
        thread(DEMO_THREADS.ajedrez, GENERAL, "torneo de ajedrez", "939000000000000910", 12),
        thread(DEMO_THREADS.musica, GENERAL, "qué música para codear", "939000000000000700", 4),
        thread(DEMO_THREADS.opentui, DEVLAND, "opentui con solid", "939000000000000800", 7),
        thread(DEMO_THREADS.postBug, DEMO_THREADS.forum, "no me anda el micrófono en pipewire", "939000000000000950", 5),
        thread(DEMO_THREADS.postIdea, DEMO_THREADS.forum, "idea: modo compacto para la lista", "939000000000000600", 2, {
          thread_metadata: { archived: false, locked: true },
        }),
      ],
      members: [],
    },
  });
  // Uno viejo, archivado: se ve en el foro como los que trae "cargar posts archivados".
  store.dispatch({
    type: "threads/loaded",
    guildId: GUILD,
    threads: [thread(DEMO_THREADS.postViejo, DEMO_THREADS.forum, "cómo instalar en arch", "939000000000000100", 9, { thread_metadata: { archived: true, locked: false } })],
  });
  // Los dos los seguís (tienen read state): el torneo está leído y el de opentui tiene mensajes nuevos.
  store.dispatch({ type: "gw", t: "MESSAGE_ACK", d: { channel_id: DEMO_THREADS.ajedrez, message_id: "939000000000000910" } });
  store.dispatch({ type: "gw", t: "MESSAGE_ACK", d: { channel_id: DEMO_THREADS.opentui, message_id: "939000000000000700" } });
  store.dispatch({
    type: "messages/page",
    channelId: DEMO_THREADS.ajedrez,
    messages: [
      message("939000000000000901", DEMO_THREADS.ajedrez, [RAGNAR, "ramiro", "Ramiro"], "arrancamos el sábado a las 18, ¿quién se anota?", 50),
      message("939000000000000905", DEMO_THREADS.ajedrez, [CINLO, "celes", "Celes💜"], "yo! blitz 5+3 por favor", 30),
      message("939000000000000910", DEMO_THREADS.ajedrez, [ME, "gon", "Gon"], "anotado, llevo el tablero de la terminal ♟", 5),
    ] as never,
    mode: "latest",
  });
}

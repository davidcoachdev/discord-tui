import type { ApiPoll, AppState, StickerItem } from "../types";

type RawPoll = ApiPoll;

export interface PollAnswerView {
  id: number;
  text: string;
  /** Unicode tal cual, o `:nombre:` si es un emoji del servidor. */
  emoji: string | null;
  count: number;
  percent: number;
  meVoted: boolean;
}

export interface PollView {
  question: string;
  answers: PollAnswerView[];
  total: number;
  multiselect: boolean;
  expiry: string | null;
  /** Vencida o con resultados finales: no se puede votar. */
  ended: boolean;
}

/** Cuentas, porcentajes y estado de una encuesta; `now` en ms para saber si ya venció. */
export function buildPollView(raw: RawPoll, now: number): PollView {
  const counts = new Map<number, { count: number; me: boolean }>();
  for (const item of raw.results?.answer_counts ?? []) {
    if (typeof item?.id === "number") counts.set(item.id, { count: Math.max(0, item.count ?? 0), me: item.me_voted === true });
  }
  const answers = (raw.answers ?? []).filter((a) => typeof a?.answer_id === "number");
  const total = answers.reduce((sum, a) => sum + (counts.get(a.answer_id!)?.count ?? 0), 0);
  const views: PollAnswerView[] = answers.map((a) => {
    const hit = counts.get(a.answer_id!);
    const count = hit?.count ?? 0;
    const emoji = a.poll_media?.emoji;
    return {
      id: a.answer_id!,
      text: String(a.poll_media?.text ?? ""),
      emoji: emoji && (emoji.name || emoji.id) ? (emoji.id ? `:${emoji.name ?? "emoji"}:` : String(emoji.name)) : null,
      count,
      percent: total > 0 ? Math.round((count * 100) / total) : 0,
      meVoted: hit?.me === true,
    };
  });
  const expiry = typeof raw.expiry === "string" ? raw.expiry : null;
  const expiryMs = expiry ? Date.parse(expiry) : NaN;
  const expired = Number.isFinite(expiryMs) && expiryMs <= now;
  const finalized = raw.results?.is_finalized === true;
  return {
    question: String(raw.question?.text ?? ""),
    answers: views,
    total,
    multiselect: raw.allow_multiselect === true,
    expiry,
    ended: expired || finalized,
  };
}

/** Los `answer_ids` del próximo voto al tocar `answerId`: multiselección alterna, única reemplaza, repetir saca el voto. */
export function nextPollVote(poll: PollView, answerId: number): number[] {
  const mine = poll.answers.filter((a) => a.meVoted).map((a) => a.id);
  if (poll.multiselect) {
    return mine.includes(answerId) ? mine.filter((id) => id !== answerId) : [...mine, answerId].sort((a, b) => a - b);
  }
  return mine.length === 1 && mine[0] === answerId ? [] : [answerId];
}

export function toStickers(raw: unknown): StickerItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s.id === "string")
    .map((s) => ({ id: s.id, name: String(s.name ?? "sticker"), formatType: Number(s.format_type ?? 1) }));
}

/** MESSAGE_POLL_VOTE_ADD / _REMOVE: `{ user_id, channel_id, message_id, guild_id?, answer_id }`, uno por respuesta. */
export function applyPollVote(state: AppState, t: string, d: any): AppState {
  const channelId = typeof d?.channel_id === "string" ? d.channel_id : null;
  const messageId = typeof d?.message_id === "string" ? d.message_id : null;
  const answerId = typeof d?.answer_id === "number" ? d.answer_id : Number(d?.answer_id);
  if (channelId === null || messageId === null || !Number.isInteger(answerId)) return state;
  const slice = state.messages[channelId];
  const message = slice?.byId[messageId] as any;
  const poll = message?.poll as RawPoll | undefined;
  if (!slice || !message || !poll) return state;

  const isMe = state.me !== null && d.user_id === state.me.id;
  const add = t === "MESSAGE_POLL_VOTE_ADD";
  const counts = [...(poll.results?.answer_counts ?? [])];
  const index = counts.findIndex((c) => c.id === answerId);
  const current = index === -1 ? { id: answerId, count: 0, me_voted: false } : counts[index]!;
  const next = {
    ...current,
    count: Math.max(0, (current.count ?? 0) + (add ? 1 : -1)),
    me_voted: isMe ? add : current.me_voted === true,
  };
  if (index === -1) counts.push(next);
  else counts[index] = next;

  const merged = { ...message, poll: { ...poll, results: { is_finalized: poll.results?.is_finalized ?? false, answer_counts: counts } } };
  return { ...state, messages: { ...state.messages, [channelId]: { ...slice, byId: { ...slice.byId, [messageId]: merged } } } };
}

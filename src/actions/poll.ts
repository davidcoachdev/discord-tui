import { putPollVote } from "../rest/routes";
import type { RestClient } from "../rest/client";
import { buildPollView, nextPollVote } from "../store/reducers/polls";
import type { Store } from "../store/store";
import type { ApiPoll } from "../store/types";

export function createPollActions(deps: { store: Store; rest: RestClient; now?: () => number }) {
  return {
    /** Toca una respuesta. Devuelve false (sin pedir nada) si no hay encuesta o ya terminó. */
    async vote(channelId: string, messageId: string, answerId: number): Promise<boolean> {
      const raw = (deps.store.getState().messages[channelId]?.byId[messageId] as { poll?: ApiPoll } | undefined)?.poll;
      if (!raw) return false;
      const poll = buildPollView(raw, (deps.now ?? Date.now)());
      if (poll.ended || !poll.answers.some((a) => a.id === answerId)) return false;
      // Sin cambio optimista: Discord manda MESSAGE_POLL_VOTE_ADD/REMOVE también por los votos propios.
      await putPollVote(deps.rest, channelId, messageId, nextPollVote(poll, answerId));
      return true;
    },
  };
}

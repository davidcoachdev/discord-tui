import { compareSnowflakes } from "../util/snowflake";

export function createAckScheduler(deps: {
  postAck(channelId: string, messageId: string, token: string | null): Promise<{ token: string | null }>;
  setTimer?: typeof setTimeout;
  debounceMs?: number;
}) {
  const setTimer = deps.setTimer ?? setTimeout;
  const debounceMs = deps.debounceMs ?? 1500;
  const lastAcked = new Map<string, string>();
  /** Token de ack por canal: lo devuelve el server y se manda en el próximo ack. */
  const tokens = new Map<string, string | null>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    viewing(channelId: string | null, newestVisibleId: string | null): void {
      if (channelId === null || newestVisibleId === null) {
        cancel();
        return;
      }
      const previous = lastAcked.get(channelId);
      if (previous !== undefined && compareSnowflakes(newestVisibleId, previous) <= 0) {
        cancel();
        return;
      }
      cancel();
      timer = setTimer(() => {
        timer = null;
        lastAcked.set(channelId, newestVisibleId);
        const token = tokens.get(channelId) ?? null;
        void deps
          .postAck(channelId, newestVisibleId, token)
          .then(({ token: next }) => {
            if (typeof next === "string") tokens.set(channelId, next);
          })
          .catch(() => {});
      }, debounceMs);
    },
  };
}

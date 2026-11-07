import { compareSnowflakes } from "../util/snowflake";

export function createAckScheduler(deps: {
  postAck(channelId: string, messageId: string): Promise<void>;
  setTimer?: typeof setTimeout;
  debounceMs?: number;
}) {
  const setTimer = deps.setTimer ?? setTimeout;
  const debounceMs = deps.debounceMs ?? 1500;
  const lastAcked = new Map<string, string>();
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
        void deps.postAck(channelId, newestVisibleId).catch(() => {});
      }, debounceMs);
    },
  };
}

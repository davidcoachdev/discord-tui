export function createTypingNotifier(deps: { postTyping(channelId: string): Promise<void>; now(): number }) {
  const last = new Map<string, number>();

  return {
    onKeystroke(channelId: string, textAfter: string): void {
      if (textAfter.length === 0) return;
      const now = deps.now();
      const previous = last.get(channelId) ?? -Infinity;
      if (now - previous < 8000) return;
      last.set(channelId, now);
      void deps.postTyping(channelId).catch(() => {});
    },
    onSent(channelId: string): void {
      last.set(channelId, -Infinity);
    },
  };
}

const MIN_DB = -96;
const AUTO_LOW = -60;
const AUTO_HIGH = -20;
const AUTO_START_DB = -45;
const AUTO_WARMUP_FRAMES = 50; // 1 s a 20 ms/frame
const AUTO_WINDOW_FRAMES = 150; // 3 s a 20 ms/frame

export function rmsDbfs(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const count = pcm.byteLength / 2;
  if (count === 0) return MIN_DB;
  let sumSquares = 0;
  for (let i = 0; i < count; i += 1) {
    const sample = view.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / count);
  if (rms <= 0) return MIN_DB;
  return Math.max(MIN_DB, 20 * Math.log10(rms));
}

export interface Vad {
  push(pcm: Uint8Array): "open" | "close" | null;
  isOpen: boolean;
  thresholdDb: number;
  levelDb: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return MIN_DB;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index]!;
}

export function createVad(opts?: {
  sensitivity?: "auto" | number;
  openFrames?: number;
  hangoverMs?: number;
  marginDb?: number;
}): Vad {
  const sensitivity = opts?.sensitivity ?? "auto";
  const openFrames = opts?.openFrames ?? 2;
  const hangoverMs = opts?.hangoverMs ?? 300;
  const marginDb = opts?.marginDb ?? 12;
  const hangoverFrames = Math.round(hangoverMs / 20);

  let isOpen = false;
  let loudStreak = 0;
  let quietStreak = 0;
  let levelDb = MIN_DB;
  let thresholdDb = sensitivity === "auto" ? AUTO_START_DB : sensitivity;

  const floorWindow: number[] = [];

  function updateAutoThreshold(level: number): void {
    if (sensitivity !== "auto") return;
    if (!isOpen) {
      floorWindow.push(level);
      if (floorWindow.length > AUTO_WINDOW_FRAMES) floorWindow.shift();
    }
    if (floorWindow.length < AUTO_WARMUP_FRAMES) {
      thresholdDb = AUTO_START_DB;
      return;
    }
    const sorted = [...floorWindow].sort((a, b) => a - b);
    const floor = percentile(sorted, 0.1);
    thresholdDb = Math.min(AUTO_HIGH, Math.max(AUTO_LOW, floor + marginDb));
  }

  return {
    get isOpen(): boolean {
      return isOpen;
    },
    get thresholdDb(): number {
      return thresholdDb;
    },
    get levelDb(): number {
      return levelDb;
    },
    push(pcm: Uint8Array): "open" | "close" | null {
      levelDb = rmsDbfs(pcm);
      updateAutoThreshold(levelDb);

      const aboveThreshold = levelDb >= thresholdDb;

      if (!isOpen) {
        if (aboveThreshold) {
          loudStreak += 1;
          quietStreak = 0;
          if (loudStreak >= openFrames) {
            isOpen = true;
            loudStreak = 0;
            return "open";
          }
        } else {
          loudStreak = 0;
        }
        return null;
      }

      // isOpen
      if (aboveThreshold) {
        quietStreak = 0;
        return null;
      }
      quietStreak += 1;
      if (quietStreak >= hangoverFrames) {
        isOpen = false;
        quietStreak = 0;
        return "close";
      }
      return null;
    },
  };
}

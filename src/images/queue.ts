export interface FetchQueue {
  /**
   * Corre `job` cuando hay un lugar libre (como mucho `limit` a la vez, en orden de llegada). Si al
   * tocarle el turno `wanted()` da false (la fila ya no está en pantalla), no corre y devuelve null.
   */
  run<T>(job: () => Promise<T>, wanted?: () => boolean): Promise<T | null>;
  readonly active: number;
  readonly waiting: number;
}

interface Waiting {
  start(): void;
  skip(): void;
  wanted(): boolean;
}

export function createFetchQueue(limit = 6): FetchQueue {
  const waiting: Waiting[] = [];
  let active = 0;

  function pump(): void {
    while (active < limit && waiting.length > 0) {
      const next = waiting.shift()!;
      if (!next.wanted()) {
        next.skip();
        continue;
      }
      next.start();
    }
  }

  return {
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
    run<T>(job: () => Promise<T>, wanted: () => boolean = () => true): Promise<T | null> {
      return new Promise<T | null>((resolve) => {
        waiting.push({
          wanted,
          skip: () => resolve(null),
          start: () => {
            active++;
            job()
              .then(resolve, () => resolve(null))
              .finally(() => {
                active--;
                pump();
              });
          },
        });
        pump();
      });
    },
  };
}

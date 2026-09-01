/** Minimal FIFO async mutex. One browser job at a time. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((res) => (release = res));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const browserMutex = new Mutex();

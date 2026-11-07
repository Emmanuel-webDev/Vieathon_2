/**
 * Real priority queue in front of the audit pipeline. A fixed number of audits run at once
 * (NIGHTWATCH_CONCURRENCY, default 2); everything else waits here. Paid jobs get a head start
 * (NIGHTWATCH_PRIORITY_HEAD_START_SEC, default 600): they are ordered as if they had arrived
 * that much earlier, so they jump ahead of recent free scans but can never starve old ones.
 * When nothing is waiting, priority changes nothing, and the UI says so.
 */
export interface QueueTicket {
  /** Resolves when a slot is free. Call release() exactly once when done. */
  ready: Promise<() => void>;
  cancel: () => void;
}

interface Waiter {
  score: number;
  seq: number;
  start: () => void;
  onPosition?: (position: number) => void;
  cancelled: boolean;
}

export class PriorityQueue {
  private active = 0;
  private seq = 0;
  private waiting: Waiter[] = [];
  constructor(private max: number, private headStartMs: number) {}

  get stats() {
    return { active: this.active, waiting: this.waiting.length, max: this.max };
  }

  private sort() {
    this.waiting.sort((a, b) => a.score - b.score || a.seq - b.seq);
  }

  private notify() {
    this.waiting.forEach((w, i) => w.onPosition?.(i + 1));
  }

  private pump() {
    while (this.active < this.max && this.waiting.length) {
      const w = this.waiting.shift()!;
      if (w.cancelled) continue;
      this.active++;
      w.start();
    }
    this.notify();
  }

  enqueue(paid: boolean, onPosition?: (position: number) => void, now = Date.now()): QueueTicket {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.active--;
      this.pump();
    };
    let waiter!: Waiter;
    const ready = new Promise<() => void>((resolve, reject) => {
      waiter = {
        score: now - (paid ? this.headStartMs : 0),
        seq: this.seq++,
        start: () => resolve(release),
        onPosition,
        cancelled: false,
      };
      (waiter as any).reject = reject;
    });
    this.waiting.push(waiter);
    this.sort();
    this.pump();
    return {
      ready,
      cancel: () => {
        if (waiter.cancelled) return;
        const i = this.waiting.indexOf(waiter);
        if (i >= 0) {
          this.waiting.splice(i, 1);
          waiter.cancelled = true;
          (waiter as any).reject?.(new Error("cancelled"));
          this.notify();
        }
      },
    };
  }
}

const g = globalThis as any;
export function auditQueue(): PriorityQueue {
  if (!g.__nwQueue) {
    g.__nwQueue = new PriorityQueue(
      Math.max(1, Number(process.env.NIGHTWATCH_CONCURRENCY) || 2),
      Math.max(0, Number(process.env.NIGHTWATCH_PRIORITY_HEAD_START_SEC) || 600) * 1000
    );
  }
  return g.__nwQueue;
}

import { SessionError } from "@/features/photo-session/errors";

// Process-local only: keep the deployment at one Node process / replica.
export class HeavyTaskGate {
  private running = false;
  private waiting: (() => void)[] = [];

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running || this.waiting.length) throw this.busy();
    this.running = true;
    try { return await work(); }
    finally { this.release(); }
  }

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.running && this.waiting.length >= 8) return Promise.reject(this.busy());
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running = true;
        void Promise.resolve().then(work).then(resolve, reject).finally(() => this.release());
      };
      if (this.running) this.waiting.push(start);
      else start();
    });
  }

  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.running = false;
  }
  private busy() { return new SessionError(429, "다른 사진을 처리하고 있어요. 잠시 후 다시 시도해 주세요."); }
}

const state = globalThis as typeof globalThis & { picsyncHeavyTaskGate?: HeavyTaskGate };
export const heavyTaskGate = state.picsyncHeavyTaskGate ??= new HeavyTaskGate();
export const runHeavyTask = <T>(work: () => Promise<T>) => heavyTaskGate.run(work);

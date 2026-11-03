/** Keep transient failures from turning every open screen into a request storm. */
export function pollingDelay(baseMs: number, failures: number): number {
  return Math.min(baseMs * 2 ** Math.min(Math.max(failures, 0), 4), 60_000);
}

export function visiblePolling(intervalMs: number, run: () => Promise<void>) {
  let active = true;
  let pending = false;
  let failures = 0;
  let nextAt = 0;
  const check = async () => {
    if (!active || pending || document.visibilityState !== "visible" || Date.now() < nextAt) return;
    pending = true;
    try {
      await run();
      failures = 0;
    } catch {
      failures++;
    } finally {
      nextAt = Date.now() + pollingDelay(intervalMs, failures);
      pending = false;
    }
  };
  const resume = () => { nextAt = 0; void check(); };
  void check();
  const timer = window.setInterval(() => void check(), intervalMs);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    active = false;
    window.clearInterval(timer);
    window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}

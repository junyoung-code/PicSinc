export type WorkerName = 'mac' | 'windows';
export type WorkerPresence = { online: boolean; lastSeenAt: string | null };

export const WORKER_PRESENCE_TIMEOUT_MS = 90_000;

export function workerPresenceView(
  rows: Array<{ worker_name: string; last_seen_at: string }>,
  now = Date.now(),
): Record<WorkerName, WorkerPresence> {
  const result: Record<WorkerName, WorkerPresence> = {
    mac: { online: false, lastSeenAt: null },
    windows: { online: false, lastSeenAt: null },
  };
  for (const row of rows) {
    if (row.worker_name !== 'mac' && row.worker_name !== 'windows') continue;
    const age = now - Date.parse(row.last_seen_at);
    result[row.worker_name] = {
      online: Number.isFinite(age) && age >= -30_000 && age < WORKER_PRESENCE_TIMEOUT_MS,
      lastSeenAt: row.last_seen_at,
    };
  }
  return result;
}

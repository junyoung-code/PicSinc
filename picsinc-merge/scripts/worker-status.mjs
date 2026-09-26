const base = process.env.WORKER_BASE_URL;
const token = process.env.WORKER_TOKEN;
if (!base || !token) throw new Error("WORKER_BASE_URL and WORKER_TOKEN are required");
const url = new URL("/api/worker/status", base);
const watch = process.argv.includes("--watch");
let busySince = null;

async function sample() {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Worker status unavailable (${response.status})`);
  const value = await response.json();
  const busy = value.queued >= 3 || (value.oldestQueuedSeconds ?? 0) > 60;
  busySince = busy ? (busySince ?? Date.now()) : null;
  const suggestMac = busySince !== null && Date.now() - busySince >= 120_000;
  console.log(`${value.sampledAt} queued=${value.queued} running=${value.running} oldest=${value.oldestQueuedSeconds ?? "-"}s failed_1h=${value.failedLastHour}${suggestMac ? " | Mac 보조 워커를 켤 기준에 도달했습니다." : ""}`);
}

do {
  try { await sample(); }
  catch { busySince = null; console.error("Worker status unavailable; check server connection and token."); }
  if (watch) await new Promise(resolve => setTimeout(resolve, 30_000));
} while (watch);

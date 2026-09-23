import { runWorker } from "./worker-runtime";

const shutdown = new AbortController();
process.once("SIGTERM", () => shutdown.abort());
process.once("SIGINT", () => shutdown.abort());
try {
  console.log("Photo worker starting.");
  await runWorker({ baseUrl: process.env.WORKER_BASE_URL ?? "", token: process.env.WORKER_TOKEN ?? "" }, shutdown.signal);
} catch {
  console.error("Photo worker stopped: check WORKER_BASE_URL, WORKER_TOKEN and connection.");
  process.exitCode = 1;
}

export class WorkerError extends Error {
  constructor(public code: "transient" | "invalid_input" | "processing_failed" | "gpu_unavailable", message = "Worker task failed") { super(message); }
}

export function safeUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new WorkerError("invalid_input", "HTTPS is required except on loopback");
  }
  return url;
}

/** Bound the streamed body, including responses without Content-Length. */
export async function boundedBody(response: Response, maximum: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new WorkerError("invalid_input");
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) throw new WorkerError("invalid_input");
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally { await reader.cancel().catch(() => undefined); }
}

export async function downloadInput(url: string): Promise<Buffer> {
  try {
    const response = await fetch(safeUrl(url), { signal: AbortSignal.timeout(60_000), redirect: "error" });
    if (!response.ok) throw new WorkerError("transient");
    return await boundedBody(response, 20 * 1024 * 1024);
  } catch (error) { throw error instanceof WorkerError ? error : new WorkerError("transient"); }
}

export async function uploadOutput(url: string, bytes: Buffer, contentType: string): Promise<void> {
  // storage-js uploadToSignedUrl uses PUT; signed URLs include the scoped upload token.
  try {
    const response = await fetch(safeUrl(url), {
      method: "PUT", headers: { "content-type": contentType, "x-upsert": "false" },
      body: new Uint8Array(bytes), signal: AbortSignal.timeout(120_000), redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new WorkerError("transient");
  } catch (error) { throw error instanceof WorkerError ? error : new WorkerError("transient"); }
}

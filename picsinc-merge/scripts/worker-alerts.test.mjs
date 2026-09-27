import assert from 'node:assert/strict';
import { test } from 'node:test';

test('private /status reads the worker API and sends the current state to Telegram', async () => {
  const previousFetch = globalThis.fetch;
  const previous = Object.fromEntries(['WORKER_BASE_URL', 'WORKER_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'].map(key => [key, process.env[key]]));
  const sent = [];
  process.env.WORKER_BASE_URL = 'https://worker.example';
  process.env.WORKER_TOKEN = 'test-worker-token';
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_CHAT_ID = '123';
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url === 'https://worker.example/api/worker/status') {
      assert.equal(options.headers.authorization, 'Bearer test-worker-token');
      return Response.json({ queued: 2, running: 1, oldestQueuedSeconds: 40, failedLastHour: 0,
        workers: { windows: { online: true }, mac: { online: false } } });
    }
    if (url.startsWith('https://api.telegram.org/bottest-bot-token/getUpdates')) {
      return Response.json({ ok: true, result: [
        { update_id: 1, message: { chat: { id: 456, type: 'private' }, text: '/status' } },
        { update_id: 2, message: { chat: { id: 123, type: 'private' }, text: '/status' } },
      ] });
    }
    if (url === 'https://api.telegram.org/bottest-bot-token/sendMessage') {
      sent.push(JSON.parse(options.body));
      return Response.json({ ok: true, result: { message_id: 1 } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await import(`./worker-alerts.mjs?test=${Date.now()}`);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chat_id, '123');
    assert.match(sent[0].text, /대기 2건 · 처리 중 1건/);
    assert.match(sent[0].text, /Windows 온라인 · Mac 오프라인/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

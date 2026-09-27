import { POLL_MS, commandFromUpdate, evaluateStatus, evaluateUnavailable, initialAlertState, statusLine } from './worker-alert-policy.mjs';

const base = process.env.WORKER_BASE_URL;
const workerToken = process.env.WORKER_TOKEN;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!base || !workerToken || !botToken || !chatId) {
  throw new Error('WORKER_BASE_URL, WORKER_TOKEN, TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
}

const statusUrl = new URL('/api/worker/status', base);
const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
const updatesUrl = `https://api.telegram.org/bot${botToken}/getUpdates`;
let state = initialAlertState();
let pending = [];
let nextUpdateId;
let latestStatus = null;

async function notify(message) {
  const response = await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Telegram delivery failed (${response.status})`);
  const result = await response.json();
  if (!result.ok) throw new Error('Telegram delivery failed');
}

async function sample() {
  const now = Date.now();
  let result;
  try {
    const response = await fetch(statusUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${workerToken}` },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    latestStatus = await response.json();
    result = evaluateStatus(state, latestStatus, now);
  } catch (error) {
    console.error(`Status check failed: ${error.message}`);
    latestStatus = null;
    result = evaluateUnavailable(state, now);
  }
  state = result.state;
  pending.push(...result.messages);
  await checkCommands();
  if (pending.length > 20) pending = pending.slice(-20);
  if (pending.length) {
    try {
      await notify(pending.join('\n\n'));
      pending = [];
    } catch (error) {
      console.error(`Alert failed, will retry: ${error.message}`);
    }
  }
}

async function checkCommands() {
  try {
    const url = new URL(updatesUrl);
    url.searchParams.set('timeout', '1');
    url.searchParams.set('allowed_updates', '["message"]');
    if (nextUpdateId !== undefined) url.searchParams.set('offset', String(nextUpdateId));
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(response.status === 409
      ? 'Telegram getUpdates is unavailable because this bot has a webhook or another monitor is polling it.'
      : `Telegram updates unavailable (${response.status})`);
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.result)) throw new Error('Telegram updates unavailable');
    for (const update of data.result) {
      nextUpdateId = Math.max(nextUpdateId ?? 0, update.update_id + 1);
      const command = commandFromUpdate(update, chatId);
      if (command === '/start') pending.push('PicSync 알림이 연결되었습니다. 현재 현황은 /status로 확인할 수 있습니다.');
      if (command === '/status') {
        pending.push(latestStatus ? `PicSync 현재 현황\n${statusLine(latestStatus)}` : 'PicSync 서버 상태를 확인할 수 없습니다. 잠시 후 다시 시도하세요.');
      }
    }
  } catch (error) {
    console.error(`Telegram command check failed: ${error.message}`);
  }
}

// An idle monitor only checks status; it does not run a worker or change jobs.
do {
  await sample();
  if (!process.argv.includes('--watch')) break;
  await new Promise(resolve => setTimeout(resolve, POLL_MS));
} while (true);

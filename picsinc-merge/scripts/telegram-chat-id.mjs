const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const webhookResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
  signal: AbortSignal.timeout(15_000),
});
if (!webhookResponse.ok) throw new Error(`Telegram bot check failed (${webhookResponse.status}). Check the bot token.`);
const webhook = await webhookResponse.json();
if (!webhook.ok) throw new Error('Telegram bot check failed. Check the bot token.');
if (webhook.result?.url) throw new Error('This bot already uses a webhook. Use a new bot for PicSync alerts.');

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Telegram request failed (${response.status}). Check the bot token and webhook settings.`);
const value = await response.json();
if (!value.ok) throw new Error('Telegram request failed');
const privateChats = new Map();
for (const update of value.result) {
  const chat = update.message?.chat;
  if (chat?.type === 'private' && chat.id) privateChats.set(chat.id, chat.first_name ?? 'private chat');
}
if (privateChats.size === 0) throw new Error('No private chat found. Open your bot in Telegram, send /start, then retry.');
for (const [id, name] of privateChats) console.log(`${name}: ${id}`);

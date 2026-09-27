import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKER_PRESENCE_TIMEOUT_MS, workerPresenceView } from './worker-presence';

test('worker presence is online only while its server timestamp is fresh', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const view = workerPresenceView([
    { worker_name: 'mac', last_seen_at: new Date(now - WORKER_PRESENCE_TIMEOUT_MS + 1).toISOString() },
    { worker_name: 'windows', last_seen_at: new Date(now - WORKER_PRESENCE_TIMEOUT_MS).toISOString() },
  ], now);
  assert.equal(view.mac.online, true);
  assert.equal(view.windows.online, false);
  assert(view.windows.lastSeenAt);
});

test('missing or invalid worker records cannot appear online', () => {
  const view = workerPresenceView([{ worker_name: 'other', last_seen_at: new Date().toISOString() }, { worker_name: 'mac', last_seen_at: 'bad' }]);
  assert.equal(view.mac.online, false);
  assert.deepEqual(view.windows, { online: false, lastSeenAt: null });
});

test('a small clock difference does not hide a fresh heartbeat', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const view = workerPresenceView([{ worker_name: 'mac', last_seen_at: new Date(now + 2_000).toISOString() }], now);
  assert.equal(view.mac.online, true);
});

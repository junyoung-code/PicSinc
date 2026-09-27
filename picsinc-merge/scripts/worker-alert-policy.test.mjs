import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKLOG_MS, OUTAGE_MS, commandFromUpdate, evaluateStatus, evaluateUnavailable, initialAlertState, statusLine } from './worker-alert-policy.mjs';

const quiet = { queued: 0, running: 0, failedLastHour: 0, oldestQueuedSeconds: null };

test('startup stays quiet; sustained backlog and recovery send one alert each', () => {
  let { state, messages } = evaluateStatus(initialAlertState(), quiet, 0);
  assert.deepEqual(messages, []);
  const busy = { ...quiet, queued: 3, oldestQueuedSeconds: 61 };
  ({ state, messages } = evaluateStatus(state, busy, 1));
  assert.deepEqual(messages, []);
  ({ state, messages } = evaluateStatus(state, busy, BACKLOG_MS));
  assert.deepEqual(messages, []);
  ({ state, messages } = evaluateStatus(state, busy, BACKLOG_MS + 1));
  assert.match(messages[0], /대기 증가/);
  ({ state, messages } = evaluateStatus(state, busy, BACKLOG_MS + 2));
  assert.deepEqual(messages, []);
  ({ state, messages } = evaluateStatus(state, quiet, BACKLOG_MS + 3));
  assert.match(messages[0], /정상화/);
});

test('routine processing stays quiet and failures alert only on increase', () => {
  const active = { ...quiet, running: 1 };
  let { state } = evaluateStatus(initialAlertState(), active, 0);
  let result = evaluateStatus(state, active, 15 * 60_000);
  assert.deepEqual(result.messages, []);
  state = result.state;
  result = evaluateStatus(state, { ...active, failedLastHour: 1 }, 15 * 60_000 + 1);
  assert.match(result.messages[0], /실패 건수 증가/);
  result = evaluateStatus(result.state, { ...active, failedLastHour: 1 }, 15 * 60_000 + 2);
  assert.deepEqual(result.messages, []);
});

test('only the configured private chat can request status', () => {
  const update = { message: { chat: { id: 123, type: 'private' }, text: '/status' } };
  assert.equal(commandFromUpdate(update, '123'), '/status');
  assert.equal(commandFromUpdate(update, '456'), null);
  assert.equal(commandFromUpdate({ message: { chat: { id: 123, type: 'group' }, text: '/status' } }, '123'), null);
  assert.equal(commandFromUpdate({ message: { chat: { id: 123, type: 'private' }, text: '/other' } }, '123'), null);
});

test('status includes each worker connection state', () => {
  const line = statusLine({ ...quiet, workers: { windows: { online: true }, mac: { online: false } } });
  assert.match(line, /Windows 온라인 · Mac 오프라인/);
});

test('status outage alerts after two minutes and reports recovery', () => {
  let { state } = evaluateStatus(initialAlertState(), quiet, 0);
  let result = evaluateUnavailable(state, 1);
  assert.deepEqual(result.messages, []);
  state = result.state;
  result = evaluateUnavailable(state, OUTAGE_MS);
  assert.deepEqual(result.messages, []);
  result = evaluateUnavailable(result.state, OUTAGE_MS + 1);
  assert.match(result.messages[0], /조회가 2분/);
  result = evaluateStatus(result.state, quiet, OUTAGE_MS + 2);
  assert.match(result.messages[0], /조회 복구/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistory, saveHistory } from '../src/history.ts';

function storage(initial) {
  let value = initial;
  globalThis.localStorage = { getItem: () => value, setItem: (_key, next) => { value = next; } };
  return () => JSON.parse(value);
}
const transfer = {
  id: 'test-transfer', title: 'Dizajn', message: '', totalSize: 5,
  createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-08T00:00:00Z',
  files: [{ id: 'test-file', name: 'brief.txt', size: 5, type: 'text/plain' }],
};

test('invalid or unavailable local history never breaks the application', () => {
  for (const invalid of ['not-json', '{}', '[null]', JSON.stringify([{ ...transfer, expiresAt: 'invalid' }])]) {
    storage(invalid);
    assert.deepEqual(readHistory(), []);
  }
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(readHistory(), []);
  assert.doesNotThrow(() => saveHistory([transfer]));
});

test('persist only display metadata, deduplicate and cap history at thirty transfers', () => {
  const readRaw = storage('[]');
  const withSecrets = { ...transfer, password: 'secret', token: 'private-token', files: [{ ...transfer.files[0], pathname: 'private/path', token: 'private-file-token' }] };
  saveHistory([withSecrets, transfer, ...Array.from({ length: 35 }, (_, i) => ({ ...transfer, id: `transfer-${i}` }))]);
  const history = readRaw();
  assert.equal(history.length, 30);
  assert.equal(new Set(history.map(item => item.id)).size, 30);
  assert.deepEqual(history[0], transfer);
  assert.equal(JSON.stringify(history).includes('private'), false);
  assert.deepEqual(readHistory(), history);
});

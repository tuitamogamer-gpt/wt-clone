import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { once } from 'node:events';
import { createApp } from './index.mjs';

let server;
let baseUrl;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'transfer-api-test-'));
  const app = await createApp({ dataDir, maxUploadBytes: 64 * 1024 });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

function upload(files = [{ name: 'hello.txt', content: 'Pozdrav svijete!', type: 'text/plain' }], fields = {}) {
  const data = new FormData();
  for (const file of files) {
    data.append('files', new Blob([file.content], { type: file.type ?? 'application/octet-stream' }), file.name);
  }
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return fetch(`${baseUrl}/api/transfers`, { method: 'POST', body: data, signal: AbortSignal.timeout(5000) });
}

async function getJson(url, options) {
  const response = await fetch(`${baseUrl}${url}`, options);
  return { status: response.status, data: await response.json() };
}

function readZipEntries(zip) {
  const result = new Map();
  for (let offset = 0; offset <= zip.length - 46; offset++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) continue;
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameSize = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + nameSize).toString();
    const localOffset = zip.readUInt32LE(offset + 42);
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const bytes = zip.subarray(dataStart, dataStart + compressedSize);
    result.set(name, method === 8 ? inflateRawSync(bytes).toString() : bytes.toString());
  }
  return result;
}

test('creates a persistent transfer and downloads original files and a valid zip', async () => {
  const response = await upload([
    { name: 'hello.txt', content: 'Pozdrav svijete!' },
    { name: 'hello.txt', content: 'Druga datoteka' },
  ], { title: 'Moj projekt', message: 'Datoteke za tebe.', expiresIn: '3' });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.title, 'Moj projekt');
  assert.equal(created.message, 'Datoteke za tebe.');
  assert.equal(created.files.length, 2);
  assert.equal(created.totalSize, Buffer.byteLength('Pozdrav svijete!Druga datoteka'));
  assert.equal(created.requiresPassword, false);
  assert.equal(Date.parse(created.expiresAt) - Date.parse(created.createdAt), 3 * 24 * 60 * 60 * 1000);
  assert.equal('storedName' in created.files[0], false);

  const metadata = await getJson(`/api/transfers/${created.id}`);
  assert.deepEqual(metadata.data, created);
  const original = await fetch(`${baseUrl}/api/transfers/${created.id}/files/${created.files[0].id}`);
  assert.equal(original.status, 200);
  assert.match(original.headers.get('content-disposition'), /attachment/);
  assert.equal(await original.text(), 'Pozdrav svijete!');
  const download = await fetch(`${baseUrl}/api/transfers/${created.id}/download`);
  assert.equal(download.headers.get('content-type'), 'application/zip');
  const entries = readZipEntries(Buffer.from(await download.arrayBuffer()));
  assert.equal(entries.get('hello.txt'), 'Pozdrav svijete!');
  assert.equal(entries.get('hello (2).txt'), 'Druga datoteka');

  const restartedApp = await createApp({ dataDir });
  const restartedServer = restartedApp.listen(0, '127.0.0.1');
  await once(restartedServer, 'listening');
  try {
    const persisted = await fetch(`http://127.0.0.1:${restartedServer.address().port}/api/transfers/${created.id}`);
    assert.deepEqual(await persisted.json(), created);
  } finally {
    await new Promise((resolve) => restartedServer.close(resolve));
  }
});

test('passwords hide file metadata and require a signed token for every download', async () => {
  const response = await upload([{ name: 'secret.txt', content: 'tajno' }], { password: 'correct horse', message: 'Privatna poruka' });
  const created = await response.json();
  assert.equal(created.requiresPassword, true);
  assert.equal('passwordHash' in created, false);
  const locked = await getJson(`/api/transfers/${created.id}`);
  assert.equal(locked.data.requiresPassword, true);
  assert.equal('files' in locked.data, false);
  assert.equal('message' in locked.data, false);
  assert.equal(JSON.stringify(locked.data).includes('secret.txt'), false);
  assert.equal((await getJson(`/api/transfers/${created.id}/download`)).status, 401);
  assert.equal((await getJson(`/api/transfers/${created.id}/files/${created.files[0].id}`)).status, 401);
  const wrong = await getJson(`/api/transfers/${created.id}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'incorrect' }),
  });
  assert.equal(wrong.status, 401);
  const unlocked = await getJson(`/api/transfers/${created.id}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }),
  });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.data.message, 'Privatna poruka');
  assert.equal(typeof unlocked.data.token, 'string');
  const original = await fetch(`${baseUrl}/api/transfers/${created.id}/files/${created.files[0].id}?token=${unlocked.data.token}`);
  assert.equal(original.status, 200);
  assert.equal(await original.text(), 'tajno');
  const metadata = await getJson(`/api/transfers/${created.id}?token=${unlocked.data.token}`);
  assert.equal(metadata.data.files[0].name, 'secret.txt');
  const invalid = await getJson(`/api/transfers/${created.id}/download?token=${unlocked.data.token}x`);
  assert.equal(invalid.status, 401);
  const stored = JSON.parse(await readFile(path.join(dataDir, created.id, 'metadata.json'), 'utf8'));
  assert.notEqual(stored.passwordHash, 'correct horse');
  assert.equal(JSON.stringify(stored).includes('correct horse'), false);
});

test('expired transfers reject metadata, unlock and both download endpoints', async () => {
  const created = await (await upload()).json();
  const metadataPath = path.join(dataDir, created.id, 'metadata.json');
  const stored = JSON.parse(await readFile(metadataPath, 'utf8'));
  stored.expiresAt = '2000-01-01T00:00:00.000Z';
  await writeFile(metadataPath, JSON.stringify(stored));
  for (const suffix of ['', '/download', `/files/${created.files[0].id}`]) {
    assert.equal((await getJson(`/api/transfers/${created.id}${suffix}`)).status, 410);
  }
  assert.equal((await getJson(`/api/transfers/${created.id}/unlock`, { method: 'POST' })).status, 410);
});

test('validates input and streams an aggregate upload limit across multiple files', async () => {
  assert.equal((await upload([])).status, 400);
  assert.equal((await upload(undefined, { expiresIn: '99' })).status, 400);
  assert.equal((await upload(undefined, { sender: 'broken-email' })).status, 400);
  const tooLarge = await upload([
    { name: 'first.bin', content: new Uint8Array(40 * 1024) },
    { name: 'second.bin', content: new Uint8Array(40 * 1024) },
  ]);
  assert.equal(tooLarge.status, 413);
  assert.match((await tooLarge.json()).error, /2 GB/);
  assert.equal((await upload([{ name: 'large.bin', content: new Uint8Array(80 * 1024) }])).status, 413);
  assert.equal((await upload(Array.from({ length: 101 }, (_, i) => ({ name: `${i}.txt`, content: 'x' })))).status, 413);
  assert.equal((await upload([{ name: 'boundary.bin', content: new Uint8Array(64 * 1024) }])).status, 201);
  const unicode = await (await upload([{ name: 'naš dizajn.txt', content: 'Sadržaj.' }])).json();
  assert.equal(unicode.files[0].name, 'naš dizajn.txt');
  assert.equal((await getJson('/api/transfers/not-a-transfer')).status, 404);
  // A rejected upload must not prevent later uploads from completing.
  assert.equal((await upload()).status, 201);
  const directories = await readdir(dataDir);
  assert.equal(directories.some((name) => name.startsWith('.incoming-')), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import { createBlobApp } from './blob-app.mjs';

function memoryBlob() {
  const objects = new Map();
  const signingCalls = [];
  let revision = 0;
  const metadata = (pathname, object) => ({
    pathname, size: object.bytes.length, contentType: object.contentType,
    url: `https://test.private.blob.vercel-storage.com/${pathname}`,
    etag: object.etag,
  });
  return {
    objects, signingCalls,
    async put(pathname, body, options) {
      assert.equal(options.access, 'private');
      const existing = objects.get(pathname);
      if (existing && !options.allowOverwrite) throw new Error('Vercel Blob: This blob already exists.');
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      const object = { bytes: Buffer.from(body), contentType: options.contentType, etag: `"revision-${++revision}"` };
      objects.set(pathname, object);
      return metadata(pathname, object);
    },
    async get(pathname, options) {
      assert.equal(options.access, 'private');
      const object = objects.get(pathname);
      if (!object) return null;
      return { statusCode: 200, stream: new Response(object.bytes).body, blob: metadata(pathname, object) };
    },
    async head(pathname) {
      const object = objects.get(pathname);
      if (!object) throw new BlobNotFoundError();
      return metadata(pathname, object);
    },
    async issueSignedToken(options) {
      signingCalls.push(options);
      return { delegationToken: 'delegation', clientSigningToken: 'must-stay-secret' };
    },
    async presignUrl(_token, options) {
      assert.equal(options.access, 'private');
      return { presignedUrl: `https://test.private.blob.vercel-storage.com/${encodeURI(options.pathname)}?signature=short-lived` };
    },
  };
}

async function fixture(t, options = {}) {
  const sdk = options.sdk ?? memoryBlob();
  const generatedTokens = [];
  const app = await createBlobApp({
    blobToken: 'test-read-write-secret', maxUploadBytes: 64 * 1024, ...options, sdk,
    handleUpload: async ({ body, onBeforeGenerateToken }) => {
      const constraints = await onBeforeGenerateToken(body.pathname, body.clientPayload);
      generatedTokens.push(constraints);
      return { type: 'blob.generate-client-token', clientToken: 'scoped-upload-token' };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (url, body) => fetch(`${baseUrl}${url}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  const init = (body = {}) => request('/api/transfers/init', {
    title: 'Moj projekt', files: [{ name: 'hello.txt', size: 7, type: 'text/plain' }], ...body,
  });
  async function storeFiles(draft, contents) {
    for (let index = 0; index < draft.files.length; index += 1) {
      const file = draft.files[index];
      await sdk.put(file.pathname, contents?.[index] ?? 'Pozdrav', { access: 'private', contentType: file.type });
    }
  }
  async function complete(draft) {
    return request(`/api/transfers/${draft.id}/complete`, { uploadToken: draft.uploadToken });
  }
  return { sdk, generatedTokens, baseUrl, request, init, storeFiles, complete };
}

function readZipEntries(zip) {
  const entries = new Map();
  for (let offset = 0; offset <= zip.length - 46; offset += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) continue;
    assert.equal(zip.readUInt16LE(offset + 10), 0);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString();
    const localOffset = zip.readUInt32LE(offset + 42);
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    entries.set(name, zip.subarray(start, start + size).toString());
  }
  return entries;
}

test('Blob sessions bind upload authorization to exact paths and declared file sizes', async (t) => {
  const f = await fixture(t);
  const response = await f.init();
  assert.equal(response.status, 201);
  const draft = await response.json();
  assert.equal((await f.request(`/api/transfers/${draft.id}`)).status, 404);
  const upload = await f.request('/api/blob/upload', { pathname: draft.files[0].pathname, clientPayload: JSON.stringify({ uploadToken: draft.uploadToken }) });
  assert.equal(upload.status, 200);
  assert.equal(f.generatedTokens[0].maximumSizeInBytes, 7);
  assert.equal(f.generatedTokens[0].allowOverwrite, false);
  assert.equal(f.generatedTokens[0].addRandomSuffix, false);
  assert.deepEqual(f.generatedTokens[0].allowedContentTypes, ['text/plain']);
  assert.equal(JSON.stringify(await upload.json()).includes('test-read-write-secret'), false);
  assert.equal((await f.request('/api/blob/upload', { pathname: `transfers/${draft.id}/metadata.json`, clientPayload: draft.uploadToken })).status, 403);
  assert.equal((await f.request('/api/blob/upload', { pathname: draft.files[0].pathname, clientPayload: `${draft.uploadToken}bad` })).status, 401);
  const other = await (await f.init()).json();
  assert.equal((await f.request(`/api/transfers/${other.id}/complete`, { uploadToken: draft.uploadToken })).status, 401);
  assert.equal((await f.init({ files: [{ name: 'big.bin', size: 64 * 1024 + 1 }] })).status, 413);
  assert.equal((await f.init({ files: [{ name: 'bad.bin', size: -1 }] })).status, 400);
});

test('Blob completion validates uploaded contents and persists manifests across instances', async (t) => {
  const f = await fixture(t);
  const draft = await (await f.init({ expiresIn: 3 })).json();
  assert.equal((await f.complete(draft)).status, 409);
  await f.storeFiles(draft, ['wrong']);
  assert.equal((await f.complete(draft)).status, 400);
  f.sdk.objects.delete(draft.files[0].pathname);
  await f.storeFiles(draft);
  const complete = await f.complete(draft);
  assert.equal(complete.status, 201);
  const transfer = await complete.json();
  assert.equal(transfer.totalSize, 7);
  assert.equal(Date.parse(transfer.expiresAt) - Date.parse(transfer.createdAt), 3 * 24 * 60 * 60 * 1000);
  assert.equal('pathname' in transfer.files[0], false);
  assert.equal('passwordHash' in transfer, false);
  const repeated = await f.complete(draft);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), transfer);
  const fresh = await fixture(t, { sdk: f.sdk });
  assert.deepEqual(await (await fresh.request(`/api/transfers/${transfer.id}`)).json(), transfer);
  const download = await fresh.request(`/api/transfers/${transfer.id}/files/${transfer.files[0].id}`);
  assert.equal(download.status, 302);
  assert.match(download.headers.get('location'), /private\.blob\.vercel-storage\.com/);
  assert.match(download.headers.get('location'), /download=1/);
  assert.equal(download.headers.get('location').includes('must-stay-secret'), false);
  assert.deepEqual(f.sdk.signingCalls[0].operations, ['get']);
  assert.equal(f.sdk.signingCalls[0].pathname, draft.files[0].pathname);
});

test('private ZIP streaming preserves file contents and disambiguates duplicate names', async (t) => {
  const f = await fixture(t);
  const draft = await (await f.init({ files: [
    { name: 'čestitka.txt', size: 7, type: 'text/plain' },
    { name: 'čestitka.txt', size: 5, type: 'text/plain' },
  ] })).json();
  await f.storeFiles(draft, ['Pozdrav', 'Druga']);
  const transfer = await (await f.complete(draft)).json();
  const zip = await f.request(`/api/transfers/${transfer.id}/download`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const entries = readZipEntries(Buffer.from(await zip.arrayBuffer()));
  assert.equal(entries.get('čestitka.txt'), 'Pozdrav');
  assert.equal(entries.get('čestitka (2).txt'), 'Druga');
});

test('empty files work and unsafe filenames and MIME headers cannot escape transfer paths', async (t) => {
  const f = await fixture(t);
  const draft = await (await f.init({ title: 'Projekt\r\nX-Injected: yes', files: [
    { name: '../../nested\\\u0000prazna.txt\r\n', size: 0, type: '' },
  ] })).json();
  assert.equal(draft.files[0].name, 'prazna.txt');
  assert.equal(draft.files[0].type, 'application/octet-stream');
  assert.match(draft.files[0].pathname, new RegExp(`^transfers/${draft.id}/files/[a-f0-9-]+/prazna.txt$`));
  const upload = await f.request('/api/blob/upload', { pathname: draft.files[0].pathname, clientPayload: draft.uploadToken });
  assert.equal(upload.status, 200);
  assert.equal(f.generatedTokens[0].maximumSizeInBytes, 1);
  await f.storeFiles(draft, ['']);
  const transfer = await (await f.complete(draft)).json();
  assert.equal(transfer.totalSize, 0);
  const zip = await f.request(`/api/transfers/${transfer.id}/download`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('x-injected'), null);
  const entries = readZipEntries(Buffer.from(await zip.arrayBuffer()));
  assert.equal(entries.get('prazna.txt'), '');
  assert.equal((await f.init({ files: [{ name: 'x', size: 1, type: 'text/plain\r\nX-Injected: yes' }] })).status, 400);
});

test('private metadata and downloads require password, expire and survive cold starts', async (t) => {
  let timestamp = Date.now();
  const f = await fixture(t, { now: () => timestamp, tokenLifetimeMs: 1000 });
  const draft = await (await f.init({ password: 'correct', message: 'tajna', expiresIn: 1 })).json();
  await f.storeFiles(draft);
  const transfer = await (await f.complete(draft)).json();
  const locked = await (await f.request(`/api/transfers/${transfer.id}`)).json();
  assert.equal(locked.requiresPassword, true);
  assert.equal('files' in locked, false);
  assert.equal('message' in locked, false);
  const filePath = `/api/transfers/${transfer.id}/files/${transfer.files[0].id}`;
  assert.equal((await f.request(filePath)).status, 401);
  assert.equal((await f.request(`/api/transfers/${transfer.id}/download`)).status, 401);
  assert.equal((await f.request(`${filePath}?token=${draft.uploadToken}`)).status, 401);
  assert.equal((await f.request(`/api/transfers/${transfer.id}/unlock`, { password: 'wrong' })).status, 401);
  const unlocked = await (await f.request(`/api/transfers/${transfer.id}/unlock`, { password: 'correct' })).json();
  assert.equal(unlocked.message, 'tajna');
  const fresh = await fixture(t, { sdk: f.sdk, now: () => timestamp });
  assert.equal((await fresh.request(`${filePath}?token=${unlocked.token}`)).status, 302);
  timestamp += 1001;
  assert.equal((await fresh.request(`${filePath}?token=${unlocked.token}`)).status, 401);
  timestamp = Date.parse(transfer.expiresAt);
  assert.equal((await fresh.request(`/api/transfers/${transfer.id}`)).status, 410);
  assert.equal((await fresh.request(filePath)).status, 410);
});

test('password attempt limits persist across server instances and reject concurrent attempts', async (t) => {
  const f = await fixture(t);
  const draft = await (await f.init({ password: 'correct' })).json();
  await f.storeFiles(draft);
  const transfer = await (await f.complete(draft)).json();
  const fresh = await fixture(t, { sdk: f.sdk });
  const attempts = await Promise.all(Array.from({ length: 13 }, (_, index) =>
    (index % 2 ? fresh : f).request(`/api/transfers/${transfer.id}/unlock`, { password: 'wrong' }),
  ));
  assert.equal(attempts.filter((response) => response.status === 401).length, 10);
  assert.equal(attempts.filter((response) => response.status === 429).length, 3);
  assert.equal((await fresh.request(`/api/transfers/${transfer.id}/unlock`, { password: 'correct' })).status, 429);
});

test('expired upload sessions and missing Blob configuration fail clearly', async (t) => {
  let timestamp = Date.now();
  const f = await fixture(t, { now: () => timestamp, sessionLifetimeMs: 1000 });
  const draft = await (await f.init()).json();
  await f.storeFiles(draft);
  timestamp += 1001;
  assert.equal((await f.complete(draft)).status, 401);
  const missing = await fixture(t, { blobToken: '' });
  const response = await missing.request('/api/config');
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Pohrana datoteka trenutačno nije dostupna/);
});

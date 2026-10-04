import express from 'express';
import archiver from 'archiver';
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isMissing = (error) => [error?.name, error?.constructor?.name].includes('BlobNotFoundError') || error?.status === 404 || error?.statusCode === 404;
const isConflict = (error) => /AlreadyExists|PreconditionFailed/.test(`${error?.name} ${error?.constructor?.name}`) || /blob already exists/i.test(error?.message ?? '') || [409, 412].includes(error?.status ?? error?.statusCode);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function safeName(name) {
  const cleaned = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240);
  return !cleaned || cleaned === '.' || cleaned === '..' ? 'datoteka' : cleaned;
}

function publicMetadata(transfer, unlocked = false) {
  const base = {
    id: transfer.id,
    title: transfer.title,
    createdAt: transfer.createdAt,
    expiresAt: transfer.expiresAt,
    requiresPassword: Boolean(transfer.passwordHash),
  };
  if (transfer.passwordHash && !unlocked) return base;
  return {
    ...base,
    message: transfer.message,
    files: transfer.files.map(({ id, name, size, type }) => ({ id, name, size, type })),
    totalSize: transfer.totalSize,
  };
}

// Immutable manifests and file bodies live in the same private Blob store.
// Nothing in this application needs a writable or persistent local filesystem.
export async function createBlobApp(options = {}) {
  const app = express();
  const sdk = options.sdk ?? await import('@vercel/blob');
  const handleUpload = options.handleUpload ?? (await import('@vercel/blob/client')).handleUpload;
  const blobToken = options.blobToken ?? process.env.BLOB_READ_WRITE_TOKEN;
  const secret = options.tokenSecret ?? process.env.TRANSFER_SECRET ?? (
    blobToken ? createHash('sha256').update(`wetransfer:signing:v1:${blobToken}`).digest('hex') : undefined
  );
  const maxUploadBytes = options.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const now = options.now ?? Date.now;
  const sessionLifetimeMs = options.sessionLifetimeMs ?? 24 * 60 * 60 * 1000;
  const tokenLifetimeMs = options.tokenLifetimeMs ?? 15 * 60 * 1000;
  const commandOptions = { token: blobToken };

  app.disable('x-powered-by');
  if (process.env.VERCEL) app.set('trust proxy', 1);
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.use('/api', (_req, _res, next) => {
    if (!blobToken || !secret) return next(new ApiError(503, 'Pohrana datoteka trenutačno nije dostupna. Pokušaj ponovno kasnije.'));
    next();
  });

  function signature(value) {
    return createHmac('sha256', secret).update(value).digest('base64url');
  }

  function makeToken(kind, id, expires) {
    const value = `${kind}.${id}.${expires}`;
    return `${value}.${signature(value)}`;
  }

  function verifyToken(token, kind, id) {
    if (typeof token !== 'string' || token.length > 250) return false;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== kind || parts[1] !== id || !/^\d+$/.test(parts[2])) return false;
    if (!Number.isSafeInteger(Number(parts[2])) || Number(parts[2]) <= now()) return false;
    const expected = Buffer.from(signature(parts.slice(0, 3).join('.')));
    const actual = Buffer.from(parts[3]);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async function readJson(pathname) {
    let result;
    try {
      result = await sdk.get(pathname, { ...commandOptions, access: 'private', useCache: false });
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) throw new Error('Unexpected Blob metadata response');
    return { value: await new Response(result.stream).json(), etag: result.blob.etag };
  }

  function writeJson(pathname, value, extra = {}) {
    return sdk.put(pathname, JSON.stringify(value), {
      ...commandOptions,
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
      ...extra,
    });
  }

  const manifestPath = (id) => `transfers/${id}/metadata.json`;
  const draftPath = (id) => `transfers/${id}/draft.json`;

  function requireId(id) {
    if (!UUID_PATTERN.test(id)) throw new ApiError(404, 'Prijenos nije pronađen.');
  }

  async function loadTransfer(id) {
    requireId(id);
    const record = await readJson(manifestPath(id));
    if (!record) throw new ApiError(404, 'Prijenos nije pronađen.');
    const transfer = record.value;
    if (Date.parse(transfer.expiresAt) <= now()) throw new ApiError(410, 'Ovaj prijenos je istekao.');
    return transfer;
  }

  async function loadDraft(id, uploadToken) {
    requireId(id);
    if (!verifyToken(uploadToken, 'upload', id)) throw new ApiError(401, 'Sesija učitavanja nije valjana ili je istekla. Pokrenite novi prijenos.');
    const record = await readJson(draftPath(id));
    if (!record) throw new ApiError(404, 'Prijenos nije pronađen.');
    if (record.value.uploadExpiresAt <= now()) throw new ApiError(410, 'Sesija učitavanja je istekla.');
    return record.value;
  }

  function requireAccess(transfer, token) {
    if (transfer.passwordHash && !verifyToken(token, 'download', transfer.id)) {
      throw new ApiError(401, 'Za preuzimanje je potrebna lozinka.');
    }
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, storage: 'private-blob' }));
  app.get('/api/config', (_req, res) => res.json({ uploadMode: 'blob' }));

  app.post('/api/transfers/init', asyncRoute(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Neispravan zahtjev.');
    for (const field of ['title', 'message', 'recipient', 'sender', 'password']) {
      if (body[field] !== undefined && typeof body[field] !== 'string') throw new ApiError(400, 'Neispravan zahtjev.');
    }
    const title = body.title?.trim() || 'Tvoje datoteke';
    const message = body.message?.trim() || '';
    const recipient = body.recipient?.trim() || '';
    const sender = body.sender?.trim() || '';
    const password = body.password || '';
    if (title.length > 160 || message.length > 5000) throw new ApiError(400, 'Naslov ili poruka su predugi.');
    if (password.length > 200) throw new ApiError(400, 'Lozinka može sadržavati najviše 200 znakova.');
    for (const email of [recipient, sender]) {
      if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ApiError(400, 'Unesite ispravnu adresu e-pošte.');
    }
    const expiresIn = body.expiresIn === undefined ? 7 : Number(body.expiresIn);
    if (![1, 3, 7].includes(expiresIn)) throw new ApiError(400, 'Odaberite rok valjanosti od 1, 3 ili 7 dana.');
    if (!Array.isArray(body.files) || !body.files.length) throw new ApiError(400, 'Dodajte barem jednu datoteku.');
    if (body.files.length > 100) throw new ApiError(413, 'Možete dodati najviše 100 datoteka.');
    const id = randomUUID();
    let totalSize = 0;
    const files = body.files.map((file) => {
      if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 1024 || !Number.isSafeInteger(file.size) || file.size < 0) {
        throw new ApiError(400, 'Podaci o datoteci nisu ispravni.');
      }
      totalSize += file.size;
      if (totalSize > maxUploadBytes) throw new ApiError(413, 'Ukupna veličina datoteka prelazi ograničenje od 2 GB.');
      const type = typeof file.type === 'string' && file.type ? file.type.toLowerCase() : 'application/octet-stream';
      if (type.length > 200 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)) throw new ApiError(400, 'Vrsta datoteke nije ispravna.');
      const fileId = randomUUID();
      const name = safeName(file.name);
      return { id: fileId, name, size: file.size, type, pathname: `transfers/${id}/files/${fileId}/${name}` };
    });
    const createdAt = now();
    const transfer = {
      id, title, message, recipient, sender, files, totalSize, expiresIn,
      createdAt: new Date(createdAt).toISOString(),
      uploadExpiresAt: createdAt + sessionLifetimeMs,
    };
    if (password) {
      transfer.passwordSalt = randomBytes(16).toString('hex');
      transfer.passwordHash = (await scrypt(password, transfer.passwordSalt, 64)).toString('hex');
    }
    await writeJson(draftPath(id), transfer);
    res.status(201).json({ id, uploadToken: makeToken('upload', id, transfer.uploadExpiresAt), files });
  }));

  app.post('/api/blob/upload', asyncRoute(async (req, res) => {
    const result = await handleUpload({
      body: req.body,
      request: req,
      token: blobToken,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let uploadToken;
        try {
          uploadToken = clientPayload?.startsWith('{') ? JSON.parse(clientPayload).uploadToken : clientPayload;
        } catch {
          throw new ApiError(400, 'Neispravna sesija učitavanja.');
        }
        const id = typeof uploadToken === 'string' ? uploadToken.split('.')[1] : '';
        const draft = await loadDraft(id, uploadToken);
        const file = draft.files.find((item) => item.pathname === pathname);
        if (!file) throw new ApiError(403, 'Datoteka ne pripada ovom prijenosu.');
        return {
          maximumSizeInBytes: Math.max(1, file.size),
          allowedContentTypes: [file.type],
          validUntil: draft.uploadExpiresAt,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
    });
    res.json(result);
  }));

  app.post('/api/transfers/:id/complete', asyncRoute(async (req, res) => {
    const draft = await loadDraft(req.params.id, req.body?.uploadToken);
    const existing = await readJson(manifestPath(draft.id));
    if (existing) {
      if (Date.parse(existing.value.expiresAt) <= now()) throw new ApiError(410, 'Ovaj prijenos je istekao.');
      res.json(publicMetadata(existing.value, true));
      return;
    }
    // Resolve paths from the server-owned manifest, never arbitrary client URLs.
    // Bounded concurrency avoids opening 100 remote connections at once.
    for (let offset = 0; offset < draft.files.length; offset += 5) {
      await Promise.all(draft.files.slice(offset, offset + 5).map(async (file) => {
        let actual;
        try {
          actual = await sdk.head(file.pathname, commandOptions);
        } catch (error) {
          if (isMissing(error)) throw new ApiError(409, 'Nisu učitane sve datoteke. Pokušajte ponovno.');
          throw error;
        }
        if (actual.pathname !== file.pathname || actual.size !== file.size || actual.contentType.split(';')[0].trim().toLowerCase() !== file.type) {
          throw new ApiError(400, 'Učitana datoteka ne odgovara najavljenoj veličini ili vrsti.');
        }
        const url = new URL(actual.url);
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.private.blob.vercel-storage.com')) {
          throw new ApiError(503, 'Pohrana datoteka trenutačno nije dostupna. Pokušaj ponovno kasnije.');
        }
      }));
    }
    const { uploadExpiresAt: _uploadExpiresAt, expiresIn, ...transfer } = draft;
    transfer.createdAt = new Date(now()).toISOString();
    transfer.expiresAt = new Date(now() + expiresIn * 24 * 60 * 60 * 1000).toISOString();
    try {
      await writeJson(manifestPath(draft.id), transfer);
    } catch (error) {
      if (!isConflict(error)) throw error;
      const completed = await loadTransfer(draft.id);
      res.json(publicMetadata(completed, true));
      return;
    }
    res.status(201).json(publicMetadata(transfer, true));
  }));

  app.get('/api/transfers/:id', asyncRoute(async (req, res) => {
    const transfer = await loadTransfer(req.params.id);
    res.json(publicMetadata(transfer, verifyToken(req.query.token, 'download', transfer.id)));
  }));

  // Conditional writes make the password budget persist across cold starts and
  // concurrent function instances. Each IP/transfer receives 10 attempts/15 min.
  async function consumeUnlockAttempt(req, transfer) {
    const windowMs = 15 * 60 * 1000;
    const bucket = Math.floor(now() / windowMs);
    const clientHash = signature(`attempt:${req.ip}:${transfer.id}`);
    const pathname = `limits/${transfer.id}/${clientHash}/${bucket}.json`;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const record = await readJson(pathname);
      const count = record?.value?.count ?? 0;
      if (count >= 10) throw new ApiError(429, 'Previše pokušaja. Pokušajte ponovno za 15 minuta.');
      try {
        await writeJson(pathname, { count: count + 1 }, record ? { allowOverwrite: true, ifMatch: record.etag } : {});
        return;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new ApiError(429, 'Previše istodobnih pokušaja. Pokušajte ponovno kasnije.');
  }

  app.post('/api/transfers/:id/unlock', asyncRoute(async (req, res) => {
    const transfer = await loadTransfer(req.params.id);
    if (transfer.passwordHash) {
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (password.length > 200) throw new ApiError(400, 'Lozinka može sadržavati najviše 200 znakova.');
      await consumeUnlockAttempt(req, transfer);
      const actual = await scrypt(password, transfer.passwordSalt, 64);
      const expected = Buffer.from(transfer.passwordHash, 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ApiError(401, 'Lozinka nije točna. Pokušajte ponovno.');
    }
    const expires = Math.min(now() + tokenLifetimeMs, Date.parse(transfer.expiresAt));
    res.json({ ...publicMetadata(transfer, true), token: makeToken('download', transfer.id, expires) });
  }));

  app.get('/api/transfers/:id/files/:fileId', asyncRoute(async (req, res) => {
    const transfer = await loadTransfer(req.params.id);
    requireAccess(transfer, req.query.token);
    const file = transfer.files.find((item) => item.id === req.params.fileId);
    if (!file) throw new ApiError(404, 'Datoteka nije pronađena.');
    const validUntil = Math.min(now() + 5 * 60 * 1000, Date.parse(transfer.expiresAt));
    const signingToken = await sdk.issueSignedToken({ ...commandOptions, pathname: file.pathname, operations: ['get'], validUntil });
    const { presignedUrl } = await sdk.presignUrl(signingToken, { operation: 'get', pathname: file.pathname, access: 'private', validUntil });
    const url = new URL(presignedUrl);
    url.searchParams.set('download', '1');
    res.redirect(302, url.toString());
  }));

  app.get('/api/transfers/:id/download', asyncRoute(async (req, res, next) => {
    const transfer = await loadTransfer(req.params.id);
    requireAccess(transfer, req.query.token);
    res.attachment(`${safeName(transfer.title)}.zip`);
    res.type('application/zip');
    const archive = archiver('zip', { store: true });
    const streams = new Set();
    archive.on('error', (error) => {
      for (const stream of streams) stream.destroy();
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    res.on('close', () => {
      archive.abort();
      for (const stream of streams) stream.destroy();
    });
    archive.pipe(res);
    const usedNames = new Set();
    for (const file of transfer.files) {
      if (res.destroyed) return;
      const blob = await sdk.get(file.pathname, { ...commandOptions, access: 'private' });
      if (!blob || blob.statusCode !== 200) throw new ApiError(404, 'Datoteka nije pronađena.');
      let filename = file.name;
      let counter = 2;
      while (usedNames.has(filename)) {
        const ext = path.extname(file.name);
        filename = `${path.basename(file.name, ext)} (${counter++})${ext}`;
      }
      usedNames.add(filename);
      const stream = Readable.fromWeb(blob.stream);
      streams.add(stream);
      stream.on('error', (error) => archive.emit('error', error));
      const finished = new Promise((resolve, reject) => {
        stream.once('end', resolve);
        stream.once('error', reject);
        stream.once('close', resolve);
      });
      archive.append(stream, { name: filename });
      // Stream one object at a time to keep ZIP memory and connections bounded.
      await finished;
      streams.delete(stream);
    }
    await archive.finalize();
  }));

  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'Tražena stranica nije pronađena.')));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Neispravan zahtjev.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Zahtjev je prevelik.' });
    const status = error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status === 500) console.error('Transfer Blob API error:', error);
    if (status === 429) res.set('Retry-After', '900');
    res.status(status).json({ error: status === 500 ? 'Dogodila se pogreška. Pokušajte ponovno.' : error.message });
  });
  return app;
}

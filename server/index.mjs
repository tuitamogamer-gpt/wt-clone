import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scrypt = promisify(scryptCallback);
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

export async function createApp(options = {}) {
  const app = express();
  const dataDir = options.dataDir ?? path.join(projectDir, 'data');
  const maxUploadBytes = options.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const tokenLifetimeMs = options.tokenLifetimeMs ?? 15 * 60 * 1000;
  await mkdir(dataDir, { recursive: true });

  let secret = options.tokenSecret ?? process.env.TRANSFER_SECRET;
  if (!secret) {
    const secretPath = path.join(dataDir, '.token-secret');
    try {
      secret = await readFile(secretPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await writeFile(secretPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
      }
      secret = await readFile(secretPath, 'utf8');
    }
  }

  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  const storage = {
    _handleFile(req, file, callback) {
      const filename = randomUUID();
      const filePath = path.join(req.uploadDir, filename);
      let size = 0;
      const limit = new Transform({
        transform(chunk, _encoding, done) {
          req.uploadBytes += chunk.length;
          size += chunk.length;
          if (req.uploadBytes > maxUploadBytes) {
            done(new ApiError(413, 'Ukupna veličina datoteka prelazi ograničenje od 2 GB.'));
            return;
          }
          done(null, chunk);
        },
      });
      pipeline(file.stream, limit, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }))
        .then(() => callback(null, { filename, path: filePath, size }))
        .catch((error) => callback(error));
    },
    _removeFile(_req, file, callback) {
      rm(file.path, { force: true }).then(() => callback(null), callback);
    },
  };
  const upload = multer({
    storage,
    defParamCharset: 'utf8',
    limits: { files: 100, fields: 12, fieldSize: 16 * 1024, fileSize: maxUploadBytes },
    fileFilter(_req, file, callback) {
      if (file.fieldname !== 'files' && file.fieldname !== 'files[]') {
        callback(new ApiError(400, 'Nepoznato polje datoteke.'));
        return;
      }
      callback(null, true);
    },
  }).any();

  async function loadTransfer(id) {
    if (!UUID_PATTERN.test(id)) throw new ApiError(404, 'Prijenos nije pronađen.');
    let transfer;
    try {
      transfer = JSON.parse(await readFile(path.join(dataDir, id, 'metadata.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new ApiError(404, 'Prijenos nije pronađen.');
      throw error;
    }
    if (Date.parse(transfer.expiresAt) <= Date.now()) {
      throw new ApiError(410, 'Ovaj prijenos je istekao.');
    }
    return transfer;
  }

  function signature(value) {
    return createHmac('sha256', secret).update(value).digest('base64url');
  }

  function makeToken(transfer) {
    const expires = Math.min(Date.now() + tokenLifetimeMs, Date.parse(transfer.expiresAt));
    const value = `${transfer.id}.${expires}`;
    return `${value}.${signature(value)}`;
  }

  function verifyToken(transfer, token) {
    if (typeof token !== 'string' || token.length > 200) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [id, expires, signed] = parts;
    if (id !== transfer.id || !/^\d+$/.test(expires) || Number(expires) <= Date.now()) return false;
    const expected = Buffer.from(signature(`${id}.${expires}`));
    const actual = Buffer.from(signed);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  function requireAccess(transfer, token) {
    if (transfer.passwordHash && !verifyToken(transfer, token)) {
      throw new ApiError(401, 'Za preuzimanje je potrebna lozinka.');
    }
  }

  app.get('/api/config', (_req, res) => res.json({ uploadMode: 'local' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/transfers', asyncRoute(async (req, res, next) => {
    req.uploadDir = await mkdtemp(path.join(dataDir, '.incoming-'));
    req.uploadBytes = 0;
    upload(req, res, async (uploadError) => {
      const tempDir = req.uploadDir;
      try {
        if (uploadError) throw uploadError;
        const files = req.files ?? [];
        if (files.length === 0) throw new ApiError(400, 'Dodajte barem jednu datoteku.');
        const body = req.body ?? {};
        for (const field of ['title', 'message', 'recipient', 'sender', 'password', 'expiresIn']) {
          if (body[field] !== undefined && typeof body[field] !== 'string') {
            throw new ApiError(400, 'Neispravan zahtjev. Svako polje može imati samo jednu vrijednost.');
          }
        }
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
        const sender = typeof body.sender === 'string' ? body.sender.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (title.length > 160 || message.length > 5000) throw new ApiError(400, 'Naslov ili poruka su predugi.');
        if (password.length > 200) throw new ApiError(400, 'Lozinka može sadržavati najviše 200 znakova.');
        for (const email of [recipient, sender]) {
          if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
            throw new ApiError(400, 'Unesite ispravnu adresu e-pošte.');
          }
        }
        const expiresIn = body.expiresIn === undefined ? 7 : Number(body.expiresIn);
        if (![1, 3, 7].includes(expiresIn)) throw new ApiError(400, 'Odaberite rok valjanosti od 1, 3 ili 7 dana.');
        const createdAt = Date.now();
        const transfer = {
          id: randomUUID(),
          title: title || 'Tvoje datoteke',
          message,
          recipient,
          sender,
          createdAt: new Date(createdAt).toISOString(),
          expiresAt: new Date(createdAt + expiresIn * 24 * 60 * 60 * 1000).toISOString(),
          files: files.map((file) => ({
            id: file.filename,
            name: safeName(file.originalname),
            size: file.size,
            type: file.mimetype || 'application/octet-stream',
            storedName: file.filename,
          })),
          totalSize: req.uploadBytes,
        };
        if (password) {
          transfer.passwordSalt = randomBytes(16).toString('hex');
          transfer.passwordHash = (await scrypt(password, transfer.passwordSalt, 64)).toString('hex');
        }
        await writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(transfer), { mode: 0o600 });
        await rename(tempDir, path.join(dataDir, transfer.id));
        res.status(201).json(publicMetadata(transfer, true));
      } catch (error) {
        next(error);
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  }));

  app.get('/api/transfers/:id', asyncRoute(async (req, res) => {
    const transfer = await loadTransfer(req.params.id);
    res.json(publicMetadata(transfer, verifyToken(transfer, req.query.token)));
  }));

  const unlockAttempts = new Map();
  app.post('/api/transfers/:id/unlock', asyncRoute(async (req, res) => {
    const transfer = await loadTransfer(req.params.id);
    if (!transfer.passwordHash) {
      res.json({ ...publicMetadata(transfer), token: makeToken(transfer) });
      return;
    }
    const key = `${req.ip}:${transfer.id}`;
    const now = Date.now();
    for (const [entryKey, entry] of unlockAttempts) {
      if (entry.expires <= now) unlockAttempts.delete(entryKey);
    }
    const attempts = unlockAttempts.get(key);
    if (attempts && attempts.count >= 10) {
      res.set('Retry-After', String(Math.ceil((attempts.expires - now) / 1000)));
      throw new ApiError(429, 'Previše pokušaja. Pokušajte ponovno za 15 minuta.');
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length > 200) throw new ApiError(400, 'Lozinka može sadržavati najviše 200 znakova.');
    const actual = await scrypt(password, transfer.passwordSalt, 64);
    const expected = Buffer.from(transfer.passwordHash, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      unlockAttempts.set(key, { count: (attempts?.count ?? 0) + 1, expires: attempts?.expires ?? now + 15 * 60 * 1000 });
      throw new ApiError(401, 'Lozinka nije točna. Pokušajte ponovno.');
    }
    unlockAttempts.delete(key);
    res.json({ ...publicMetadata(transfer, true), token: makeToken(transfer) });
  }));

  app.get('/api/transfers/:id/files/:fileId', asyncRoute(async (req, res, next) => {
    const transfer = await loadTransfer(req.params.id);
    requireAccess(transfer, req.query.token);
    const file = transfer.files.find((item) => item.id === req.params.fileId);
    if (!file) throw new ApiError(404, 'Datoteka nije pronađena.');
    const filePath = path.join(dataDir, transfer.id, file.storedName);
    await stat(filePath).catch(() => { throw new ApiError(404, 'Datoteka nije pronađena.'); });
    res.type('application/octet-stream');
    res.download(filePath, file.name, (error) => {
      if (error && !res.headersSent) next(error);
    });
  }));

  app.get('/api/transfers/:id/download', asyncRoute(async (req, res, next) => {
    const transfer = await loadTransfer(req.params.id);
    requireAccess(transfer, req.query.token);
    for (const file of transfer.files) {
      await stat(path.join(dataDir, transfer.id, file.storedName))
        .catch(() => { throw new ApiError(404, 'Datoteka nije pronađena.'); });
    }
    res.attachment(`${safeName(transfer.title)}.zip`);
    res.type('application/zip');
    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('error', (error) => {
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    res.on('close', () => archive.abort());
    archive.pipe(res);
    const usedNames = new Set();
    for (const file of transfer.files) {
      let filename = file.name;
      let counter = 2;
      while (usedNames.has(filename)) {
        const ext = path.extname(file.name);
        filename = `${path.basename(file.name, ext)} (${counter++})${ext}`;
      }
      usedNames.add(filename);
      archive.file(path.join(dataDir, transfer.id, file.storedName), { name: filename });
    }
    await archive.finalize();
  }));

  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'Tražena stranica nije pronađena.')));
  const distDir = options.distDir ?? path.join(projectDir, 'dist');
  if (existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: 'Datoteka prelazi ograničenje od 2 GB.',
        LIMIT_FILE_COUNT: 'Možete dodati najviše 100 datoteka.',
        LIMIT_FIELD_VALUE: 'Uneseni tekst je predug.',
        LIMIT_FIELD_COUNT: 'Previše polja u zahtjevu.',
        LIMIT_UNEXPECTED_FILE: 'Nepoznato polje datoteke.',
      };
      res.status(error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT' ? 413 : 400)
        .json({ error: messages[error.code] ?? 'Prijenos nije uspio. Provjerite datoteke.' });
      return;
    }
    if (error.type === 'entity.parse.failed' || /^(Unexpected end of form|Multipart: Boundary not found)$/.test(error.message)) {
      res.status(400).json({ error: 'Neispravan zahtjev.' });
      return;
    }
    const status = error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status === 500) console.error('Transfer API error:', error);
    res.status(status).json({ error: status === 500 ? 'Dogodila se pogreška. Pokušajte ponovno.' : error.message });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3001);
  app.listen(port, '0.0.0.0', () => console.log(`Transfer API listening on http://localhost:${port}`));
}

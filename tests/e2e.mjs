import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const scratch = await mkdtemp(path.join(tmpdir(), 'we-transfer-e2e-'));
const errors = [];
const createdIds = [];
const contexts = [];

async function context() {
  const result = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  contexts.push(result);
  result.on('page', (page) => page.on('pageerror', error => errors.push(error.message)));
  return result;
}
async function chooseFiles(page, payload) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dodaj datoteke', exact: true }).click();
  await (await chooserPromise).setFiles(payload);
}
async function submit(page, buttonName = 'Izradi poveznicu') {
  const responsePromise = page.waitForResponse(response => (/\/api\/transfers$/.test(response.url()) || /\/api\/transfers\/[^/]+\/complete$/.test(response.url())) && response.request().method() === 'POST');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 201, await response.text());
  const metadata = await response.json();
  createdIds.push(metadata.id);
  const field = page.getByRole('textbox', { name: 'Poveznica za dijeljenje' });
  await field.waitFor();
  assert.equal(await field.inputValue(), `${baseUrl}/t/${metadata.id}`);
  return metadata;
}
async function download(page, accessibleName) {
  const ready = page.waitForEvent('download');
  await page.getByRole('link', { name: accessibleName, exact: true }).click();
  const result = await ready;
  assert.equal(await result.failure(), null);
  return { name: result.suggestedFilename(), bytes: await readFile(await result.path()) };
}
function zipEntries(zip) {
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

try {
  const senderContext = await context();
  await senderContext.grantPermissions(['clipboard-read', 'clipboard-write']);
  const sender = await senderContext.newPage();
  await sender.goto(baseUrl);
  await chooseFiles(sender, [
    { name: 'naš dizajn.txt', mimeType: 'text/plain', buffer: Buffer.from('Dobre ideje putuju daleko.\nČćžšđ.') },
    { name: 'brief.md', mimeType: 'text/markdown', buffer: Buffer.from('# Kreativni brief\n') },
  ]);
  await sender.getByRole('textbox', { name: 'Naslov prijenosa' }).fill('E2E Kreativni projekt');
  await sender.getByRole('textbox', { name: 'Poruka', exact: true }).fill('Za novi početak. Pozdrav!');
  await sender.getByRole('combobox', { name: 'Rok valjanosti' }).selectOption('3');
  const regular = await submit(sender);
  assert.equal(regular.title, 'E2E Kreativni projekt');
  assert.equal(regular.message, 'Za novi početak. Pozdrav!');
  assert.equal(regular.files.length, 2);
  assert.equal(Date.parse(regular.expiresAt) - Date.parse(regular.createdAt), 3 * 86400000);
  await sender.getByRole('button', { name: 'Kopiraj poveznicu', exact: true }).last().click();
  assert.equal(await sender.evaluate(() => navigator.clipboard.readText()), `${baseUrl}/t/${regular.id}`);

  const recipientContext = await context();
  const recipient = await recipientContext.newPage();
  await recipient.goto(`${baseUrl}/t/${regular.id}`);
  await recipient.getByRole('heading', { name: regular.title }).waitFor();
  assert.equal(await recipient.getByText(regular.message, { exact: true }).count(), 1);
  const original = await download(recipient, 'Preuzmi naš dizajn.txt');
  assert.equal(original.name, 'naš dizajn.txt');
  assert.equal(original.bytes.toString(), 'Dobre ideje putuju daleko.\nČćžšđ.');
  const zip = await download(recipient, 'Preuzmi sve');
  assert.equal(zip.name, 'E2E Kreativni projekt.zip');
  const entries = zipEntries(zip.bytes);
  assert.equal(entries.get('naš dizajn.txt'), original.bytes.toString());
  assert.equal(entries.get('brief.md'), '# Kreativni brief\n');
  console.log('PASS: upload, metadata, copy, original bytes and ZIP in a fresh browser context');

  await sender.getByRole('button', { name: 'Moji prijenosi' }).click();
  let dialog = sender.getByRole('dialog');
  await dialog.getByText(regular.title, { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('link', { name: 'Otvori prijenos' }).getAttribute('href'), `/t/${regular.id}`);
  await sender.keyboard.press('Escape');
  await sender.getByRole('button', { name: 'Pošalji još nešto' }).click();
  await chooseFiles(sender, { name: 'tajna.txt', mimeType: 'text/plain', buffer: Buffer.from('Samo za tebe.') });
  await sender.getByRole('textbox', { name: 'Naslov prijenosa' }).fill('E2E Privatni projekt');
  await sender.getByRole('button', { name: 'Postavke prijenosa' }).click();
  dialog = sender.getByRole('dialog');
  await dialog.getByPlaceholder('Unesi lozinku').fill('Testna-lozinka-987!');
  await dialog.getByRole('combobox').selectOption('1');
  await dialog.getByRole('button', { name: 'Spremi postavke' }).click();
  const protectedTransfer = await submit(sender);
  assert.equal(protectedTransfer.requiresPassword, true);
  assert.equal(Date.parse(protectedTransfer.expiresAt) - Date.parse(protectedTransfer.createdAt), 86400000);
  const storage = await sender.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.equal(storage.includes('Testna-lozinka-987!'), false);
  assert.equal(storage.includes('passwordHash'), false);
  assert.equal(storage.includes('passwordSalt'), false);
  assert.equal(storage.includes('"token"'), false);

  const privateRecipientContext = await context();
  const privateRecipient = await privateRecipientContext.newPage();
  await privateRecipient.goto(`${baseUrl}/t/${protectedTransfer.id}`);
  await privateRecipient.getByRole('textbox', { name: 'Lozinka', exact: true }).waitFor();
  assert.equal(await privateRecipient.getByText('tajna.txt', { exact: true }).count(), 0);
  assert.equal(await privateRecipient.getByRole('link', { name: 'Preuzmi sve' }).count(), 0);
  await privateRecipient.getByRole('textbox', { name: 'Lozinka', exact: true }).fill('kriva-lozinka');
  await privateRecipient.getByRole('button', { name: 'Otključaj datoteke' }).click();
  await privateRecipient.getByRole('alert').waitFor();
  assert.match(await privateRecipient.getByRole('alert').innerText(), /nije točna/);
  await privateRecipient.getByRole('textbox', { name: 'Lozinka', exact: true }).fill('Testna-lozinka-987!');
  await privateRecipient.getByRole('button', { name: 'Otključaj datoteke' }).click();
  await privateRecipient.getByRole('link', { name: 'Preuzmi sve' }).waitFor();
  assert.equal((await download(privateRecipient, 'Preuzmi tajna.txt')).bytes.toString(), 'Samo za tebe.');
  assert.equal(zipEntries((await download(privateRecipient, 'Preuzmi sve')).bytes).get('tajna.txt'), 'Samo za tebe.');
  assert.equal(await privateRecipient.evaluate(() => localStorage.length), 0);
  await privateRecipient.reload();
  await privateRecipient.getByRole('textbox', { name: 'Lozinka', exact: true }).waitFor();
  console.log('PASS: protected metadata, wrong/correct password, original/ZIP downloads, no persisted password or token');

  await sender.getByRole('button', { name: 'Pošalji još nešto' }).click();
  await sender.getByRole('tab', { name: 'E-pošta', exact: true }).click();
  await chooseFiles(sender, { name: 'mail.txt', mimeType: 'text/plain', buffer: Buffer.from('Spremno za e-poštu.') });
  await sender.getByRole('textbox', { name: 'E-pošta primatelja' }).fill('recipient@example.com');
  await sender.getByRole('textbox', { name: 'Tvoja e-pošta' }).fill('sender@example.com');
  await sender.getByRole('textbox', { name: 'Naslov prijenosa' }).fill('E2E e-pošta & ideje');
  await sender.getByRole('textbox', { name: 'Poruka', exact: true }).fill('Prva poruka.\nDrugi red.');
  const emailTransfer = await submit(sender, 'Pripremi prijenos');
  assert.equal(emailTransfer.requiresPassword, false);
  const mailto = new URL(await sender.getByRole('link', { name: 'Otvori e-poštu' }).getAttribute('href'));
  assert.equal(mailto.protocol, 'mailto:');
  assert.equal(decodeURIComponent(mailto.pathname), 'recipient@example.com');
  assert.equal(mailto.searchParams.get('subject'), 'E2E e-pošta & ideje');
  assert.match(mailto.searchParams.get('body'), /Prva poruka\.\nDrugi red\./);
  assert.ok(mailto.searchParams.get('body').includes(`${baseUrl}/t/${emailTransfer.id}`));
  assert.ok(mailto.searchParams.get('body').includes('sender@example.com'));
  assert.ok(await sender.getByText('Poruku šalješ iz svoje aplikacije za e-poštu.', { exact: true }).isVisible());
  await sender.reload();
  await sender.getByRole('button', { name: 'Moji prijenosi' }).click();
  dialog = sender.getByRole('dialog');
  assert.equal(await dialog.locator('.history-item').count(), 3);
  await dialog.getByRole('button', { name: 'Ukloni iz povijesti' }).first().click();
  assert.equal(await dialog.locator('.history-item').count(), 2);
  const stillAvailable = await sender.request.get(`${baseUrl}/api/transfers/${emailTransfer.id}`);
  assert.equal(stillAvailable.status(), 200);
  await sender.keyboard.press('Escape');
  console.log('PASS: email mode, complete mailto body, truthful manual-send copy, persistent history and history-only removal');

  await chooseFiles(sender, Array.from({ length: 101 }, (_, i) => ({ name: `file-${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') })));
  await sender.getByRole('alert').waitFor();
  assert.match(await sender.getByRole('alert').innerText(), /najviše 100/);
  const hugePath = path.join(scratch, 'too-large.bin');
  const huge = await open(hugePath, 'w');
  await huge.truncate(2 * 1024 ** 3 + 1);
  await huge.close();
  await chooseFiles(sender, hugePath);
  assert.match(await sender.getByRole('alert').innerText(), /najviše 2 GB/);
  await chooseFiles(sender, { name: 'after-limit.txt', mimeType: 'text/plain', buffer: Buffer.from('Još uvijek radi.') });
  await sender.getByText('after-limit.txt', { exact: true }).waitFor();
  assert.equal(await sender.getByRole('alert').count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: graceful 101-file and 2 GB client limits; selection recovers; no page errors');
  console.log(`All E2E checks passed. Created ${createdIds.length} test transfers: ${createdIds.join(', ')}`);
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}

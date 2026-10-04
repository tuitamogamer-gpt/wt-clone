import { chromium, expect as playwrightExpect } from '@playwright/test';
import assert from 'node:assert/strict';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const expect = playwrightExpect.configure({ timeout: 15_000 });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const pageErrors = [];
const consoleErrors = [];
const contexts = [];

async function makePage({ configStatus = () => 200, viewport = { width: 1440, height: 1000 } } = {}) {
  const context = await browser.newContext({ viewport });
  contexts.push(context);
  context.setDefaultTimeout(15_000);
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('**/api/config', route => {
    const status = configStatus();
    return route.fulfill({ status, json: status === 200 ? { uploadMode: 'local' } : { error: 'Storage unavailable' } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  return page;
}

async function chooseFiles(page, payload) {
  await page.locator('input[type="file"]').first().setInputFiles(payload);
}

async function dropFile(page, selector, name) {
  const dataTransfer = await page.evaluateHandle(fileName => {
    const data = new DataTransfer();
    data.items.add(new File(['Dropped through the page'], fileName, { type: 'text/plain' }));
    return data;
  }, name);
  try {
    await page.locator(selector).dispatchEvent('dragenter', { dataTransfer });
    await expect(page.locator('.page-drop-overlay')).toBeVisible();
    await page.locator(selector).dispatchEvent('dragover', { dataTransfer });
    await page.locator(selector).dispatchEvent('drop', { dataTransfer });
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.locator('.page-drop-overlay')).toHaveCount(0);
  } finally {
    await dataTransfer.dispose();
  }
}

function historyTransfer(id, { title = '', filename = 'example.txt', expired = false, requiresPassword = false } = {}) {
  const now = Date.now();
  return {
    id, title, message: '',
    files: [{ id: `file-${id}`, name: filename, type: 'text/plain', size: 2450 }],
    totalSize: 2450,
    createdAt: new Date(now - 2 * 86_400_000).toISOString(),
    expiresAt: new Date(now + (expired ? -1 : 1) * 86_400_000).toISOString(),
    requiresPassword,
  };
}

try {
  let serviceAvailable = false;
  const composer = await makePage({ configStatus: () => serviceAvailable ? 200 : 503 });
  let uploadAttempts = 0;
  composer.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) uploadAttempts++;
  });
  await composer.goto(baseUrl);
  await expect(composer.getByRole('status')).toContainText('Slanje je trenutačno na pauzi');
  await expect(composer.getByRole('button', { name: 'Slanje trenutačno nedostupno', exact: true })).toBeDisabled();
  const imageName = 'mala-ideja.png';
  await chooseFiles(composer, {
    name: imageName, mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDAAAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(composer.getByRole('button', { name: imageName, exact: true })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Slanje trenutačno nedostupno', exact: true })).toBeDisabled();
  await composer.getByRole('button', { name: imageName, exact: true }).click();
  const preview = composer.getByRole('dialog', { name: imageName });
  await expect(preview).toBeVisible();
  const image = preview.getByRole('img', { name: imageName, exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  await composer.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(composer.getByRole('button', { name: imageName, exact: true })).toBeFocused();
  serviceAvailable = true;
  await composer.getByRole('button', { name: 'Provjeri ponovno', exact: true }).click();
  await expect(composer.getByRole('button', { name: 'Izradi poveznicu', exact: true })).toBeEnabled();
  await expect(composer.getByRole('button', { name: imageName, exact: true })).toBeVisible();
  await expect(composer.locator('.service-notice')).toHaveCount(0);
  assert.equal(uploadAttempts, 0, 'Selecting and previewing files must not upload them');
  console.log('PASS: unavailable-service preflight, disabled send, private image preview, Escape/focus restore and retry preserving files');

  await dropFile(composer, '.hero', 'hero-drop.txt');
  await dropFile(composer, '.header', 'header-drop.txt');
  await expect(composer.locator('.file-row')).toHaveCount(3);
  assert.equal(uploadAttempts, 0);
  const linkTab = composer.getByRole('tab', { name: 'Poveznica', exact: true });
  const emailTab = composer.getByRole('tab', { name: 'E-pošta', exact: true });
  await linkTab.focus();
  await composer.keyboard.press('ArrowRight');
  await expect(emailTab).toHaveAttribute('aria-selected', 'true');
  await expect(emailTab).toBeFocused();
  await expect(composer.getByRole('textbox', { name: 'E-pošta primatelja', exact: true })).toBeVisible();
  await composer.keyboard.press('ArrowLeft');
  await expect(linkTab).toHaveAttribute('aria-selected', 'true');
  await expect(linkTab).toBeFocused();
  await composer.keyboard.press('End');
  await expect(emailTab).toBeFocused();
  await composer.keyboard.press('Home');
  await expect(linkTab).toBeFocused();
  console.log('PASS: file drops on hero/header and keyboard sharing-mode tabs');

  await composer.getByRole('button', { name: 'Lila', exact: true }).click();
  await expect(composer.locator('.app')).toHaveClass(/theme-lilac/);
  await composer.reload();
  await expect(composer.getByRole('button', { name: 'Lila', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(composer.locator('.app')).toHaveClass(/theme-lilac/);
  assert.equal(await composer.evaluate(() => localStorage.getItem('wt-theme')), 'lilac');
  console.log('PASS: selected theme persists after reload');

  const records = [
    historyTransfer('history-photo', { title: 'Ljetni projekt', filename: 'Čarobni-šumski-prizor.txt', requiresPassword: true }),
    historyTransfer('history-brief', { title: 'Studijski brief', filename: 'brief.md' }),
    historyTransfer('history-expired', { title: 'Prošla ideja', filename: 'archive.txt', expired: true }),
  ];
  const history = await makePage({ viewport: { width: 390, height: 844 } });
  await history.goto(baseUrl);
  await history.evaluate(items => localStorage.setItem('we-transfer-history', JSON.stringify(items)), records);
  await history.reload();
  await history.getByRole('button', { name: 'Moji prijenosi' }).click();
  const dialog = history.getByRole('dialog', { name: 'Moji prijenosi', exact: true });
  const rows = dialog.locator('.th-item');
  await expect(rows).toHaveCount(3);
  const search = dialog.getByRole('searchbox', { name: 'Pretraži prijenose po naslovu ili nazivu datoteke', exact: true });
  await search.fill('CAROBNI SUMSKI');
  await expect(rows).toHaveCount(0);
  await expect(dialog.getByText('Nema pronađenih prijenosa.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Poništi filtre', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(3);
  await search.fill('CAROBNI-SUMSKI');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Ljetni projekt');
  await search.fill('studijski');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Studijski brief');
  await search.fill('');
  await dialog.getByRole('button', { name: 'Aktivni 2', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(dialog.locator('.th-status')).toHaveText(['Aktivan', 'Aktivan']);
  await dialog.getByRole('button', { name: 'Istekli 1', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Prošla ideja');
  await expect(rows.getByRole('link')).toHaveCount(0);
  await expect(rows.getByRole('button', { name: /Kopiraj poveznicu/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Svi 3', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Ukloni iz povijesti: Ljetni projekt', exact: true }).click();
  await expect(rows).toHaveCount(2);
  assert.equal(await history.evaluate(() => JSON.parse(localStorage.getItem('we-transfer-history')).length), 2);
  await dialog.getByRole('button', { name: 'Vrati', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Ljetni projekt');
  assert.equal(await history.evaluate(() => JSON.parse(localStorage.getItem('we-transfer-history'))[0].id), 'history-photo');
  assert.ok(await history.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile history must not cause horizontal page overflow');
  await history.keyboard.press('Escape');
  for (const malformed of ['{broken-json', '{"unexpected":"object"}', '[null, {"id":"incomplete"}]']) {
    await history.evaluate(value => localStorage.setItem('we-transfer-history', value), malformed);
    await history.reload();
    await history.getByRole('button', { name: 'Moji prijenosi' }).click();
    await expect(history.getByRole('dialog').getByText('Tvoja sljedeća ideja ide prva.', { exact: true })).toBeVisible();
    await expect(history.locator('.th-item')).toHaveCount(0);
    await history.keyboard.press('Escape');
  }
  console.log('PASS: mobile history search, accents, status filters, expired actions, removal/undo, persistence and corrupt-storage recovery');

  const recipient = await makePage();
  let transferStatus = 503;
  await recipient.route('**/api/transfers/ux-unavailable', route => route.fulfill({
    status: transferStatus,
    json: { error: transferStatus === 503 ? 'Storage unavailable' : 'Poveznica je istekla ili ne postoji.' },
  }));
  await recipient.goto(`${baseUrl}/t/ux-unavailable`);
  await expect(recipient.getByRole('heading', { name: 'Veza je nakratko zastala.', exact: true })).toBeVisible();
  await expect(recipient.getByRole('button', { name: 'Pokušaj ponovno', exact: true })).toBeVisible();
  await expect(recipient.getByText('Poveznica je istekla ili ne postoji.', { exact: true })).toHaveCount(0);
  transferStatus = 404;
  await recipient.getByRole('button', { name: 'Pokušaj ponovno', exact: true }).click();
  await expect(recipient.getByRole('heading', { name: 'Ova je pošiljka otputovala.', exact: true })).toBeVisible();
  await expect(recipient.getByText('Poveznica je istekla ili ne postoji.', { exact: true })).toBeVisible();
  await expect(recipient.getByRole('button', { name: 'Pokušaj ponovno', exact: true })).toHaveCount(0);
  await expect(recipient.getByRole('link', { name: 'Napravi novi prijenos', exact: true })).toBeVisible();
  console.log('PASS: temporary download failure offers retry and remains distinct from an expired/missing transfer');

  assert.deepEqual(pageErrors, [], 'Unexpected browser exceptions');
  const unexpectedConsoleErrors = consoleErrors.filter(message => !/^Failed to load resource: the server responded with a status of (404|503)\b/.test(message));
  assert.deepEqual(unexpectedConsoleErrors, [], 'Unexpected browser console errors');
  console.log('All UX checks passed; no unexpected browser errors.');
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}

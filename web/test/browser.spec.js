import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ZipReader, BlobReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { readPlist } from '../src/plist.js';
import { inspectMachO, signatureSlots } from '../src/macho.js';

const fixture = (name) => fileURLToPath(new URL(`../test-results/fixtures/${name}`, import.meta.url));
async function select(page, { ipa = 'wechat.ipa', certificate = 'identity.p12', password = 'fixture-password', profiles = ['app', 'extension'], appGroup = '' } = {}) {
  await page.goto('./');
  await page.locator('#ipa').setInputFiles(fixture(ipa));
  await page.locator('#certificate').setInputFiles(fixture(certificate));
  await page.locator('#password').fill(password);
  await page.locator('#profiles').setInputFiles(profiles.map((name) => fixture(`${name}.mobileprovision`)));
  await page.locator('#app-group').fill(appGroup);
}

test('builds a signed IPA locally, preserving existing extensions', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push([request.method(), request.url()]));
  await select(page, { ipa: 'wechat-with-share.ipa', profiles: ['app', 'extension', 'share'] });
  await page.getByRole('button', { name: 'Build IPA', exact: true }).click();
  await expect(page.locator('#cancel')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#status')).toHaveText('Your signed IPA is ready.');
  await expect(page.locator('#download')).toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await waiting;
  const output = fixture('signed.ipa');
  await download.saveAs(output);
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(output)])));
  const entries = await reader.getEntries();
  const byName = new Map(entries.map((entry) => [entry.filename, entry]));
  const data = (path) => byName.get(`Payload/WeChat.app/${path}`).getData(new Uint8ArrayWriter());
  const main = readPlist(await data('Info.plist'));
  const extension = readPlist(await data('PlugIns/WeChatStickers.appex/Info.plist'));
  expect(main.CFBundleIdentifier).toBe('dev.test.WeChat');
  expect(extension.CFBundleIdentifier).toBe('dev.test.WeChat.WeChatStickers');
  expect(extension.CFBundleVersion).toBe(main.CFBundleVersion);
  expect(extension.WeChatStickersAppGroup).toBe(main.WeChatStickersAppGroup);
  expect(readPlist(await data('PlugIns/Share.appex/Info.plist')).CFBundleIdentifier).toBe('dev.test.WeChat.Share');
  const mainSlice = inspectMachO(await data('WeChat'))[0];
  expect(mainSlice.libraries).toContain('@executable_path/dev.gholts.dylib.WeChatStickers.dylib');
  const entitlements = readPlist(signatureSlots(mainSlice.signature).get(5).subarray(8));
  expect(entitlements['com.apple.security.application-groups']).toContain('group.dev.test.stickers');
  expect(entries.some((entry) => /certificate\.p12|key\.pem|credentials\//.test(entry.filename))).toBe(false);
  expect(requests.every(([method, url]) => method === 'GET' && new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  // CMS alone authenticates CodeDirectory, not the actual pages or bundle resources.
  // Independently compare both SHA-1 and SHA-256 slots with the downloaded IPA.
  for (const [binary, folder] of [['WeChat', ''], ['PlugIns/Share.appex/Share', 'PlugIns/Share.appex/'], ['PlugIns/WeChatStickers.appex/WeChatStickers', 'PlugIns/WeChatStickers.appex/']]) {
    const bytes = await data(binary);
    for (const slice of inspectMachO(bytes)) {
      const slots = signatureSlots(slice.signature);
      for (const type of [0, 0x1000]) {
        const directory = slots.get(type);
        const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
        const hashOffset = view.getUint32(16);
        const count = view.getUint32(28);
        const limit = view.getUint32(32);
        const size = view.getUint8(36);
        const algorithm = view.getUint8(37) === 1 ? 'sha1' : 'sha256';
        const pageSize = 2 ** view.getUint8(39);
        const hash = (value) => createHash(algorithm).update(value).digest().subarray(0, size);
        for (let i = 0; i < count; i++) expect(Buffer.from(directory.subarray(hashOffset + i * size, hashOffset + (i + 1) * size))).toEqual(hash(bytes.subarray(slice.offset + i * pageSize, slice.offset + Math.min(limit, (i + 1) * pageSize))));
        for (const [slot, name] of [[1, 'Info.plist'], [3, '_CodeSignature/CodeResources']]) expect(Buffer.from(directory.subarray(hashOffset - slot * size, hashOffset - (slot - 1) * size))).toEqual(hash(await data(folder + name)));
      }
    }
  }
  expect(await page.locator('#password').inputValue()).toBe('');
  await reader.close();
});

test('optional password supports an unprotected P12', async ({ page }) => {
  await select(page, { certificate: 'unprotected.p12', password: '' });
  await page.locator('#build').click();
  await expect(page.locator('#cancel')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#status')).toHaveText('Your signed IPA is ready.');
  await expect(page.locator('#download')).toBeVisible();
});

test('explicit App Group reaches both signed bundles', async ({ page }) => {
  await select(page, { profiles: ['app-multi', 'extension-multi'], appGroup: 'group.9a96c46eb073c04a.5' });
  await page.locator('#build').click();
  await expect(page.locator('#cancel')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#status')).toHaveText('Your signed IPA is ready.');
  const waiting = page.waitForEvent('download');
  await page.locator('#download').click();
  const output = fixture('explicit-group.ipa');
  await (await waiting).saveAs(output);
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(output)])));
  const entries = await reader.getEntries();
  for (const name of ['Payload/WeChat.app/Info.plist', 'Payload/WeChat.app/PlugIns/WeChatStickers.appex/Info.plist']) {
    const value = readPlist(await entries.find((entry) => entry.filename === name).getData(new Uint8ArrayWriter()));
    expect(value.WeChatStickersAppGroup).toBe('group.9a96c46eb073c04a.5');
  }
  await reader.close();
});

test('wrong password and incompatible groups produce no download', async ({ page }) => {
  await select(page, { password: 'wrong' });
  await page.locator('#build').click();
  await expect(page.locator('#status')).toContainText('Cannot unlock', { timeout: 30_000 });
  await expect(page.locator('#download')).toBeHidden();
  await select(page, { profiles: ['app', 'wrong-group'] });
  await page.locator('#build').click();
  await expect(page.locator('#status')).toContainText('same App Group');
});

test('missing existing-extension profile is actionable', async ({ page }) => {
  await select(page, { ipa: 'wechat-with-share.ipa' });
  await page.locator('#build').click();
  await expect(page.locator('#status')).toContainText('dev.test.WeChat.Share', { timeout: 30_000 });
  await expect(page.locator('#download')).toBeHidden();
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.goto('./');
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/preview.png', import.meta.url)), fullPage: true });
});

test('responsive form stays within the viewport and can cancel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await select(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sizes = await page.locator('input').evaluateAll((elements) => elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
  expect(new Set(sizes.map((size) => size.width)).size).toBe(1);
  expect(sizes.every((size) => size.width === 280 && size.height === 26)).toBe(true);
  const buttons = await page.evaluate(() => [getComputedStyle(document.querySelector('#build')), getComputedStyle(document.querySelector('#ipa'), '::file-selector-button'), getComputedStyle(document.querySelector('#profiles'), '::file-selector-button')].map((style) => [style.width, style.height]));
  expect(buttons).toEqual([['104px', '26px'], ['104px', '26px'], ['104px', '26px']]);
  await page.locator('#build').click();
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toContainText('Canceled');
  await expect(page.locator('#build')).toBeEnabled();
  await expect(page.locator('#download')).toBeHidden();
});

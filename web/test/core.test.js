import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readPlist, writePlist } from '../src/plist.js';
import { readProfile, selectProfiles } from '../src/profiles.js';
import { inspectMachO } from '../src/macho.js';
import { safePath } from '../src/archive.js';

const fixture = (name) => new URL(`../test-results/fixtures/${name}`, import.meta.url);
const profile = async (name) => readProfile(new File([await readFile(fixture(`${name}.mobileprovision`))], `${name}.mobileprovision`));

test('binary Info.plist round-trips without losing values', async () => {
  const value = readPlist(await readFile(fixture('input/Payload/WeChat.app/Info.plist')));
  assert.equal(value.CFBundleIdentifier, 'com.tencent.xin');
  assert.deepEqual(readPlist(writePlist(value)), value);
});

test('profiles select the host, extension and common group', async () => {
  const plan = selectProfiles(await Promise.all([profile('extension'), profile('app')]));
  assert.equal(plan.app.id, 'dev.test.WeChat');
  assert.equal(plan.extension.id, 'dev.test.WeChat.WeChatStickers');
  assert.equal(plan.group, 'group.dev.test.stickers');
});

test('missing host, duplicate IDs, mismatched groups and expiry fail', async () => {
  const app = await profile('app');
  const extension = await profile('extension');
  assert.throws(() => selectProfiles([extension]), /app profile/);
  assert.throws(() => selectProfiles([app, app, extension]), /only one profile/);
  assert.throws(() => selectProfiles([app, extension, { ...app, id: 'other', team: 'OTHER' }]), /same signing team/);
  assert.throws(() => selectProfiles([app, { ...extension, groups: ['group.other'] }]), /same App Group/);
  await assert.rejects(profile('expired'), /expired/);
});

test('changed profile content fails CMS signature verification', async () => {
  const data = await readFile(fixture('app.mobileprovision'));
  const start = data.indexOf(Buffer.from('group.dev.test.stickers'));
  assert.ok(start >= 0);
  data[start + 6] ^= 1;
  await assert.rejects(readProfile(new File([data], 'tampered.mobileprovision')));
});

test('reject unsafe archive paths and malformed Mach-O binaries', () => {
  for (const path of ['../key', '/secret', 'Payload/../key', 'Payload\\key', 'Payload/./key', 'C:/key', 'Payload/\0key', 'Payload//key']) assert.throws(() => safePath(path));
  assert.equal(safePath('Payload/WeChat.app/'), 'Payload/WeChat.app');
  assert.throws(() => inspectMachO(new Uint8Array(8)), /Mach-O/);
});

test('load-command inspection distinguishes encrypted code', async () => {
  const binary = new Uint8Array(await readFile(fixture('input/Payload/WeChat.app/WeChat')));
  assert.equal(inspectMachO(binary)[0].encrypted, false);
  const view = new DataView(binary.buffer);
  let cursor = 32;
  for (let i = 0; i < view.getUint32(16, true); i++) {
    if (view.getUint32(cursor, true) === 0x2c) {
      view.setUint32(cursor + 16, 1, true);
      assert.equal(inspectMachO(binary)[0].encrypted, true);
      return;
    }
    cursor += view.getUint32(cursor + 4, true);
  }
  assert.fail('Fixture must have LC_ENCRYPTION_INFO_64');
});

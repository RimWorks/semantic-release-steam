import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import protobuf from 'protobufjs';
import {
  addLocalizedUpdateFields,
  applyWorkshopUpdates,
  canPollForGuardApproval,
  logOffAndWait,
  connectWithTimeout,
  verifyPublishedItem,
} from '../lib/workshop-tags.mjs';

const require = createRequire(import.meta.url);

function failingFn(label) {
  return async () => { throw new Error(`${label} should not be called`); };
}

function pristineUpdateType() {
  const json = require('steam-user/protobufs/generated/steammessages_publishedfile.steamclient.json');
  return protobuf.Root.fromJSON(json).lookupType('CPublishedFile_Update_Request');
}

function detailsReader(details, seen = []) {
  return {
    _sendUnified: (method, data, cb) => {
      seen.push({ method, data });
      const read = typeof details === 'function' ? details(seen.length) : details;
      cb({ publishedfiledetails: read === undefined ? [] : [read] }, { proto: { eresult: 1 } });
    },
  };
}

test('applyWorkshopUpdates returns without logging in when no mod has tags or localized entries', async () => {
  const result = await applyWorkshopUpdates({
    steamUsername: 'u',
    steamPassword: 'p',
    appId: '294100',
    mods: [
      { name: 'NoTags', publishedFileId: '1' },
      { name: 'EmptyTags', publishedFileId: '2', tags: [] },
      { name: 'EmptyLocalized', publishedFileId: '3', tags: [], localized: [] },
    ],
    logger: { log() {} },
    login: failingFn('login'),
    connect: failingFn('connect'),
    sendUpdate: failingFn('sendUpdate'),
    verify: failingFn('verify'),
  });

  assert.equal(result, undefined);
});

test('a mod with only localized entries does not hit the early return', async () => {
  const sent = [];

  await applyWorkshopUpdates({
    steamRefreshToken: 'rt',
    appId: '294100',
    mods: [{
      name: 'Untagged',
      publishedFileId: '1',
      localized: [{ code: 'schinese', language: 6, title: '标题', description: '说明' }],
    }],
    logger: { log() {} },
    connect: async () => ({ user: {}, died: new Promise(() => {}) }),
    disconnect: async () => {},
    sendUpdate: async (_user, opts) => { sent.push(opts); },
    verify: async () => ({ matches: true, actual: {}, mismatched: [] }),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].language, 6);
  assert.equal(sent[0].tags, undefined);
});

test('the runtime add puts language 17 and update_tags 18 on the wire', async () => {
  const type = pristineUpdateType();
  const message = { appid: 294100, publishedfileid: '3807072789', language: 6, update_tags: true };

  const bundledAlready = Boolean(type.fields.language);
  const before = type.encode(message).finish().length;

  addLocalizedUpdateFields(type);
  const after = Buffer.from(type.encode(message).finish());

  assert.equal(type.fields.language.id, 17);
  assert.equal(type.fields.update_tags.id, 18);
  assert.equal(after.length - before, bundledAlready ? 0 : 6);
  assert.ok(after.toString('hex').endsWith('880106900101'), after.toString('hex'));
});

test('addLocalizedUpdateFields is a no-op on a type that already has the fields', () => {
  const type = pristineUpdateType();

  addLocalizedUpdateFields(type);
  addLocalizedUpdateFields(type);

  assert.equal(type.fields.language.id, 17);
  assert.equal(type.fields.update_tags.id, 18);
});

test('a refresh token skips the login step entirely', async () => {
  const loginCalls = [];
  const connectCalls = [];

  await applyWorkshopUpdates({
    steamRefreshToken: 'rt-123',
    appId: '294100',
    mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
    logger: { log() {} },
    login: async opts => { loginCalls.push(opts); return 'should-not-be-used'; },
    connect: async token => { connectCalls.push(token); return { user: {}, died: new Promise(() => {}) }; },
    disconnect: async () => {},
    sendUpdate: async () => {},
    verify: async () => ({ matches: true, actual: { tags: ['mod'] }, mismatched: [] }),
  });

  assert.equal(loginCalls.length, 0);
  assert.deepEqual(connectCalls, ['rt-123']);
});

test('the password path logs in first, then connects with the returned refresh token', async () => {
  const loginCalls = [];
  const connectCalls = [];

  await applyWorkshopUpdates({
    steamUsername: 'builder',
    steamPassword: 'secret',
    appId: '294100',
    mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
    logger: { log() {} },
    login: async opts => { loginCalls.push(opts); return 'rt-from-login'; },
    connect: async token => { connectCalls.push(token); return { user: {}, died: new Promise(() => {}) }; },
    disconnect: async () => {},
    sendUpdate: async () => {},
    verify: async () => ({ matches: true, actual: { tags: ['mod'] }, mismatched: [] }),
  });

  assert.equal(loginCalls[0].steamUsername, 'builder');
  assert.equal(loginCalls[0].steamPassword, 'secret');
  assert.deepEqual(connectCalls, ['rt-from-login']);
});

test('a rejected login propagates and never reaches connect', async () => {
  const connectCalls = [];

  await assert.rejects(
    () => applyWorkshopUpdates({
      steamUsername: 'builder',
      steamPassword: 'secret',
      appId: '294100',
      mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
      logger: { log() {} },
      login: async () => { throw new Error('Steam Guard approval timed out'); },
      connect: async token => { connectCalls.push(token); return { user: {}, died: new Promise(() => {}) }; },
      sendUpdate: async () => {},
      verify: async () => ({ matches: true, actual: {}, mismatched: [] }),
    }),
    /Steam Guard approval timed out/,
  );

  assert.equal(connectCalls.length, 0);
});

test('a rejected connect propagates and never reaches sendUpdate', async () => {
  const sendCalls = [];

  await assert.rejects(
    () => applyWorkshopUpdates({
      steamRefreshToken: 'rt',
      appId: '294100',
      mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
      logger: { log() {} },
      connect: async () => { throw new Error('Steam CM connection timed out'); },
      sendUpdate: async opts => { sendCalls.push(opts); },
      verify: async () => ({ matches: true, actual: {}, mismatched: [] }),
    }),
    /Steam CM connection timed out/,
  );

  assert.equal(sendCalls.length, 0);
});

test('a rejected Update#1 call fails the whole publish and still disconnects', async () => {
  const disconnectCalls = [];

  await assert.rejects(
    () => applyWorkshopUpdates({
      steamRefreshToken: 'rt',
      appId: '294100',
      mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
      logger: { log() {} },
      connect: async () => ({ user: {}, died: new Promise(() => {}) }),
      disconnect: async () => { disconnectCalls.push(true); },
      sendUpdate: async () => { throw new Error('PublishedFile.Update#1 returned eresult 2'); },
      verify: async () => ({ matches: true, actual: {}, mismatched: [] }),
    }),
    /PublishedFile\.Update#1 returned eresult 2/,
  );

  assert.equal(disconnectCalls.length, 1);
});

test('a verify mismatch fails the publish and names the mod and language pairs', async () => {
  const sent = [];

  await assert.rejects(
    () => applyWorkshopUpdates({
      steamRefreshToken: 'rt',
      appId: '294100',
      mods: [
        { name: 'First', publishedFileId: '1', tags: ['Mod'] },
        {
          name: 'Second',
          publishedFileId: '2',
          tags: ['Mod'],
          localized: [{ code: 'schinese', language: 6, title: '标题', description: '说明' }],
        },
      ],
      logger: { log() {} },
      connect: async () => ({ user: {}, died: new Promise(() => {}) }),
      disconnect: async () => {},
      sendUpdate: async (_user, opts) => { sent.push(opts); },
      verify: async (_user, _publishedfileid, expected) => (
        expected.language === undefined
          ? { matches: true, actual: { tags: ['mod'] }, mismatched: [] }
          : { matches: false, actual: { language: 0, title: 'English', file_description: 'en' }, mismatched: ['language'] }
      ),
    }),
    /Updated: \[First \(default\), Second \(default\)\]\. Still stale on Workshop: \[Second \(schinese\)\]/,
  );

  assert.deepEqual(sent.map(s => s.publishedfileid), ['1', '2', '2']);
});

test('sends exactly the configured tags, not merged with anything else', async () => {
  const sent = [];

  await applyWorkshopUpdates({
    steamRefreshToken: 'rt',
    appId: '294100',
    mods: [{ name: 'M', publishedFileId: '1', tags: ['QoL', 'Mod'] }],
    logger: { log() {} },
    connect: async () => ({ user: {}, died: new Promise(() => {}) }),
    disconnect: async () => {},
    sendUpdate: async (_user, opts) => { sent.push(opts); },
    verify: async () => ({ matches: true, actual: { tags: ['qol', 'mod'] }, mismatched: [] }),
  });

  assert.deepEqual(sent[0].tags, ['QoL', 'Mod']);
});

test('disconnects after a fully successful run', async () => {
  const disconnectCalls = [];

  await applyWorkshopUpdates({
    steamRefreshToken: 'rt',
    appId: '294100',
    mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
    logger: { log() {} },
    connect: async () => ({ user: {}, died: new Promise(() => {}) }),
    disconnect: async () => { disconnectCalls.push(true); },
    sendUpdate: async () => {},
    verify: async () => ({ matches: true, actual: { tags: ['mod'] }, mismatched: [] }),
  });

  assert.equal(disconnectCalls.length, 1);
});

test('canPollForGuardApproval is true for a device-confirmation guard', () => {
  assert.equal(canPollForGuardApproval([{ type: 4 }]), true);
});

test('canPollForGuardApproval is true for an email-confirmation guard', () => {
  assert.equal(canPollForGuardApproval([{ type: 5 }]), true);
});

test('canPollForGuardApproval is false when only code-based guards are offered', () => {
  assert.equal(canPollForGuardApproval([{ type: 2 }, { type: 3 }]), false);
});

test('canPollForGuardApproval is false when no guard actions are offered', () => {
  assert.equal(canPollForGuardApproval(undefined), false);
  assert.equal(canPollForGuardApproval([]), false);
});

test('logOffAndWait resolves immediately when the session is already dead', async () => {
  const user = new EventEmitter();
  user.steamID = null;
  user.logOff = () => { throw new Error('logOff should not be called on a dead session'); };

  await logOffAndWait(user);
});

test('logOffAndWait calls logOff and waits for the disconnected event on a live session', async () => {
  const user = new EventEmitter();
  user.steamID = 'live';
  let logOffCalled = false;
  user.logOff = () => { logOffCalled = true; setImmediate(() => user.emit('disconnected')); };

  await logOffAndWait(user);

  assert.equal(logOffCalled, true);
});

test('logOffAndWait falls back to resolving if disconnected never fires', async () => {
  const user = new EventEmitter();
  user.steamID = 'live';
  user.logOff = () => {};

  await logOffAndWait(user, 20);
});

test('connectWithTimeout resolves on loggedOn without waiting for the timeout', async () => {
  const user = new EventEmitter();
  user.logOff = () => { throw new Error('logOff should not be called when loggedOn fires'); };

  await connectWithTimeout(user, 5000, () => { setImmediate(() => user.emit('loggedOn')); });

  assert.equal(user.listenerCount('loggedOn'), 0);
  assert.equal(user.listenerCount('error'), 0);
});

test('connectWithTimeout rejects, logs off, and removes its listeners on a timeout', async () => {
  const user = new EventEmitter();
  let logOffCalled = false;
  user.logOff = () => { logOffCalled = true; };

  await assert.rejects(
    () => connectWithTimeout(user, 20, () => {}),
    /Steam CM connection timed out/,
  );

  assert.equal(logOffCalled, true);
  assert.equal(user.listenerCount('loggedOn'), 0);
  assert.equal(user.listenerCount('error'), 0);
});

test('connectWithTimeout rejects on an error event without waiting for the timeout', async () => {
  const user = new EventEmitter();
  user.logOff = () => {};

  await assert.rejects(
    () => connectWithTimeout(user, 5000, () => { setImmediate(() => user.emit('error', new Error('boom'))); }),
    /boom/,
  );

  assert.equal(user.listenerCount('loggedOn'), 0);
  assert.equal(user.listenerCount('error'), 0);
});

test('verifyPublishedItem retries a stale read before reporting a mismatch', async () => {
  const seen = [];
  const user = detailsReader(call => ({ tags: call === 1 ? [{ tag: 'Old' }] : [{ tag: 'QoL' }] }), seen);

  const result = await verifyPublishedItem(user, '1', { tags: ['QoL'] }, 3, 1);

  assert.equal(seen.length, 2);
  assert.equal(result.matches, true);
});

test('verifyPublishedItem gives up and reports the mismatch after exhausting its retries', async () => {
  const seen = [];
  const user = detailsReader({ tags: [{ tag: 'Old' }] }, seen);

  const result = await verifyPublishedItem(user, '1', { tags: ['QoL'] }, 2, 1);

  assert.equal(seen.length, 2);
  assert.equal(result.matches, false);
  assert.deepEqual(result.mismatched, ['tags']);
  assert.deepEqual(result.actual.tags, ['old']);
});

test('verifyPublishedItem reads the language slot it is checking, not slot 0', async () => {
  const seen = [];
  const user = detailsReader({ language: 6, title: '标题', file_description: '说明' }, seen);

  const result = await verifyPublishedItem(
    user,
    '1',
    { language: 6, title: '标题', file_description: '说明' },
    1,
    1,
  );

  assert.equal(seen[0].method, 'PublishedFile.GetDetails#1');
  assert.equal(seen[0].data.language, 6);
  assert.deepEqual(seen[0].data.publishedfileids, ['1']);
  assert.equal(seen[0].data.includetags, true);
  assert.equal(result.matches, true);
});

test('verifyPublishedItem fails when the read falls back to another language slot', async () => {
  const user = detailsReader({ language: 0, title: 'English title', file_description: 'English body' });

  const result = await verifyPublishedItem(
    user,
    '1',
    { language: 6, title: '标题', file_description: '说明' },
    1,
    1,
  );

  assert.equal(result.matches, false);
  assert.deepEqual(result.mismatched, ['language', 'title', 'file_description']);
});

test('verifyPublishedItem fails when an absent language decodes to null instead of 0', async () => {
  const user = detailsReader({ language: null, title: '标题', file_description: '说明' });

  const result = await verifyPublishedItem(user, '1', { language: 6, title: '标题', file_description: '说明' }, 1, 1);

  assert.equal(result.matches, false);
  assert.deepEqual(result.mismatched, ['language']);
});

test('verifyPublishedItem fails when the returned text does not match what was sent', async () => {
  const user = detailsReader({ language: 6, title: '标题', file_description: 'stale translation' });

  const result = await verifyPublishedItem(user, '1', { language: 6, title: '标题', file_description: '说明' }, 1, 1);

  assert.equal(result.matches, false);
  assert.deepEqual(result.mismatched, ['file_description']);
});

test('verifyPublishedItem compares visibility when the caller sent one', async () => {
  const user = detailsReader({ language: 0, visibility: 1, tags: [{ tag: 'Mod' }] });

  const result = await verifyPublishedItem(user, '1', { visibility: 0, tags: ['Mod'] }, 1, 1);

  assert.equal(result.matches, false);
  assert.deepEqual(result.mismatched, ['visibility']);
});

test('a localized send always carries both the title and the description', async () => {
  const sent = [];

  await applyWorkshopUpdates({
    steamRefreshToken: 'rt',
    appId: '294100',
    mods: [{
      name: 'M',
      publishedFileId: '1',
      localized: [
        { code: 'schinese', language: 6, title: '标题', description: '说明' },
        { code: 'german', language: 8, title: 'Titel', description: 'Beschreibung' },
      ],
    }],
    logger: { log() {} },
    connect: async () => ({ user: {}, died: new Promise(() => {}) }),
    disconnect: async () => {},
    sendUpdate: async (_user, opts) => { sent.push(opts); },
    verify: async () => ({ matches: true, actual: {}, mismatched: [] }),
  });

  assert.equal(sent.length, 2);
  for (const send of sent) {
    assert.equal(typeof send.title, 'string');
    assert.equal(typeof send.file_description, 'string');
  }
  assert.deepEqual(sent.map(s => s.language), [6, 8]);
});

test('a mod with tags sends them on the default update and on every localized one', async () => {
  const sent = [];

  await applyWorkshopUpdates({
    steamRefreshToken: 'rt',
    appId: '294100',
    mods: [{
      name: 'M',
      publishedFileId: '1',
      tags: ['QoL', 'Mod'],
      localized: [
        { code: 'schinese', language: 6, title: '标题', description: '说明' },
        { code: 'german', language: 8, title: 'Titel', description: 'Beschreibung' },
      ],
    }],
    logger: { log() {} },
    connect: async () => ({ user: {}, died: new Promise(() => {}) }),
    disconnect: async () => {},
    sendUpdate: async (_user, opts) => { sent.push(opts); },
    verify: async () => ({ matches: true, actual: {}, mismatched: [] }),
  });

  assert.equal(sent.length, 3);
  for (const send of sent) {
    assert.deepEqual(send.tags, ['QoL', 'Mod']);
  }
  assert.deepEqual(sent.map(s => s.language), [undefined, 6, 8]);
});

test('a session death mid-run rejects instead of hanging on a stuck sendUpdate', async () => {
  const disconnectCalls = [];

  await assert.rejects(
    () => applyWorkshopUpdates({
      steamRefreshToken: 'rt',
      appId: '294100',
      mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
      logger: { log() {} },
      connect: async () => ({
        user: {},
        died: Promise.reject(new Error('Steam CM session disconnected (eresult 34)')),
      }),
      disconnect: async () => { disconnectCalls.push(true); },
      sendUpdate: () => new Promise(() => {}),
      verify: async () => ({ matches: true, actual: {}, mismatched: [] }),
    }),
    /Steam CM session disconnected/,
  );

  assert.equal(disconnectCalls.length, 1);
});

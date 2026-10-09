import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkshopTags } from '../lib/workshop-tags.mjs';

function failingFn(label) {
  return async () => { throw new Error(`${label} should not be called`); };
}

test('applyWorkshopTags returns without logging in when no mod has tags', async () => {
  const result = await applyWorkshopTags({
    steamUsername: 'u',
    steamPassword: 'p',
    appId: '294100',
    mods: [
      { name: 'NoTags', publishedFileId: '1' },
      { name: 'EmptyTags', publishedFileId: '2', tags: [] },
    ],
    logger: { log() {} },
    login: failingFn('login'),
    connect: failingFn('connect'),
    sendUpdate: failingFn('sendUpdate'),
    verify: failingFn('verify'),
  });

  assert.equal(result, undefined);
});

test('a refresh token skips the login step entirely', async () => {
  const loginCalls = [];
  const connectCalls = [];

  await applyWorkshopTags({
    steamRefreshToken: 'rt-123',
    appId: '294100',
    mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
    logger: { log() {} },
    login: async opts => { loginCalls.push(opts); return 'should-not-be-used'; },
    connect: async token => { connectCalls.push(token); return { user: {}, died: new Promise(() => {}) }; },
    disconnect: async () => {},
    sendUpdate: async () => {},
    verify: async () => ({ matches: true, actual: ['mod'] }),
  });

  assert.equal(loginCalls.length, 0);
  assert.deepEqual(connectCalls, ['rt-123']);
});

test('the password path logs in first, then connects with the returned refresh token', async () => {
  const loginCalls = [];
  const connectCalls = [];

  await applyWorkshopTags({
    steamUsername: 'builder',
    steamPassword: 'secret',
    appId: '294100',
    mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
    logger: { log() {} },
    login: async opts => { loginCalls.push(opts); return 'rt-from-login'; },
    connect: async token => { connectCalls.push(token); return { user: {}, died: new Promise(() => {}) }; },
    disconnect: async () => {},
    sendUpdate: async () => {},
    verify: async () => ({ matches: true, actual: ['mod'] }),
  });

  assert.equal(loginCalls[0].steamUsername, 'builder');
  assert.equal(loginCalls[0].steamPassword, 'secret');
  assert.deepEqual(connectCalls, ['rt-from-login']);
});

test('a rejected login propagates and never reaches connect', async () => {
  const connectCalls = [];

  await assert.rejects(
    () => applyWorkshopTags({
      steamUsername: 'builder',
      steamPassword: 'secret',
      appId: '294100',
      mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
      logger: { log() {} },
      login: async () => { throw new Error('Steam Guard approval timed out'); },
      connect: async token => { connectCalls.push(token); return { user: {}, died: new Promise(() => {}) }; },
      sendUpdate: async () => {},
      verify: async () => ({ matches: true, actual: [] }),
    }),
    /Steam Guard approval timed out/,
  );

  assert.equal(connectCalls.length, 0);
});

test('a rejected connect propagates and never reaches sendUpdate', async () => {
  const sendCalls = [];

  await assert.rejects(
    () => applyWorkshopTags({
      steamRefreshToken: 'rt',
      appId: '294100',
      mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
      logger: { log() {} },
      connect: async () => { throw new Error('Steam CM connection timed out'); },
      sendUpdate: async opts => { sendCalls.push(opts); },
      verify: async () => ({ matches: true, actual: [] }),
    }),
    /Steam CM connection timed out/,
  );

  assert.equal(sendCalls.length, 0);
});

test('a rejected Update#1 call fails the whole publish and still disconnects', async () => {
  const disconnectCalls = [];

  await assert.rejects(
    () => applyWorkshopTags({
      steamRefreshToken: 'rt',
      appId: '294100',
      mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
      logger: { log() {} },
      connect: async () => ({ user: {}, died: new Promise(() => {}) }),
      disconnect: async () => { disconnectCalls.push(true); },
      sendUpdate: async () => { throw new Error('PublishedFile.Update#1 returned eresult 2'); },
      verify: async () => ({ matches: true, actual: [] }),
    }),
    /PublishedFile\.Update#1 returned eresult 2/,
  );

  assert.equal(disconnectCalls.length, 1);
});

test('a verify mismatch fails the publish and names which mods are still untagged', async () => {
  const sent = [];

  await assert.rejects(
    () => applyWorkshopTags({
      steamRefreshToken: 'rt',
      appId: '294100',
      mods: [
        { name: 'First', publishedFileId: '1', tags: ['Mod'] },
        { name: 'Second', publishedFileId: '2', tags: ['Mod'] },
      ],
      logger: { log() {} },
      connect: async () => ({ user: {}, died: new Promise(() => {}) }),
      disconnect: async () => {},
      sendUpdate: async (_user, opts) => { sent.push(opts); },
      verify: async (_user, publishedfileid) => (
        publishedfileid === '1'
          ? { matches: true, actual: ['mod'] }
          : { matches: false, actual: ['old-tag'] }
      ),
    }),
    /Tagged: \[First\]\. Still untagged on Workshop: \[Second\]/,
  );

  assert.deepEqual(sent.map(s => s.publishedfileid), ['1', '2']);
});

test('sends exactly the configured tags, not merged with anything else', async () => {
  const sent = [];

  await applyWorkshopTags({
    steamRefreshToken: 'rt',
    appId: '294100',
    mods: [{ name: 'M', publishedFileId: '1', tags: ['QoL', 'Mod'] }],
    logger: { log() {} },
    connect: async () => ({ user: {}, died: new Promise(() => {}) }),
    disconnect: async () => {},
    sendUpdate: async (_user, opts) => { sent.push(opts); },
    verify: async () => ({ matches: true, actual: ['qol', 'mod'] }),
  });

  assert.deepEqual(sent[0].tags, ['QoL', 'Mod']);
});

test('disconnects after a fully successful run', async () => {
  const disconnectCalls = [];

  await applyWorkshopTags({
    steamRefreshToken: 'rt',
    appId: '294100',
    mods: [{ name: 'M', publishedFileId: '1', tags: ['Mod'] }],
    logger: { log() {} },
    connect: async () => ({ user: {}, died: new Promise(() => {}) }),
    disconnect: async () => { disconnectCalls.push(true); },
    sendUpdate: async () => {},
    verify: async () => ({ matches: true, actual: ['mod'] }),
  });

  assert.equal(disconnectCalls.length, 1);
});

test('a session death mid-run rejects instead of hanging on a stuck sendUpdate', async () => {
  const disconnectCalls = [];

  await assert.rejects(
    () => applyWorkshopTags({
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
      verify: async () => ({ matches: true, actual: [] }),
    }),
    /Steam CM session disconnected/,
  );

  assert.equal(disconnectCalls.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadWorkshopItem, DEFAULT_UPLOAD_TIMEOUT_MS } from '../lib/steamcmd.mjs';

test('uploadWorkshopItem passes steam config path and uses default timeout', async () => {
  const calls = [];
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));

  await uploadWorkshopItem({
    steamCmdPath: '/tmp/steamcmd.sh',
    steamUsername: 'steam-user',
    steamConfigPath: '/tmp/config.vdf',
    appId: '294100',
    stagePath,
    publishedFileId: '123456',
    changenote: '2.0.0-beta.3',
    description: 'Steam description',
    execFileAsync: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: 'steam ok', stderr: '' };
    },
    logger: { log() {}, debug() {} },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/tmp/steamcmd.sh');
  assert.deepEqual(calls[0].args, [
    '+@ShutdownOnFailedCommand', '1',
    '+@NoPromptForPassword', '1',
    '+login', 'steam-user',
    '+workshop_build_item', join(stagePath, 'workshop.vdf'),
    '+quit',
  ]);
  assert.equal(calls[0].options.timeout, DEFAULT_UPLOAD_TIMEOUT_MS);
  assert.equal(calls[0].options.env.STEAM_CONFIG_VDF, '/tmp/config.vdf');
});

test('uploadWorkshopItem sets HOME to steamHome so SteamCMD finds the decoded config\'s .steam symlinks', async () => {
  const calls = [];
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));

  await uploadWorkshopItem({
    steamCmdPath: '/tmp/steamcmd.sh',
    steamUsername: 'steam-user',
    steamConfigPath: '/tmp/fake-home/.steam/config/config.vdf',
    steamHome: '/tmp/fake-home',
    appId: '294100',
    stagePath,
    publishedFileId: '123456',
    changenote: '2.0.0-beta.3',
    description: 'Steam description',
    execFileAsync: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: 'steam ok', stderr: '' };
    },
    logger: { log() {}, debug() {} },
  });

  assert.equal(calls[0].options.env.HOME, '/tmp/fake-home');
});

test('uploadWorkshopItem leaves HOME untouched when steamHome is not set', async () => {
  const calls = [];
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));

  await uploadWorkshopItem({
    steamCmdPath: '/tmp/steamcmd.sh',
    steamUsername: 'steam-user',
    steamConfigPath: '/tmp/config.vdf',
    appId: '294100',
    stagePath,
    publishedFileId: '123456',
    changenote: '2.0.0-beta.3',
    description: 'Steam description',
    execFileAsync: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: 'steam ok', stderr: '' };
    },
    logger: { log() {}, debug() {} },
  });

  assert.equal(calls[0].options.env.HOME, process.env.HOME);
});

test('uploadWorkshopItem honors custom timeoutMs', async () => {
  const calls = [];
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));

  await uploadWorkshopItem({
    steamCmdPath: '/tmp/steamcmd.sh',
    steamUsername: 'u',
    steamConfigPath: '/tmp/config.vdf',
    appId: '294100',
    stagePath,
    publishedFileId: '1',
    changenote: 'c',
    description: 'd',
    timeoutMs: 12345,
    execFileAsync: async (_c, _a, options) => { calls.push(options); return { stdout: '', stderr: '' }; },
    logger: { log() {} },
  });

  assert.equal(calls[0].timeout, 12345);
});

test('uploadWorkshopItem writes optional metadata into workshop.vdf', async () => {
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));

  await uploadWorkshopItem({
    steamCmdPath: '/tmp/steamcmd.sh',
    steamUsername: 'u',
    steamConfigPath: '/tmp/config.vdf',
    appId: '294100',
    stagePath,
    publishedFileId: '1',
    changenote: 'c',
    description: 'd',
    title: 'My Mod',
    previewfile: '/abs/path/preview.png',
    visibility: 0,
    tags: ['QoL', 'Mod'],
    execFileAsync: async () => ({ stdout: '', stderr: '' }),
    logger: { log() {} },
  });

  const vdf = readFileSync(join(stagePath, 'workshop.vdf'), 'utf8');
  assert.match(vdf, /"title" "My Mod"/);
  assert.match(vdf, /"previewfile" "\/abs\/path\/preview\.png"/);
  assert.match(vdf, /"visibility" "0"/);
  assert.match(vdf, /"tags"/);
  assert.match(vdf, /"0" "QoL"/);
  assert.match(vdf, /"1" "Mod"/);
});

test('uploadWorkshopItem verbose=true routes stdout to logger.log', async () => {
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));
  const logs = [];
  const debugs = [];

  await uploadWorkshopItem({
    steamCmdPath: '/tmp/steamcmd.sh',
    steamUsername: 'u',
    steamConfigPath: '/tmp/config.vdf',
    appId: '294100',
    stagePath,
    publishedFileId: '1',
    changenote: 'c',
    description: 'd',
    verbose: true,
    execFileAsync: async () => ({ stdout: 'noisy steam output', stderr: '' }),
    logger: { log: m => logs.push(m), debug: m => debugs.push(m) },
  });

  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[steamcmd:stdout\] noisy steam output/);
  assert.equal(debugs.length, 0);
});

test('uploadWorkshopItem verbose=false routes stdout to logger.debug', async () => {
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));
  const logs = [];
  const debugs = [];

  await uploadWorkshopItem({
    steamCmdPath: '/tmp/steamcmd.sh',
    steamUsername: 'u',
    steamConfigPath: '/tmp/config.vdf',
    appId: '294100',
    stagePath,
    publishedFileId: '1',
    changenote: 'c',
    description: 'd',
    execFileAsync: async () => ({ stdout: 'noisy steam output', stderr: '' }),
    logger: { log: m => logs.push(m), debug: m => debugs.push(m) },
  });

  assert.equal(debugs.length, 1);
  assert.match(debugs[0], /\[steamcmd:stdout\] noisy steam output/);
  assert.equal(logs.length, 0);
});

test('uploadWorkshopItem throws when appId is missing', async () => {
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));

  await assert.rejects(
    uploadWorkshopItem({
      steamCmdPath: '/tmp/steamcmd.sh',
      steamUsername: 'builder',
      steamConfigPath: '/tmp/config.vdf',
      stagePath,
      publishedFileId: '123456',
      changenote: '1.0.0',
      description: 'd',
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
    }),
    /appId is required/,
  );
});

test('uploadWorkshopItem includes stdout and stderr in timeout errors', async () => {
  const stagePath = mkdtempSync(join(tmpdir(), 'steamcmd-stage-'));

  await assert.rejects(
    uploadWorkshopItem({
      steamCmdPath: '/tmp/steamcmd.sh',
      steamUsername: 'builder',
      steamConfigPath: '/tmp/config.vdf',
      appId: '294100',
      stagePath,
      publishedFileId: '123456',
      changenote: '2.0.0-beta.3',
      description: 'Steam description',
      execFileAsync: async () => {
        const error = new Error('timed out');
        error.code = 'ETIMEDOUT';
        error.stdout = 'steam stdout';
        error.stderr = 'steam stderr';
        throw error;
      },
      logger: { log() {} },
    }),
    error => {
      assert.match(error.message, /SteamCMD upload timed out/);
      assert.match(error.message, /steam stdout/);
      assert.match(error.message, /steam stderr/);
      return true;
    },
  );
});

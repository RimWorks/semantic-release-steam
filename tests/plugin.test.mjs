import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../index.mjs';

test('publish skips unsupported branches', async () => {
  const result = await plugin.publish(
    {
      appId: '294100',
      branchTargets: { main: 'stable', beta: 'beta' },
      mods: [
        { name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' } },
      ],
    },
    {
      branch: { name: 'alpha' },
      env: {},
      nextRelease: { version: '2.0.0-alpha.1', notes: '' },
      logger: { log() {} },
    },
  );

  assert.equal(result, undefined);
});

test('publish compiles README in-memory and passes branch asset base URL to description builder', async () => {
  const descriptionCalls = [];
  const compileCalls = [];
  const uploadCalls = [];
  const writeCalls = [];

  const result = await plugin.publish(
    {
      appId: '294100',
      branchTargets: { beta: 'beta' },
      descriptionHeader: 'Header',
      descriptionFooter: 'Footer',
      assetBaseUrlTemplate: 'https://raw.githubusercontent.com/me/my-mod/{branch}',
      mods: [
        {
          name: 'MyMod',
          path: 'MyMod',
          workshopIds: { beta: '123' },
        },
      ],
    },
    {
      branch: { name: 'beta' },
      cwd: '/repo',
      env: {
        STEAM_USERNAME: 'steam-user',
        STEAM_CONFIG_VDF: '/tmp/config.vdf',
      },
      nextRelease: { version: '2.0.0-beta.1', notes: '' },
      logger: { log() {} },
      compileReadme: async options => {
        compileCalls.push(options);
        return 'compiled markdown';
      },
      writeCompiledReadme: async options => {
        writeCalls.push(options);
        return 'compiled markdown';
      },
      buildSteamDescription: async options => {
        descriptionCalls.push(options);
        return 'built description';
      },
      stageModContent: async () => '/tmp/stage',
      uploadWorkshopItem: async options => {
        uploadCalls.push(options);
      },
    },
  );

  assert.equal(result, undefined);
  assert.equal(compileCalls.length, 1);
  assert.equal(writeCalls.length, 0);
  assert.deepEqual(compileCalls[0], {
    modPath: '/repo/MyMod',
    header: 'Header',
    footer: 'Footer',
    assetDirNameTransform: undefined,
  });
  assert.deepEqual(descriptionCalls, [
    {
      modPath: '/repo/MyMod',
      markdown: 'compiled markdown',
      assetBaseUrl: 'https://raw.githubusercontent.com/me/my-mod/beta',
    },
  ]);
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].appId, '294100');
  assert.equal(uploadCalls[0].publishedFileId, '123');
});

test('publish writes README.md to disk when outputReadme=true', async () => {
  const compileCalls = [];
  const writeCalls = [];

  await plugin.publish(
    {
      appId: '294100',
      branchTargets: { main: 'stable' },
      outputReadme: true,
      mods: [{ name: 'X', path: 'X', workshopIds: { stable: '99' } }],
    },
    {
      branch: { name: 'main' },
      cwd: '/repo',
      env: { STEAM_USERNAME: 'u', STEAM_CONFIG_VDF: '/cv' },
      nextRelease: { version: '1.0.0', notes: '' },
      logger: { log() {} },
      compileReadme: async opts => { compileCalls.push(opts); return 'md'; },
      writeCompiledReadme: async opts => { writeCalls.push(opts); return 'md'; },
      buildSteamDescription: async () => 'd',
      stageModContent: async () => '/s',
      uploadWorkshopItem: async () => undefined,
    },
  );

  assert.equal(writeCalls.length, 1);
  assert.equal(compileCalls.length, 0);
});

test('publish forwards a custom assetDirNameTransform to compileReadme', async () => {
  const compileCalls = [];
  const transform = _modPath => ['custom', 'fallback'];

  await plugin.publish(
    {
      appId: '500',
      branchTargets: { main: 'stable' },
      assetDirNameTransform: transform,
      mods: [
        { name: 'X', path: 'X', workshopIds: { stable: '99' } },
      ],
    },
    {
      branch: { name: 'main' },
      cwd: '/repo',
      env: { STEAM_USERNAME: 'u', STEAM_CONFIG_VDF: '/cv' },
      nextRelease: { version: '1.0.0', notes: '' },
      logger: { log() {} },
      compileReadme: async options => { compileCalls.push(options); return 'md'; },
      buildSteamDescription: async () => 'd',
      stageModContent: async () => '/s',
      uploadWorkshopItem: async () => undefined,
    },
  );

  assert.equal(compileCalls[0].assetDirNameTransform, transform);
});

test('publish honors dry-run: no stage, no upload, logs intent', async () => {
  const stageCalls = [];
  const uploadCalls = [];
  const logs = [];

  await plugin.publish(
    {
      appId: '500',
      branchTargets: { main: 'stable' },
      mods: [
        {
          name: 'MyMod',
          path: 'MyMod',
          workshopIds: { stable: '999' },
          title: 'My Mod',
          tags: ['QoL', 'Mod'],
          visibility: 0,
        },
      ],
    },
    {
      branch: { name: 'main' },
      cwd: '/repo',
      env: { STEAM_USERNAME: 'u', STEAM_CONFIG_VDF: '/cv', STEAM_PASSWORD: 'secret' },
      nextRelease: { version: '1.0.0', notes: 'release notes' },
      options: { dryRun: true },
      logger: { log: msg => logs.push(msg) },
      compileReadme: async () => 'md',
      buildSteamDescription: async () => 'built',
      stageModContent: async opts => { stageCalls.push(opts); return '/s'; },
      uploadWorkshopItem: async opts => { uploadCalls.push(opts); },
    },
  );

  assert.equal(stageCalls.length, 0);
  assert.equal(uploadCalls.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[dry-run\] would publish MyMod to stable workshop item 999/);
  assert.match(logs[0], /title: "My Mod"/);
  assert.match(logs[0], /visibility: 0/);
  assert.match(logs[0], /tags: \[QoL, Mod\]/);
});

test('publish per-target metadata overrides per-mod defaults', async () => {
  const uploadCalls = [];

  await plugin.publish(
    {
      appId: '500',
      branchTargets: { beta: 'beta' },
      mods: [{
        name: 'MyMod',
        path: 'MyMod',
        workshopIds: { beta: '123' },
        title: 'My Mod',
        tags: ['QoL'],
        metadata: {
          beta: { title: '[BETA] My Mod', visibility: 1 },
        },
      }],
    },
    {
      branch: { name: 'beta' },
      cwd: '/repo',
      env: { STEAM_USERNAME: 'u', STEAM_CONFIG_VDF: '/cv', STEAM_PASSWORD: 'secret' },
      nextRelease: { version: '1.0.0-beta.1', notes: '' },
      logger: { log() {} },
      compileReadme: async () => 'md',
      buildSteamDescription: async () => 'd',
      stageModContent: async () => '/s',
      uploadWorkshopItem: async opts => { uploadCalls.push(opts); },
      applyWorkshopTags: async () => {},
    },
  );

  assert.equal(uploadCalls[0].title, '[BETA] My Mod');
  assert.equal(uploadCalls[0].visibility, 1);
  assert.deepEqual(uploadCalls[0].tags, ['QoL']);
});

test('publish threads uploadTimeoutMs and verbose through to uploader', async () => {
  const uploadCalls = [];

  await plugin.publish(
    {
      appId: '500',
      branchTargets: { main: 'stable' },
      uploadTimeoutMs: 999000,
      verbose: true,
      mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' } }],
    },
    {
      branch: { name: 'main' },
      cwd: '/repo',
      env: { STEAM_USERNAME: 'u', STEAM_CONFIG_VDF: '/cv' },
      nextRelease: { version: '1.0.0', notes: '' },
      logger: { log() {} },
      compileReadme: async () => 'md',
      buildSteamDescription: async () => 'd',
      stageModContent: async () => '/s',
      uploadWorkshopItem: async opts => { uploadCalls.push(opts); },
    },
  );

  assert.equal(uploadCalls[0].timeoutMs, 999000);
  assert.equal(uploadCalls[0].verbose, true);
});

test('publish calls applyWorkshopTags once after the upload loop, with every mods tags', async () => {
  const applyTagsCalls = [];

  await plugin.publish(
    {
      appId: '294100',
      branchTargets: { main: 'stable' },
      mods: [
        { name: 'ModOne', path: 'ModOne', workshopIds: { stable: '1' }, tags: ['QoL'] },
        { name: 'ModTwo', path: 'ModTwo', workshopIds: { stable: '2' } },
      ],
    },
    {
      branch: { name: 'main' },
      cwd: '/repo',
      env: { STEAM_USERNAME: 'u', STEAM_CONFIG_VDF: '/cv', STEAM_PASSWORD: 'secret' },
      nextRelease: { version: '1.0.0', notes: '' },
      logger: { log() {} },
      compileReadme: async () => 'md',
      buildSteamDescription: async () => 'd',
      stageModContent: async () => '/s',
      uploadWorkshopItem: async () => undefined,
      applyWorkshopTags: async opts => { applyTagsCalls.push(opts); },
    },
  );

  assert.equal(applyTagsCalls.length, 1);
  assert.equal(applyTagsCalls[0].appId, '294100');
  assert.equal(applyTagsCalls[0].steamUsername, 'u');
  assert.equal(applyTagsCalls[0].steamPassword, 'secret');
  assert.deepEqual(applyTagsCalls[0].mods, [
    { name: 'ModOne', publishedFileId: '1', tags: ['QoL'] },
    { name: 'ModTwo', publishedFileId: '2', tags: undefined },
  ]);
});

test('publish never calls applyWorkshopTags on dry run', async () => {
  const applyTagsCalls = [];
  const stageCalls = [];
  const uploadCalls = [];

  await plugin.publish(
    {
      appId: '294100',
      branchTargets: { main: 'stable' },
      mods: [{ name: 'M', path: 'M', workshopIds: { stable: '1' }, tags: ['QoL'] }],
    },
    {
      branch: { name: 'main' },
      cwd: '/repo',
      env: { STEAM_USERNAME: 'u', STEAM_CONFIG_VDF: '/cv', STEAM_PASSWORD: 'secret' },
      nextRelease: { version: '1.0.0', notes: '' },
      options: { dryRun: true },
      logger: { log() {} },
      compileReadme: async () => 'md',
      buildSteamDescription: async () => 'd',
      stageModContent: async opts => { stageCalls.push(opts); return '/s'; },
      uploadWorkshopItem: async opts => { uploadCalls.push(opts); },
      applyWorkshopTags: async opts => { applyTagsCalls.push(opts); },
    },
  );

  assert.equal(stageCalls.length, 0);
  assert.equal(uploadCalls.length, 0);
  assert.equal(applyTagsCalls.length, 0);
});

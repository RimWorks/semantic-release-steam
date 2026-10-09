import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySteamPublishConfig } from '../lib/config.mjs';

const baseEnv = () => ({
  STEAM_USERNAME: 'builder',
  STEAM_CONFIG_VDF: '/tmp/config.vdf',
});

test('throws when no mod has a workshop id for the resolved target', async () => {
  await assert.rejects(
    () => verifySteamPublishConfig({
      env: baseEnv(),
      branchName: 'beta',
      branchTargets: { main: 'stable', beta: 'beta' },
      mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' } }],
      appId: '294100',
    }),
    /No mods are publishable for target "beta"/,
  );
});

test('returns no target for unsupported branch', async () => {
  const result = await verifySteamPublishConfig({
    env: baseEnv(),
    branchName: 'alpha',
    branchTargets: { main: 'stable', beta: 'beta' },
    mods: [],
    appId: '294100',
  });

  assert.deepEqual(result, { shouldPublish: false, target: null, mods: [], steamConfigPath: null });
});

test('throws when appId is missing', async () => {
  await assert.rejects(
    () => verifySteamPublishConfig({
      env: baseEnv(),
      branchName: 'main',
      branchTargets: { main: 'stable' },
      mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' } }],
    }),
    /appId is required/,
  );
});

test('throws when STEAM_USERNAME is missing', async () => {
  await assert.rejects(
    () => verifySteamPublishConfig({
      env: { STEAM_CONFIG_VDF: '/tmp/config.vdf' },
      branchName: 'main',
      branchTargets: { main: 'stable' },
      mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' } }],
      appId: '294100',
    }),
    /STEAM_USERNAME is required/,
  );
});

test('throws with both env var names when neither STEAM_CONFIG_VDF nor _B64 is set', async () => {
  await assert.rejects(
    () => verifySteamPublishConfig({
      env: { STEAM_USERNAME: 'builder' },
      branchName: 'main',
      branchTargets: { main: 'stable' },
      mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' } }],
      appId: '294100',
    }),
    /STEAM_CONFIG_VDF.*STEAM_CONFIG_VDF_B64/s,
  );
});

test('throws when a mod has empty workshopIds', async () => {
  await assert.rejects(
    () => verifySteamPublishConfig({
      env: baseEnv(),
      branchName: 'main',
      branchTargets: { main: 'stable', beta: 'beta' },
      mods: [
        { name: 'ModOne', path: 'ModOne', workshopIds: { stable: '1' } },
        { name: 'ModTwo', path: 'ModTwo', workshopIds: {} },
      ],
      appId: '294100',
    }),
    /Mod "ModTwo" has no workshopIds set/,
  );
});

test('throws with did-you-mean when the target key looks misspelled', async () => {
  await assert.rejects(
    () => verifySteamPublishConfig({
      env: baseEnv(),
      branchName: 'main',
      branchTargets: { main: 'stable' },
      mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stabel: '1' } }],
      appId: '294100',
    }),
    /Did you mean "stabel"/,
  );
});

test('returns publishable mods when all configured correctly', async () => {
  const result = await verifySteamPublishConfig({
    env: baseEnv(),
    branchName: 'main',
    branchTargets: { main: 'stable', beta: 'beta' },
    mods: [
      { name: 'ModOne', path: 'ModOne', workshopIds: { stable: '1' } },
      { name: 'ModTwo', path: 'ModTwo', workshopIds: { stable: '2', beta: '3' } },
    ],
    appId: '294100',
  });

  assert.equal(result.shouldPublish, true);
  assert.equal(result.target, 'stable');
  assert.equal(result.mods.length, 2);
  assert.equal(result.steamConfigPath, '/tmp/config.vdf');
});

test('skips mod missing target key when other mods have it (and no close match)', async () => {
  const result = await verifySteamPublishConfig({
    env: baseEnv(),
    branchName: 'main',
    branchTargets: { main: 'stable', beta: 'beta' },
    mods: [
      { name: 'ModOne', path: 'ModOne', workshopIds: { stable: '1' } },
      { name: 'ModTwo', path: 'ModTwo', workshopIds: { beta: '2' } },
    ],
    appId: '294100',
  });

  assert.equal(result.shouldPublish, true);
  assert.equal(result.mods.length, 1);
  assert.equal(result.mods[0].name, 'ModOne');
});

test('resolves STEAM_CONFIG_VDF_B64 to a real file path, not the resolver object', async () => {
  const result = await verifySteamPublishConfig({
    env: {
      STEAM_USERNAME: 'builder',
      STEAM_CONFIG_VDF_B64: Buffer.from('"InstallConfigStore" {}').toString('base64'),
    },
    branchName: 'main',
    branchTargets: { main: 'stable' },
    mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' } }],
    appId: '294100',
  });

  assert.equal(typeof result.steamConfigPath, 'string');
  assert.match(result.steamConfigPath, /config\.vdf$/);
});

test('throws when a publishable mod has tags and no STEAM_PASSWORD or STEAM_REFRESH_TOKEN', async () => {
  await assert.rejects(
    () => verifySteamPublishConfig({
      env: baseEnv(),
      branchName: 'main',
      branchTargets: { main: 'stable' },
      mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' }, tags: ['QoL'] }],
      appId: '294100',
    }),
    /STEAM_PASSWORD or STEAM_REFRESH_TOKEN is required/,
  );
});

test('passes when STEAM_PASSWORD is set alongside tags', async () => {
  const result = await verifySteamPublishConfig({
    env: { ...baseEnv(), STEAM_PASSWORD: 'secret' },
    branchName: 'main',
    branchTargets: { main: 'stable' },
    mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' }, tags: ['QoL'] }],
    appId: '294100',
  });

  assert.equal(result.shouldPublish, true);
});

test('passes when STEAM_REFRESH_TOKEN is set alongside tags', async () => {
  const result = await verifySteamPublishConfig({
    env: { ...baseEnv(), STEAM_REFRESH_TOKEN: 'rt' },
    branchName: 'main',
    branchTargets: { main: 'stable' },
    mods: [{ name: 'MyMod', path: 'MyMod', workshopIds: { stable: '1' }, tags: ['QoL'] }],
    appId: '294100',
  });

  assert.equal(result.shouldPublish, true);
});

test('does not require a tags credential when the tagged mod is not publishable for this target', async () => {
  const result = await verifySteamPublishConfig({
    env: baseEnv(),
    branchName: 'main',
    branchTargets: { main: 'stable', beta: 'beta' },
    mods: [
      { name: 'Publishable', path: 'Publishable', workshopIds: { stable: '1' } },
      { name: 'TaggedButOtherTarget', path: 'X', workshopIds: { beta: '2' }, tags: ['QoL'] },
    ],
    appId: '294100',
  });

  assert.equal(result.shouldPublish, true);
  assert.equal(result.mods.length, 1);
});

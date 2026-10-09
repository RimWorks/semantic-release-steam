import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../bin/apply-tags.mjs';

test('throws a usage error when --config or --target is missing', async () => {
  await assert.rejects(
    () => run({ argv: ['--config', '/tmp/x.json'], env: {} }),
    /usage: semantic-release-steam-apply-tags/,
  );
});

test('throws when the branch has no configured target', async () => {
  await assert.rejects(
    () => run({
      argv: ['--config', '/tmp/x.json', '--target', 'alpha'],
      env: {},
      readConfig: async () => JSON.stringify({
        appId: '294100',
        branchTargets: { main: 'stable' },
        mods: [{ name: 'M', path: 'M', workshopIds: { stable: '1' } }],
      }),
    }),
    /Branch "alpha" has no configured target/,
  );
});

test('resolves mods for the target branch and calls applyWorkshopTags with per-target tag overrides', async () => {
  const applyCalls = [];

  await run({
    argv: ['--config', '/tmp/x.json', '--target', 'main'],
    env: { STEAM_USERNAME: 'u', STEAM_CONFIG_VDF: '/cv', STEAM_PASSWORD: 'secret' },
    readConfig: async () => JSON.stringify({
      appId: '294100',
      branchTargets: { main: 'stable' },
      mods: [{
        name: 'M',
        path: 'M',
        workshopIds: { stable: '1' },
        tags: ['QoL'],
        metadata: { stable: { tags: ['QoL', 'Overridden'] } },
      }],
    }),
    applyTags: async opts => { applyCalls.push(opts); },
  });

  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].appId, '294100');
  assert.equal(applyCalls[0].steamUsername, 'u');
  assert.equal(applyCalls[0].steamPassword, 'secret');
  assert.deepEqual(applyCalls[0].mods, [{ name: 'M', publishedFileId: '1', tags: ['QoL', 'Overridden'] }]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../bin/apply-tags.mjs';

test('throws a usage error when --config or --target is missing', async () => {
  await assert.rejects(
    () => run({ argv: ['--config', '/tmp/x.json'], env: {} }),
    /usage: semantic-release-steam-apply-tags/,
  );
});

test('throws a shape error naming the found keys when the config file has no branchTargets or mods', async () => {
  await assert.rejects(
    () => run({
      argv: ['--config', '/tmp/x.json', '--target', 'main'],
      env: {},
      readConfig: async () => JSON.stringify({ appId: '294100' }),
    }),
    error => {
      assert.match(error.message, /"branchTargets" \(an object\) and "mods" \(an array\)/);
      assert.match(error.message, /\[appId\]/);
      return true;
    },
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

test('running through a symlink (as npm bin links always are) still runs the CLI entry point', async () => {
  const realBin = fileURLToPath(new URL('../bin/apply-tags.mjs', import.meta.url));
  const dir = await mkdtemp(path.join(tmpdir(), 'apply-tags-symlink-'));
  const linkPath = path.join(dir, 'apply-tags-link.mjs');
  await symlink(realBin, linkPath);

  try {
    const result = await new Promise(resolve => {
      execFile('node', [linkPath], (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stderr });
      });
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /usage: semantic-release-steam-apply-tags/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

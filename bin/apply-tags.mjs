#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifySteamPublishConfig } from '../lib/config.mjs';
import { applyWorkshopTags } from '../lib/workshop-tags.mjs';

function parseArgs(argv) {
  const args = { config: null, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config') args.config = argv[i + 1];
    if (argv[i] === '--target') args.target = argv[i + 1];
  }
  return args;
}

function resolveTags(mod, target) {
  return mod.metadata?.[target]?.tags ?? mod.tags;
}

export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  logger = console,
  readConfig = path => readFile(path, 'utf8'),
  verifyConfig = verifySteamPublishConfig,
  applyTags = applyWorkshopTags,
} = {}) {
  const { config: configPath, target: branchName } = parseArgs(argv);
  if (!configPath || !branchName) {
    throw new Error('usage: semantic-release-steam-apply-tags --config <file> --target <branch>');
  }

  const pluginConfig = JSON.parse(await readConfig(configPath));

  const hasBranchTargets = pluginConfig.branchTargets && typeof pluginConfig.branchTargets === 'object'
    && !Array.isArray(pluginConfig.branchTargets);
  const hasMods = Array.isArray(pluginConfig.mods);
  if (!hasBranchTargets || !hasMods) {
    throw new Error(
      `Config file "${configPath}" must contain "branchTargets" (an object) and "mods" (an array) - ` +
        'the same options you pass to the semantic-release-steam plugin, not the full release.config.mjs. ' +
        `Found top-level keys: [${Object.keys(pluginConfig).join(', ')}].`,
    );
  }

  const state = await verifyConfig({
    env,
    branchName,
    branchTargets: pluginConfig.branchTargets,
    mods: pluginConfig.mods,
    appId: pluginConfig.appId,
  });

  if (!state.shouldPublish) {
    throw new Error(`Branch "${branchName}" has no configured target in branchTargets.`);
  }

  const mods = state.mods.map(mod => ({
    name: mod.name,
    publishedFileId: mod.workshopIds[state.target],
    tags: resolveTags(mod, state.target),
  }));

  await applyTags({
    steamUsername: env.STEAM_USERNAME,
    steamPassword: env.STEAM_PASSWORD,
    steamRefreshToken: env.STEAM_REFRESH_TOKEN,
    appId: pluginConfig.appId,
    mods,
    logger,
  });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

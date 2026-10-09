import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function resolveBranchTarget(branchName, branchTargets) {
  return branchTargets[branchName] ?? null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function suggestKey(target, available) {
  if (!available.length) return null;
  const ranked = available
    .map(key => ({ key, distance: levenshtein(target, key) }))
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (best.distance <= Math.max(2, Math.floor(target.length / 3))) {
    return best.key;
  }
  return null;
}

/**
 * Resolves the path to the SteamCMD config.vdf based on env.
 * Accepts either STEAM_CONFIG_VDF (a path) or STEAM_CONFIG_VDF_B64 (base64-encoded contents
 * that get decoded to a temp file). Returns the resolved path.
 */
export async function resolveSteamConfigPath(env) {
  if (env.STEAM_CONFIG_VDF && env.STEAM_CONFIG_VDF.trim().length > 0) {
    return env.STEAM_CONFIG_VDF;
  }

  if (env.STEAM_CONFIG_VDF_B64 && env.STEAM_CONFIG_VDF_B64.trim().length > 0) {
    const buffer = Buffer.from(env.STEAM_CONFIG_VDF_B64, 'base64');
    const home = join(tmpdir(), `semantic-release-steam-${randomBytes(6).toString('hex')}`);
    const steamDir = join(home, '.steam');
    const dir = join(steamDir, 'config');
    await mkdir(dir, { recursive: true });
    await symlink(steamDir, join(steamDir, 'root'));
    await symlink(steamDir, join(steamDir, 'steam'));
    const path = join(dir, 'config.vdf');
    await writeFile(path, buffer);
    return { path, home };
  }

  return null;
}

export async function verifySteamPublishConfig({
  env,
  branchName,
  branchTargets,
  mods,
  appId,
}) {
  const target = resolveBranchTarget(branchName, branchTargets);
  if (!target) {
    return { shouldPublish: false, target: null, mods: [], steamConfigPath: null };
  }

  if (!appId) {
    throw new Error('appId is required for Steam publishing (pass it in pluginConfig)');
  }

  if (!env.STEAM_USERNAME) {
    throw new Error(
      'STEAM_USERNAME is required for Steam publishing (set the env var to your Steam account username)',
    );
  }

  const resolvedConfig = await resolveSteamConfigPath(env);
  if (!resolvedConfig) {
    throw new Error(
      'Steam config.vdf path is required for Steam publishing. ' +
        'Set STEAM_CONFIG_VDF=/path/to/config.vdf, or STEAM_CONFIG_VDF_B64=<base64 of config.vdf contents>.',
    );
  }
  const steamConfig = typeof resolvedConfig === 'string'
    ? { path: resolvedConfig, home: null }
    : resolvedConfig;

  if (!Array.isArray(mods) || mods.length === 0) {
    throw new Error('mods is required and must contain at least one entry');
  }

  const publishable = [];
  const skipped = [];

  for (const mod of mods) {
    const ids = mod.workshopIds ?? {};
    const keys = Object.keys(ids);

    if (keys.length === 0) {
      throw new Error(
        `Mod "${mod.name}" has no workshopIds set. Each mod must declare at least one workshop ID per branch target.`,
      );
    }

    if (ids[target]) {
      publishable.push(mod);
      continue;
    }

    const suggestion = suggestKey(target, keys);
    if (suggestion) {
      throw new Error(
        `Mod "${mod.name}" is missing a workshop ID for target "${target}". ` +
          `Did you mean "${suggestion}"? Found keys: [${keys.join(', ')}].`,
      );
    }

    skipped.push({ name: mod.name, keys });
  }

  if (publishable.length === 0) {
    const detail = skipped
      .map(s => `${s.name} (has: [${s.keys.join(', ')}])`)
      .join('; ');
    throw new Error(
      `No mods are publishable for target "${target}". ` +
        `Add a workshopIds["${target}"] entry to at least one mod. Mods checked: ${detail}.`,
    );
  }

  const needsTagCredentials = publishable.some(
    mod => (mod.metadata?.[target]?.tags ?? mod.tags)?.length > 0,
  );
  if (needsTagCredentials && !env.STEAM_PASSWORD && !env.STEAM_REFRESH_TOKEN) {
    throw new Error(
      'STEAM_PASSWORD or STEAM_REFRESH_TOKEN is required when a mod configures tags. ' +
        'Set one of them, or remove tags to skip the Workshop tags step.',
    );
  }

  return {
    shouldPublish: true,
    target,
    mods: publishable,
    steamConfigPath: steamConfig.path,
    steamHome: steamConfig.home,
  };
}

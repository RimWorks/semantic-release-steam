import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { KNOWN_LANGUAGE_CODES, languageInt, localizedValue } from './languages.mjs';

const LOCALIZABLE_CODES = KNOWN_LANGUAGE_CODES.filter(code => code !== 'english');

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

function assertLocalizedOption(value, label) {
  if (value === undefined || value === null || typeof value === 'string') return;

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `${label} must be a string, or a map of Steam language code to string. Got ${typeof value}.`,
    );
  }

  for (const key of Object.keys(value)) {
    if (key === 'default') continue;

    if (key === 'english') {
      throw new Error(
        `${label} has an "english" key. The English slot reads "default", so rename it to "default".`,
      );
    }

    if (!LOCALIZABLE_CODES.includes(key)) {
      const suggestion = suggestKey(key, ['default', ...LOCALIZABLE_CODES]);
      throw new Error(
        `${label} has an unknown Steam language code "${key}". ` +
          (suggestion
            ? `Did you mean "${suggestion}"?`
            : `Known codes: [default, ${LOCALIZABLE_CODES.join(', ')}].`),
      );
    }
  }

  if (typeof value.default !== 'string' || value.default.length === 0) {
    throw new Error(
      `${label} is a map with no "default" entry. Every language that has no entry of its own ` +
        'falls back to "default", and it is what the English slot gets, so it is required.',
    );
  }
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
  descriptionHeader,
  descriptionFooter,
  resolveLanguage = languageInt,
}) {
  const target = resolveBranchTarget(branchName, branchTargets);
  if (!target) {
    return { shouldPublish: false, target: null, mods: [], steamConfigPath: null };
  }

  if (!appId) {
    throw new Error('appId is required for Steam publishing (pass it in pluginConfig)');
  }

  assertLocalizedOption(descriptionHeader, 'descriptionHeader');
  assertLocalizedOption(descriptionFooter, 'descriptionFooter');

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

    if (keys.includes(target)) {
      throw new Error(
        `Mod "${mod.name}" has a workshopIds entry for target "${target}", but its value is empty. ` +
          `Set it to the workshop item's numeric ID.`,
      );
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

  for (const mod of publishable) {
    const title = mod.metadata?.[target]?.title ?? mod.title;
    assertLocalizedOption(title, `Mod "${mod.name}" title`);

    const localized = mod.localizedTemplates;
    if (!(localized?.length > 0)) continue;

    if (!localizedValue(title, 'default')) {
      throw new Error(
        `Mod "${mod.name}" has localized descriptions but no title. ` +
          'Set title (on the mod, or in metadata for this target): a localized update with no ' +
          'title blanks that language\'s title on Steam instead of inheriting the English one.',
      );
    }

    for (const { code, filename } of localized) {
      try {
        resolveLanguage(code);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Mod "${mod.name}" has a localized template "${filename}" with an unusable language ` +
            `code "${code}": ${message}`,
          { cause: error },
        );
      }
    }
  }

  const needsCmCredentials = publishable.some(
    mod => (mod.metadata?.[target]?.tags ?? mod.tags)?.length > 0
      || mod.localizedTemplates?.length > 0,
  );
  if (needsCmCredentials && !env.STEAM_PASSWORD && !env.STEAM_REFRESH_TOKEN) {
    throw new Error(
      'STEAM_PASSWORD or STEAM_REFRESH_TOKEN is required when a mod configures tags or ' +
        'localized descriptions. Set one of them, or remove the tags and the localized README ' +
        'templates to skip the Steam CM steps.',
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

import { resolve } from 'node:path';
import { deriveWorkshopMetadata } from './lib/about.mjs';
import { verifySteamPublishConfig } from './lib/config.mjs';
import { assertDescriptionFits, buildSteamDescription } from './lib/description.mjs';
import { languageInt, localizedValue } from './lib/languages.mjs';
import { compileReadme, discoverLocalizedTemplates, writeCompiledReadme } from './lib/readme.mjs';
import { stageModContent } from './lib/stage-content.mjs';
import { uploadWorkshopItem } from './lib/steamcmd.mjs';
import { applyWorkshopUpdates } from './lib/workshop-tags.mjs';

function isDryRun(context) {
  return Boolean(context?.options?.dryRun);
}

function resolveModMetadata(mod, target) {
  const override = mod.metadata?.[target] ?? {};
  return {
    title: override.title ?? mod.title,
    previewfile: override.previewfile ?? mod.previewfile,
    visibility: override.visibility ?? mod.visibility,
    tags: override.tags ?? mod.tags,
  };
}

async function withDerivedDefaults(mods = [], cwd, derive, discover) {
  return Promise.all(
    mods.map(async mod => {
      const modPath = resolve(cwd, mod.path);
      const derived = await derive(modPath);
      return {
        ...mod,
        previewfile: mod.previewfile ?? derived.previewfile,
        tags: mod.tags ?? derived.tags,
        localizedTemplates: await discover({ modPath }),
      };
    }),
  );
}

// the context overrides are the seam the tests inject through; real runs get the imports.
function resolveOverrides(context) {
  return {
    buildDescription: context.buildSteamDescription ?? buildSteamDescription,
    stageContent: context.stageModContent ?? stageModContent,
    uploadItem: context.uploadWorkshopItem ?? uploadWorkshopItem,
    compile: context.compileReadme ?? compileReadme,
    writeCompiled: context.writeCompiledReadme ?? writeCompiledReadme,
    applyUpdates: context.applyWorkshopUpdates ?? applyWorkshopUpdates,
    deriveMetadata: context.deriveWorkshopMetadata ?? deriveWorkshopMetadata,
    discoverTemplates: context.discoverLocalizedTemplates ?? discoverLocalizedTemplates,
  };
}

function compileModReadme(pluginConfig, modPath, overrides, templateFilename, code = 'default') {
  const compileArgs = {
    modPath,
    header: localizedValue(pluginConfig.descriptionHeader, code) ?? '',
    footer: localizedValue(pluginConfig.descriptionFooter, code) ?? '',
    assetDirNameTransform: pluginConfig.assetDirNameTransform,
    templateFilename,
  };

  return pluginConfig.outputReadme ? overrides.writeCompiled(compileArgs) : overrides.compile(compileArgs);
}

function describeDryRun({ mod, target, publishedFileId, version, description, metadata }) {
  const details = [
    `changenote: ${version}`,
    `description: ${description.length} chars`,
    metadata.title ? `title: "${metadata.title}"` : null,
    metadata.visibility !== undefined ? `visibility: ${metadata.visibility}` : null,
    metadata.tags?.length ? `tags: [${metadata.tags.join(', ')}]` : null,
  ].filter(Boolean);

  return `[dry-run] would publish ${mod.name} to ${target} workshop item ${publishedFileId} (${details.join(', ')})`;
}

function describeDryRunLanguage(mod, entry) {
  return `[dry-run] would set ${mod.name} ${entry.code} (ELanguage ${entry.language}) ` +
    `title: "${entry.title}", description: ${entry.description.length} chars`;
}

export async function verifyConditions(pluginConfig, context) {
  const overrides = resolveOverrides(context);

  await verifySteamPublishConfig({
    env: context.env,
    branchName: context.branch.name,
    branchTargets: pluginConfig.branchTargets,
    mods: await withDerivedDefaults(
      pluginConfig.mods,
      context.cwd ?? process.cwd(),
      overrides.deriveMetadata,
      overrides.discoverTemplates,
    ),
    appId: pluginConfig.appId,
    descriptionHeader: pluginConfig.descriptionHeader,
    descriptionFooter: pluginConfig.descriptionFooter,
  });
}

export async function publish(pluginConfig, context) {
  const cwd = context.cwd ?? process.cwd();
  const overrides = resolveOverrides(context);

  const state = await verifySteamPublishConfig({
    env: context.env,
    branchName: context.branch.name,
    branchTargets: pluginConfig.branchTargets,
    mods: await withDerivedDefaults(
      pluginConfig.mods,
      cwd,
      overrides.deriveMetadata,
      overrides.discoverTemplates,
    ),
    appId: pluginConfig.appId,
    descriptionHeader: pluginConfig.descriptionHeader,
    descriptionFooter: pluginConfig.descriptionFooter,
  });

  if (!state.shouldPublish) {
    return undefined;
  }

  const dryRun = isDryRun(context);
  const assetBaseUrl = pluginConfig.assetBaseUrlTemplate
    ? pluginConfig.assetBaseUrlTemplate.replace('{branch}', context.branch.name)
    : '';

  const taggableMods = [];

  for (const mod of state.mods) {
    const modPath = resolve(cwd, mod.path);
    const markdown = await compileModReadme(pluginConfig, modPath, overrides);

    const description = await overrides.buildDescription({
      modPath,
      markdown,
      assetBaseUrl,
    });
    assertDescriptionFits(description, `Mod "${mod.name}" english`);

    const metadata = resolveModMetadata(mod, state.target);
    const titleOption = metadata.title;
    metadata.title = localizedValue(titleOption, 'default');
    const publishedFileId = mod.workshopIds[state.target];
    const changenote = context.nextRelease.notes || context.nextRelease.version;

    const localized = [];
    for (const { code, filename } of mod.localizedTemplates ?? []) {
      const localizedMarkdown = await compileModReadme(
        pluginConfig,
        modPath,
        overrides,
        filename,
        code,
      );
      const localizedDescription = await overrides.buildDescription({
        modPath,
        markdown: localizedMarkdown,
        assetBaseUrl,
      });
      assertDescriptionFits(localizedDescription, `Mod "${mod.name}" ${code}`);

      localized.push({
        code,
        language: languageInt(code),
        title: localizedValue(titleOption, code),
        description: localizedDescription,
      });
    }

    if (dryRun) {
      context.logger.log(
        describeDryRun({
          mod,
          target: state.target,
          publishedFileId,
          version: context.nextRelease.version,
          description,
          metadata,
        }),
      );
      for (const entry of localized) {
        context.logger.log(describeDryRunLanguage(mod, entry));
      }
      continue;
    }

    const stagePath = await overrides.stageContent({ modPath });

    await overrides.uploadItem({
      steamCmdPath: context.env.STEAMCMD_PATH ?? '~/steamcmd/steamcmd.sh',
      steamUsername: context.env.STEAM_USERNAME,
      steamConfigPath: state.steamConfigPath,
      steamHome: state.steamHome,
      appId: pluginConfig.appId,
      stagePath,
      publishedFileId,
      changenote,
      description,
      title: metadata.title,
      previewfile: metadata.previewfile,
      visibility: metadata.visibility,
      tags: metadata.tags,
      timeoutMs: pluginConfig.uploadTimeoutMs,
      verbose: pluginConfig.verbose,
      logger: context.logger,
    });

    context.logger.log(`Published ${mod.name} to ${state.target} workshop item ${publishedFileId}`);
    taggableMods.push({
      name: mod.name,
      publishedFileId,
      tags: metadata.tags,
      ...(localized.length > 0 ? { localized } : {}),
    });
  }

  if (!dryRun) {
    await overrides.applyUpdates({
      steamUsername: context.env.STEAM_USERNAME,
      steamPassword: context.env.STEAM_PASSWORD,
      steamRefreshToken: context.env.STEAM_REFRESH_TOKEN,
      appId: pluginConfig.appId,
      mods: taggableMods,
      logger: context.logger,
      guardTimeoutMs: pluginConfig.guardTimeoutSeconds === undefined
        ? undefined
        : pluginConfig.guardTimeoutSeconds * 1000,
      guardRetries: pluginConfig.guardRetries,
    });
  }

  return undefined;
}

export default { verifyConditions, publish };

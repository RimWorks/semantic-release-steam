import { resolve } from 'node:path';
import { verifySteamPublishConfig } from './lib/config.mjs';
import { buildSteamDescription } from './lib/description.mjs';
import { compileReadme, writeCompiledReadme } from './lib/readme.mjs';
import { stageModContent } from './lib/stage-content.mjs';
import { uploadWorkshopItem } from './lib/steamcmd.mjs';

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

// the context overrides are the seam the tests inject through; real runs get the imports.
function resolveOverrides(context) {
  return {
    buildDescription: context.buildSteamDescription ?? buildSteamDescription,
    stageContent: context.stageModContent ?? stageModContent,
    uploadItem: context.uploadWorkshopItem ?? uploadWorkshopItem,
    compile: context.compileReadme ?? compileReadme,
    writeCompiled: context.writeCompiledReadme ?? writeCompiledReadme,
  };
}

function compileModReadme(pluginConfig, modPath, overrides) {
  const compileArgs = {
    modPath,
    header: pluginConfig.descriptionHeader ?? '',
    footer: pluginConfig.descriptionFooter ?? '',
    assetDirNameTransform: pluginConfig.assetDirNameTransform,
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

export async function verifyConditions(pluginConfig, context) {
  await verifySteamPublishConfig({
    env: context.env,
    branchName: context.branch.name,
    branchTargets: pluginConfig.branchTargets,
    mods: pluginConfig.mods,
    appId: pluginConfig.appId,
  });
}

export async function publish(pluginConfig, context) {
  const state = await verifySteamPublishConfig({
    env: context.env,
    branchName: context.branch.name,
    branchTargets: pluginConfig.branchTargets,
    mods: pluginConfig.mods,
    appId: pluginConfig.appId,
  });

  if (!state.shouldPublish) {
    return undefined;
  }

  const cwd = context.cwd ?? process.cwd();
  const dryRun = isDryRun(context);
  const overrides = resolveOverrides(context);
  const assetBaseUrl = pluginConfig.assetBaseUrlTemplate
    ? pluginConfig.assetBaseUrlTemplate.replace('{branch}', context.branch.name)
    : '';

  for (const mod of state.mods) {
    const modPath = resolve(cwd, mod.path);
    const markdown = await compileModReadme(pluginConfig, modPath, overrides);

    const description = await overrides.buildDescription({
      modPath,
      markdown,
      assetBaseUrl,
    });

    const metadata = resolveModMetadata(mod, state.target);
    const publishedFileId = mod.workshopIds[state.target];
    const changenote = context.nextRelease.notes || context.nextRelease.version;

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
      continue;
    }

    const stagePath = await overrides.stageContent({ modPath });

    await overrides.uploadItem({
      steamCmdPath: context.env.STEAMCMD_PATH ?? '~/steamcmd/steamcmd.sh',
      steamUsername: context.env.STEAM_USERNAME,
      steamConfigPath: state.steamConfigPath,
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
  }

  return undefined;
}

export default { verifyConditions, publish };

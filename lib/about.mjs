import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const SUPPORTED_VERSIONS = /<supportedVersions>([\s\S]*?)<\/supportedVersions>/i;
const LIST_ITEM = /<li>\s*([^<]+?)\s*<\/li>/gi;

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readSupportedVersions(modPath) {
  const aboutPath = join(modPath, 'About', 'About.xml');

  if (!(await exists(aboutPath))) return [];

  const block = SUPPORTED_VERSIONS.exec(await readFile(aboutPath, 'utf8'));
  if (!block) return [];

  return [...block[1].matchAll(LIST_ITEM)].map(match => match[1]);
}

/**
 * Reads what `About/About.xml` and `About/Preview.png` already state, so a config does not repeat it.
 * `tags` is every `<li>` under `<supportedVersions>` plus `Mod`. Either field is undefined when missing.
 */
export async function deriveWorkshopMetadata(modPath) {
  const versions = await readSupportedVersions(modPath);
  const previewPath = join(modPath, 'About', 'Preview.png');

  return {
    tags: versions.length > 0 ? [...versions, 'Mod'] : undefined,
    previewfile: (await exists(previewPath)) ? previewPath : undefined,
  };
}

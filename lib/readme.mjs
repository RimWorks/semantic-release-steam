import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const defaultAssetDirNameTransform = modPath => [
  basename(modPath).toLowerCase(),
  'fallback',
];

const GLOB_CHARS = /[*?[]/;

function isGlobPattern(value) {
  return typeof value === 'string' && GLOB_CHARS.test(value);
}

async function listAssetSubdirs(assetsRoot) {
  try {
    const entries = await readdir(assetsRoot, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

function matchGlob(pattern, candidates) {
  const re = new RegExp(
    '^' +
      pattern
        .replaceAll(/[.+^${}()|\\]/g, String.raw`\$&`)
        .replaceAll('**', '[__DOUBLESTAR__]')
        .replaceAll('*', '[^/]*')
        .replaceAll('?', '[^/]')
        .replaceAll('[__DOUBLESTAR__]', '.*') +
      '$',
  );
  return candidates.filter(c => re.test(c));
}

async function resolveAssetDirs(transform, modPath, repoRoot) {
  if (typeof transform === 'function') {
    return transform(modPath);
  }

  if (!Array.isArray(transform)) {
    return defaultAssetDirNameTransform(modPath);
  }

  const assetsRoot = join(repoRoot, '.github', 'assets');
  const subdirs = transform.some(isGlobPattern) ? await listAssetSubdirs(assetsRoot) : [];
  const matched = transform.flatMap(entry =>
    isGlobPattern(entry) ? matchGlob(entry, subdirs) : [entry],
  );

  return [...new Set(matched)];
}

async function replaceFallbackAssets(markdown, modPath, assetDirNameTransform) {
  const repoRoot = resolve(modPath, '..');
  const assetDirs = await resolveAssetDirs(assetDirNameTransform, modPath, repoRoot);

  for (const assetDir of assetDirs) {
    const assetPath = join(repoRoot, '.github', 'assets', assetDir);

    try {
      const entries = await readdir(assetPath);
      let nextMarkdown = markdown;

      for (const entry of entries) {
        const fallbackNames = new Set([
          entry,
          entry.replaceAll('_', ' '),
          entry.replaceAll(' ', '_'),
        ]);

        for (const fallbackName of fallbackNames) {
          nextMarkdown = nextMarkdown.replaceAll(
            `../.github/assets/fallback/${fallbackName}`,
            `../.github/assets/${assetDir}/${entry}`,
          );
        }
      }

      markdown = nextMarkdown;
    } catch {
      continue;
    }
  }

  return markdown;
}

const zeroWidthSpace = '​';
const stripBom = /^﻿/;
const separator = `\n${zeroWidthSpace}\n\n`;

export async function compileReadme({ modPath, header, footer, assetDirNameTransform }) {
  const template = (await readFile(join(modPath, 'README.template.md'), 'utf8')).replace(stripBom, '');
  const markdown = `${header}${separator}${template}${separator}${footer}`;
  return await replaceFallbackAssets(markdown, modPath, assetDirNameTransform);
}

export async function writeCompiledReadme({ modPath, header, footer, assetDirNameTransform }) {
  const markdown = await compileReadme({ modPath, header, footer, assetDirNameTransform });
  await mkdir(modPath, { recursive: true });
  await writeFile(join(modPath, 'README.md'), markdown);
  return markdown;
}

export function rewriteAssetLinksForSteam(markdown, assetBaseUrl) {
  if (!assetBaseUrl) {
    return markdown;
  }

  return markdown.replaceAll('../.github/assets/', `${assetBaseUrl}/.github/assets/`);
}

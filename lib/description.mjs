import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { parse, render } from '@steamdown/core';
import { rewriteAssetLinksForSteam } from './readme.mjs';

const FALLBACK_DESCRIPTION = 'No description available.';

function stripFenceInfoStrings(markdown) {
  return markdown.replace(/(?<=^[^\S\r\n]*`{3,})[^\r\n`]*$/gm, '');
}

export function renderSteamBBCode(markdown) {
  if (!markdown || markdown.trim().length === 0) {
    return FALLBACK_DESCRIPTION;
  }

  const [tree, context] = parse(stripFenceInfoStrings(markdown));
  const rendered = render(tree, context);

  if (!rendered || rendered.trim().length === 0) {
    return FALLBACK_DESCRIPTION;
  }

  return rendered;
}

export async function buildSteamDescription({ modPath, assetBaseUrl = '', markdown }) {
  let source = markdown;

  if (source == null) {
    const readmePath = join(modPath, 'README.md');

    try {
      await access(readmePath, constants.F_OK);
    } catch {
      return FALLBACK_DESCRIPTION;
    }

    source = await readFile(readmePath, 'utf8');
  }

  const rewritten = rewriteAssetLinksForSteam(source, assetBaseUrl);
  return renderSteamBBCode(rewritten);
}

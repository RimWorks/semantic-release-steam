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

const DESCRIPTION_BYTE_LIMIT = 8000;

/**
 * Throws when a description is past Steam's 8000 byte description limit. Steam counts bytes, so
 * text that is 2 or 3 bytes per character hits the limit at a fraction of the character count.
 */
export function assertDescriptionFits(description, label) {
  const bytes = Buffer.byteLength(description);
  if (bytes <= DESCRIPTION_BYTE_LIMIT) return;

  throw new Error(
    `${label} description is ${bytes} bytes, past Steam's ${DESCRIPTION_BYTE_LIMIT} byte limit ` +
      `(${description.length} characters). Steam counts bytes, not characters, so Cyrillic costs 2 ` +
      'and CJK costs 3. Shorten the template, the descriptionHeader or the descriptionFooter for ' +
      'this language. Steam answers an oversized update with eresult 8 and no explanation.',
  );
}

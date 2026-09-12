function escapeVdfValue(value) {
  let open = true;
  return String(value ?? '').replaceAll('"', () => {
    const quote = open ? '“' : '”';
    open = !open;
    return quote;
  });
}

function appendOptional(lines, key, value) {
  if (value === undefined || value === null || value === '') return;
  lines.push(`  "${key}" "${escapeVdfValue(value)}"`);
}

function appendTags(lines, tags) {
  if (!tags || !Array.isArray(tags) || tags.length === 0) return;
  lines.push('  "tags"', '  {');
  for (let i = 0; i < tags.length; i++) {
    lines.push(`    "${i}" "${escapeVdfValue(tags[i])}"`);
  }
  lines.push('  }');
}

/**
 * Creates a workshop.vdf for `steamcmd +workshop_build_item`.
 *
 * Required: appId, publishedFileId, contentFolder.
 * Optional and only emitted when set: changenote, description, title, previewfile, visibility, tags.
 */
export function createWorkshopVdf({
  appId,
  publishedFileId,
  contentFolder,
  changenote,
  description,
  title,
  previewfile,
  visibility,
  tags,
}) {
  const lines = [
    '"workshopitem"',
    '{',
    `  "appid" "${escapeVdfValue(appId)}"`,
    `  "publishedfileid" "${escapeVdfValue(publishedFileId)}"`,
    `  "contentfolder" "${escapeVdfValue(contentFolder)}"`,
  ];

  appendOptional(lines, 'changenote', changenote);
  appendOptional(lines, 'description', description);
  appendOptional(lines, 'title', title);
  appendOptional(lines, 'previewfile', previewfile);
  if (visibility !== undefined && visibility !== null) {
    appendOptional(lines, 'visibility', String(visibility));
  }
  appendTags(lines, tags);

  lines.push('}', '');

  return lines.join('\n');
}

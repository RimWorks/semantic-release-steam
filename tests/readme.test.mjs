import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileReadme, discoverLocalizedTemplates, writeCompiledReadme } from '../lib/readme.mjs';

const zwsp = '​';

test('writeCompiledReadme composes header template and footer with zero-width-space separators using default transform', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-compile-'));
  const modPath = join(rootPath, 'MyMod');

  mkdirSync(join(rootPath, '.github', 'assets', 'mymod'), { recursive: true });
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.template.md'), '﻿![About](../.github/assets/mymod/about.png)\nBody\n');
  writeFileSync(join(rootPath, '.github', 'assets', 'mymod', 'intro.png'), '');
  writeFileSync(join(rootPath, '.github', 'assets', 'mymod', 'support_us.png'), '');

  await writeCompiledReadme({
    modPath,
    header: '![Introduction](../.github/assets/fallback/intro.png)',
    footer: '![Support](../.github/assets/fallback/support us.png)',
  });

  assert.equal(
    readFileSync(join(modPath, 'README.md'), 'utf8'),
    `![Introduction](../.github/assets/mymod/intro.png)\n${zwsp}\n\n![About](../.github/assets/mymod/about.png)\nBody\n\n${zwsp}\n\n![Support](../.github/assets/mymod/support_us.png)`,
  );
});

test('compileReadme returns markdown without writing to disk', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-compile-'));
  const modPath = join(rootPath, 'MyMod');

  mkdirSync(join(rootPath, '.github', 'assets', 'mymod'), { recursive: true });
  mkdirSync(modPath, { recursive: true });
  writeFileSync(join(modPath, 'README.template.md'), 'body\n');

  const result = await compileReadme({ modPath, header: 'H', footer: 'F' });

  assert.match(result, /^H/);
  assert.match(result, /F$/);
  assert.throws(() => readFileSync(join(modPath, 'README.md'), 'utf8'));
});

test('writeCompiledReadme honors a custom assetDirNameTransform function', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-compile-'));
  const modPath = join(rootPath, 'CosmereScadrial');

  mkdirSync(join(rootPath, '.github', 'assets', 'scadrial'), { recursive: true });
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.template.md'), 'Body\n');
  writeFileSync(join(rootPath, '.github', 'assets', 'scadrial', 'intro.png'), '');

  const transform = mp => [mp.split('/').pop().replace(/^Cosmere/, '').toLowerCase(), 'fallback'];

  await writeCompiledReadme({
    modPath,
    header: '![Intro](../.github/assets/fallback/intro.png)',
    footer: '',
    assetDirNameTransform: transform,
  });

  const compiled = readFileSync(join(modPath, 'README.md'), 'utf8');
  assert.match(compiled, /\.\.\/\.github\/assets\/scadrial\/intro\.png/);
});

test('assetDirNameTransform accepts an array of literal dir names', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-compile-'));
  const modPath = join(rootPath, 'AnyName');

  mkdirSync(join(rootPath, '.github', 'assets', 'specific'), { recursive: true });
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.template.md'), 'body\n');
  writeFileSync(join(rootPath, '.github', 'assets', 'specific', 'intro.png'), '');

  const compiled = await compileReadme({
    modPath,
    header: '![Intro](../.github/assets/fallback/intro.png)',
    footer: '',
    assetDirNameTransform: ['specific', 'fallback'],
  });

  assert.match(compiled, /\.\.\/\.github\/assets\/specific\/intro\.png/);
});

test('assetDirNameTransform array expands glob patterns against .github/assets', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-compile-'));
  const modPath = join(rootPath, 'AnyName');

  mkdirSync(join(rootPath, '.github', 'assets', 'mod-a'), { recursive: true });
  mkdirSync(join(rootPath, '.github', 'assets', 'mod-b'), { recursive: true });
  mkdirSync(join(rootPath, '.github', 'assets', 'shared'), { recursive: true });
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.template.md'), 'body\n');
  writeFileSync(join(rootPath, '.github', 'assets', 'mod-a', 'intro.png'), '');
  writeFileSync(join(rootPath, '.github', 'assets', 'mod-b', 'intro.png'), '');

  const compiled = await compileReadme({
    modPath,
    header: '![Intro](../.github/assets/fallback/intro.png)',
    footer: '',
    assetDirNameTransform: ['mod-*'],
  });

  assert.match(compiled, /\.\.\/\.github\/assets\/mod-(a|b)\/intro\.png/);
});

test('discoverLocalizedTemplates finds two codes in a temp dir and returns them sorted', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-i18n-'));
  const modPath = join(rootPath, 'MyMod');
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.schinese.template.md'), '');
  writeFileSync(join(modPath, 'README.german.template.md'), '');

  const result = await discoverLocalizedTemplates({ modPath });

  assert.deepEqual(result, [
    { code: 'german', filename: 'README.german.template.md' },
    { code: 'schinese', filename: 'README.schinese.template.md' },
  ]);
});

test('discoverLocalizedTemplates on a directory that does not exist returns an empty array', async () => {
  const result = await discoverLocalizedTemplates({ modPath: '/repo/MyMod' });

  assert.deepEqual(result, []);
});

test('discoverLocalizedTemplates ignores README.template.md, README.md and README.schinese.md', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-i18n-'));
  const modPath = join(rootPath, 'MyMod');
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.template.md'), '');
  writeFileSync(join(modPath, 'README.md'), '');
  writeFileSync(join(modPath, 'README.schinese.md'), '');

  const result = await discoverLocalizedTemplates({ modPath });

  assert.deepEqual(result, []);
});

test('compileReadme with no templateFilename still reads README.template.md', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-compile-'));
  const modPath = join(rootPath, 'MyMod');
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.template.md'), 'default body\n');

  const result = await compileReadme({ modPath, header: 'H', footer: 'F' });

  assert.match(result, /default body/);
});

test('compileReadme with templateFilename reads that file', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-compile-'));
  const modPath = join(rootPath, 'MyMod');
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.german.template.md'), 'german body\n');

  const result = await compileReadme({
    modPath,
    header: 'H',
    footer: 'F',
    templateFilename: 'README.german.template.md',
  });

  assert.match(result, /german body/);
});

test('writeCompiledReadme with a localized template writes README.<code>.md and leaves an existing README.md untouched', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'readme-compile-'));
  const modPath = join(rootPath, 'MyMod');
  mkdirSync(modPath, { recursive: true });

  writeFileSync(join(modPath, 'README.md'), 'english already here');
  writeFileSync(join(modPath, 'README.german.template.md'), 'german body\n');

  await writeCompiledReadme({
    modPath,
    header: 'H',
    footer: 'F',
    templateFilename: 'README.german.template.md',
  });

  assert.match(readFileSync(join(modPath, 'README.german.md'), 'utf8'), /german body/);
  assert.equal(readFileSync(join(modPath, 'README.md'), 'utf8'), 'english already here');
});

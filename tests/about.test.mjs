import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveWorkshopMetadata } from '../lib/about.mjs';

function makeMod(aboutXml, { withPreview = false } = {}) {
  const modDir = mkdtempSync(join(tmpdir(), 'steam-about-'));
  mkdirSync(join(modDir, 'About'), { recursive: true });

  if (aboutXml !== null) {
    writeFileSync(join(modDir, 'About', 'About.xml'), aboutXml);
  }

  if (withPreview) {
    writeFileSync(join(modDir, 'About', 'Preview.png'), 'not really a png');
  }

  return modDir;
}

test('derives tags from supportedVersions and appends Mod', async () => {
  const modDir = makeMod(`<?xml version="1.0" encoding="utf-8"?>
<ModMetaData>
  <name>MyMod</name>
  <supportedVersions>
    <li>1.5</li>
    <li>1.6</li>
    <li>1.7</li>
  </supportedVersions>
</ModMetaData>
`);

  const derived = await deriveWorkshopMetadata(modDir);

  assert.deepEqual(derived.tags, ['1.5', '1.6', '1.7', 'Mod']);
});

test('derives previewfile when About/Preview.png exists', async () => {
  const modDir = makeMod('<ModMetaData />', { withPreview: true });

  const derived = await deriveWorkshopMetadata(modDir);

  assert.equal(derived.previewfile, join(modDir, 'About', 'Preview.png'));
});

test('leaves both fields undefined when About.xml and the preview are missing', async () => {
  const modDir = makeMod(null);

  const derived = await deriveWorkshopMetadata(modDir);

  assert.equal(derived.tags, undefined);
  assert.equal(derived.previewfile, undefined);
});

test('leaves tags undefined when About.xml declares no supportedVersions', async () => {
  const modDir = makeMod('<ModMetaData><name>MyMod</name></ModMetaData>');

  const derived = await deriveWorkshopMetadata(modDir);

  assert.equal(derived.tags, undefined);
});

test('ignores list items outside the supportedVersions block', async () => {
  const modDir = makeMod(`<ModMetaData>
  <modDependencies>
    <li><packageId>some.dep</packageId></li>
  </modDependencies>
  <supportedVersions>
    <li>1.6</li>
  </supportedVersions>
  <loadAfter>
    <li>other.mod</li>
  </loadAfter>
</ModMetaData>`);

  const derived = await deriveWorkshopMetadata(modDir);

  assert.deepEqual(derived.tags, ['1.6', 'Mod']);
});

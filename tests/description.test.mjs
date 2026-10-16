import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDescriptionFits, buildSteamDescription, renderSteamBBCode } from '../lib/description.mjs';

test('returns fallback description when README is missing', async () => {
  const fixturePath = new URL('./fixtures/mod', import.meta.url).pathname;
  const description = await buildSteamDescription({ modPath: fixturePath });
  assert.equal(description, 'No description available.');
});

test('renderSteamBBCode converts headings, bold, links, images to BBCode', () => {
  const md = '# Hello\n\nThis is **bold** with a [link](https://example.com).\n\n![alt](https://example.com/img.png)';
  const out = renderSteamBBCode(md);
  assert.match(out, /\[h1\]Hello\[\/h1\]/);
  assert.match(out, /\[b\]bold\[\/b\]/);
  assert.match(out, /\[url=https:\/\/example\.com\]link\[\/url\]/);
  assert.match(out, /\[img\]https:\/\/example\.com\/img\.png\[\/img\]/);
});

test('renderSteamBBCode returns fallback on empty input', () => {
  assert.equal(renderSteamBBCode(''), 'No description available.');
  assert.equal(renderSteamBBCode('   \n  '), 'No description available.');
});

test('renderSteamBBCode wraps a fenced code block that carries a language tag', () => {
  const md = '```csharp\nclass Foo { void Bar() {} }\n```';
  const out = renderSteamBBCode(md);
  assert.match(out, /\[code\]\nclass Foo \{ void Bar\(\) \{\} \}\n\[\/code\]/);
  assert.doesNotMatch(out, /```/);
  assert.doesNotMatch(out, /\[noparse\]/);
});

test('renderSteamBBCode leaves a bare fenced code block intact', () => {
  const md = '```\nplain code\n```';
  const out = renderSteamBBCode(md);
  assert.match(out, /\[code\]\nplain code\n\[\/code\]/);
});

test('buildSteamDescription accepts markdown directly and rewrites asset links', async () => {
  const description = await buildSteamDescription({
    modPath: '/nonexistent',
    markdown: '![intro](../.github/assets/mymod/intro.png)',
    assetBaseUrl: 'https://example.com',
  });

  assert.match(description, /\[img\]https:\/\/example\.com\/\.github\/assets\/mymod\/intro\.png\[\/img\]/);
});

test('buildSteamDescription reads from README.md when markdown is not passed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'steam-desc-'));
  const modPath = join(root, 'MyMod');
  mkdirSync(modPath, { recursive: true });
  writeFileSync(join(modPath, 'README.md'), '# Title\n\nBody.');

  const out = await buildSteamDescription({ modPath });
  assert.match(out, /\[h1\]Title\[\/h1\]/);
  assert.match(out, /Body/);
});

test('assertDescriptionFits accepts a description at the byte limit', () => {
  assert.doesNotThrow(() => assertDescriptionFits('a'.repeat(8000), 'Mod "MyMod" english'));
});

test('assertDescriptionFits counts bytes, not characters', () => {
  const cyrillic = '\u0430'.repeat(4001);

  assert.equal(cyrillic.length, 4001);
  assert.throws(() => assertDescriptionFits(cyrillic, 'Mod "MyMod" russian'), {
    message: /Mod "MyMod" russian description is 8002 bytes.*8000 byte limit \(4001 characters\)/s,
  });
});

test('assertDescriptionFits names the language that is too long', () => {
  assert.throws(() => assertDescriptionFits('a'.repeat(8001), 'Mod "MyMod" schinese'), {
    message: /Mod "MyMod" schinese description is 8001 bytes/,
  });
});

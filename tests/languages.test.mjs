import test from 'node:test';
import assert from 'node:assert/strict';
import { languageInt, KNOWN_LANGUAGE_CODES } from '../lib/languages.mjs';

test('resolves known codes to their ELanguage integers', () => {
  assert.equal(languageInt('schinese'), 6);
  assert.equal(languageInt('russian'), 8);
  assert.equal(languageInt('spanish'), 5);
});

test('english throws because slot 0 is already written by the steamcmd upload', () => {
  assert.throws(() => languageInt('english'), /slot 0|steamcmd upload/);
});

test('an unknown code throws and lists the known codes', () => {
  assert.throws(() => languageInt('korean'), error => {
    assert.match(error.message, /korean/);
    for (const code of KNOWN_LANGUAGE_CODES) {
      assert.match(error.message, new RegExp(code));
    }
    return true;
  });
});

test('arabic has no probed integer yet and throws the unknown-code error', () => {
  assert.throws(() => languageInt('arabic'), /Unknown Steam language code/);
});

test('is case-sensitive and rejects an uppercase code', () => {
  assert.throws(() => languageInt('SCHINESE'), /Unknown Steam language code/);
});

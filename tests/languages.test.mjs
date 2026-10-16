import test from 'node:test';
import assert from 'node:assert/strict';
import { languageInt, localizedValue, KNOWN_LANGUAGE_CODES } from '../lib/languages.mjs';

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

test('localizedValue hands a plain string to every language', () => {
  assert.equal(localizedValue('one header', 'default'), 'one header');
  assert.equal(localizedValue('one header', 'spanish'), 'one header');
});

test('localizedValue picks the entry for the language it is asked for', () => {
  const value = { default: 'Spoilers below.', spanish: 'Spoilers abajo.' };

  assert.equal(localizedValue(value, 'spanish'), 'Spoilers abajo.');
  assert.equal(localizedValue(value, 'default'), 'Spoilers below.');
});

test('localizedValue falls back to default for a language the map leaves out', () => {
  assert.equal(localizedValue({ default: 'Spoilers below.' }, 'russian'), 'Spoilers below.');
});

test('localizedValue returns undefined for an option that was never set', () => {
  assert.equal(localizedValue(undefined, 'spanish'), undefined);
  assert.equal(localizedValue(null, 'default'), undefined);
});

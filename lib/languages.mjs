const LANGUAGE_INTS = {
  english: 0,
  german: 1,
  french: 2,
  italian: 3,
  koreana: 4,
  spanish: 5,
  schinese: 6,
  tchinese: 7,
  russian: 8,
  thai: 9,
  japanese: 10,
  portuguese: 11,
  polish: 12,
  danish: 13,
  dutch: 14,
  finnish: 15,
  norwegian: 16,
  swedish: 17,
  romanian: 18,
  turkish: 19,
  hungarian: 20,
  czech: 21,
  brazilian: 22,
  bulgarian: 23,
  greek: 24,
  ukrainian: 25,
};

export const KNOWN_LANGUAGE_CODES = Object.keys(LANGUAGE_INTS);

/**
 * Resolves a steam API language code to its `ELanguage` integer (field 17 of
 * `CPublishedFile_Update_Request`). Throws on `english` or on a code with no known integer.
 */
export function languageInt(code) {
  if (code === 'english') {
    throw new Error(
      'README.english.template.md collides with slot 0, which the steamcmd upload already writes. ' +
        'Drop the "english" template and use the plain README.template.md instead.',
    );
  }

  const value = LANGUAGE_INTS[code];
  if (value === undefined) {
    throw new Error(
      `Unknown Steam language code "${code}". Known codes: [${KNOWN_LANGUAGE_CODES.join(', ')}].`,
    );
  }

  return value;
}

/**
 * Picks the text a localizable option gives one language: a plain string applies everywhere,
 * a map keys by language code and falls back to `default`, which is the English slot.
 */
export function localizedValue(value, code) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  return value[code] ?? value.default;
}

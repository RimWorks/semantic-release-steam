/**
 * semantic-release plugin that publishes Steam Workshop items via SteamCMD.
 *
 * @packageDocumentation
 */

/** Steam Workshop visibility flag (matches workshop_build_item VDF spec). */
export type WorkshopVisibility = 0 | 1 | 2 | 3;

/** Steam API language codes, minus `english`: the English slot is `default`. */
export type SteamLanguageCode =
  | 'german' | 'french' | 'italian' | 'koreana' | 'spanish' | 'schinese' | 'tchinese'
  | 'russian' | 'thai' | 'japanese' | 'portuguese' | 'polish' | 'danish' | 'dutch'
  | 'finnish' | 'norwegian' | 'swedish' | 'romanian' | 'turkish' | 'hungarian'
  | 'czech' | 'brazilian' | 'bulgarian' | 'greek' | 'ukrainian';

/**
 * Text that can differ per language. A plain string applies to every language. A map needs a
 * `default` entry, which is the English slot and the fallback for any code it omits.
 */
export type LocalizedText =
  | string
  | ({ default: string } & Partial<Record<SteamLanguageCode, string>>);

/** Workshop metadata that can be set per-mod or per-target. */
export interface WorkshopMetadata {
  /** Workshop item title. Only emitted if set. */
  title?: LocalizedText;
  /** Path to a preview image (jpg/png), relative to the mod path or absolute. Defaults to `About/Preview.png`. */
  previewfile?: string;
  /** 0 = public, 1 = friends-only, 2 = private, 3 = unlisted. Only emitted if set. */
  visibility?: WorkshopVisibility;
  /** Workshop tags. Defaults to `About.xml`'s `supportedVersions` plus `Mod`. */
  tags?: string[];
}

export interface ModConfig extends WorkshopMetadata {
  /** Human-readable mod name, used in logs. */
  name: string;
  /** Mod content directory, relative to the semantic-release cwd. */
  path: string;
  /** Map of branch-target name -> Steam Workshop publishedfileid. Keys must match values from `branchTargets`. */
  workshopIds: Record<string, string>;
  /** Per-target metadata overrides. Values here win over the mod-level defaults. */
  metadata?: Record<string, WorkshopMetadata>;
}

/**
 * Returns an ordered list of subdirectory names under `<repo>/.github/assets/` to try
 * when resolving fallback asset paths. Tried in order until one matches.
 */
export type AssetDirNameTransform =
  | string[]
  | ((modPath: string) => string[]);

export interface PluginConfig {
  /** Steam app ID (e.g. "294100" for RimWorld). */
  appId: string;
  /**
   * Map of git branch name -> workshop target key. Branches not in the map are silently skipped
   * (semantic-release will still run other plugins). The target key is used to look up the
   * `workshopIds` entry for each mod.
   */
  branchTargets: Record<string, string>;
  /** One or more mods to publish. */
  mods: ModConfig[];

  /** Text prepended to each mod's compiled README before BBCode conversion. */
  descriptionHeader?: LocalizedText;
  /** Text appended to each mod's compiled README. */
  descriptionFooter?: LocalizedText;
  /**
   * URL template with `{branch}` placeholder. Asset paths matching `../.github/assets/`
   * in the README are rewritten to absolute URLs against this base before BBCode conversion.
   */
  assetBaseUrlTemplate?: string;
  /**
   * Resolves the ordered list of asset subdirectory names to try inside `<repo>/.github/assets/`
   * for fallback substitution. Default: `[basename(modPath).toLowerCase(), 'fallback']`.
   *
   * - Function form receives the absolute mod path and returns dir names.
   * - Array form is a static list. Entries containing glob characters (`*?[`) are resolved as
   *   globs against `<repo>/.github/assets/`; other entries are used as literal subdirectory names.
   */
  assetDirNameTransform?: AssetDirNameTransform;

  /**
   * Write the compiled README to `<modPath>/README.md` (the v1 behavior). Default `false`:
   * the compiled markdown is kept in memory and never touches the user's repo.
   *
   * Enable only if you previously relied on the side-effect (e.g. to commit README.md via
   * `@semantic-release/git`).
   */
  outputReadme?: boolean;
  /** Max time in ms to wait for SteamCMD to finish. Default 600000 (10 min). */
  uploadTimeoutMs?: number;
  /**
   * Log SteamCMD stdout/stderr at info level. Default `false` (debug level).
   * Useful for diagnosing CI failures.
   */
  verbose?: boolean;
}

/** Minimal slice of semantic-release's context object that this plugin reads. */
export interface PluginContext {
  branch: { name: string };
  cwd?: string;
  env: Record<string, string | undefined>;
  nextRelease: { version: string; notes?: string };
  logger: {
    log: (msg: string, ...args: unknown[]) => void;
    error?: (msg: string, ...args: unknown[]) => void;
    debug?: (msg: string, ...args: unknown[]) => void;
  };
  options?: { dryRun?: boolean };
}

export function verifyConditions(pluginConfig: PluginConfig, context: PluginContext): Promise<void>;
export function publish(pluginConfig: PluginConfig, context: PluginContext): Promise<void>;

declare const _default: { verifyConditions: typeof verifyConditions; publish: typeof publish };
export default _default;

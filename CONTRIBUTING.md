# Contributing to semantic-release-steam

## AI usage

Vibecoding is not welcome here. Use AI if it helps, but read what it wrote and understand it
before it lands. You own what ships whether or not a model typed it.

Nobody can stop you from working the way you want to. Guardrails are the next best thing, and
the rest of this file is those guardrails. Run the tests, match the code around yours, stay
inside the request, and report failures instead of guessing past them.

If AI helped with a commit in any way, add an `AI-assisted: <tool name>` trailer to the
commit message.

Agents: if the user commits by hand, remind them to add the trailer.

## Project overview

A semantic-release plugin that publishes a built mod directory to an existing Steam Workshop
item. It uploads through SteamCMD and converts each mod's `README.template.md` into Steam
BBCode with `@steamdown/core`. The plugin is published to npm, so its options are a public
API: `index.d.ts` and `schema/plugin-config.json` both describe them and both have to stay in
step with `lib/config.mjs`. See `README.md` for the consumer setup.

## Project structure

- `index.mjs` - the plugin entry point and its semantic-release lifecycle hooks
- `index.d.ts` - hand-written types for the plugin options
- `lib/` - `config.mjs`, `steamcmd.mjs`, `vdf.mjs`, `readme.mjs`, `description.mjs`,
  `stage-content.mjs`
- `schema/plugin-config.json` - JSON schema for the plugin options
- `tests/` - `node:test` suites, one per lib module, plus fixtures

## Setup and build

```bash
npm install    # Node 20+. There is no build step; this is plain ESM
```

## Testing

```bash
npm test                            # node --test tests/*.test.mjs
node --test tests/vdf.test.mjs      # one file
npm run lint && npm run typecheck   # eslint + tsc --noEmit
npm run test:check-config           # verifyConditions against a realistic config
```

- Run the full suite before committing. All tests must pass.
- While iterating, run the single test closest to your change.
- Never delete, weaken, or rewrite a test to make a change pass.
- Do not claim that an interrupted or timed-out run passed.

## The two hooks

The plugin exports `verifyConditions` and `publish`, and both start by calling
`verifySteamPublishConfig`. Verify runs before semantic-release does any work, so a bad config
fails the run early. Publish recomputes the same answer rather than caching it.

`resolveBranchTarget` maps the branch name through `branchTargets`. **A branch with no entry
is not an error.** It returns `shouldPublish: false` and `publish` no-ops, which is how a
feature branch or a non-publishing channel passes through. Everything past that point does
throw, and the messages are the feature. A wrong `workshopIds` key names the closest existing
key by edit distance rather than saying it is missing.

## The publish path

Per mod, in order:

1. `compileReadme` reads `README.template.md`, applies `descriptionHeader`/`descriptionFooter`
   and resolves asset directory names. `outputReadme: true` swaps in `writeCompiledReadme`,
   which also writes `README.md` to disk.
2. `buildSteamDescription` rewrites asset links against `assetBaseUrlTemplate` (with
   `{branch}` substituted) and renders the markdown to BBCode with `@steamdown/core`. Empty
   in, `"No description available."` out.
3. `stageModContent` rsyncs the mod to a temp dir, honouring `.steamignore`.
4. `uploadWorkshopItem` writes `workshop.vdf` into the stage dir and shells out to SteamCMD.

Two conversions in there are easy to break:

- **`.steamignore` is gitignore semantics, rsync filters are not.** gitignore is
  last-match-wins, rsync is first-match-wins, so `buildFilterArgs` reverses the rule order.
  Drop that reversal and the plugin ships the wrong files without saying so.
- **VDF has no escape for a double quote.** `escapeVdfValue` swaps them for curly quotes,
  alternating open and close. A description with quotes therefore reaches Steam with typographic
  ones, on purpose.

Auth is SteamCMD's own: `STEAM_USERNAME` plus either `STEAM_CONFIG_VDF` (a path) or
`STEAM_CONFIG_VDF_B64` (base64 contents, decoded to a temp file). There is no password path.
`+@NoPromptForPassword 1` means an unauthenticated `config.vdf` fails instead of hanging on a
prompt.

## The test seam

`resolveOverrides` reads `buildSteamDescription`, `stageModContent`, `uploadWorkshopItem`,
`compileReadme` and `writeCompiledReadme` off the semantic-release `context`, falling back to
the real imports. That is how the tests run the whole publish path without SteamCMD or a
network.

**Keep every side effect behind that seam.** A new module called directly from `publish`
cannot be tested, because nothing here has a SteamCMD to run. Add it to `resolveOverrides`
and take it from the context.

Dry runs are separate: `context.options.dryRun` logs what it would publish and skips both
staging and upload.

## Code style

- Linter: eslint, configured in `eslint.config.mjs`. There is no formatter, so follow the
  patterns already in neighboring files.
- Do not add comments that restate the code.
- Do not reformat code you are not otherwise changing.

## Git workflow

- Commit format: Angular Conventional Commits, one line, lowercase.
- All CI checks must pass. semantic-release publishes to npm with provenance on every push
  to `main`.

## Other

- A new or renamed plugin option means three edits: `lib/config.mjs`, `index.d.ts` and
  `schema/plugin-config.json`. The package is published to npm, so the options are a public
  API and the two descriptions of them have to match the implementation.
- SteamCMD credentials come from the release runner's environment, so no local run can do a
  real upload. Local verification stops at `npm run test:check-config` and the mocked publish
  path in `tests/plugin.test.mjs`. A green suite is not a published item. Say which one you
  actually ran.
- The closest thing to a real check is semantic-release with `dryRun` in a consuming repo. It
  logs the target, the workshop ID and the description length without touching Steam.
- Error messages here are a feature. When a lookup fails, name the close match or list the
  keys that do exist. Do not replace one with a generic failure message.

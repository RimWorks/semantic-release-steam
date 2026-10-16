# semantic-release-steam

Use [semantic-release](https://semantic-release.gitbook.io/semantic-release/) to publish built mod directories to existing Steam Workshop items. The plugin uploads through [SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) and converts each mod's `README.template.md` to Steam BBCode with [`@steamdown/core`](https://www.npmjs.com/package/@steamdown/core).

## Install

```bash
npm install --save-dev semantic-release-steam
```

Your release runner needs Node.js 20+, SteamCMD, and `rsync`.

## Configure

Add the plugin to `release.config.mjs`:

```js
export default {
  branches: ['main'],
  plugins: [
    [
      'semantic-release-steam',
      {
        appId: '294100',
        branchTargets: { main: 'stable' },
        mods: [
          {
            name: 'My Mod',
            path: 'dist/MyMod',
            workshopIds: { stable: '1234567890' },
          },
        ],
      },
    ],
  ],
};
```

`branchTargets` maps each release branch to a Workshop target. Each mod's `workshopIds` maps those targets to existing Steam Workshop item IDs.

Set these variables in your release environment:

- `STEAM_USERNAME`
- `STEAM_CONFIG_VDF` or `STEAM_CONFIG_VDF_B64`
- `STEAMCMD_PATH` if SteamCMD isn't at `~/steamcmd/steamcmd.sh`
- `STEAM_PASSWORD` or `STEAM_REFRESH_TOKEN`, only if any mod sets `tags` or has a localized
  README template - these log in to Steam over a separate connection and set Workshop browse
  tags and localized titles and descriptions, since SteamCMD itself has no way to set any of
  them. `STEAM_REFRESH_TOKEN` skips the Steam Guard prompt; `STEAM_PASSWORD` needs one approval
  tap per publish.

SteamCMD must have a saved login in its `config/config.vdf`. See the [SteamCMD Workshop upload guide](https://partner.steamgames.com/doc/features/workshop/implementation#SteamCmdIntegration) for the item setup and VDF format.

Put `README.template.md` in each mod directory. Add `.steamignore` there if you need to exclude files from the upload.

### Localized descriptions

Add a `README.<language>.template.md` file next to `README.template.md` to publish a translated description for that language. `README.template.md` itself always stays the English description.

`<language>` is a Steam API language code. Steam assigns these independently of ISO codes. Korean is `koreana`, and Brazilian Portuguese is `brazilian`. The plugin accepts these 25 codes:

`german`, `french`, `italian`, `koreana`, `spanish`, `schinese`, `tchinese`, `russian`, `thai`, `japanese`, `portuguese`, `polish`, `danish`, `dutch`, `finnish`, `norwegian`, `swedish`, `romanian`, `turkish`, `hungarian`, `czech`, `brazilian`, `bulgarian`, `greek`, `ukrainian`

See Valve's [language table](https://github.com/alliedmodders/hl2sdk/blob/master/common/language.cpp) for the source of these codes and the full list Steam defines. `arabic`, `indonesian`, `latam`, and `vietnamese` are missing on purpose. Valve has not assigned any of them a language number for this API. The plugin has no integer to send for those languages and cannot publish a description in them.

`README.english.template.md` is rejected. Slot 0, the one `README.template.md` already fills, is English.

A mod with any localized template needs a `title`, set on the mod or in a per-target `metadata` override. A localized update sent with no title leaves that language's title blank on Steam. It does not fall back to the English title.

### Per-language titles, headers and footers

`title`, `descriptionHeader` and `descriptionFooter` each take either one string for every language, or a map that varies by language:

```js
descriptionHeader: {
  default: 'Spoilers below.',
  spanish: 'Spoilers abajo.',
  russian: 'Ниже спойлеры.',
},
```

A map requires a `default` entry. That is the English slot, and it is the fallback for any language the map leaves out. `english` is not a valid key: use `default` instead.

### The 8000 byte description limit

Steam caps a Workshop description at 8000 **bytes**, not characters. UTF-8 spends 2 bytes on each Cyrillic letter and 3 on each CJK one, so a Russian description runs out of room at roughly 4000 characters and a Chinese one at roughly 2600. Steam answers an oversized update with `eresult 8` and no explanation, so the plugin measures every description first and fails with the mod, the language and the byte count. A dry run reports it too.

Two fields come from the mod directory when you leave them out of the config. `tags` becomes every `<li>` under `<supportedVersions>` in `About/About.xml`, plus `Mod`. `previewfile` becomes `About/Preview.png` when that file exists. Setting either one in the config, or in a per-target `metadata` override, wins.

The plugin updates Workshop items. Create each item before your first release, then add its ID to `workshopIds`.

## Documentation

- [Plugin option reference](./schema/plugin-config.json)
- [semantic-release configuration](https://semantic-release.gitbook.io/semantic-release/usage/configuration)
- [GitHub Actions setup](https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions)
- [Steam Workshop implementation guide](https://partner.steamgames.com/doc/features/workshop/implementation)

## Recovering a missed tag update

If a publish uploads through SteamCMD but fails before the tag step finishes (a missed Steam
Guard tap, a dropped connection), retag the item without a new release:

```bash
npx semantic-release-steam-apply-tags --config release.config.mjs.json --target main
```

`--config` points at a JSON file holding just this plugin's own options (`appId`,
`branchTargets`, `mods`), not the full `release.config.mjs`. Write it once, for example with
`node -e "console.log(JSON.stringify(require('./release.config.mjs').default.plugins[0][1]))" > release.config.mjs.json`.

`--target` is the git branch name, resolved through the same `branchTargets` map as a normal
publish.

## Running these by hand from GitHub Actions

Add `workflow_dispatch` to the workflow that runs `semantic-release`, alongside its existing
trigger:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch: {}
```

`semantic-release` still decides whether a release is needed. A manual run with no new
commits logs "no release published" and exits clean.

Tag recovery needs its own workflow, since it takes a branch name as input instead of reading
the one that triggered the run:

```yaml
name: apply-tags

on:
  workflow_dispatch:
    inputs:
      target:
        description: Branch name, resolved through branchTargets like a normal publish
        required: true

jobs:
  apply-tags:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
      - run: npm ci
      - run: npx semantic-release-steam-apply-tags --config release.config.mjs.json --target "${{ github.event.inputs.target }}"
        env:
          STEAM_USERNAME: ${{ secrets.STEAM_USERNAME }}
          STEAM_CONFIG_VDF_B64: ${{ secrets.STEAM_CONFIG_VDF_B64 }}
          STEAM_PASSWORD: ${{ secrets.STEAM_PASSWORD }}
```

Run it from the repo's Actions tab and pick the branch. It retags the item without touching
SteamCMD or cutting a release.

## Forcing a release

`semantic-release` reads commit messages to decide the version bump. It has no flag for
forcing one. To force a release on demand, push an empty commit with a conventional-commit
message, then run `semantic-release` in the same job:

```yaml
name: force-release

on:
  workflow_dispatch:
    inputs:
      bump:
        description: Release type to force
        required: true
        type: choice
        options: [patch, minor, major]
      message:
        description: Commit message, written into the changelog
        required: true

jobs:
  force-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
      - run: npm ci
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          case "${{ inputs.bump }}" in
            patch) type=fix ;;
            minor) type=feat ;;
            major) type='feat!' ;;
          esac
          git commit --allow-empty -m "$type: ${{ inputs.message }}"
          git push
      - run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          STEAM_USERNAME: ${{ secrets.STEAM_USERNAME }}
          STEAM_CONFIG_VDF_B64: ${{ secrets.STEAM_CONFIG_VDF_B64 }}
          STEAM_PASSWORD: ${{ secrets.STEAM_PASSWORD }}
```

Run `semantic-release` in this same job instead of relying on the push above to trigger your
normal release workflow. A push made with the default `GITHUB_TOKEN` doesn't trigger other
workflows, so the push-based workflow would never run.

## License

[MIT](./LICENSE)

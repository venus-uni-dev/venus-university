# Venus University

Venus University is a local, single-player, AI-driven dating sim in visual-novel form. It is an
Electron desktop app in which Google's Gemini writes the scenes and a locally managed ComfyUI
renders the character art. There is no server: everything the player configures lives in a
`data/` folder next to the app.

The supported way to play is the itch.io page:
**https://venus-dev.itch.io/venus-university**

## What this repository is

This is a read-only snapshot mirror of the private development repository. Every push to the
private repository's `main` branch becomes one squashed commit here.

Not accepting PRs or issues at the moment, if you have problems send them to the channels on the itch.io page.

## What's missing

These folders are excluded from the mirror and do not exist here:

- `assets/bg`, `assets/bg_thumbs` — shipped backgrounds/thumbs
- `assets/characters` — character sprites since some of them contain NSFW imagery (breaches github's rules)
- `assets/sound` — music/sfx that I don't have permission to redistribute
- `assets/pose/poseMaterial` — the reference pictures the openpose skeletons were made from; the skeletons themselves are included
- `.github/` — the private repository's CI configuration.

## Quirks of running from this repository

- `npm run dev` starts, but with no backgrounds, no shipped cast and no music or sound effects.
  Quickstart and the shipped characters are unavailable. Character generation works: the pose
  manifest and openpose skeletons under `assets/pose` are included.
- A Gemini API key is required to play. It is stored in `data/settings.json`, encrypted at rest
  with Windows DPAPI (Electron's `safeStorage`); where DPAPI is unavailable it falls back to
  storing the key as plain text in the same file.
- The browser build (`npm run build:web`) needs `build/web-assets`, which only the private
  repository's release script produces; it is not present here.
- The game contains optional adult content. The code paths and prompts that produce it are
  visible in this repository; the images themselves are not.

## Build, test, typecheck

Requires Node 22.

```
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

`npm run build` succeeds without any of the missing art: the renderer's background loader
tolerates an empty `assets/bg`, and nothing else is bundled at build time.

## Verifying a release

Releases are Windows zips distributed on itch.io. To compare a release against this source:

1. Extract the shipped app: `npx @electron/asar extract app.asar out-shipped` (from inside the
   release zip's `resources` folder).
2. Build the matching tagged snapshot from this repository:
   `git checkout vX.Y.Z && npm ci && npm run build`.
3. Compare the built `out/main` and `out/preload` (which bundle no art) with the shipped copies.

This is a comparison, not a byte-identical match: `npm run build` here runs without the shipped
art, and packaging bundles a few extra files (see `electron-builder.yml`). Release SHA-256 hashes
are posted on each tag's GitHub release.

## Licence

- Code is licensed under AGPL-3.0-only — see `LICENSE`.
- Image, audio and video files are all rights reserved — see `LICENSE-ASSETS.md`.
- Security reports go through `SECURITY.md`.

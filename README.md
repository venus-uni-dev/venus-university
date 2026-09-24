# Venus University

Venus University is a single-player AI-driven dating sim available for web and desktop (via Electron).

The supported way to play is the itch.io page:
**https://venus-dev.itch.io/venus-university**

This is a read-only snapshot mirror of my private development repository. I am not accepting PRs or issues at the moment, if you have feedback or suggestions, please send me an email (listed on the itch.io page above) or make a bug report in the community.

## What's missing

These folders are excluded from the mirror and do not exist here:

- `assets/bg`, `assets/bg_thumbs` — shipped backgrounds/thumbs
- `assets/characters` — character sprites since some of them contain NSFW imagery (breaches github's rules)
- `assets/sound` — music/sfx that I don't have permission to redistribute
- `assets/pose/poseMaterial` — the reference pictures the openpose skeletons were made from; the skeletons themselves are included
- `.github/` — the private repository's CI configuration.

and probably some other folders. If they're not here, I probably excluded them for some reason or other.

## Running from this repo

- `npm run dev` will start properly, but it'll have no backgrounds, no music/sfx and no pre-gen characters. Character generation should work: the pose
  manifest and openpose skeletons under `assets/pose` are included.
- An external API is required to play. API keys are stored in `data/settings.json`, encrypted at rest
  with Windows DPAPI (Electron's `safeStorage`); where DPAPI is unavailable it falls back to
  storing the key as plain text in the same file.
- The browser build (`npm run build:web`) won't work, it requires private assets

## Building

Requires Node 22.

```
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

## Verifying a release

Releases are Windows zips distributed on itch.io. To compare a release against this source:

1. Extract the shipped app: `npx @electron/asar extract app.asar out-shipped` (from inside the
   release zip's `resources` folder).
2. Build the matching tagged snapshot from this repository:
   `git checkout vX.Y.Z && npm ci && npm run build`.
3. Compare the built `out/main` and `out/preload` (which bundle no art) with the shipped copies.

The two builds won't be byte identical since it's missing most of the assets.

## Licence

- Code is licensed under AGPL-3.0-only — see `LICENSE`.
- Image, audio and video files are all rights reserved — see `LICENSE-ASSETS.md`.
- If you spot security issues, please read `SECURITY.md` before reporting
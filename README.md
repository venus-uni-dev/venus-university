# Venus University

Venus University is a local, single-player, AI-driven dating sim in visual-novel form. It is an
Electron desktop app in which Google's Gemini writes the scenes and a locally managed ComfyUI
renders the character art. There is no server: everything the player configures lives in a
`data/` folder next to the app.

The supported way to play is the itch.io page:
**https://venus-dev.itch.io/venus-university**

## What this repository is

This is a read-only snapshot mirror of the private development repository. Every push to the
private repository's `main` branch becomes one squashed commit here, and each commit message
carries a `Source-Commit:` trailer naming the private commit it came from. There are no other
branches, and history here is never rewritten.

Pull requests are not accepted — sole authorship of the private repository is kept so its licence
can change later without needing every contributor's consent. Issues are welcome.

## What is missing and why

These folders are excluded from the mirror and do not exist here:

- `assets/bg`, `assets/bg_thumbs` — the shipped backgrounds and their thumbnails.
- `assets/characters` — the shipped cast's art, part of which is adult imagery that GitHub does
  not host.
- `assets/sound` — the shipped music and sound effects, whose redistribution rights outside the
  original release are unverified.
- `assets/pose/skeletons` — the openpose skeleton images ComfyUI renders against.
- `build/itch-page` — marketing screenshots and captures for the store page.
- `.github/` — the private repository's CI configuration.

Together the excluded art and audio come to about 2 GB, far more than a source repository should
carry.

Kept from `assets/`: `assets/quickstart.json`, `assets/workflows/*.json` (the ComfyUI API-format
graphs the app runs), `assets/pose/pose.json` (the pose manifest, without the skeleton images),
and the PNGs at the assets root (logos, the map).

## Quirks of running from this repository

- `npm run dev` starts, but with no backgrounds, no shipped cast, no music or sound effects and no
  pose skeletons. Quickstart and the shipped characters are unavailable, and character generation
  cannot run: every ComfyUI graph the app builds loads a skeleton image from
  `assets/pose/skeletons`, which is not here.
- The game writes everything — settings, saves, generated characters — to a `data/` folder beside
  the running executable.
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

## Audit map

Where the app touches the outside world and the disk:

| Concern | Where |
| --- | --- |
| Gemini API requests | `src/shared/llm/geminiAdapter.ts` |
| ComfyUI (local HTTP, spawned and owned by the app) | `src/main/services/comfyService.ts` |
| Setup downloads (ComfyUI runtime, custom nodes and model files, from GitHub and Hugging Face) | `src/shared/setupManifest.ts` names every URL, tag, commit and hash; `src/main/services/downloadService.ts` fetches them |
| The IPC surface the renderer can call | `src/preload/api.d.ts` (the bridge's types), `src/preload/index.ts` (what it exposes) |
| Where files are written on disk | `src/main/paths.ts` |
| API key storage | `src/main/services/settingsService.ts` |
| Auto-update or telemetry | None. The app does not check for updates or send usage data anywhere. |

Civitai is not a network peer of the running app: the credits screen
(`src/renderer/views/CreditsModal.tsx`) links to civitai.com pages to attribute two of the image
models, but the models themselves are downloaded from Hugging Face mirrors named in
`setupManifest.ts`.

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

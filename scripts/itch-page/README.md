# itch.io store page pictures

The five sidebar screenshots, the three in the description and the two GIFs, staged in the dev app
and encoded to the sizes the page uses. The mechanism is the trailer's — `../trailer/{app,cdp,game,
stub,scratch}.mjs` — so this tool is only the page's own moments and the encoding: the same launch
on 9222/9229, the same scratch playthrough, the same renderer runtime, and the same LLM stub in the
main process, which is why nothing here can reach the cloud. `copy.mjs` holds every word and the
page's own roster; it is the one file to edit to change what a picture says.

## Commands

```
node scripts/itch-page/stage.mjs launch        # ~25 s; refuses if 9222 or 9229 is already bound
node scripts/itch-page/stage.mjs probe         # the window's geometry, and a master to check it by
node scripts/itch-page/stage.mjs preflight     # 2 s of screencast; fails if no frame arrives
node scripts/itch-page/stage.mjs still <name>  # stage one moment, write its 2560×1440 PNG master
node scripts/itch-page/stage.mjs gif <name>    # record one moment, then encode it
node scripts/itch-page/stage.mjs teardown      # stop the app and delete the scratch playthrough
node scripts/itch-page/encode.mjs              # every master and every recording, again
```

Stills: `lab`, `greenhouse`, `themePark`, `storm`, `weightRoom` (the sidebar), `friends`,
`map-night`, `characters` (the description). GIFs: `arcade`, `texts`. `--auto <ms>` sets how fast a
staged scene's lines turn; the default is 250 ms.

## A session

`launch`, then `probe` and `preflight`, then the five sidebar stills, then `friends` and
`map-night`, then `gif arcade` and `gif texts`, then `characters` — last, because it leaves the
game for Manage Characters — then `teardown`, then `encode.mjs`. Each command is its own process
and resets the stage itself, so one can be re-run on its own; a modal a previous one left up goes
with that reset.

Never minimise or cover the window while a GIF is recording: a screencast stops delivering frames
when the compositor stops drawing them, and `gif` refuses to encode a recording that came up short.

## What lands where

| Path | What |
|---|---|
| `build/itch-page/shots/masters/<name>.png` | the 2560×1440 capture, with the `#root` crop beside it in JSON — gitignored |
| `build/itch-page/shots/<name>.jpg` | the still the page is uploaded with: 1920×1080 for the sidebar, 1746×982 for the description |
| `build/itch-page/gifs/frames/<name>/` | the recorded JPEG frames and their timestamps, so a re-encode never needs the app |
| `build/itch-page/gifs/<name>.gif` | the GIF, 873 wide (the description column's own width); `texts` is cropped to the phone |

## The GIF ladder

A recording is resampled onto a fixed timeline (10 fps for `arcade`, 8 for `texts`), then encoded
down a ladder — fewer colours, less dither, a coarser inter-frame error, then a lower frame rate,
then a narrower picture — at effort 4 until it fits under 2.7 MB of itch's 3 MB cap, and the rung
that fits is re-encoded at effort 10. `encode.mjs` prints what every rung cost and what each page
of the winner costs; every page costing about what the first one does means a palette per frame
rather than a shared one. If no rung fits, shorten the recording's window, then drop it to 700
wide, then crop horizontally into the girls and the box.

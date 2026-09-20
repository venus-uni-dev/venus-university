# Trailer staging

A dev tool for recording the promotional video. It launches the dev app with both debugger
ports open, loads a **scratch copy** of a real playthrough, and stages each beat of the video —
cast, background, dialogue — over the live stores. No beat ever reaches the cloud: the two that
need the app's own loop are answered by a stub inside the main process.

Recording itself is yours. Point OBS (or whatever) at the Electron window and drive the beats
from a second terminal.

## Files

| File | Job |
|---|---|
| `stage.mjs` | the CLI: `node scripts/trailer/stage.mjs <command> [options]` |
| `app.mjs` | launching the dev app on 9222/9229 and stopping only the processes it started |
| `cdp.mjs` | the DevTools Protocol client, plus real mouse presses and typing |
| `runtime/` | the half that runs inside the renderer; everything it touches is a live store |
| `game.mjs` | the Node wrapper around `runtime/` |
| `scratch.mjs` | the scratch playthrough and the roster rewrite |
| `stub.mjs` | the LLM stub in the main process |
| `beats/` | one module per group of beats |
| `copy.mjs` | every authored word: the scene lines, the texts, the captions, the quiz |

Rewriting a line means editing `copy.mjs` and nothing else.

## Recording

```
node scripts/trailer/stage.mjs launch      # ~25 s; refuses if 9222 or 9229 is already bound
node scripts/trailer/stage.mjs duo-day     # stage a beat, then record the window
node scripts/trailer/stage.mjs teardown    # stops the app and deletes the scratch playthrough
```

`teardown` kills only the Electron processes under this checkout's `node_modules` that started
in the two minutes after `launch` — a dev instance of your own, started before or after, is left
alone.

Each beat command resets the screen, stages itself and prints what the stores hold. Click the
lines through yourself while recording; `--auto <ms>` turns them at a fixed pace instead.

| Command | What lands on screen |
|---|---|
| `duo-day` | the quad, April and Gwen fighting over him; read the lines out and the script types `Both of you.` and presses Go, and both girls answer. `--captions` draws the opening cards behind them |
| `kiss-night` | the rooftop; read the lines out and the script types `Just kiss her already!` and presses Go |
| `pe-duo` | the track, Morgana and Marina, opened under the curtain so the reveal is on camera |
| `texts-beach` | Livvie's thread; the script sends, her replies land, **you** press Begin hangout |
| `registrar` | VenusBot's thread with the week grid open |
| `exam` | the POL 101 midterm — answer at most four questions |
| `quiz A` | answers the question on screen, for a hands-free take |
| `rankup` | a scene in the library, then the Brain rank-up sheet over it |
| `milestone` | a scene at CuteTea, then what Ingrid took away from it in the box, then the "became lovers" sheet over it |
| `shop` `map` `calendar` | the landing with that panel pressed open (`--night` for the other half) |
| `splash` | the curtain up on midterms week; `splash --end` takes it off |
| `sfw-bedroom` | movie night in Haylee's room |
| `nsfw-bedroom` | the same opening, then the CG `--cg` names |
| `rain` | the train stop under a storm |
| `sting` | BunnyBot's "somebody saw you" tip on the landing, then its thread |
| `landing` | the landing on its own |
| `caption "text"` | the caption card; `--big WORD` adds the big line, `--clear` drops it |

Options: `--auto <ms>` (turn the lines at that pace), `--music` (leave the game's music up; it
is muted by default), `--captions` (the cards on `duo-day`; off by default), `--night`, `--cg <position>`, `--end`, `--big <word>`, `--clear`,
`--shot <path>` (write a PNG), `--copy <file>`, `--delay <ms>` (how long a stubbed reply takes).

## The scratch playthrough

`launch` clears it and the first beat builds it: the real save folder copied, pruned to one save
(day 13, morning), and the roster rewritten to the twelve girls the beats need — each swapped-in
girl arriving as a fresh contact on the schedule and haunts of the one she replaced. The swap
table in `scratch.mjs` is the one place to change who is in it. Its save is dated far enough in
the past that the menu's **Continue** never picks it, and the real folder is only ever read.
`teardown` deletes it.

Every beat also puts the save's own hour, sky and Bunnyboard back before it stages, so a second
take never opens on the texts the first one sent.

## When 9229 is unreachable

The stub lives in the main process, over the V8 inspector `electron-vite dev --inspect 9229`
opens. If that port is not answering, every beat still runs, but `kiss-night` and `texts-beach`
fall back to staging their lines straight onto the store: the box still clears and her lines
still land, but the app's own waiting state and the real curtain into the beach do not play.
Both beats say so on the console when they fall back.

While the stub is installed, main's four `llm:*` handlers are replaced, so nothing at all can
reach the cloud for the rest of the session — including a stray click. They come back only on a
relaunch.

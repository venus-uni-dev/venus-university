# Semester harness (browser build, custom-endpoint mock)

Plays one whole semester of the Venus University browser build under Playwright, with no real
LLM key, and takes seven manual saves along the way, each on the first opening line of its slot.
They land in `testsave/<playthroughId>/` as `manual01.json` … `manual07.json` beside
`playthrough.json`, in the same shape the desktop keeps under `data/saves/<playthroughId>/`. No
numeric slot-save is written there. The app's custom-endpoint provider is pointed at `mock.mjs`,
a local OpenAI chat-completions mock that plays the writer.

## The seven saves

| Save | Slot | Why |
| --- | --- | --- |
| `manual01` | the first slot of days 8-13 whose row offers a class and a project (8:0 in practice, Tuesday: ARH 101 and the MUS 180 project) | week two, never Monday day 7 |
| `manual02` | 43:0 | the Tuesday of midterm week; ARH 101 sits its midterm in this slot |
| `manual03` | 51:0 | mid spring break |
| `manual04` | 57:0 | the Tuesday after spring break |
| `manual05` | 113:0 | the Tuesday of finals week; ARH 101 sits its final in this slot |
| `manual06` | 118:1 | the Sunday night before the finals scores post; `finalsScoresShown` is still false, and the Monday opening that follows builds the scroll |
| `manual07` | 122:1 | the night before graduation; the run ends here, exit 0 |

Each save is taken on the slot's **first opening line**: the snapshot shows the new date and time,
`currentLine` set, nothing `busy`, `streaming` or `waitingForLine`, `loopState.openingWait` false,
`awaitingInput` false, no cast, transcript, summary, quiz, memory question or status screen. No
advance click may land on such a slot before it is taken: every click is checked in the page,
in the same task, against the list of slots still owed a save, and is held (`'held'`) while one
of them has its opening on screen. So a load reads the whole opening and then lands exactly as
the boundary's slot-save would.

Taking one: poll `manualSaveOffer()` until it is `'open'` (up to 60 s; it waits on typing bots,
`hangoutPrefetch`, `armedHangout`), `await writeManualSave(n)` (true on success: the line on
screen, the rest queued, `resumeOnLine: true`; nobody is on stage, so no thumbnail), wait for
`writesPending()` to fall, read `window.api.saves.read(id, 'manual0n')` and check it:
`saveId`, date and time, `scene` not null, empty `scene.cast` and `scene.transcript`, at least
one line between `scene.pendingLines` and `scene.currentLine`, no `thumbnail`, save schema 12,
record schema 3, and for `manual06` `finalsScoresShown` false. Then it writes `manual0n.json` (and
`playthrough.json` once) as `JSON.stringify(x, null, 2)` with no trailing newline.

manual01's slot is decided by `slotActionsNow()` (`src/renderer/stores/slotActions.ts`), called
once per slot of days 8-13 at its first opening line and kept in run-state under `probes`: the
slot qualifies when some action has `tone === 'class'` and another `tone === 'project'`. The
policy's own choice at the landing still reads the chips on screen.

## Files

- `semester.mjs`: the runner. Boots the page, plays slot after slot as the reader in `policy.mjs`,
  takes the seven manual saves, logs one row per slot, and resumes from where a killed run
  stopped.
- `policy.mjs`: the reader, as pure functions. `decide(snapshot, runState, rng)` picks each
  landing's action; `rngFor(seed, date, time, salt?)` seeds it per slot, so a replayed slot makes
  the same choice. Also `pickFavourite`, `quizLetter`, `guardText`, `weeklyStatLine` and the Fast
  Eats shift preference.
- `driver.mjs`: the Playwright helpers. `launchPersistent`, `firstRun`/`keyStage`,
  `quickstartToLanding`/`enrol`, `snapshot` (one `page.evaluate` returning everything the loop
  reads), `invoke` (calls one export of an app module in the page), the actions (`clickChip`,
  `typeAction`, `submitPreset`, `answerQuiz`, `saveMemories`, `dismissStatus`, `acceptHangout`,
  `acceptFriendRequests`, `takeJob`, `closePhone`, `advanceClick` with its hold list),
  `slotActions` (the row `slotActionsNow()` deals), `captureManual` and `mockState`.
- `mock.mjs`: the mock endpoint (its header says how it decides each reply). It keeps its own
  director state in `VU_RUN_DIR` as `director-state.json` and `mock.jsonl`.
- `facts.mjs`, `validate.mjs`, `makeBackup.mjs`, `install.mjs`, `restoreCheck.mjs`, `ts.mjs`:
  the lecture factoids the mock hands out, and the tools that check, pack, install and restore
  the captured playthrough. Each file's header describes it.

## Running it

From the repo root, in three terminals or as background jobs:

```
node testsave/harness/mock.mjs
npx vite -c vite.web.config.ts --port 5199 --strictPort
node testsave/harness/semester.mjs
```

- Start vite fresh for every run and on its own port with `--strictPort`. A vite left over from
  another session serves stale code on the port you think is yours, and after an HMR update the
  harness's `/@fs/` imports reach a second module instance (see the traps).
- If the first page load answers `504 (Outdated Optimize Dep)` and the page stays black, kill
  vite, start it once with `--force`, kill it again and start it without `--force`. The forced
  run keeps answering 504 until it is restarted.
- Never edit anything under `src/` during a run. An edit is an HMR update, which is the
  module-instance trap.
- Do a dry run first with a throwaway run dir: `VU_RUN_DIR=<scratch dir> node
  testsave/harness/semester.mjs --until 4:0`, then delete that dir.
- Point `VU_RUN_DIR` at the same dir for the mock and the runner, so the mock's director state
  and the runner's run-state belong to one playthrough.

Options and environment:

- `--until <date>:<time>` stops with exit 0 at the first landing at or past that slot. A save
  owed on that slot's opening line has been taken by then.
- `--seed <n>` (default 1) seeds the reader. A run dir keeps the seed it started with.
- `VU_RUN_DIR` (default `%TEMP%\vu-testsave-run`), `VU_WEB_PORT` (default 5199), `VU_MOCK_PORT`
  (default 8783). The endpoint is `http://127.0.0.1:<VU_MOCK_PORT>/v1`, model `mock-model`.

What the run dir holds:

- `profile/`: the Chromium profile. The browser build keeps settings and saves in IndexedDB
  there, so nothing is written under `data/`.
- `run-state.json`: `seed`, `playthroughId`, `captured` (`{ "manual0n": { date, time, mockTokens } }`),
  `probes` (`{ "<date>:<time>": { tones, qualifies } }` for manual01), `favouriteId`/`favouriteWeek`,
  `lastSlot`, `slots`.
- `semester.jsonl`: a `boot` row, then one row per slot (`date`, `time`, `decision`, `cast`,
  `quiz`, `events`, `housekeeping`, the `stats`, `money`, `contacts`, `lover` and `favourite` after
  the boundary, `elapsedMs`, `mockTokens` and `mockTokensSlot`), `capture` rows, failure dumps and
  an `exit` row.
- `console.log`: every console line from the page. `shots/`: screenshots at each capture, at
  `--until` and at every failure.

Exit codes: 0 done (manual07 taken, `--until` reached, or all seven already taken); 1 setup (no
mock, no vite, the wrong playthrough, the wrong timetable, no game after boot, the
module-instance trap); 2 the app failed (an app or fatal error, game over, a save check failed,
`writeManualSave` answered false or the offer read `'none'`, a save's slot passed without it —
including no qualifying slot in days 8-13 — or its slot reached the landing with no opening line
to save on, one failure retried nine times at one slot, or a harness exception); 3 stalled (the
watchdog saw no state change for 90 s, the save offer stayed `'waiting'` for 60 s, or one
landing took none of six actions). Once a page is up, a failing exit takes a screenshot and
dumps the snapshot and the mock's `/state` into the log first.

### Resuming and regenerating

- **Resume**: run `semester.mjs` again with the same `VU_RUN_DIR` (restart the mock with the same
  dir too). The profile still holds the playthrough, so the menu offers Continue in place of
  Quickstart. The runner clicks it and carries on from the newest save: a slot-save, an autosave
  or a manual save. A crash before a save is taken leaves the slot's slot-save newest, so Continue
  replays that opening and the save is taken on its first line. A crash after it leaves the
  manual save or something later newest; the save is recorded as taken, and a taken save is never
  retaken, so the runner just reads on.
- **Regenerate**: delete the old `testsave/<playthroughId>/` folder, start the mock and a fresh
  vite, and run with a new, empty `VU_RUN_DIR`.
- A run dir with all seven saves taken exits 0 at once.

## What one slot looks like

Each tick (about 80 ms) takes one snapshot and does the first thing that applies:

1. An app or fatal error, a view other than `game`, or `activeGameOver`: dump and exit 2.
2. `classifierError`: `retryClassify()`. An intro, closing, ledger or texting-ledger error:
   `retryEndingCall()`.
3. `turnError`: `CLASSIFIER_REJECTED` is logged, then `abandonTurn()`, and the next choice at that
   landing is solo. Any other code gets `retryTurn()`.
4. `memoryEdit` with the loop's gate open: `saveMemoryEdits` with every row as the modal opens on
   it (`{ type: applied?.type ?? 'liked', desc: applied?.desc ?? '' }`).
5. `statusModal`: `dismissStatusModal()`.
6. An exam question on screen with the input open: click `#game-quiz-<letter>`, right three times
   in four.
7. The first opening line of a slot still owed a save (or, before manual01, a slot of days 8-13
   not yet probed): probe it for manual01 and take whichever save it owes.
8. A landing, ready on two ticks in a row: stop if `--until` is reached, accept every friend
   request, take the job once VenusBot has sent its intro, then `decide` and act.
9. A decision point in the middle of a scene: type `I leave and head home.`. The current mock
   ends every scene on its opening, so this never fires against it; the older mock ended a
   continuation only on the word "leave".
10. Otherwise, click `.vu-stage-advance`, unless the click would pass a held opening line.

The reader, first match wins:

1. a class chip; 2. the shift chip; 3. an invitation: always from the lover, the favourite or a
   girl he has a plan with this slot, anybody else's at 0.3 while building and 0.6 while
   socialising; 4. a plan chip; 5. a project chip for a project not worked on this week;
6. the free slot. He is building while any stat is under 35 (Good) and socialising after. Solo
   0.70 of the time while building and 0.35 while socialising, 0.15 less on Saturday and Sunday.
   A solo action is private and trains the lowest stat under 35. Otherwise, in order: the lover
   (0.5; after 7 days of dating a night in his dorm one time in three, else a public date); the
   favourite (0.4; from day 60 with a crush or affection 30 or more he asks her out, otherwise a
   hangout); one of the four fondest other free contacts (0.3); a filler chip last.

The favourite is the lover once there is one; before that she is the contact with a crush,
else the fondest contact, picked again every week. Every typed sentence passes `guardText`: it
names nobody on the roster but the girl it is about (April, Winter, Marina, Ami, Lili and Gwen
are also ordinary words) and carries no month or season.

## The ids, classes and store functions it leans on

- First run: `#setup-provider` → `openai`, `#setup-endpoint-url`, blur by clicking
  `#setup-endpoint-key`, `#setup-model-id`, blur on `.vu-setup-card-heading`, `#setup-key-save`,
  then `#sfw-prompt-continue`. On a later visit the menu's top slot is `#menu-api-key` when no
  writer is set.
- Menu: `#menu-quickstart` without a playthrough, `#menu-continue` in its place once one exists.
- Name modal: `#player-first-name`, `#player-last-name`, `#player-name-submit`.
- Registrar: `[aria-label="Enroll in a course on <Weekday> <Day|Night>"]` (the empty slot's `+`),
  `#course-picker button.vu-pickcourse-row` (matched on its `.vu-code`), `#class-select-finalize`.
  The timetable is Monday Day PED 140, Tuesday Day ARH 101, Wednesday Day LIT 330, Thursday Day
  MUS 180 and Thursday Night MSC 112, checked against `playerSchedule` after boot.
- Landing: `.vu-landing-do` (tone class `vu-landing-do--plans|class|work`, words in
  `.vu-landing-doword`; a project row wears `--class` and reads "Work on <name> project") and
  `.vu-landing-idle`, clicked in document order. The well is `#game-action`, Go is
  `#game-submit`, the stage is `.vu-stage-advance`, and a quiz answer is `#game-quiz-A` to `D`.
  The visible line is `.vu-box:not([aria-hidden="true"]) .vu-box-line`.
- Store modules, through `/@fs/C:/Users/Eddie/Documents/venus-university/src/...`:
  `renderer/stores/gameStore.ts` (`useGameStore`, `takeJob`),
  `gameLoop.ts` (`submitAction(text, gift, preset)`, `saveMemoryEdits`, `dismissStatusModal`,
  `retryTurn`, `abandonTurn`, `retryClassify`, `retryEndingCall`, `manualSaveOffer`,
  `writeManualSave`), `slotActions.ts` (`slotActionsNow`), `textingLoop.ts`
  (`answerHangout`, `beginHangout`, `acceptFriendRequest`, `deliverBossMessage`), `timetable.ts`
  (`charUnavailableNow`), `loop/state.ts` (`loopState.openingWait`, `hangoutPrefetch`,
  `memoryGate`), `loop/saves.ts` (`writesPending`), `bunnyboardStore.ts` (`armedHangout`,
  `closeApp`), `uiStore.ts` (`view`, `error`, `fatalError`), `prompts/gameDate.ts`
  (`shiftWeekdayOf`), `shared/jobs.ts` (`jobDefOf`, `offeredShifts`, `classSlotForShift`,
  `shiftSlotOf`, `globalSlotOf`, `unmetStatKeys`) and `shared/relationship.ts` (`affectionFor`).
- The bridge: `window.api.saves.read(id, saveId)`, a `Result` (`{ ok, data: { save, record } }`).
  A manual save's id is `manual` and its slot padded to two digits.

## Traps

- **CSP is fine as it is.** `src/web/index.html`'s `connect-src` already allows
  `http://127.0.0.1:*`, so the mock runs on `127.0.0.1` with no CSP edit.
- **CORS is not.** The page (`http://localhost:<port>`) is cross-origin from the mock, and
  `Content-Type: application/json` is not a CORS-simple header, so every `POST` is preflighted.
  The mock must answer `OPTIONS` and stamp the CORS headers on every response, streamed and error
  paths included. A path missing them breaks only that call kind.
- **`fill()` doesn't reach these fields.** They are React-controlled. Click or focus the field and
  use `page.keyboard.type`.
- **Tab does nothing.** The app swallows a captured Tab, so a field is blurred by clicking the next
  field or inert text.
- **The classifier's cast list has no enum.** The valid charKeys are only in the prompt's roster
  block, so a mock has to parse them from there.
- **`page.evaluate` takes exactly one argument.** Bundle several into an object. The web build's
  CSP also forbids `eval`/`new Function` inside the page, so pass data, not code.
- **A restarted or hot-updated vite hands `/@fs/` imports a second module instance.** After HMR
  the app holds a `?t=`-stamped module and a bare import gets a fresh one whose `getState()` is
  blank. The runner exits 1 when the game is on screen but its store reads no playthrough. Start
  vite fresh and leave `src/` alone during a run.
- **A screen behind a crossing is `inert`, and a DOM click on it is dropped.** The menu is inert
  while its curtain lifts, so `#menu-quickstart` clicked too early does nothing.
  `clickWhenLive` waits for the element to be enabled and out from under `[inert]`.
- **Registrar picks are per slot, and Finalize checks the whole mix.** It wants at least three
  courses that are not PE and at least one PE course, at most seven. The harness names each slot
  and each code rather than taking whatever row comes first.
- **A forced click can double-submit.** `page.click('#game-submit', { force: true })` gets past
  Go's breathing animation by synthesizing a pointer sequence that Motion's tap gesture answers as
  well as `onClick`. One DOM click (`$eval(..., el => el.click())`) submits once. The same goes
  for every Motion button, which never reads as stable to Playwright's actionability checks.
- **A ready read can flicker.** The well has been seen enabled for one frame mid-stream, so a
  landing or a decision point counts only when it reads ready on two ticks in a row, and only
  with `pendingLines === 0`, `!busy`, `!streaming` and `!waitingForLine`.
- **Every streamed line waits behind a 3-second reply floor.** `REPLY_FLOOR_MS` holds preview lines
  back from `pendingLines` until 3 s after the turn began, so a fast mock's reply arrives in one
  flush at the floor. Allow for it in any timing.
- **An off-screen text-fit probe wears the same class as the real line.** `views/boxRows.ts` mounts
  a hidden `.vu-box-line` under `#root` and rewrites it out of display order. Scope line queries
  to `.vu-box:not([aria-hidden="true"])`.
- **A snapshot and a click are two round trips.** The first opening line can arrive between them,
  so a click decided on a stale snapshot would pass it. The advance click checks the store itself,
  in the same page task, and holds on an owed slot's opening narration.
- **Day 0's day half opens a scene by itself.** After the authored arrival scroll, the
  orientation scene is cast and sent with no classifier and no action typed. The first landing
  is day 0's night half, the tutorial slot.
- **The phone blocks the landing.** While the Bunnyboard is open the landing's chips do nothing,
  and saying Yes to an invitation opens it. `acceptHangout` Begins the hangout, which shuts the
  phone, and the runner shuts a phone left open before it acts.
- **Naming a girl has three gates.** A sentence carrying the first name of a girl whose name he
  does not know is refused before the classifier. A named girl needs `nameKnown` and
  `flags.gaveContactInfo`, and one who is `charUnavailableNow` is "busy". Each refusal is a
  `CLASSIFIER_REJECTED` turn error.
- **An exam with no recorded factoids has no questions.** Factoids are filed from week 2 on. A
  paper with nothing to ask is handed in on the click that opens it, so no quiz call goes out.
- **A killed driver leaves nothing behind.** Chromium exits when its pipe to the driver closes, so
  the same profile relaunches. `pkill` does not exist in Git Bash: find a port's owner with
  `netstat -ano | grep :5199` and end it with `taskkill //PID <n> //F`.
- **"You have Reduced Motion enabled" in `console.log` is expected**, from Motion. The runner
  launches with reduced motion, which the app honours for its own transitions.

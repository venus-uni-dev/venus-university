# Test playthrough

A Quickstart playthrough played from the first day to the night before graduation by a scripted
reader against a mocked writer, kept here so a release can be checked against saves from deep in
the semester without anybody playing a hundred days first. Nothing in it is hand-edited: the
folder is what the game itself wrote, captured as it was written.

The reader started Unremarkable on every stat with $100, as Quickstart starts everyone, and
enrolled in PED 140 (Monday day), ARH 101 (Tuesday day), LIT 330 (Wednesday day), MUS 180
(Thursday day, a project class) and MSC 112 (Thursday night). He took the Fast Eats job in week
one on shifts Friday day and Sunday day and worked every shift. He spent his free slots alone in his room until
each stat reached Good, then on the contacts he had made, dating one of them. He never opened the
phone except to accept invitations, so the threads hold the bots, the invitations and nothing else.

## The saves

`1790392968199/` is one playthrough folder, exactly as `data/saves/<id>/` holds one: `playthrough.json`
and seven manual saves. Each was taken on the first line of its slot's opening, so loading one
reads that opening and lands, as Continue would from the slot's own save; being manual saves,
nothing the tester plays afterwards can prune them.

| Save | In-game | Stands on | Brain / Body / Heart | Money | Contacts | Lover |
|---|---|---|---|---|---|---|
| `manual01.json` | day 8, day slot | Tuesday January 27, week two: the landing offers ARH 101 to attend and the MUS 180 project to work on | 6 / 8 / 6 | $260 | 2 | none |
| `manual02.json` | day 43, day slot | Tuesday March 3, midterm week: ARH 101 sits its midterm in this slot, so the landing offers it to attend or skip | 39 / 37 / 36 | $1,309 | 9 | none |
| `manual03.json` | day 51, day slot | Wednesday March 11, mid spring break | 45 / 44 / 43 | $1,563 | 9 | none |
| `manual04.json` | day 57, day slot | Tuesday March 17, the week after spring break | 49 / 50 / 50 | $1,853 | 9 | none |
| `manual05.json` | day 113, day slot | Tuesday May 12, finals week: ARH 101 sits its final in this slot | 89 / 85 / 95 | $4,095 | 9 | Celest |
| `manual06.json` | day 118, night slot | Sunday May 17, the night before the finals scores post: the next opening, Monday May 18, builds the scores scroll from the save's class records | 89 / 86 / 104 | $4,415 | 9 | Celest |
| `manual07.json` | day 122, night slot | Thursday May 21, the night before graduation: one advance reaches graduation morning | 91 / 90 / 109 | $4,381 | 10 | Celest |

`manual01` and `manual02` carry no exam scores (`manual02` stands on the first graded exam, not
past it); from `manual03` on every midterm score and the midterm showcase are frozen; `manual06`
and `manual07` carry every final score too, `manual06` with `finalsScoresShown` still false, since
the scroll that reports them belongs to the following Monday's opening, and `manual07` after it.
Each save replays its opening with no writer call, then lands, so the landing, the calendar, the
phone and the profile can be checked without a key; anything past the landing needs one.

`backup.zip` is the same playthrough in the app's backup format, for the browser build: only the
record and the seven saves, with factory settings (no key) and empty grab bags.

## Using it

- **Desktop**: `node testsave/harness/install.mjs --target <install>/data/saves` copies the folder
  in (it refuses to write over an existing one) and `--remove` takes it out again. The default
  target is this repo's own `data/saves`, which is the dev app's.
- **Browser build**: Settings → Restore from backup → `testsave/backup.zip`. A restore replaces
  every save and every setting the browser holds, so do it in a fresh or throwaway profile only.

## Regenerating it

Saves are refused after any change to `SAVE_SCHEMA_VERSION` or `RECORD_SCHEMA_VERSION` (there is
no migration), so the folder has to be regenerated then, and `harness/README.md` says how: a mock
endpoint, a fresh vite on its own port, and `semester.mjs`, about an hour unattended. Then
`makeBackup.mjs` rebuilds the zip, `validate.mjs` checks the folder and the zip against the shared
validators and the facts above, and `restoreCheck.mjs` proves the zip restores in the browser
build. Delete the old numeric folder first: the tools expect exactly one.

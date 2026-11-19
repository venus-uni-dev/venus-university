# Characters' relationships with each other — design plan

Status: design agreed over four rounds of questions on Nov 11–12 2026. Nothing here is built.
It replaces the earlier `npcromance_plan.md`; what came over from it and what did not is listed
at the end.

This file is the whole deliverable of the planning session; it sits in the tree uncommitted.

## Context

Characters already become friends and enemies through one number per pair. Now that the roster
can hold guys, this plan lets characters fall for each other, date and break up, and gives the
reader a place in it: a taken character who refuses him while she is happy, an affair that
costs something, and texts through which he can nudge other people's relationships.

Two constraints shaped every choice:

- **Simple wherever the player cannot feel the difference.** One number per pair stays the
  whole engine. There is no satisfaction ladder, no affair between two characters, no
  simulated sex.
- **Computed, not judged.** Every outcome is a roll in `src/shared/odds.ts` or a rule over
  flags. The one new thing asked of the model is a ledger milestone.

## What the player should feel

- **The campus has a love life.** The feed says who got together; a contact's page says who
  she is dating and, once she trusts him, who she likes.
- **A taken character is closed while she is happy** and opens when things turn rocky.
- **An affair has a price.** Her partner finds out through the same rumor network that
  catches him today, the couple turns rocky, and her partner holds it against him.
- **He can meddle.** A trusted contact vents about her partner or asks whether to act on a
  crush, and his answer moves the pair.

## The model

### State

On the pair entry in `npcRelationships` (`src/shared/npcRelationships.ts`), every field optional:

| Field | Meaning |
|---|---|
| `crush` | Which of the two holds a crush on the other |
| `crushAsked` | Which of those crushes has already been taken to the reader for advice |
| `dating` | The date they got together |
| `ended` | The date they last broke up |
| `cheated` | Who has been found cheating on the other; never cleared |
| `encounter` | The pair's last event, as today, with more kinds (below) |

Beside `npcFriendships`, a permanent `npcCouples` log of every getting-together with its slot,
which is what the feed reads.

### Terms

- **Taken**: in at least one pair with `dating`.
- **Open**: a Promiscuous character, unless she is the reader's lover and has agreed to a
  closed relationship. An open character may date several characters and the reader at once.
- **Happy**: inside the honeymoon, or the pair is friends (4 or more). **Rocky** otherwise.
- **Cheating** exists only in a couple where neither of the two is Promiscuous.
- **Free to date**: single, or open.

### Attraction

- Between two characters, each one's settled sexuality decides (`CharProfile.attractedTo`,
  else her record). The reader's "All attracted" level adds nothing here.
- The romance stepper gains a fourth level: everyone of that gender is attracted to the
  reader and to every other character.
- A crush needs attraction both ways, so nobody pines for somebody who could never return it.

### Crushes

- **When.** After a good meeting of a pair that stands at 0 or above and is not a couple: an
  off-screen encounter that went well, or a scene both left liking the reader. A first
  meeting does not count.
- **Who rolls.** Each side separately, where she holds no crush on the other yet. The
  reader's lover never rolls unless she is open.
- **Odds.** 5%, ×1.5 for a Good-natured target or a Promiscuous holder, ÷1.5 for a
  Disagreeable target or a High Standards holder, ×0.1 for a holder who is taken and not open.
- **Several at once** are allowed and none expires.
- **It ends** when the pair falls below 0, when its holder enters a relationship (an open
  holder keeps her others), on "Definitely not", on being turned down, or when either graduates.

### Couples

- **Getting together.** A good meeting of two who both held a crush before it and are both
  free to date: 50%.
- **What it clears**, for a member who is not open: her other crushes, her crush on the
  reader and her friends-with-benefits standing with him.
- **Honeymoon, 14 days.** A bad meeting leaves the number where it is, nothing can end the
  relationship and nobody vents.
- **Breaking up.** After the honeymoon, each bad meeting that leaves the pair below friends
  rolls 25%: ×1.5 if either is Disagreeable or High Standards, ÷1.5 if either is Good-natured
  or Promiscuous, ×3 if either holds a crush on somebody else, the reader included. It costs
  the pair nothing more. The feed does not report it.
- **Together more.** Ahead of the friends' pass of the slot's overlay, each couple with both
  free and at least one with nowhere to be rolls 50%: that one joins the other where they
  are, or in one of their rooms.
- **Seen together.** Each slot a couple spends in one group rolls 10%. One character with a
  crush on either, picked at random, takes a step down with the partner. A Promiscuous
  admirer resents nobody.
- **Colds.** Lovers who meet count as a private scene (60%), not a hangout (24%).

### Long-distance

- A couple with one graduate takes no meetings. At each night's ending it rolls 50% for a
  step, good 40% of the time; a bad step below friends rolls the usual break-up. The
  honeymoon does not apply.
- The one on campus stays loyal while the pair is still friends, and may vent.
- Two graduates are left as they stood.

### The pair's last event

Today `encounter` holds "bonded" or "argued" at a place, newest overwriting, mentioned for
seven days. Both rules stay; the vocabulary grows, and an event may name who felt it:

| Event | Reads as |
|---|---|
| Got together | "Ren and Celest started dating on Tuesday." |
| Broke up | "Ren and Celest broke up yesterday." |
| Jealousy | "April disliked seeing Celest together with Ren today." |
| Affair found out | "Ren found out that Celest cheated on him." |
| A friend's view of it | "Mina disliked that Celest cheated on Ren." |
| Turned down | "Dorien turned April down on Monday." |

## The reader's side

- **Loyal while happy.** A taken character who is not open and is happy is told she won't
  make or accept romantic advances from anyone else, and no crush on the reader is rolled.
- **Rocky.** The line goes, and her crush on him rolls at ×0.1.
- **An affair.** A kiss or a night with a taken character is cheating where neither she nor
  her partner is Promiscuous. `rumorPass` (`src/shared/rumors.ts`) already decides who saw it
  and who they told; her partner joins those who take it personally:
  - the pair drops 4 if he saw it and 2 if he heard, the honeymoon ends, and `cheated`
    records her;
  - he files a permanent memory against the reader, hated if he saw and disliked if he
    heard, as the reader's own lovers do;
  - each of his friends who sees or hears it takes a step down with her.
- **Rivals.** A character with a crush on her files the jealousy memory the reader's own
  crushes file when he is seen with her, and when he starts dating her.
- **Becoming his lover** ends every relationship she has with a character, unless she is
  open, as `settleDating` (`src/shared/dating.ts`) already leaves his own lovers. Each
  partner left files a hated memory of the reader. A hand edit on her page runs the same pass.
- **A closed relationship.** A new ledger milestone, for a lover who shares: she agreed to
  see only the reader. It turns her sharing off, ends her relationships with characters at no
  cost to anybody, and clears her crushes. `agreed_to_harem` reverses it. Edit milestones
  unlocks the sharing box for a Promiscuous character.

## The texts

Both are rolled on their own, outside the reach-out's roll and its quiet, and written by the
slot opening's call as a reach-out with a new topic. One a slot at most, a vent first. The
sender is on the roster, a contact who has not blocked him, trusted or warmer, and texting
him about nothing else that slot.

**Venting.** Each argument past the honeymoon, a long-distance bad step included, rolls 25%
for each of the two who qualifies. Her thread stands three buttons:

| Button | Effect |
|---|---|
| "You should break up." | A step down that counts as an argument: below friends it rolls the break-up |
| "You should talk things out." | A step up |
| "That sucks." | Nothing |

**Advice.** Each slot rolls 3% for a character who is free to date, holds no crush on the
reader, and holds a crush not yet asked about on a roster character who is free to date. Each
crush is asked about once.

| Button | Effect |
|---|---|
| Yes | A mutual crush becomes a couple. Otherwise the other accepts on 33%, ×1.5 if Promiscuous, ÷1.5 if High Standards. A refusal ends her crush and costs the pair a step |
| "I don't know..." | Nothing |
| "Definitely not." | Her crush ends |

**How a button lands.**

- It sends that line as his text, and she answers through the ordinary texting call.
- Its effect is taken at the slot's ending with the other pair rolls, so the boundary still
  only assigns.
- A footer left standing lapses at the slot's end and costs nothing.
- **She texts how it went** with the next slot's opening: after a Yes, either way, and after
  "You should break up." only when that step ended the relationship.

## What the writer is told

All in the existing places.

| Where | Line | When |
|---|---|---|
| Pair line, and an absent character's standing sentence | "Ren and Celest are dating." | In place of the zone |
| | "…are dating, but things are rocky." | Rocky |
| | "Ren and Celest used to date." | After a break-up |
| | "April has a crush on Ren." | Each way it holds |
| | "Celest has cheated on Ren before." | Once found out, for good |
| | The last event | For seven days |
| Her own entry | "Celest is dating Ren Takeda." | Always |
| | "Celest won't make or accept romantic advances from anyone else." | Happy and not open |
| | "Celest has a crush on Dorien Vale." | She is trusted or warmer with the reader |
| Behaviour toward the cast | Her own "With a lover…" or "Around a crush…" string | Her partner or her crush is in the scene |

The ledger's cast block carries none of it.

## What the player sees

- **Feed**: "Ren and Celest are now dating.", under the friendship row's visibility rule.
- **Contact page**: a Dating chip beside Friends, a Crush chip once she is trusted or warmer,
  and a dated "Started dating Ren." among her posts.
- **Her thread**: the three-button footers.
- **The romance stepper**: the fourth level and a sentence in its note.
- **New Game's Profiles and the Scene Creator**: the pair select gains "Dating", offered
  where the two are attracted to each other; such a pair starts as friends, past its honeymoon.
- **The milestone screen and Edit milestones**: the closed relationship.

## Numbers

All to live in `src/shared/odds.ts`.

| Constant | Value |
|---|---|
| Crush on a good meeting | 0.05 |
| Trait multiplier, wherever a trait tilts a roll | 1.5 |
| Crush odds while taken | ×0.1 |
| Mutual crush becoming a couple, per good meeting | 0.5 |
| Honeymoon | 14 days |
| Break-up per argument below friends | 0.25 |
| Break-up while holding a crush on somebody else | ×3 |
| A lover joining the other's evening | 0.5 |
| Seen together, per slot together | 0.1 |
| Long-distance: a step that night / it goes well | 0.5 / 0.4 |
| Affair found out: seen / heard / her partner's friend | −4 / −2 / −1 |
| Vent per argument | 0.25 |
| Advice per slot | 0.03 |
| Accepting a confession that is not mutual | 0.33 |
| Lovers meeting, for colds | 0.6 |

### What simulation showed

The real store and schedule code loaded from `testsave/…/manual01.json`, the rules above
prototyped over `settleNpcPairs`, four terms a run, terms 2 to 4 averaged over sixteen runs.
The chosen settings, per term:

| Roster | Crushes | New couples | Break-ups | Couples at once | Taken, of 12 | Loyal at once |
|---|---|---|---|---|---|---|
| 6 girls, 6 guys | 14 | 3.2 | 2.7 | 2.7 | 4.9 | 2.8 |
| 9 girls, 3 guys | 9 | 2.4 | 2.0 | 1.9 | 3.3 | 1.6 |
| 12 girls, 3 bisexual | 1.4 | 0.4 | 0.2 | 0.4 | 0.7 | 0.3 |
| 12 on the new level | 24 | 5.0 | 4.2 | 4.1 | 6.5 | 3.4 |

- A couple lasts a median 60 days, the middle half 31 to 116; a term is 123.
- About one crush stands per character at any time.
- A couple past its honeymoon argues about 9 times a term, so 25% is two or three vents a
  term from each trusted contact who is dating.
- Break-up odds between 25% and 50% barely matter: the wait is for the pair to slip below
  friends and then argue.
- A long-distance couple that was friends at the ceremony lasts a median 20 days, the middle
  half 10 to 34.

Not in that run, so to confirm: the reader's side, the texts, the long-distance step,
Promiscuous easing a break-up, and the cold contact. The test roster holds 4 Promiscuous of
12 against the shipped cast's 7 of 30, and the reader was synthetic.

## Stages

Each is playable and verified before the next.

### Stage 1 — between characters

- `src/shared/npcRelationships.ts` — the pair fields and the event kinds; crush, couple,
  honeymoon and break-up inside `settleNpcPairs`; a pure long-distance step; a crossing
  detector for the log, as `newFriendships` is.
- `src/shared/odds.ts`; `src/shared/types.ts` (`RomanceLevel`, `npcCouples` on `GameSave`);
  `src/shared/saveRules.ts`; `src/shared/relationship.ts` (attraction between two characters,
  the level read leniently).
- `src/renderer/stores/npcOverlay.ts` and `stores/loop/npc.ts` — the couples' pass, and
  seen together off the slot's groups.
- `stores/gameLoop.ts` — the ending banks it in `fetchEndingOpening`; the boundary assigns
  and records, as it does friendships. `stores/loop/exams.ts` for the quiet ending.
- `src/shared/colds.ts` — lovers as a closer contact.
- `prompts/npcRelationship.ts` (`pairLine`, `npcStandingLine`, `npcBehaviorLines`),
  `scenePrompt.ts` (`castBlock`), `lorebook.ts`, and the texting, slot-opening and
  ending-posts builders that describe her in full.
- `BunnyboardModal.tsx`, `stores/feedView.ts`, `ContactPage.tsx`, `RomanceModal.tsx`.
- `stores/semesterCarry.ts`, `semesterStart.ts`, `NewGameView.tsx` — the dates move, a crush
  on or of a graduate ends, the log starts empty.

### Stage 2 — the reader's side

- `prompts/relationship.ts` — the loyal line beside the stat-gate one.
- `stores/loop/crushes.ts` — no roll while she is happy, ×0.1 while rocky.
- `src/shared/rumors.ts` — her partner, his friends and her admirers as stakes.
- `src/shared/dating.ts`, `src/shared/milestoneEdit.ts` — leaving her partners; the unlocked
  sharing box.
- `src/shared/relationship.ts`, `prompts/scenePrompt.ts` (`eventGlossOf`),
  `prompts/textLedgerPrompt.ts`, `MilestoneModal.tsx`, `EditMilestonesModal.tsx` — the closed
  relationship, appended to each vocabulary.

**Built Nov 13 2026.** Decided while building it, over the plan above:

- `cheated` holds who was found cheating and the day it was last found out. Only a relationship
  that began on or before that day loses its honeymoon, so a couple back together later has one.
- A closed relationship drops every other lover of both, with full penalties: the reader's other
  lovers are left as the dating pass leaves one (sharing ones too), their break-up texts saying he
  chose her, and her character partners are left as when she becomes his lover. It counts only
  for a lover who shared him before, or one who starts out on it.
- A Promiscuous lover who closed is told "X has agreed to see only the reader."
- Unticking Sharing by hand stays a plain flag change, as every other untick is; the box is live
  for a met Promiscuous character.
- The reader-crush gate was already built in Stage 1.

### Stage 3 — the texts and the setup screens

- `prompts/slotIntroPrompt.ts`, `stores/gameLoop.ts` — the new reach-out topics and who is
  rolled for them.
- `src/shared/types.ts` (`Conversation`), `stores/textingLoop.ts`, `BunnyboardModal.tsx` —
  the footer, modelled on `pendingHangout` and `answerHangout`, and the answer the ending reads.
- `NewGameProfiles.tsx`, `src/shared/sceneCreator.ts`, `SceneRelationshipsModal.tsx`.

**Built Nov 13 2026.** Decided while building it, over the plan above:

- Dating is offered on every pair whatever the two's sexualities, and adds each one's partner's
  gender to her sexuality: for the playthrough at New Game and New Game+, for the scene in the
  Scene Creator. It is offered only where both may still date once the other picks (and a New
  Game+'s carried couples) are laid; a pick that can no longer hold reads and plays as friends
  without being rewritten.
- A love-life text, follow-ups included, carries the reach-out mark. An ignored vent files her
  texting memory "the reader ignored her when she wanted to vent" and one status line at the
  ending; an ignored question about a crush costs nothing; a vent from somebody cast in the
  scene is not ignored.
- The footer replaces the composer until he picks one of its three lines.
- "You should break up." does not itself roll a vent; a couple that broke up in its argument
  does not vent; no ordinary reach-out on a slot a love text goes out.
- A follow-up may go to a girl in class or at work; a vent or a question may not.
- A Yes needs the two attracted to each other as well as free to date.
- The settle reports `argued` in place of a long-distance event.
- The exam starts no scene, so a footer standing through an exam slot comes down at the boundary
  with no memory.

## Settled without asking

Rules I chose so the design closes. Each is easy to change.

- A first meeting rolls no crush, and a crush needs the pair at 0 or above.
- An argument inside the honeymoon is still recorded as the pair's last event.
- A crush on the reader counts as a crush on somebody else for the ×3.
- Having agreed to share the reader does not make her open to characters; only Promiscuous does.
- A Promiscuous admirer resents nobody, seen together or as the reader's rival.
- A partner left for the reader files the same hated memory a rival does, and the pair is
  not moved.
- A Yes whose crush is no longer free to date by the slot's end is void: nothing happens and
  she texts nothing.
- A graduate never vents or asks advice.
- A pair set to Dating at setup has no honeymoon.
- Every new field is optional, so an older save reads as a campus with no romance yet.
- Button and stepper wording is drafted against the existing copy when it is built.

## The earlier plan

**Came over:** the pair as the place state lives, the log beside `npcFriendships`, the feed
row and its visibility rule, the contact chips, the fourth stepper level, the setup screens,
rivals, her partner's grudge, long-distance, and the prompt lines.

**Did not:**

| Idea | Why not |
|---|---|
| The satisfaction ladder | The pair's zone and the honeymoon say the same with no new state |
| Affairs between two characters | A taken character's new crush only makes her likelier to leave |
| The leave roll | Loyal while happy, open when rocky, replaces it |
| A nightly step for every couple | Lovers meeting more gives the pace: a 60-day median |
| A crush that expires | Left standing; about one per character |
| Sleeping together | Not interesting to simulate; only the cold contact was kept |
| Break-up rows on the feed | He hears it from the prompts, her page and her texts |
| A friend's text and BunnyBot's tip about his lover straying | His lover never strays |

## Verification, when it is built

- **Confirm the numbers on the real code.** Rerun the chosen settings as a real-store Monte
  Carlo over four terms and the four rosters above, and table couples formed, break-ups,
  couples at once, the share taken and loyal, median life, vents and advice texts a term.
- **Prompts.** Build every prompt before and after each stage. With no crush or couple on
  the save they must be byte-identical; with them, differ only in the lines above.
- **In the browser build against the mock**, seeding pair state through the store: the feed
  row and its visibility, the chips at friendly and at trusted, the loyal line and its
  lifting once rocky, an act seen by her partner, a new lover leaving her partner, the closed
  milestone on a Promiscuous lover, each footer button through to the follow-up text, a
  boundary replayed to the same values, and a Continue carrying a couple and a graduate's
  couple into the next term.
- **Tests**, kept to what a save is computed from: the settle as invariants over many runs
  (one partner unless open, a honeymoon never ends or lowers, no crush on a graduate), the
  boundary applying twice to the same result, the carry moving the new dates. No test of
  wording.
- `npm run typecheck` and `npm test` pass at each stage; `DESIGN_GUIDE.md` gains the
  mechanic under Whereabouts, Romance, Rumors and The Bunnyboard as each stage lands.

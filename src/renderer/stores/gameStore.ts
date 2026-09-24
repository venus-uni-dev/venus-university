import { create } from 'zustand'
import {
  affectionFor,
  emptyFlags,
  foldRelationshipEvents,
  MEMORY_CAP,
  refreshedFlags,
  withMemoryReplaced
} from '@shared/relationship'
import { escapeRegExp } from '@shared/sentences'
import { displaySlotsOf, retireCgs } from './stageDisplay'
import {
  chargeAbsences,
  lastReaderIndexOf,
  lineEditable,
  PORTRAIT_SLOTS,
  rewindTargetOf,
  stageAt,
  stageFactsOf,
  stepStage,
  type StageContext
} from './stageStep'
import type { MemoryEditRow } from './loop/memoryEdit'
import type { StatusModal } from './loop/statusSteps'
import { noNsfwImagesOf, useSettingsStore } from './settingsStore'
import {
  applyStatDeltas,
  DEFAULT_PLAYER_STATS,
  type PlayerStats,
  type StatKey,
  type StatTier
} from '@shared/playerStats'
import { STARTING_MONEY } from '@shared/money'
import { emptyTallies, talliesAfterActs, type ReaderTallies } from '@shared/tallies'
import { FALLBACK_DORM } from '@shared/dorms'
import {
  giftMemoryCapFor,
  giftMemoryDesc,
  giftReactionOf,
  itemDefOf,
  withGiftMemory,
  type GiftReaction
} from '@shared/shop'
import type { GameOverReason } from '@shared/gameOver'
import type { Weather } from '@shared/weather'
import { MAX_RAISES, newJobState, RAISE_EVERY } from '@shared/jobs'
import type { ExamPeriod } from '@shared/academics'
import type { DatingPassOutcome } from '@shared/dating'
import type {
  NpcFriendship,
  NpcRelationshipMap,
  NpcSlotOverlay
} from '@shared/npcRelationships'
import {
  charKeyOf,
  DEFAULT_PLAYER_FIRST_NAME,
  DEFAULT_PLAYER_LAST_NAME,
  emptyBunnyboard,
  READER_SPEAKER,
  type AppError,
  type BunnyboardState,
  type CalendarEvent,
  type CharMemory,
  type CrushHint,
  type ChatMessage,
  type RelationshipEvent,
  type Suspicion,
  type Character,
  type CharInfo,
  type CharProfile,
  type CharState,
  type ClassEntry,
  type ClassMeetingRecord,
  type FeedExtras,
  type SocialPost,
  type ClassRecord,
  type AddedClass,
  type BankedTextLedger,
  type BunnybotHandover,
  type DroppedClass,
  type ExamRecord,
  type QuizState,
  type Conversation,
  type GameHistory,
  type GameSave,
  type IntimateAct,
  type PlaythroughRecord,
  type JobState,
  type Occasion,
  type OwnedItem,
  type SceneGift,
  type ShiftSlot,
  type OutfitLock,
  type OutfitSet,
  type Position,
  type SceneLine,
  type SpriteRef,
  type SceneState,
  type SceneSummaryMark,
  type SlotRumor,
  type TimeSlot
} from '@shared/types'

/** The portrait slot count, for the callers that read it off the store. */
export { PORTRAIT_SLOTS }

/** What a character is called before the reader has learned her name. */
export const UNKNOWN_NAME = '???'

/** How often the first happy expression of a turn throws sparkles off her. */
const HAPPY_SPARKLE_CHANCE = 0.5

/** Whether one first-happy-of-the-turn wins its sparkle. */
function rollsSparkle(rand: () => number): boolean {
  return rand() < HAPPY_SPARKLE_CHANCE
}

/**
 * What kind of scene is being cast, as `setCast` takes it: the scene-scoped facts the opening
 * classifier verdict decides.
 */
export interface SceneKind {
  /** The class the scene sits in — a `goto_class:` verdict, or an exam. */
  classCode?: string | null
  /** The course a work session is for — a `project:` verdict. */
  projectClass?: string | null
  /** The job a shift belongs to — a `job` verdict. */
  jobId?: string | null
  /** The charId an epilogue goodbye is with — never a verdict at all. */
  farewell?: string | null
  /** The charId whose thread the slot's texting ledger must not read. */
  textLedgerSkip?: string | null
  /**
   * The charIds whose invitation this scene left unanswered: their threads the texting ledger
   * must not read either, and one line each at the ending.
   */
  ignoredInvites?: readonly string[]
  /** The charIds he turned down by text, whose memory this scene filed. */
  turnedDownInvites?: readonly string[]
  /**
   * The employer whose premises the scene is on because a *character* is working there.
   * Never set beside {@link jobId}.
   */
  visitJobId?: string | null
  /** The stats the shift's rolled gain moves, when the employer has more than one to roll. */
  jobStats?: readonly StatKey[]
  /** Roster charIds the action named without bringing along. */
  mentions?: readonly string[]
  /** Where the classifier set the scene, in its own words. */
  location?: string | null
  /**
   * The scene is somewhere people could see them — the witness roll's input.
   * Absent means public.
   */
  inPublic?: boolean
}

/** The scene-kind facts a `set` writes onto the store, unpacked from one verdict. */
function sceneKindFields(scene: SceneKind | null | undefined) {
  return {
    sceneClass: scene?.classCode ?? null,
    sceneProject: scene?.projectClass ?? null,
    sceneJob: scene?.jobId ?? null,
    sceneFarewell: scene?.farewell ?? null,
    sceneTextLedgerSkip: scene?.textLedgerSkip ?? null,
    sceneIgnoredInvites: [...(scene?.ignoredInvites ?? [])],
    sceneTurnedDown: [...(scene?.turnedDownInvites ?? [])],
    sceneVisitJob: scene?.visitJobId ?? null,
    sceneJobStats: [...(scene?.jobStats ?? [])],
    sceneMentions: [...(scene?.mentions ?? [])],
    sceneLocation: scene?.location ?? null,
    sceneInPublic: scene?.inPublic ?? true
  }
}

/**
 * Live game state: persisted `GameSave` fields plus transient playback fields.
 * `gameLoop.ts` drives this store imperatively outside React.
 */
interface GameStoreState {
  /** The playthrough being played; every save this session writes goes into it. */
  playthroughId: string | null
  date: number
  time: TimeSlot
  /** charIds loaded into the current save. */
  chars: string[]
  /** The reader's own name, chosen at New Game and fixed for the playthrough. */
  playerFirstName: string
  playerLastName: string
  /** The reader's three stats in points; the panel and the prompt derive tiers. Persisted. */
  stats: PlayerStats
  /**
   * The reader's balance in dollars. Persisted, shown as a number, and
   * allowed to go negative — far enough and the playthrough ends.
   */
  money: number
  /**
   * The reader's own words about himself, written at New Game and rewritten on his profile.
   * Persisted; blank where he wrote nothing.
   */
  bio: string
  /**
   * Lifetime counts about the reader — money earned, kisses, nights, shifts worked. Moved only
   * in boundary passes, so a replay credits each of them once. Persisted.
   */
  tallies: ReaderTallies
  charInfo: Record<string, CharInfo>
  /** The save's class roster, keyed by class code. Generated once, never changed. */
  classes: Record<string, ClassEntry>
  /**
   * The player's own timetable: `ClassSlot` → class code. Changeable through VenusBot up to
   * the add/drop deadline, fixed after it.
   */
  playerSchedule: Record<number, string>
  /** The playthrough log — every finished scene's summary, by day and slot. Persisted. */
  history: GameHistory
  /** The Bunnyboard app: conversations, friend requests and badges. Persisted. */
  bunnyboard: BunnyboardState
  /** Plans the reader has made, oldest first. Persisted. */
  events: CalendarEvent[]
  /** The occasions this playthrough invented. Persisted; write-once at New Game. */
  occasions: Occasion[]
  /** The occasions he turned down an invitation to, or let one stand. Persisted. */
  occasionsDeclined: string[]
  /** The part-time job the reader holds, or null. One at a time. */
  job: JobState | null
  /** Job ids he was fired from or quit; those employers never post again. */
  jobsClosed: string[]
  /** The slots each all-hours employer is not offering this playthrough. */
  jobClosures: Record<string, ShiftSlot[]>
  /** Every slot's sky, read off the record and never rewritten. */
  weather: Weather[]
  /** What the reader has bought and not yet given away. Persisted. */
  inventory: OwnedItem[]
  /** What each of his classes has accumulated, keyed by class code. Persisted. */
  classRecords: Record<string, ClassRecord>
  /** His academic reputation once a whole round of assessments is in. Persisted. */
  gradesStanding: 'good' | 'bad' | null
  /** Whether he has been caught at an expellable offense. Persisted; one-way. */
  expelled: boolean
  /** One-shot guards on the two grade notifications. Persisted. */
  midtermStandingDone: boolean
  finalsScoresShown: boolean
  /** The global slot VenusBot's announcements are delivered through. Persisted. */
  venusThrough: number
  /** The same, for BunnyBot's two clock-owed messages. Persisted. */
  bunnybotThrough: number
  /** Whether the sidebar's two granted apps have been handed over. Persisted; one-way. */
  bunnymapUnlocked: boolean
  bunnyshopUnlocked: boolean
  /** One-shot guards on the five event-triggered bot messages. Persisted. */
  venusJobIntroSent: boolean
  bunnybotTwoTimingTipSent: boolean
  bunnybotSeenTipSent: boolean
  bunnybotContactIntroSent: boolean
  bunnybotFirstPostNudgeSent: boolean
  /** BunnyBot's handovers owed from before its own intro. Persisted. */
  bunnybotDeferred: BunnybotHandover[]
  /** Classes the reader dropped, keyed by code. Persisted; re-enrollment is barred. */
  droppedClasses: Record<string, DroppedClass>
  /** Classes the reader added at add/drop, keyed by code. Persisted. */
  addedClasses: Record<string, AddedClass>
  /** What the roster thinks of each other, keyed by `pairKeyOf`. Persisted. */
  npcRelationships: NpcRelationshipMap
  /** The first time each pair of them became friends, oldest first. Persisted. */
  npcFriendships: NpcFriendship[]
  /** Who is with whom this slot, stamped with the slot it describes. Persisted. */
  npcOverlay: NpcSlotOverlay | null
  /** What this slot's opening said was going on somewhere. Persisted. */
  slotRumor: SlotRumor | null
  /** Who shared the last finished slot's scene, stamped with it. Persisted. */
  lastSlotCast: { date: number; time: TimeSlot; charIds: string[] } | null
  /** Who has already been out this weekend → that weekend's Saturday. Persisted. */
  weekendOutings: Record<string, number>
  /** The same, per slot, for the one week the rule is per slot. Persisted. */
  outingSlots: Record<string, number>
  /** Who leaves campus for spring break, null until it is settled. Persisted. */
  springBreakAway: string[] | null
  /** The feed items belonging to today alone, stamped with it. Persisted. */
  feedExtras: FeedExtras | null
  /** The graduation narration has played. Persisted. */
  graduationSeen: boolean
  /** Who the reader has already said goodbye to. Persisted. */
  farewellsDone: string[]
  /** The graduation picture belongs to this epilogue. Persisted. */
  endingArtWanted: boolean
  /** Full character records for everyone in `chars`, keyed by charId. */
  characters: Record<string, Character>
  /** Derived charKey → charId map for translating LLM boundary values. */
  charKeyToId: Record<string, string>
  /** Currently cast charIds — fixed for the whole scene, not re-classified per turn. */
  cast: string[]
  /** The class code this scene is sitting in, or null when it is not a class scene. */
  sceneClass: string | null
  /** The course this scene's work session is for, or null when it is not one. */
  sceneProject: string | null
  /**
   * The job whose shift this scene is, by jobId, or null when it is not one. Scene-scoped
   * and persisted like {@link sceneClass}; puts the workplace's lorebook paragraph up.
   */
  sceneJob: string | null
  /**
   * The stats the shift's rolled gain moves, empty when the scene is not a shift or the
   * employer has one gain to roll. Scene-scoped and persisted like {@link sceneJob}.
   */
  sceneJobStats: StatKey[]
  /** The charId this scene is a goodbye to, or null when it is not one. */
  sceneFarewell: string | null
  /** The charId the slot's texting ledger skips, or null when it reads every thread. */
  sceneTextLedgerSkip: string | null
  /**
   * The slot's texting-ledger reply once it has landed, keyed on the message set it read; null
   * while the call is out or when nobody texted.
   */
  sceneTextLedger: BankedTextLedger | null
  /**
   * Who this scene stood up by never answering her invitation: the ledger skips their threads
   * too, and the ending says one line about each.
   */
  sceneIgnoredInvites: string[]
  /**
   * Whom he turned down by text before this scene, whose memories it filed at its start: the
   * ending says one line about each.
   */
  sceneTurnedDown: string[]
  /**
   * The employer whose premises this scene is on because a character is working there, or null
   * when it is not one.
   */
  sceneVisitJob: string | null
  /**
   * Who this scene is *about* without their being in it — the classifier's mentioned-only
   * list, resolved to charIds.
   */
  sceneMentions: string[]
  /** Where the classifier said the scene is set; scans the lorebook. */
  sceneLocation: string | null
  /** The scene is somewhere people can see them — the witness roll's input. */
  sceneInPublic: boolean
  /** The gifts given so far in this scene, oldest first. */
  sceneGifts: SceneGift[]
  /** The exam being sat this slot, or null when the slot is an ordinary scene. */
  sceneQuiz: QuizState | null
  /** The scene as delivered: the reader's action lines and every reply line, in order. */
  currentSceneTranscript: SceneLine[]
  /**
   * The running summary the last reply came with — the top of {@link sceneSummaries} — or null;
   * promoted to `history` at slot boundary.
   */
  sceneSummary: string | null
  /** The summaries in the order they landed, each with the transcript length it covers up to. */
  sceneSummaries: SceneSummaryMark[]
  /**
   * The scene has said its last word and is playing out its ending. Never captured: the loop
   * writes the ending onto a save itself.
   */
  sceneEnding: boolean
  /** The scene-end status sequence has been raised. **Transient** like {@link statusModal}. */
  statusShown: boolean
  /**
   * Bumped by every cut the view lands at once rather than types out: a line {@link rewindLine}
   * steps back to, or the shown line {@link editLogLine} rewrites. Transient.
   */
  lineRewound: number
  /** True while the engine is awaiting a player action. */
  awaitingInput: boolean
  /** The ending `beginSlot` opened this slot on, or null while the playthrough still runs. */
  activeGameOver: GameOverReason | null
  /** The graduation picture, as an object URL, once it exists. */
  endingArt: string | null
  /**
   * The object URL of the reader's own picture, or null where he has none. Never persisted:
   * `loop/profilePicture.ts` owns the URL behind it.
   */
  profilePicture: string | null
  /**
   * What the last goodbye said, kept for the log on the menu after the stage that held it is
   * cleared; never written to disk.
   */
  farewellLog: SceneLine[]
  /**
   * That picture is still being made — what the ending's last line and the game-over
   * modal wait on.
   */
  endingArtPending: boolean
  /** True while a classifier or scene call is in flight. */
  busy: boolean
  /** True while a scene call may still append lines; distinct from `busy`. */
  streaming: boolean
  /** True while the dialogue box is parked waiting for the next streamed line. */
  waitingForLine: boolean
  /** Failed wrap-up error; holds playback at scene end until the modal resolves. */
  closingError: AppError | null
  /** Failed ledger error; holds playback at scene end like `closingError`. */
  ledgerError: AppError | null
  /** Failed texting-ledger error; holds playback at scene end like `ledgerError`. */
  textLedgerError: AppError | null
  /** Failed slot-opening error; the last of the ending calls. */
  introError: AppError | null
  /** Failed player-turn error after rewind; drives retry or reword UI. */
  turnError: AppError | null
  /**
   * Failed classifier error, held while the turn waits inside `classifyAction` for the player to
   * retry or leave. The turn is still in flight: nothing has been rewound.
   */
  classifierError: AppError | null
  /** Text to seed the action input with — a rewind's hand-back of the player's own words. */
  inputDraft: string

  /**
   * The scene-end screen on the stage, if any — the rank-up or one girl's milestones.
   * **Transient**: never captured and never on disk, since nothing is written between
   * the status messages and the boundary, so a reload replays the sequence that raised it.
   */
  statusModal: StatusModal | null

  /**
   * The boundary's memory question while it stands, or null. **Transient** like
   * {@link statusModal} and never written to a save: the boundary is replayed from the ending's
   * save and asks again.
   */
  memoryEdit: readonly MemoryEditRow[] | null

  /** Scene lines not yet reached by playback. Consumed one per advance. */
  pendingLines: SceneLine[]
  /** The line currently on screen, or null before the first advance. */
  currentLine: SceneLine | null
  /** Current background base name, without the `_day`/`_night` suffix. */
  bg: string | null
  /** charIds occupying the three portrait slots, left to right; null = empty. */
  slots: Array<string | null>
  /**
   * Sticky per-character sprite reference, keyed by charId. A
   * {@link Position} sits here in place of an emotion while a CG is on screen.
   */
  emotions: Record<string, SpriteRef>
  /**
   * Which cast members have a full set of CGs on disk, by charId. Read at scene start and never
   * persisted.
   */
  cgReady: Record<string, boolean>
  /**
   * Which alternate wardrobes each cast member has fully rendered, by charId. Read and scoped
   * like {@link cgReady}; a partly rendered set does not appear here.
   */
  outfitReady: Record<string, OutfitSet[]>
  /**
   * Which cast members have both room backgrounds on disk, by charId. Read and scoped like
   * {@link cgReady}; a character with only one of the two does not appear here.
   */
  roomReady: Record<string, boolean>
  /** Sticky mirrored-sprite flag, keyed by charId; decided when she is shown. */
  flipped: Record<string, boolean>
  /**
   * charIds who have sat out `DEPARTURE_TURNS` turns off-stage. They stay
   * in `cast` but drop out of every prompt the scene builds from here on.
   */
  departed: string[]
  /**
   * charIds off-stage right now, each mapped to how many drained turns they have sat out — an
   * absence that has not become a departure yet. She is still in the prompts.
   */
  offStage: Record<string, number>
  /**
   * Every line the player has reached this scene, in order — the Chat Log Modal's source.
   * Appended by `advanceLine`.
   */
  sceneLog: SceneLine[]
  /**
   * The player's own hand on the stage, keyed by charId: true for somebody he has shown that
   * the scene has not, false for somebody he has hidden that it has.
   */
  stageOverride: Record<string, boolean>
  /** The bg id the player picked by hand, or null to follow the scene. */
  bgOverride: string | null
  /** Per-character wardrobe locks the player set by hand. */
  outfitLock: Record<string, OutfitLock>
  /**
   * charIds already written happy since the player's last action — the once-a-turn latch the
   * sparkle is rolled behind. **Transient**: never captured, never persisted, never on disk.
   */
  brightened: string[]
  /**
   * Whether the reader has acted from inside this scene — what a girl's sparkle waits for.
   * **Transient** like {@link brightened}.
   */
  sceneActed: boolean
  /**
   * The sparkle last raised off a girl, keyed by a running count so each raise is a fresh
   * object. **Transient** like {@link brightened}.
   */
  sparkle: { charId: string; key: number } | null

  /**
   * Bumped by every {@link loadSave} (`reset` included) — a session fact, so it survives the
   * reset that always precedes a load. Used as the Game View's key: it forces a remount under the
   * crossing's cover so React state tied to the old save doesn't outlive it.
   */
  loads: number

  /**
   * Hydrates the store from a loaded `GameSave`, the playthrough record it is read against
   * and its resolved characters.
   */
  loadSave: (
    save: GameSave,
    record: PlaythroughRecord,
    characters: Record<string, Character>
  ) => void
  /** Clears all game state (e.g. on return to main menu). */
  reset: () => void
  setAwaitingInput: (awaiting: boolean) => void
  /** Raises the game over ending latch; called only by `beginSlot`. */
  setActiveGameOver: (reason: GameOverReason | null) => void
  /** Publishes the graduation picture, or takes it away on the way out. */
  setEndingArt: (url: string | null) => void
  setEndingArtPending: (pending: boolean) => void
  /** Hands the screen the reader's own picture as an object URL, or clears it. */
  setProfilePicture: (url: string | null) => void
  /** Keeps the goodbye that just ended, for the log the menu reads it back from. */
  setFarewellLog: (lines: readonly SceneLine[]) => void
  setBusy: (busy: boolean) => void
  setStreaming: (streaming: boolean) => void
  setWaitingForLine: (waiting: boolean) => void
  setClosingError: (error: AppError | null) => void
  setLedgerError: (error: AppError | null) => void
  setTextLedgerError: (error: AppError | null) => void
  /** Files the slot's landed texting-ledger reply, or clears it. */
  bankTextLedger: (bank: BankedTextLedger | null) => void
  setIntroError: (error: AppError | null) => void
  setTurnError: (error: AppError | null) => void
  setClassifierError: (error: AppError | null) => void
  setInputDraft: (draft: string) => void
  /** Snapshots the current scene for both mid-scene saves and failed-turn rewind. */
  captureScene: () => SceneState | null
  /** Restores a captured scene, playback queue included. */
  restoreScene: (scene: SceneState | null) => void
  /** Raises or drops the scene-end screen; the loop owns which and when. */
  setStatusModal: (modal: StatusModal | null) => void
  /** Raises or drops the boundary's memory question; the loop owns which rows and when. */
  setMemoryEdit: (rows: readonly MemoryEditRow[] | null) => void
  /** Replaces the playback queue with a freshly received scene's lines. */
  setPendingLines: (lines: SceneLine[]) => void
  /** Appends to the tail of the playback queue, as streamed lines arrive. */
  appendPendingLines: (lines: SceneLine[]) => void
  /**
   * Drops up to `count` preview lines from the queue tail; unread earlier lines
   * must stay queued during wrap-up streams.
   */
  dropPendingLines: (count: number) => void
  /**
   * Sets the scene's cast (charIds) and what kind of scene it is — called once per scene, at
   * the top of a slot.
   */
  setCast: (charIds: string[], scene?: SceneKind) => void
  appendSceneLines: (lines: SceneLine[]) => void
  /**
   * Files the player's submitted action as a `READER_SPEAKER` line, into the transcript and the
   * scene log — never into `pendingLines`. `continues` says whether this action was taken from
   * inside a scene already running, rather than the one that opens it.
   */
  logPlayerAction: (text: string, continues: boolean) => void
  /**
   * Drops the last `count` transcript entries — used to unwind a discarded preview — and every
   * summary that covered one of them.
   */
  dropSceneTranscript: (count: number) => void
  /** Clears the transcript *and* every summary; the two are one unit. */
  clearSceneTranscript: () => void
  /** Files a reply's running summary, covering the transcript up to length `at`. */
  setSceneSummary: (summary: string, at: number) => void
  /**
   * Cuts the lines of the current reply the player has not reached out of the queue and the
   * transcript alike, and every summary that covered one of them. The reader's last line stays.
   */
  truncateUnread: () => void
  /**
   * Steps playback back to the previous line of the current reply that says something, putting
   * the lines after it back on the queue and the stage back as it stood there. Returns false,
   * changing nothing, when the current line is the reply's first.
   */
  rewindLine: () => boolean
  /**
   * Rewrites the text of `sceneLog[at]`, a line of the current reply, on the log, on its
   * transcript line and on screen when it is the line shown. Returns false, changing nothing,
   * when the line is the reader's, before his last action, a status line, or already says
   * `text`.
   */
  editLogLine: (at: number, text: string) => boolean
  setSceneEnding: (ending: boolean) => void
  setStatusShown: (shown: boolean) => void
  /** Files the running summary under the slot that just finished. */
  commitSceneToHistory: (date: number, time: TimeSlot) => void
  /**
   * Pops the next pending line and applies its `bg`, `action` and `emotion`.
   * Returns false when the queue was already empty.
   */
  advanceLine: () => boolean
  /**
   * Charges every running absence one turn, settling into `departed` whoever has now sat out
   * `DEPARTURE_TURNS`. Called once per turn, at the decision point.
   */
  settleDepartures: () => void
  /**
   * Shows or hides a cast member by hand. Writes {@link stageOverride}, never the scene's
   * own stage.
   */
  toggleStageChar: (charId: string) => void
  /** Picks a background by hand, or null to hand the choice back to the scene. */
  setBgOverride: (bg: string | null) => void
  /** Locks a character's rendered wardrobe, or null to unlock her. */
  setOutfitLock: (charId: string, lock: OutfitLock | null) => void
  /** Clears background, portraits and emotions — the between-scenes state. */
  clearStage: () => void
  /** Advances to the next time slot, rolling `date` forward when night wraps to day. */
  advanceSlot: () => void
  /** Adds a scene's resolved stat movement, flooring each stat at zero. */
  applyStatDeltas: (deltas: PlayerStats) => void
  /** Replaces what the reader says about himself: New Game's answer, and every later rewrite. */
  setBio: (bio: string) => void
  /** Counts a finished scene's kisses and nights into the lifetime tallies. */
  recordActs: (acts: readonly IntimateAct[]) => void
  /** Deducts what a scene cost the reader. No floor: the balance may go negative. */
  spendMoney: (amount: number) => void
  /** Buys one of an item: banks it in the inventory and deducts the price, with no floor. */
  buyItem: (itemId: string, price: number) => void
  /**
   * Hands an item to a character: spends it out of the inventory and files the {@link SceneGift},
   * stamping `repeat` from `charInfo` and earlier gifts this scene.
   */
  giftItem: (charId: string, itemId: string) => GiftReaction
  /** Undoes the newest gift, putting the item back: its turn was abandoned. */
  ungiftItem: () => void
  /** Folds this scene's gifts into `charInfo` — run once at the boundary. */
  recordGifts: () => void
  /** Empties the scene's gift list at a scene boundary or a slot opening. */
  clearSceneGifts: () => void
  recordMemory: (charId: string, entry: CharMemory) => void
  /**
   * Rewrites every copy of one memory she holds to `next`, or forgets it where `next` is null;
   * a memory she does not hold changes nothing.
   */
  replaceMemory: (charId: string, match: CharMemory, next: CharMemory | null) => void
  /** Files what this slot's texting left her with, **replacing** the last slot's. */
  setTextMemory: (charId: string, entry: CharMemory) => void
  /** Remembers what the scene-end status lines just told him about her standards. */
  setCrushHint: (charId: string, hint: CrushHint | undefined) => void
  /**
   * Replaces everything she suspects about the reader and the other girls. An empty list leaves
   * her no key at all, and a list she already holds keeps her entry's identity.
   */
  setSuspicions: (charId: string, records: readonly Suspicion[]) => void
  /**
   * Replaces the permanent memories those suspicions turned into; a list she already holds
   * keeps her entry's identity, for the same reason.
   */
  setJealousyMemories: (charId: string, entries: readonly CharMemory[]) => void
  /** Applies the ledger's milestones for one character. */
  applyRelationshipEvents: (charId: string, events: readonly RelationshipEvent[]) => void
  /** Writes the dating pass's replacement entries over the girls it touched. */
  applyDatingSettle: (outcome: DatingPassOutcome) => void
  /** Marks the cast as having met the reader — run once the scene is over. */
  markMet: (charIds: readonly string[]) => void
  /** Files the slot of the week the cast were just run into on, for the map and standing haunts. */
  markSeenAt: (charIds: readonly string[], slot: ShiftSlot) => string[]
  /** Re-derives the affection-driven flags for the cast at scene start. */
  refreshDerivedFlags: (charIds: readonly string[]) => void
  /** Files a crush the ending rolled for her. Latches — a second call is a no-op. */
  setCrush: (charId: string) => void

  /**
   * Appends one Bunnyboard message, creating the conversation on first use.
   * `unreadDelta` is 1 for a message that should light the badge, 0 otherwise.
   */
  appendChatMessage: (charId: string, message: ChatMessage, unreadDelta: number) => void
  /** The player opened the conversation — its unread count clears. */
  markConversationRead: (charId: string) => void
  /** Banks a texting turn's merged recap on the conversation. */
  setConversationSummary: (charId: string, summary: string) => void
  /** Raises, dismisses or clears her unanswered ask-out on the conversation. */
  setPendingHangout: (charId: string, hangout: Conversation['pendingHangout'] | null) => void
  /**
   * Marks the newest text in her thread as the invitation it is, which is what the ask-out
   * cooldowns are counted off. A no-op unless that text is hers and unmarked.
   */
  markInvitation: (charId: string) => void
  /** One more invitation of hers he did not take up. */
  bumpDeclined: (charId: string) => void
  /** He came, so the streak and the memory it owed are gone. */
  resetDeclined: (charId: string) => void
  /** A lover turned down by text, still owed her memory of it. */
  setTurnedDown: (charId: string) => void
  /** Spends the turned-down mark once its memory has been filed. */
  clearTurnedDown: (charId: string) => void
  /** Files the player's outgoing friend request. */
  markRequestSent: (charId: string) => void
  /** Files her incoming friend request and lights the Friends badge. */
  receiveRequest: (charId: string) => void
  /** Drops a pending request (either direction) once it resolves. */
  resolveRequest: (charId: string) => void
  /** The player opened the Friends tab — its badge clears. */
  clearContactsBadge: () => void
  /** She is on the reader's Bunnyboard now, whichever way it happened. */
  setGaveContactInfo: (charId: string) => void
  /**
   * The reader knows her name — the route other than a scene line saying it: accepting a
   * request he sent to somebody whose feed account published it.
   */
  setNameKnown: (charId: string) => void
  /**
   * Raises or clears her block on the reader. Only ever called with `true`: clearing is a
   * milestone and travels through `applyRelationshipEvents`.
   */
  setBlocked: (charId: string, value: boolean) => void
  /** Sets or clears the ignored-invitation mark for one character. */
  setIgnoredInvitation: (charId: string, value: boolean) => void
  /**
   * Retires the one-shot "she recently got a job" injection once a scene has carried it.
   * Idempotent.
   */
  clearNewJobNotice: (charId: string) => void
  /** Files the plans a finished slot produced. Append-only. */
  addEvents: (events: readonly CalendarEvent[]) => void
  /** The player opened the Calendar — every plan on it stops being new. */
  markEventsSeen: () => void
  /** Records who the reader stood up by not spending the slot on this plan. */
  markEventNoShow: (eventId: string, charIds: readonly string[]) => void
  /** Moves one plan to another slot — the one field of an event the player edits. */
  rescheduleEvent: (eventId: string, date: number, time: TimeSlot) => void
  /** The reader was hired. `settledThrough` is the slot he accepted in. */
  takeJob: (jobId: string, shifts: readonly ShiftSlot[], settledThrough: number) => void
  /** Credits one worked shift and pays for it. Returns whether the streak just bought a raise. */
  recordShiftWorked: (slotId: number, pay: number) => boolean
  /** Records a missed shift: one strike, and the raise streak back to zero. */
  recordStrike: (slotId: number) => void
  /** The one setter for the rest of `JobState` — shifts, the excuse, the sweep's mark. */
  updateJob: (patch: Partial<JobState>) => void
  /** Fired or quit: drops the job and closes that employer for the playthrough. */
  endJob: () => void

  /** Files one meeting of one class. Write-once per date: a replayed boundary is inert. */
  recordClassMeeting: (code: string, meeting: ClassMeetingRecord) => void
  /** Files a sat exam's tally. Write-once per period, on the same reasoning. */
  recordExam: (code: string, exam: ExamPeriod, record: ExamRecord) => void
  /**
   * Credits one slot spent working on a project, and what the reader did with it.
   * **Deduped by the slot**: both halves of a day count, a replayed boundary does not.
   */
  recordProjectWork: (
    code: string,
    exam: ExamPeriod,
    date: number,
    time: TimeSlot,
    summary?: string
  ) => void
  /** Freezes an assessment's score, 0–100. Write-once. */
  setClassScore: (code: string, exam: ExamPeriod, score: number, heartTier?: StatTier) => void
  /** Sets the reader's standing, and the one-shot guards on the two notifications. */
  setGradesStanding: (standing: 'good' | 'bad' | null) => void
  /** Latches the expulsion ending's input. One-way — takes no argument. */
  setExpelled: () => void
  setMidtermStandingDone: () => void
  setFinalsScoresShown: () => void
  /** Replaces the player's timetable during add/drop. */
  setPlayerSchedule: (schedule: Record<number, string>) => void
  /**
   * Records classes as dropped, permanently. Idempotent: a code already recorded keeps
   * its `announced` flag.
   */
  recordDroppedClasses: (codes: readonly string[]) => void
  /** Spends the one-shot cast-block line about a dropped class. Idempotent. */
  markDropAnnounced: (code: string) => void
  /** Records classes as added at add/drop. Idempotent, on `recordDroppedClasses`' terms. */
  recordAddedClasses: (codes: readonly string[]) => void
  /** Spends the one-shot CLASS-block line introducing him to an added class. Idempotent. */
  markAddAnnounced: (code: string) => void
  /** Advances VenusBot's delivery watermark. Monotonic, like `settledThrough`. */
  advanceVenusThrough: (slot: number) => void
  /** The same for BunnyBot's. */
  advanceBunnybotThrough: (slot: number) => void
  /** Hands over one of the two granted sidebar apps. One-way and idempotent. */
  unlockBunnymap: () => void
  unlockBunnyshop: () => void
  /** Spends one of the five one-shot bot messages. One-way and idempotent. */
  markVenusJobIntroSent: () => void
  markBunnybotContactIntroSent: () => void
  markBunnybotFirstPostNudgeSent: () => void
  markBunnybotTwoTimingTipSent: () => void
  markBunnybotSeenTipSent: () => void
  /**
   * Holds a BunnyMap handover that fired before BunnyBot introduced itself, and releases the
   * queue once it has. Queueing is a set union.
   */
  queueBunnybotDeferred: (handover: BunnybotHandover) => void
  clearBunnybotDeferred: () => void
  /** Replaces the whole pair map. Written whole: the settle pass folds every pair at once. */
  setNpcRelationships: (relationships: NpcRelationshipMap) => void
  /** Files who is with whom this slot, or clears it. */
  setNpcOverlay: (overlay: NpcSlotOverlay | null) => void
  /** Appends pairs that have just become friends for the first time. Never rewrites one. */
  recordNpcFriendships: (pairs: readonly NpcFriendship[]) => void
  /** Files what this slot's opening said about somewhere, or clears it. */
  setSlotRumor: (rumor: SlotRumor | null) => void
  /** Files an occasion he was asked to and did not go to. Appends once; a repeat is a no-op. */
  markOccasionDeclined: (occasionId: string) => void
  /**
   * Snapshots the finishing slot's scene cast for the ask-out roll. Must run before
   * the clock or the cast moves — just ahead of `advanceSlot`.
   */
  recordLastSlotCast: () => void
  /**
   * Marks everyone in `charIds` as having been out on the weekend `saturday` belongs to.
   * Idempotent.
   */
  recordWeekendOutings: (charIds: readonly string[], saturday: number) => void
  /** The same for the break week's per-slot record. Idempotent. */
  recordOutingSlots: (charIds: readonly string[], slotId: number) => void
  /** Files who leaves campus for spring break. One-way. */
  setSpringBreakAway: (charIds: readonly string[]) => void
  /** Marks the graduation narration played, so a resumed epilogue skips it. */
  markGraduationSeen: () => void
  /** Spends one goodbye off the epilogue's menu. Idempotent. */
  recordFarewell: (charId: string) => void
  /** Claims the graduation picture for this epilogue. Idempotent. */
  markEndingArtWanted: () => void
  /**
   * Takes `charIds` off every plan falling in `[fromDate, toDate)`, dropping a plan nobody is
   * left on.
   */
  withdrawFromEvents: (charIds: readonly string[], fromDate: number, toDate: number) => void
  /** Appends one status update to a character's own feed, oldest first. */
  appendFeedPost: (charId: string, post: SocialPost) => void
  /** Toggles the player's like on one of her posts. Inert for a post that is not there. */
  toggleFeedLike: (charId: string, postId: string) => void
  /** Toggles the player's like on the day's random-student post. */
  toggleRandomPostLike: () => void
  /** Files the day's transient feed items, stamped with the day they belong to. */
  setFeedExtras: (extras: FeedExtras | null) => void
  /** Files the people the Friends tab offers this slot. */
  setSuggestions: (charIds: readonly string[]) => void
  /** Opens an exam, or clears one at the boundary. */
  setSceneQuiz: (quiz: QuizState | null) => void
  /** Banks one answer: advances the index and counts it if it was right. */
  answerQuiz: (correct: boolean) => void
  /** Projects the persistable subset of state into a `GameSave`-shaped object. */
  toGameSave: () => Omit<GameSave, 'playthroughId' | 'saveId' | 'saveDate'>
}

/** Builds the derived charKey → charId map from a set of resolved characters. */
export function buildCharKeyToId(characters: Record<string, Character>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const character of Object.values(characters)) {
    map[charKeyOf(character.firstName, character.lastName)] = character.charId
  }
  return map
}

/** Whether she already suspects exactly these girls, stamp for stamp and in this order. */
function sameSuspicions(
  held: readonly Suspicion[] | undefined,
  next: readonly Suspicion[]
): boolean {
  if ((held?.length ?? 0) !== next.length) return false
  if (!held) return true
  return held.every(
    (record, index) => record.subject === next[index].subject && record.slot === next[index].slot
  )
}

/** Whether she already remembers exactly these things, in this order and dated the same. */
function sameMemories(
  held: readonly CharMemory[] | undefined,
  next: readonly CharMemory[]
): boolean {
  if ((held?.length ?? 0) !== next.length) return false
  if (!held) return true
  return held.every(
    (entry, index) =>
      entry.desc === next[index].desc &&
      entry.type === next[index].type &&
      entry.date === next[index].date
  )
}

/** One character's `charInfo` entry, rewritten. */
function patchCharInfo(
  state: GameStoreState,
  charId: string,
  next: (existing: CharInfo | undefined) => CharInfo | null
): Partial<GameStoreState> {
  const patched = next(state.charInfo[charId])
  return patched ? { charInfo: { ...state.charInfo, [charId]: patched } } : {}
}

/** The same, one level deeper: `bunnyboard.conversations[charId]`. */
function patchConversation(
  state: GameStoreState,
  charId: string,
  next: (existing: Conversation) => Conversation | null
): Partial<GameStoreState> {
  const patched = next(conversationWith(state.bunnyboard, charId))
  if (!patched) return {}
  return {
    bunnyboard: {
      ...state.bunnyboard,
      conversations: { ...state.bunnyboard.conversations, [charId]: patched }
    }
  }
}

/**
 * Every key of the settled half. A field added to `CharProfile` is a compile error until
 * it is listed here, which is what keeps it out of the save files.
 */
const PROFILE_KEYS: Record<keyof CharProfile, true> = {
  year: true,
  dorm: true,
  major: true,
  schedule: true,
  hiddenSchedule: true,
  moodCycleOffset: true,
  handle: true,
  springBreakPlans: true
}

/** The half of one entry a save file carries: everything the record already holds, dropped. */
function charStateOf(info: CharInfo): CharState {
  const state = { ...info } as Record<string, unknown>
  for (const key of Object.keys(PROFILE_KEYS)) delete state[key]
  return state as unknown as CharState
}

/** The entry for a charId the save has none for; the writers must survive one. */
export function blankCharInfo(): CharInfo {
  return {
    memories: [],
    flags: emptyFlags(),
    nameKnown: false,
    year: 1,
    dorm: FALLBACK_DORM,
    major: '',
    schedule: {},
    gifts: []
  }
}

/** The inventory with one more of `itemId`, appending a line if it holds none. */
function addItem(inventory: readonly OwnedItem[], itemId: string): OwnedItem[] {
  const held = inventory.find((entry) => entry.itemId === itemId)
  if (!held) return [...inventory, { itemId, count: 1 }]
  return inventory.map((entry) =>
    entry.itemId === itemId ? { ...entry, count: entry.count + 1 } : entry
  )
}

/** The inventory with one fewer of `itemId`; a line that reaches zero is dropped. */
function removeItem(inventory: readonly OwnedItem[], itemId: string): OwnedItem[] {
  return inventory.flatMap((entry) => {
    if (entry.itemId !== itemId) return [entry]
    return entry.count > 1 ? [{ ...entry, count: entry.count - 1 }] : []
  })
}

/** The blank stage: no background, no portraits, no sticky emotions. */
const emptyStage = {
  bg: null,
  slots: Array<string | null>(PORTRAIT_SLOTS).fill(null),
  emotions: {} as Record<string, SpriteRef>,
  flipped: {} as Record<string, boolean>,
  departed: [] as string[],
  offStage: {} as Record<string, number>,
  sceneLog: [] as SceneLine[],
  // The manual display layer is scene-scoped like everything else here.
  stageOverride: {} as Record<string, boolean>,
  bgOverride: null as string | null,
  outfitLock: {} as Record<string, OutfitLock>,
  // Nobody has been written happy yet and nothing is sparkling: both are scene-scoped too.
  brightened: [] as string[],
  // No action taken from inside this scene yet, and nothing is sparkling: scene-scoped too.
  sceneActed: false,
  sparkle: null as { charId: string; key: number } | null
}

/**
 * What applying a line reads off the store and the settings. The setting is read once per call,
 * and an unloaded settings record reads as off.
 */
export function stageContextOf(state: Omit<StageContext, 'noNsfwImages'>): StageContext {
  return {
    charKeyToId: state.charKeyToId,
    characters: state.characters,
    outfitReady: state.outfitReady,
    noNsfwImages: noNsfwImagesOf(useSettingsStore.getState())
  }
}

/**
 * The summary marks left once the transcript is cut to `length`, with the running summary
 * re-derived off the top one; nothing at all when every mark survives.
 */
function summariesWithin(
  marks: readonly SceneSummaryMark[],
  length: number
): Partial<Pick<GameStoreState, 'sceneSummaries' | 'sceneSummary'>> {
  const kept = marks.filter((mark) => mark.at <= length)
  if (kept.length === marks.length) return {}
  return { sceneSummaries: kept, sceneSummary: kept[kept.length - 1]?.summary ?? null }
}

/** A blank stage with its own containers — `emptyStage`'s are shared module-scope objects. */
function freshStage(): typeof emptyStage {
  return {
    bg: null,
    slots: Array<string | null>(PORTRAIT_SLOTS).fill(null),
    emotions: {},
    flipped: {},
    departed: [],
    offStage: {},
    sceneLog: [],
    stageOverride: {},
    bgOverride: null,
    outfitLock: {},
    brightened: [],
    sceneActed: false,
    sparkle: null
  }
}

const initialState = {
  playthroughId: null,
  date: 0,
  time: 0 as TimeSlot,
  chars: [] as string[],
  playerFirstName: DEFAULT_PLAYER_FIRST_NAME,
  playerLastName: DEFAULT_PLAYER_LAST_NAME,
  stats: DEFAULT_PLAYER_STATS,
  money: STARTING_MONEY,
  bio: '',
  tallies: emptyTallies(),
  charInfo: {} as Record<string, CharInfo>,
  classes: {} as Record<string, ClassEntry>,
  playerSchedule: {} as Record<number, string>,
  history: {} as GameHistory,
  bunnyboard: emptyBunnyboard(),
  events: [] as CalendarEvent[],
  occasions: [] as Occasion[],
  occasionsDeclined: [] as string[],
  job: null as JobState | null,
  jobsClosed: [] as string[],
  jobClosures: {} as Record<string, ShiftSlot[]>,
  weather: [] as Weather[],
  inventory: [] as OwnedItem[],
  classRecords: {} as Record<string, ClassRecord>,
  gradesStanding: null as 'good' | 'bad' | null,
  expelled: false,
  midtermStandingDone: false,
  finalsScoresShown: false,
  venusThrough: -1,
  bunnybotThrough: -1,
  bunnymapUnlocked: false,
  bunnyshopUnlocked: false,
  venusJobIntroSent: false,
  bunnybotContactIntroSent: false,
  bunnybotFirstPostNudgeSent: false,
  bunnybotTwoTimingTipSent: false,
  bunnybotSeenTipSent: false,
  bunnybotDeferred: [] as BunnybotHandover[],
  droppedClasses: {} as Record<string, DroppedClass>,
  addedClasses: {} as Record<string, AddedClass>,
  npcRelationships: {} as NpcRelationshipMap,
  npcFriendships: [] as NpcFriendship[],
  npcOverlay: null as NpcSlotOverlay | null,
  slotRumor: null as SlotRumor | null,
  lastSlotCast: null as { date: number; time: TimeSlot; charIds: string[] } | null,
  weekendOutings: {} as Record<string, number>,
  outingSlots: {} as Record<string, number>,
  springBreakAway: null as string[] | null,
  feedExtras: null as FeedExtras | null,
  graduationSeen: false,
  farewellsDone: [] as string[],
  endingArtWanted: false,
  characters: {} as Record<string, Character>,
  charKeyToId: {} as Record<string, string>,
  cast: [] as string[],
  sceneClass: null as string | null,
  sceneProject: null as string | null,
  sceneJob: null as string | null,
  sceneJobStats: [] as StatKey[],
  sceneFarewell: null as string | null,
  sceneTextLedgerSkip: null as string | null,
  sceneTextLedger: null as BankedTextLedger | null,
  sceneIgnoredInvites: [] as string[],
  sceneTurnedDown: [] as string[],
  sceneVisitJob: null as string | null,
  sceneMentions: [] as string[],
  sceneLocation: null as string | null,
  sceneInPublic: true,
  sceneGifts: [] as SceneGift[],
  sceneQuiz: null as QuizState | null,
  currentSceneTranscript: [] as SceneLine[],
  sceneSummary: null as string | null,
  sceneSummaries: [] as SceneSummaryMark[],
  sceneEnding: false,
  statusShown: false,
  lineRewound: 0,
  awaitingInput: false,
  activeGameOver: null as GameOverReason | null,
  endingArt: null as string | null,
  profilePicture: null as string | null,
  endingArtPending: false,
  farewellLog: [] as SceneLine[],
  busy: false,
  streaming: false,
  waitingForLine: false,
  closingError: null as AppError | null,
  ledgerError: null as AppError | null,
  textLedgerError: null as AppError | null,
  introError: null as AppError | null,
  turnError: null as AppError | null,
  classifierError: null as AppError | null,
  inputDraft: '',
  statusModal: null as StatusModal | null,
  memoryEdit: null as readonly MemoryEditRow[] | null,
  pendingLines: [] as SceneLine[],
  currentLine: null as SceneLine | null,
  cgReady: {} as Record<string, boolean>,
  outfitReady: {} as Record<string, OutfitSet[]>,
  roomReady: {} as Record<string, boolean>,
  ...emptyStage
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  ...initialState,
  loads: 0,

  loadSave: (save, record, characters) =>
    set({
      ...initialState,
      loads: get().loads + 1,
      playthroughId: save.playthroughId,
      date: save.date,
      time: save.time,
      chars: record.chars,
      playerFirstName: record.playerFirstName,
      playerLastName: record.playerLastName,
      stats: save.stats,
      money: save.money,
      // Both are younger than the save format, so a playthrough started before them loads blank.
      bio: save.bio ?? '',
      tallies: save.tallies ?? emptyTallies(),
      // The two halves rejoined; a save entry with no profile falls back to the blank one,
      // which is what a charId the record never knew about would land on.
      charInfo: Object.fromEntries(
        Object.entries(save.charInfo).map(([charId, state]) => [
          charId,
          { ...blankCharInfo(), ...record.profiles[charId], ...state }
        ])
      ),
      classes: record.classes,
      playerSchedule: save.playerSchedule,
      history: save.history,
      bunnyboard: save.bunnyboard,
      events: save.events,
      occasions: record.occasions,
      occasionsDeclined: save.occasionsDeclined ?? [],
      job: save.job,
      jobsClosed: save.jobsClosed,
      jobClosures: record.jobClosures,
      weather: record.weather,
      inventory: save.inventory,
      classRecords: save.classRecords,
      gradesStanding: save.gradesStanding,
      expelled: save.expelled,
      midtermStandingDone: save.midtermStandingDone,
      finalsScoresShown: save.finalsScoresShown,
      venusThrough: save.venusThrough,
      bunnybotThrough: save.bunnybotThrough,
      bunnymapUnlocked: save.bunnymapUnlocked,
      bunnyshopUnlocked: save.bunnyshopUnlocked,
      venusJobIntroSent: save.venusJobIntroSent,
      bunnybotContactIntroSent: save.bunnybotContactIntroSent,
      bunnybotFirstPostNudgeSent: save.bunnybotFirstPostNudgeSent,
      bunnybotTwoTimingTipSent: save.bunnybotTwoTimingTipSent,
      bunnybotSeenTipSent: save.bunnybotSeenTipSent ?? false,
      bunnybotDeferred: save.bunnybotDeferred,
      droppedClasses: save.droppedClasses,
      addedClasses: save.addedClasses,
      npcRelationships: save.npcRelationships,
      npcFriendships: save.npcFriendships ?? [],
      npcOverlay: save.npcOverlay,
      slotRumor: save.slotRumor ?? null,
      lastSlotCast: save.lastSlotCast,
      weekendOutings: save.weekendOutings,
      outingSlots: save.outingSlots,
      springBreakAway: save.springBreakAway,
      feedExtras: save.feedExtras,
      graduationSeen: save.graduationSeen,
      farewellsDone: save.farewellsDone,
      endingArtWanted: save.endingArtWanted,
      characters,
      charKeyToId: buildCharKeyToId(characters),
      ...freshStage()
    }),

  reset: () => set({ ...initialState, loads: get().loads, ...freshStage() }),

  setAwaitingInput: (awaiting) => set({ awaitingInput: awaiting }),

  setActiveGameOver: (reason) => set({ activeGameOver: reason }),

  setEndingArt: (url) => set({ endingArt: url }),

  setEndingArtPending: (pending) => set({ endingArtPending: pending }),

  setProfilePicture: (url) => set({ profilePicture: url }),

  setFarewellLog: (lines) => set({ farewellLog: [...lines] }),

  setBusy: (busy) => set({ busy }),

  setStreaming: (streaming) => set({ streaming }),

  setWaitingForLine: (waiting) => set({ waitingForLine: waiting }),

  setClosingError: (error) => set({ closingError: error }),

  setLedgerError: (error) => set({ ledgerError: error }),
  setTextLedgerError: (error) => set({ textLedgerError: error }),

  bankTextLedger: (bank) => set({ sceneTextLedger: bank }),

  setIntroError: (error) => set({ introError: error }),

  setTurnError: (error) => set({ turnError: error }),

  setClassifierError: (error) => set({ classifierError: error }),

  setInputDraft: (draft) => set({ inputDraft: draft }),

  captureScene: () => {
    const state = get()
    // Nothing on screen, nothing written, nothing queued: the slot has not opened yet. Not keyed
    // on the cast alone — a solo scene has none.
    if (
      state.cast.length === 0 &&
      state.currentSceneTranscript.length === 0 &&
      state.sceneSummary === null &&
      state.pendingLines.length === 0 &&
      state.sceneLog.length === 0 &&
      state.currentLine === null &&
      // An exam has no cast and no transcript, but a null here would write `scene: null` over a
      // paper already paid for.
      state.sceneQuiz === null
    ) {
      return null
    }
    return {
      cast: [...state.cast],
      // Optional on `SceneState`: a field that does not apply to the scene is not written.
      ...(state.sceneClass ? { classCode: state.sceneClass } : {}),
      ...(state.sceneProject ? { projectClass: state.sceneProject } : {}),
      ...(state.sceneJob ? { jobId: state.sceneJob } : {}),
      ...(state.sceneJobStats.length > 0 ? { jobStats: [...state.sceneJobStats] } : {}),
      ...(state.sceneFarewell ? { farewell: state.sceneFarewell } : {}),
      ...(state.sceneTextLedgerSkip ? { textLedgerSkip: state.sceneTextLedgerSkip } : {}),
      ...(state.sceneTextLedger ? { textLedger: { ...state.sceneTextLedger } } : {}),
      ...(state.sceneIgnoredInvites.length > 0
        ? { ignoredInvites: [...state.sceneIgnoredInvites] }
        : {}),
      ...(state.sceneTurnedDown.length > 0
        ? { turnedDownInvites: [...state.sceneTurnedDown] }
        : {}),
      ...(state.sceneVisitJob ? { visitJobId: state.sceneVisitJob } : {}),
      ...(state.sceneMentions.length > 0 ? { mentions: [...state.sceneMentions] } : {}),
      ...(state.sceneLocation ? { location: state.sceneLocation } : {}),
      // Written only when *false*: absent is the classifier's own default.
      ...(state.sceneInPublic ? {} : { inPublic: false }),
      ...(state.sceneGifts.length > 0 ? { gifts: state.sceneGifts.map((g) => ({ ...g })) } : {}),
      ...(state.sceneQuiz
        ? { quiz: { ...state.sceneQuiz, questions: state.sceneQuiz.questions.map((q) => ({ ...q })) } }
        : {}),
      transcript: [...state.currentSceneTranscript],
      summary: state.sceneSummary,
      ...(state.sceneSummaries.length > 0
        ? { summaries: state.sceneSummaries.map((mark) => ({ ...mark })) }
        : {}),
      bg: state.bg,
      slots: [...state.slots],
      emotions: { ...state.emotions },
      flipped: { ...state.flipped },
      departed: [...state.departed],
      offStage: { ...state.offStage },
      // Omitted when the player never laid a hand on the stage.
      ...(Object.keys(state.stageOverride).length > 0
        ? { stageOverride: { ...state.stageOverride } }
        : {}),
      ...(state.bgOverride ? { bgOverride: state.bgOverride } : {}),
      ...(Object.keys(state.outfitLock).length > 0 ? { outfitLock: { ...state.outfitLock } } : {}),
      sceneLog: [...state.sceneLog],
      currentLine: state.currentLine,
      pendingLines: [...state.pendingLines]
    }
  },

  restoreScene: (scene) =>
    set({
      pendingLines: scene ? [...scene.pendingLines] : [],
      cast: scene ? [...scene.cast] : [],
      ...sceneKindFields(scene),
      sceneTextLedger: scene?.textLedger ? { ...scene.textLedger } : null,
      sceneGifts: (scene?.gifts ?? []).map((g) => ({ ...g })),
      sceneQuiz: scene?.quiz
        ? { ...scene.quiz, questions: scene.quiz.questions.map((q) => ({ ...q })) }
        : null,
      currentSceneTranscript: scene ? [...scene.transcript] : [],
      sceneSummary: scene?.summary ?? null,
      // A save from before the marks has a summary covering nothing its transcript still holds.
      sceneSummaries:
        scene?.summaries?.map((mark) => ({ ...mark })) ??
        (scene?.summary ? [{ at: 0, summary: scene.summary }] : []),
      bg: scene?.bg ?? null,
      slots: scene ? [...scene.slots] : Array<string | null>(PORTRAIT_SLOTS).fill(null),
      emotions: scene ? { ...scene.emotions } : {},
      flipped: scene ? { ...scene.flipped } : {},
      departed: scene ? [...scene.departed] : [],
      offStage: scene ? { ...scene.offStage } : {},
      // The manual layer is omitted from a capture the player never touched.
      stageOverride: { ...(scene?.stageOverride ?? {}) },
      bgOverride: scene?.bgOverride ?? null,
      outfitLock: { ...(scene?.outfitLock ?? {}) },
      sceneLog: scene ? [...scene.sceneLog] : [],
      currentLine: scene?.currentLine ?? null
    }),

  setStatusModal: (modal) => set({ statusModal: modal }),

  setMemoryEdit: (rows) => set({ memoryEdit: rows }),

  setPendingLines: (lines) => set({ pendingLines: lines }),

  appendPendingLines: (lines) =>
    set((state) => ({ pendingLines: [...state.pendingLines, ...lines] })),

  dropPendingLines: (count) =>
    set((state) => ({
      pendingLines: state.pendingLines.slice(0, Math.max(0, state.pendingLines.length - count))
    })),

  setCast: (charIds, scene) =>
    set({
      cast: charIds,
      ...sceneKindFields(scene),
      // The bank belongs to one scene: every scene start and boundary reset comes through here.
      sceneTextLedger: null
    }),

  appendSceneLines: (lines) =>
    set((state) => ({ currentSceneTranscript: [...state.currentSceneTranscript, ...lines] })),

  logPlayerAction: (text, continues) =>
    set((state) => {
      const line: SceneLine = { speaker: READER_SPEAKER, text }
      return {
        currentSceneTranscript: [...state.currentSceneTranscript, line],
        sceneLog: [...state.sceneLog, line],
        // The head of a turn: every girl is owed her sparkle again.
        brightened: [],
        // Latched, never cleared here: once the reader has acted inside the scene, every
        // later action in it still counts, opening line included.
        sceneActed: state.sceneActed || continues
      }
    }),

  dropSceneTranscript: (count) =>
    set((state) => {
      const kept = Math.max(0, state.currentSceneTranscript.length - count)
      return {
        currentSceneTranscript: state.currentSceneTranscript.slice(0, kept),
        ...summariesWithin(state.sceneSummaries, kept)
      }
    }),

  clearSceneTranscript: () =>
    set({ currentSceneTranscript: [], sceneSummary: null, sceneSummaries: [] }),

  setSceneSummary: (summary, at) =>
    set((state) => ({
      sceneSummary: summary,
      sceneSummaries: [...state.sceneSummaries, { at, summary }]
    })),

  truncateUnread: () =>
    set((state) => {
      const transcript = state.currentSceneTranscript
      // Never past the reader's own last line: the unread lines are all the current reply's.
      const kept = Math.max(
        transcript.length - state.pendingLines.length,
        lastReaderIndexOf(transcript) + 1
      )
      return {
        currentSceneTranscript: transcript.slice(0, kept),
        pendingLines: [],
        ...summariesWithin(state.sceneSummaries, kept)
      }
    }),

  rewindLine: () => {
    const state = get()
    const log = state.sceneLog
    const target = rewindTargetOf(log)
    if (target === -1) return false
    const sceneLog = log.slice(0, target + 1)
    const ctx = stageContextOf(state)
    const stage = stageAt(sceneLog, ctx)
    // A CG stands only for a lone girl on the stage as displayed, so one the hand ended stays
    // ended.
    const shown = displaySlotsOf(stage.slots, state.stageOverride).filter(
      (id): id is string => Boolean(id)
    )
    const emotions = retireCgs(
      stage.emotions,
      Object.keys(stage.emotions).filter((id) => shown.length !== 1 || shown[0] !== id),
      ctx
    )
    set({
      pendingLines: [...log.slice(target + 1), ...state.pendingLines],
      sceneLog,
      currentLine: log[target],
      bg: stage.bg,
      slots: stage.slots,
      emotions,
      flipped: stage.flipped,
      offStage: stage.offStage,
      departed: stage.departed,
      lineRewound: state.lineRewound + 1
    })
    return true
  },

  editLogLine: (at, text) => {
    const state = get()
    const log = state.sceneLog
    if (!lineEditable(log, at) || text === log[at].text) return false
    const old = log[at]
    const edited: SceneLine = { ...old, text }
    const sceneLog = log.map((line, i) => (i === at ? edited : line))
    // The current reply runs from the reader's last action on the log and the transcript alike,
    // in one order: a streamed line goes onto the transcript and the queue together, and a cut
    // of the unread tail never reaches back past the reader's line. So the line sits as far past
    // his action on the one as on the other. A line only the log holds (a landing's opening
    // narration, an ending's goodbyes) finds some other line there, and the transcript is kept.
    const transcript = state.currentSceneTranscript
    const tAt = lastReaderIndexOf(transcript) + (at - lastReaderIndexOf(log))
    const mirror = transcript[tAt]
    const currentSceneTranscript =
      mirror && mirror.speaker === old.speaker && mirror.text === old.text
        ? transcript.map((line, i) => (i === tAt ? edited : line))
        : transcript
    // The line on screen is the log's last, but a restored one is a copy, so it is matched by
    // value. Rewriting it is a cut: the new words land whole.
    const current = state.currentLine
    const shown =
      at === log.length - 1 &&
      current !== null &&
      current.speaker === old.speaker &&
      current.text === old.text
    set({
      sceneLog,
      currentSceneTranscript,
      ...(shown ? { currentLine: edited, lineRewound: state.lineRewound + 1 } : {})
    })
    return true
  },

  setSceneEnding: (ending) => set({ sceneEnding: ending }),

  setStatusShown: (shown) => set({ statusShown: shown }),

  commitSceneToHistory: (date, time) =>
    set((state) => {
      if (!state.sceneSummary) return {}
      // The plans the reader stood up this slot go into the summary too, from the events' own
      // `noShow`.
      const stood = state.events
        .filter((event) => event.date === date && event.time === time && event.noShow?.length)
        .map((event) => {
          const names = (event.noShow ?? []).map(
            (charId) => state.characters[charId]?.firstName ?? 'her'
          )
          return `The reader didn't show up for ${event.title} with ${names.join(', ')}.`
        })

      return {
        history: {
          ...state.history,
          [date]: { ...state.history[date], [time]: [state.sceneSummary, ...stood].join(' ') }
        }
      }
    }),

  advanceLine: () => {
    const state = get()
    const [next, ...rest] = state.pendingLines
    if (!next) return false

    // Stage mutations are applied as the line is *reached*, never eagerly on receipt. The setting
    // is read once per line, so a mid-scene toggle cannot split a line's actions.
    const step = stepStage(stageFactsOf(state), next, stageContextOf(state))

    // The first happy face she puts on this turn is worth a coin toss, and a won toss throws
    // sparkles off her — only for somebody the line leaves standing on the stage at that action,
    // and never before the reader has acted in the scene, so an opening reply never chimes.
    let brightened = state.brightened
    let sparkle = state.sparkle
    for (const { charId, standing } of step.happyFaces) {
      if (brightened.includes(charId)) continue
      brightened = [...brightened, charId]
      if (state.sceneActed && standing && rollsSparkle(Math.random)) {
        sparkle = { charId, key: (sparkle?.key ?? 0) + 1 }
      }
    }

    // A name is learned from the line that says it, whoever is speaking. Scanned as the line is
    // committed, so the tag on that very line already reads her name.
    let charInfo = state.charInfo
    for (const charId of state.cast) {
      const info = charInfo[charId]
      const character = state.characters[charId]
      if (!info || info.nameKnown || !character) continue
      if (!namesCharacter(next.text, character.firstName)) continue
      if (charInfo === state.charInfo) charInfo = { ...charInfo }
      charInfo[charId] = { ...info, nameKnown: true }
    }

    // A wardrobe is learned from the line that puts her in it, on the same copy-on-write:
    // first-seen order, and never the same set twice. Her page offers the wardrobes she has been
    // seen in.
    for (const [charId, seen] of step.wardrobesSeen) {
      const info = charInfo[charId]
      if (!info || info.seenOutfits?.includes(seen)) continue
      if (charInfo === state.charInfo) charInfo = { ...charInfo }
      charInfo[charId] = { ...info, seenOutfits: [...(info.seenOutfits ?? []), seen] }
    }

    set({
      pendingLines: rest,
      charInfo,
      currentLine: next,
      ...step.stage,
      brightened,
      sparkle,
      // A line that names a background ends the player's own pick — tested against `undefined`,
      // like the scene's own `bg`.
      bgOverride: next.bg !== undefined ? null : state.bgOverride,
      // Logged as reached, not as received, so the log never spoils a queued line.
      sceneLog: [...state.sceneLog, next]
    })
    return true
  },

  settleDepartures: () =>
    set((state) => {
      if (Object.keys(state.offStage).length === 0) return {}
      const { offStage, departed, settled } = chargeAbsences(state.offStage, state.departed)
      let stageOverride = state.stageOverride
      let outfitLock = state.outfitLock
      for (const charId of settled) {
        // The manual layer does not outlive a departure: her override and lock go too.
        if (charId in stageOverride) {
          if (stageOverride === state.stageOverride) stageOverride = { ...stageOverride }
          delete stageOverride[charId]
        }
        if (charId in outfitLock) {
          if (outfitLock === state.outfitLock) outfitLock = { ...outfitLock }
          delete outfitLock[charId]
        }
      }
      return { offStage, departed, stageOverride, outfitLock }
    }),

  toggleStageChar: (charId) =>
    set((state) => {
      // Read off the displayed stage, written only to `stageOverride`. Hiding by hand opens no
      // absence and starts no departure — the clock belongs to the model's own `hide:`.
      const displayed = displaySlotsOf(state.slots, state.stageOverride)
      const want = !displayed.includes(charId)
      const stageOverride = { ...state.stageOverride }
      const noNsfwImages = noNsfwImagesOf(useSettingsStore.getState())
      const retireCtx = { outfitReady: state.outfitReady, noNsfwImages }

      // Pressing again on a show that never found room cancels it.
      if (stageOverride[charId] === want) {
        delete stageOverride[charId]
        return { stageOverride }
      }
      // A full stage has nowhere to put her: the three slots are the stage.
      if (want && displayed.indexOf(null) === -1) return {}

      // Only disagreements are held: agreeing with the scene deletes the entry.
      if (want === state.slots.includes(charId)) delete stageOverride[charId]
      else stageOverride[charId] = want

      // The same rule the scene's own `show:`/`hide:` keep: a CG is one girl alone, and it
      // ends when the hand puts somebody beside her or takes her away.
      const emotions = want
        ? retireCgs(
            state.emotions,
            displayed.filter((id): id is string => Boolean(id) && id !== charId),
            retireCtx
          )
        : retireCgs(state.emotions, [charId], retireCtx)

      // A manual newcomer mirrors on the same terms `advanceLine` decides it; `flipped` is a
      // rendering fact no prompt reads.
      if (want && !(charId in state.flipped)) {
        const pose = state.characters[charId]?.pose
        if (
          pose &&
          displayed.some((id) => id && id !== charId && state.characters[id]?.pose === pose)
        ) {
          return { stageOverride, emotions, flipped: { ...state.flipped, [charId]: true } }
        }
      }
      return { stageOverride, emotions }
    }),

  setBgOverride: (bg) => set({ bgOverride: bg }),

  setOutfitLock: (charId, lock) =>
    set((state) => {
      const outfitLock = { ...state.outfitLock }
      // Not checked against `outfitReady`: a stale lock degrades in `displaySpriteRef`, not here.
      if (lock) outfitLock[charId] = lock
      else delete outfitLock[charId]
      return { outfitLock }
    }),

  clearStage: () =>
    set({
      ...freshStage(),
      pendingLines: [],
      currentLine: null,
      streaming: false,
      waitingForLine: false,
      closingError: null,
      ledgerError: null,
      textLedgerError: null,
      introError: null,
      turnError: null,
      classifierError: null,
      inputDraft: ''
    }),

  advanceSlot: () =>
    set((state) => {
      const nextTime: TimeSlot = state.time === 0 ? 1 : 0
      const nextDate = state.time === 1 ? state.date + 1 : state.date
      return { time: nextTime, date: nextDate }
    }),

  applyStatDeltas: (deltas) =>
    set((state) => ({ stats: applyStatDeltas(state.stats, deltas) })),

  setBio: (bio) => set({ bio }),

  recordActs: (acts) => set((state) => ({ tallies: talliesAfterActs(state.tallies, acts) })),

  spendMoney: (amount) => set((state) => ({ money: state.money - amount })),

  buyItem: (itemId, price) =>
    set((state) => ({
      inventory: addItem(state.inventory, itemId),
      // No affordability check: buying past the debt floor ends the playthrough at the next
      // slot opening, or on the epilogue's next button.
      money: state.money - price
    })),

  giftItem: (charId, itemId) => {
    const state = get()
    // Stamped now: once the boundary has folded this gift into `charInfo`, the same question
    // would answer yes about the gift itself.
    const repeat =
      (state.charInfo[charId]?.gifts ?? []).includes(itemId) ||
      state.sceneGifts.some((gift) => gift.charId === charId && gift.itemId === itemId)
    // The verdict is stamped here and nowhere else: the action line says it out loud.
    const item = itemDefOf(itemId)
    const reaction: GiftReaction = item
      ? giftReactionOf(item, state.characters[charId], repeat)
      : 'neutral'
    set({
      inventory: removeItem(state.inventory, itemId),
      sceneGifts: [...state.sceneGifts, { charId, itemId, repeat, reaction }]
    })
    return reaction
  },

  ungiftItem: () =>
    set((state) => {
      const last = state.sceneGifts[state.sceneGifts.length - 1]
      if (!last) return {}
      return {
        inventory: addItem(state.inventory, last.itemId),
        sceneGifts: state.sceneGifts.slice(0, -1)
      }
    }),

  recordGifts: () =>
    set((state) => {
      if (state.sceneGifts.length === 0) return {}
      const charInfo = { ...state.charInfo }
      for (const gift of state.sceneGifts) {
        const existing = charInfo[gift.charId] ?? blankCharInfo()
        const item = itemDefOf(gift.itemId)
        const character = state.characters[gift.charId]
        const reaction = gift.reaction
        charInfo[gift.charId] = {
          ...existing,
          // Uncapped: the list never forgets a present.
          gifts: [...(existing.gifts ?? []), gift.itemId],
          // Only what she was glad to get; a present that missed is not a grievance.
          giftMemories:
            item && (reaction === 'loved' || reaction === 'liked')
              ? withGiftMemory(
                  existing.giftMemories ?? [],
                  { date: state.date, type: reaction, desc: giftMemoryDesc(item) },
                  giftMemoryCapFor(character)
                )
              : existing.giftMemories
        }
      }
      return { charInfo }
    }),

  clearSceneGifts: () => set({ sceneGifts: [] }),

  recordMemory: (charId, entry) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) => ({
        ...info,
        // Oldest out first.
        memories: [...info.memories, entry].slice(-MEMORY_CAP)
      }))
    ),

  replaceMemory: (charId, match, next) =>
    set((state) =>
      patchCharInfo(state, charId, (info) => (info ? withMemoryReplaced(info, match, next) : null))
    ),

  setCrush: (charId) =>
    set((state) =>
      patchCharInfo(state, charId, (info) => {
        // Nobody is invented. Null on a girl who already has one keeps her `CharInfo`'s object
        // identity, so a replayed boundary is free.
        if (!info) return null
        const flags = info.flags ?? emptyFlags()
        if (flags.hasCrush) return null
        return { ...info, flags: { ...flags, hasCrush: true } }
      })
    ),

  setSuspicions: (charId, records) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) => {
        // Null on a list she already holds keeps her `CharInfo`'s object identity, so a
        // replayed boundary writing the same records costs nothing.
        if (records.length === 0) {
          if (info.suspicions === undefined) return null
          const { suspicions: _emptied, ...rest } = info
          return rest
        }
        if (sameSuspicions(info.suspicions, records)) return null
        return { ...info, suspicions: [...records] }
      })
    ),

  setJealousyMemories: (charId, entries) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) =>
        sameMemories(info.jealousyMemories, entries)
          ? null
          : { ...info, jealousyMemories: [...entries] }
      )
    ),

  setTextMemory: (charId, entry) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) => ({ ...info, textMemory: entry }))
    ),

  setCrushHint: (charId, hint) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) => ({ ...info, crushHint: hint }))
    ),

  // The fold lives in `shared/relationship`, shared with the ending's projection.
  applyRelationshipEvents: (charId, events) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) =>
        foldRelationshipEvents(info, events, state.date)
      )
    ),

  // The pass lives in `shared/dating`, shared with the ending's projection.
  applyDatingSettle: (outcome) =>
    set((state) =>
      Object.keys(outcome.charInfo).length === 0
        ? {}
        : { charInfo: { ...state.charInfo, ...outcome.charInfo } }
    ),

  markMet: (charIds) =>
    set((state) => {
      const charInfo = { ...state.charInfo }
      for (const charId of charIds) {
        const existing = charInfo[charId] ?? blankCharInfo()
        const flags = existing.flags ?? emptyFlags()
        if (flags.hasMet) continue
        charInfo[charId] = {
          ...existing,
          flags: { ...flags, hasMet: true },
          // Oldest thing she knows about the reader, so it goes in front.
          memories: [firstImpression(existing.memories, state.date), ...existing.memories]
        }
      }
      return { charInfo }
    }),

  markSeenAt: (charIds, slot) => {
    const state = get()
    const charInfo = { ...state.charInfo }
    // Whoever this hour was genuinely new for — what earns the reader BunnyMap.
    const added: string[] = []
    for (const charId of charIds) {
      const existing = charInfo[charId] ?? blankCharInfo()
      const seen = existing.metSlots ?? []
      // A set union, kept ascending, so a replayed boundary writes the same bytes.
      if (seen.includes(slot)) continue
      charInfo[charId] = { ...existing, metSlots: [...seen, slot].sort((a, b) => a - b) }
      added.push(charId)
    }
    if (added.length > 0) set({ charInfo })
    return added
  },

  refreshDerivedFlags: (charIds) =>
    set((state) => {
      const charInfo = { ...state.charInfo }
      for (const charId of charIds) {
        const existing = charInfo[charId]
        if (!existing) continue
        const flags = refreshedFlags(
          existing.flags ?? emptyFlags(),
          affectionFor(existing, state.date, state.characters[charId])
        )
        if (flags === existing.flags) continue
        charInfo[charId] = { ...existing, flags }
      }
      return { charInfo }
    }),

  appendChatMessage: (charId, message, unreadDelta) =>
    set((state) =>
      patchConversation(state, charId, (chat) => ({
        ...chat,
        messages: [...chat.messages, message],
        unread: chat.unread + unreadDelta
      }))
    ),

  markConversationRead: (charId) =>
    set((state) =>
      patchConversation(state, charId, (chat) => (chat.unread === 0 ? null : { ...chat, unread: 0 }))
    ),

  setConversationSummary: (charId, summary) =>
    set((state) => patchConversation(state, charId, (chat) => ({ ...chat, summary }))),

  setPendingHangout: (charId, hangout) =>
    set((state) =>
      patchConversation(state, charId, (chat) => {
        const next: Conversation = { ...chat }
        if (hangout) next.pendingHangout = hangout
        else delete next.pendingHangout
        return next
      })
    ),

  markInvitation: (charId) =>
    set((state) =>
      patchConversation(state, charId, (chat) => {
        const last = chat.messages[chat.messages.length - 1]
        if (!last || last.sender !== 'contact' || last.invite) return null
        const messages = [...chat.messages]
        messages[messages.length - 1] = { ...last, invite: true }
        return { ...chat, messages }
      })
    ),

  bumpDeclined: (charId) =>
    set((state) =>
      patchConversation(state, charId, (chat) => ({ ...chat, declined: (chat.declined ?? 0) + 1 }))
    ),

  resetDeclined: (charId) =>
    set((state) =>
      patchConversation(state, charId, (chat) => {
        if (chat.declined === undefined && chat.turnedDown === undefined) return null
        const next: Conversation = { ...chat }
        delete next.declined
        delete next.turnedDown
        return next
      })
    ),

  setTurnedDown: (charId) =>
    set((state) =>
      patchConversation(state, charId, (chat) =>
        chat.turnedDown ? null : { ...chat, turnedDown: true }
      )
    ),

  clearTurnedDown: (charId) =>
    set((state) =>
      patchConversation(state, charId, (chat) => {
        if (!chat.turnedDown) return null
        const next: Conversation = { ...chat }
        delete next.turnedDown
        return next
      })
    ),

  markRequestSent: (charId) =>
    set((state) => {
      if (state.bunnyboard.requestsSent.includes(charId)) return {}
      return {
        bunnyboard: {
          ...state.bunnyboard,
          requestsSent: [...state.bunnyboard.requestsSent, charId]
        }
      }
    }),

  receiveRequest: (charId) =>
    set((state) => {
      if (state.bunnyboard.requestsReceived.includes(charId)) return {}
      return {
        bunnyboard: {
          ...state.bunnyboard,
          requestsReceived: [...state.bunnyboard.requestsReceived, charId],
          contactsBadge: state.bunnyboard.contactsBadge + 1
        }
      }
    }),

  resolveRequest: (charId) =>
    set((state) => ({
      bunnyboard: {
        ...state.bunnyboard,
        requestsSent: state.bunnyboard.requestsSent.filter((id) => id !== charId),
        requestsReceived: state.bunnyboard.requestsReceived.filter((id) => id !== charId)
      }
    })),

  clearContactsBadge: () =>
    set((state) => {
      if (state.bunnyboard.contactsBadge === 0) return {}
      return { bunnyboard: { ...state.bunnyboard, contactsBadge: 0 } }
    }),

  setSuggestions: (charIds) =>
    set((state) => ({ bunnyboard: { ...state.bunnyboard, suggestions: [...charIds] } })),

  appendFeedPost: (charId, post) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) => ({
        ...info,
        feed: [...(info.feed ?? []), post]
      }))
    ),

  toggleFeedLike: (charId, postId) =>
    set((state) =>
      patchCharInfo(state, charId, (info) => {
        if (!info?.feed?.some((post) => post.id === postId)) return null
        return {
          ...info,
          feed: info.feed.map((post) => {
            if (post.id !== postId) return post
            if (post.liked) {
              // Absent means "he has not" for both fields.
              const { liked: _liked, likedOn: _likedOn, ...rest } = post
              return rest
            }
            return { ...post, liked: true, likedOn: state.date }
          })
        }
      })
    ),

  toggleRandomPostLike: () =>
    set((state) => {
      const extras = state.feedExtras
      if (!extras?.randomPost) return {}
      return {
        feedExtras: {
          ...extras,
          randomPost: { ...extras.randomPost, liked: !extras.randomPost.liked }
        }
      }
    }),

  setFeedExtras: (extras) => set({ feedExtras: extras }),

  setGaveContactInfo: (charId) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) => {
        const flags = info.flags ?? emptyFlags()
        return flags.gaveContactInfo ? null : { ...info, flags: { ...flags, gaveContactInfo: true } }
      })
    ),

  setNameKnown: (charId) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) =>
        info.nameKnown ? null : { ...info, nameKnown: true }
      )
    ),

  setBlocked: (charId, value) =>
    set((state) =>
      patchCharInfo(state, charId, (info = blankCharInfo()) => {
        const flags = info.flags ?? emptyFlags()
        return flags.blocked === value ? null : { ...info, flags: { ...flags, blocked: value } }
      })
    ),

  setIgnoredInvitation: (charId, value) =>
    set((state) =>
      patchCharInfo(state, charId, (info) =>
        !info || (info.ignoredInvitation ?? false) === value
          ? null
          : { ...info, ignoredInvitation: value }
      )
    ),

  clearNewJobNotice: (charId) =>
    set((state) =>
      patchCharInfo(state, charId, (info) => {
        if (!info?.job?.newJobNotice) return null
        // The same test the injection makes (`newJobLine`): a scene before her start day
        // never carried the news.
        if ((info.job.startsOn ?? 0) > state.date) return null
        const { newJobNotice: _spent, ...job } = info.job
        return { ...info, job }
      })
    ),

  addEvents: (events) =>
    set((state) => (events.length === 0 ? {} : { events: [...state.events, ...events] })),

  markEventsSeen: () =>
    set((state) => {
      // Same-object return when there is nothing new, so the save is not dirtied.
      if (state.events.every((event) => event.seen)) return {}
      return { events: state.events.map((event) => (event.seen ? event : { ...event, seen: true })) }
    }),

  markEventNoShow: (eventId, charIds) =>
    set((state) => {
      const index = state.events.findIndex((event) => event.id === eventId)
      if (index < 0) return {}
      const events = [...state.events]
      events[index] = { ...events[index], noShow: [...charIds] }
      return { events }
    }),

  rescheduleEvent: (eventId, date, time) =>
    set((state) => {
      const index = state.events.findIndex((event) => event.id === eventId)
      if (index < 0) return {}
      const event = state.events[index]
      // Same-object return on a move that moves nothing. A plan already stood up is history and
      // does not move.
      if (event.noShow || (event.date === date && event.time === time)) return {}
      const events = [...state.events]
      // `madeOn` and `seen` are kept: the player picked the new slot himself.
      events[index] = { ...event, date, time }
      return { events }
    }),

  takeJob: (jobId, shifts, settledThrough) =>
    set({ job: newJobState(jobId, [...shifts], settledThrough) }),

  recordShiftWorked: (slotId, pay) => {
    const { job, tallies } = get()
    if (!job) return false
    // A slot is credited once however often the boundary is replayed, and the same guard is what
    // makes the lifetime tallies below credit it once too.
    if (job.workedSlots.includes(slotId)) return false

    const streak = job.streak + 1
    // A raise every `RAISE_EVERY` clean shifts, up to the ceiling. `streak` counts since the last
    // raise *or* strike.
    const raised = streak % RAISE_EVERY === 0 && job.raises < MAX_RAISES
    set({
      job: {
        ...job,
        shiftsWorked: job.shiftsWorked + 1,
        earned: job.earned + pay,
        streak,
        raises: raised ? job.raises + 1 : job.raises,
        workedSlots: [...job.workedSlots, slotId]
      },
      tallies: {
        ...tallies,
        moneyEarned: tallies.moneyEarned + pay,
        shiftsWorked: tallies.shiftsWorked + 1
      }
    })
    return raised
  },

  recordStrike: (slotId) =>
    set((state) => {
      if (!state.job) return {}
      return {
        job: {
          ...state.job,
          strikes: state.job.strikes + 1,
          streak: 0,
          settledThrough: Math.max(state.job.settledThrough, slotId)
        }
      }
    }),

  updateJob: (patch) =>
    set((state) => (state.job ? { job: { ...state.job, ...patch } } : {})),

  endJob: () =>
    set((state) => {
      if (!state.job) return {}
      const { jobId } = state.job
      return {
        job: null,
        jobsClosed: state.jobsClosed.includes(jobId)
          ? state.jobsClosed
          : [...state.jobsClosed, jobId]
      }
    }),

  recordClassMeeting: (code, meeting) =>
    set((state) => {
      const record = state.classRecords[code] ?? { meetings: [] }
      // The date is the identity of the meeting; a replayed boundary is inert.
      if (record.meetings.some((entry) => entry.date === meeting.date)) return {}
      return {
        classRecords: {
          ...state.classRecords,
          [code]: {
            ...record,
            meetings: [...record.meetings, { ...meeting }].sort((a, b) => a.date - b.date)
          }
        }
      }
    }),

  recordExam: (code, exam, examRecord) =>
    set((state) => {
      const record = state.classRecords[code] ?? { meetings: [] }
      if (record[exam]) return {}
      return {
        classRecords: { ...state.classRecords, [code]: { ...record, [exam]: { ...examRecord } } }
      }
    }),

  recordProjectWork: (code, exam, date, time, summary) =>
    set((state) => {
      const record = state.classRecords[code] ?? { meetings: [] }
      const key = exam === 'midterm' ? 'midtermProject' : 'finalProject'
      const project = record[key] ?? { sessions: [] }
      if (project.sessions.some((session) => session.date === date && session.time === time))
        return {}
      const session = { date, time, ...(summary ? { summary } : {}) }
      return {
        classRecords: {
          ...state.classRecords,
          [code]: {
            ...record,
            [key]: {
              sessions: [...project.sessions, session].sort(
                (a, b) => a.date - b.date || a.time - b.time
              )
            }
          }
        }
      }
    }),

  setClassScore: (code, exam, score, heartTier) =>
    set((state) => {
      const record = state.classRecords[code] ?? { meetings: [] }
      const key = exam === 'midterm' ? 'midtermScore' : 'finalScore'
      if (typeof record[key] === 'number') return {}
      const tierKey = exam === 'midterm' ? 'midtermHeartTier' : 'finalHeartTier'
      return {
        classRecords: {
          ...state.classRecords,
          [code]: {
            ...record,
            [key]: score,
            ...(heartTier !== undefined ? { [tierKey]: heartTier } : {})
          }
        }
      }
    }),

  setGradesStanding: (standing) => set({ gradesStanding: standing }),

  setExpelled: () => set({ expelled: true }),

  setMidtermStandingDone: () => set({ midtermStandingDone: true }),

  setFinalsScoresShown: () => set({ finalsScoresShown: true }),

  setPlayerSchedule: (schedule) => set({ playerSchedule: { ...schedule } }),

  recordDroppedClasses: (codes) =>
    set((state) => {
      const fresh = codes.filter((code) => !state.droppedClasses[code])
      if (fresh.length === 0) return {}
      const dropped = { ...state.droppedClasses }
      for (const code of fresh) dropped[code] = { announced: false, date: state.date }
      return { droppedClasses: dropped }
    }),

  markDropAnnounced: (code) =>
    set((state) => {
      const record = state.droppedClasses[code]
      if (!record || record.announced) return {}
      return {
        droppedClasses: { ...state.droppedClasses, [code]: { ...record, announced: true } }
      }
    }),

  recordAddedClasses: (codes) =>
    set((state) => {
      const fresh = codes.filter((code) => !state.addedClasses[code])
      if (fresh.length === 0) return {}
      const added = { ...state.addedClasses }
      for (const code of fresh) added[code] = { announced: false, date: state.date }
      return { addedClasses: added }
    }),

  markAddAnnounced: (code) =>
    set((state) => {
      const record = state.addedClasses[code]
      if (!record || record.announced) return {}
      return { addedClasses: { ...state.addedClasses, [code]: { ...record, announced: true } } }
    }),

  advanceVenusThrough: (slot) =>
    set((state) => (slot > state.venusThrough ? { venusThrough: slot } : {})),

  advanceBunnybotThrough: (slot) =>
    set((state) => (slot > state.bunnybotThrough ? { bunnybotThrough: slot } : {})),

  unlockBunnymap: () => set((state) => (state.bunnymapUnlocked ? {} : { bunnymapUnlocked: true })),

  unlockBunnyshop: () =>
    set((state) => (state.bunnyshopUnlocked ? {} : { bunnyshopUnlocked: true })),

  markVenusJobIntroSent: () =>
    set((state) => (state.venusJobIntroSent ? {} : { venusJobIntroSent: true })),

  markBunnybotContactIntroSent: () =>
    set((state) => (state.bunnybotContactIntroSent ? {} : { bunnybotContactIntroSent: true })),

  markBunnybotFirstPostNudgeSent: () =>
    set((state) => (state.bunnybotFirstPostNudgeSent ? {} : { bunnybotFirstPostNudgeSent: true })),

  markBunnybotTwoTimingTipSent: () =>
    set((state) => (state.bunnybotTwoTimingTipSent ? {} : { bunnybotTwoTimingTipSent: true })),

  markBunnybotSeenTipSent: () =>
    set((state) => (state.bunnybotSeenTipSent ? {} : { bunnybotSeenTipSent: true })),

  queueBunnybotDeferred: (handover) =>
    set((state) =>
      state.bunnybotDeferred.includes(handover)
        ? {}
        : { bunnybotDeferred: [...state.bunnybotDeferred, handover] }
    ),

  clearBunnybotDeferred: () =>
    set((state) => (state.bunnybotDeferred.length === 0 ? {} : { bunnybotDeferred: [] })),

  setNpcRelationships: (relationships) => set({ npcRelationships: { ...relationships } }),

  setNpcOverlay: (overlay) => set({ npcOverlay: overlay }),

  recordNpcFriendships: (pairs) =>
    set((state) => ({ npcFriendships: [...state.npcFriendships, ...pairs] })),

  setSlotRumor: (rumor) => set({ slotRumor: rumor }),

  markOccasionDeclined: (occasionId) =>
    set((state) => {
      if (state.occasionsDeclined.includes(occasionId)) return {}
      return { occasionsDeclined: [...state.occasionsDeclined, occasionId] }
    }),

  recordLastSlotCast: () =>
    set((state) => ({
      lastSlotCast: { date: state.date, time: state.time, charIds: [...state.cast] }
    })),

  recordWeekendOutings: (charIds, saturday) =>
    set((state) => {
      if (charIds.length === 0) return {}
      const next = { ...state.weekendOutings }
      for (const charId of charIds) next[charId] = saturday
      return { weekendOutings: next }
    }),

  recordOutingSlots: (charIds, slotId) =>
    set((state) => {
      if (charIds.length === 0) return {}
      const next = { ...state.outingSlots }
      for (const charId of charIds) next[charId] = slotId
      return { outingSlots: next }
    }),

  setSpringBreakAway: (charIds) => set({ springBreakAway: [...charIds] }),

  markGraduationSeen: () => set({ graduationSeen: true }),

  markEndingArtWanted: () => set({ endingArtWanted: true }),

  recordFarewell: (charId) =>
    set((state) =>
      state.farewellsDone.includes(charId)
        ? {}
        : { farewellsDone: [...state.farewellsDone, charId] }
    ),

  withdrawFromEvents: (charIds, fromDate, toDate) =>
    set((state) => {
      if (charIds.length === 0) return {}
      const leaving = new Set(charIds)
      let touched = false
      const events: CalendarEvent[] = []
      for (const event of state.events) {
        if (event.date < fromDate || event.date >= toDate) {
          events.push(event)
          continue
        }
        const kept = event.charIds.filter((charId) => !leaving.has(charId))
        if (kept.length === event.charIds.length) {
          events.push(event)
          continue
        }
        touched = true
        if (kept.length > 0) events.push({ ...event, charIds: kept })
      }
      // Same-object return when nothing moved, so the save is not dirtied.
      return touched ? { events } : {}
    }),

  setSceneQuiz: (quiz) => set({ sceneQuiz: quiz ? { ...quiz } : null }),

  answerQuiz: (correct) =>
    set((state) =>
      state.sceneQuiz
        ? {
            sceneQuiz: {
              ...state.sceneQuiz,
              index: state.sceneQuiz.index + 1,
              correct: state.sceneQuiz.correct + (correct ? 1 : 0)
            }
          }
        : {}
    ),

  toGameSave: () => {
    const state = get()
    return {
      schemaVersion: 12 as const,
      stats: state.stats,
      money: state.money,
      bio: state.bio,
      tallies: state.tallies,
      date: state.date,
      time: state.time,
      // The settled half is the record's and is never written twice.
      charInfo: Object.fromEntries(
        Object.entries(state.charInfo).map(([charId, info]) => [charId, charStateOf(info)])
      ),
      playerSchedule: state.playerSchedule,
      history: state.history,
      bunnyboard: state.bunnyboard,
      events: state.events,
      job: state.job,
      jobsClosed: state.jobsClosed,
      inventory: state.inventory,
      classRecords: state.classRecords,
      gradesStanding: state.gradesStanding,
      expelled: state.expelled,
      midtermStandingDone: state.midtermStandingDone,
      finalsScoresShown: state.finalsScoresShown,
      venusThrough: state.venusThrough,
      bunnybotThrough: state.bunnybotThrough,
      bunnymapUnlocked: state.bunnymapUnlocked,
      bunnyshopUnlocked: state.bunnyshopUnlocked,
      venusJobIntroSent: state.venusJobIntroSent,
      bunnybotContactIntroSent: state.bunnybotContactIntroSent,
      bunnybotFirstPostNudgeSent: state.bunnybotFirstPostNudgeSent,
      bunnybotTwoTimingTipSent: state.bunnybotTwoTimingTipSent,
      bunnybotSeenTipSent: state.bunnybotSeenTipSent,
      bunnybotDeferred: state.bunnybotDeferred,
      droppedClasses: state.droppedClasses,
      addedClasses: state.addedClasses,
      npcRelationships: state.npcRelationships,
      npcFriendships: state.npcFriendships,
      occasionsDeclined: state.occasionsDeclined,
      npcOverlay: state.npcOverlay,
      slotRumor: state.slotRumor,
      lastSlotCast: state.lastSlotCast,
      weekendOutings: state.weekendOutings,
      outingSlots: state.outingSlots,
      springBreakAway: state.springBreakAway,
      feedExtras: state.feedExtras,
      graduationSeen: state.graduationSeen,
      farewellsDone: state.farewellsDone,
      endingArtWanted: state.endingArtWanted,
      scene: get().captureScene()
    }
  }
}))

/** The stored conversation with `charId`, or a fresh empty one. */
function conversationWith(bunnyboard: BunnyboardState, charId: string): Conversation {
  return (
    bunnyboard.conversations[charId] ?? { charId, messages: [], unread: 0, summary: null }
  )
}

/** The memory written the first time a character meets the reader; it dates the meeting. */
function firstImpression(memories: readonly CharMemory[], date: number): CharMemory {
  const bad = memories[0]?.type === 'disliked' || memories[0]?.type === 'hated'
  return bad
    ? { date, type: 'disliked', desc: 'the reader made a bad first impression on her' }
    : { date, type: 'liked', desc: 'the reader made a good first impression on her' }
}

/**
 * Whether `text` says `firstName` out loud — the one definition of "this names her", shared by
 * the scene scan above and the loop's pre-send guard.
 */
export function namesCharacter(text: string, firstName: string): boolean {
  const name = firstName.trim()
  if (!name) return false
  return namePattern(name).test(text)
}

/** The compiled pattern for one first name, cached for the session. */
const namePatterns = new Map<string, RegExp>()
function namePattern(name: string): RegExp {
  let pattern = namePatterns.get(name)
  if (!pattern) {
    pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i')
    namePatterns.set(name, pattern)
  }
  return pattern
}

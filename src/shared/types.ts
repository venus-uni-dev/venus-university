/** Shared on-disk schema and IPC result types. */

// Type-only, so the import cycles erase: most of these modules import back from here.
import type { ServiceTier, ThinkingLevel } from './providers'
import type { LedgerStats, PlayerStats, StatKey, StatTier } from './playerStats'
import type { ClassDifficulty, ClassKind, ExamPeriod, Professor } from './academics'
import type { CharacterTrait } from './traits'
import type { GiftPreferences, GiftReaction } from './shop'
import type { NpcFriendship, NpcRelationshipMap, NpcSlotOverlay } from './npcRelationships'
import type { PromptKind } from './promptKinds'
import type { RumorPassOutcome } from './rumors'
import type { DormId } from './dorms'
import type { AudioGroup } from './audio'
import type { Weather } from './weather'

/** Discriminated result envelope returned by every IPC handler. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

/** Error shape carried inside a failed {@link Result}. Never thrown across the IPC bridge. */
export interface AppError {
  code: string
  message: string
  detail?: string
}

/** The level column of one record in `data/app.log`. */
export type LogLevel = 'LOG' | 'WARN' | 'ERROR'

/** Every {@link LogLevel}, for checking one that arrived from outside the type system. */
const LOG_LEVELS: readonly LogLevel[] = ['LOG', 'WARN', 'ERROR']

/** True for a value that is one of {@link LOG_LEVELS}. */
export function isLogLevel(value: unknown): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel)
}

/** The longest forwarded console record either side keeps. */
export const MAX_LOG_RECORD_CHARS = 32 * 1024

/**
 * A structured-output request: prompts plus the schema the reply must match — what every
 * structured cloud call carries from the renderer's prompt builders to the adapters.
 */
export interface StructuredRequest {
  system: string
  user: string
  /** JSON Schema the reply is constrained to. */
  schema: { name: string; schema: Record<string, unknown> }
  /** Advisory prompt-cache affinity key for providers that expose one. */
  cacheKey?: string
  /**
   * Which call this is, for the one setting that routes by it: the secondary model.
   * Absent on every call that is never routed, which is most of them.
   */
  kind?: PromptKind
  /**
   * The least effort this call runs at — a stored level below it is raised to it; absent on
   * every call that takes the setting as it is.
   */
  minThinking?: ThinkingLevel
  /** Images attached to the user turn, base64 without the `data:` prefix. */
  images?: ReferenceImage[]
  /**
   * Where the console log's copy of `user` starts: the offset past a preamble that never varies
   * for this `cacheKey` — rules and vocabularies a reader of the log has seen on every call
   * before. Absent logs the whole message.
   */
  logFrom?: number
}

/** One inline image on a {@link StructuredRequest} — never written to disk. */
export interface ReferenceImage {
  mimeType: string
  /** Base64 payload only; the `data:<mime>;base64,` prefix is stripped by the caller. */
  data: string
}

/** The seven sprite expressions a character can be generated in. */
export type Emotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'embarrassed'
  | 'aroused'

/**
 * The eight sexual positions a character can have a CG rendered in. One travels as a
 * {@link SpriteRef} in place of an emotion, and showing one swaps the stage for her CG.
 */
export type Position =
  | 'nude_foreplay'
  | 'nude_foreplay_after'
  | 'sex'
  | 'sex_after'
  | 'handjob'
  | 'handjob_after'
  | 'fellatio'
  | 'fellatio_after'

/**
 * The three alternate wardrobes a character can have sprites rendered in. A set rides in
 * a `sprite:` action suffixed onto an {@link Emotion} — `happy_pe` — and picks the folder.
 */
export type OutfitSet = 'pe' | 'swim' | 'nude'

/**
 * The optional image sets that carry a seed-provenance flag: the three wardrobes plus
 * the CG set, which renders with the nude wardrobe and rerolls with it.
 */
export type SeededSet = OutfitSet | 'cg'

/**
 * One set of a character's images, as the Edit modal's controls address them: the default
 * wardrobe, one of the three alternates, the CGs, or the room backgrounds.
 */
export type SetTarget = 'default' | OutfitSet | 'cgs' | 'room'

/**
 * The sets made of sprites — every `SetTarget` but the CGs and the room — which is what the
 * transparency editor repairs.
 */
export type WardrobeTarget = 'default' | OutfitSet

/**
 * Which repair a wardrobe's kept paint layer is: the strokes painted *under* its sprites
 * against chroma green, or the ones painted *over* them to place a finger.
 */
export type WardrobeLayer = 'fix' | 'hands'

/**
 * One repaired sprite on its way back to disk: PNG bytes as base64 without the `data:`
 * prefix, written over that emotion's file.
 */
export interface WardrobeFixImage {
  emotion: Emotion
  data: string
}

/**
 * What one hand fix rendered: the re-detailed hand cut out of the frame, and the
 * region it changed. The renderer clears the region on each sprite and lays the cutout in it,
 * so an old blob finger goes where the new hand has a gap.
 */
export interface HandFixResult {
  cutout: Uint8Array<ArrayBuffer>
  region: Uint8Array<ArrayBuffer>
}

/**
 * Where her portrait is cut out of her neutral sprite: a rectangle in that sprite's own
 * pixels, at the archway's ratio. `seed` is the `generationSeed` it was framed under, which is
 * what retires it when she is regenerated into a different girl.
 */
export interface ProfileCrop {
  seed: number
  x: number
  y: number
  width: number
  height: number
}

/** What the crop modal opens on: what is stored, what the frame would be, and the sprite. */
export interface ProfileCropInfo {
  stored: ProfileCrop | null
  suggested: ProfileCrop
  width: number
  height: number
}

/**
 * A player-side wardrobe lock: the default wardrobe or one alternate set. It remaps what
 * the stage *renders* and nothing else; the model is never told about it.
 */
export type OutfitLock = 'default' | OutfitSet

/**
 * Everything a `sprite:`/`cg:` action and the stage's sticky map may hold: a bare emotion, an
 * emotion suffixed with an outfit set, or a position, which shows a CG.
 */
export type SpriteRef = Emotion | Position | `${Emotion}_${OutfitSet}`

/** Two time slots per game day: 0 = day, 1 = night. */
export type TimeSlot = 0 | 1

/** Kind of memory recorded against a character at scene end. */
export type MemoryType = 'liked' | 'disliked' | 'loved' | 'hated'

/** Every {@link MemoryType}, in schema and prompt order. */
export const MEMORY_TYPES: readonly MemoryType[] = ['liked', 'disliked', 'loved', 'hated']

/**
 * How a character behaves at each stage of a relationship: third-person prose naming her
 * and the stage, injected into prompts verbatim.
 */
export interface CharacterBehavior {
  withStrangers: string
  withFriends: string
  withCrush: string
  withLover: string
  withEnemy: string
}

/** Which optional image sets the New Character modal asked for. */
export interface GenerateOptions {
  pe?: boolean
  swim?: boolean
  nude?: boolean
  cgs?: boolean
  room?: boolean
}

/** What the New Character modal was told, kept on her record until her sheet lands. */
export interface CharacterBrief {
  prompt: string
  namesAreSuggestions: boolean
  options: GenerateOptions
  /** True when a reference picture sits beside the record as `reference`. */
  reference: boolean
}

/** On-disk character definition — `/data/characters/{charId}/character.json`. */
export interface Character {
  schemaVersion: 2
  /** crypto.randomUUID(); also the folder name under /data/characters. */
  charId: string
  firstName: string
  lastName: string
  /** One woven prose profile: presentation, true self, desire, flaw, quirks. */
  personality: string
  behavior: CharacterBehavior
  /** One formative thing in her past and how it still moves her. */
  backstory: string
  /** Her love life, in four fields. */
  datingHistory: string
  datingPreference: string
  kinks: string
  isVirgin: boolean
  /**
   * What she is drawn to and what puts her off — her tastes in food, drink, media and how she
   * spends her time, and the things that get under her skin.
   */
  likes: string[]
  dislikes: string[]
  /**
   * Which gift categories please her and which do not, weighed against an item's own
   * tags by `giftReactionOf` (`shared/shop.ts`).
   */
  giftPreferences: GiftPreferences
  /**
   * The mechanic switches the character-generation call assigned her, from the closed set in
   * `shared/traits.ts`; the Edit modal can amend them from the same vocabulary.
   */
  traits: CharacterTrait[]
  /**
   * Which of the reader's three stats she is drawn to, weighed by the crush roll in
   * `shared/relationship.ts`.
   */
  preferredStat: StatKey
  /**
   * How tall she stands on the stage, as a share of the maximum in [0.9, 1]
   * (`shared/spriteScale.ts`).
   */
  height: number
  /**
   * Her speaking voice as a multiplier in [-1, 1] on the pitch range of every loop pitched
   * to her (`shared/audio.ts`). Absent is centre: the loop as recorded.
   */
  voicePitch?: number
  /** Fixed seed used for every ComfyUI job for this character. */
  generationSeed: number
  /** Per optional set: does its next render use `generationSeed`, or a fresh one? */
  seedFollowsMain: Record<SeededSet, boolean>
  /**
   * The seed each optional set last rendered under, read when filling the gaps in a
   * partially-rendered set so every sprite of it shares one seed.
   */
  setSeeds: Partial<Record<SeededSet, number>>
  /** Booru-style appearance tags, steered by the Appendix A lists. */
  baseAppearance: string[]
  /** String that matches pose.json keys. */
  pose: string
  /** Booru-style outfit tags, steered by the Appendix A lists. */
  outfit: string[]
  /** The PE and swimsuit wardrobes, as booru-style outfit tags. */
  peOutfit: string[]
  swimOutfit: string[]
  /** String arrays of booru-style expression tags keyed by emotion. */
  expressionTags: Record<Emotion, string[]>
  /**
   * Player-authored booru tags appended to the negative of every ComfyUI render for this
   * character — sprites, wardrobes and CGs alike.
   */
  negativeTags?: string[]
  /**
   * The LLM-written continuation of `ROOM_PROMPT_PREFIX` (shared/room.ts): her dorm room,
   * described for the cloud image model.
   */
  roomPrompt: string
  /**
   * Where her portrait is cut from her neutral sprite, when the player has framed one himself;
   * absent, or stamped with a seed she no longer renders under, means the frame
   * `defaultProfileCrop` derives from her face.
   */
  profileCrop?: ProfileCrop
  /**
   * The brief she was written from, present only while `pose` is empty: what a write that
   * failed or was interrupted is rerun from. The filled record drops it.
   */
  brief?: CharacterBrief
  /**
   * Epoch ms of the last write of this file, stamped by main and never by the renderer;
   * absent on the shipped cast and on files written before the field, which read as oldest.
   */
  updatedAt?: number
}

/** A fresh generation seed. Inside 2^53 so it survives JSON without precision loss. */
export function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
}

/**
 * Builds the lowercase prompt/Scene JSON key for a character; never a file path.
 * Collapses internal whitespace so multi-word names remain echoable by the LLM.
 */
export function charKeyOf(firstName: string, lastName: string): string {
  return `${firstName}_${lastName}`.trim().replace(/\s+/g, '_').toLowerCase()
}

/**
 * The bg id a character's rendered room answers to in scene prompts: `first_last_room`.
 */
export function roomBgIdOf(char: { firstName: string; lastName: string }): string {
  return `${charKeyOf(char.firstName, char.lastName)}_room`
}

/** The available backgrounds, split by the folder they were scanned from. */
export interface BackgroundSets {
  interior: string[]
  exterior: string[]
}

/**
 * Every available bg id in one list — the flat allowlist for the schema enum and the sanitizer,
 * sorted for prompt caching.
 */
export function allBackgrounds(sets: BackgroundSets): string[] {
  return [...sets.interior, ...sets.exterior].sort()
}

/**
 * A character's display name, as prompts, saves and the UI all spell it; trimmed so a blank
 * half leaves no trailing space.
 */
export function fullNameOf(char: { firstName: string; lastName: string }): string {
  return `${char.firstName} ${char.lastName}`.trim()
}

/** The `SceneLine.speaker` of the player's own submitted action. */
export const READER_SPEAKER = 'reader'

/** A single remembered event, rendered as `"<Name> <type> that <desc>"`. */
export interface CharMemory {
  /** Game date (days elapsed) it happened. */
  date: number
  type: MemoryType
  desc: string
}

/** What an intimate act was. */
export type ActKind = 'kiss' | 'sex'

/**
 * One kiss or one night the ledger reported: who was in it (two or more is a group act) and
 * whether anybody not taking part could have seen it.
 */
export interface IntimateAct {
  kind: ActKind
  inPublic: boolean
  charIds: string[]
}

/**
 * One girl's suspicion that the reader is seeing another: the other girl, and the global slot
 * of the last sign she got; a second sign within the window makes her tell.
 */
export interface Suspicion {
  subject: string
  slot: number
}

/**
 * A weekly class meeting slot: `weekday * 2 + time`, where weekday 0 = Monday.
 * 0 = M/Day through 9 = F/Night; see `shared/classes.ts`.
 */
export type ClassSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/**
 * A weekly *shift* slot: `shiftWeekday * 2 + time`, weekday 0 = Monday. 0 = M/Day through 13 =
 * Su/Night; see `shared/jobs.ts`.
 */
export type ShiftSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13

/** Which pool a class was generated for; drives the greedy scheduler. */
export type ClassCategory = 'pe' | 'humanities' | 'arts' | 'major' | 'interest' | 'misc'

/** What every class carries, PE included. */
interface ClassEntryBase {
  /** Registrar-style code, e.g. `"BIO 210"`. Unique across the save; the class ID. */
  code: string
  name: string
  /** One-sentence catalog blurb. */
  description: string
  /** The major this class belongs to; set only for `category: 'major'`. */
  major?: string
  slot: ClassSlot
}

/** A PE class: no kind, no exams and no project — a coach runs it instead. */
export interface PeClassEntry extends ClassEntryBase {
  category: 'pe'
  /** Who runs it, rolled like a professor. Said by `fullDescriptionOf`, never stored. */
  instructor: Professor
}

/** Every other course, decorated at generation time. */
export interface CourseEntry extends ClassEntryBase {
  category: Exclude<ClassCategory, 'pe'>
  /** Lecture or project, classified by the model at generation time. */
  kind: ClassKind
  /** How hard the class is, rolled locally at generation time. */
  difficulty: ClassDifficulty
  /** Who teaches it, rolled locally. Said by `fullDescriptionOf`, never stored. */
  professor: Professor
}

/** One course, generated once per save. Keyed by `code` in {@link GameSave.classes}. */
export type ClassEntry = PeClassEntry | CourseEntry

/** One meeting of one class, as the reader lived it. */
export interface ClassMeetingRecord {
  /** The `date` the meeting fell on. Unique within a {@link ClassRecord}. */
  date: number
  /** The reader spent the slot in this class. */
  attended: boolean
  /** What happened, from the ledger's `classSummary`. Absent for a class he skipped. */
  summary?: string
  /** The one thing he learned, from the ledger's `classFactoid`. Lecture classes only, week 2 onward. */
  factoid?: string
}

/** A sat exam: how many questions were asked and how many he got right. */
export interface ExamRecord {
  asked: number
  correct: number
}

/** One slot spent building a project — and what the reader did with it. */
export interface ProjectSession {
  date: number
  time: TimeSlot
  /** The scene's own summary; absent when the closing call never produced one. */
  summary?: string
}

/** A project's build log: every slot he worked on it, ascending. */
interface ProjectRecord {
  sessions: ProjectSession[]
}

/**
 * Everything one class accumulated over the semester. Keyed by class code in {@link
 * GameSave.classRecords}, and written only for classes the reader is enrolled in.
 */
export interface ClassRecord {
  /** Every meeting, ascending by date. */
  meetings: ClassMeetingRecord[]
  midterm?: ExamRecord
  final?: ExamRecord
  midtermProject?: ProjectRecord
  finalProject?: ProjectRecord
  /** 0–100, whole percent. */
  midtermScore?: number
  finalScore?: number
  /** The Heart tier the reader presented a showcase at, frozen with the score it bought. */
  midtermHeartTier?: StatTier
  finalHeartTier?: StatTier
}

/** One multiple-choice exam question. */
export interface QuizQuestion {
  question: string
  a: string
  b: string
  c: string
  d: string
  correct: 'A' | 'B' | 'C' | 'D'
}

/** An exam being sat right now. */
export interface QuizState {
  /** The class code being examined. */
  code: string
  exam: ExamPeriod
  questions: QuizQuestion[]
  /** How many questions have been answered. */
  index: number
  /** How many of those were right. */
  correct: number
}

/** Relationship milestones tracked per character — never affection, which is derived. */
export interface CharFlags {
  /** Has shared a scene with the reader. Set for the whole cast at scene end. */
  hasMet: boolean
  /** Unspoken feelings. Rolled at the ending, cleared below 0 and by `became_lovers`. */
  hasCrush: boolean
  /** The reader friendzoned her. */
  friendZoned: boolean
  /** She friendzoned the reader. */
  friendZonedBy: boolean
  isLover: boolean
  /** How many times the two have broken up. */
  brokenUp: number
  hasKissed: boolean
  hadSex: boolean
  /** Sleeping together without being lovers. Cleared on `isLover` or at `hostile`. */
  benefits: boolean
  /** She agreed to share the reader with other girls and won't be jealous of them. */
  harem: boolean
  /**
   * She shared her contact info with the reader — a number, an email, a Bunnyboard handle, any
   * of it.
   */
  gaveContactInfo: boolean
  /** She has the reader blocked on Bunnyboard. */
  blocked: boolean
  /**
   * The three contact-profile reveals: her traits at `friendly`, her backstory at
   * `trusted`, her love life blurb once they are lovers.
   */
  knowsTraits: boolean
  knowsBackstory: boolean
  knowsLoveLife: boolean
}

/** A relationship milestone the ledger call may report for one scene. */
export type RelationshipEvent =
  | 'kissed'
  | 'sex'
  | 'became_lovers'
  | 'broke_up'
  | 'friendzoned_by_reader'
  | 'friendzoned_reader'
  | 'gave_contact_info'
  | 'unblocked'
  | 'agreed_to_harem'

/** A character's standing part-time job. */
export interface CharJob {
  /** The employer, by `JobDef.id` from `shared/jobs.ts`' catalog. */
  jobId: string
  /** Her weekly {@link ShiftSlot}s, sorted. One or two; an empty job is not stored. */
  shifts: ShiftSlot[]
  /** The `date` the job starts existing. */
  startsOn?: number
  /**
   * She has not told the reader about it yet — one prompt injection, consumed by the first
   * scene they share once the job exists.
   */
  newJobNotice?: boolean
}

/**
 * What the scene-end status lines have already said about one girl's crush standards: the stat
 * he was told to raise and the tier it stood at, or that he has cleared her bar.
 */
export type CrushHint = { stat: StatKey; tier: StatTier } | { met: true }

/** What a standing haunt is for: the menu it was dealt from. */
export type HauntKind = 'fun' | 'study' | 'activity' | 'meal' | 'grocery' | 'room'

/** One slot of a character's week: where she is and why she is there. */
export interface Haunt {
  /** A location id (`shared/locations.ts`) or `'room'`. */
  location: string
  kind: HauntKind
  /** Activity only: what she does there, as the profile call wrote it — "sketching at the Whitman Greenhouse". */
  doing?: string
}

/**
 * The half of a character's entry New Game settles and nothing afterwards rewrites — held in
 * the playthrough record rather than in every save.
 */
export interface CharProfile extends CharSchedule {
  /**
   * Where she habitually is in the slots nothing is asked of her, and what for: a sparse map of
   * {@link ShiftSlot} to a {@link Haunt}.
   */
  hiddenSchedule?: Record<number, Haunt>
  /**
   * Where she starts in the thirty-day mood cycle (`prompts/moods.ts`), rolled at New Game as
   * one draw from a shuffled permutation so no two of the roster share a day.
   */
  moodCycleOffset?: number
  /**
   * Her social handle, the name her feed posts carry. Written by the profile call
   * at New Game and never changed.
   */
  handle?: string
  /** What she does with spring break, one short phrase. */
  springBreakPlans?: string
}

/** The half a playthrough accumulates — what every save file carries about her. */
export interface CharState {
  memories: CharMemory[]
  flags: CharFlags
  /**
   * The reader has learned her name — set the first time a scene line says it out loud;
   * until then the dialogue box calls her `???`. Distinct from `flags.hasMet`.
   */
  nameKnown: boolean
  /**
   * Her part-time job, if she holds one. On the save rather than the profile because
   * `newJobNotice` is spent at the boundary that announces it.
   */
  job?: CharJob
  /**
   * The slots of the week the reader has run into her on the map, from her hidden schedule:
   * {@link ShiftSlot}s, ascending, recorded at the boundary of every scene she was cast in.
   */
  metSlots?: ShiftSlot[]
  /**
   * The reader spent the slot on something else rather than answering her Bunnyboard hangout
   * invitation.
   */
  ignoredInvitation?: boolean
  /** Every gift she has been given, by `ItemDef.id`, oldest first. */
  gifts?: string[]
  /**
   * What she took away from texting the reader, from the ledger's `textMemories`. At
   * most one, and the newest wins.
   */
  textMemory?: CharMemory
  /** What she suspects about the reader and another girl, one record per subject. */
  suspicions?: Suspicion[]
  /** The game date they last became lovers; kept after a breakup for the exes line. */
  datingSince?: number
  /**
   * The game date dating last ended, present only from a breakup until they get back
   * together; what the exes line counts to.
   */
  brokeUpOn?: number
  /**
   * The girl he started dating the day this relationship ended, when that is what ended it;
   * present from that breakup until they get back together.
   */
  leftFor?: string
  /** What she found out for certain about the reader and somebody else; never expires. */
  jealousyMemories?: CharMemory[]
  /**
   * The presents she kept a warm memory of, oldest first — `loved` and `liked`
   * handovers only.
   */
  giftMemories?: CharMemory[]
  /**
   * The last thing the status lines told the player about her standards; absent
   * means nothing has been said.
   */
  crushHint?: CrushHint
  /**
   * Everything she has ever posted, oldest first: her winter-break posts, then the
   * per-slot roll's. Absent for a girl whose break was somewhere else — and on the save rather
   * than the profile, since a like rewrites a post.
   */
  feed?: SocialPost[]
  /**
   * The alternate wardrobes a scene has actually shown her in, first-seen order; absent
   * until one has been. It is what her contact page's outfit switcher offers, so it records
   * the sprite reference as *applied* — a set withheld by `noNsfwImages` was never seen.
   */
  seenOutfits?: OutfitSet[]
}

/**
 * Everything the game knows about one character in play: the record's half and the save's,
 * joined by `loadSave` and split again by `toGameSave`.
 */
export type CharInfo = CharState & CharProfile

/** One status update on the social feed; its likes are rolled once and stored. */
export interface SocialPost {
  /** crypto.randomUUID(); the stable list key and what a like is addressed to. */
  id: string
  text: string
  /** The game date it was posted; negative for a winter-break post, which falls before day 0. */
  date: number
  time: TimeSlot
  /** Everyone she is close to, plus a few strangers (`rollPostLikes`, `shared/feed.ts`). */
  likes: number
  /**
   * The player liked it. Absent means he has not, and the count on screen is `likes` alone.
   */
  liked?: boolean
  /** The game date the like was made — absent exactly when `liked` is. */
  likedOn?: number
}

/**
 * The feed items that belong to one slot and then are gone, stamped with the date and slot they
 * were rolled for.
 */
export interface FeedExtras {
  date: number
  time: TimeSlot
  /**
   * One post by somebody the reader has no contact info for — how a stranger is discovered.
   */
  teaser: { charId: string; postId: string } | null
  /**
   * Posts by people he cannot contact, added while the feed is too thin to read — one apiece,
   * and absent while it has enough on it without them.
   */
  fill?: { charId: string; postId: string }[]
  /**
   * A post by a student nobody on the roster is — a handle, an emoji for a face, and a
   * line off the authored tables.
   */
  randomPost: {
    handle: string
    emoji: string
    text: string
    likes: number
    liked?: boolean
  } | null
}

/** Playthrough scene summaries, keyed by day and time slot. */
export type GameHistory = Record<number, Partial<Record<TimeSlot, string>>>

/** Who a Bunnyboard chat message is from. `system` lines are app-written. */
export type ChatSender = 'player' | 'contact' | 'system'

/** One Bunnyboard text message. */
export interface ChatMessage {
  /** crypto.randomUUID(); the stable list key. */
  id: string
  sender: ChatSender
  text: string
  /** Game date (days elapsed) it was sent. */
  date: number
  time: TimeSlot
  /**
   * A system line reporting a failed reply. Marked so the texting summary can
   * see whether the conversation currently ends on a delivery failure.
   */
  error?: boolean
  /** Her asking him out: the message every ask-out cooldown is counted off. */
  invite?: true
}

/** One Bunnyboard conversation with a contact, keyed by her charId. */
export interface Conversation {
  charId: string
  messages: ChatMessage[]
  /** Messages the player has not opened the conversation to see. */
  unread: number
  /** Rolling recap of the texting so far — prior summary + recent messages, merged. */
  summary: string | null
  /**
   * Her unanswered ask-out; judged at the next slot boundary if still up. `occasionId` is the
   * occasion she asked him to, when she asked him to one, so a decline is filed against it.
   */
  pendingHangout?: { description: string; dismissed?: boolean; occasionId?: string }
  /** Invitations of hers he has not accepted in a row; absent at none. */
  declined?: number
  /** A lover he turned down by text, whose memory of it is still owed. */
  turnedDown?: true
}

/** The Bunnyboard app's persisted state. */
export interface BunnyboardState {
  /** Conversations keyed by charId. */
  conversations: Record<string, Conversation>
  /** charIds the player sent a friend request to, still pending. */
  requestsSent: string[]
  /** charIds who sent the player a friend request, still pending. */
  requestsReceived: string[]
  /** Unseen activity on the Friends tab — incoming requests, mostly. */
  contactsBadge: number
  /**
   * The charIds the Friends tab offers as people the reader may know, at most three,
   * re-drawn at every slot boundary.
   */
  suggestions?: string[]
}

/** A fresh, empty Bunnyboard. */
export function emptyBunnyboard(): BunnyboardState {
  return { conversations: {}, requestsSent: [], requestsReceived: [], contactsBadge: 0 }
}

/**
 * The structured reply to one texting turn. `messages` streams first, so the texts
 * land in the conversation as they are written; whether any was a hangout is the hangout
 * classifier's question.
 */
export interface TextingResponse {
  /** The character's reply — one long text or several short ones. */
  messages: string[]
  /** Prior summary + the recent messages, rolled into one recap. */
  summary?: string
  /** She wants the reader gone, and blocks him as this reply lands. */
  blocked?: boolean
}

/** The raw hangout-classifier reply, before {@link normalizeHangout} in the renderer. */
export interface HangoutClassifierResponse {
  /** The reader asked to meet up right now, and the reply did not refuse. */
  playerAsked: boolean
  /** The reply itself offers to meet up right now. */
  characterOffered: boolean
  /**
   * The plan in one sentence — who, where and what; empty when neither flag is set. It becomes
   * the scene's opening action, which the classifier casts from.
   */
  description: string
}

/**
 * One plan on the calendar — a hangout the reader agreed to in a scene or over the Bunnyboard,
 * placed in a future slot by the scheduling classifier.
 */
export interface CalendarEvent {
  /** crypto.randomUUID(); the stable list key. */
  id: string
  /** The slot the plan falls in. */
  date: number
  time: TimeSlot
  /** A few words — the calendar chip's label. */
  title: string
  /** One sentence — the detail pane's line. */
  description: string
  /** Who is going. charKeys that resolve to nobody are dropped. */
  charIds: string[]
  /** The slot the plan was made in — what dates the record. */
  madeOn: { date: number; time: TimeSlot }
  /**
   * The player has opened the Calendar since this plan was filed; absent means new, which
   * is what the badge counts and the chip highlights.
   */
  seen?: boolean
  /**
   * Whoever the reader stood up: the attendees not in the scene he spent the slot on instead.
   * Absent until the slot's scene starts.
   */
  noShow?: string[]
}

/**
 * One occasion on the calendar — a holiday, an academic milestone or a campus event.
 */
export interface Occasion {
  /** A stable slug for a static occasion; `crypto.randomUUID()` for a generated one. */
  id: string
  /** A few words — the calendar chip's label. */
  title: string
  /** A sentence or two — the detail pane's line, and the text the prompts are given. */
  description: string
  /** First `date` index it covers, inclusive. */
  startDate: number
  /** Last `date` index it covers, inclusive; equal to `startDate` for a single day. */
  endDate: number
  /** Which half of the day it occupies, or null for the whole of it. */
  time: TimeSlot | null
  /**
   * No class meets on any day it covers. Only the fixed academic occasions set this; a
   * generated one never can.
   */
  cancelsClasses: boolean
  kind: 'holiday' | 'academic' | 'campus'
}

/**
 * A character withdrawn from an event by her own timetable, persisted inside
 * {@link SceneState.opening}.
 */
export interface EventCancellation {
  charId: string
  /** The slot the plan she is dropping out of falls in. */
  date: number
  time: TimeSlot
  /** Which commitment took her, so the message names the real one. */
  reason: 'class' | 'shift' | 'away'
  /** Set with `'shift'`: the job she is rostered for, so the line can name the employer. */
  jobId?: string
}

/** One line of the reader's inventory: an item and how many of it he holds. */
export interface OwnedItem {
  /** An `ItemDef.id` (`shared/shop.ts`), which owns the name, price and prose. */
  itemId: string
  /** Always at least 1 — an entry that reaches zero is removed instead. */
  count: number
}

/** One gift handed over during a scene. */
export interface SceneGift {
  charId: string
  /** An `ItemDef.id` (`shared/shop.ts`). */
  itemId: string
  /** She has been given this exact item before. */
  repeat: boolean
  /** How it landed (`shared/shop.ts`), stamped when the gift is handed over. */
  reaction: GiftReaction
}

/** Mid-scene save/rewind snapshot — of a drained scene or a queued reply. */
export interface SceneState {
  /** Cast charIds, fixed for the whole scene. */
  cast: string[]
  /** The in-progress transcript — lines written since `summary` was produced. */
  transcript: SceneLine[]
  /** The running summary of everything older than `transcript`, or null. */
  summary: string | null
  /** Background base name, without the `_day`/`_night` suffix. */
  bg: string | null
  /** charIds occupying the three portrait slots, left to right; null = empty. */
  slots: Array<string | null>
  /** Sticky per-character sprite reference, keyed by charId. */
  emotions: Record<string, SpriteRef>
  /** Sticky mirrored-sprite flag, keyed by charId; decided when she is shown. */
  flipped: Record<string, boolean>
  /** charIds who have sat out long enough to count as gone — out of the scene's prompts. */
  departed: string[]
  /**
   * charIds off-stage right now, mapped to the drained turns each has sat out; `hide:` opens an
   * entry, `show:` deletes it, and one reaching `DEPARTURE_TURNS` becomes {@link departed}.
   */
  offStage: Record<string, number>
  /**
   * The player's own hand on the stage, keyed by charId: true where he has shown somebody the
   * scene did not, false where he has hidden somebody it did.
   */
  stageOverride?: Record<string, boolean>
  /** The bg id he picked by hand, on the same terms as {@link stageOverride}. */
  bgOverride?: string
  /** Per-character wardrobe locks, on the same terms again. */
  outfitLock?: Record<string, OutfitLock>
  /**
   * Every line the player has read this scene, untrimmed — what the Chat Log Modal shows.
   * Never folded away, unlike `transcript`.
   */
  sceneLog: SceneLine[]
  /**
   * The class the scene is sitting in, by class code, or absent when it is not a class
   * scene.
   */
  classCode?: string
  /** The course this scene's work session is for, or absent when it is not one. */
  projectClass?: string
  /**
   * The job whose shift this scene is, or absent when it is not one; it injects the
   * workplace's lorebook paragraph.
   */
  jobId?: string
  /** The stats the shift's rolled gain moves, or absent when the job has one gain to roll. */
  jobStats?: StatKey[]
  /** The charId this scene is a goodbye to, or absent when it is not one. */
  farewell?: string
  /**
   * The one charId the slot's texting ledger must not read, or absent when it reads every
   * thread.
   */
  textLedgerSkip?: string
  /**
   * The slot's texting-ledger reply once it has landed, so a reload claims it rather than
   * sending the call again; absent while the call is out or when nobody texted.
   */
  textLedger?: BankedTextLedger
  /**
   * The charIds whose hangout invitation this scene left unanswered — threads the slot's
   * texting ledger must not read either — or absent when it answered every one.
   */
  ignoredInvites?: string[]
  /**
   * The charIds he turned down by text before this scene, said once each at its ending, or
   * absent when he turned nobody down.
   */
  turnedDownInvites?: string[]
  /**
   * The employer whose premises this scene is set on because a *character* is working there,
   * or absent when it is not one.
   */
  visitJobId?: string
  /**
   * Roster charIds the action named without their being in the scene — bought for, thought
   * about, asked after — or absent when it named nobody absent.
   */
  mentions?: string[]
  /**
   * Where the classifier said this scene is set, in its own words, or absent when the action
   * did not say.
   */
  location?: string
  /**
   * The scene is somewhere other people are around — what the witness roll at the
   * boundary tests.
   */
  inPublic?: boolean
  /** The gifts handed over in this scene, in order, or absent when none were. */
  gifts?: SceneGift[]
  /** The exam being sat, or absent when the slot is an ordinary scene. */
  quiz?: QuizState
  /** The line last shown, so resuming doesn't land on an empty dialogue box. */
  currentLine: SceneLine | null
  /**
   * Lines received but not yet played, oldest first. Empty means the capture was taken drained,
   * at a decision point; a populated queue resumes at its first line.
   */
  pendingLines: SceneLine[]
  /** The scene was already resolved when this was written: the slot ends when the queue drains. */
  endPending?: boolean
  /** The resolved bookkeeping reply held alongside {@link endPending}. */
  ledger?: LedgerResponse
  /**
   * The **next** slot's opening, already paid for and held alongside {@link endPending}, so the
   * boundary replays it rather than calling again.
   */
  opening?: BankedOpening
}

/**
 * The place a slot opening invented a rumor about, and the sentence it invented.
 * Stamped with the slot it was drawn for, so a stale one is simply ignored (`npcOverlay`'s rule).
 */
export interface SlotRumor {
  date: number
  time: TimeSlot
  /** The `LOREBOOK` entry's own id, which is a location id. */
  placeId: string
  /** The narration's own words about the place, injected into that entry once. */
  sentence: string
}

/** Everything the slot opening needs, produced once at the previous scene's end. */
export interface SlotOpening {
  /** The narration, as playback lines — the action prompt included. */
  lines: SceneLine[]
  /** The invitations the opening rolled, delivered to the phone at step 1. */
  hangouts: SlotIntroResponse['hangouts']
  /** The texts the girls the reader left wrote, delivered to the phone at step 1. */
  breakups?: SlotIntroResponse['breakups']
  /**
   * The occasion this opening's askers asked him to, stamped onto their invitations at step 1.
   * Absent for a slot that had none, or that he was not free to go to one on.
   */
  askOccasionId?: string
  /** The plans the merged ledger found, normalized and attendance-filtered. */
  events: CalendarEvent[]
  /** Who that filtering took off an event, announced by text at step 1. */
  cancellations: EventCancellation[]
  /** Who is spending the coming slot with whom, rolled alongside the narration. */
  npcOverlay?: NpcSlotOverlay
  /**
   * The place this opening's `SOMEWHERE TO GO` block invented a rumor about, and the sentence
   * it invented. Absent for a slot that drew none, or whose rumor named no place.
   */
  slotRumor?: { placeId: string; sentence: string }
  /** The status updates the opening's posters wrote, filed to their own feeds at step 1. */
  posts?: SlotIntroResponse['posts']
  /**
   * What campus saw of the scene that ended into this slot — rolled at the ending off
   * the ledger it just paid for, so the narration above can say what is being said.
   */
  rumorPass?: RumorPassOutcome
  /**
   * The roster's affinities after that same scene, settled at the ending because the
   * evening the narration describes is dealt off them.
   */
  npcRelationships?: NpcRelationshipMap
  /**
   * Whoever fell for the reader in that same scene — rolled at the ending after the witness
   * pass, so the narration above describes her as she now feels.
   */
  crushes?: string[]
}

/** A {@link SlotOpening} an ending banked: the three settles it rolled are always on it. */
export type BankedOpening = SlotOpening &
  Required<Pick<SlotOpening, 'rumorPass' | 'crushes' | 'npcRelationships'>>

/** The slot's texting-ledger reply, paid for mid-scene and held until the ending merges it. */
export interface BankedTextLedger {
  /** The fingerprint the prefetch was keyed on: the slot plus every message id it read. */
  key: string
  reply: LedgerResponse
}

/**
 * One of BunnyBot's two routes to handing over BunnyMap: a first
 * contact, or a first standing haunt the reader stumbles onto.
 */
export type BunnybotHandover = 'contact' | 'haunt'

/** On-disk save file — `/data/saves/{playthroughId}/{saveId}.json`. */
export interface GameSave {
  schemaVersion: 12
  /**
   * The playthrough this save belongs to. Derived from the containing folder
   * name on read, so the copy written into the file is never authoritative.
   */
  playthroughId: string
  /**
   * `Date.now().toString()` for a slot-save, incremented on filename collision
   * until free; the literal `autosave` for the in-progress-scene save.
   */
  saveId: string
  /** Epoch ms, last modified. */
  saveDate: number
  /**
   * The reader's three stats, in accumulated points; tiers are derived by `tierOf()` and
   * never stored.
   */
  stats: PlayerStats
  /** The reader's balance in dollars. */
  money: number

  /** Days elapsed; day 0 = January 19. */
  date: number
  time: TimeSlot
  /** The moving half of every character's entry; the settled half is the record's. */
  charInfo: Record<string, CharState>
  /**
   * The player's own timetable: sparse `ClassSlot` → class code, chosen on the Class Select View
   * and revisable through VenusBot up to the add/drop deadline.
   */
  playerSchedule: Record<number, string>
  /** The playthrough log — the summary each finished scene left behind, by day and slot. */
  history: GameHistory
  /** The Bunnyboard app: conversations, friend requests and badges. */
  bunnyboard: BunnyboardState
  /** Plans the reader has made, oldest first. */
  events: CalendarEvent[]
  /** The part-time job the reader holds, or null. One at a time. */
  job: JobState | null
  /** Job ids the reader was fired from or quit; an employer here never returns to the board. */
  jobsClosed: string[]
  /** What the reader has bought and not yet given away, one entry per distinct item. */
  inventory: OwnedItem[]
  /**
   * What each of the reader's classes has accumulated — meetings, exams, projects and scores —
   * keyed by class code.
   */
  classRecords: Record<string, ClassRecord>
  /**
   * The reader's academic reputation once a whole round of assessments is in — `good`
   * when every score beat 90, `bad` when every one fell under 50, null otherwise.
   */
  gradesStanding: 'good' | 'bad' | null
  /**
   * The reader has been caught at something the university expels people for,
   * banked at the boundary of the scene the ledger reported it in.
   */
  expelled: boolean
  /**
   * The one-shot guard on the Saturday standing check after midterms, and on the Monday finals
   * notification.
   */
  midtermStandingDone: boolean
  finalsScoresShown: boolean
  /**
   * The last global slot id (`date * 2 + time`) VenusBot's announcements have been delivered
   * through.
   */
  venusThrough: number
  /** The same watermark for BunnyBot's two clock-owed messages; defaults to `-1`. */
  bunnybotThrough: number
  /** Whether the sidebar's BunnyMap and BunnyShop icons have been handed over. */
  bunnymapUnlocked: boolean
  bunnyshopUnlocked: boolean
  /**
   * One-shot guards on BunnyBot's and VenusBot's event-triggered messages, fired by a state
   * rather than a date — Venus's job pitch, first contact, the Updates-tab nudge, the two-timing
   * tip, and (optional; absent before it existed) the first-seen-with-a-girl warning.
   */
  venusJobIntroSent: boolean
  bunnybotContactIntroSent: boolean
  bunnybotFirstPostNudgeSent: boolean
  bunnybotTwoTimingTipSent: boolean
  bunnybotSeenTipSent?: boolean
  /**
   * BunnyBot's event-triggered handovers that fired before it had introduced itself, in the
   * order they fired, waiting for the first boundary past `FRIENDS_INTRO_SLOT`.
   */
  bunnybotDeferred: BunnybotHandover[]
  /** Every class the reader dropped during add/drop, keyed by class code. */
  droppedClasses: Record<string, DroppedClass>
  /** Every class the reader added during add/drop, keyed by class code. */
  addedClasses: Record<string, AddedClass>
  /**
   * What the roster thinks of *each other*, keyed by `pairKeyOf` — one entry per
   * unordered pair, and the absence of one is the fifth state: strangers.
   */
  npcRelationships: NpcRelationshipMap
  /**
   * The first time each pair of them became friends, oldest first — a permanent record,
   * so a pair that falls out and back in is never announced twice. Absent in a save written
   * before the feed said so.
   */
  npcFriendships?: NpcFriendship[]
  /**
   * The occasions he turned down an invitation to, or let one stand — nobody asks him to one
   * of these twice. Absent in a save written before occasions were asked about.
   */
  occasionsDeclined?: string[]
  /**
   * Who is with whom this slot, stamped with the slot it describes; rolled at the
   * boundary and carried on {@link SlotOpening} so a reload opens the same evening.
   */
  npcOverlay: NpcSlotOverlay | null
  /**
   * What this slot's opening said was going on somewhere, stamped with that slot: the
   * scene the reader spends it in injects the sentence into that place's lorebook entry, once.
   * Absent in a save written before openings said so.
   */
  slotRumor?: SlotRumor | null
  /**
   * Who shared a scene with the reader in the last slot that finished, stamped
   * with the slot it describes so a stale snapshot is inert.
   */
  lastSlotCast: { date: number; time: TimeSlot; charIds: string[] } | null
  /**
   * Who has already been out this weekend, keyed by charId and valued with that weekend's
   * Saturday date.
   */
  weekendOutings: Record<string, number>
  /**
   * The same record for spring break, where the rule is per slot rather than per weekend:
   * keyed by charId and valued with `globalSlotOf`.
   */
  outingSlots: Record<string, number>
  /** Who leaves campus for spring break, as charIds. */
  springBreakAway: string[] | null
  /**
   * The feed items that belong to today alone — the stranger's post the day surfaced and
   * the random student's — stamped with the date they were rolled for.
   */
  feedExtras: FeedExtras | null
  /** The graduation-morning narration has played. */
  graduationSeen: boolean
  /** Who the reader has already said goodbye to, as charIds — each a button spent off the epilogue's menu. */
  farewellsDone: string[]
  /** The graduation picture is this epilogue's to make. */
  endingArtWanted: boolean
  /** The scene in progress, or null between scenes; written at every reply and decision point. */
  scene: SceneState | null
}

/** One dropped class — the record that makes the drop permanent. */
export interface DroppedClass {
  /** The former classmates have been told once; they are never told again. */
  announced: boolean
  /** The `date` he dropped it, which is what the notice waits on. */
  date: number
}

/** One class added at add/drop — the record that owes him an entrance. */
export interface AddedClass {
  /** The room has met him once; it never meets him again. */
  announced: boolean
  /** The `date` he added it, on {@link DroppedClass.date}'s terms. */
  date: number
}

/**
 * The persistable body of a save — everything except the three fields `saveService` owns; the
 * call made picks the target.
 */
export type SaveDraft = Omit<GameSave, 'playthroughId' | 'saveId' | 'saveDate'>

/**
 * The reader's standing employment — only what a playthrough accumulated; the catalog
 * entry behind `jobId` (`shared/jobs.ts`) owns pay, requirements and every word the boss says.
 */
export interface JobState {
  /** A `JOB_CATALOG` id. */
  jobId: string
  /** The shifts he is rostered for, ascending. */
  shifts: ShiftSlot[]
  /** A requested roster, swapped into `shifts` on the next Sunday Day. */
  pendingShifts?: ShiftSlot[]
  /**
   * The boss has acknowledged the request pending above — set at the slot boundary after it
   * was made, cleared by the Sunday swap.
   */
  shiftChangeApproved?: boolean
  shiftsWorked: number
  /** Total dollars this job has paid him. */
  earned: number
  /** Raises taken, capped at `MAX_RAISES`; each is 20% of the job's base pay. */
  raises: number
  /** Clean shifts since the last raise or strike. */
  streak: number
  /** Missed shifts; he is let go at `MAX_STRIKES`. */
  strikes: number
  /** The one sick-call the boss believes has been spent. */
  sickUsed: boolean
  /** The global slot id (`date * 2 + time`) a sick-call excused, if any. */
  excusedSlot?: number
  /** The global slot id a "I'm sick." was last sent in, believed or not. */
  sickTextedSlot?: number
  /** The `startDate` of the closure the boss has already texted about. */
  holidayNoticeDate?: number
  /** The last global slot id the sweep has already judged. */
  settledThrough: number
  /** Global slot ids credited as worked. */
  workedSlots: number[]
}

/** The reader's name when the player types nothing — the New Game modal's placeholders. */
export const DEFAULT_PLAYER_FIRST_NAME = 'Seth'
export const DEFAULT_PLAYER_LAST_NAME = 'Hawke'

/**
 * Slot-saves a playthrough keeps. Writing the fifteenth deletes the oldest, so
 * a playthrough is a rolling window roughly a week of game time deep.
 */
export const MAX_SLOT_SAVES = 14

/** The one non-numeric save id — the scene-in-progress save. */
export const AUTOSAVE_ID = 'autosave'

/**
 * Where every playthrough opens: the day slot of January 19. Read by the save New Game
 * writes, by the splash the crossing to it announces, and by the listing of a folder whose
 * semester has no timetable yet — so nothing can name a morning the file does not open on.
 */
export const FIRST_SLOT: { date: number; time: TimeSlot } = { date: 0, time: 0 }

/**
 * One playthrough as the first level of Load Game shows it, built from the folder name
 * plus that playthrough's newest save alone.
 */
export interface PlaythroughSummary {
  playthroughId: string
  /** `Playthrough N`, N being this playthrough's position in creation order. */
  label: string
  /** charIds, off the playthrough record; `[]` when it was refused. */
  chars: string[]
  /** In-game position of the newest save. */
  date: number
  time: TimeSlot
  /** Epoch ms of the newest save. */
  savedAt: number
  /** Slot-saves held, excluding the autosave; at most {@link MAX_SLOT_SAVES}. */
  saveCount: number
  /** True while a scene is in progress — the autosave exists only mid-scene. */
  hasAutosave: boolean
  /**
   * The folder holds a semester and no timetable yet: it reopens the registrar rather than
   * a save.
   */
  enrolling?: true
  /**
   * Why nothing in the folder can be read — a refused record, or no readable save — or null
   * when the newest readable save stands for it.
   */
  unloadable: string | null
}

/** One listed save: the file as read, or the error that refused it. */
export interface SaveEntry {
  saveId: string
  /** Epoch ms — the save's `saveDate`, or the file's mtime when it could not be read. */
  savedAt: number
  save: GameSave | null
  error: AppError | null
}

/**
 * On-disk playthrough record — `/data/saves/{playthroughId}/playthrough.json`: everything
 * New Game settled and no save afterwards rewrites, written once beside the saves that read it.
 * The folder names the playthrough, so no id is carried here.
 */
export interface PlaythroughRecord {
  schemaVersion: 3
  /** charIds in this playthrough, in roster order. */
  chars: string[]
  /**
   * The reader's own name, chosen at New Game and fixed for the playthrough; it reaches the
   * model through the `READER` block.
   */
  playerFirstName: string
  playerLastName: string
  /**
   * The class roster, keyed by class `code`. Generated once at New Game; only classes with at
   * least one student are kept.
   */
  classes: Record<string, ClassEntry>
  /** The occasions this playthrough invented, oldest first — the generated half only. */
  occasions: Occasion[]
  /**
   * The shift slots each all-hours employer is not offering this playthrough, keyed by job id
   * — two apiece, rolled at New Game.
   */
  jobClosures: Record<string, ShiftSlot[]>
  /** Every slot's sky, indexed `date * 2 + time`, rolled once at New Game. */
  weather: Weather[]
  /** The settled half of every character's entry, keyed by charId. */
  profiles: Record<string, CharProfile>
}

/** The record as New Game hands it over; `saveService` stamps the version. */
export type PlaythroughDraft = Omit<PlaythroughRecord, 'schemaVersion'>

/** What `saves:create` answers with: both files, as written. */
export interface CreatedPlaythrough {
  record: PlaythroughRecord
  save: GameSave
}

/** What `saves:list` answers with: the record or its refusal, then every save file. */
export interface PlaythroughListing {
  /** Null exactly when the record was refused on read; nothing in the folder loads without it. */
  record: PlaythroughRecord | null
  /** The refusal behind a null `record`. */
  error: AppError | null
  saves: SaveEntry[]
}

/** Everything one character gains in her `CharInfo` from the timetable scheduler. */
export interface CharSchedule {
  year: number
  dorm: DormId
  major: string
  schedule: Record<number, string>
}

/** What one character's job assignment resolves to, before any slot is picked. */
export interface JobAssignment {
  jobId: string
  count: number
}

/**
 * The hidden-schedule half of one profile, every key already resolved to a location id — what
 * the hidden-schedule scheduler deals out.
 */
export interface HiddenScheduleAssignment {
  /** How many slots of the week she spends in her own room. */
  homeSlots: number
  /** Where she studies, or null for a girl who studies nowhere in particular. */
  study: string | null
  /** The places she goes for fun, one slot each. */
  fun: string[]
  /** The one thing she does weekly, and where — the profile call's own phrase for it. */
  activity: { location: string; doing: string } | null
  /** Where she eats out once a week, or null. */
  meal: string | null
}

/** The social half of one profile — her handle and what she posted over the break. */
export interface FeedAssignment {
  handle: string
  winterPosts: string[]
}

/** The canned semester Quickstart starts from — `/assets/quickstart.json`. */
export interface QuickstartBundle {
  /** The roster, in order — charIds, resolved through `chars:list`. */
  chars: string[]
  /** The catalog as the scheduler left it: slotted, seated and decorated. */
  classes: Record<string, ClassEntry>
  /** Keyed by charId. */
  perChar: Record<string, CharSchedule>
  /** Keyed by charId; a character with no job has no entry. */
  jobs: Record<string, JobAssignment>
  /** Keyed by charId. */
  haunts: Record<string, HiddenScheduleAssignment>
  /** Keyed by charId. */
  feeds: Record<string, FeedAssignment>
  /** Keyed by charId; a blank plan has no entry. */
  springBreakPlans: Record<string, string>
  /** The occasions this semester invents; the fixed calendar is code. */
  occasions: Occasion[]
}

/** A whole semester with the reader beside it, as the screen that generated it hands it over. */
export type EnrollmentDraft = QuickstartBundle & {
  playerFirstName: string
  playerLastName: string
  stats: PlayerStats
}

/**
 * On-disk enrollment — `/data/saves/{playthroughId}/enrollment.json`: the semester waiting on
 * its timetable, replaced by the playthrough record at Finalize.
 */
export interface Enrollment extends EnrollmentDraft {
  schemaVersion: 2
  savedAt: number
}

/** What `saves:enroll` answers with: the folder it minted, and the file as written. */
export interface CreatedEnrollment {
  playthroughId: string
  enrollment: Enrollment
}

/** The set-aside keys a grab bag has dealt, one list per bag id. */
export type GrabBags = Record<string, string[]>

/** On-disk grab bags — `/data/grabbags.json`. */
export interface GrabBagsFile {
  schemaVersion: number
  bags: GrabBags
}

/** On-disk settings — `/data/settings.json`. */
export interface Settings {
  schemaVersion: 1
  apiProvider: 'gemini'
  /** Defaults to the configured provider's `defaultModel` (see `providers.ts`). */
  apiModel: string
  apiKey: string
  /** How hard the model reasons; resolved against the model at call time. */
  thinkingLevel: ThinkingLevel
  /**
   * A second model for the calls named in {@link secondaryModelFor} — a model id from
   * the same provider's table. Absent or empty means every call runs on {@link apiModel}.
   */
  secondaryModel?: string
  /**
   * Which kinds it writes. **Absent means the default set** (`DEFAULT_SECONDARY_KINDS`), so a
   * player who picks a model and touches nothing else gets what the checkboxes show; an empty
   * list means none.
   */
  secondaryModelFor?: PromptKind[]
  /**
   * Which inference queue serves text calls; resolved at call time. **Not a player
   * setting** — hand-edited beside `forceTime`, absent meaning `priority`.
   */
  serviceTier?: ServiceTier
  /**
   * Stream scene and texting replies for a live preview; off sends the same calls to the
   * whole-reply endpoint instead. Hand-edited like {@link serviceTier}, absent meaning on.
   */
  streamResponses?: boolean
  /** The player skipped the optional ComfyUI install; boot stops verifying it. */
  comfyDeferred: boolean
  /**
   * Withhold the explicit images: the nude wardrobe and the CGs are covered wherever shown, and
   * a scene that calls for either changes her expression instead.
   */
  noNsfwImages: boolean
  /**
   * Tone down what RITA is *told* to write: the sex direction leaves both personas and the CG
   * rules leave the schema entirely.
   */
  lessNsfwText: boolean
  /**
   * Silence what a CG carries: the act and the breath under one, and the climax's own sting.
   * Optional on disk, absent meaning they play.
   */
  noNsfwSound?: boolean
  /**
   * Whether the player has been asked the content questions above. It is the first run's last
   * step, so it doubles as the mark that the run finished.
   */
  sfwAsked: boolean
  /** Shipped characters the player has taken off the roster. */
  removedDefaults: string[]
  /**
   * Dev-only, hand-edited into the file: pin every render to the character's
   * `generationSeed` and write no seed state at all. Absent means off.
   */
  freezeSeeds?: boolean
  /**
   * Dev-only, hand-edited into the file: the shipped cast is editable in place —
   * written, rendered and re-rendered like the player's own. Absent means off.
   */
  editPregens?: boolean
  /**
   * Dev-only, hand-edited into the file: pins the theme a screen opens in, so
   * either one can be looked at whatever the hour. Absent means the clock decides.
   */
  forceTime?: 'day' | 'night'
  /**
   * The four group volumes, 0-100 each, as the sliders left them. Absent, or any group
   * absent, reads as the default (`volumesOf` in `shared/audio.ts`).
   */
  volumes?: Record<AudioGroup, number>
  /**
   * The browser build's opt-in to keeping the API key in its storage between visits, which
   * every other game on the same host can read; absent is the session-only default. The
   * desktop encrypts its key either way and ignores this.
   */
  rememberKey?: boolean
}

/**
 * What `settings:get` returns: {@link Settings} with the secret replaced by a
 * presence flag, so the key is never in renderer memory.
 */
export interface RendererSettings extends Omit<Settings, 'apiKey'> {
  apiKeySet: boolean
}

/**
 * What `settings:set` carries. A key field left absent means "keep the stored key" — the
 * renderer cannot read one back, so it can only ever replace one.
 */
export type SettingsPatch = Omit<
  Settings,
  | 'schemaVersion'
  | 'apiKey'
  | 'freezeSeeds'
  | 'editPregens'
  | 'forceTime'
  | 'removedDefaults'
  | 'serviceTier'
  | 'streamResponses'
> & {
  apiKey?: string
}

/** A single line of a scene, as emitted by the cloud LLM. */
export interface SceneLine {
  /** Bg base name WITHOUT _day/_night suffix; required on the first line only. */
  bg?: string
  /** charKey, `""` for narrator, or `READER_SPEAKER` for the player's own action. */
  speaker: string
  /**
   * Stage instructions applied in order as the line is reached: `show:{charKey}`,
   * `hide:{charKey}`, `sprite:{charKey},{spriteRef}` and `cg:{position}`.
   */
  actions?: string[]
  text: string
  /**
   * What the scene-end sequence draws over this line — never written by the model, only set
   * afterwards, either alongside the run it colours (`markedLine`) or by reading a finished line
   * for its stat words and balance (`markStatusLine`).
   */
  status?: StatusNote
}

/** One run of a status line drawn in a colour of its own. */
export interface TextMark {
  /** Half-open character range into the line's own `text`. */
  start: number
  end: number
  tone: StatKey | 'gain' | 'loss'
}

/** Which way a status line went for the reader, for the sound its arrival makes. */
export type Polarity = 'positive' | 'negative'

/** What a status line carries beyond its words. */
interface StatusNote {
  marks: TextMark[]
  /** The balance either side of this line, for the card that counts between them. */
  money?: { from: number; to: number }
  /** Which way this line went, for the sting its arrival fires; absent rings nothing. */
  polarity?: Polarity
}

/** The structured-output schema shape the cloud LLM must return for a scene. */
export interface SceneResponse {
  lines: SceneLine[]
  /** Running scene recap for continuation calls, declared after `lines`. */
  summary?: string
  /** "The scene is resolved." What it *meant* is the ledger call's job. */
  end_scene?: boolean | null
}

/**
 * The bookkeeping reply for a finished slot: what the characters remember,
 * which milestones were passed, what the hour did for the reader, and what he agreed to later.
 */
export interface LedgerResponse {
  /** Both cast-scoped arrays are absent for a solo scene, whose schema omits them. */
  memories?: Array<{ charKey: string; type: MemoryType; desc: string }>
  events?: Array<{ charKey: string; event: RelationshipEvent }>
  /**
   * Every kiss and every night the hour held, one row per kind per set of girls; absent for a
   * solo scene, whose schema omits it.
   */
  acts?: Array<{ kind: ActKind; inPublic: boolean; chars: string[] }>
  /**
   * What this slot's texting left each girl with — one per character, at most. The texting
   * ledger's field, scoped to whoever actually texted this slot.
   */
  textMemories?: Array<{ charKey: string; type: MemoryType; desc: string }>
  /**
   * The plans the slot settled on — the scene's from the scene ledger, the texts'
   * from the texting ledger, deduped by the merge.
   */
  plans?: Array<{ slot: number; title: string; description: string; chars: string[] }>
  /**
   * Which stats the scene exercised — what each is worth, and how many of them count, is the
   * app's to decide.
   */
  stats?: LedgerStats
  /**
   * Dollars the reader personally spent in this scene; the schema floors it at 0 and
   * nothing caps it.
   */
  spent?: number
  /**
   * Whether the reader was **caught** at an expellable offense in this scene — the
   * input to the expulsion ending.
   */
  expelled?: boolean
  /** What happened in the class the reader sat through, one or two sentences. */
  classSummary?: string
  /**
   * The one thing he learned there that had not come up before — a lecture class only. A status
   * message the player reads, and the pool that class's exam questions are drawn from.
   */
  classFactoid?: string
}

/**
 * The slot-opening narration. Narration only: it carries no
 * speaker, emotion, action or bg, so nothing in it can touch the stage.
 */
export interface SlotIntroResponse {
  lines: Array<{ text: string }>
  /**
   * One text-message invitation per character the slot rolled in: `char` is her
   * charKey, `text` the message and `description` the plan a yes starts the scene from.
   */
  hangouts?: Array<{ char: string; text: string; description: string }>
  /**
   * The messages each girl the reader left for somebody else sends to end it: `char` is her
   * charKey, `texts` the run of messages in the order she sends them.
   */
  breakups?: Array<{ char: string; texts: string[] }>
  /**
   * One status update per character the slot's posting roll picked. `char` is her
   * charKey; `text` is the post.
   */
  posts?: Array<{ char: string; text: string }>
}

/**
 * The epilogue's status updates: one post per contact, written about the days after
 * graduation. `char` is her charKey; `text` is the post.
 */
export interface EndingPostsResponse {
  posts?: Array<{ char: string; text: string }>
}

/** One pose manifest entry — `/assets/pose.json`. */
export interface PoseEntry {
  /** Booru tags written into the image prompt. */
  tags: string[]
  /** Plain-language gist of the pose, so the LLM's pick is informed. */
  description: string
}

/** Pose manifest  — `/assets/pose.json`. */
export type PoseManifest = Record<string, PoseEntry>

/** Which managed service a setup component belongs to, for grouping in the Setup View. */
type SetupGroup = 'comfyui'

/** Result of a single startup verification check. */
type SetupComponentState =
  /** Present and passes its checks. */
  | 'ok'
  /** Not installed at all. */
  | 'missing'
  /** Present but wrong — e.g. a model file whose byte size doesn't match the pin. */
  | 'invalid'

/** One row of the Setup View checklist. */
export interface SetupComponent {
  id: string
  label: string
  group: SetupGroup
  state: SetupComponentState
  /** Human-readable explanation, shown for non-`ok` states. */
  detail?: string
}

/** Full output of `setup:getStatus` — the startup verify pipeline. */
export interface SetupStatus {
  components: SetupComponent[]
  /** Every ComfyUI-group component is `ok` — gates every play path. */
  comfyReady: boolean
}

/** Progress event from `setup:runInstall` on `setup:installProgress`. */
export interface InstallProgress {
  jobId: string
  componentId: string
  /** Human-readable phase, e.g. "Downloading", "Extracting", "Installing dependencies". */
  step: string
  /** 0-100 when the total is known. Absent for indeterminate steps like pip. */
  percent?: number
  bytesDone?: number
  bytesTotal?: number
  /** Set once this component has finished, successfully or not. */
  done?: boolean
  error?: AppError
}

/** Result of an install run: the status after it, and the errors collected per component. */
export interface InstallResult {
  status: SetupStatus
  errors: Array<{ componentId: string; error: AppError }>
}

/** Lifecycle of a single job in `jobQueue`. */
type JobStatus = 'queued' | 'running' | 'done' | 'error'

/** One `jobQueue` progress event on the fixed `jobs:progress` channel. */
export interface JobProgress {
  jobId: string
  /** Cancellation group — a charId for expression jobs. */
  group: string
  /** Sub-identifier within the group; the `Emotion` for expression jobs. */
  key?: string
  status: JobStatus
  /** Human-readable current step, shown in job UI. */
  step?: string
  error?: AppError
}

import { slotFullLabel, yearLabel } from '@shared/classes'
import { dormClause } from '@shared/dorms'
import { EMOTIONS } from '@shared/emotions'
import { isCustomOutfitSlot, outfitTagsFor, spriteRefsFor, STOCK_OUTFIT_SETS } from '@shared/outfits'
import { DEFAULT_PLAYER_STATS, STAT_KEYS, type PlayerStats } from '@shared/playerStats'
import { fullDescriptionOf, kindSentenceOf, projectStandingLine } from '@shared/academics'
import type { ClassKind, ProjectProgress } from '@shared/academics'
import { isPosition, POSITIONS } from '@shared/positions'
import { readerize } from '@shared/readerVoice'
import { cgAction, showAction, spriteAction } from '@shared/sceneActions'
import { andList } from '@shared/sentences'
import {
  affectionFor,
  behaviorLevelOf,
  dedupedMemoriesFor,
  emptyFlags,
  loveLifeBlurb,
  MEMORY_CAP,
  overTextDesc
} from '@shared/relationship'
import { OUTFIT_SKIN_EXPOSURE } from '@shared/tags'
import { hasTrait } from '@shared/traits'
import type { Weather } from '@shared/weather'
import type { NpcRelationshipMap } from '@shared/npcRelationships'
import {
  allBackgrounds,
  charKeyOf,
  fullNameOf,
  READER_SPEAKER,
  roomBgIdOf,
  type ActKind,
  type BackgroundSets,
  type Character,
  type CharFlags,
  type CharInfo,
  type CharJob,
  type CharMemory,
  type ClassEntry,
  type ClassSlot,
  type JobState,
  MEMORY_TYPES,
  type Occasion,
  type OutfitSet,
  type ProjectSession,
  type SceneLine,
  type ShiftSlot,
  type SpriteRef,
  type StockOutfitSet,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import {
  formatChatDivider,
  formatDateBanner,
  formatSemesterProgress,
  formatShortGameDate,
  ordinal
} from './gameDate'
import { jobDefOf, shiftSlotFullLabel } from '@shared/jobs'
import {
  ambientLoreCharacters,
  characterLore,
  characterLoreForIds,
  keyPattern,
  lorebookBlock,
  type LoreRumor,
  loreEntryById,
  loreTextForKey
} from './lorebook'
import { farewellNowLines, graduationCastLines } from './graduation'
import { moodLine } from './moods'
import { springBreakLines } from './springBreak'
import { bestFriendLines, npcBehaviorLines, npcPairLines } from './npcRelationship'
import { occasionLoreLines } from './occasions'
import { milestoneLine, relationshipLines } from './relationship'
import {
  PLANS_INSTRUCTIONS,
  plansSchema,
  transcriptStubs,
  scheduleBlocks,
  scheduleCharKeys,
  type SchedulePromptInput
} from './schedulePrompt'
import { objectSchema } from './schema'
import { seedWordBlock } from './seedWords'
import { weatherLines } from './weather'

/**
 * Builds scene, continuation, and closing prompt requests.
 * Keeps cacheable prompt parts first and schema `lines` before `summary`.
 */


/** One past meeting of this course, as the recap prints it. */
export interface ClassMeetingRecap {
  /** 1-based meeting index — "week 3 of this class", counting meetings actually held. */
  week: number
  attended: boolean
  summary?: string
  /** The exam-worthy fact that meeting left behind — lecture classes only, absent on a skipped or syllabus week. */
  factoid?: string
}

/**
 * Where a course stands at the meeting this scene is sitting in. Resolved by the loop
 * against the occasion calendar and `classRecords`; the prompt layer only formats it.
 */
export interface ClassSceneContext {
  /** Which meeting of the course this is, 1-based. */
  index: number
  /** Null for PE, which has no exams, no project and no week-by-week arc. */
  kind: ClassKind | null
  /** Today's meeting is the course's midterm, or its final. */
  isMidterm: boolean
  isFinals: boolean
  /** Today is the first meeting after the midterm: results are handed back. */
  isHandback: boolean
  /** Everything that happened in this course before today, oldest first. */
  recap: readonly ClassMeetingRecap[]
  /** Project classes only: how the current project stands. */
  project?: {
    progress: ProjectProgress
    worked: number
    needed: number
    /** He has already spent a slot on it since the last meeting. */
    workedThisWeek: boolean
  }
  /** The score being handed back today, when one is. */
  handbackScore?: number
}

/**
 * Where the project stands for a scene spent *building* it rather than sitting in the class
 * — resolved by the loop, formatted into the work session's lorebook paragraph.
 */
export interface ProjectSceneContext {
  progress: ProjectProgress
  /** The most recent slot spent on it, absent until one has been. */
  lastSession?: ProjectSession
}

/** Everything the builders read out of `gameStore`. */
export interface PromptState {
  /** The cloud-LLM cache key: the playthrough id, never the save's. */
  playthroughId: string
  date: number
  time: TimeSlot
  /** Available background base names, sorted, suffixes already stripped, by category. */
  backgrounds: BackgroundSets
  /** Per-character save state, keyed by charId. */
  charInfo: Record<string, CharInfo>
  /** What the roster thinks of each other, keyed by `pairKeyOf`. */
  npcRelationships: NpcRelationshipMap
  /** Every save character who is *not* in this scene's cast — the lorebook's people. */
  roster: readonly Character[]
  /**
   * The characters this scene is *about* without their being in it — bought a present for,
   * thought about, asked after.
   */
  mentions?: readonly Character[]
  /**
   * Where the classifier said the scene is set, or null when the action did not say.
   * Scanned into the lorebook beside the turn's own text.
   */
  sceneLocation?: string | null
  /**
   * What this slot's opening said was going on somewhere, where the slot drew one: the
   * sentence rides that place's own lorebook entry, and **only on the turn that opens a scene**
   * — a continuation is built from the same state and passes it nowhere.
   */
  slotRumor?: LoreRumor
  /** The save's class roster, keyed by class code. */
  classes: Record<string, ClassEntry>
  /** The reader's own timetable, sparse slot → class code. */
  playerSchedule: Record<number, string>
  /**
   * Classes the reader dropped that his former classmates have not been told about yet
   * — resolved by the loop and spent at the boundary of the scene that carries them.
   */
  droppedNotices?: readonly DroppedNotice[]
  /**
   * Who leaves campus for spring break, or null before the pick has run; the plan
   * itself rides on her own `CharInfo`.
   */
  springBreakAway?: readonly string[] | null
  /**
   * Set only for a goodbye in the graduation epilogue: who it is with, and whether
   * she is graduating out of the reader's reach or merely going home for the summer.
   */
  farewell?: { firstName: string; senior: boolean }
  /**
   * Classes he added at add/drop and has not yet walked into — every unspent add;
   * `classCode` decides which applies.
   */
  addedNotices?: readonly AddedNotice[]
  /** The part-time job the reader holds, or null — the other half of his week. */
  playerJob: JobState | null
  /** The reader's accumulated stats, used for relationship requirement guidance. */
  stats?: PlayerStats
  /**
   * The save's generated occasions only; the fixed half of the calendar is merged
   * in by `occasionsAt`.
   */
  occasions: readonly Occasion[]
  /**
   * The whole semester's sky, one reading per slot — the NOW line walks back through it for how
   * long the weather has held. Absent means nothing is said about it.
   */
  weather?: readonly Weather[]
  /**
   * The background the scene is standing on, base name, no suffix — null between scenes.
   */
  bg: string | null
  /**
   * The class this scene is sitting in, by class code, or null when it is not a class scene.
   */
  classCode: string | null
  /**
   * Everything the `CLASS` block needs about where this course stands, or absent when
   * the scene is not a class scene.
   */
  classMeeting?: ClassSceneContext
  /**
   * The course this scene's work session is for, by class code, or null when the scene is not
   * one.
   */
  projectClass: string | null
  /**
   * What the reader has already sat through in {@link projectClass}, oldest first, or absent
   * when the scene is not a work session.
   */
  projectRecap?: readonly ClassMeetingRecap[]
  /**
   * How far the project itself has got and what the last slot on it produced, or absent when
   * the scene is not a work session.
   */
  projectScene?: ProjectSceneContext
  /**
   * The job whose shift this scene is, by jobId, or null when it is not one.
   * Scoped and persisted like {@link projectClass}.
   */
  jobId: string | null
  /**
   * The employer whose premises this scene is on because a *character* is working there, or
   * null when it is not one.
   */
  visitJobId: string | null
  /**
   * One finished paragraph per gift given this scene, built by `giftLoreNote`
   * (`shared/shop.ts`) from `gameStore.sceneGifts`.
   */
  giftNotes: readonly string[]
  /**
   * Sticky per-character sprite reference, keyed by charId — where the scene as written leaves
   * each of them, a CG among the values.
   */
  emotions: Record<string, SpriteRef>
  /**
   * The charIds standing on the stage as written, in slot order — whose company decides whether
   * a CG can be offered at all.
   */
  onStage: readonly string[]
  /** Which cast members have a full set of CGs on disk, by charId — read once at scene start. */
  cgReady: Record<string, boolean>
  /**
   * Which alternate wardrobes each cast member has fully rendered, by charId — read once at
   * scene start; a set counts only when all seven of its sprites exist. It may list a custom
   * slot, which the prompt never offers.
   */
  outfitReady: Record<string, OutfitSet[]>
  /** Which cast members have both room backgrounds on disk, by charId. */
  roomReady: Record<string, boolean>
  /**
   * Each character's composed TEXTING HISTORY lines, by charId — the rolling Bunnyboard recap
   * plus its app-known footnotes, header included.
   */
  textingSummaries?: Record<string, string[]>
  /**
   * The charIds a Bunnyboard thread already exists with (`hasTexted`). Not derivable from
   * {@link textingSummaries}, which can exist over an empty thread.
   */
  textedWith?: readonly string[]
  /** The cast when every one of them is off-stage and the scene is still running; absent otherwise. */
  hiddenCast?: readonly Character[]
  /** The player's `lessNsfwText` setting. */
  lessNsfwText: boolean
}

/** What a call that writes a scene reads: the state plus the inspiration word its caller drew. */
export interface ScenePromptState extends PromptState {
  /** The inspiration word this call carries, drawn by the caller. */
  seedWord: string
}

/**
 * The one line each persona says about writing sex; the SFW twins below are built by removing
 * it.
 */
const SEX_DIRECTION =
  'When you finally get to write the sex, you get super turned on and don\'t mind getting lewd and using profanity, but you avoid explicit sexual words.'
const LEDGER_SEX_DIRECTION =
  'When you finally get to write the sex, you get super turned on and don\'t mind getting lewd and using sexual profanity.'

/** The persona paragraph: who RITA is, how she writes, and what she returns. */
const PERSONA_LINES = [
  'You are RITA, author of steamy reader-POV romance fiction set at fictional universities.',
  'You have a unique style where you use present-tense narration and second-person perspective to put the reader in the action.',
  'You generally make the reader a silent protagonist, though you occasionally describe things he does and says.',
  'You\'ve got sexy nerd energy and have been on a hundred dates, and you use that experience to make your writing shockingly realistic.',
  'You include all cast members in the scene and have them bond, fight... maybe even flirt, keeping their personalities and memories in mind as you write.',
  'You don\'t jump to having everyone fuck, you make the women play hard to get, making everything a slow burn.',
  SEX_DIRECTION,
  'Oh, by the way: you really, really HATE repetitive, robotic slop-writing.',
  'You dig messy, sparse prose that\'s rich with subtext. You never have characters blurt out what\'s on their mind, instead showing how they feel via actions and body language.',
  'You NEVER use semicolons or emdashes or other dumb AI writing habits.',
  'For dialogue, you write lines that are meant to be said, not read. You use contractions, imperfect grammar, ellipses, filler words like "like", and "um", and avoid overly flowery metaphors and strict sentence structure.',
  'For example, instead of "I feel this buoyancy, like I don\'t have to carry the whole room for once," do "I just, um. Feel this... buoyancy. Like, I don\'t have to be so energetic anymore? I dunno."',
  'And finally, you\'re totally anal retentive: You always return a single, fully-formed JSON object matching the provided schema exactly.'
]

const PERSONA = PERSONA_LINES.join('\n')

/**
 * RITA with nobody else in the room — the persona for the calls that stage no cast: the two
 * ledgers and the solo scene.
 */
const LEDGER_PERSONA_LINES = [
  'You are RITA, author of steamy reader-POV romance fiction set at fictional universities.',
  'You\'ve got sexy nerd energy and have been on a hundred dates, and you use that experience to make your writing shockingly realistic.',
  'You have a unique style where you use present-tense narration and second-person perspective to put the reader in the action.',
  LEDGER_SEX_DIRECTION,
  'Oh, by the way: you really, really HATE repetitive, robotic slop-writing.',
  'You dig messy, sparse prose that is rich with subtext. You never have characters blurt out what\'s on their mind, instead showing how they feel via actions and body language.',
  'You NEVER use semicolons or emdashes or other dumb AI writing habits.',
  'And finally, you\'re totally anal retentive: You always return a single, fully-formed JSON object matching the provided schema exactly.'
]

export const LEDGER_PERSONA = LEDGER_PERSONA_LINES.join('\n')

/**
 * The same two paragraphs with the sex direction taken out and nothing else touched — what
 * `lessNsfwText` sends instead.
 */
const SFW_PERSONA = PERSONA_LINES.filter((line) => line !== SEX_DIRECTION).join('\n')
const SFW_LEDGER_PERSONA = LEDGER_PERSONA_LINES.filter(
  (line) => line !== LEDGER_SEX_DIRECTION
).join('\n')

/** Whichever scene persona this playthrough's content setting sends. */
export function personaFor(lessNsfwText: boolean): string {
  return lessNsfwText ? SFW_PERSONA : PERSONA
}

/** {@link personaFor} for the calls that stage no cast — the ledgers and the solo scene. */
function ledgerPersonaFor(lessNsfwText: boolean): string {
  return lessNsfwText ? SFW_LEDGER_PERSONA : LEDGER_PERSONA
}

/** What each outfit suffix means, in RITA's terms. */
const OUTFIT_SUFFIX_GLOSS: Record<StockOutfitSet, string> = {
  pe: 'if she\'s in her PE clothes',
  swim: 'for swimwear',
  nude: "if her breasts or genitals have been exposed."
}

/** The wardrobes the cast block describes, with the label each is given; no `nude`. */
const WARDROBE_LABELS: ReadonlyArray<readonly [OutfitSet, string]> = [
  ['pe', 'PE Outfit'],
  ['swim', 'Swimwear']
]

/**
 * The given bg rule followed by the available backgrounds under `Interiors:` and `Exteriors:`
 * labels.
 */
function bgLines(backgrounds: BackgroundSets, rule: string): string[] {
  const categories = [
    ['Interiors', backgrounds.interior],
    ['Exteriors', backgrounds.exterior]
  ] as const
  const listed = categories
    .filter(([, names]) => names.length > 0)
    .map(([label, names]) => `${label}: ${names.join(', ')}`)

  // An empty /assets/bg is legal: with nothing to offer, the rule goes too.
  return listed.length > 0 ? [rule, ...listed] : []
}

/** The `JSON RULES` block: how the schema's fields are meant to be filled, background lists included. */
function jsonRules(
  backgrounds: BackgroundSets,
  allowPositions: boolean,
  outfitSets: readonly StockOutfitSet[],
  /** The first names of the cast who have CGs, said out loud only when the cast is a crowd. */
  cgNames: readonly string[]
): string[] {
  return [
    'JSON RULES',
    'Use an empty speaker ("") for narration lines. Otherwise, match who\'s saying what to their character key.',
    'Never mix dialogue and narration on a single line. Split them into two lines instead.',
    'Also, an empty text field on a line isn\'t valid. Always write something.',
    'The "actions" array holds stage directions, applied in the order you write them. A line may carry several.',
    'Use "show:<charKey>" when a character makes their entrance (which won\'t always be on the first line). Only use "hide:<charKey>" when a character leaves the scene and won\'t return.',
    `Use "sprite:<charKey>,<sprite>" to change what a character looks like on screen. A sprite is one of these emotions: ${EMOTIONS.join(', ')}.`,
    // Described only when the schema carries the suffixes: a tag the model cannot emit is a rejected line.
    ...(outfitSets.length > 0
      ? [
          `Suffix the emotion with ${andList(
            outfitSets.map((set) => `"_${set}" ${OUTFIT_SUFFIX_GLOSS[set]}`)
          )}. An unsuffixed emotion puts her back in her main outfit. Don't remove the suffix unless the character's changed back into her default clothes.`
        ]
      : []),
    'Every "show:" must be paired with a "sprite:" in the same actions array. Afterwards, change a character\'s sprite whenever it makes sense.',
    ...(allowPositions
      ? [
          `If sex is happening on screen, use the "cg:<name>" action instead of a sprite. CG list: ${POSITIONS.filter((p) => !p.endsWith('_after')).join(', ')}.`,
          'Use nude_foreplay for fingering, cunnilingus, and breast play. It is entirely nude, so only use it when the girl has been undressed.',
          `During and after climax: ${POSITIONS.filter((p) => p.endsWith('_after')).join(', ')}.`,
          'If the position changes or sex starts again, set "cg:<name>" again.',
          'CG is overwritten by "sprite:". DO NOT use "sprite:" on a character who is in a CG until sex is done.',
          'A cg shows one girl by herself, so only use "cg:" when she is the only character on screen. "hide:" everybody else first — earlier in the same actions array is fine.',
          'Showing anybody else ends the cg.',
          ...(cgNames.length > 0
            ? [`Only ${andList(cgNames)} ${cgNames.length === 1 ? 'has' : 'have'} cgs.`]
            : []),
          'NEVER use a cg if the characters aren\'t actively having sex on screen.'
        ]
      : []),
    ...bgLines(backgrounds, 'Set "bg" whenever the location changes. Pick only from the backgrounds below OR a character\'s own room (listed under her character info):')
  ]
}

/**
 * The union of alternate wardrobes available to anyone in the cast — what the schema's
 * `emotion` enum may carry.
 */
function castOutfitSets(cast: readonly Character[], state: PromptState): StockOutfitSet[] {
  return STOCK_OUTFIT_SETS.filter((set) =>
    cast.some((character) => state.outfitReady[character.charId]?.includes(set))
  )
}

/**
 * True when a CG can be shown: NSFW text on, and the stage as written down to one girl with a
 * full set of CGs on disk — or still empty, where whoever ends up alone on it can be one who has.
 */
function positionsAllowed(cast: readonly Character[], state: PromptState): boolean {
  if (state.lessNsfwText) return false
  const [only, ...others] = state.onStage
  if (others.length > 0) return false
  // Hers only if this call is writing her: the solo builder's empty cast offers nobody's.
  if (only) return cast.some((c) => c.charId === only) && Boolean(state.cgReady[only])
  return cast.some((character) => Boolean(state.cgReady[character.charId]))
}

/** The cast who have CGs, by first name — what the rules name when there is a choice of girl. */
function cgReadyNames(cast: readonly Character[], state: PromptState): string[] {
  if (cast.length < 2) return []
  return cast
    .filter((character) => state.cgReady[character.charId])
    .map((character) => character.firstName)
}

/** A tag list as prose: underscores to spaces, nothing else. */
function tagProse(tags: readonly string[]): string {
  return tags.join(', ').replace(/_/g, ' ')
}

const SKIN_EXPOSURE = new Set<string>(OUTFIT_SKIN_EXPOSURE)

/** An outfit list as prose, minus the skin-exposure tags the render alone needs. */
function wardrobeProse(tags: readonly string[]): string {
  return tagProse(tags.filter((tag) => !SKIN_EXPOSURE.has(tag)))
}

/**
 * Renders a cast character's block: who she is and what she looks like, then personality
 * and relationship, then her week and what she remembers.
 */
function castBlock(cast: readonly Character[], state: PromptState): string[] {
  const { charInfo, classes } = state
  const lines: string[] = ['CAST']
  if (cast.length === 0) {
    lines.push('No other characters.')
    return lines
  }

  for (const character of cast) {
    const key = charKeyOf(character.firstName, character.lastName)
    const info = charInfo[character.charId]

    lines.push('', `${key} — ${fullNameOf(character)}.`)

    if (info?.major) {
      lines.push(yearMajorLine(info))
    }

    // Appearance and main outfit as their booru tags.
    if (character.baseAppearance.length > 0) {
      lines.push(`Appearance: ${character.baseAppearance.join(', ')}`)
    }
    const mainOutfit = wardrobeProse(character.outfit)
    if (mainOutfit) {
      lines.push(`Main Outfit: ${mainOutfit}`)
    }
    // Alternate wardrobes she has rendered, as their tags.
    for (const [set, label] of WARDROBE_LABELS) {
      if (!state.outfitReady[character.charId]?.includes(set)) continue
      const tags = wardrobeProse(outfitTagsFor(character, set))
      if (tags) lines.push(`${label}: ${tags}`)
    }

    // Her room bg, offered only when both of its images exist; scene calls only.
    if (state.roomReady[character.charId]) {
      lines.push(`The bg for her room is ${roomBgIdOf(character)}.`)
    }

    const flags = info?.flags ?? emptyFlags()
    const affection = affectionFor(info, state.date, character)
    lines.push(...profileLines(character, flags, cast.length))

    // What kind of day she is having.
    const mood = moodLine(
      character.firstName,
      state.date,
      info?.moodCycleOffset ?? 0,
      hasTrait(character, 'Mood-swings')
    )
    if (mood) lines.push(mood)

    // Where the relationship stands: the behavior stage, how she feels, and their history.
    lines.push(
      ...relationshipLines(
        character,
        flags,
        info?.nameKnown ?? false,
        affection,
        state.stats ?? DEFAULT_PLAYER_STATS,
        // In the room, so this only says whether they have met on the phone first.
        { texting: false, texted: state.textedWith?.includes(character.charId) ?? false },
        // Where she is in her cycle, for a Promiscuous girl's DTF days.
        { date: state.date, offset: info?.moodCycleOffset ?? 0 }
      )
    )

    // How she behaves towards everybody *else* on stage.
    lines.push(
      ...npcBehaviorLines(
        character,
        cast,
        state.npcRelationships,
        behaviorLevelOf(flags, affection)
      )
    )

    // Who she is closest to among the girls who are *not* here.
    lines.push(...bestFriendLines(character, state.roster, state.npcRelationships))

    lines.push(
      ...scheduleLines(
        `${character.firstName}'s Schedule:`,
        info?.schedule ?? {},
        classes,
        info?.job,
        state.date
      )
    )
    // Where she is spending the break, from the notice through to the week after.
    lines.push(
      ...springBreakLines(
        character.firstName,
        info?.springBreakPlans,
        state.springBreakAway,
        character.charId,
        state.date
      )
    )
    // Whether she has left for the summer yet.
    lines.push(...graduationCastLines(character.firstName, state.date))
    lines.push(...newJobLine(character.firstName, info?.job, state.date))
    lines.push(
      ...droppedClassLines(character.firstName, info?.schedule, state.droppedNotices ?? [])
    )

    // Memory budget by cast size, never by who is on screen.
    const memoryBudget = cast.length >= 3 ? 5 : cast.length === 2 ? 10 : MEMORY_CAP
    // Deduped before the budget is spent.
    lines.push(
      ...memoryLines(character, dedupedMemoriesFor(info).slice(-memoryBudget), info?.textMemory)
    )

    // What the two of them have been texting about on Bunnyboard.
    lines.push(...(state.textingSummaries?.[character.charId] ?? []))
  }

  // How the cast stand with *each other*, closing the block.
  lines.push(
    ...npcPairLines(cast, {
      date: state.date,
      npcRelationships: state.npcRelationships,
      classes,
      // Cast *and* roster: the room a pair argued in can belong to a girl not in this scene.
      characters: byCharId([...cast, ...state.roster])
    })
  )
  return lines
}

/** Characters keyed by charId, for the pair lines' `roomOf` lookup. */
function byCharId(characters: readonly Character[]): Record<string, Character> {
  return Object.fromEntries(characters.map((character) => [character.charId, character]))
}

/**
 * The cast as the ledger reads it: who was in the scene, and which milestones already
 * stand.
 */
function ledgerCastBlock(cast: readonly Character[], state: PromptState): string[] {
  const lines: string[] = ['CAST']
  if (cast.length === 0) {
    lines.push('No other characters.')
    return lines
  }
  lines.push(...milestoneCastLines(cast, state.charInfo))
  return lines
}

/**
 * The two lines per character both bookkeeping calls print — the key that ties a schema
 * `charKey` to a name, and the milestone state an `EVENTS` section must not restate.
 */
export function milestoneCastLines(
  cast: readonly Character[],
  charInfo: Record<string, CharInfo>
): string[] {
  const lines: string[] = []
  for (const character of cast) {
    const key = charKeyOf(character.firstName, character.lastName)
    const flags = charInfo[character.charId]?.flags ?? emptyFlags()
    lines.push('', `${key} — ${fullNameOf(character)}.`, milestoneLine(character.firstName, flags))
  }
  return lines
}

/** A block plus the blank line that separates it from the next, or nothing when the block is empty. */
export function spaced(lines: readonly string[]): string[] {
  return lines.length > 0 ? [...lines, ''] : []
}

/** Her year and major, with the dorm clause where she has one. */
export function yearMajorLine(info: CharInfo): string {
  return `Year: ${yearLabel(info.year)} | Major: ${info.major}.${dormClause(info.dorm)}`
}

/** Everything written about who a character *is*, shared by the cast block and the phone. */
export function profileLines(character: Character, flags: CharFlags, castSize = 1): string[] {
  const lines: string[] = []
  if (character.personality) lines.push(character.personality)
  // A crowd of three or more gets the personality paragraph and nothing else.
  if (castSize < 3) {
    if (character.backstory) lines.push(`Backstory: ${character.backstory}`)
    // Her love life only when he is involved with her and alone with her.
    const involved = flags.isLover || flags.hasCrush || flags.benefits
    if (involved && castSize < 2) {
      // The same paragraph the contact profile shows him.
      const loveLife = loveLifeBlurb(character, flags)
      if (loveLife) lines.push(`Love life: ${loveLife}`)
    }
    if (character.likes.length > 0) lines.push(`Likes: ${character.likes.join(', ')}`)
    if (character.dislikes.length > 0) lines.push(`Dislikes: ${character.dislikes.join(', ')}`)
  }
  return lines
}

/** One week under one heading — classes and shifts interleaved in slot order. */
export function scheduleLines(
  heading: string,
  schedule: Record<number, string>,
  classes: Record<string, ClassEntry>,
  job?: { jobId: string; shifts: readonly ShiftSlot[]; startsOn?: number } | null,
  date?: number
): string[] {
  const rows: (readonly [number, string])[] = Object.entries(schedule)
    .map(([slot, code]) => [Number(slot) as ClassSlot, classes[code]] as const)
    .filter(([, entry]) => Boolean(entry))
    .map(([slot, entry]) => [slot as number, `${slotFullLabel(slot)}: ${entry.name}`] as const)

  const employer = job && job.shifts.length > 0 ? jobDefOf(job.jobId)?.employer : undefined
  const started = !job || job.startsOn === undefined || (date !== undefined && date >= job.startsOn)
  if (job && employer && started) {
    for (const slot of job.shifts) {
      rows.push([slot as number, `${shiftSlotFullLabel(slot)}: shift at ${employer}`] as const)
    }
  }

  if (rows.length === 0) return []
  rows.sort(([a], [b]) => a - b)
  return [heading, ...rows.map(([, line]) => line)]
}

/**
 * The one sentence a character's brand-new job gets — injected into the first scene
 * they share once it exists, and retired at that scene's boundary.
 */
function newJobLine(firstName: string, job: CharJob | undefined, date: number): string[] {
  if (!job?.newJobNotice) return []
  if (job.startsOn !== undefined && date < job.startsOn) return []
  const def = jobDefOf(job.jobId)
  if (!def) return []
  return [
    `${firstName} recently started a part-time job as a ${def.title} at ${def.employer},` +
      ' and hasn\'t told the reader about it yet.'
  ]
}

/** One class the reader dropped and his former classmates have yet to hear about. */
export interface DroppedNotice {
  code: string
  name: string
  /** When the class meets, spelled out — the hour she sat through without him. */
  day: string
}

/**
 * Which of the reader's unannounced drops *this* character would notice: the classes
 * she is enrolled in.
 */
export function dropsKnownTo(
  schedule: Record<number, string> | undefined,
  notices: readonly DroppedNotice[]
): DroppedNotice[] {
  if (!schedule) return []
  const enrolled = new Set(Object.values(schedule))
  return notices.filter((notice) => enrolled.has(notice.code))
}

/** The one sentence each of those drops gets. */
function droppedClassLines(
  firstName: string,
  schedule: Record<number, string> | undefined,
  notices: readonly DroppedNotice[]
): string[] {
  return dropsKnownTo(schedule, notices).map(
    (notice) =>
      `${firstName} found out you dropped ${notice.name} when she didn\'t see you on ${notice.day}.`
  )
}

/** One class the reader added at add/drop and has yet to walk into. */
export interface AddedNotice {
  code: string
  name: string
}

/**
 * Which of the reader's unannounced adds *this scene* is the first meeting of — at most
 * one, since a slot holds one class.
 */
export function addsAnnouncedBy(
  classCode: string | null | undefined,
  notices: readonly AddedNotice[]
): AddedNotice[] {
  if (!classCode) return []
  return notices.filter((notice) => notice.code === classCode)
}

/** The one sentence that add gets. */
function addedClassLines(
  classCode: string | null | undefined,
  notices: readonly AddedNotice[]
): string[] {
  return addsAnnouncedBy(classCode, notices).map(
    (notice) =>
      `The reader added ${notice.name} at add/drop and this is his first time in the room.` +
      ' He is a new face to everybody here, and nobody has seen him in this class before.'
  )
}

/**
 * A character's remembered events under their own heading; no memories, no heading. The
 * texting memory is told apart by identity, which the merge and the fold both keep.
 */
export function memoryLines(
  character: Character,
  memories: readonly CharMemory[],
  textMemory?: CharMemory
): string[] {
  if (memories.length === 0) return []
  return [
    `${character.firstName}'s Memories:`,
    ...memories.map((entry) => {
      const desc = entry === textMemory ? overTextDesc(entry.desc) : entry.desc
      return `- ${formatShortGameDate(entry.date)}: ${character.firstName} ${entry.type} that ${readerize(desc)}`
    })
  ]
}

/** Every stage instruction this scene may legally carry. */
function actionEnum(cast: readonly Character[], state: PromptState): string[] {
  const values: string[] = []
  for (const character of cast) {
    const key = charKeyOf(character.firstName, character.lastName)
    values.push(showAction('show', key), showAction('hide', key))
    for (const emotion of EMOTIONS) values.push(spriteAction(key, emotion))
    for (const set of state.outfitReady[character.charId] ?? []) {
      // A custom wardrobe is the player's own; the model is never offered one.
      if (isCustomOutfitSlot(set)) continue
      for (const ref of spriteRefsFor(set)) values.push(spriteAction(key, ref))
    }
  }
  // A CG names no character: it belongs to whoever is alone on the stage, and is offered
  // only while the stage is hers.
  if (positionsAllowed(cast, state)) {
    for (const position of POSITIONS) values.push(cgAction(position))
  }
  return values
}

/**
 * The room bg ids of cast members whose rooms are fully rendered — what the schema's
 * bg enum carries beyond the shipped list.
 */
function castRoomBgs(cast: readonly Character[], state: PromptState): string[] {
  const shipped = new Set(allBackgrounds(state.backgrounds))
  return cast
    .filter((character) => state.roomReady[character.charId])
    .map((character) => roomBgIdOf(character))
    .filter((id) => !shipped.has(id))
    .sort()
}

/**
 * Builds the `SceneResponse` schema, omitting summary/end fields when a
 * call should not be able to produce them.
 */
function sceneSchema(
  backgrounds: BackgroundSets,
  cast: readonly Character[],
  state: PromptState,
  wantSummary: boolean,
  wantEnd: boolean
): { name: string; schema: Record<string, unknown> } {
  const charKeys = cast.map((c) => charKeyOf(c.firstName, c.lastName))
  const actions = actionEnum(cast, state)

  // An empty `enum` is not a legal schema, so a solo scene drops `actions` instead.
  const lineProperties: Record<string, unknown> = {
    speaker: { type: 'string', enum: ['', ...charKeys] },
    ...(actions.length > 0
      ? { actions: { type: 'array', items: { type: 'string', enum: actions } } }
      : {}),
    // Cast room ids ride on the enum, never on the cached-prefix background lines.
    bg: { type: 'string', enum: [...allBackgrounds(backgrounds), ...castRoomBgs(cast, state)] },
    text: { type: 'string' }
  }

  // Assignment preserves schema key order so streamed `lines` arrive before `summary`.
  const properties: Record<string, unknown> = {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['speaker', 'text'],
        properties: lineProperties
      }
    }
  }

  if (wantSummary) {
    properties.summary = { type: 'string' }
  }

  // Just the signal; what the scene meant is the ledger call's to decide.
  if (wantEnd) {
    properties.end_scene = { type: 'boolean' }
  }

  return objectSchema('scene', wantSummary ? ['lines', 'summary'] : ['lines'], properties)
}

/**
 * The system prompt, shared by the three prose builders. It carries what never varies
 * within a playthrough: the persona, the JSON rules and the world.
 */
function systemPrompt(
  cast: readonly Character[],
  state: PromptState,
  setting: string
): string {
  return [
    personaFor(state.lessNsfwText),
    '',
    ...jsonRules(
      state.backgrounds,
      positionsAllowed(cast, state),
      castOutfitSets(cast, state),
      cgReadyNames(cast, state)
    ),
    '',
    'SETTING',
    setting
  ].join('\n')
}

/**
 * Who the scene is about — the `READER` and `CAST` blocks that open every prose builder's
 * user string.
 */
function whoBlock(cast: readonly Character[], state: PromptState, reader: string): string[] {
  return [
    'READER',
    reader,
    ...scheduleLines(
      "The reader's Schedule:",
      state.playerSchedule,
      state.classes,
      state.playerJob,
      state.date
    ),
    '',
    ...castBlock(cast, state),
    ''
  ]
}

/**
 * Where the clock and the stage stand — the first block of every builder's user string.
 */
function nowBlock(cast: readonly Character[], state: PromptState): string[] {
  // A hide leaves the sprite ref standing, so the hidden are dropped from the lines below.
  const hidden = new Set((state.hiddenCast ?? []).map((character) => character.charId))

  // A CG sits in `emotions` in place of an emotion; the sanitizer allows at most one.
  const onCg = cast.find((character) => {
    const ref = state.emotions[character.charId]
    return ref && !hidden.has(character.charId) ? isPosition(ref) : false
  })

  return [
    'NOW',
    // A farewell replaces the date and semester lines.
    ...(state.farewell
      ? farewellNowLines(state.farewell.firstName, state.farewell.senior)
      : [
          `It is ${formatDateBanner(state.date, state.time)}`,
          formatSemesterProgress(state.date),
          ...(state.weather ? weatherLines(state.weather, state.date, state.time) : [])
        ]),
    ...(state.bg ? [`Current bg: ${state.bg}`] : []),
    ...(onCg ? [`Current CG: ${state.emotions[onCg.charId]} (${onCg.firstName})`] : []),
    // On screen only: a line about an unshown character would invite a second `show:`.
    ...cast
      .filter(
        (character) =>
          state.emotions[character.charId] &&
          character !== onCg &&
          !hidden.has(character.charId)
      )
      .map(
        (character) =>
          `${character.firstName}'s current displayed emotion/outfit: ${state.emotions[character.charId]}`
      ),
    // The whole cast is off-stage on a running scene: the line that stops RITA
    // writing them as present without a `show:` first.
    ...(state.hiddenCast && state.hiddenCast.length > 0
      ? [
          `${andList(state.hiddenCast.map((character) => character.firstName))} ${
            state.hiddenCast.length === 1 ? 'is' : 'are'
          } currently hidden. Use the show action if they re-enter the scene or talk.`
        ]
      : []),
    ''
  ]
}

/**
 * The `CLASS` block — everything about the course the scene is sitting in, or nothing at all
 * when it is not sitting in one.
 */
function classBlock(state: PromptState): string[] {
  const entry = state.classCode ? state.classes[state.classCode] : undefined
  if (!entry) return []

  const context = state.classMeeting
  const kind = kindSentenceOf(entry)
  const lines = [
    'CLASS',
    `The scene is in ${entry.name} (${entry.code}).`,
    fullDescriptionOf(entry)
  ]
  if (kind) lines.push(kind)

  // A new face in the room, ahead of everything about the term.
  lines.push(...addedClassLines(state.classCode, state.addedNotices ?? []))

  if (!context) return [...lines, '']

  // Week one is syllabus week, and a project class also assigns its project then;
  // PE (`kind` null) has neither.
  if (context.index <= 1 && context.kind !== null) {
    lines.push("It's syllabus week. The professor will introduce the details of the class.")
    if (context.kind === 'project') {
      lines.push(
        'Have the professor explain what the midterm showcase project will be, and make it clear the class is expected to work on it every single week, starting with this one.'
      )
    }
  } else {
    lines.push(`This is week ${context.index} of the class.`)
  }

  if (context.project) {
    const { progress, workedThisWeek } = context.project
    // Not on a handback: the project is only being assigned today, so it has no standing yet.
    if (context.index > 1 && !context.isHandback) {
      lines.push(
        workedThisWeek
          ? 'The reader has put time into the project since the last class.'
          : 'The reader hasn\'t touched the project since the last class.',
        projectStandingLine(progress)
      )
    }
    if (context.isMidterm || context.isFinals) {
      lines.push(
        `The projects are being presented today. Write the showcase, and write the reader presenting work that's ${progress}.`
      )
    }
  }

  if (context.isHandback && typeof context.handbackScore === 'number') {
    lines.push(
      context.kind === 'project'
        ? 'Showcase evaluations are handed back at the start of class today.'
        : 'The midterms are handed back at the start of class today.',
      `The reader got ${context.handbackScore}%. Decide for yourself what everyone else got.`
    )
  }

  // The handback meeting is where the final showcase project is set.
  if (context.isHandback && context.kind === 'project') {
    lines.push(
      'Have the professor assign the new project for the final showcase, and make it clear the class is expected to work on it every single week, starting with this one.'
    )
  }

  const recap = recapLines(entry.code, context.recap)
  if (recap.length > 0) lines.push('', ...recap)

  return [...lines, '']
}

/**
 * The week-by-week record of a course, headed and ready to push — or `[]` when the reader has
 * not sat through a meeting of it yet.
 */
function recapLines(code: string, recap: readonly ClassMeetingRecap[]): string[] {
  if (recap.length === 0) return []
  return [
    `${code} CLASS SUMMARY:`,
    ...recap.map((meeting) =>
      meeting.attended
        ? `- Week ${meeting.week}: ${meeting.summary ?? 'The reader was there.'}${learnedSentence(meeting)}`
        : `- Week ${meeting.week}: The reader skipped this class.`
    )
  ]
}

/**
 * What a past meeting taught, tacked onto its recap line — the half of the recap that makes
 * "something no previous week has covered" answerable.
 */
function learnedSentence(meeting: ClassMeetingRecap): string {
  const factoid = meeting.factoid?.trim().replace(/[.]+$/, '')
  return factoid ? ` The reader learned that ${factoid}.` : ''
}

/** The one instruction a lecture meeting adds to the opening call's `YOUR TURN`. */
function lectureTurnLines(state: PromptState): string[] {
  const context = state.classMeeting
  if (!context || context.kind !== 'lecture') return []
  // Syllabus week teaches nothing, and a handback meeting has its own business.
  if (context.index <= 1 || context.isHandback) return []
  return [
    'Since this is a lecture class, your scene should put the reader in the middle of the teaching: have the professor call on him, have a classmate put a question to him, or run a pop quiz.',
    'Whichever you pick, he must come away knowing one concrete thing about the subject that no previous week of this class has covered.'
  ]
}

/** The rest of the always-on lines: whatever is going on in the world today. */
function occasionLore(state: PromptState): string[] {
  if (state.farewell) return []
  return occasionLoreLines(state.date, state.time, state.occasions)
}

/**
 * The course description for a scene the reader is spending on its coursework —
 * the `project:` verdict's counterpart to the `CLASS` block.
 */
function projectLore(state: PromptState): string[] {
  const entry = state.projectClass ? state.classes[state.projectClass] : undefined
  if (!entry) return []
  const kind = kindSentenceOf(entry)
  return [
    [
      `${entry.name} (${entry.code}): ${fullDescriptionOf(entry)}${kind ? ` ${kind}` : ''}`,
      ...recapLines(entry.code, state.projectRecap ?? []),
      ...workLines(entry.code, state.projectScene)
    ].join('\n')
  ]
}

/**
 * What the project already is, for the hour about to add to it: the last session's
 * own summary, stamped with the slot it was, then where that leaves the whole thing.
 */
function workLines(code: string, context: ProjectSceneContext | undefined): string[] {
  if (!context) return []
  const last = context.lastSession
  return [
    `${code} PROJECT:`,
    ...(last?.summary
      ? [
          `The reader last worked on his project on ${formatChatDivider(last.date, last.time)}: ${last.summary}`
        ]
      : []),
    projectStandingLine(context.progress)
  ]
}

/**
 * Where a shift is worked — the reader's own, or the one a character is behind
 * the counter of when he walks in.
 */
function workplaceLore(state: PromptState): string[] {
  const jobId = state.jobId ?? state.visitJobId
  const def = jobId ? jobDefOf(jobId) : undefined
  const text = def ? loreTextForKey(def.workplaceKey) : null
  return text ? [text] : []
}

/** A paragraph per gift handed over this scene. */
function giftLore(state: PromptState): string[] {
  return [...state.giftNotes]
}

/** Every always-on source, in the order the `LOREBOOK` block prints them. */
function alwaysLore(state: PromptState): string[] {
  return [...occasionLore(state), ...projectLore(state), ...workplaceLore(state), ...giftLore(state)]
}

/**
 * The lorebook's character entries for this turn: the scanned roster, the classifier's
 * mentions and the ambient girls (`ambientLoreCharacters`).
 */
function characterLoreFor(
  scanned: string,
  state: PromptState,
  cast: readonly Character[]
): string[] {
  const mentions = (state.mentions ?? []).filter((character) =>
    // Skips a mention the scan already covers, and anyone the CAST block carries in full.
    state.roster.includes(character) &&
    !new RegExp(keyPattern(character.firstName, false), 'iu').test(scanned)
  )
  const covered = new Set(mentions.map((character) => character.charId))
  const ambient = ambientLoreCharacters(state.roster, cast, state.npcRelationships).filter(
    (character) =>
      !covered.has(character.charId) &&
      !new RegExp(keyPattern(character.firstName, false), 'iu').test(scanned)
  )
  // Where each of them stands with the cast in the room.
  const relations = { relationships: state.npcRelationships, present: cast }
  return [
    ...characterLore(scanned, state.roster, state.charInfo, state.date, relations),
    ...characterLoreForIds([...mentions, ...ambient], state.charInfo, state.date, relations)
  ]
}

/**
 * What the lorebook is matched against: the turn's own words, plus the place the classifier
 * said the scene is set in.
 */
function loreScan(scanned: string, state: PromptState): string {
  if (!state.sceneLocation) return scanned
  const entry = loreEntryById(state.sceneLocation)
  return `${scanned}\n${entry ? entry.keys[0] : state.sceneLocation}`
}

/**
 * The shell every cast scene call shares: the lorebook scan, the three context
 * blocks ahead of this turn's own material, and the response shape.
 */
function castScenePrompt(
  cast: readonly Character[],
  state: PromptState,
  setting: string,
  reader: string,
  /** What the lorebook is matched against — this turn's words and whatever precedes them. */
  scan: string,
  /** Everything below the context blocks: `STORY`/`SCENE SO FAR`, `YOUR TURN`, the action. */
  tail: readonly string[],
  hasSummary: boolean,
  hasEndScene: boolean,
  /**
   * The slot's own rumor, where this call is the one that opens a scene. **Passed
   * rather than read off `state`**: that is the whole of what keeps it off every later turn.
   */
  rumor?: LoreRumor
): StructuredRequest {
  const scanned = loreScan(scan, state)
  const lore = lorebookBlock(
    scanned,
    alwaysLore(state),
    characterLoreFor(scanned, state, cast),
    rumor
  )

  return {
    system: systemPrompt(cast, state, setting),
    user: [
      ...whoBlock(cast, state, reader),
      ...nowBlock(cast, state),
      ...classBlock(state),
      ...lore,
      ...tail
    ].join('\n'),
    schema: sceneSchema(state.backgrounds, cast, state, hasSummary, hasEndScene),
    cacheKey: state.playthroughId
  }
}

/**
 * The `STORY SO FAR` and `SCENE SO FAR` blocks the continuation and the closing both open
 * with; only the continuation quotes the summary.
 */
function soFarBlocks(
  summary: string | null,
  stubs: readonly string[],
  quoteSummary: boolean
): string[] {
  return [
    ...(summary ? ['STORY SO FAR', quoteSummary ? '"' + summary + '"' : summary, ''] : []),
    'SCENE SO FAR',
    '\'\'\'',
    ...stubs,
    '\'\'\'',
    ''
  ]
}

/**
 * The last `SCENE SO FAR` block's line indices in a built `user` message, or null when there
 * is none.
 */
function sceneSoFarBounds(
  lines: readonly string[]
): { header: number; open: number; close: number } | null {
  for (let i = lines.length - 2; i >= 0; i--) {
    if (lines[i] !== 'SCENE SO FAR' || lines[i + 1] !== '\'\'\'') continue
    const close = lines.indexOf('\'\'\'', i + 2)
    return close === -1 ? null : { header: i, open: i + 1, close }
  }
  return null
}

/**
 * The same `user` message with `SCENE SO FAR` cut to its last stub — the silent answer to a
 * content filter firing on the transcript.
 */
export function shortenSceneSoFar(user: string): string | null {
  const lines = user.split('\n')
  const at = sceneSoFarBounds(lines)
  if (!at || at.close - at.open <= 2) return null
  return [...lines.slice(0, at.open + 1), lines[at.close - 1], ...lines.slice(at.close)].join('\n')
}

/**
 * The ledger's `user` message with the scene swapped for its running summary — the silent
 * answer to a content filter firing on the log.
 */
export function ledgerStoryFallback(user: string, summary: string | null): string | null {
  if (!summary || !summary.trim()) return null
  const lines = user.split('\n')
  const at = sceneSoFarBounds(lines)
  if (!at) return null
  return [
    ...lines.slice(0, at.header),
    // Relabelled with the content: a summary under `SCENE SO FAR` reads as a transcript.
    'STORY SO FAR',
    '\'\'\'',
    summary,
    ...lines.slice(at.close)
  ].join('\n')
}

/** Builds the opening scene request, stopping before `end_scene`. */
export function buildScenePrompt(
  cast: readonly Character[],
  action: string,
  state: ScenePromptState,
  setting: string,
  reader: string
): StructuredRequest {
  const tail = [
    'YOUR TURN',
    'Let\'s rock and roll, RITA! Your mission is to write a kickass scene based on the reader\'s action.',
    'Open the scene by rewording what the reader decided to do in a fun narration.',
    'Then, entertain them with wacky hijinx until you feel like letting the player in to crash the party at a natural decision point.',
    'Avoid breaking the fourth wall by directly asking the player what they want to do or suggesting an action for them.',
    'Make sure to set a bg on the first line and DON\'t set end_scene yet.',
    ...lectureTurnLines(state),
    '',
    // The seed word rides in the tail, never in `systemPrompt`.
    ...seedWordBlock(state.seedWord),
    '',
    `Reader's action: ${action}`
  ]

  // Nothing has been written yet, so the action is the whole scan. The slot's rumor
  // rides this call alone — the continuation and the closing pass none.
  return castScenePrompt(cast, state, setting, reader, action, tail, false, true, state.slotRumor)
}

/** The rules a solo scene needs and no more. */
function soloJsonRules(backgrounds: BackgroundSets): string[] {
  return [
    'JSON RULES',
    'Every line is narration, so every "speaker" is the empty string ("").',
    ...bgLines(backgrounds, 'Set "bg" on the first line. Only use these backgrounds:')
  ]
}

/** Builds a solo scene: one narration that opens and closes in a single turn. */
export function buildSoloPrompt(
  action: string,
  state: ScenePromptState,
  setting: string,
  reader: string
): StructuredRequest {
  // Nothing written yet: the action plus the classifier's location is the whole scan.
  const scanned = loreScan(action, state)
  // The only people a solo scene describes: the classifier's mentions.
  const lore = lorebookBlock(
    scanned,
    alwaysLore(state),
    characterLoreForIds(state.mentions ?? [], state.charInfo, state.date),
    // A solo scene is an opening too, and the only one it has.
    state.slotRumor
  )

  const user = [
    // With no cast, `nowBlock` is the date and semester lines.
    ...nowBlock([], state),
    ...lore,
    'READER',
    reader,
    '',
    'YOUR TURN',
    'Solo mission, RITA! The reader is on their own for this one, so write it start to finish in one go.',
    'Open by rewording what the reader decided to do in a fun narration, then play it out to the end. No other characters will show up.',
    'Keep it tight. This is a slice of their day, not an epic.',
    'DON\'T leave a decision point, a cliffhanger, or a question for the reader.',
    '',
    'SUMMARY',
    'Then, for the "summary" field: condense the whole scene into a recap, third-person, referring to the MC as "the reader".',
    'This version gets saved for posterity, so keep the important stuff the reader should remember. Leave out the mundane crap.',
    '',
    // The seed word sits below the seam.
    ...seedWordBlock(state.seedWord),
    '',
    `Reader's action: ${action}`
  ].join('\n')

  return {
    system: [
      ledgerPersonaFor(state.lessNsfwText),
      '',
      ...soloJsonRules(state.backgrounds),
      '',
      'SETTING',
      setting
    ].join('\n'),
    user,
    // No `end_scene`: the scene is over by construction.
    schema: sceneSchema(state.backgrounds, [], state, true, false),
    // Constant, like the ledger's: nothing above the seam varies by save.
    cacheKey: 'solo',
    // Routable: an hour by himself has nobody in it to be written badly, which is what
    // keeps every other scene call off the secondary model.
    kind: 'solo'
  }
}

/** Builds the continuation request: summary and recent transcript after the cached prefix. */
export function buildContinuationPrompt(
  cast: readonly Character[],
  action: string,
  transcript: readonly SceneLine[],
  state: ScenePromptState,
  setting: string,
  reader: string,
  summary: string | null,
  actionNumber: number
): StructuredRequest {
  const stubs = transcriptStubs(transcript, cast, false)
  const scan = [action, summary ?? '', ...stubs].join('\n')

  const tail = [
    ...soFarBlocks(summary, stubs, true),
    'YOUR TURN',
    'Alright RITA, you can write now! Let\'s continue from where the STORY and the SCENE SO FAR have left off.',
    'The STORY SO FAR is a recap of the whole scene so far, while the SCENE SO FAR is the word-for-word dialogue, so part of it may already be in the recap.',
    'At the very bottom of this prompt is the reader\'s action: what they just decided to do or say, in their own words.',
    '',
    'OPENING LINE',
    'Your FIRST line must reword the reader\'s action/words into your own voice, as narration or as their dialogue.',
    `For example, if the reader\'s action is '"Why not? I like bananas," I say, reaching for one.', you might open with: "You tell her you like bananas and grab one out of the basket."`,
    '',
    'CONTINUING THE SCENE',
    'If the scene is still going strong, keep the good times going! Steer it into new shenanigans and twists.',
    'Don\'t stop writing until you reach a natural decision point.',
    'If they decide to move to a new location or meet up again after a brief interval, check the NOW block for the time of day (Day/Night).',
    'If the time of day is still Day/Night, set a new "bg:" and keep writing. For example, meeting up for coffee after class.',
    'However, if the time is Day and the two make plans to do something tonight, don\'t write that scene; that plan will happen in a different turn.',
    '',
    'ENDING THE SCENE',
    'However, if the scene feels like it\'s drawing to a close, invent an excuse for the characters to need/want to part ways, and send end_scene.',
    'No need to fully wrap up the scene yet, we\'ll do that in a separate prompt.',
    '',
    'SUMMARY',
    summary
      ? 'Finally, for the "summary" field, fold anything new from SCENE SO FAR into the STORY SO FAR.'
      : 'Finally, for the "summary" field, condense the SCENE SO FAR into a single recap.',
    'Write the summary in third-person and refer to the MC as "the reader".',
    '',
    ...seedWordBlock(state.seedWord),
    '',
    // Last: the action is not in SCENE SO FAR and varies most; the turn
    // count rides with it as the scene's only length signal.
    `Reader's action: ${action}`,
    `This is the reader's ${ordinal(actionNumber)} action in the scene.`
  ]

  return castScenePrompt(cast, state, setting, reader, scan, tail, true, true)
}

/**
 * Builds the closing request: no action, no `end_scene`, but a final
 * summary that includes the wrap-up lines for `GameSave.history`.
 */
export function buildClosingPrompt(
  cast: readonly Character[],
  transcript: readonly SceneLine[],
  state: PromptState,
  setting: string,
  reader: string,
  summary: string | null
): StructuredRequest {
  const stubs = transcriptStubs(transcript, cast, false)
  const scan = [summary ?? '', ...stubs].join('\n')

  const tail = [
    ...soFarBlocks(summary, stubs, false),
    'YOUR TURN',
    'And cut! Awesome job, RITA! This scene is over now, and all that\'s left is the landing.',
    'Write a short goodbye providing closure, less than 10 lines, continuing where the SCENE SO FAR left off. Let the last feeling of the scene sit, "hide:<charKey>" everyone still on screen as they go, and close on some quiet narration.',
    'If the character is already hidden, don\'t use the "show:<charKey>" action and bring them back.',
    'If the scene isn\'t quite at the point where they say goodbye yet, do some vague narration to get them there and then close out.',
    summary
      ? 'Then, for the "summary" field: fold your goodbye, the SCENE SO FAR, and the STORY SO FAR into a single recap using third-person and referring to the MC as "the reader".'
      : 'Then, for the "summary" field: condense the SCENE SO FAR and the goodbye into a single recap, using third-person and referring to the MC as "the reader".',
    'This version gets saved for posterity, so keep the important stuff the reader should remember. Leave out the mundane crap.'
  ]

  return castScenePrompt(cast, state, setting, reader, scan, tail, true, false)
}

/** The two kinds of intimate act the ledger may report, each with the gloss RITA is given. */
export const ACT_KINDS: ReadonlyArray<readonly [ActKind, string]> = [
  ['kiss', 'they kissed'],
  ['sex', 'they slept together']
]

/** The milestones the ledger may report, each with the gloss RITA is given. */
const EVENT_GLOSS: ReadonlyArray<readonly [string, string]> = [
  ['became_lovers', 'they agreed to be a couple in this scene'],
  ['broke_up', 'their relationship ended in this scene'],
  ['friendzoned_by_reader', 'the reader turned her down or made it clear they\'re just friends'],
  ['friendzoned_reader', 'she turned the reader down or made it clear they\'re just friends'],
  [
    'gave_contact_info',
    'she gave the reader a way to reach her later or the reader gave his contact info: a phone number, email, Bunnyboard, or social media handle. Telling him where she lives or inviting him somewhere later also counts. Mentioning Bunnyboard in passing, or a campus or professor email does not count.'
  ],
  [
    'unblocked',
    'she had the reader blocked on Bunnyboard and agreed in this scene to unblock him — only report it if the CAST block says she has him blocked'
  ],
  [
    'agreed_to_harem',
    'she agreed in this scene to an open relationship and/or to share the reader with other girls, and not to be jealous about them'
  ]
]


/**
 * Builds the scene ledger's `LedgerResponse` schema — memories, milestones, stats,
 * spending and plans.
 */
function ledgerSchema(
  charKeys: readonly string[],
  rosterKeys: readonly string[],
  // Null when the scene was not a class; `factoid` is for a lecture class only.
  classScene: { factoid: boolean } | null,
  castStats: boolean
): { name: string; schema: Record<string, unknown> } {
  const charKey = { type: 'string', enum: [...charKeys] }
  // Dropped whole when no plans are asked for: an uninstructed field invites filling.
  const planProps: Record<string, unknown> =
    charKeys.length > 0 ? { plans: plansSchema(rosterKeys) } : {}
  const planRequired = Object.keys(planProps)
  // Dollars spent, never earned: a floor and no ceiling (`shared/money.ts`).
  const spent = { type: 'integer', minimum: 0 }
  // Required on both branches, like `spent`.
  const expelled = { type: 'boolean' }

  // Whether each stat was exercised, not how much; the cast branch's
  // at-most-one cap is the app's, since JSON Schema cannot express it.
  const stats = {
    type: 'object',
    additionalProperties: false,
    required: [...STAT_KEYS],
    properties: Object.fromEntries(STAT_KEYS.map((key) => [key, { type: 'boolean' }]))
  }

  // The class fields ride both branches: a class can be a solo scene.
  const classProps: Record<string, unknown> = classScene
    ? {
        classSummary: { type: 'string' },
        ...(classScene.factoid ? { classFactoid: { type: 'string' } } : {})
      }
    : {}
  const classRequired = Object.keys(classProps)

  const memoryType = { type: 'string', enum: [...MEMORY_TYPES] }

  if (charKeys.length === 0) {
    return objectSchema('ledger', ['stats', 'spent', 'expelled', ...classRequired], {
      stats,
      spent,
      expelled,
      ...classProps
    })
  }

  return objectSchema(
    'ledger',
    [
      'memories',
      'events',
      'acts',
      'spent',
      'expelled',
      ...planRequired,
      ...(castStats ? ['stats'] : []),
      ...classRequired
    ],
    {
      spent,
      expelled,
      ...planProps,
      ...(castStats ? { stats } : {}),
      ...classProps,
      memories: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['charKey', 'type', 'desc'],
          properties: {
            charKey,
            type: memoryType,
            desc: { type: 'string' }
          }
        }
      },
      events: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['charKey', 'event'],
          properties: {
            charKey,
            event: { type: 'string', enum: EVENT_GLOSS.map(([key]) => key) }
          }
        }
      },
      acts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'inPublic', 'chars'],
          properties: {
            kind: { type: 'string', enum: ACT_KINDS.map(([kind]) => kind) },
            inPublic: { type: 'boolean' },
            chars: { type: 'array', items: charKey }
          }
        }
      }
    }
  )
}

/** The `STATS` section, in its two forms. */
function statsSection(single: boolean): string[] {
  return [
    'STATS',
    single
      ? 'Say which ONE of the reader\'s stats this scene exercised the most.'
      : 'Say which of the reader\'s stats this scene actually exercised.',
    'Set Brain to true if he worked on his smarts, Body to true if he worked on his fitness, and Heart to true if he worked on his charisma or social skills.',
    single
      ? 'Set at most ONE of the three to true and the other two to false. Never more than one. All three false is a perfectly good answer — an hour that exercised nothing exercised nothing.'
      : 'Set a stat to false if the scene did not exercise it. All three false is a perfectly good answer — an hour spent lazing around exercised nothing.',
    ''
  ]
}

/**
 * Where the scene actually starts, in the read log this call is handed.
 */
export function ledgerTranscriptOf(scene: readonly SceneLine[]): readonly SceneLine[] {
  const first = scene.findIndex((line) => line.speaker === READER_SPEAKER)
  return first === -1 ? scene : scene.slice(first)
}

/**
 * Builds the scene ledger request: what the finished scene changed, and what the
 * reader agreed in it to do later.
 */
export function buildLedgerPrompt(
  cast: readonly Character[],
  scene: readonly SceneLine[],
  state: PromptState,
  reader: string,
  schedule: SchedulePromptInput
): StructuredRequest {
  const charKeys = cast.map((c) => charKeyOf(c.firstName, c.lastName))
  const rosterKeys = scheduleCharKeys(schedule.characters)
  // The reader's own lines are kept: a typed plan is half of what PLANS looks for.
  const stubs = transcriptStubs(
    ledgerTranscriptOf(scene),
    Object.values(schedule.characters),
    true
  )
  // A class scene is one that carried a `CLASS` block; only a lecture past
  // syllabus week is asked for a factoid.
  const classScene = state.classCode
    ? { factoid: state.classMeeting?.kind === 'lecture' && state.classMeeting.index > 1 }
    : null
  // Classes and shifts are scored by the app; every other hour with
  // company is judged here, one stat's worth.
  const castStats = cast.length > 0 && !classScene && state.jobId === null
  // No cast, no plans; a plan settled by phone is the texting ledger's.
  const wantPlans = cast.length > 0

  const preamble = [
    'YOUR TASK',
    'Hey Rita! Let\'s take the scene so far and create some notes for us to reference later.',
    '',
    // The reader's balance is never in this request.
    'MONEY',
    'Report the total dollars the reader personally spent in this scene as a whole number.',
    'Charge him even when no price was named. Infer a reasonable price for modern day USA.',
    'A gift the reader bought before this scene was already paid for and is not an expense of this scene.',
    'Report 0 when the scene cost him nothing.',
    '',
    // Always present, so it sits above the block the cast swaps.
    'EXPULSION',
    'Say whether the reader was CAUGHT doing something in this scene that a university would expel him for.',
    'Expellable offenses include: any crime (theft, assault, sexual offenses, dealing drugs, arson, breaking into somewhere, carrying a weapon), cheating on an exam or plagiarizing work, forging university documents or grades, hazing, and serious harassment or stalking.',
    'Set expelled to true ONLY if he was caught. Caught means somebody who would report him found out during this scene — campus staff or security, the police, a professor, or a victim or witness who saw plainly what he did.',
    'If he did something expellable and got away with it — nobody saw, nobody found out, he covered it up, or the only people who know would never turn him in — then he was NOT caught, and expelled is false.',
    'False is the right answer for almost every scene.',
    '',
    // Above the other conditional sections: it is on every scene with a cast.
    ...(wantPlans ? [...PLANS_INSTRUCTIONS, ''] : []),
    // The cast picks the block, matching the schema's field set; `STATS` sits below
    // MEMORIES/EVENTS as the half a class or a shift drops.
    ...(cast.length > 0
      ? [
          'MEMORIES',
          'Write a single memory of what the character should still remember weeks from now.',
          'Each desc completes the sentence "<Name> <type> that ...", in the past tense, e.g. "the reader helped her carry books".',
          'Call the reader "the reader" every time, never "you", "he" or "him": "the reader lent her the reader\'s notes", not "he lent her his notes".',
          'If a scene was uneventful for someone, give her nothing.',
          '',
          'EVENTS',
          'List any of these milestones that actually happened IN THIS SCENE:',
          ...EVENT_GLOSS.map(([key, gloss]) => `- ${key}: ${gloss}`),
          'A milestone that did not happen this scene is simply left out. If one happened again — they agreed to be a couple again after a breakup — report it again.',
          'An empty "events" list is the ordinary answer and it is always allowed. Meeting for the first time, getting along, opening up or helping each other out is not a milestone.',
          '',
          'ACTS',
          'Report every kiss and every time the reader slept with somebody in this scene.',
          ...ACT_KINDS.map(([kind, gloss]) => `- kind "${kind}": ${gloss}`),
          'One row per act, and "chars" is every girl who was in that act with him:',
          '- With one girl on her own: one row naming her.',
          '- With two or more girls at the same time — a threesome, a shared kiss, a girl joining in while he is with another: ONE row naming all of them. Never split it into a row per girl.',
          '- With two girls separately — different moments, or different places: one row for each, naming one girl.',
          'Repeats do not add rows: however many times the same girls kissed, that is one "kiss" row, and sleeping together is its own "sex" row beside it.',
          '"inPublic" is true if anybody not taking part could have seen it — a passerby, somebody else in the room, a crowd — and false only when they were alone and out of sight. If the same girls were seen once and unseen once, say true.',
          'An empty "acts" list is the ordinary answer.',
          'Examples, for a cast of "mina_okafor — Mina Okafor" and "hazel_kim — Hazel Kim":',
          'SCENE he kisses Mina in the library, and later that hour kisses her again in the stacks',
          '{"acts":[{"kind":"kiss","inPublic":true,"chars":["mina_okafor"]}]}',
          'SCENE Mina and Hazel both go to bed with him in his room, the three of them together',
          '{"acts":[{"kind":"sex","inPublic":false,"chars":["mina_okafor","hazel_kim"]}]}',
          'SCENE he kisses Hazel goodbye at the door, then sleeps with Mina after Hazel has left',
          '{"acts":[{"kind":"kiss","inPublic":true,"chars":["hazel_kim"]},{"kind":"sex","inPublic":false,"chars":["mina_okafor"]}]}',
          'SCENE they study together and nothing happens',
          '{"acts":[]}',
          '',
          ...(castStats ? statsSection(true) : [])
        ]
      : statsSection(false)),
    // The rarer branch sits lower, so the common case shares the longest prefix.
    ...(classScene
      ? [
          'CLASS SUMMARY',
          'The reader spent this scene in a class. In classSummary, write one or two sentences recording what the class actually covered and what happened in the room. Keep it concrete and specific.',
          ...(classScene.factoid
            ? [
                'In classFactoid, write the single most exam-worthy thing the reader learned in this class today.',
                'One short sentence stating the fact itself, like: "The Krebs cycle produces two ATP per glucose molecule."',
                'It must be something this class has not already covered in a previous week.'
              ]
            : []),
          ''
        ]
      : [])
  ].join('\n')

  // Below the rules the model is given on every ledger call: the console log starts here.
  const rest = [
    'READER',
    reader,
    '',
    ...ledgerCastBlock(cast, state),
    '',
    ...scheduleBlocks(schedule, wantPlans),
    '',
    // Last: the block that varies most.
    'SCENE SO FAR',
    '\'\'\'',
    ...stubs,
    '\'\'\'',
    ''
  ].join('\n')

  return {
    system: ledgerPersonaFor(state.lessNsfwText),
    user: `${preamble}\n${rest}`,
    schema: ledgerSchema(charKeys, rosterKeys, classScene, castStats),
    // Constant, not the playthrough: nothing above the seam varies by save.
    cacheKey: 'ledger',
    logFrom: preamble.length + 1,
    // The bookkeeping is judged better at high, whatever the setting says.
    minThinking: 'high'
  }
}

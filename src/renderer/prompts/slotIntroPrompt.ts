import type { ExamPeriod } from '@shared/academics'
import { yearLabel } from '@shared/classes'
import { worstInSlot } from '@shared/colds'
import { globalSlotOf } from '@shared/jobs'
import {
  genderOf,
  PRONOUNS,
  pronounTag,
  readerWords,
  type Pronouns,
  type ReaderPronouns,
  type ReaderWords
} from '@shared/gender'
import { locationDefOf, locationLabel } from '@shared/locations'
import { readerCrushFactorOf, type NpcRelationshipMap } from '@shared/npcRelationships'
import {
  affectionFor,
  attractionInPlay,
  dedupedMemoriesFor,
  emptyFlags,
  isRomanceable,
  isTrusted
} from '@shared/relationship'
import { DEFAULT_PLAYER_STATS, type PlayerStats } from '@shared/playerStats'
import { readerYearOf, seasonOf, semesterOrdinal } from '@shared/semesters'
import {
  fullNameOf,
  type CalendarEvent,
  type Character,
  type CharInfo,
  type EverydayAsk,
  type Gender,
  type Haunt,
  type Occasion,
  type LoveText,
  type RomanceSetting,
  type Season,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import type { Weather } from '@shared/weather'
import { herColdLine } from './colds'
import { formatRelativeSlot } from './gameDate'
import { loreText, transferLines, type LoreEntry } from './lorebook'
import { examLookaheadLine } from './occasions'
import { loveLines, whereaboutsLine, type NpcCompanions } from './npcRelationship'
import { relationshipLines } from './relationship'
import { objectSchema } from './schema'
import {
  graduateLines,
  memoryLines,
  secretLines,
  notesLines,
  personaFor,
  profileLines,
  spaced
} from './scenePrompt'
import { readerAmongCast } from './setting'
import { springBreakLines } from './springBreak'
import { weatherLines } from './weather'

/** The slot-opening narration prompt. */

/** What a character has to be at in a slot — her class or her shift — named as a prompt says it. */
export type Commitment = { kind: 'class'; name: string } | { kind: 'shift'; employer: string }

/** What a girl asking him out of nowhere asks him to, when the app rolled her anything. */
export type HangoutInvite =
  | { kind: 'herRoom' }
  | { kind: 'hisRoom' }
  /** An exam in a lecture class the two of them take, and the slot it is sat in. */
  | { kind: 'study'; className: string; exam: ExamPeriod; date: number; time: TimeSlot }
  /** A location id off the map. */
  | { kind: 'outing'; location: string }
  | { kind: 'everyday'; ask: EverydayAsk }

/** Each everyday ask as the prompt names it beside the asker's key, in the asker's pronouns. */
const EVERYDAY_ASK_PHRASE: Record<EverydayAsk, (p: Pronouns, r: ReaderWords) => string> = {
  help: (p, r) => `asking ${r.him} to help ${p.them} with something`,
  exercise: (p, r) => `asking ${r.him} to work out or exercise with ${p.them}`,
  meal: (p, r) => `inviting ${r.him} over for a meal ${p.they} is cooking ${p.themself}`,
  shopping: (p, r) => `asking ${r.him} to help ${p.them} shop for something`
}

/**
 * What a rolled invitation asks him to, as the line beside the asker's key says it on `date`'s
 * `time`, in the asker's pronouns.
 */
function invitePhrase(
  invite: HangoutInvite,
  g: Gender,
  date: number,
  time: TimeSlot,
  reader: ReaderPronouns
): string {
  const p = PRONOUNS[g]
  const r = readerWords(reader, g)
  switch (invite.kind) {
    case 'herRoom':
      return `asking ${r.him} to come over to ${p.their} room`
    case 'hisRoom':
      return `asking ${r.him} to have ${p.them} over in ${r.his} dorm room`
    case 'study':
      return `asking ${r.him} to study with ${p.them} for the ${invite.className} ${invite.exam} ${formatRelativeSlot(invite.date, invite.time, date, time)}`
    case 'outing': {
      // The blurb, since nothing else in this prompt says what the place is.
      const blurb = locationDefOf(invite.location)?.blurb
      return `asking ${r.him} to come to ${locationLabel(invite.location)} with ${p.them}${blurb ? `: ${blurb}` : ''}`
    }
    case 'everyday':
      return EVERYDAY_ASK_PHRASE[invite.ask](p, r)
  }
}

/** A contact this slot rolled in to text the reader an invitation. */
export interface IntroAsker {
  character: Character
  info: CharInfo
  /** How the reply names her back — resolved through `charKeyToId`. */
  charKey: string
  /** Whether a Bunnyboard thread with her already holds anything (`hasTexted`). */
  texted: boolean
  /**
   * The plan she is texting about, when a plan is why she is texting at all.
   * Absent for a contact the slot's roll picked out of nowhere.
   */
  plan?: CalendarEvent
  /**
   * The class or the shift she has in the slot, beside a {@link plan} she is meeting him before
   * or after. Absent when she is free.
   */
  commitment?: Commitment
  /**
   * The occasion she is asking him to, on a slot one is on and he is free to go. Absent
   * for a girl asking about anything else.
   */
  occasion?: Occasion
  /**
   * What the app rolled her invitation into, for a girl asking about neither a plan nor an
   * occasion. Absent when the roll landed nothing and she asks what she likes.
   */
  invite?: HangoutInvite
  /**
   * Where she is texting from, who is with her, and what she is there for when the place is
   * her own haunt. Absent for a slot nothing places her in, which is most of them.
   */
  whereabouts?: { location: string; companions: NpcCompanions; haunt?: Haunt }
}

/** A lover the reader left this slot for somebody else, who is texting him to end it. */
export interface IntroBreakup {
  character: Character
  info: CharInfo
  /** How the reply names her back — resolved through `charKeyToId`. */
  charKey: string
  /** Whether a Bunnyboard thread with her already holds anything (`hasTexted`). */
  texted: boolean
  /** The first name of the girl he started dating instead. */
  forFirstName: string
  /** He chose another lover over her rather than starting with somebody new. */
  closed?: boolean
}

/** A contact leaving campus for spring break, texting the reader that she is going. */
export interface IntroLeaver {
  character: Character
  info: CharInfo
  /** How the reply names her back — resolved through `charKeyToId`. */
  charKey: string
  /** Whether a Bunnyboard thread with her already holds anything (`hasTexted`). */
  texted: boolean
}

/** A graduate back in town for Homecoming, texting the reader that she is here. */
export interface IntroVisitor {
  character: Character
  info: CharInfo
  /** How the reply names her back — resolved through `charKeyToId`. */
  charKey: string
  /** Whether a Bunnyboard thread with her already holds anything (`hasTexted`). */
  texted: boolean
}

/**
 * What a girl reaching out just to talk texts the reader about: the first four rolled by the app,
 * and `sick` for a girl in the worst of a cold, whatever the roll.
 */
export const REACH_OUT_TOPICS = ['wellbeing', 'goodNews', 'badNews', 'question', 'sick'] as const

/** One of {@link REACH_OUT_TOPICS}. */
export type ReachOutTopic = (typeof REACH_OUT_TOPICS)[number]

/** The topics a reach-out is rolled from. */
export const ROLLED_REACH_OUT_TOPICS: readonly ReachOutTopic[] = [
  'wellbeing',
  'goodNews',
  'badNews',
  'question'
]

/** Each reach-out topic as the prompt names it beside the texter's key, in the texter's pronouns. */
const REACH_OUT_TOPIC_PHRASE: Record<ReachOutTopic, (p: Pronouns, r: ReaderWords) => string> = {
  wellbeing: (_p, r) => `checking in on how ${r.he} is doing`,
  goodNews: (p, r) => `telling ${r.him} some good news of ${p.theirs}`,
  badNews: (p, r) => `telling ${r.him} some bad news of ${p.theirs}`,
  question: (_p, r) => `asking ${r.him} a question`,
  sick: (p, r) => `telling ${r.him} ${p.they} is stuck in bed with a cold`
}

/**
 * A reach-out about her love life: venting about her partner, asking whether to ask out her
 * crush, or saying how his advice on either went. `about` is the other one's full name.
 */
export interface LoveTopic {
  kind: LoveText['kind']
  about: string
  /**
   * Why a turn-down was one, for `turnedDown` alone: whom the other one is dating, or null where
   * the feelings were not mutual.
   */
  seeing?: string | null
}

/** Each love-life topic as the prompt names it beside the texter's key, in the texter's pronouns. */
const LOVE_TOPIC_PHRASE: Record<
  LoveText['kind'],
  (p: Pronouns, r: ReaderWords, about: string, seeing?: string | null) => string
> = {
  vent: (p, r, about) => `venting to ${r.him} after an argument with ${about}, whom ${p.they} is dating`,
  crush: (p, r, about) =>
    `asking ${r.him} whether ${p.they} should ask out ${about}, whom ${p.they} has a crush on`,
  together: (p, r, about) =>
    `telling ${r.him} ${p.they} took ${r.his} advice and asked out ${about}, who said yes, so the two of them are dating now`,
  turnedDown: (p, r, about, seeing) =>
    `telling ${r.him} ${p.they} took ${r.his} advice and asked out ${about}, who ${seeing ? `is already dating ${seeing}` : 'does not feel the same way'} and so turned ${p.them} down`,
  brokeUp: (p, r, about) => `telling ${r.him} ${p.they} took ${r.his} advice and broke up with ${about}`
}

/** A contact this slot rolled in to text the reader just to talk, about one rolled topic. */
export interface IntroReachOut {
  character: Character
  info: CharInfo
  /** How the reply names her back — resolved through `charKeyToId`. */
  charKey: string
  /** Whether a Bunnyboard thread with her already holds anything (`hasTexted`). */
  texted: boolean
  /** What she is texting him about. */
  topic: ReachOutTopic | LoveTopic
  /** Her TEXTING HISTORY lines: what the two of them last texted about, and when. */
  thread: readonly string[]
  /** Where she is, who with, and what she is there for, when the slot places her anywhere. */
  whereabouts?: { location: string; companions: NpcCompanions; haunt?: Haunt }
}

/**
 * A character posting a status update this slot. A girl doing both is in this list and
 * the askers'; `LOREBOOK` describes her once.
 */
export interface IntroPoster {
  character: Character
  info: CharInfo
  /** How the reply names her back — resolved through `charKeyToId`. */
  charKey: string
  /** Whether a Bunnyboard thread with her already holds anything (`hasTexted`). */
  texted: boolean
  /** Where she is, who with, and what she is there for, when the slot places her anywhere. */
  whereabouts?: { location: string; companions: NpcCompanions; haunt?: Haunt }
}

/** Everything the builder reads; assembled by the loop, which owns the store. */
export interface SlotIntroInput {
  /** The cloud-LLM cache key — the playthrough, exactly as the scene calls use it. */
  playthroughId: string
  /** Today, for weighting the askers' memories. */
  date: number
  /** The reader's accumulated stats, used for relationship requirement guidance. */
  stats?: PlayerStats
  /** Which half of the day is opening: a day slot is the one he wakes into. */
  time: TimeSlot
  /** The player's `lessNsfwText` setting; picks which persona heads this call's prefix. */
  lessNsfwText: boolean
  /** How many of her told secrets each girl's entry carries; absent is the default. */
  secretBudget?: number
  /** The app-written first line the narration continues from. */
  opening: string
  /**
   * The last three slots' summaries, newest last, each stamped with the slot it
   * covers. May be empty in a fresh game.
   */
  recent: readonly string[]
  /**
   * Contacts texting an invitation this slot; empty whenever the player is
   * booked — a class or a shift.
   */
  askers: readonly IntroAsker[]
  /** The lovers the finished slot left for somebody else, each ending it over text now. */
  breakups: readonly IntroBreakup[]
  /** The girls the spring break pick just sent away, each texting him she is going. */
  leavers: readonly IntroLeaver[]
  /** The graduate Homecoming morning brings back, texting him she is in town. */
  visitors: readonly IntroVisitor[]
  /** The one contact, if any, texting him just to talk this slot. */
  reachOuts: readonly IntroReachOut[]
  /**
   * Characters posting a status update this slot — the 10% roll's passers, anyone also
   * under {@link askers} included.
   */
  posters: readonly IntroPoster[]
  /**
   * What is going on in the world in **this slot alone**, fixed calendar already merged
   * in by the loop.
   */
  occasions: readonly Occasion[]
  /** The semester's season, which the exam lookahead names its dates by. */
  season: Season
  /**
   * Which semester a later one's first morning opens, for the line saying he is back on campus;
   * absent on every other slot.
   */
  backOnCampus?: number
  /** How many transfer students arrive in this slot; absent or 0 on every other slot. */
  newTransfers?: number
  /** The lorebook lines for what this slot leads up to, built by the loop beside `occasions`. */
  occasionLeadUps?: readonly string[]
  /**
   * The whole semester's sky, one reading per slot — the `WEATHER` block walks back through it
   * for how long the weather has held. Absent means the block is not written at all.
   */
  weather?: readonly Weather[]
  /**
   * Pre-formatted lorebook paragraphs for girls none of the blocks name — the closest
   * friends `ambientLoreCharacters` picks out.
   */
  backgroundLore?: readonly string[]
  /** Who leaves campus for spring break, or null before the pick has run. */
  springBreakAway?: readonly string[] | null
  /** The graduate back in town for Homecoming, as a charId; absent on every other slot. */
  homecomingVisitor?: string
  /**
   * The place `SOMEWHERE TO GO` invents a rumor about. **Drawn by the loop rather than
   * here**, which is what lets the reply's own sentence about it be banked and carried into the
   * scene the reader spends the slot in; absent means the block is not written at all.
   */
  rumorPlace?: LoreEntry
  /** Which genders the playthrough lets the reader romance. */
  romance: RomanceSetting
  /** The pronouns the reader goes by. */
  readerPronouns: ReaderPronouns
  /** Who on the roster is dating whom, and who has a crush on whom. */
  npcRelationships: NpcRelationshipMap
  /** Everyone on the roster and every graduate, whom her partners and crushes are named among. */
  people: readonly Character[]
}

/** The narration-only schema: no speaker, emotion, action or bg to emit. */
const SCHEMA = objectSchema('slot_intro', ['lines'], {
  lines: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } }
    }
  },
  hangouts: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['char', 'text', 'description'],
      properties: {
        char: { type: 'string' },
        text: { type: 'string' },
        description: { type: 'string' }
      }
    }
  },
  breakups: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['char', 'texts'],
      properties: {
        char: { type: 'string' },
        texts: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  posts: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['char', 'text'],
      properties: {
        char: { type: 'string' },
        text: { type: 'string' }
      }
    }
  },
  springBreakTexts: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['char', 'texts'],
      properties: {
        char: { type: 'string' },
        texts: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  reachOuts: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['char', 'texts'],
      properties: {
        char: { type: 'string' },
        texts: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  homecomingTexts: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['char', 'texts'],
      properties: {
        char: { type: 'string' },
        texts: { type: 'array', items: { type: 'string' } }
      }
    }
  }
})

/** What the sky is doing as the slot opens, on a slot there is anything to say about. */
function weatherBlock(input: SlotIntroInput): string[] {
  const lines = input.weather ? weatherLines(input.weather, input.date, input.time) : []
  return lines.length > 0 ? ['WEATHER', ...lines] : []
}

/**
 * What the day is, beyond being a date: whatever the campus and the city have going
 * on in this slot.
 */
function campusBlock(input: SlotIntroInput): string[] {
  const leadUps = input.occasionLeadUps ?? []
  const lookahead = examLookaheadLine(input.date, input.season)
  const back = input.backOnCampus !== undefined ? backOnCampusLine(input.backOnCampus, input.readerPronouns) : null
  const transfers = newTransfersLine(input.newTransfers ?? 0)
  if (
    input.occasions.length === 0 &&
    leadUps.length === 0 &&
    !lookahead &&
    !back &&
    !transfers
  ) {
    return []
  }
  return [
    'WHAT\'S GOING ON',
    ...(back ? [`- ${back}`] : []),
    ...(transfers ? [`- ${transfers}`] : []),
    ...input.occasions.map((occasion) => `- ${occasion.title} — ${occasion.description}`),
    ...leadUps.map((line) => `- ${line}`),
    ...(lookahead ? [`- ${lookahead}`] : [])
  ]
}

/** The first morning of a semester after his first: what he is back from, and as what. */
function backOnCampusLine(semesterIndex: number, reader: ReaderPronouns): string {
  const year = yearLabel(readerYearOf(semesterIndex)).toLowerCase()
  const away = seasonOf(semesterIndex) === 'fall' ? 'summer vacation' : 'winter break'
  return `The reader is back on campus after ${away}, starting ${readerWords(reader).his} ${semesterOrdinal(semesterIndex)} semester as a ${year}. Classes start tomorrow.`
}

/** Counts of transfer students as a sentence opens with them, from two up. */
const TRANSFER_COUNT_WORDS = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

/** That `count` unnamed transfer students start today, or null when none do. */
function newTransfersLine(count: number): string | null {
  if (count < 1) return null
  if (count === 1) return 'A new transfer student starts at Venus University today.'
  const many = TRANSFER_COUNT_WORDS[count - 2] ?? `${count}`
  return `${many} new transfer students start at Venus University today.`
}

/** A place worth going, for a slot with nothing and nobody in it. */
function rumorBlock(input: SlotIntroInput): string[] {
  if (!input.rumorPlace) return []
  return [
    'SOMEWHERE TO GO',
    loreText(input.rumorPlace),
    '',
  ]
}

/**
 * Whether anybody asking this slot is asking about something already agreed — the
 * one test the asker block and `YOUR TURN` both make.
 */
function anyPlans(input: SlotIntroInput): boolean {
  return input.askers.some(({ plan }) => plan !== undefined)
}

/** Whether anybody reminding him of a plan has a class or a shift in the slot. */
function anyCommitments(input: SlotIntroInput): boolean {
  return input.askers.some(({ plan, commitment }) => plan !== undefined && commitment !== undefined)
}

/** `text` ending on a full stop, so a sentence can follow it. */
function closedSentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]["')]?$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * The sentence beside a plan for a character with a class or a shift in the slot, leaving the
 * model to pick whether they meet him before it or after.
 */
function commitmentSentence(
  who: Pick<Character, 'firstName' | 'gender'>,
  commitment: Commitment,
  time: TimeSlot
): string {
  const p = PRONOUNS[genderOf(who)]
  const what =
    commitment.kind === 'class'
      ? `${p.their} ${commitment.name} class`
      : `a shift at ${commitment.employer}`
  const when = time === 1 ? 'tonight' : 'today'
  return ` ${who.firstName} has ${what} ${when} but ${p.they} will meet up with the reader either before or after it. Choose what makes the most sense.`
}

/** The characters texting the reader an invitation this slot. */
function askerBlock(input: SlotIntroInput): string[] {
  if (input.askers.length === 0) return []

  return [
    'ASKING TO HANG OUT',
    `Each of these characters is texting the reader right now to ask ${readerAmongCast(input.readerPronouns).him} to spend this part of the day with them, doing what is listed beside them where anything is. Write one entry in "hangouts" for each, and nothing for anyone else. They are described under LOREBOOK.`,
    ...(anyPlans(input)
      ? [
          'Where a plan is listed beside a character, they are not inviting the reader out of nowhere: the two of them agreed to this already, and they are writing about that plan, for everyone going. Their message reads as a reminder or a "still on?", not as a new idea.'
        ]
      : []),
    ...input.askers.map(({ character, charKey, plan, commitment, occasion, invite }) => {
      const g = genderOf(character)
      // The plan, the occasion and the rolled ask ride the key, not the lorebook entry.
      return plan
        ? `- ${charKey} — already planned for this part of the day: ` +
            (commitment
              ? closedSentence(plan.description) +
                commitmentSentence(character, commitment, input.time)
              : plan.description)
        : occasion
          ? `- ${charKey} — asking ${readerWords(input.readerPronouns, g).him} to come to ${occasion.title} with ${PRONOUNS[g].them}`
          : invite
            ? `- ${charKey} — ${invitePhrase(invite, g, input.date, input.time, input.readerPronouns)}`
            : `- ${charKey}`
    })
  ]
}

/** The lovers he left, each ending it by text as the slot opens. */
function breakupBlock(input: SlotIntroInput): string[] {
  if (input.breakups.length === 0) return []

  // A lover who chose another over her reads as a choice, not a newcomer.
  const chose = input.breakups.some(({ closed }) => closed)
  return [
    'BREAKING UP',
    `Each of these characters has just found out the reader ${chose ? 'chose somebody else over them' : 'started dating somebody else'} and is ending things with ${readerAmongCast(input.readerPronouns).him} over text right now. Write one entry in "breakups" for each, and nothing for anyone else. They are described under LOREBOOK.`,
    ...input.breakups.map(
      ({ character, charKey, forFirstName, closed }) =>
        `- ${charKey} — ${readerWords(input.readerPronouns, genderOf(character)).he} ${closed ? 'chose to see only' : 'started dating'} ${forFirstName}`
    )
  ]
}

/** The characters posting a status update this slot. */
function posterBlock(input: SlotIntroInput): string[] {
  if (input.posters.length === 0) return []

  return [
    'STATUS UPDATES',
    'Each of these characters is posting a status update on social media right now. Write one entry in "posts" for each, and nothing for anyone else. They are described under LOREBOOK.',
    ...input.posters.map(({ charKey }) => `- ${charKey}`)
  ]
}

/** The girls leaving campus for spring break, each telling him so by text as the slot opens. */
function leaverBlock(input: SlotIntroInput): string[] {
  if (input.leavers.length === 0) return []

  return [
    'LEAVING FOR SPRING BREAK',
    `Each of these characters is texting the reader right now to let ${readerAmongCast(input.readerPronouns).him} know they are leaving campus on Saturday for spring break and will be gone for the week. Write one entry in "springBreakTexts" for each, and nothing for anyone else. They are described under LOREBOOK.`,
    ...input.leavers.map(({ charKey }) => `- ${charKey}`)
  ]
}

/** The graduate back in town for Homecoming, telling him so by text as the slot opens. */
function visitorBlock(input: SlotIntroInput): string[] {
  if (input.visitors.length === 0) return []

  return [
    'BACK FOR HOMECOMING',
    `Each of these characters graduated and moved away from Veridan, and is texting the reader right now to let ${readerAmongCast(input.readerPronouns).him} know they are back in town for the Homecoming game today and leave again tomorrow morning. Write one entry in "homecomingTexts" for each, and nothing for anyone else. They are described under LOREBOOK.`,
    ...input.visitors.map(({ charKey }) => `- ${charKey}`)
  ]
}

/** The contact texting the reader just to talk this slot, beside what she is texting about. */
function reachOutBlock(input: SlotIntroInput): string[] {
  if (input.reachOuts.length === 0) return []

  return [
    'REACHING OUT',
    'Each of these characters is texting the reader right now just to talk, about what is listed beside them. Write one entry in "reachOuts" for each, and nothing for anyone else. They are described under LOREBOOK.',
    ...input.reachOuts.map(({ character, charKey, topic }) => {
      const g = genderOf(character)
      const r = readerWords(input.readerPronouns, g)
      const phrase =
        typeof topic === 'string'
          ? REACH_OUT_TOPIC_PHRASE[topic](PRONOUNS[g], r)
          : LOVE_TOPIC_PHRASE[topic.kind](PRONOUNS[g], r, topic.about, topic.seeing)
      return `- ${charKey} — ${phrase}`
    })
  ]
}

/** Whether anybody reaching out this slot is texting about her love life. */
function anyLoveTopics(input: SlotIntroInput): boolean {
  return input.reachOuts.some(({ topic }) => typeof topic !== 'string')
}

/** Everybody the six blocks above name, described once each. */
function characterBlock(input: SlotIntroInput): string[] {
  const entries: string[][] = []
  const named = new Set<string>()

  // A girl reaching out comes ahead of the posters, so her entry is the one carrying her thread.
  const listed: ReadonlyArray<
    IntroAsker | IntroBreakup | IntroLeaver | IntroVisitor | IntroReachOut | IntroPoster
  > = [
    ...input.askers,
    ...input.breakups,
    ...input.leavers,
    ...input.visitors,
    ...input.reachOuts,
    ...input.posters
  ]
  for (const entry of listed) {
    const { charKey, character, info, texted } = entry
    // A girl the slot placed somewhere; the girl ending it is texting from nowhere in particular.
    const whereabouts = 'whereabouts' in entry ? entry.whereabouts : undefined
    if (named.has(charKey)) continue
    named.add(charKey)
    // How her cold stands in the slot opening, where she has one that shows.
    const slot = globalSlotOf(input.date, input.time)
    const coldLine = herColdLine(character, info.cold, slot, true)
    entries.push([
      `${fullNameOf(character)} (${pronounTag(genderOf(character))}) — "char": "${charKey}"`,
      ...profileLines(
        character,
        info.flags ?? emptyFlags(),
        attractionInPlay(character, info, input.romance, input.readerPronouns)
      ),
      ...(coldLine ? [coldLine] : []),
      // A graduate posting or ending it from out of town, or back for Homecoming.
      ...graduateLines(character, info, input.homecomingVisitor === character.charId),
      ...transferLines(character, info, input.season),
      ...(whereabouts
        ? [
            whereaboutsLine(
              character,
              whereabouts.location,
              whereabouts.companions,
              whereabouts.haunt,
              input.time
            )
          ]
        : []),
      // What she is doing with the break: a girl off campus has no location to report.
      ...springBreakLines(
        character,
        info.springBreakPlans,
        input.springBreakAway,
        character.charId,
        input.date,
        input.readerPronouns
      ),
      ...relationshipLines(
        character,
        info.flags ?? emptyFlags(),
        info.nameKnown,
        affectionFor(info, input.date, character),
        info,
        {
          stats: input.stats ?? DEFAULT_PLAYER_STATS,
          // Everybody here reaches the reader by phone: a first contact is a conversation, not a meeting.
          medium: { texting: true, texted },
          // Where she is in her cycle, for a Promiscuous girl's DTF days, which a cold calls off.
          mood: {
            date: input.date,
            offset: info.moodCycleOffset ?? 0,
            sick: worstInSlot(info.cold, slot)
          },
          romanceable: isRomanceable(character, info, input.romance, input.readerPronouns),
          loyal:
            readerCrushFactorOf(input.npcRelationships, character.charId, character, input.date) ===
            0,
          readerPronouns: input.readerPronouns
        }
      ),
      // Who she is dating, and who she likes once she trusts him.
      ...loveLines(
        character,
        input.people,
        input.npcRelationships,
        isTrusted(affectionFor(info, input.date, character))
      ),
      ...memoryLines(
        character,
        dedupedMemoriesFor(info).slice(-2),
        info.textMemory,
        input.season,
        input.readerPronouns
      ),
      ...secretLines(character.firstName, info.toldSecrets, input.secretBudget),
      // What she and the reader last texted about, for the girl starting a conversation.
      ...('thread' in entry ? entry.thread : []),
      ...notesLines(character.firstName, info.notes)
    ])
  }

  // The background girls close the block as keyless paragraphs, and can raise it alone.
  for (const paragraph of input.backgroundLore ?? []) {
    entries.push([paragraph])
  }

  if (entries.length === 0) return []
  // Blank lines between entries only; `spaced()` closes the block.
  return [
    'LOREBOOK',
    '',
    ...entries.flatMap((entry, index) => (index === 0 ? entry : ['', ...entry]))
  ]
}

/** Builds the slot-opening narration request. */
export function buildSlotIntroPrompt(
  input: SlotIntroInput,
  setting: string,
  reader: string
): StructuredRequest {
  const waking = input.time === 0
  const rumor = rumorBlock(input)
  const planned = anyPlans(input)
  const committed = anyCommitments(input)
  const r = readerWords(input.readerPronouns)
  const rf = readerAmongCast(input.readerPronouns)

  const user = [
    'OPENING LINE',
    input.opening,
    '',
    ...spaced(input.recent.length > 0 ? ['RECENTLY', ...input.recent] : []),
    ...spaced(weatherBlock(input)),
    ...spaced(campusBlock(input)),
    ...spaced(characterBlock(input)),
    ...spaced(askerBlock(input)),
    ...spaced(breakupBlock(input)),
    ...spaced(posterBlock(input)),
    ...spaced(leaverBlock(input)),
    ...spaced(visitorBlock(input)),
    ...spaced(reachOutBlock(input)),
    ...spaced(rumor),
    'YOUR TURN',
    'Hey RITA, a new part of the reader\'s day is starting. Set the mood for them before they decide what to do with it.',
    'Continue where the OPENING LINE left off with three to five short lines of narration. Don\'t include the OPENING LINE in your response. Each line is one entry in "lines".',
    // The three beats, named: without them the call writes a to-do list.
    waking
      ? `Open on the reader waking up in ${r.his} Lowrise dorm room, describing how ${r.he} feels and the sounds and sights around ${r.him}.`
      : `Open on the day winding down around the reader in ${r.his} Lowrise dorm room, describing how ${r.he} feels and the sounds and sights around ${r.him}.`,
    "Then say how campus feels right now. Take into account how far we are in the semester and what's going on in the city and on campus.",
    input.recent.length > 0
      ? 'Also keep in mind what happened recently and how it is making the reader feel right now.'
      : '',
    ...(rumor.length > 0
      ? ['End by inventing something spicy about SOMEWHERE TO GO. A rumor, a limited-time thing, etc that encourages the reader to go there.']
      : []),
    'Second person, present tense, no dialogue and nobody else on screen. Do NOT restate the date or prompt the player with "What would you like to do?" as something else does that already.',
    ...(input.askers.length > 0
      ? [
          '',
          'Then fill "hangouts", one entry per character under ASKING TO HANG OUT. "char" is their key exactly as written there. "text" is the message they send, in their own texting voice — lowercase, slang, typos and emoji are all fine if that is how they type — and it is ONLY about meeting up: what they want to do and where, asked as a question' +
            (planned
              ? ' — or, where they have a plan listed, that plan, asked as a "we\'re still on, right?"'
              : '') +
            (committed
              ? `, and where they have class or work, they say whether they will meet ${rf.him} before or after it`
              : '') +
            '. No narration, no stage directions, no other conversation. "description" is the plan in a few plain words, like "Getting dinner with Sarah at the Mockingbird" or "Studying with Chloe in the library".' +
            (planned
              ? ' If they have a hangout scheduled with the reader listed under their name, use that one.'
              : ''),
          `The narration in "lines" must not mention these messages or these characters at all — the reader has not opened ${r.his} phone yet.`
        ]
      : [
          // An optional property with no instruction against it is an invitation to invent one.
          '',
          'Return nothing at all for "hangouts".'
        ]),
    ...(input.breakups.length > 0
      ? [
          '',
          `Then fill "breakups", one entry per character under BREAKING UP. "char" is their key exactly as written there. "texts" is two to four short messages they send one after another, in their own texting voice — lowercase, slang, typos and emoji are all fine if that is how they type — breaking up with the reader because ${rf.he} started dating the person named beside them: how they found out, how they feel about it, and that it is over. No narration, no stage directions, no reply from the reader.`,
          `The narration in "lines" must not mention these messages or these characters at all — the reader has not opened ${r.his} phone yet.`
        ]
      : [
          // Refused out loud for "hangouts"'s reason.
          '',
          'Return nothing at all for "breakups".'
        ]),
    ...(input.posters.length > 0
      ? [
          '',
          `Then fill "posts", one entry per character under STATUS UPDATES. "char" is their key exactly as written there. "text" is the post itself: one or two short lines in their own voice, the way they would actually type it — lowercase, slang and emoji are fine if that is how they write. It is a post to nobody in particular, about their hour: what they are doing, where they are, what kind of mood they are in, something small they noticed. They are NOT writing to the reader and must not address ${rf.him}, mention ${rf.him}, or refer to meeting anyone. No narration and no stage directions.`,
          `The narration in "lines" must not mention these posts — the reader has not opened ${r.his} phone yet.`
        ]
      : [
          // Refused out loud for "hangouts"'s reason.
          '',
          'Return nothing at all for "posts".'
        ]),
    ...(input.leavers.length > 0
      ? [
          '',
          `Then fill "springBreakTexts", one entry per character under LEAVING FOR SPRING BREAK. "char" is their key exactly as written there. "texts" is one to three short messages they send one after another, in their own texting voice — lowercase, slang, typos and emoji are all fine if that is how they type — letting the reader know they are leaving campus on Saturday and will be gone for spring break: what they are doing over the break, and how they feel about being away from ${rf.him}, in keeping with where the two of them stand. They are not inviting ${rf.him} along. No narration, no stage directions, no reply from the reader.`,
          `The narration in "lines" must not mention these messages or these characters at all — the reader has not opened ${r.his} phone yet.`
        ]
      : [
          // Refused out loud for "hangouts"'s reason.
          '',
          'Return nothing at all for "springBreakTexts".'
        ]),
    ...(input.visitors.length > 0
      ? [
          '',
          `Then fill "homecomingTexts", one entry per character under BACK FOR HOMECOMING. "char" is their key exactly as written there. "texts" is one to three short messages they send one after another, in their own texting voice — lowercase, slang, typos and emoji are all fine if that is how they type — letting the reader know they are back in town for the Homecoming game today and leave again tomorrow morning: what they have been up to since they left, and whether they would like to see ${rf.him} while they are here, in keeping with where the two of them stand. No narration, no stage directions, no reply from the reader.`,
          `The narration in "lines" must not mention these messages or these characters at all — the reader has not opened ${r.his} phone yet.`
        ]
      : [
          // Refused out loud for "hangouts"'s reason.
          '',
          'Return nothing at all for "homecomingTexts".'
        ]),
    ...(input.reachOuts.length > 0
      ? [
          '',
          `Then fill "reachOuts", one entry per character under REACHING OUT. "char" is their key exactly as written there. "texts" is one or two short messages they send one after another, in their own texting voice — lowercase, slang, typos and emoji are all fine if that is how they type — starting a conversation with the reader about what is listed beside their name. Good or bad news is something that just happened in their own life, in keeping with how LOREBOOK describes them and where they are. A question is something they actually want to know from ${rf.him}.${anyLoveTopics(input) ? ` Where it is about their love life, it is about the person named beside them: what happened between the two of them and how they feel about it, and someone venting or asking about a crush wants ${rf.his} take on it.` : ''} They can pick up on time the two of them recently spent together or on what they last texted about, and they end on something ${rf.he} can answer. They are not asking to meet up or making plans. No narration, no stage directions, no reply from the reader.`,
          `The narration in "lines" must not mention these messages or these characters at all — the reader has not opened ${r.his} phone yet.`
        ]
      : [
          // Refused out loud for "hangouts"'s reason.
          '',
          'Return nothing at all for "reachOuts".'
        ])
  ].join('\n')

  return {
    system: [
      personaFor(input.lessNsfwText, input.readerPronouns),
      '',
      'SETTING',
      setting,
      '',
      'READER',
      reader
    ].join('\n'),
    user,
    schema: SCHEMA,
    cacheKey: input.playthroughId,
    kind: 'slotIntro'
  }
}

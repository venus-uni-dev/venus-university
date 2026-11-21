import {
  affectionFor,
  attractionInPlay,
  dedupedMemoriesFor,
  emptyFlags,
  isRomanceable,
  isTrusted
} from '@shared/relationship'
import { ROOM_LOCATION } from '@shared/locations'
import { worstInSlot } from '@shared/colds'
import {
  genderOf,
  pronounsOf,
  readerWords,
  type ReaderPronouns
} from '@shared/gender'
import { globalSlotOf } from '@shared/jobs'
import { readerCrushFactorOf, type NpcRelationshipMap } from '@shared/npcRelationships'
import type { SemesterCalendar } from '@shared/semesters'
import {
  type Character,
  type CharInfo,
  type ClassEntry,
  type ChatMessage,
  type Conversation,
  type GameHistory,
  type Haunt,
  type JobState,
  type RomanceSetting,
  type Season,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import { DEFAULT_PLAYER_STATS, type PlayerStats } from '@shared/playerStats'
import type { Weather } from '@shared/weather'
import {
  formatChatDivider,
  formatDateBanner,
  formatRelativeSlot,
  formatSemesterProgress
} from './gameDate'
import {
  ambientLoreCharacters,
  characterLore,
  characterLoreForIds,
  classLore,
  type ClassRoster,
  keyPattern,
  type BookEntry,
  lorebookBlock,
  transferLines
} from './lorebook'
import { occasionLoreLines } from './occasions'
import { recapLore } from './recaps'
import { objectSchema } from './schema'
import {
  graduateLines,
  headingTag,
  herClassmates,
  memoryLines,
  secretLines,
  notesLines,
  profileLines,
  readerClassmates,
  scheduleLines,
  yearMajorLine
} from './scenePrompt'
import { isAwayForSpringBreak, springBreakLines } from './springBreak'
import {
  bestFriendLines,
  hauntClause,
  loveLines,
  whereaboutsLine,
  type NpcCompanions
} from './npcRelationship'
import { relationshipLines } from './relationship'
import { herColdLine } from './colds'
import { weatherLines } from './weather'

/**
 * Builds the Bunnyboard texting request: RITA answering the reader's text as one
 * character, over the campus messaging app.
 */

/** How many recent messages ride in the prompt and in each rolling summary. */
const TEXTING_HISTORY_CAP = 20

/** RITA writing one side of a text thread. */
const TEXTING_PERSONA = [
  'You are RITA, author of steamy reader-POV romance fiction set at fictional universities.',
  'You\'ve got sexy nerd energy and have been on a hundred dates, and you use that experience to make your writing shockingly realistic.',
  'Right now you are writing one side of a text conversation on Bunnyboard, the campus messaging app: you answer AS the character, in their own texting voice.',
  'Some people send one long message, some fire off several short ones — match how THEY would text, keeping their personality and memories in mind.',
  'Texts are casual: typos, slang, emoji and lowercase are all fair game if they fit the character. No narration, no stage directions, just what they type.',
  'You make the characters play hard to get; everything is a slow burn.',
  'Oh, by the way: you really, really HATE repetitive, robotic slop-writing.',
  'You NEVER use semicolons or emdashes or other dumb AI writing habits.',
  'And finally, you\'re totally anal retentive: You always return a single, fully-formed JSON object matching the provided schema exactly.'
].join('\n')

/** The prompt-facing slice of state a texting turn needs. */
export interface TextingPromptState {
  date: number
  time: TimeSlot
  /** The reader's accumulated stats, used for relationship requirement guidance. */
  stats?: PlayerStats
  /**
   * Every roster character except the one being texted — the lorebook's people,
   * excluded at the source so no entry can restate the `CHARACTER` block.
   */
  roster: readonly Character[]
  /** The playthrough's lorebook: the shipped entries as the player has them, then his own. */
  lorebook: readonly BookEntry[]
  /** Per-character save state, keyed by charId — read for the roster's entries. */
  charInfo: Record<string, CharInfo>
  /**
   * What the roster thinks of each other: read for the friend her `CHARACTER` block
   * names and for the standing every lorebook character entry closes with.
   */
  npcRelationships: NpcRelationshipMap
  /** The save's class roster, keyed by class code — names the schedules. */
  classes: Record<string, ClassEntry>
  /** The reader's own timetable, sparse slot → class code. */
  playerSchedule: Record<number, string>
  /** Who sits in each class of the catalog, by class code. */
  classRosters: Readonly<Record<string, ClassRoster>>
  /** The part-time job the reader holds, or null — the rest of his week. */
  playerJob: JobState | null
  /** The semester's season and the occasions the save invented; the fixed calendar is merged in on read. */
  calendar: SemesterCalendar
  /**
   * The whole semester's sky, one reading per slot — the NOW line walks back through it for how
   * long the weather has held. Absent means nothing is said about it.
   */
  weather?: readonly Weather[]
  /**
   * Where the girl being texted is standing right now: a location id, `'room'`, or null
   * for a slot her hidden schedule says nothing about.
   */
  charLocation?: string | null
  /**
   * Who is with her there — read only where {@link charLocation} is set,
   * and named only where the reader has heard the name.
   */
  charCompanions?: NpcCompanions
  /** Her standing haunt when {@link charLocation} is it — what she is doing there. */
  charHaunt?: Haunt | null
  /**
   * Who leaves campus for spring break, or null before the pick has run. A thread stays
   * open through an absence, so this is what says she is texting from somewhere else.
   */
  springBreakAway?: readonly string[] | null
  /** The graduate back in town for Homecoming, as a charId; absent on every other slot. */
  homecomingVisitor?: string
  /** How old she is, by charId; with none her heading carries only her pronouns. */
  ages?: Readonly<Record<string, number>>
  /**
   * Each character's plans with the reader from this slot on, one sentence apiece, by charId —
   * hers and the lorebook's people's.
   */
  upcomingPlans?: Record<string, string[]>
  /** How many of her memories the thread carries: the one-character budget, the thread being the two of them. */
  memoryBudget: number
  /** How many of her told secrets the thread carries; absent is the default. */
  secretBudget?: number
  /** The playthrough log, read for the lorebook's dated recaps. */
  history: GameHistory
  /** Which genders the playthrough lets the reader romance. */
  romance: RomanceSetting
  /** The pronouns the reader goes by. */
  readerPronouns: ReaderPronouns
}

/** A text's line breaks folded to spaces, so a message stays one prompt line. */
function flatText(text: string): string {
  return text.replace(/\s*\n+\s*/g, ' ')
}

/** `"YOU: hey"` / `"MINA: hey yourself"` / `"SYSTEM: ..."` — one history stub. */
function messageStub(message: ChatMessage, firstName: string): string {
  if (message.sender === 'player') return `YOU: ${flatText(message.text)}`
  if (message.sender === 'system') return `SYSTEM: ${flatText(message.text)}`
  return `${firstName.toUpperCase()}: ${flatText(message.text)}`
}

/**
 * A window of messages rendered for injection, newest last; system lines ride along as
 * context the character plausibly has.
 */
export function stampedStubs(
  window: readonly ChatMessage[],
  firstName: string,
  season: Season
): string[] {
  const lines: string[] = []
  let stamped: string | null = null
  for (const message of window) {
    const stamp = formatChatDivider(message.date, message.time, season)
    if (stamp !== stamped) {
      lines.push(`[${stamp}]`)
      stamped = stamp
    }
    lines.push(messageStub(message, firstName))
  }
  return lines
}

/**
 * Whether the reader and she have actually texted — a summary, or a player/contact message.
 * A thread holding only the app's own friend-request/block system lines doesn't count.
 */
export function hasTexted(conversation: Conversation | undefined): boolean {
  if (!conversation) return false
  if (conversation.summary !== null) return true
  return conversation.messages.some(
    (message) => message.sender === 'player' || message.sender === 'contact'
  )
}

/**
 * Her reach-outs the reader has sent nothing since, oldest first, each as its first text. A
 * system line is no answer.
 */
export function unansweredReachOuts(messages: readonly ChatMessage[]): ChatMessage[] {
  const unanswered: ChatMessage[] = []
  for (const message of messages) {
    if (message.sender === 'player') unanswered.length = 0
    else if (message.sender === 'contact' && message.reachOut) unanswered.push(message)
  }
  return unanswered
}

/**
 * Her hangout ask when it ends the thread, with his "Sure" when that answered it, or her
 * unanswered reach-out, every text of it from the first. A reminder about a plan already made
 * is not flagged as an invite but stands behind `pendingHangout` just the same.
 */
function hangoutTail(
  conversation: Conversation
): { ask: ChatMessage; answer?: ChatMessage } | null {
  const { messages } = conversation
  const last = messages[messages.length - 1]
  if (!last) return null
  if (last.sender === 'contact') {
    if (last.invite || conversation.pendingHangout) return { ask: last }
    const reachOut = unansweredReachOuts(messages).at(-1)
    if (!reachOut || reachOut.date !== last.date || reachOut.time !== last.time) return null
    // Her texts from the reach-out's first to the end of its slot, nothing of his among them.
    const from = messages.indexOf(reachOut)
    const text = messages
      .slice(from)
      .filter((message) => message.sender === 'contact')
      .map((message) => flatText(message.text))
      .join(' ')
    return { ask: { ...last, text } }
  }
  const before = messages[messages.length - 2]
  if (last.sender === 'player' && last.text === 'Sure' && before?.sender === 'contact') {
    return { ask: before, answer: last }
  }
  return null
}

/**
 * The scene prompts' TEXTING HISTORY lines for one character, or none at all; the block line
 * names the reader outright where the reader's pronoun would read as the character's.
 */
export function composeTextingSummary(
  conversation: Conversation | undefined,
  ignoredInvitation: boolean,
  who: Pick<Character, 'firstName' | 'gender'>,
  now: Pick<TextingPromptState, 'date' | 'time'>,
  blocked = false,
  reader: ReaderPronouns
): string[] {
  const { firstName } = who
  const g = genderOf(who)
  // Being blocked outlives the thread, so it is stated even with nothing else to say.
  const blockedLines = blocked
    ? [
        `${firstName} has the reader blocked on Bunnyboard, so ${readerWords(reader, g).he} cannot text ${pronounsOf(who).them}.`
      ]
    : []
  if (!conversation) {
    return blockedLines.length > 0
      ? [`${firstName}'s TEXTING HISTORY with the reader:`, ...blockedLines]
      : []
  }
  const lines: string[] = []
  if (conversation.summary) lines.push(conversation.summary)

  const last = conversation.messages[conversation.messages.length - 1]
  // An untexted thread holds only the friend-request system line; say when that add happened.
  if (!hasTexted(conversation) && conversation.messages.length > 0) {
    const first = conversation.messages[0]
    lines.push(
      `The reader and ${firstName} added each other on Bunnyboard ${formatRelativeSlot(first.date, first.time, now.date, now.time)}, but haven't texted yet.`
    )
  } else if (last) {
    const when = formatRelativeSlot(last.date, last.time, now.date, now.time)
    const tail = hangoutTail(conversation)
    // Her ask and his Sure never pass through a texting call, so no summary holds them:
    // the scene is shown the texts themselves.
    if (tail?.answer) {
      lines.push(
        `The last texts in the thread were sent ${when}. ${firstName}: "${flatText(tail.ask.text)}" The reader: "${flatText(tail.answer.text)}"`
      )
    } else if (tail) {
      lines.push(`The last text in the thread was sent ${when}: "${flatText(tail.ask.text)}"`)
    } else {
      // Without this the scene reads every thread as if it had just been sent.
      lines.push(`The last text in the thread was sent ${when}.`)
    }
  }
  if (last?.error) lines.push(`${firstName}'s last message failed to send to the player.`)
  // "Ignored", never "left on read": the app only knows he spent the slot elsewhere.
  if (ignoredInvitation) lines.push(`The reader ignored ${firstName}'s invitation.`)
  lines.push(...blockedLines)

  if (lines.length === 0) return []
  return [`${firstName}'s TEXTING HISTORY with the reader:`, ...lines]
}

/**
 * The `NOW` line saying where she is texting from, or nothing on a slot her hidden
 * schedule is silent about.
 */
function whereSheIs(
  who: Pick<Character, 'firstName' | 'gender'>,
  location: string | null | undefined,
  companions?: NpcCompanions,
  haunt?: Haunt | null,
  time: TimeSlot = 0
): string[] {
  if (!location) return []
  return [
    whereaboutsLine(who, location, companions ?? { knownNames: [], unknown: 0 }, haunt, time)
  ]
}

/**
 * What her calendar says about meeting up this instant, naming the reader outright where the
 * reader's pronoun would read as hers.
 */
function meetUpLines(
  who: Pick<Character, 'firstName' | 'gender'>,
  location: string | null | undefined,
  haunt: Haunt | null | undefined,
  time: TimeSlot,
  away: boolean,
  reader: ReaderPronouns
): string[] {
  const name = who.firstName
  const p = pronounsOf(who)
  // Dropped while she is off campus: the line claims she can meet, and her block says she can't.
  if (away) return []
  if (!location || location === ROOM_LOCATION) {
    return [
      `${name}'s schedule is clear, so if the reader asks to meet up right now assume ${name} is free to... though not necessarily willing.`
    ]
  }
  const g = genderOf(who)
  const him = readerWords(reader, g).him
  return [
    `${name}'s schedule is clear, so if the reader asks to meet up right now assume ${name} is free to — ${p.they} is already ${hauntClause(location, haunt, time, g)} and would sooner have ${him} come to ${p.them} than go somewhere else — though not necessarily willing.`
  ]
}

/** Builds the texting turn request. `newMessage` is the reader's fresh text. */
export function buildTextingPrompt(
  character: Character,
  info: CharInfo | undefined,
  conversation: Conversation | undefined,
  newMessage: string,
  state: TextingPromptState,
  reader: string
): StructuredRequest {
  const name = character.firstName
  const gender = genderOf(character)
  const p = pronounsOf(character)
  // The reader is named outright where the reader's pronoun would read as hers.
  const readerHim = readerWords(state.readerPronouns, gender).him
  // Off campus: away for the break, or graduated and gone from Veridan but for Homecoming.
  const visiting = state.homecomingVisitor === character.charId
  const away =
    (info?.pursuing !== undefined && !visiting) ||
    isAwayForSpringBreak(state.springBreakAway, character.charId, state.date)
  const thread: ChatMessage[] = [
    ...(conversation?.messages ?? []).slice(-TEXTING_HISTORY_CAP),
    {
      id: 'pending',
      sender: 'player',
      text: newMessage,
      date: state.date,
      time: state.time
    }
  ]
  // The new text is the last line of the log, so it gets its own stamp when it lands in a new slot.
  const history = stampedStubs(thread, name, state.calendar.season)
  const summary = conversation?.summary ?? null

  // The scan covers the whole thread the model reads, not just the new message.
  const scan = [summary ?? '', ...history].join('\n')
  // Today's occasions are always-on.
  const today = occasionLoreLines(state.date, state.time, state.calendar)

  // An entry's standings are measured against the one girl on the thread.
  const relations = { relationships: state.npcRelationships, present: [character] }
  // The ambient entries nothing in the thread named, minus any the scan already fires.
  const ambient = ambientLoreCharacters(state.roster, [character], state.npcRelationships).filter(
    (other) => !new RegExp(keyPattern(other.firstName, false), 'iu').test(scan)
  )
  // A thread sets no background, so no entry points at one.
  const paragraphs = [
    ...classLore(scan, {
      classes: state.classes,
      rosters: state.classRosters,
      playerSchedule: state.playerSchedule,
      skip: []
    }),
    ...characterLore(
      scan,
      state.roster,
      state.charInfo,
      state.date,
      state.calendar.season,
      relations,
      state.upcomingPlans,
      state.homecomingVisitor
    ),
    ...characterLoreForIds(
      ambient,
      state.charInfo,
      state.date,
      state.calendar.season,
      relations,
      state.upcomingPlans,
      state.homecomingVisitor
    ),
    // Only this slot's texts: an older one's "last night" was a different night.
    ...recapLore(
      thread
        .filter((message) => message.date === state.date && message.time === state.time)
        .map((message) => message.text)
        .join('\n'),
      state.date,
      state.time,
      state.history,
      state.calendar.season
    )
  ]
  const lore = lorebookBlock(scan, { book: state.lorebook, always: today, paragraphs })

  // How her cold stands this slot, where she has one that shows.
  const slot = globalSlotOf(state.date, state.time)
  const coldLine = herColdLine(character, info?.cold, slot, true)

  const characterBlock = [
    `CHARACTER (${headingTag(gender, state.ages?.[character.charId])})`,
    `${name} ${character.lastName}.`,
    ...(info?.major ? [yearMajorLine(info, gender)] : []),
    ...graduateLines(character, info, visiting),
    ...transferLines(character, info, state.calendar.season),
    // The phone takes the one-character budget.
    ...profileLines(
      character,
      info?.flags ?? emptyFlags(),
      attractionInPlay(character, info, state.romance, state.readerPronouns)
    ),
    ...(coldLine ? [coldLine] : []),
    ...relationshipLines(
      character,
      info?.flags ?? emptyFlags(),
      // Texting requires a completed contact, so her name is known by then.
      info?.nameKnown ?? true,
      affectionFor(info, state.date, character),
      info,
      {
        stats: state.stats ?? DEFAULT_PLAYER_STATS,
        // The stored thread only: the pending text is not yet something they have said.
        medium: { texting: true, texted: hasTexted(conversation) },
        // Where she is in her cycle, for a Promiscuous girl's DTF days, which a cold calls off.
        mood: {
          date: state.date,
          offset: info?.moodCycleOffset ?? 0,
          sick: worstInSlot(info?.cold, slot)
        },
        romanceable: isRomanceable(character, info, state.romance, state.readerPronouns),
        loyal:
          readerCrushFactorOf(state.npcRelationships, character.charId, character, state.date) ===
          0,
        readerPronouns: state.readerPronouns
      }
    ),
    // Her closest friend; the roster handed in is everybody but her.
    ...bestFriendLines(character, state.roster, state.npcRelationships),
    // Who she is dating, and who she likes once she trusts him.
    ...loveLines(
      character,
      state.roster,
      state.npcRelationships,
      isTrusted(affectionFor(info, state.date, character))
    ),
    ...scheduleLines(
      `${name}'s Schedule:`,
      info?.schedule ?? {},
      state.classes,
      info?.job,
      state.date,
      herClassmates(character.charId, state.classRosters, state.playerSchedule)
    ),
    // What she and the reader have planned, this slot's included.
    ...(state.upcomingPlans?.[character.charId] ?? []),
    // Where she is spending the break: on a thread, the only thing saying she has left campus.
    ...springBreakLines(
      character,
      info?.springBreakPlans,
      state.springBreakAway,
      character.charId,
      state.date,
      state.readerPronouns
    ),
    ...memoryLines(
      character,
      dedupedMemoriesFor(info).slice(-state.memoryBudget),
      info?.textMemory,
      state.calendar.season,
      state.readerPronouns
    ),
    ...secretLines(name, info?.toldSecrets, state.secretBudget),
    ...notesLines(name, info?.notes)
  ]

  const user = [
    'READER',
    reader,
    ...scheduleLines(
      "The reader's Schedule:",
      state.playerSchedule,
      state.classes,
      state.playerJob,
      state.date,
      readerClassmates(state.classRosters)
    ),
    '',
    ...characterBlock,
    '',
    'NOW',
    `It is ${formatDateBanner(state.date, state.time, state.calendar.season)}`,
    formatSemesterProgress(state.date),
    // Texting happens before the slot's scene; without this she treats the day as over.
    state.time === 0 ? 'Morning classes are starting soon.' : 'Night classes are starting soon.',
    ...(state.weather ? weatherLines(state.weather, state.date, state.time) : []),
    ...whereSheIs(character, state.charLocation, state.charCompanions, state.charHaunt, state.time),
    '',
    ...lore,
    ...(summary ? ['TEXTING SO FAR', '"' + summary + '"', ''] : []),
    'RECENT MESSAGES',
    "'''",
    ...history,
    "'''",
    '',
    'YOUR TURN',
    `${name} is texting the reader back in a private DM.`,
    `Write ${name}'s reply to the reader's newest message, the last line of RECENT MESSAGES, as the "messages" array: each entry is one text bubble ${p.they} sends.`,
    `Stay in ${p.their} voice and keep it text-length: this is a phone thread, not prose.`,
    ...meetUpLines(character, state.charLocation, state.charHaunt, state.time, away, state.readerPronouns),
    '',
    'BLOCKING',
    `Set "blocked" to true only if these texts have pushed ${name} to cut the reader off completely. ${p.They} is done, and blocks ${readerHim} on Bunnyboard as ${p.their} last text lands.`,
    `${p.Their} final messages should read like somebody who is about to do that.`,
    `Being annoyed, hurt, bored or angry is not enough on its own: people stay in threads they are angry in. Reserve it for wanting ${readerHim} gone.`,
    'Otherwise set it to false.',
    '',
    'SUMMARY',
    summary
      ? 'Then, for the "summary" field, fold the TEXTING SO FAR and the RECENT MESSAGES (plus your reply) into one merged recap.'
      : 'Then, for the "summary" field, condense the RECENT MESSAGES (plus your reply) into a single recap.',
    `Write it in third person, refer to the MC as "the reader", and keep anything ${name} should still remember later. Don't include concrete dates, and leave out old or unimportant information.`
  ].join('\n')

  return {
    system: TEXTING_PERSONA,
    user,
    schema: textingSchema(),
    // Constant, like the ledger's: nothing above the seam varies by save.
    cacheKey: 'texting',
    thinking: 'texts',
    kind: 'texting'
  }
}

/**
 * The `TextingResponse` schema: `messages` first so they stream ahead; the preview
 * reader stops at that array's `]`.
 */
function textingSchema(): {
  name: string
  schema: Record<string, unknown>
} {
  return objectSchema('texting', ['messages', 'summary', 'blocked'], {
    messages: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    // Required: an optional boolean drifts into never being considered.
    blocked: { type: 'boolean' }
  })
}

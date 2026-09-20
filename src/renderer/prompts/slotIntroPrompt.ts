import { affectionFor, dedupedMemoriesFor, emptyFlags } from '@shared/relationship'
import { DEFAULT_PLAYER_STATS, type PlayerStats } from '@shared/playerStats'
import {
  fullNameOf,
  type CalendarEvent,
  type Character,
  type CharInfo,
  type Haunt,
  type Occasion,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import type { Weather } from '@shared/weather'
import type { LoreEntry } from './lorebook'
import { examLookaheadLine } from './occasions'
import { whereaboutsLine, type NpcCompanions } from './npcRelationship'
import { relationshipLines } from './relationship'
import { objectSchema } from './schema'
import { memoryLines, personaFor, profileLines, spaced } from './scenePrompt'
import { springBreakLines } from './springBreak'
import { weatherLines } from './weather'

/** The slot-opening narration prompt. */

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
   * The occasion she is asking him to, on a slot one is on and he is free to go. Absent
   * for a girl asking about anything else.
   */
  occasion?: Occasion
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
  /**
   * The place `SOMEWHERE TO GO` invents a rumor about. **Drawn by the loop rather than
   * here**, which is what lets the reply's own sentence about it be banked and carried into the
   * scene the reader spends the slot in; absent means the block is not written at all.
   */
  rumorPlace?: LoreEntry
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
  const lookahead = examLookaheadLine(input.date)
  if (input.occasions.length === 0 && leadUps.length === 0 && !lookahead) return []
  return [
    'WHAT\'S GOING ON',
    ...input.occasions.map((occasion) => `- ${occasion.title} — ${occasion.description}`),
    ...leadUps.map((line) => `- ${line}`),
    ...(lookahead ? [`- ${lookahead}`] : [])
  ]
}

/** A place worth going, for a slot with nothing and nobody in it. */
function rumorBlock(input: SlotIntroInput): string[] {
  if (!input.rumorPlace) return []
  return [
    'SOMEWHERE TO GO',
    input.rumorPlace.text,
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

/**
 * Whether anybody asking this slot is asking him to what is on — the other test the asker
 * block and `YOUR TURN` both make.
 */
function anyOccasions(input: SlotIntroInput): boolean {
  return input.askers.some(({ occasion }) => occasion !== undefined)
}

/** The characters texting the reader an invitation this slot. */
function askerBlock(input: SlotIntroInput): string[] {
  if (input.askers.length === 0) return []

  return [
    'ASKING TO HANG OUT',
    'Each of these characters is texting the reader right now to ask him to spend this part of the day with her. Write one entry in "hangouts" for each, and nothing for anyone else. They are described under LOREBOOK.',
    ...(anyPlans(input)
      ? [
          'Where a plan is listed beside a character, she is not inviting the reader out of nowhere: the two of them agreed to this already, and she is writing about that plan, for everyone going. Her message reads as a reminder or a "still on?", not as a new idea.'
        ]
      : []),
    ...(anyOccasions(input)
      ? [
          'Where an occasion is listed beside a character, her text is about going to that occasion together — it is described under WHAT\'S GOING ON. She says what she wants to do or see there and asks him to come with her, and her "description" names it, like "Going to the Winter Gala with Sarah".'
        ]
      : []),
    ...input.askers.map(({ charKey, plan, occasion }) =>
      // The plan and the occasion ride the key, not the lorebook entry.
      plan
        ? `- ${charKey} — already planned for this part of the day: ${plan.description}`
        : occasion
          ? `- ${charKey} — asking him to come to ${occasion.title} with her`
          : `- ${charKey}`
    )
  ]
}

/** The lovers he left, each ending it by text as the slot opens. */
function breakupBlock(input: SlotIntroInput): string[] {
  if (input.breakups.length === 0) return []

  return [
    'BREAKING UP',
    'Each of these characters has just found out the reader started dating somebody else and is ending things with him over text right now. Write one entry in "breakups" for each, and nothing for anyone else. They are described under LOREBOOK.',
    ...input.breakups.map(
      ({ charKey, forFirstName }) => `- ${charKey} — he started dating ${forFirstName}`
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

/** Everybody the three blocks above name, described once each. */
function characterBlock(input: SlotIntroInput): string[] {
  const entries: string[][] = []
  const named = new Set<string>()

  for (const entry of [...input.askers, ...input.breakups, ...input.posters]) {
    const { charKey, character, info, texted } = entry
    // A girl the slot placed somewhere; the girl ending it is texting from nowhere in particular.
    const whereabouts = 'whereabouts' in entry ? entry.whereabouts : undefined
    if (named.has(charKey)) continue
    named.add(charKey)
    entries.push([
      `${fullNameOf(character)} — "char": "${charKey}"`,
      ...profileLines(character, info.flags ?? emptyFlags()),
      ...(whereabouts
        ? [
            whereaboutsLine(
              character.firstName,
              whereabouts.location,
              whereabouts.companions,
              whereabouts.haunt,
              input.time
            )
          ]
        : []),
      // What she is doing with the break: a girl off campus has no location to report.
      ...springBreakLines(
        character.firstName,
        info.springBreakPlans,
        input.springBreakAway,
        character.charId,
        input.date
      ),
      ...relationshipLines(
        character,
        info.flags ?? emptyFlags(),
        info.nameKnown,
        affectionFor(info, input.date, character),
        input.stats ?? DEFAULT_PLAYER_STATS,
        // Everybody here reaches the reader by phone: a first contact is a conversation, not a meeting.
        { texting: true, texted },
        // Where she is in her cycle, for a Promiscuous girl's DTF days.
        { date: input.date, offset: info.moodCycleOffset ?? 0 }
      ),
      ...memoryLines(character, dedupedMemoriesFor(info).slice(-2), info.textMemory)
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
  const occasioned = anyOccasions(input)

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
    ...spaced(rumor),
    'YOUR TURN',
    'Hey RITA, a new part of the reader\'s day is starting. Set the mood for them before they decide what to do with it.',
    'Continue where the OPENING LINE left off with three to five short lines of narration. Don\'t include the OPENING LINE in your response. Each line is one entry in "lines".',
    // The three beats, named: without them the call writes a to-do list.
    waking
      ? 'Open on the reader waking up in his Lowrise dorm room, describing how he feels and the sounds and sights around him.'
      : 'Open on the day winding down around the reader in his Lowrise dorm room, describing how he feels and the sounds and sights around him.',
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
          'Then fill "hangouts", one entry per character under ASKING TO HANG OUT. "char" is her key exactly as written there. "text" is the message she sends, in her own texting voice — lowercase, slang, typos and emoji are all fine if that is how she types — and it is ONLY about meeting up: what she wants to do and where, asked as a question' +
            (planned
              ? ' — or, where she has a plan listed, that plan, asked as a "we\'re still on, right?"'
              : '') +
            (occasioned
              ? ' — or, where she has an occasion listed, going to that occasion with her, asked as an invitation to come along'
              : '') +
            '. No narration, no stage directions, no other conversation. "description" is the plan in a few plain words, like "Getting dinner with Sarah at the Mockingbird" or "Studying with Chloe in the library".' +
            (planned
              ? ' If she has a hangout scheduled with the reader listed under her name, use that one.'
              : '') +
            (occasioned
              ? ' If she has an occasion listed under her name, her "description" names that occasion.'
              : ''),
          'The narration in "lines" must not mention these messages or these characters at all — the reader has not opened his phone yet.'
        ]
      : [
          // An optional property with no instruction against it is an invitation to invent one.
          '',
          'Return nothing at all for "hangouts".'
        ]),
    ...(input.breakups.length > 0
      ? [
          '',
          'Then fill "breakups", one entry per character under BREAKING UP. "char" is her key exactly as written there. "texts" is two to four short messages she sends one after another, in her own texting voice — lowercase, slang, typos and emoji are all fine if that is how she types — breaking up with the reader because he started dating the girl named beside her: how she found out, how she feels about it, and that it is over. No narration, no stage directions, no reply from the reader.',
          'The narration in "lines" must not mention these messages or these characters at all — the reader has not opened his phone yet.'
        ]
      : [
          // Refused out loud for "hangouts"'s reason.
          '',
          'Return nothing at all for "breakups".'
        ]),
    ...(input.posters.length > 0
      ? [
          '',
          'Then fill "posts", one entry per character under STATUS UPDATES. "char" is her key exactly as written there. "text" is the post itself: one or two short lines in her own voice, the way she would actually type it — lowercase, slang and emoji are fine if that is how she writes. It is a post to nobody in particular, about her hour: what she is doing, where she is, what kind of mood she is in, something small she noticed. She is NOT writing to the reader and must not address him, mention him, or refer to meeting anyone. No narration and no stage directions.',
          'The narration in "lines" must not mention these posts — the reader has not opened his phone yet.'
        ]
      : [
          // Refused out loud for "hangouts"'s reason.
          '',
          'Return nothing at all for "posts".'
        ])
  ].join('\n')

  return {
    system: [
      personaFor(input.lessNsfwText),
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

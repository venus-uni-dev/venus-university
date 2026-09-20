import { affectionFor, dedupedMemoriesFor, emptyFlags } from '@shared/relationship'
import { DEFAULT_PLAYER_STATS, type PlayerStats } from '@shared/playerStats'
import {
  fullNameOf,
  type Character,
  type CharInfo,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import { formatGameDate } from './gameDate'
import { GRADUATION_DATE } from './occasions'
import { relationshipLines } from './relationship'
import { objectSchema } from './schema'
import { memoryLines, personaFor, profileLines, spaced } from './scenePrompt'

/** The epilogue's status updates: the one call the days after graduation are written by. */

/** A contact posting once in the week after the ceremony. */
export interface EndingPoster {
  character: Character
  info: CharInfo
  /** How the reply names her back — resolved through `charKeyToId`. */
  charKey: string
  /** Whether a Bunnyboard thread with her already holds anything (`hasTexted`). */
  texted: boolean
  /** She is graduating out of reach rather than home for the summer. */
  senior: boolean
  /** How long after the ceremony she is posting, in days. */
  daysAfter: number
  /** Which half of that day she is posting in. */
  time: TimeSlot
}

/** Everything the builder reads; assembled by the loop, which owns the store. */
export interface EndingPostsInput {
  /** The cloud-LLM cache key — the playthrough, exactly as the scene calls use it. */
  playthroughId: string
  /** The reader's accumulated stats, used for relationship requirement guidance. */
  stats?: PlayerStats
  /** The player's `lessNsfwText` setting; picks which persona heads this call's prefix. */
  lessNsfwText: boolean
  /** Everybody the reply writes a post for, one entry each. */
  posters: readonly EndingPoster[]
}

/** One post per contact, and nothing else to fill in. */
const SCHEMA = objectSchema('ending_posts', ['posts'], {
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

/** The day the semester ended and what the campus is doing about it. */
function semesterBlock(): string[] {
  return [
    'THE SEMESTER IS OVER',
    `The graduation ceremony was held on ${formatGameDate(GRADUATION_DATE)} and campus is emptying out for summer vacation.`,
    'The seniors have graduated and are leaving Veridan.',
    'Everybody else is heading home until the fall.'
  ]
}

/** When she is writing, and what she is writing it from — the last line of her entry. */
function postingLine(poster: EndingPoster): string {
  const days = poster.daysAfter === 1 ? '1 day' : `${poster.daysAfter} days`
  const half = poster.time === 0 ? 'morning' : 'evening'
  const where = poster.senior
    ? 'has graduated and is moving on from Venus University'
    : 'is home for the summer and back in the fall'
  return `${poster.character.firstName} is posting ${days} after graduation, in the ${half}; she ${where}.`
}

/** Everybody the call names, described once each. */
function characterBlock(input: EndingPostsInput): string[] {
  const entries = input.posters.map((poster) => {
    const { character, info, charKey, texted } = poster
    // The day she is posting on, which is what her memories and her affection are weighed at.
    const date = GRADUATION_DATE + poster.daysAfter
    return [
      `${fullNameOf(character)} — "char": "${charKey}"`,
      ...profileLines(character, info.flags ?? emptyFlags()),
      ...relationshipLines(
        character,
        info.flags ?? emptyFlags(),
        info.nameKnown,
        affectionFor(info, date, character),
        input.stats ?? DEFAULT_PLAYER_STATS,
        // Everybody here is off campus: whatever they have left is a phone.
        { texting: true, texted },
        // Where she is in her cycle, for a Promiscuous girl's DTF days.
        { date, offset: info.moodCycleOffset ?? 0 }
      ),
      ...memoryLines(character, dedupedMemoriesFor(info).slice(-3), info.textMemory),
      postingLine(poster)
    ]
  })

  if (entries.length === 0) return []
  // Blank lines between entries only; `spaced()` closes the block.
  return [
    'LOREBOOK',
    '',
    ...entries.flatMap((entry, index) => (index === 0 ? entry : ['', ...entry]))
  ]
}

/** The characters writing a post, by key. */
function posterBlock(input: EndingPostsInput): string[] {
  return ['STATUS UPDATES', ...input.posters.map(({ charKey }) => `- ${charKey}`)]
}

/** Builds the epilogue's status-update request. */
export function buildEndingPostsPrompt(
  input: EndingPostsInput,
  setting: string,
  reader: string
): StructuredRequest {
  const user = [
    ...spaced(semesterBlock()),
    ...spaced(characterBlock(input)),
    ...spaced(posterBlock(input)),
    'YOUR TURN',
    'Hey RITA, the semester is over and everybody is scattering. Write what each of them posts about it.',
    'Fill "posts", one entry per character under STATUS UPDATES. "char" is her key exactly as written there.',
    '"text" is the post itself: one or two short lines in her own voice, the way she would actually type it — lowercase, slang and emoji are fine if that is how she writes. It is about how the days after graduation are going for her: what she is doing, where she is, what kind of mood she is in, something small she noticed. Looking back on the semester is welcome.',
    'Even though the semester is over, she still hasn\'t gone home yet.',
    'She is NOT writing to the reader and must not address him, mention him, or refer to meeting anyone. No narration and no stage directions.'
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

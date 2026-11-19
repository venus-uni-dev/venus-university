import {
  genderOf,
  pronounsOf,
  pronounTag,
  type ReaderPronouns
} from '@shared/gender'
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
import {
  fullNameOf,
  type Character,
  type CharInfo,
  type RomanceSetting,
  type Season,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import { formatGameDate } from './gameDate'
import { loveLines } from './npcRelationship'
import { GRADUATION_DATE } from './occasions'
import { relationshipLines } from './relationship'
import { objectSchema } from './schema'
import { readerAmongCast } from './setting'
import {
  memoryLines,
  notesLines,
  personaFor,
  profileLines,
  secretLines,
  spaced
} from './scenePrompt'

/** The epilogue's status updates: the one call the days after graduation are written by. */

/** A contact posting once in the week after the ceremony. */
export interface EndingPoster {
  character: Character
  info: CharInfo
  /** How the reply names her back — resolved through `charKeyToId`. */
  charKey: string
  /** Whether a Bunnyboard thread with her already holds anything (`hasTexted`). */
  texted: boolean
  /** She graduated at the ceremony, rather than going home for the break. */
  graduating: boolean
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
  /** How many of her told secrets each poster's entry carries; absent is the default. */
  secretBudget?: number
  /** The semester's season, which names the month of every date and the break that follows it. */
  season: Season
  /** The reader graduated at the ceremony too, which is the end of his time at Venus. */
  readerGraduated: boolean
  /** Everybody the reply writes a post for, one entry each. */
  posters: readonly EndingPoster[]
  /** Which genders the playthrough lets the reader romance. */
  romance: RomanceSetting
  /** The pronouns the reader goes by. */
  readerPronouns: ReaderPronouns
  /** Who on the roster is dating whom, and who has a crush on whom. */
  npcRelationships: NpcRelationshipMap
  /** Everyone on the roster and every graduate, whom her partners and crushes are named among. */
  people: readonly Character[]
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
function semesterBlock(season: Season, readerGraduated: boolean): string[] {
  const fall = season === 'fall'
  return [
    'THE SEMESTER IS OVER',
    `The graduation ceremony was held on ${formatGameDate(GRADUATION_DATE, season)} and campus is emptying out for ${fall ? 'winter' : 'summer'} vacation.`,
    'The seniors have graduated and are leaving Veridan.',
    ...(readerGraduated ? ['The reader graduated with them and is leaving Veridan too.'] : []),
    `Everybody else is heading home until the ${fall ? 'spring' : 'fall'}.`
  ]
}

/** When she is writing, and what she is writing it from — the last line of her entry. */
function postingLine(poster: EndingPoster, season: Season): string {
  const days = poster.daysAfter === 1 ? '1 day' : `${poster.daysAfter} days`
  const half = poster.time === 0 ? 'morning' : 'evening'
  const where = poster.graduating
    ? 'has graduated and is moving on from Venus University'
    : season === 'fall'
      ? 'is home for winter vacation and back in the spring'
      : 'is home for the summer and back in the fall'
  return `${poster.character.firstName} is posting ${days} after graduation, in the ${half}; ${pronounsOf(poster.character).they} ${where}.`
}

/** Everybody the call names, described once each. */
function characterBlock(input: EndingPostsInput): string[] {
  const entries = input.posters.map((poster) => {
    const { character, info, charKey, texted } = poster
    // The day she is posting on, which is what her memories and her affection are weighed at.
    const date = GRADUATION_DATE + poster.daysAfter
    return [
      `${fullNameOf(character)} (${pronounTag(genderOf(character))}) — "char": "${charKey}"`,
      ...profileLines(
        character,
        info.flags ?? emptyFlags(),
        attractionInPlay(character, info, input.romance, input.readerPronouns)
      ),
      ...relationshipLines(
        character,
        info.flags ?? emptyFlags(),
        info.nameKnown,
        affectionFor(info, date, character),
        info,
        {
          stats: input.stats ?? DEFAULT_PLAYER_STATS,
          // Everybody here is off campus: whatever they have left is a phone.
          medium: { texting: true, texted },
          // Where she is in her cycle, for a Promiscuous girl's DTF days.
          mood: { date, offset: info.moodCycleOffset ?? 0 },
          romanceable: isRomanceable(character, info, input.romance, input.readerPronouns),
          loyal:
            readerCrushFactorOf(input.npcRelationships, character.charId, character, date) === 0,
          readerPronouns: input.readerPronouns
        }
      ),
      // Who she is dating, and who she likes once she trusts him.
      ...loveLines(
        character,
        input.people,
        input.npcRelationships,
        isTrusted(affectionFor(info, date, character))
      ),
      ...memoryLines(
        character,
        dedupedMemoriesFor(info).slice(-3),
        info.textMemory,
        input.season,
        input.readerPronouns
      ),
      ...secretLines(character.firstName, info.toldSecrets, input.secretBudget),
      postingLine(poster, input.season),
      ...notesLines(character.firstName, info.notes)
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
  const him = readerAmongCast(input.readerPronouns).him
  const user = [
    ...spaced(semesterBlock(input.season, input.readerGraduated)),
    ...spaced(characterBlock(input)),
    ...spaced(posterBlock(input)),
    'YOUR TURN',
    'Hey RITA, the semester is over and everybody is scattering. Write what each of them posts about it.',
    'Fill "posts", one entry per character under STATUS UPDATES. "char" is their key exactly as written there.',
    '"text" is the post itself: one or two short lines in their own voice, the way they would actually type it — lowercase, slang and emoji are fine if that is how they write. It is about how the days after graduation are going for them: what they are doing, where they are, what kind of mood they are in, something small they noticed. Looking back on the semester is welcome.',
    'Even though the semester is over, they still haven\'t gone home yet.',
    `They are NOT writing to the reader and must not address ${him}, mention ${him}, or refer to meeting anyone. No narration and no stage directions.`
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

import {
  charKeyOf,
  MEMORY_TYPES,
  type CharInfo,
  type LedgerResponse,
  type StructuredRequest
} from '@shared/types'
import { objectSchema } from './schema'
import { LEDGER_PERSONA, milestoneCastLines } from './scenePrompt'
import {
  messagesBlock,
  plansSchema,
  scheduleBlocks,
  scheduleCharKeys,
  TEXT_PLANS_INSTRUCTIONS,
  textLedgerCharKeys,
  type SchedulePromptInput
} from './schedulePrompt'

/** The texting ledger: the bookkeeping call for the slot's Bunnyboard messages. */

/**
 * The milestones a text thread can reach, each with the gloss RITA is given — the texting-ledger
 * subset of the scene ledger's `EVENT_GLOSS`, in the same append-only discipline.
 */
export const TEXT_EVENT_GLOSS: ReadonlyArray<readonly [string, string]> = [
  ['became_lovers', 'they agreed over these texts to be a couple'],
  ['broke_up', 'their relationship ended in these texts'],
  [
    'friendzoned_by_reader',
    'the reader turned her down in these texts or made it clear they\'re just friends'
  ],
  [
    'friendzoned_reader',
    'she turned the reader down in these texts or made it clear they\'re just friends'
  ],
  [
    'agreed_to_harem',
    'she agreed in these texts to an open relationship and/or to share the reader with other girls, and not to be jealous about them'
  ]
]

/**
 * The texting ledger's schema — one branch, all three fields required. `textedKeys` is never
 * empty: the call only fires when somebody texted.
 */
function textLedgerSchema(
  textedKeys: readonly string[],
  rosterKeys: readonly string[]
): { name: string; schema: Record<string, unknown> } {
  const charKey = { type: 'string', enum: [...textedKeys] }
  return objectSchema('text-ledger', ['events', 'textMemories', 'plans'], {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['charKey', 'event'],
        properties: {
          charKey,
          event: { type: 'string', enum: TEXT_EVENT_GLOSS.map(([key]) => key) }
        }
      }
    },
    textMemories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['charKey', 'type', 'desc'],
        properties: {
          charKey,
          type: { type: 'string', enum: [...MEMORY_TYPES] },
          desc: { type: 'string' }
        }
      }
    },
    plans: plansSchema(rosterKeys)
  })
}

/** Builds the texting ledger request. */
export function buildTextLedgerPrompt(
  schedule: SchedulePromptInput,
  charInfo: Record<string, CharInfo>
): StructuredRequest {
  const textedKeys = textLedgerCharKeys(schedule)
  const rosterKeys = scheduleCharKeys(schedule.characters)
  // The texters as characters, in thread order.
  const texted = new Set(textedKeys)
  const texters = Object.values(schedule.characters).filter((character) =>
    texted.has(charKeyOf(character.firstName, character.lastName))
  )

  const preamble = [
    'YOUR TASK',
    'Hey Rita! The reader spent part of this day texting on Bunnyboard. Let\'s take THE MESSAGES below and create some notes for us to reference later.',
    'Judge the texts alone: anything a scene did face to face is another call\'s business.',
    '',
    'EVENTS',
    'List any of these milestones that actually happened IN THESE MESSAGES:',
    ...TEXT_EVENT_GLOSS.map(([key, gloss]) => `- ${key}: ${gloss}`),
    'A milestone that did not happen in these messages is simply left out. If one happened again — they broke up again — report it again; the app knows which time it was.',
    '',
    'TEXT MEMORIES',
    'For each girl the reader texted, write at most ONE memory of what the texting left her with, in "textMemories".',
    'Each desc completes the sentence "<Name> <type> that ...", e.g. "you asked how her recital went".',
    'Small talk that left her feeling nothing gets no entry. Give a girl nothing rather than something invented.',
    '',
    ...TEXT_PLANS_INSTRUCTIONS,
    ''
  ].join('\n')

  // The cloud-LLM seam: everything above is constant across calls, everything below varies,
  // and the console log starts here.
  const rest = [
    'TEXTERS',
    ...milestoneCastLines(texters, charInfo),
    '',
    ...scheduleBlocks(schedule, true),
    '',
    ...messagesBlock(schedule),
    ''
  ].join('\n')

  return {
    system: LEDGER_PERSONA,
    user: `${preamble}\n${rest}`,
    schema: textLedgerSchema(textedKeys, rosterKeys),
    // Constant: everything save-varying sits below the seam.
    cacheKey: 'text-ledger',
    logFrom: preamble.length + 1,
    // The bookkeeping is judged better at high, whatever the setting says.
    minThinking: 'high'
  }
}

/**
 * Folds the two bookkeeping replies into the one `LedgerResponse` downstream reads:
 * scene first in both lists, an `events` row the scene already reported dropped, and a
 * `plans` row sharing a slot and an attendee with a scene plan losing to it.
 */
export function mergeLedgerReplies(main: LedgerResponse, texting: LedgerResponse): LedgerResponse {
  const merged: LedgerResponse = { ...main }

  if (texting.textMemories !== undefined) merged.textMemories = texting.textMemories

  if (texting.events?.length) {
    const seen = new Set((main.events ?? []).map((row) => `${row.charKey}\u0000${row.event}`))
    const fresh = texting.events.filter((row) => !seen.has(`${row.charKey}\u0000${row.event}`))
    if (main.events?.length || fresh.length) merged.events = [...(main.events ?? []), ...fresh]
  }

  if (texting.plans?.length) {
    const scenePlans = main.plans ?? []
    const fresh = texting.plans.filter(
      (plan) =>
        !scenePlans.some(
          (existing) =>
            existing.slot === plan.slot &&
            (plan.chars ?? []).some((key) => (existing.chars ?? []).includes(key))
        )
    )
    if (scenePlans.length || fresh.length) merged.plans = [...scenePlans, ...fresh]
  }

  return merged
}

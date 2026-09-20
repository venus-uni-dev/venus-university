import type {
  ChatMessage,
  HangoutClassifierResponse,
  StructuredRequest,
  TimeSlot
} from '@shared/types'
import type { Weather } from '@shared/weather'
import { formatDateBanner, slotHalf } from './gameDate'
import { objectSchema } from './schema'
import { stampedStubs } from './textingPrompt'
import { weatherLines } from './weather'

/**
 * The hangout classifier: a second, cheap call that reads one texting exchange and
 * answers whether anybody just proposed meeting up *right now*.
 */

/** How many messages of thread ride along as background. */
const HANGOUT_CONTEXT_CAP = 6

/** What the classifier decided, once the two flags are collapsed. */
export interface HangoutVerdict {
  /** Who did the proposing — the arm-now path, or the Yes/No path. */
  initiatedBy: 'player' | 'contact'
  /** The plan in one sentence; the scene's opening action. */
  description: string
}

/** The prompt-facing slice of state one classification needs. */
export interface HangoutClassifierState {
  date: number
  time: TimeSlot
  /**
   * The whole semester's sky, one reading per slot — the NOW line walks back through it for how
   * long the weather has held. Absent means nothing is said about it.
   */
  weather?: readonly Weather[]
}

/** Builds the classification request for one texting turn. */
export function buildHangoutClassifierPrompt(
  firstName: string,
  recent: readonly ChatMessage[],
  playerMessage: ChatMessage,
  replyMessages: readonly ChatMessage[],
  state: HangoutClassifierState
): StructuredRequest {
  const background = stampedStubs(recent.slice(-HANGOUT_CONTEXT_CAP), firstName)

  const user = [
    'You read one exchange from a text thread and report three things about it.',
    '',
    'NOW',
    `It is ${formatDateBanner(state.date, state.time)}`,
    ...(state.weather ? weatherLines(state.weather, state.date, state.time) : []),
    '',
    // The instructions below point at these blocks by name.
    'BACKGROUND — earlier messages in the thread, for context only.',
    'They tell you what "this" or "that plan" refers to.',
    'A proposal made in BACKGROUND is NOT a proposal: never set a flag because of a line in here.',
    "'''",
    ...(background.length > 0 ? background : ['(none)']),
    "'''",
    '',
    'THE MESSAGE — what the reader just sent.',
    "'''",
    ...stampedStubs([playerMessage], firstName),
    "'''",
    '',
    `THE REPLY — what ${firstName} is about to send back.`,
    "'''",
    ...stampedStubs(replyMessages, firstName),
    "'''",
    '',
    `Set "playerAsked" to true when THE MESSAGE asks ${firstName} to meet up in person right now — today, this ${slotHalf(state.time)}, immediately — AND THE REPLY does not turn it down.`,
    'It is false when she refuses, deflects, or is unsure in THE REPLY.',
    'It is false for a plan at any other time: "tonight" while it is still day, "tomorrow", "this weekend", "sometime", "we should do this again".',
    '',
    `Set "characterOffered" to true when THE REPLY itself asks the reader to meet up in person right now, today, immediately — ${firstName} doing the proposing.`,
    'A vague maybe, an agreement to something the reader proposed, or a reference to a plan already made is not an offer.',
    '',
    'Look for proposals ONLY in THE MESSAGE and THE REPLY. Nowhere else.',
    '',
    'When either flag is true, set "description" to the plan written as a calendar entry: what is happening, where it is happening, and the name of every single person going.',
    'Write it as a phrase, not a sentence about anybody: no "the reader", no "you", no verb about who does what. "Coffee at the student union with Mina and Mia." — not "The reader gets coffee with Mina."',
    'Name everyone who is going, including anybody either message says is coming along. Nobody present may be left out.',
    'When both flags are false, "description" is an empty string.',
    '',
    'Examples:',
    '',
    'THE MESSAGE "we should hang out sometime" / THE REPLY "yeah for sure!"',
    '{"playerAsked":false,"characterOffered":false,"description":""}',
    '',
    'THE MESSAGE "wanna grab coffee at the union right now" / THE REPLY "omg yes im starving, bringing mia too"',
    '{"playerAsked":true,"characterOffered":false,"description":"Coffee at the student union with Mina and Mia."}',
    '',
    'THE MESSAGE "wanna grab coffee right now" / THE REPLY "cant, im swamped tonight sorry"',
    '{"playerAsked":false,"characterOffered":false,"description":""}',
    '',
    'THE MESSAGE "how was your day" / THE REPLY "long lol. come walk by the river with me, im heading out now"',
    '{"playerAsked":false,"characterOffered":true,"description":"A walk along the river with Mina."}',
    '',
    'THE MESSAGE "what are you up to" / THE REPLY "hazel and colette dragged me to the arcade, come meet us"',
    '{"playerAsked":false,"characterOffered":true,"description":"BTB Arcade with Mina, Hazel and Colette."}',
    '',
    'Fill in "playerAsked", "characterOffered", and "description" for the exchange above.'
  ].join('\n')

  return {
    system: '',
    user,
    schema: hangoutClassifierSchema(),
    cacheKey: 'hangout-classifier',
    // The classifier is judged better at a floor of low.
    minThinking: 'low'
  }
}

/**
 * The {@link HangoutClassifierResponse} schema. The two flags come before the description so
 * each is decided before anything is written about the plan.
 */
function hangoutClassifierSchema(): { name: string; schema: Record<string, unknown> } {
  return objectSchema('hangoutClassifier', ['playerAsked', 'characterOffered', 'description'], {
    playerAsked: { type: 'boolean' },
    characterOffered: { type: 'boolean' },
    description: { type: 'string' }
  })
}

/**
 * Collapses a parsed reply into the verdict the texting loop consumes, or null when nobody
 * proposed anything.
 */
export function normalizeHangout(parsed: unknown): HangoutVerdict | null {
  const reply = (parsed ?? {}) as Partial<HangoutClassifierResponse>
  const description = typeof reply.description === 'string' ? reply.description.trim() : ''
  // A plan with no description is nothing the scene loop can cast from.
  if (!description) return null
  if (reply.playerAsked === true) return { initiatedBy: 'player', description }
  if (reply.characterOffered === true) return { initiatedBy: 'contact', description }
  return null
}

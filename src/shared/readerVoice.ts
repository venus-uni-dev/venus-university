/**
 * A memory is kept and prompted in the third person ("the reader was late"), the verb agreeing
 * with "the reader", and shown to the player with the reader's first name in his place, as a recap
 * is; one the player types with that name is filed with "the reader" back in its place.
 */

import { PRONOUNS, readerWords, type ReaderPronouns } from './gender'
import type { Gender } from './types'

/** Adverbs that may stand between the subject and the verb it agrees with. */
const ADVERBS = 'never|always|still|really|actually|also|just|even|finally|only|already'

/** Prepositions that make the subject after them an object, whose next verb is not its own. */
const PREPOSITIONS = [
  'about',
  'against',
  'among',
  'around',
  'at',
  'behind',
  'beside',
  'between',
  'by',
  'for',
  'from',
  'near',
  'of',
  'on',
  'to',
  'toward',
  'towards',
  'with',
  'without'
].join('|')

/**
 * A subject, an optional reflexive or adverb, and one of four verbs after it, when no
 * preposition leads.
 */
function subjectVerbPattern(subject: string, verbs: Record<string, string>): RegExp {
  return new RegExp(
    `(?<!\\b(?:${PREPOSITIONS})\\s)\\b${subject}(\\s+(?:himself|herself|themself|yourself|${ADVERBS}))?(\\s+)` +
      `(${Object.keys(verbs).join('|')})(n['’]t)?\\b`,
    'gi'
  )
}

/** Each verb that agrees with "you", and the one that agrees with "the reader" in its place. */
const TO_THIRD_PERSON: Record<string, string> = { were: 'was', are: 'is', have: 'has', do: 'does' }

/** What each of "you're", "you've", "you'll" and "you'd" spells out to after "the reader". */
const CONTRACTIONS: Record<string, string> = { re: 'is', ve: 'has', ll: 'will', d: 'would' }

/** "you" and the verb it governs. */
const SECOND_PERSON_VERB = subjectVerbPattern('you', TO_THIRD_PERSON)

/** `word` with a capital first letter when the text it replaces opens with one. */
function matchCase(replaced: string, word: string): string {
  const first = replaced.charAt(0)
  return first !== first.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word
}

/** A replacer for {@link subjectVerbPattern}: the subject becomes `subject`, the verb agrees. */
function agreeing(subject: string, verbs: Record<string, string>) {
  return (
    matched: string,
    adverb: string | undefined,
    gap: string,
    verb: string,
    negation: string | undefined
  ): string => {
    const agreed = verbs[verb.toLowerCase()]
    return `${matchCase(matched, subject)}${adverb ?? ''}${gap}${agreed}${negation ?? ''}`
  }
}

/**
 * A memory in the reader's voice: "you" becomes "the reader", the verb after it agreeing,
 * "yourself" the reader's own reflexive, and "the two of you broke up" puts the holder's pronoun
 * beside the reader.
 */
export function readerize(text: string, holder: Gender, reader: ReaderPronouns): string {
  // The reflexive turns first, so the verb rule sees "you himself were" and lands the reader's
  // verb behind it.
  return text
    .replace(/\bthe two of you broke up\b/gi, (m) =>
      matchCase(m, `${PRONOUNS[holder].they} and the reader broke up`)
    )
    .replace(/\byourself\b/gi, (m) => matchCase(m, readerWords(reader).himself))
    .replace(/\byours?\b/gi, (m) => matchCase(m, "the reader's"))
    .replace(/\byou['’](re|ve|ll|d)\b/gi, (m, tail: string) =>
      matchCase(m, `the reader ${CONTRACTIONS[tail.toLowerCase()]}`)
    )
    .replace(SECOND_PERSON_VERB, agreeing('the reader', TO_THIRD_PERSON))
    .replace(/\byou\b/gi, (m) => matchCase(m, 'the reader'))
}

/**
 * A memory as it is filed: trimmed, in the reader's voice as its holder's gender has it, and
 * opening lower-case, since it completes "<Name> liked that …".
 */
export function storedMemoryDesc(
  text: string,
  holder: Gender,
  reader: ReaderPronouns
): string {
  return readerize(text.trim(), holder, reader).replace(/^The reader\b/, 'the reader')
}

/**
 * A recap or a memory as the player reads it: every "the reader" his own name, "the reader's"
 * his too.
 */
export function namedReader(text: string, name: string): string {
  return text.replace(/\bthe reader\b/gi, () => name)
}

/**
 * `name` as a pattern, any case: its characters as written, the space between its words any run
 * of space, and never part of a longer word, whatever alphabet either side is written in.
 */
function namePattern(name: string): RegExp {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`(?<![\\p{L}\\p{N}_])${words.join('\\s+')}(?![\\p{L}\\p{N}_])`, 'giu')
}

/**
 * Text the player wrote calling the reader by `name`, with "the reader" in its place wherever it
 * stands as a word in any case, opening a sentence with a capital; "Lucky's" becomes "the
 * reader's".
 */
export function unnamedReader(text: string, name: string): string {
  if (!name.trim()) return text
  return text.replace(namePattern(name), (_match, at: number, whole: string) =>
    /(?:^|[.!?]\s+)$/.test(whole.slice(0, at)) ? 'The reader' : 'the reader'
  )
}

/**
 * A filed memory as the player reads it and as an edit opens on it: in the reader's voice, as an
 * older save's second-person memory is sent to the model too, then with his name for "the reader".
 */
export function shownMemoryDesc(
  desc: string,
  name: string,
  holder: Gender,
  reader: ReaderPronouns
): string {
  return namedReader(readerize(desc, holder, reader), name)
}

/** A memory the player typed calling the reader by `name`, as it is filed. */
export function typedMemoryDesc(
  text: string,
  name: string,
  holder: Gender,
  reader: ReaderPronouns
): string {
  return storedMemoryDesc(unnamedReader(text, name), holder, reader)
}

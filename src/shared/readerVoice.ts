/**
 * A memory is kept and prompted in the third person ("the reader was late") and shown to the
 * player in the second ("you were late"), the verb agreeing with its subject either way.
 */

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
    `(?<!\\b(?:${PREPOSITIONS})\\s)\\b${subject}(\\s+(?:himself|yourself|${ADVERBS}))?(\\s+)` +
      `(${Object.keys(verbs).join('|')})(n['’]t)?\\b`,
    'gi'
  )
}

/** Each verb that agrees with "the reader", and the one that agrees with "you" in its place. */
const TO_SECOND_PERSON: Record<string, string> = { was: 'were', is: 'are', has: 'have', does: 'do' }

/** Each verb that agrees with "you", and the one that agrees with "the reader" in its place. */
const TO_THIRD_PERSON: Record<string, string> = { were: 'was', are: 'is', have: 'has', do: 'does' }

/** What each of "you're", "you've", "you'll" and "you'd" spells out to after "the reader". */
const CONTRACTIONS: Record<string, string> = { re: 'is', ve: 'has', ll: 'will', d: 'would' }

/** "the reader" or "you" and the verb it governs, in each direction. */
const THIRD_PERSON_VERB = subjectVerbPattern('the reader', TO_SECOND_PERSON)
const SECOND_PERSON_VERB = subjectVerbPattern('you', TO_THIRD_PERSON)
const HE_VERB = subjectVerbPattern('he', TO_SECOND_PERSON)

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
 * A memory as the player reads it: "the reader" becomes "you", the verb after it agreeing —
 * and in a memory that names him, his "he", "him" and "his" turn with him.
 */
export function secondPerson(text: string): string {
  if (!/\bthe reader\b/i.test(text)) return text
  // The verb agrees before the reflexive turns, so "the reader himself was" reads "you yourself
  // were"; the reflexive turns before the subject, so a bare "the reader himself" reads too.
  return text
    .replace(/\bthe reader['’]s\b/gi, (m) => matchCase(m, 'your'))
    .replace(/\bhis\b(?=\s*(?:[.,;:!?]|$))/gi, (m) => matchCase(m, 'yours'))
    .replace(/\bhis\b/gi, (m) => matchCase(m, 'your'))
    .replace(THIRD_PERSON_VERB, agreeing('you', TO_SECOND_PERSON))
    .replace(HE_VERB, agreeing('you', TO_SECOND_PERSON))
    .replace(/\bhimself\b/gi, (m) => matchCase(m, 'yourself'))
    .replace(/\bhim\b/gi, (m) => matchCase(m, 'you'))
    // A bare "he" turns, and "he'll" and "he'd" with it; "he's" stays as written, being "he is"
    // or "he has".
    .replace(/\bhe\b(?!['’]s\b)/gi, (m) => matchCase(m, 'you'))
    .replace(/\bthe reader\b/gi, (m) => matchCase(m, 'you'))
}

/** A memory in the reader's voice: "you" becomes "the reader", the verb after it agreeing. */
export function readerize(text: string): string {
  // The reflexive turns first, so the verb rule sees "you himself were" and lands the reader's
  // verb behind it.
  return text
    .replace(/\bthe two of you broke up\b/gi, (m) => matchCase(m, 'she and the reader broke up'))
    .replace(/\byourself\b/gi, (m) => matchCase(m, 'himself'))
    .replace(/\byours?\b/gi, (m) => matchCase(m, "the reader's"))
    .replace(/\byou['’](re|ve|ll|d)\b/gi, (m, tail: string) =>
      matchCase(m, `the reader ${CONTRACTIONS[tail.toLowerCase()]}`)
    )
    .replace(SECOND_PERSON_VERB, agreeing('the reader', TO_THIRD_PERSON))
    .replace(/\byou\b/gi, (m) => matchCase(m, 'the reader'))
}

/**
 * A memory as it is filed: trimmed, in the reader's voice, and opening lower-case, since it
 * completes "<Name> liked that …".
 */
export function storedMemoryDesc(text: string): string {
  return readerize(text.trim()).replace(/^The reader\b/, 'the reader')
}

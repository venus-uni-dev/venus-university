import type { Character, Gender } from './types'

/**
 * A character's gender as every rule reads it, and the words that follow from it: the pronouns
 * a line about one character is written in, and the tag a heading carries.
 */

/** Her gender: male only where her record says exactly that, female otherwise. */
export function genderOf(c: Pick<Character, 'gender'> | null | undefined): Gender {
  return c?.gender === 'male' ? 'male' : 'female'
}

/** A gender off a value that crossed the bridge or came off a form: male only when exactly that. */
export function asGender(value: unknown): Gender {
  return value === 'male' ? 'male' : 'female'
}

/** The words one gender is written about in, each also with a capital for a sentence's start. */
export interface Pronouns {
  they: string
  them: string
  their: string
  theirs: string
  themself: string
  They: string
  Them: string
  Their: string
  Theirs: string
  Themself: string
  /** What one of them is called: girl or guy. */
  noun: string
  /** What one the reader dates is: girlfriend or boyfriend. */
  partner: string
}

/** Each gender's words. */
export const PRONOUNS: Readonly<Record<Gender, Pronouns>> = {
  female: {
    they: 'she',
    them: 'her',
    their: 'her',
    theirs: 'hers',
    themself: 'herself',
    They: 'She',
    Them: 'Her',
    Their: 'Her',
    Theirs: 'Hers',
    Themself: 'Herself',
    noun: 'girl',
    partner: 'girlfriend'
  },
  male: {
    they: 'he',
    them: 'him',
    their: 'his',
    theirs: 'his',
    themself: 'himself',
    They: 'He',
    Them: 'Him',
    Their: 'His',
    Theirs: 'His',
    Themself: 'Himself',
    noun: 'guy',
    partner: 'boyfriend'
  }
}

/** The words a line about one character is written in. */
export function pronounsOf(c: Pick<Character, 'gender'> | null | undefined): Pronouns {
  return PRONOUNS[genderOf(c)]
}

/**
 * A template with every `{they}`-style token filled for one gender, and `{name}` where a name is
 * given; any other `{…}` is left as written.
 */
export function fillPronouns(template: string, gender: Gender, name?: string): string {
  const words = PRONOUNS[gender]
  return template.replace(/\{(\w+)\}/g, (token, key: string) => {
    if (key === 'name') return name ?? token
    return Object.hasOwn(words, key) ? words[key as keyof Pronouns] : token
  })
}

/** The tag a cast or student heading names one gender's pronouns by. */
export function pronounTag(gender: Gender): string {
  return gender === 'male' ? 'he/him' : 'she/her'
}

/** The pronouns the player gave the reader at New Game, by their subject form. */
export type ReaderPronouns = 'he' | 'she' | 'they'

/** Every set the player may pick, in the order the select offers them. */
export const READER_PRONOUNS: readonly ReaderPronouns[] = ['he', 'she', 'they']

/** Each set as the select names it. */
export const READER_PRONOUN_LABELS: Readonly<Record<ReaderPronouns, string>> = {
  he: 'He/him',
  she: 'She/her',
  they: 'They/them'
}

/** A set off a value that crossed the bridge or came off a form: he/him unless exactly another. */
export function asReaderPronouns(value: unknown): ReaderPronouns {
  return value === 'she' || value === 'they' ? value : 'he'
}

/** The reader's pronouns as a record, an enrollment or a draft holds them; he/him where absent. */
export function readerPronounsOf(
  holder: { playerPronouns?: unknown } | null | undefined
): ReaderPronouns {
  return asReaderPronouns(holder?.playerPronouns)
}

/** The reader's own gender off their pronouns; null for they/them, who counts as both. */
export function readerGenderOf(reader: ReaderPronouns): Gender | null {
  if (reader === 'he') return 'male'
  if (reader === 'she') return 'female'
  return null
}

/**
 * How one line names the reader. `he` is the subject and always takes a singular verb, so a
 * they/them reader's is "the reader"; `list` is the reader's own pronouns quoted for the ledgers'
 * rule against them.
 */
export interface ReaderWords {
  he: string
  him: string
  his: string
  hers: string
  himself: string
  He: string
  Him: string
  His: string
  list: string
}

/** Each set's own words, before a line decides whether they could be read as somebody else's. */
const READER_OWN: Readonly<Record<ReaderPronouns, Omit<ReaderWords, 'list'>>> = {
  he: { he: 'he', him: 'him', his: 'his', hers: 'his', himself: 'himself', He: 'He', Him: 'Him', His: 'His' },
  she: { he: 'she', him: 'her', his: 'her', hers: 'hers', himself: 'herself', He: 'She', Him: 'Her', His: 'Her' },
  they: {
    he: 'the reader',
    him: 'them',
    his: 'their',
    hers: 'theirs',
    himself: 'themself',
    He: 'The reader',
    Him: 'Them',
    His: 'Their'
  }
}

/** Each set's pronouns as the ledgers quote them. */
const READER_LIST: Readonly<Record<ReaderPronouns, string>> = {
  he: '"he", "him" or "his"',
  she: '"she", "her" or "hers"',
  they: '"they", "them" or "their"'
}

/** The reader named outright, for a line where a pronoun could be read as somebody else. */
const BY_NAME: Omit<ReaderWords, 'list'> = {
  he: 'the reader',
  him: 'the reader',
  his: "the reader's",
  hers: "the reader's",
  himself: 'the reader',
  He: 'The reader',
  Him: 'The reader',
  His: "The reader's"
}

/**
 * The reader's words in a line, `beside` being the gender of the one character it names with him:
 * his own pronouns, or the reader named outright where they are that character's too. A
 * they/them reader's never are, a character being he or she.
 */
export function readerWords(reader: ReaderPronouns, beside?: Gender): ReaderWords {
  const shared =
    (reader === 'he' && beside === 'male') || (reader === 'she' && beside === 'female')
  return { ...(shared ? BY_NAME : READER_OWN[reader]), list: READER_LIST[reader] }
}

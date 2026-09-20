import {
  charKeyOf,
  fullNameOf,
  type Character,
  type ClassCategory,
  type CourseEntry,
  type PeClassEntry,
  type StructuredRequest
} from '@shared/types'
import { rollDifficulty, rollProfessor, type ClassKind } from '@shared/academics'
import type { DormId } from '@shared/dorms'
import { appError } from '@shared/errors'
import { LAST_NAMES } from './characterSuggestions'
import { objectSchema } from './schema'

/**
 * Builds and validates the one-shot class-generation request; pure, no IO.
 * Runs once per save, between Start Game and the first save write.
 */

/** Categories the model may return. `interest` is ours, applied after parsing. */
const GENERATED_CATEGORIES = ['pe', 'humanities', 'arts', 'major', 'misc'] as const

/** How many classes the model is asked for, per pool. */
const PE_POOL_SIZE = 10
const FILLER_POOL_SIZE = 5
const CLASSES_PER_MAJOR = 4

/** One catalog entry as the model returns it — no slot yet (the scheduler deals those). */
export interface ClassDraft {
  code: string
  name: string
  description: string
  category: ClassCategory
  major?: string
  /** Lecture or project. Asked of every course; PE loses it in `decorateClasses`. */
  kind?: ClassKind
  /** charKey this was invented for; set only for `category: 'interest'`. */
  owner?: string
}

/** A draft after `decorateClasses`: PE without a kind, every other course decorated. */
export type DecoratedClassDraft = (Omit<PeClassEntry, 'slot'> | Omit<CourseEntry, 'slot'>) & {
  owner?: string
}

/** The four fields every course carries, before we label it. */
type CourseDraft = Pick<ClassDraft, 'code' | 'name' | 'description' | 'kind'>

/** One character's catalog-side profile as *this* call returns it. */
interface CharClassReply {
  major: string
  majorClassesTaken: number
  interestClass: { code: string; name: string; description: string; kind?: ClassKind }
}

/** One character's academic profile, both calls' halves joined. */
interface CharClassDraft extends CharClassReply {
  year: number
  dorm: DormId
  classesTaken: number
}

/** This call's whole reply: catalog-side profiles keyed by charKey, plus the flat catalog. */
export interface ClassGenReply {
  characters: Record<string, CharClassReply>
  classes: ClassDraft[]
}

/** The merged draft, before decoration. */
export interface ClassGenDraft extends ClassGenReply {
  characters: Record<string, CharClassDraft>
}

/** {@link ClassGenDraft} once `decorateClasses` has run — what the scheduler consumes. */
export type DecoratedClassGenDraft = Omit<ClassGenDraft, 'classes'> & {
  classes: DecoratedClassDraft[]
}

/** What a reply's `kind` reads as: `project` when it says so, else `lecture`. */
function classKindOf(kind: unknown): ClassKind {
  return kind === 'project' ? 'project' : 'lecture'
}

/** An integer field with inclusive bounds. Shared with the profile call. */
export function intField(minimum: number, maximum: number): Record<string, unknown> {
  return { type: 'integer', minimum, maximum }
}

/** The shape of one catalog entry, shared by the catalog and interest classes. */
function courseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'name', 'description', 'kind'],
    properties: {
      code: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      kind: { type: 'string', enum: ['lecture', 'project'] }
    }
  }
}

/** Every roster key, and the cast block the registrar and the profile call both open with. */
export function rosterCastLines(roster: readonly Character[]): {
  keys: string[]
  cast: string[]
} {
  const keys = roster.map((c) => charKeyOf(c.firstName, c.lastName))
  const cast = roster.flatMap((character, index) => [
    `${keys[index]} — ${fullNameOf(character)}`,
    character.personality,
    ''
  ])
  return { keys, cast }
}

/** Builds the class-catalog request. */
export function buildClassPrompt(roster: readonly Character[]): StructuredRequest {
  const { keys, cast } = rosterCastLines(roster)

  const system = [
    'You are a university registrar building a course catalog and enrolling students.',
    'You return a single JSON object matching the provided schema exactly.',
    'Course codes follow real university convention: a subject prefix and a three-digit number, like "BIO 210".'
  ].join(' ')

  const preamble = [
    'Build a course catalog for a university, then enroll each student below.',
    '',
    'FOR EACH STUDENT',
    'major: the field she studies. Pick one that fits her personality. Reuse a major across students when it fits; a cast where everyone studies something different makes for a lonely campus.',
    'majorClassesTaken: how many classes she takes in her major, from 1 to 3.',
    'interestClass: one course this specific student would sign up for out of pure personal interest.',
    'It should read like something only she would pick.',
    '',
    'THE CATALOG',
    `Create ${PE_POOL_SIZE} physical education classes (category "pe").`,
    `Create ${FILLER_POOL_SIZE} humanities classes (category "humanities").`,
    `Create ${FILLER_POOL_SIZE} arts classes (category "arts").`,
    `Create ${FILLER_POOL_SIZE} miscellaneous classes (category "misc") that fit no other pool.`,
    `For every distinct major you assigned above, create ${CLASSES_PER_MAJOR} classes with category "major" and that major's exact name in the "major" field. Leave "major" out for every other category.`,
    '',
    'RULE: every "code" in the whole reply must be unique, including the interest classes.',
    'No two courses may share a code.',
    'Every course needs a one-sentence description written the way a real course catalog writes them.',
    '',
    'EVERY COURSE ALSO NEEDS A KIND',
    'kind "lecture": the class meets to be taught. The professor lectures, students take notes, and the course is assessed by a midterm and a final exam.',
    'kind "project": the class is built around producing work. Students spend the term making something, and the course is assessed by showcasing that work instead of by exams.',
    'Pick whichever genuinely fits the subject — a studio, a workshop or a design course is a project class; a survey, a theory or a history course is a lecture class.',
    'Physical education classes are neither, so answer "lecture" for those and it will be ignored.',
    '',
    '---',
    ''
  ].join('\n')

  // Below the '---' divider: the roster is all that varies, and the console log starts here.
  const rest = ['STUDENTS', ...cast].join('\n')

  const charSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['major', 'majorClassesTaken', 'interestClass'],
    properties: {
      major: { type: 'string' },
      majorClassesTaken: intField(1, 3),
      interestClass: courseSchema()
    }
  }

  const schema = objectSchema('class_schedule', ['characters', 'classes'], {
    characters: {
      type: 'object',
      additionalProperties: false,
      required: keys,
      properties: Object.fromEntries(keys.map((key) => [key, charSchema]))
    },
    classes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'name', 'description', 'kind', 'category'],
        properties: {
          ...(courseSchema().properties as Record<string, unknown>),
          category: { type: 'string', enum: [...GENERATED_CATEGORIES] },
          major: { type: 'string' }
        }
      }
    }
  })

  // The roster is in the prompt, so this caches only across retries of the same New Game.
  return {
    system,
    user: `${preamble}\n${rest}`,
    schema,
    cacheKey: 'venus-university-class-generation',
    logFrom: preamble.length + 1
  }
}

/** Thrown as an `AppError` when the reply cannot be scheduled. */
function invalid(detail: string): never {
  throw appError('CLASS_GEN_INVALID', 'The generated class catalog was not usable.', detail)
}

/**
 * Clamps into range, warning when the model ignored its own schema bounds.
 * Shared with the profile call.
 */
export function clamp(value: number, min: number, max: number, what: string): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) {
    console.warn(`[classes] ${what} was not a number; using ${min}.`)
    return min
  }
  const held = Math.min(max, Math.max(min, n))
  if (held !== n) console.warn(`[classes] ${what} was ${n}; clamped to ${held}.`)
  return held
}

/** Validates a reply and folds interest classes into the catalog. */
export function validateClassDraft(
  draft: ClassGenReply,
  roster: readonly Character[]
): ClassGenReply {
  const classes = draft.classes ?? []
  const seen = new Map<string, string>()

  const add = <T extends CourseDraft>(entry: T, origin: string): T => {
    const code = (entry?.code ?? '').trim()
    if (!code) invalid(`${origin} has a blank course code.`)
    const prior = seen.get(code)
    if (prior) invalid(`Course code "${code}" is used twice: ${prior} and ${origin}.`)
    seen.set(code, origin)
    return {
      ...entry,
      code,
      name: (entry.name ?? '').trim(),
      description: (entry.description ?? '').trim(),
      // A bad kind falls back to lecture.
      kind: classKindOf(entry.kind)
    }
  }

  const catalog: ClassDraft[] = classes.map((entry) =>
    add(entry, `catalog entry "${entry?.name ?? '?'}"`)
  )

  const majorsOffered = new Set(
    catalog.filter((c) => c.category === 'major' && c.major).map((c) => c.major as string)
  )

  const characters: Record<string, CharClassReply> = {}
  for (const character of roster) {
    const key = charKeyOf(character.firstName, character.lastName)
    const profile = draft.characters?.[key]
    if (!profile) invalid(`${fullNameOf(character)} was left unenrolled.`)

    const major = (profile.major ?? '').trim()
    if (!majorsOffered.has(major)) {
      invalid(`No classes were created for ${character.firstName}'s major, "${major}".`)
    }

    characters[key] = {
      major,
      // This call's own bound only; the cap against `classesTaken` is applied in `mergeProfiles`.
      majorClassesTaken: clamp(profile.majorClassesTaken, 1, 3, `${key} majorClassesTaken`),
      interestClass: profile.interestClass
    }

    catalog.push({
      ...add(profile.interestClass, `${key}'s interest class`),
      category: 'interest',
      owner: key
    })
  }

  return { characters, classes: catalog }
}

/**
 * Rolls each course's professor and difficulty, and each PE class's coach. The sentences those
 * rolls are worth are never written down: `description` stays the catalog blurb the model wrote,
 * and `fullDescriptionOf` speaks the rolls beside it when a prompt asks.
 */
export function decorateClasses<T extends { classes: ClassDraft[] }>(
  draft: T,
  lastNames: readonly string[] = LAST_NAMES,
  rand: () => number = Math.random
): Omit<T, 'classes'> & { classes: DecoratedClassDraft[] } {
  return {
    ...draft,
    classes: draft.classes.map((entry): DecoratedClassDraft => {
      if (entry.category === 'pe') {
        const { kind: _kind, ...rest } = entry
        return { ...rest, category: 'pe', instructor: rollProfessor(lastNames, rand) }
      }
      // Both rolled, in this order, for every course: the scheduler tests pin the dice.
      const professor = rollProfessor(lastNames, rand)
      const difficulty = rollDifficulty(rand)
      return {
        ...entry,
        category: entry.category,
        kind: classKindOf(entry.kind),
        professor,
        difficulty
      }
    })
  }
}

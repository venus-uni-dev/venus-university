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
import {
  CATALOG_POOLS,
  CLASSES_PER_MAJOR,
  POOL_SIZES,
  type CatalogEntry,
  type CatalogPool
} from '@shared/application'
import { freeClassCode } from '@shared/classes'
import type { DormId } from '@shared/dorms'
import { appError } from '@shared/errors'
import { genderOf, pronounTag } from '@shared/gender'
import { LAST_NAMES } from './characterSuggestions'
import { notesLines } from './scenePrompt'
import { foldGroup, objectSchema } from './schema'

/**
 * Builds and validates the class catalog's requests, one per pool, major and student; pure, no IO.
 * Each asks only for what nobody has decided: the classes its pool or major is still short of, or
 * the interest class of a student who has none written. A major's part and a student's are built
 * once every major is decided; a pool's never waits on them.
 */

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
  /** The player wrote this class, so the scheduler seats girls in it first. Never saved. */
  written?: true
}

/** A draft after `decorateClasses`: PE without a kind, every other course decorated. */
export type DecoratedClassDraft = (Omit<PeClassEntry, 'slot'> | Omit<CourseEntry, 'slot'>) & {
  owner?: string
  written?: true
}

/** The four fields every course carries, before we label it. */
type CourseDraft = Pick<ClassDraft, 'code' | 'name' | 'description' | 'kind'>

/** One character's catalog-side profile, decided or as this call returned it. */
interface CharClassReply {
  major: string
  interestClass: { code: string; name: string; description: string; kind?: ClassKind }
}

/** One character's academic profile, both calls' halves joined. */
interface CharClassDraft extends CharClassReply {
  majorClassesTaken: number
  year: number
  dorm: DormId
  classesTaken: number
}

/** One student's entry in the reply's array, her key beside the interest class asked of her. */
interface ClassCharacterReply extends Partial<Pick<CharClassReply, 'interestClass'>> {
  key: string
}

/** The validated catalog: each student's catalog-side profile by charKey, and the flat catalog. */
export interface ClassGenReply {
  characters: Record<string, CharClassReply>
  classes: ClassDraft[]
}

/** The reply as the model returns it, before any of it is trusted. */
export interface ClassReply {
  characters?: ClassCharacterReply[]
  classes?: ClassDraft[]
}

/** One student as the class call reads her: her major, and her interest class where it is written. */
export interface ClassStudent {
  character: Character
  /** Her major, decided before the call. */
  major: string
  /** Her interest class, whole; asked where absent. */
  interest?: CatalogEntry
}

/** The whole entries the player wrote, by pool and by major. */
export type FilledCatalog = Record<CatalogPool, readonly CatalogEntry[]> & {
  major: Readonly<Record<string, readonly CatalogEntry[]>>
}

/** Everything the class call is built from. */
export interface ClassPromptInput {
  /** The roster, in order. */
  students: readonly ClassStudent[]
  filled: FilledCatalog
  /** Every class an earlier semester of this timeline ran, which may not be run again. */
  taken?: readonly TakenClass[]
  setting: string
}

/** A catalog with no entries written. */
export const NO_FILLED_CATALOG: FilledCatalog = {
  pe: [],
  humanities: [],
  arts: [],
  misc: [],
  major: {}
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
    `${keys[index]} — ${fullNameOf(character)} (${pronounTag(genderOf(character))})`,
    character.personality,
    ''
  ])
  return { keys, cast }
}

/** What the call asks of one student, by field. */
function askedOf(student: ClassStudent): { interestClass: boolean } {
  return { interestClass: student.interest === undefined }
}

/** How many classes each pool, and each decided major, is still short of. */
export function shortfallOf(input: ClassPromptInput): {
  pools: Record<CatalogPool, number>
  majors: [string, number][]
} {
  const pools = Object.fromEntries(
    CATALOG_POOLS.map((pool) => [pool, Math.max(0, POOL_SIZES[pool] - input.filled[pool].length)])
  ) as Record<CatalogPool, number>
  const decided = [...new Set(input.students.flatMap((s) => (s.major ? [s.major] : [])))]
  const majors = decided.map(
    (major) =>
      [major, Math.max(0, CLASSES_PER_MAJOR - (input.filled.major[major]?.length ?? 0))] as [
        string,
        number
      ]
  )
  return { pools, majors }
}

/** What each pool is called in the prompt. */
const POOL_LINES: Record<CatalogPool, string> = {
  pe: 'physical education classes',
  humanities: 'humanities classes',
  arts: 'arts classes',
  misc: 'miscellaneous classes that fit none of physical education, the humanities or the arts'
}

/** A class an earlier semester ran, with the pool or major it ran in where the record says. */
export interface TakenClass {
  code: string
  name: string
  category?: ClassCategory
  major?: string
}

/**
 * One part of the catalog, asked on its own: a pool's shortfall, a major's, or one student's
 * interest class. A pool or a major sees only its own written classes and its own history.
 */
export type ClassAsk =
  | {
      kind: 'pool'
      pool: CatalogPool
      count: number
      written: readonly CatalogEntry[]
      taken: readonly TakenClass[]
    }
  | {
      kind: 'major'
      major: string
      count: number
      written: readonly CatalogEntry[]
      taken: readonly TakenClass[]
    }
  | { kind: 'interest'; student: ClassStudent; notes?: string }

/**
 * Every part a catalog asks: each pool short of classes, in pool order; each major short of
 * classes, by name; and each student without an interest class, in roster order. `notes` are the
 * player's on each student, by charKey; a pool's and a major's history is the part of `taken` the
 * record files under it.
 */
export function classAsksOf(
  input: ClassPromptInput,
  notes: Readonly<Record<string, string>> = {}
): ClassAsk[] {
  return [...poolAsksOf(input.filled, input.taken), ...majorAsksOf(input), ...interestAsksOf(input, notes)]
}

/** The pool parts a catalog asks, read off the written pools and the history alone. */
export function poolAsksOf(
  filled: Pick<FilledCatalog, CatalogPool>,
  taken: readonly TakenClass[] = []
): ClassAsk[] {
  return CATALOG_POOLS.flatMap((pool): ClassAsk[] => {
    const count = Math.max(0, POOL_SIZES[pool] - filled[pool].length)
    if (count === 0) return []
    return [
      {
        kind: 'pool',
        pool,
        count,
        written: filled[pool],
        taken: taken.filter((entry) => entry.category === pool)
      }
    ]
  })
}

/** The major parts a catalog asks, every major short of classes, sorted by name. */
function majorAsksOf(input: ClassPromptInput): ClassAsk[] {
  const taken = input.taken ?? []
  return shortfallOf(input)
    .majors.filter(([, count]) => count > 0)
    // Code-unit order, never the locale's, so the parts read the same on every machine.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([major, count]) => ({
      kind: 'major',
      major,
      count,
      written: input.filled.major[major] ?? [],
      taken: taken.filter((entry) => entry.category === 'major' && entry.major === major)
    }))
}

/** The interest parts a catalog asks, one per student without one written. */
function interestAsksOf(
  input: ClassPromptInput,
  notes: Readonly<Record<string, string>>
): ClassAsk[] {
  return input.students.flatMap((student): ClassAsk[] => {
    if (!askedOf(student).interestClass) return []
    const key = charKeyOf(student.character.firstName, student.character.lastName)
    return [{ kind: 'interest', student, ...(notes[key] ? { notes: notes[key] } : {}) }]
  })
}

/** Lecture or project, asked of every course but PE. */
const KIND_LINES = [
  'EVERY COURSE ALSO NEEDS A KIND',
  'kind "lecture": the class meets to be taught. The professor lectures, students take notes, and the course is assessed by a midterm and a final exam.',
  'kind "project": the class is built around producing work. Students spend the term making something, and the course is assessed by showcasing that work instead of by exams.',
  'Pick whichever genuinely fits the subject — a studio, a workshop or a design course is a project class; a survey, a theory or a history course is a lecture class.'
]

/** How every course is described. */
const DESCRIPTION_LINE =
  'Every course needs a one-sentence description written the way a real course catalog writes them.'

/** The shape of one course, without a kind for PE. */
function partCourseSchema(kind: boolean): Record<string, unknown> {
  const schema = courseSchema()
  if (kind) return schema
  const { kind: _kind, ...properties } = schema.properties as Record<string, unknown>
  return { ...schema, required: ['code', 'name', 'description'], properties }
}

/** Builds one part's request. */
export function buildClassPartPrompt(ask: ClassAsk, setting: string): StructuredRequest {
  const system = [
    'You are a university registrar building a course catalog.',
    'You return a single JSON object matching the provided schema exactly.',
    'Course codes follow real university convention: a subject prefix and a three-digit number, like "BIO 210".',
    '',
    'SETTING',
    setting
  ].join('\n')

  if (ask.kind === 'interest') {
    const { student } = ask
    const preamble = [
      'interestClass: one course this specific student would sign up for out of pure personal interest.',
      'It should read like something only they would pick.',
      DESCRIPTION_LINE,
      '',
      ...KIND_LINES,
      '---',
      ''
    ].join('\n')
    const { cast } = rosterCastLines([student.character])
    const rest = [
      'STUDENT',
      cast[0],
      `Majoring in ${student.major}.`,
      cast[1],
      ...(student.character.likes.length > 0
        ? [`Likes: ${student.character.likes.join(', ')}`]
        : []),
      ...notesLines(student.character.firstName, ask.notes)
    ].join('\n')
    return {
      system,
      user: `${preamble}\n${rest}`,
      schema: objectSchema('interest_class', ['interestClass'], { interestClass: courseSchema() }),
      cacheKey: 'venus-university-interest-class-generation',
      logFrom: preamble.length + 1
    }
  }

  const kind = !(ask.kind === 'pool' && ask.pool === 'pe')
  const preamble = [
    ask.kind === 'pool'
      ? `Create ${ask.count} ${POOL_LINES[ask.pool]}.`
      : `Create ${ask.count} classes for the ${ask.major} major.`,
    'No two of them may share a code.',
    ...(ask.taken.length > 0
      ? [
          'Classes listed under ALREADY TAKEN ran in earlier semesters: never reuse one of their codes, and never recreate one of them under another code.'
        ]
      : []),
    ...(ask.written.length > 0
      ? [
          'Classes listed under ALREADY IN THE CATALOG are written already: never reuse one of their codes, and never write one of them again under another code.'
        ]
      : []),
    DESCRIPTION_LINE,
    ...(kind ? ['', ...KIND_LINES] : []),
    '---',
    ''
  ].join('\n')

  // Below the '---' divider: what is written and what ran are all that varies.
  const rest = [
    ...(ask.taken.length > 0
      ? ['ALREADY TAKEN', ...ask.taken.map((entry) => `${entry.code} — ${entry.name}`), '']
      : []),
    ...(ask.written.length > 0
      ? ['ALREADY IN THE CATALOG', ...ask.written.map((entry) => `${entry.code} — ${entry.title}`), '']
      : [])
  ].join('\n')

  return {
    system,
    user: `${preamble}\n${rest}`,
    schema: objectSchema(ask.kind === 'pool' ? 'pool_classes' : 'major_classes', ['classes'], {
      classes: { type: 'array', items: partCourseSchema(kind) }
    }),
    cacheKey: `venus-university-${ask.kind}-class-generation`,
    logFrom: preamble.length + 1
  }
}

/** One part's reply as the model returns it. */
interface ClassPartReply {
  classes?: unknown
  interestClass?: unknown
}

/** A course as a reply holds it, or null where it is no object. */
function courseOf(raw: unknown): CourseDraft | null {
  return typeof raw === 'object' && raw !== null ? (raw as CourseDraft) : null
}

/** The courses of a pool's or a major's reply, every one an object. */
function partCourses(reply: unknown): CourseDraft[] {
  const list = (reply as ClassPartReply | undefined)?.classes
  return (Array.isArray(list) ? list : []).flatMap((raw) => {
    const course = courseOf(raw)
    return course ? [course] : []
  })
}

/**
 * Refuses a part's reply that cannot be used: a pool or major given no class, any class with a
 * blank code, or a student given no interest class.
 */
export function validateClassPart(ask: ClassAsk, reply: unknown): void {
  if (ask.kind === 'interest') {
    const course = courseOf((reply as ClassPartReply | undefined)?.interestClass)
    if (!course || !(course.code ?? '').trim()) {
      invalid(`${fullNameOf(ask.student.character)} was left unenrolled.`)
    }
    return
  }
  const courses = partCourses(reply)
  const what = ask.kind === 'pool' ? `the ${ask.pool} pool` : `the ${ask.major} major`
  if (courses.length === 0) invalid(`No classes were created for ${what}.`)
  for (const course of courses) {
    if (!(course.code ?? '').trim()) invalid(`A class for ${what} has a blank course code.`)
  }
}

/** The parts' replies, in the order they were asked, as one catalog reply. */
export function classReplyOf(parts: readonly { ask: ClassAsk; reply: unknown }[]): ClassReply {
  const characters: ClassCharacterReply[] = []
  const classes: ClassDraft[] = []
  for (const { ask, reply } of parts) {
    if (ask.kind === 'interest') {
      const course = courseOf((reply as ClassPartReply | undefined)?.interestClass)
      const key = charKeyOf(ask.student.character.firstName, ask.student.character.lastName)
      if (course) characters.push({ key, interestClass: course as CharClassReply['interestClass'] })
      continue
    }
    for (const course of partCourses(reply)) {
      classes.push(
        ask.kind === 'pool'
          ? { ...unmarked(course), category: ask.pool }
          : { ...unmarked(course), category: 'major', major: ask.major }
      )
    }
  }
  return { characters, classes }
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

/** A whole entry the player wrote, as the model would have returned it. */
function courseDraftOf(entry: CatalogEntry): CourseDraft {
  return {
    code: entry.code,
    name: entry.title,
    description: entry.description,
    ...(entry.kind ? { kind: entry.kind } : {})
  }
}

/** A reply's entry less the marks only validation sets, which a custom endpoint may still send. */
function unmarked<T extends CourseDraft>(entry: T | undefined): T {
  if (typeof entry !== 'object' || entry === null) return {} as T
  const marked = entry as T & Pick<ClassDraft, 'owner' | 'written'>
  const { owner: _owner, written: _written, ...rest } = marked
  return rest as T
}

/**
 * Validates a reply (absent where nothing was asked) into the catalog: the player's entries
 * first, marked written, then the model's, a code used twice renumbered on the later one — every
 * code an earlier semester ran counting as used — and every student's interest class folded in.
 * A student's decided major and interest class stand over whatever the reply says of them.
 */
export function validateClassDraft(
  reply: ClassReply | undefined,
  input: Pick<ClassPromptInput, 'students' | 'filled' | 'taken'> & {
    /** Major classes may belong to no major, and a major with none of its own is no refusal. */
    openMajors?: boolean
  }
): ClassGenReply {
  const seen = new Map<string, string>()
  for (const entry of input.taken ?? []) seen.set(entry.code, 'an earlier semester')

  const add = <T extends CourseDraft>(entry: T, origin: string): T => {
    let code = (entry?.code ?? '').trim()
    if (!code) invalid(`${origin} has a blank course code.`)
    const prior = seen.get(code)
    if (prior) {
      const renumbered = freeClassCode(code, (c) => seen.has(c))
      console.warn(
        `[classes] Course code "${code}" is used twice: ${prior} and ${origin}; ${origin} is now "${renumbered}".`
      )
      code = renumbered
    }
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

  // The player's own codes are taken first, so a reply repeating one is the one renumbered.
  const catalog: ClassDraft[] = []
  for (const pool of CATALOG_POOLS) {
    for (const entry of input.filled[pool]) {
      catalog.push({
        ...add(courseDraftOf(entry), `your ${pool} class "${entry.title}"`),
        category: pool,
        written: true
      })
    }
  }
  for (const [major, entries] of Object.entries(input.filled.major)) {
    for (const entry of entries) {
      catalog.push({
        ...add(courseDraftOf(entry), `your ${major} class "${entry.title}"`),
        category: 'major',
        major,
        written: true
      })
    }
  }
  const interests = new Map<string, CourseDraft>()
  for (const student of input.students) {
    if (!student.interest) continue
    const key = charKeyOf(student.character.firstName, student.character.lastName)
    interests.set(key, add(courseDraftOf(student.interest), `${key}'s interest class`))
  }

  for (const entry of reply?.classes ?? []) {
    catalog.push(add(unmarked(entry), `catalog entry "${entry?.name ?? '?'}"`))
  }

  const majorsOffered = new Set(
    catalog.filter((c) => c.category === 'major' && c.major).map((c) => c.major as string)
  )

  const folded = foldGroup<ClassCharacterReply>(
    reply?.characters,
    new Set(
      input.students.flatMap((student) =>
        askedOf(student).interestClass
          ? [charKeyOf(student.character.firstName, student.character.lastName)]
          : []
      )
    ),
    'characters',
    'classes'
  )
  const characters: Record<string, CharClassReply> = {}
  for (const student of input.students) {
    const { character } = student
    const key = charKeyOf(character.firstName, character.lastName)
    const profile = folded[key]
    if (askedOf(student).interestClass && !profile) {
      invalid(`${fullNameOf(character)} was left unenrolled.`)
    }

    const major = student.major.trim()
    if (!input.openMajors && !majorsOffered.has(major)) {
      invalid(`No classes were created for ${character.firstName}'s major, "${major}".`)
    }

    const own = interests.get(key)
    const interest =
      own ?? add(unmarked(profile?.interestClass as CourseDraft), `${key}'s interest class`)
    characters[key] = {
      major,
      interestClass: interest
    }
    catalog.push({
      ...interest,
      category: 'interest',
      owner: key,
      ...(own ? { written: true as const } : {})
    })
  }

  return { characters, classes: catalog }
}

/** The catalog dealt for a skipped class call, as the call would have answered it. */
export interface DealtClasses {
  pools: Record<CatalogPool, CatalogEntry[]>
  /** Major classes of no major in particular, which any girl's major load may take. */
  open: CatalogEntry[]
  /** Each girl's interest class, by charKey. */
  interest: Record<string, CatalogEntry>
}

/**
 * A dealt catalog in the reply's own shape, for {@link validateClassDraft} with `openMajors`:
 * each pool's entries under its category, the open ones as major classes of no major, and an
 * interest class for every student without one of her own.
 */
export function dealtClassReply(dealt: DealtClasses, students: readonly ClassStudent[]): ClassReply {
  const characters: ClassCharacterReply[] = []
  for (const student of students) {
    if (student.interest) continue
    const key = charKeyOf(student.character.firstName, student.character.lastName)
    const interest = dealt.interest[key]
    if (interest) characters.push({ key, interestClass: courseDraftOf(interest) })
  }
  return {
    characters,
    classes: [
      ...CATALOG_POOLS.flatMap((pool) =>
        dealt.pools[pool].map((entry): ClassDraft => ({ ...courseDraftOf(entry), category: pool }))
      ),
      ...dealt.open.map((entry): ClassDraft => ({ ...courseDraftOf(entry), category: 'major' }))
    ]
  }
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

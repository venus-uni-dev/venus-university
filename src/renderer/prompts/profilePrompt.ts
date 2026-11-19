import {
  charKeyOf,
  fullNameOf,
  type Character,
  type FeedAssignment,
  type HiddenScheduleAssignment,
  type JobAssignment,
  type Season,
  type StructuredRequest
} from '@shared/types'
import {
  PROFILE_FIELDS,
  profileFieldDecided,
  yearFloorOf,
  type DecidedProfile,
  type ProfileField
} from '@shared/application'
import { DORM_IDS, FALLBACK_DORM, isDorm, type DormId } from '@shared/dorms'
import { JOB_CATALOG, jobDefOf, type JobDef } from '@shared/jobs'
import {
  ACTIVITY_LOCATIONS,
  FUN_LOCATIONS,
  MEAL_LOCATIONS,
  STUDY_LOCATIONS,
  locationForKey,
  locationLabel,
  locationMenuLines
} from '@shared/locations'
import { fallbackHandleOf } from '@shared/feed'
import { pronounsOf } from '@shared/gender'
import { appError } from '@shared/errors'
import {
  clamp,
  intField,
  rosterCastLines,
  type ClassGenDraft,
  type ClassGenReply
} from './classPrompt'
import { keyPattern, loreEntryById } from './lorebook'
import { notesLines } from './scenePrompt'
import { foldGroup, keyedArray, objectSchema } from './schema'
import {
  SECRETS_ROLE,
  secretEntryLines,
  secretFields,
  secretLines,
  type SecretsEntry
} from './secretsPrompt'

/**
 * Builds and validates New Game's student requests — the roster's majors, then one per student —
 * and the profiles they come to; pure, no IO.
 */

/** How many shifts a working character may be given. */
const MAX_NPC_SHIFTS = 2

/** How many evenings a week a character may be asked to stay in. */
const MIN_HOME_SLOTS = 1
const MAX_HOME_SLOTS = 3

/** How many places she may go out to for fun. */
const MAX_FUN_LOCATIONS = 2

/** One character's profile as the model returns it. */
interface CharProfileDraft {
  year: number
  classesTaken: number
  /** Where she lives on campus — a {@link DormId}. */
  dorm: DormId
  /** A `JobDef.id`, or `''` for a character who holds no job. */
  job: string
  /** How many weekly shifts she works; 0 whenever `job` is blank. */
  jobShifts: number
  /** How many slots a week she spends in her own room. */
  homeSlots: number
  /** A `STUDY_LOCATIONS` key, or `''` for a character who studies in her room. */
  study: string
  /** Up to {@link MAX_FUN_LOCATIONS} `FUN_LOCATIONS` keys; empty for a homebody. */
  fun: string[]
  /** The weekly interest in her own words — "sketching at the Whitman Greenhouse" — or `''`. */
  activity: string
  /** The `ACTIVITY_LOCATIONS` key {@link activity} happens at, or `''` when it is blank. */
  activityLocation: string
  /** A `MEAL_LOCATIONS` key, or `''` for a character who eats in. */
  meal: string
  /** Her social handle, repaired to `fallbackHandleOf` when unusable. */
  handle: string
  /** What she posted over the winter break, nought to {@link MAX_WINTER_POSTS}; upperclassmen only. */
  winterPosts: string[]
  /** What she does with spring break, as one short phrase; whether she goes is the save's to settle. */
  springBreakPlans: string
  /** The field she studies. */
  major?: string
  /** How many of her classes are in her major; asked beside {@link major}. */
  majorClassesTaken?: number
}

/** The most winter-break posts one character may arrive with. */
const MAX_WINTER_POSTS = 3

/** The validated shape every consumer reads: profiles keyed by charKey. */
export interface ProfileGenDraft {
  characters: Record<string, CharProfileDraft>
}

/** The whole reply as the model returns it: one record per student, each naming its charKey. */
export interface ProfileGenReply {
  characters: Array<CharProfileDraft & { key: string }>
}

/** A handle as it will be printed, or `''` when nothing is salvageable: strips a leading `@` and anything outside the prompt's character set. */
export function normalizeHandle(raw: string): string {
  const stripped = raw.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9._]/g, '')
  return /[a-z]/.test(stripped) ? stripped : ''
}

/**
 * Her activity phrase as it will be printed: no trailing full stop, and opening lowercase unless
 * its first word carries a capital of its own, which makes it a name or an acronym like "DJing".
 */
export function normalizeActivity(raw: unknown): string {
  const text = (typeof raw === 'string' ? raw : '').trim().replace(/\.+$/, '').trim()
  if (text === '') return ''
  const first = text.split(/\s+/)[0]
  return /[A-Z]/.test(first.slice(1)) ? text : text[0].toLowerCase() + text.slice(1)
}

/** Whether a phrase already says where it happens, by the lorebook keys of the place it names. */
function namesLocation(phrase: string, locationId: string): boolean {
  const keys = loreEntryById(locationId)?.keys ?? []
  if (keys.length === 0) return false
  return new RegExp(keys.map((key) => keyPattern(key)).join('|'), 'iu').test(phrase)
}

/**
 * Her activity phrase as it is printed at the place it happens, which it stands in for there:
 * normalized, and with the place appended where the phrase never says it.
 */
export function activityPhraseAt(raw: unknown, locationId: string): string {
  const phrase = normalizeActivity(raw)
  if (phrase === '' || namesLocation(phrase, locationId)) return phrase
  return `${phrase} at ${locationLabel(locationId)}`
}

/** Thrown as an `AppError` when the reply cannot be used. */
function invalid(detail: string): never {
  throw appError('PROFILE_GEN_INVALID', 'The generated student profiles were not usable.', detail)
}

/** Who the profile calls are written by, and the world the students live in. */
function profileSystem(setting: string): string {
  return [
    [
      'You are a university student affairs office profiling enrolled students.',
      'You return a single JSON object matching the provided schema exactly.'
    ].join(' '),
    '',
    'SETTING',
    setting
  ].join('\n')
}

/** How many classes she takes, asked of every student the call profiles in full. */
const CLASSES_TAKEN_LINES = [
  'classesTaken: how many classes they take. The vast majority of students take 4.',
  'Give 3 only to a genuine slacker, and 5 or 6 only to a genuine overachiever.'
]

/**
 * The employers as the profile prompt lists them: the catalog's order with the library last, the
 * job a student weighed alone reaches for first.
 */
const PROMPT_EMPLOYERS: readonly JobDef[] = [
  ...JOB_CATALOG.filter((def) => def.id !== 'kendall_library'),
  ...JOB_CATALOG.filter((def) => def.id === 'kendall_library')
]

/** Her job, and the employers she may hold one at. */
function workLines(): string[] {
  const menu = PROMPT_EMPLOYERS.map((def) => `${def.id} — ${def.employer}, ${def.title}: ${def.blurb}`)
  return [
    'PART-TIME WORK',
    'If the student works a part-time job, you can describe it as follows:',
    'job: the id of the employer they work for, exactly as written below. Only give a student a job if it would make sense for them to sign up for one; otherwise leave it empty.',
    `jobShifts: how many shifts a week they work, 1 or ${MAX_NPC_SHIFTS} when they have a job, and 0 when they do not.`,
    '',
    'EMPLOYERS',
    ...menu,
    ''
  ]
}


/** How her handle is asked for. */
const HANDLE_LINE =
  'handle: the username they post under. some examples: "GinaHayes", "gina.hayes", "ginahayes12", "gina_says_hay", "gina_hayes", "ghayes", "gina.h".'

/** How the posts she made over a break are asked for, `field` being the field that holds them. */
function breakPostsLine(field: string, breakName: string): string {
  return `${field}: nought to ${MAX_WINTER_POSTS} short status updates they posted over the ${breakName}, oldest first. Keep these casual, using lowercase and/or emoji if it suits the student. Don't address them to anyone, like other students or the reader.`
}

/** How her spring break plans are asked for. */
const SPRING_BREAK_LINES = [
  'SPRING BREAK',
  'springBreakPlans: what they do with the week off in March, as one short phrase in the infinitive, ending in a full stop: "Go home to Russia to see family.", "Drive down to an aunt\'s place on the coast with a roommate."',
  'All plans must include leaving campus and don\'t include other students or the reader.'
]

/**
 * How a decided value is said to the model: the field and the value, as the reply would hold
 * them, after `lead`.
 */
function decidedLine(
  decided: Readonly<Record<string, unknown>>,
  lead = 'Already decided, to be answered exactly as written'
): string | null {
  const fields = Object.entries(decided).filter(([, value]) => value !== undefined)
  if (fields.length === 0) return null
  return `${lead}: ${fields
    .map(([field, value]) => `${field}: ${JSON.stringify(value)}`)
    .join('; ')}.`
}

/** How her major is asked for. */
const MAJOR_LINE =
  'major: the field they study. Pick one that fits their personality. Collapse similar majors like Business Studies and Business Science into a single major like Business Administration.'

/** The line naming the majors other students already hold, or nothing where there are none. */
function otherMajorsLines(otherMajors: readonly string[]): string[] {
  if (otherMajors.length === 0) return []
  return [
    `Other students already major in ${[...otherMajors].sort().join(', ')}; a student below may share one of them where it fits them.`,
    ''
  ]
}

/** Everything New Game's majors call is built from. */
export interface MajorPromptInput {
  /** The new girls whose major is left to generate, in roster order. */
  students: readonly Character[]
  /** The majors already held: returning girls', then the ones the player typed. */
  otherMajors: readonly string[]
  /** The player's notes on whoever the call names, by charKey; a girl with none is absent. */
  notes?: Readonly<Record<string, string>>
  setting: string
}

/** Builds the majors request, or null when nobody is left without one. */
export function buildMajorPrompt(input: MajorPromptInput): StructuredRequest | null {
  if (input.students.length === 0) return null
  const { keys, cast } = rosterCastLines(input.students)
  const notes = input.notes ?? {}
  const preamble = ['FOR EACH STUDENT', MAJOR_LINE, '---', ''].join('\n')

  // Below the '---' divider: the roster is all that varies, and the console log starts here.
  const rest = [
    'characters holds one entry per student below, its key exactly as written before their name, in the order listed.',
    '',
    ...otherMajorsLines(input.otherMajors),
    'STUDENTS',
    ...input.students.flatMap((student, index) => [
      ...cast.slice(index * 3, index * 3 + 2),
      ...notesLines(student.firstName, notes[keys[index]]),
      ''
    ])
  ].join('\n')

  return {
    system: profileSystem(input.setting),
    user: `${preamble}\n${rest}`,
    schema: objectSchema('student_majors', ['characters'], {
      characters: keyedArray(keys, { major: { type: 'string' } })
    }),
    cacheKey: 'venus-university-major-generation',
    logFrom: preamble.length + 1
  }
}

/** Validates the majors reply into each girl's major by charKey, refusing a girl left without one. */
export function validateMajorDraft(
  reply: unknown,
  students: readonly Character[]
): Record<string, string> {
  const keys = students.map((c) => charKeyOf(c.firstName, c.lastName))
  const folded = foldGroup<{ key: string; major?: unknown }>(
    (reply as { characters?: unknown } | undefined)?.characters,
    new Set(keys),
    'characters'
  )
  const majors: Record<string, string> = {}
  students.forEach((character, index) => {
    const raw = folded[keys[index]]?.major
    const major = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
    if (major === '') invalid(`${fullNameOf(character)} was given no major.`)
    majors[keys[index]] = major
  })
  return majors
}

/** The fields of the reply each profile field is answered in. */
const REPLY_FIELDS: Record<Exclude<ProfileField, 'major'>, readonly string[]> = {
  year: ['year'],
  classesTaken: ['classesTaken'],
  majorClassesTaken: ['majorClassesTaken'],
  job: ['job', 'jobShifts'],
  dorm: ['dorm'],
  homeSlots: ['homeSlots'],
  study: ['study'],
  fun: ['fun'],
  activity: ['activity', 'activityLocation'],
  meal: ['meal'],
  handle: ['handle'],
  breakPosts: ['winterPosts'],
  springBreakPlans: ['springBreakPlans']
}

/** The places a student goes by habit, as the profile fields that hold them. */
const HAUNT_FIELDS = ['homeSlots', 'study', 'fun', 'activity', 'meal'] as const

/** What a Lowrise is answered as: which one she lives in is dealt. */
const LOWRISE = 'lowrise'

/** Her free time: the lines of the habits asked, and the menus they are picked from. */
function hauntLines(asked: ReadonlySet<ProfileField>): string[] {
  if (!HAUNT_FIELDS.some((field) => asked.has(field))) return []
  const menu = (field: ProfileField, heading: string, locations: Readonly<Record<string, string>>) =>
    asked.has(field) ? ['', heading, ...locationMenuLines(locations)] : []
  return [
    'WHERE THEY SPEND THEIR FREE TIME',
    'Decide some places where they go by habit. Answer with the keys below, exactly as written:',
    ...(asked.has('homeSlots')
      ? [`homeSlots: how many times a week they stay in their own room, ${MIN_HOME_SLOTS} to ${MAX_HOME_SLOTS}.`]
      : []),
    ...(asked.has('study')
      ? ['study: where they go to study, or an empty string if they study in their own room.']
      : []),
    ...(asked.has('fun')
      ? [
          `fun: 0 to ${MAX_FUN_LOCATIONS} places they go out to enjoy themselves. Leave it empty for somebody who does not go out.`
        ]
      : []),
    ...(asked.has('activity')
      ? [
          'activity: a specific interest of theirs that they pursue somewhere every week, as one short lowercase phrase starting with an -ing verb that names both what they do and where they do it: "sketching at the Whitman Greenhouse", "jogging at Green Hill Park", "practicing cello in the practice rooms under Thorne Auditorium". It has to be something they do over and over, not a one-off, and it must happen at one of the ACTIVITY LOCATIONS. An empty string for a student with no such interest, which is most of them.',
          'activityLocation: the key of the place activity names, exactly as written below. An empty string when activity is empty.'
        ]
      : []),
    ...(asked.has('meal')
      ? [
          'meal: one place they eat out at, about once a week. An empty string for somebody who cooks for themselves or eats in the dorm kitchens.'
        ]
      : []),
    ...menu('study', 'STUDY LOCATIONS', STUDY_LOCATIONS),
    ...menu('fun', 'FUN LOCATIONS', FUN_LOCATIONS),
    ...menu('meal', 'MEAL LOCATIONS', MEAL_LOCATIONS),
    ...menu('activity', 'ACTIVITY LOCATIONS', ACTIVITY_LOCATIONS),
    ''
  ]
}

/** The rules of each profile field asked of one student, and only those. */
function profileLines(asked: ReadonlySet<ProfileField>, decided: boolean): string[] {
  const has = (field: ProfileField): boolean => asked.has(field)
  const academics = [
    ...(has('year') ? ['year: 1 = Freshman, 2 = Sophomore, 3 = Junior, 4 = Senior.'] : []),
    ...(has('classesTaken') ? CLASSES_TAKEN_LINES : []),
    ...(has('majorClassesTaken')
      ? ['majorClassesTaken: how many of those classes are in their major, from 1 to 3.']
      : [])
  ]
  const social = [
    ...(has('handle') ? [HANDLE_LINE] : []),
    ...(has('breakPosts')
      ? [
          breakPostsLine('winterPosts', 'winter break'),
          'First-year students get no posts, leave the array empty. Everyone else gets at least one.'
        ]
      : [])
  ]
  return [
    'FOR THIS STUDENT',
    ...(academics.length > 0 ? [...academics, ''] : []),
    ...(has('job') ? workLines() : []),
    ...(has('dorm')
      ? [
          'HOUSING',
          `dorm: where they live on campus. ${LOWRISE} is the Lowrises, the ordinary apartment-style dorms that house the bulk of students; elysium is Elysium Village, the coveted upperclassman townhouses claimed through a housing lottery.`,
          ''
        ]
      : []),
    ...hauntLines(asked),
    ...(social.length > 0 ? ['SOCIAL MEDIA', ...social, ''] : []),
    ...(has('springBreakPlans') ? [...SPRING_BREAK_LINES, ''] : []),
    ...(decided
      ? [
          'DECIDED FIELDS',
          'Some of their fields are already decided, written under their name. Fit the rest of the profile around them.'
        ]
      : [])
  ]
}

/** The schema of each profile field asked of one student, in the order she is answered in. */
function profileProperties(asked: ReadonlySet<ProfileField>): Record<string, unknown> {
  const all: Record<string, unknown> = {
    year: intField(1, 4),
    classesTaken: intField(3, 6),
    majorClassesTaken: intField(1, 3),
    dorm: { type: 'string', enum: [LOWRISE, 'elysium'] },
    // Closed: the employer list is code, identical in every save, in the menu's order.
    job: { type: 'string', enum: ['', ...PROMPT_EMPLOYERS.map((def) => def.id)] },
    jobShifts: intField(0, MAX_NPC_SHIFTS),
    homeSlots: intField(MIN_HOME_SLOTS, MAX_HOME_SLOTS),
    // Closed for `job`'s reason; `''` is legal in the two optional ones and is the ordinary answer.
    study: { type: 'string', enum: ['', ...Object.keys(STUDY_LOCATIONS)] },
    fun: {
      type: 'array',
      maxItems: MAX_FUN_LOCATIONS,
      items: { type: 'string', enum: [...Object.keys(FUN_LOCATIONS)] }
    },
    // Her own phrase, unlike the closed menus: the place it happens at rides `activityLocation`.
    activity: { type: 'string' },
    handle: { type: 'string' },
    winterPosts: { type: 'array', maxItems: MAX_WINTER_POSTS, items: { type: 'string' } },
    springBreakPlans: { type: 'string' },
    activityLocation: { type: 'string', enum: ['', ...Object.keys(ACTIVITY_LOCATIONS)] },
    meal: { type: 'string', enum: ['', ...Object.keys(MEAL_LOCATIONS)] }
  }
  const wanted = new Set(
    [...asked].flatMap((field) => (field === 'major' ? [] : REPLY_FIELDS[field]))
  )
  return Object.fromEntries(Object.entries(all).filter(([field]) => wanted.has(field)))
}

/** The system prompt of a call writing her profile, her secrets, or both. */
function studentSystem(setting: string, profile: boolean, secrets: boolean): string {
  if (profile && !secrets) return profileSystem(setting)
  const role =
    profile && secrets
      ? 'You are a novelist writing up one student of a story set at a university: their student affairs profile and the secrets they keep.'
      : SECRETS_ROLE
  return [`${role} You return a single JSON object matching the provided schema exactly.`, '', 'SETTING', setting].join(
    '\n'
  )
}

/** What a student's secrets may not touch, where the same reply writes more of her. */
const BESIDE = 'anything asked of them above'

/** Her block where no secret is asked: who she is, what is decided of her, and the player's notes. */
function studentLines(character: Character, decided: string | null, notes?: string): string[] {
  const { cast } = rosterCastLines([character])
  return [
    cast[0],
    ...(decided ? [decided] : []),
    character.personality,
    ...(character.backstory.trim() ? [`Backstory: ${character.backstory.trim()}`] : []),
    ...(character.likes.length > 0 ? [`Likes: ${character.likes.join(', ')}`] : []),
    ...(character.dislikes.length > 0 ? [`Dislikes: ${character.dislikes.join(', ')}`] : []),
    ...notesLines(character.firstName, notes)
  ]
}

/** One new girl the student call writes for: the fields and secrets left to her. */
export interface StudentPromptInput {
  character: Character
  /** Her decided fields in the reply's own vocabulary, her major among them. */
  decided: Partial<CharProfileDraft>
  /** The profile fields asked of her, never her major, which the majors call writes. */
  fields: readonly ProfileField[]
  /** Her secrets, where any tier is asked. */
  secrets?: SecretsEntry
  /** The player's notes on her. */
  notes?: string
  setting: string
}

/**
 * Builds one new girl's request: every profile field she left blank but her major, and every
 * secret tier she left blank, written in one reply; null when nothing is left.
 */
export function buildStudentPrompt(input: StudentPromptInput): StructuredRequest | null {
  const asked = new Set(input.fields.filter((field) => field !== 'major'))
  const secrets = input.secrets && input.secrets.tiers.length > 0 ? input.secrets : undefined
  const profile = asked.size > 0
  if (!profile && !secrets) return null
  // Her decided fields are not in the schema: the model only reads them.
  const decided = decidedLine(input.decided, 'Already decided')

  const preamble = [
    ...(profile ? profileLines(asked, decided !== null) : []),
    ...(profile && secrets ? [''] : []),
    ...(secrets ? secretLines(secrets.tiers, profile ? BESIDE : undefined) : []),
    '---',
    ''
  ].join('\n')

  // Below the '---' divider: she is all that varies, and the console log starts here.
  const rest = [
    'STUDENT',
    ...(secrets
      ? secretEntryLines(secrets, decided)
      : studentLines(input.character, decided, input.notes))
  ].join('\n')

  const properties = {
    ...(profile ? profileProperties(asked) : {}),
    ...(secrets ? secretFields(secrets.tiers) : {})
  }
  return {
    system: studentSystem(input.setting, profile, secrets !== undefined),
    user: `${preamble}\n${rest}`,
    schema: objectSchema('student_profile', Object.keys(properties), properties),
    cacheKey: 'venus-university-student-generation',
    logFrom: preamble.length + 1
  }
}

/** One returning girl the next semester's call writes for: her break, and any secret she is owed. */
export interface ReturningPromptInput {
  character: Character
  season: Season
  secrets?: SecretsEntry
  notes?: string
  setting: string
}

/** Builds one returning girl's request: her posts over the break, her plans before a spring, her new secrets. */
export function buildReturningPrompt(input: ReturningPromptInput): StructuredRequest {
  const spring = input.season === 'spring'
  const secrets = input.secrets && input.secrets.tiers.length > 0 ? input.secrets : undefined
  const preamble = [
    'FOR THIS RETURNING STUDENT',
    breakPostsLine('breakPosts', breakNameOf(input.season)),
    'They get at least one.',
    ...(spring ? [SPRING_BREAK_LINES[1], SPRING_BREAK_LINES[2]] : []),
    ...(secrets ? ['', ...secretLines(secrets.tiers, BESIDE)] : []),
    '---',
    ''
  ].join('\n')
  const { cast } = rosterCastLines([input.character])
  const rest = [
    'RETURNING STUDENT',
    ...(secrets
      ? secretEntryLines(secrets)
      : [...cast.slice(0, 2), ...notesLines(input.character.firstName, input.notes)])
  ].join('\n')
  const properties = {
    breakPosts: { type: 'array', maxItems: MAX_WINTER_POSTS, items: { type: 'string' } },
    ...(spring ? { springBreakPlans: { type: 'string' } } : {}),
    ...(secrets ? secretFields(secrets.tiers) : {})
  }
  return {
    system: studentSystem(input.setting, true, secrets !== undefined),
    user: `${preamble}\n${rest}`,
    schema: objectSchema('returning_student', Object.keys(properties), properties),
    cacheKey: `venus-university-returning-generation-${input.season}`,
    logFrom: preamble.length + 1
  }
}

/** One graduate the next semester's call writes for. */
export interface GraduatePromptInput {
  graduate: GraduateBrief
  season: Season
  notes?: string
  setting: string
}

/** Builds one graduate's request: her life since, and her posts over the break. */
export function buildGraduatePrompt(input: GraduatePromptInput): StructuredRequest {
  const { graduate } = input
  const preamble = [
    'FOR THIS GRADUATE',
    ...GRADUATE_LINES,
    breakPostsLine('breakPosts', breakNameOf(input.season)),
    'They get at least one.',
    ...(graduate.decided
      ? [
          'Their pursuing may already be decided, written under their name. Answer it exactly as written, and fit their posts around it.'
        ]
      : []),
    '---',
    ''
  ].join('\n')
  const { cast } = rosterCastLines([graduate.character])
  const decided = graduate.decided ? decidedLine({ pursuing: graduate.decided }) : null
  const rest = [
    'GRADUATE',
    cast[0],
    `Majored in ${graduate.major}.`,
    ...(graduate.pursuing
      ? [`Last semester ${pronounsOf(graduate.character).they} was ${graduate.pursuing}.`]
      : []),
    ...(decided ? [decided] : []),
    cast[1],
    ...notesLines(graduate.character.firstName, input.notes)
  ].join('\n')
  return {
    system: profileSystem(input.setting),
    user: `${preamble}\n${rest}`,
    schema: objectSchema('graduate', ['pursuing', 'breakPosts'], {
      pursuing: { type: 'string' },
      breakPosts: { type: 'array', maxItems: MAX_WINTER_POSTS, items: { type: 'string' } }
    }),
    cacheKey: `venus-university-graduate-generation-${input.season}`,
    logFrom: preamble.length + 1
  }
}

/** A reply as a record, or an empty one where it is not an object. */
export function replyRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

/**
 * The Lowrise each girl who answered a Lowrise lives in, by charKey: in order, each takes the one
 * fewest live in, counting `held`, the dorms already decided, a tie going to the lowest.
 */
export function dealLowrises(
  answered: readonly string[],
  held: readonly (DormId | undefined)[]
): Record<string, DormId> {
  const lowrises = DORM_IDS.filter((dorm) => dorm !== 'elysium')
  const counts = new Map<DormId, number>(lowrises.map((dorm) => [dorm, 0]))
  for (const dorm of held) {
    if (dorm && counts.has(dorm)) counts.set(dorm, (counts.get(dorm) ?? 0) + 1)
  }
  const dealt: Record<string, DormId> = {}
  for (const key of answered) {
    let pick = lowrises[0]
    for (const dorm of lowrises) {
      if ((counts.get(dorm) ?? 0) < (counts.get(pick) ?? 0)) pick = dorm
    }
    counts.set(pick, (counts.get(pick) ?? 0) + 1)
    dealt[key] = pick
  }
  return dealt
}

/** Whether a reply answered her dorm as a Lowrise, to be dealt one. */
export function answeredLowrise(dorm: unknown): boolean {
  return dorm === LOWRISE
}

/** What a later semester's profile parts read beside the new students: its season, the returning girls and the graduates. */
export interface NextProfileInput {
  season: Season
  /** The roster girls coming back, asked only for their break. */
  returning: readonly Character[]
  graduates: readonly GraduateBrief[]
}

/** The menu key a location id is offered under, or null where the menu does not offer it. */
function menuKeyOf(menu: Readonly<Record<string, string>>, id: string): string | null {
  return Object.entries(menu).find(([, offered]) => offered === id)?.[0] ?? null
}

/**
 * A decided profile in the reply's own vocabulary — menu keys, the job's id and shift count —
 * holding only the fields among `fields` it decides. A place a menu no longer offers is left
 * undecided.
 */
export function decidedProfileOf(
  profile: DecidedProfile,
  fields: readonly ProfileField[] = PROFILE_FIELDS
): Partial<CharProfileDraft> {
  const decided = (field: ProfileField): boolean =>
    fields.includes(field) && profileFieldDecided(profile, field)
  const place = (menu: Readonly<Record<string, string>>, id: string | null | undefined) =>
    id === null ? '' : id === undefined ? null : menuKeyOf(menu, id)
  const out: Partial<CharProfileDraft> = {}

  if (decided('year')) out.year = profile.year
  if (decided('major')) out.major = profile.major?.trim()
  if (decided('classesTaken')) out.classesTaken = profile.classesTaken
  if (decided('majorClassesTaken')) out.majorClassesTaken = profile.majorClassesTaken
  if (decided('dorm')) out.dorm = profile.dorm
  if (decided('homeSlots')) out.homeSlots = profile.homeSlots
  if (decided('handle')) out.handle = profile.handle?.trim()
  if (decided('springBreakPlans')) out.springBreakPlans = profile.springBreakPlans?.trim()
  if (decided('job')) {
    out.job = profile.job?.jobId ?? ''
    out.jobShifts = profile.job?.count ?? 0
  }
  if (decided('study')) {
    const key = place(STUDY_LOCATIONS, profile.study)
    if (key !== null) out.study = key
  }
  if (decided('meal')) {
    const key = place(MEAL_LOCATIONS, profile.meal)
    if (key !== null) out.meal = key
  }
  if (decided('fun')) {
    out.fun = (profile.fun ?? []).flatMap((id) => {
      const key = menuKeyOf(FUN_LOCATIONS, id)
      return key ? [key] : []
    })
  }
  if (decided('activity')) {
    const key = profile.activity ? menuKeyOf(ACTIVITY_LOCATIONS, profile.activity.location ?? '') : ''
    if (key !== null) {
      out.activity = profile.activity?.doing?.trim() ?? ''
      out.activityLocation = key
    }
  }
  if (decided('breakPosts')) out.winterPosts = profile.breakPosts ?? []
  return out
}

/**
 * Folds the reply's array of records into one keyed by charKey: an entry that is not an
 * object, or whose key names nobody on the roster, is dropped; the first entry for a key
 * wins over any later duplicate.
 */
function foldByKey(
  reply: ProfileGenReply,
  keys: ReadonlySet<string>
): Record<string, CharProfileDraft> {
  const list: unknown = reply?.characters
  const folded: Record<string, CharProfileDraft> = {}
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'object' || raw === null) {
      console.warn('[profiles] a characters entry was not an object; skipping it.')
      continue
    }
    const entry = raw as Record<string, unknown>
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (!keys.has(key)) {
      console.warn(`[profiles] a characters entry named the unknown key "${key}"; skipping it.`)
      continue
    }
    if (folded[key]) {
      console.warn(`[profiles] ${key} was profiled twice; keeping the first.`)
      continue
    }
    folded[key] = entry as unknown as CharProfileDraft
  }
  return folded
}

/**
 * Reads majors as they are kept: trimmed, spaces collapsed, and spelt as the first one it read
 * that differs only in case. Blank reads as `''`.
 */
export function majorSpeller(): (raw: unknown) => string {
  const spellings = new Map<string, string>()
  return (raw) => {
    const major = (typeof raw === 'string' ? raw : '').trim().replace(/\s+/g, ' ')
    if (major === '') return ''
    const known = spellings.get(major.toLowerCase())
    if (known !== undefined) return known
    spellings.set(major.toLowerCase(), major)
    return major
  }
}

/** What a profile validation keeps beyond the profile itself. */
export interface ProfileValidation {
  /** Majors already spelt, which one differing only in case or spacing is spelt as, first first. */
  knownMajors?: readonly string[]
  /** Whether she keeps any winter posts; she does by default. */
  posts?: boolean
  /** Whether she keeps any spring break plans; she does by default. */
  plans?: boolean
}

/**
 * Validates New Game's reply with each girl's decided fields laid over hers, so the player's
 * values win and pass the same repairs. `asked` names the girls the call wrote for, every one by
 * default; a girl it did not is profiled from her decided fields alone. A major is required, and
 * two that differ only in case or spacing are one, spelt as a known one is, else as a decided one.
 */
export function validateProfileDraft(
  reply: ProfileGenReply | undefined,
  roster: readonly Character[],
  decided: Readonly<Record<string, Partial<CharProfileDraft>>> = {},
  asked: ReadonlySet<string> = new Set(roster.map((c) => charKeyOf(c.firstName, c.lastName))),
  opts: ProfileValidation = {}
): ProfileGenDraft {
  const folded = reply ? foldByKey(reply, asked) : {}
  const characters: Record<string, CharProfileDraft> = {}

  const spell = majorSpeller()
  for (const major of opts.knownMajors ?? []) spell(major)
  for (const character of roster) spell(decided[charKeyOf(character.firstName, character.lastName)]?.major)

  for (const character of roster) {
    const key = charKeyOf(character.firstName, character.lastName)
    const written = folded[key]
    if (asked.has(key) && !written) invalid(`${fullNameOf(character)} was left unprofiled.`)
    const own = decided[key] ?? {}
    const profile = { ...written, ...own } as CharProfileDraft
    // A year left to generate is never below what her decided dorm allows.
    if (own.year === undefined && typeof profile.year === 'number') {
      const floor = yearFloorOf({ dorm: own.dorm })
      profile.year = Math.max(profile.year, floor)
    }
    const major = spell(profile.major)
    if (major === '') invalid(`${fullNameOf(character)} was given no major.`)
    characters[key] = {
      ...validatedProfile(character, key, profile, opts),
      major,
      majorClassesTaken: clamp(profile.majorClassesTaken as number, 1, 3, `${key} majorClassesTaken`)
    }
  }

  return { characters }
}

/**
 * One student's profile as the model wrote it, every field repaired or clamped into range, her
 * posts and plans emptied where `opts` keeps none.
 */
function validatedProfile(
  character: Character,
  key: string,
  profile: CharProfileDraft,
  opts: Pick<ProfileValidation, 'posts' | 'plans'> = {}
): CharProfileDraft {
  const { posts = true, plans = true } = opts
  const job = (profile.job ?? '').trim()
  const known = job !== '' && Boolean(jobDefOf(job))
  if (job !== '' && !known) {
    console.warn(`[profiles] ${key} was given the unknown employer "${job}"; leaving her jobless.`)
  }
  const jobShifts = known ? clamp(profile.jobShifts, 0, MAX_NPC_SHIFTS, `${key} jobShifts`) : 0

  // An unknown dorm is repaired to the fallback, like the job, not fatal.
  const dorm = (profile.dorm ?? '').trim()
  if (!isDorm(dorm)) {
    console.warn(`[profiles] ${key} was housed in the unknown dorm "${dorm}"; using ${FALLBACK_DORM}.`)
  }

  // An unknown haunt is dropped, like the job, not fatal.
  const menuKey = (menu: Record<string, string>, value: unknown, field: string): string => {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (raw === '') return ''
    if (locationForKey(menu, raw) === null) {
      console.warn(`[profiles] ${key} ${field} was the unknown location "${raw}"; dropping it.`)
      return ''
    }
    return raw.toLowerCase()
  }

  const fun: string[] = []
  for (const entry of Array.isArray(profile.fun) ? profile.fun : []) {
    const resolved = menuKey(FUN_LOCATIONS, entry, 'fun')
    if (resolved !== '' && !fun.includes(resolved) && fun.length < MAX_FUN_LOCATIONS) {
      fun.push(resolved)
    }
  }

  // The phrase and the place it happens at stand or fall together: either alone says nothing.
  let activity = normalizeActivity(profile.activity)
  let activityLocation = menuKey(ACTIVITY_LOCATIONS, profile.activityLocation, 'activityLocation')
  if ((activity === '') !== (activityLocation === '')) {
    console.warn(
      `[profiles] ${key} gave the activity "${activity}" at "${activityLocation}"; dropping both.`
    )
    activity = ''
    activityLocation = ''
  }
  const activityId = activityLocation ? locationForKey(ACTIVITY_LOCATIONS, activityLocation) : null
  if (activityId) activity = activityPhraseAt(activity, activityId)

  // The handle and her winter posts are repaired, like the job, not fatal.
  const year = clamp(profile.year, 1, 4, `${key} year`)
  const rawHandle = typeof profile.handle === 'string' ? profile.handle.trim() : ''
  const handle = normalizeHandle(rawHandle)
  if (handle === '') {
    console.warn(`[profiles] ${key} was given the unusable handle "${rawHandle}"; deriving one.`)
  }

  const winterPosts: string[] = []
  // A freshman gets no posts, whatever the model wrote.
  if (posts && year > 1) {
    for (const entry of Array.isArray(profile.winterPosts) ? profile.winterPosts : []) {
      const text = typeof entry === 'string' ? entry.trim() : ''
      if (text !== '' && winterPosts.length < MAX_WINTER_POSTS) winterPosts.push(text)
    }
  }

  // Repaired to blank, not fatal.
  const springBreakPlans =
    plans && typeof profile.springBreakPlans === 'string' ? profile.springBreakPlans.trim() : ''
  if (plans && springBreakPlans === '') {
    console.warn(`[profiles] ${key} was given no spring break plans.`)
  }

  return {
    year,
    handle: handle === '' ? fallbackHandleOf(character.firstName, character.lastName) : handle,
    winterPosts,
    springBreakPlans,
    dorm: isDorm(dorm) ? dorm : FALLBACK_DORM,
    classesTaken: clamp(profile.classesTaken, 3, 6, `${key} classesTaken`),
    // A job with no shifts is no job: the two fields are stored agreeing.
    job: known && jobShifts > 0 ? job : '',
    jobShifts: known ? jobShifts : 0,
    homeSlots: clamp(profile.homeSlots, MIN_HOME_SLOTS, MAX_HOME_SLOTS, `${key} homeSlots`),
    study: menuKey(STUDY_LOCATIONS, profile.study, 'study'),
    fun,
    activity,
    activityLocation,
    meal: menuKey(MEAL_LOCATIONS, profile.meal, 'meal')
  }
}

/** One graduate as a next semester's profile call reads her: her major and what she was doing. */
export interface GraduateBrief {
  character: Character
  major: string
  /** What she was doing last semester; absent for a girl who has only just graduated. */
  pursuing?: string
  /** The pursuit the player wrote for her. */
  decided?: string
}

/** What a later semester's reply says beyond its new students, as the model returns it. */
export interface ContinuedProfileReply {
  returning?: Array<{ key: string; breakPosts?: unknown; springBreakPlans?: unknown }>
  graduates?: Array<{ key: string; pursuing?: unknown; breakPosts?: unknown }>
}

/** What the break before a `season` semester is called. */
function breakNameOf(season: Season): string {
  return season === 'fall' ? 'summer vacation' : 'winter break'
}

/** What a graduate is, and how her life since is asked for. */
const GRADUATE_LINES = [
  'They have graduated from Venus University and moved away from Veridan.',
  'pursuing: what they are doing with their life now, as one short lowercase phrase starting with an -ing verb, somewhere other than Veridan: "teaching English in Seoul", "interning at a law firm in Chicago", "backpacking through Patagonia". Where they had one last semester, write where it has led them since rather than repeating it.'
]

/** What a graduate is doing when the model gave nothing usable: last semester's, or a placeholder. */
export function fallbackPursuit(previous: string | undefined): string {
  return previous && previous.trim() !== '' ? previous.trim() : 'settling into life after college'
}

/** Up to the cap of non-blank posts out of whatever the model sent. */
function postsOf(raw: unknown): string[] {
  const posts: string[] = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    const text = typeof entry === 'string' ? entry.trim() : ''
    if (text !== '' && posts.length < MAX_WINTER_POSTS) posts.push(text)
  }
  return posts
}

/** What a later semester's reply says beyond its new students, by charKey. */
export interface NextProfiles {
  /** What each returning girl and each graduate posted over the break. */
  breakPosts: Record<string, string[]>
  /** Each returning girl's spring break plans; empty before a fall. */
  springBreakPlans: Record<string, string>
  /** What each graduate is doing now. */
  pursuits: Record<string, string>
}

/**
 * Validates the returning girls' and the graduates' half of a later semester's reply, never
 * refusing it: a girl left out costs only her posts, and a graduate's life is the one the player
 * decided, else the reply's, else last semester's.
 */
export function validateNextProfiles(
  reply: Pick<ContinuedProfileReply, 'returning' | 'graduates'> | undefined,
  next: NextProfileInput
): NextProfiles {
  const keyOf = (character: Character): string => charKeyOf(character.firstName, character.lastName)

  const breakPosts: Record<string, string[]> = {}
  const springBreakPlans: Record<string, string> = {}
  const returning = foldGroup<{ key: string; breakPosts?: unknown; springBreakPlans?: unknown }>(
    reply?.returning,
    new Set(next.returning.map(keyOf)),
    'returning'
  )
  for (const character of next.returning) {
    const key = keyOf(character)
    breakPosts[key] = postsOf(returning[key]?.breakPosts)
    const plans = returning[key]?.springBreakPlans
    if (next.season === 'spring' && typeof plans === 'string' && plans.trim() !== '') {
      springBreakPlans[key] = plans.trim()
    }
  }

  const pursuits: Record<string, string> = {}
  const graduates = foldGroup<{ key: string; pursuing?: unknown; breakPosts?: unknown }>(
    reply?.graduates,
    new Set(next.graduates.map((graduate) => keyOf(graduate.character))),
    'graduates'
  )
  for (const graduate of next.graduates) {
    const key = keyOf(graduate.character)
    const pursuing = graduates[key]?.pursuing
    const phrase =
      normalizeActivity(graduate.decided) ||
      (typeof pursuing === 'string' ? normalizeActivity(pursuing) : '')
    if (phrase === '') console.warn(`[profiles] ${key} was given no pursuit; keeping her last one.`)
    pursuits[key] = phrase === '' ? fallbackPursuit(graduate.pursuing) : phrase
    breakPosts[key] = postsOf(graduates[key]?.breakPosts)
  }

  return { breakPosts, springBreakPlans, pursuits }
}


/** The academic half of one profile: all the scheduler reads of it. */
export type ProfileAcademics = Pick<
  CharProfileDraft,
  'year' | 'dorm' | 'major' | 'classesTaken' | 'majorClassesTaken'
>

/**
 * Joins the two New Game replies into the draft the scheduler consumes, her major and how many
 * of her classes are in it taken from her profile.
 */
export function mergeProfiles(
  classDraft: ClassGenReply,
  profiles: { characters: Readonly<Record<string, ProfileAcademics>> }
): ClassGenDraft {
  const characters = Object.fromEntries(
    Object.entries(classDraft.characters).map(([key, entry]) => {
      const profile = profiles.characters[key]
      const classesTaken = profile?.classesTaken ?? 4
      const wanted = profile?.majorClassesTaken ?? 1
      const majorClassesTaken = Math.min(wanted, classesTaken)
      if (majorClassesTaken !== wanted) {
        console.warn(
          `[profiles] ${key} majorClassesTaken was ${wanted} of ${classesTaken};` +
            ` clamped to ${majorClassesTaken}.`
        )
      }
      return [
        key,
        {
          ...entry,
          major: profile?.major ?? entry.major,
          year: profile?.year ?? 1,
          dorm: profile?.dorm ?? FALLBACK_DORM,
          classesTaken,
          majorClassesTaken
        }
      ]
    })
  )

  return { ...classDraft, characters }
}

/** The job half of the reply, keyed by charKey; kept out of the scheduler. */
export function jobAssignmentsOf(profiles: ProfileGenDraft): Record<string, JobAssignment> {
  const assignments: Record<string, JobAssignment> = {}
  for (const [key, profile] of Object.entries(profiles.characters)) {
    if (profile.job && profile.jobShifts > 0) {
      assignments[key] = { jobId: profile.job, count: profile.jobShifts }
    }
  }
  return assignments
}

/** The social half of the reply, keyed by charKey; kept out of the scheduler like the job. */
export function feedAssignmentsOf(profiles: ProfileGenDraft): Record<string, FeedAssignment> {
  const assignments: Record<string, FeedAssignment> = {}
  for (const [key, profile] of Object.entries(profiles.characters)) {
    assignments[key] = { handle: profile.handle, winterPosts: profile.winterPosts }
  }
  return assignments
}

/** What each of them does with spring break, keyed by charKey; blanks are omitted. */
export function springBreakAssignmentsOf(profiles: ProfileGenDraft): Record<string, string> {
  const assignments: Record<string, string> = {}
  for (const [key, profile] of Object.entries(profiles.characters)) {
    if (profile.springBreakPlans !== '') assignments[key] = profile.springBreakPlans
  }
  return assignments
}

/** The haunts half of the reply, keyed by charKey and resolved to location ids. */
export function hiddenScheduleAssignmentsOf(
  profiles: ProfileGenDraft
): Record<string, HiddenScheduleAssignment> {
  const assignments: Record<string, HiddenScheduleAssignment> = {}
  for (const [key, profile] of Object.entries(profiles.characters)) {
    const activityId = profile.activityLocation
      ? locationForKey(ACTIVITY_LOCATIONS, profile.activityLocation)
      : null
    assignments[key] = {
      homeSlots: profile.homeSlots,
      study: profile.study ? locationForKey(STUDY_LOCATIONS, profile.study) : null,
      fun: profile.fun.flatMap((entry) => {
        const id = locationForKey(FUN_LOCATIONS, entry)
        return id ? [id] : []
      }),
      activity: activityId ? { location: activityId, doing: profile.activity } : null,
      meal: profile.meal ? locationForKey(MEAL_LOCATIONS, profile.meal) : null
    }
  }
  return assignments
}
